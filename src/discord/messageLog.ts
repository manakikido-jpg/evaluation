import { AuditLogEvent, type Message, type PartialMessage } from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { DiscordActions } from '../lib/discordRest.js';

/**
 * 🗑 消されたメッセージを #記録（channels.deletedLog か channels.log）に残す。
 * 中身は「MESSAGE CONTENT INTENT」をオンにしたときだけ分かる。BOT が起きる前のメッセージは中身が分からない。
 * BOT の書き込み・記録のチャンネル自身は残さない。だれが消したかは、本人以外が消したときだけ Discord の監査ログで分かる。
 */
type Deleted = Pick<Message | PartialMessage, 'id' | 'channelId' | 'guildId' | 'createdTimestamp'> & {
  author?: { id: string; bot: boolean } | null;
  content?: string | null;
  attachments?: { values(): IterableIterator<{ name: string; url: string }> };
  guild?: Message['guild'];
};

const LIMIT = 1500;

/** 記録に出す文（テストで確かめる） */
export function deletedLogText(m: Deleted, opts: { content: boolean; by?: string }): string {
  const files = m.attachments ? [...m.attachments.values()] : [];
  const text = (m.content ?? '').trim();
  const body = text
    ? `> ${(text.length > LIMIT ? `${text.slice(0, LIMIT)}…` : text).replace(/\n/g, '\n> ')}`
    : opts.content
      ? '-# （中身が分かりません。BOT が起きる前のメッセージか、文のないメッセージです）'
      : '-# （中身は記録していません。MESSAGE CONTENT INTENT をオンにすると残せます）';
  return [
    `🗑 **メッセージが消されました** <#${m.channelId}>`,
    `書いた人: ${m.author ? `<@${m.author.id}>` : '分かりません'} ・ 書いた時刻: ${m.createdTimestamp ? `<t:${Math.floor(m.createdTimestamp / 1000)}:f>` : '分かりません'}`,
    `消した人: ${opts.by ? `<@${opts.by}>` : '本人か、分かりません'}`,
    body,
    ...(files.length ? [`📎 ${files.map((f) => f.name).join('・').slice(0, 300)}`] : []),
  ].join('\n');
}

export class MessageLogApp {
  constructor(
    private readonly cfg: () => GuildConfig,
    private readonly discord: Pick<DiscordActions, 'sendMessage'>,
    private readonly content: boolean,
  ) {}

  private target(): string | undefined {
    const c = this.cfg().channels;
    return c.deletedLog ?? c.log;
  }

  private skip(m: Deleted): boolean {
    const target = this.target();
    return !target || m.guildId !== this.cfg().guildId || m.channelId === target || m.channelId === this.cfg().channels.log || Boolean(m.author?.bot);
  }

  async onDelete(m: Deleted): Promise<void> {
    if (this.skip(m)) return;
    const by = await this.deletedBy(m);
    await this.discord.sendMessage(this.target()!, { content: deletedLogText(m, { content: this.content, ...(by ? { by } : {}) }).slice(0, 2000), allowed_mentions: { parse: [] } });
  }

  /** まとめて消された（BAN のときの削除・運営の一括削除）: 1 件ずつだと多すぎるので、まとめて 1 つ */
  async onBulkDelete(list: Deleted[]): Promise<void> {
    const kept = list.filter((m) => !this.skip(m));
    if (!kept.length) return;
    const first = kept[0]!;
    const lines = kept
      .slice(0, 20)
      .map((m) => `- ${m.author ? `<@${m.author.id}>` : '？'}: ${(m.content ?? '').replace(/\s+/g, ' ').slice(0, 80) || '（中身なし・不明）'}`);
    await this.discord.sendMessage(this.target()!, {
      content: [`🗑 **${kept.length} 件のメッセージがまとめて消されました** <#${first.channelId}>`, ...lines, ...(kept.length > 20 ? [`-# ほか ${kept.length - 20} 件`] : [])].join('\n').slice(0, 2000),
      allowed_mentions: { parse: [] },
    });
  }

  /** だれが消したか（本人以外が消したときだけ監査ログに残る） */
  private async deletedBy(m: Deleted): Promise<string | undefined> {
    if (!m.guild || !m.author) return undefined;
    const logs = await m.guild.fetchAuditLogs({ type: AuditLogEvent.MessageDelete, limit: 5 }).catch(() => undefined);
    const hit = logs?.entries.find((e) => e.targetId === m.author!.id && e.extra?.channel.id === m.channelId && Date.now() - e.createdTimestamp < 60_000);
    return hit?.executorId ?? undefined;
  }
}

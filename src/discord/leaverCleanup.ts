import { PermissionFlagsBits, type Guild, type GuildBasedChannel, type Message, type PartialMessage } from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { DISCORD_DELETION_NOTICES_ENABLED } from './messageLog.js';
import { forgetMessages, keptChannelIds, recordMessage, takeMessages } from '../services/leaverMessages.js';

/** Discord がまとめて消せるのは 14 日以内（少し余裕を見る） */
const BULK_MAX_AGE_MS = 14 * 86_400_000 - 3_600_000;

/**
 * 運営だけのチャンネルか（@everyone にも、どの役職にも見えない。スレッドは親のチャンネルで見る）。
 * 記録・通報・申請などは運営だけが見えるので、ここで残す
 */
export function staffOnly(ch: GuildBasedChannel, guild: Guild, rankRoleIds: readonly string[]): boolean {
  const base = ch.isThread() ? ch.parent : ch;
  if (!base) return false;
  const roles = [guild.roles.everyone.id, ...rankRoleIds];
  return !roles.some((id) => base.permissionsFor(id)?.has(PermissionFlagsBits.ViewChannel));
}

/**
 * 🧹 サーバーを抜けた人の書き込み（文・写真・動画）を消す。
 * 書き込みの番号を覚えておき（この機能を入れてからの分だけ）、抜けたらまとめて消す。
 * 残すもの: ピン留め・運営だけのチャンネル（記録・通報・チケットなど）・キャストの予約スレッド。
 */
export class LeaverCleanupApp {
  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
    private readonly discord: Pick<DiscordActions, 'sendMessage'>,
    /** 消したものを 🗑 記録に 1 件ずつ出さないように知らせる */
    private readonly quiet: (ids: string[]) => void,
  ) {}

  onMessage(m: Message): void {
    if (!m.inGuild() || m.guildId !== this.cfg().guildId || m.author.bot || m.system || m.webhookId) return;
    void recordMessage(this.db, { id: m.id, channelId: m.channelId, authorId: m.author.id, at: m.createdAt }).catch((err) => logger.warn({ err }, 'member message record failed'));
  }

  onDelete(ids: string[]): void {
    void forgetMessages(this.db, ids).catch(() => undefined);
  }

  async onMemberRemove(guild: Guild, memberId: string): Promise<number> {
    if (guild.id !== this.cfg().guildId) return 0;
    const byChannel = await takeMessages(this.db, memberId);
    if (!byChannel.size) return 0;
    const kept = await keptChannelIds(this.db);
    const ranks = this.cfg().ranks.map((r) => r.roleId);
    let removed = 0;
    for (const [channelId, msgs] of byChannel) {
      if (kept.has(channelId)) continue;
      const ch = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
      if (!ch || !ch.isTextBased() || staffOnly(ch, guild, ranks)) continue;
      try {
        // ピン留めは残す
        const pinned = new Set((await ch.messages.fetchPinned().catch(() => undefined))?.keys() ?? []);
        const targets = msgs.filter((m) => !pinned.has(m.id));
        this.quiet(targets.map((m) => m.id));
        const fresh = targets.filter((m) => Date.now() - m.at.getTime() < BULK_MAX_AGE_MS).map((m) => m.id);
        const old = targets.filter((m) => Date.now() - m.at.getTime() >= BULK_MAX_AGE_MS).map((m) => m.id);
        for (let i = 0; i < fresh.length; i += 100) {
          const chunk = fresh.slice(i, i + 100);
          if (chunk.length === 1) removed += (await ch.messages.delete(chunk[0]!).then(() => 1, () => 0));
          else if ('bulkDelete' in ch) removed += (await ch.bulkDelete(chunk, true)).size;
        }
        for (const id of old) removed += await ch.messages.delete(id).then(() => 1, () => 0);
      } catch (err) {
        logger.warn({ err, channelId, memberId }, 'leaver messages delete failed（BOT に「メッセージの管理」があるか）');
      }
    }
    if (removed) {
      logger.info({ memberId, removed }, 'leaver messages removed');
      const log = this.cfg().channels.deletedLog ?? this.cfg().channels.log;
      if (DISCORD_DELETION_NOTICES_ENABLED && log) await this.discord.sendMessage(log, { content: `🧹 サーバーを抜けた <@${memberId}> さんの書き込みを ${removed} 件消しました（ピン留め・運営のチャンネル・予約スレッドは残しています）。`, allowed_mentions: { parse: [] } }).catch(() => undefined);
    }
    return removed;
  }
}

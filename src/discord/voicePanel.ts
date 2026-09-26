import type { Guild, VoiceBasedChannel, VoiceState } from 'discord.js';
import type { GuildConfig } from '../config.js';
import { logger } from '../lib/logger.js';
import { shuinId } from './ids.js';
import { vcPanel } from './views.js';

/**
 * 通話に入った人がいたら、その通話のチャットのいちばん下に「この通話の人に朱印を押す」を出す。
 * 前に出したものは消すので、チャットに何枚もたまらない。
 */
export class VoicePanelApp {
  /** 通話ごとに 1 つずつ */
  private readonly queue = new Map<string, Promise<void>>();

  constructor(private readonly cfg: () => GuildConfig) {}

  /** 出さない通話（AFK・「➕ ○○をひらく」・数えない通話） */
  private skip(channel: VoiceBasedChannel, guild: Guild): boolean {
    const cfg = this.cfg();
    return (
      channel.id === guild.afkChannelId ||
      cfg.tempVoice.hubs.some((h) => h.channelId === channel.id) ||
      cfg.economy.excludedVoiceChannelIds.includes(channel.id)
    );
  }

  onVoiceStateUpdate(before: VoiceState, after: VoiceState): void {
    const channel = after.channel;
    if (!channel || after.channelId === before.channelId || after.member?.user.bot) return;
    if (after.guild.id !== this.cfg().guildId || this.skip(channel, after.guild)) return;
    const prev = this.queue.get(channel.id) ?? Promise.resolve();
    const next = prev.then(() => this.post(channel)).catch((err) => logger.warn({ err, channelId: channel.id }, 'voice panel failed'));
    this.queue.set(channel.id, next);
  }

  private async post(channel: VoiceBasedChannel): Promise<void> {
    if (!channel.isTextBased() || !channel.isSendable()) return;
    const me = channel.client.user.id;
    const panelId = shuinId('vc', channel.id);
    const isPanel = (m: { author: { id: string }; components: { components: { customId?: string | null }[] }[] }) =>
      m.author.id === me && m.components.some((r) => r.components.some((c) => 'customId' in c && c.customId === panelId));
    // すでにいちばん下にあれば何もしない
    const recent = await channel.messages.fetch({ limit: 20 }).catch(() => undefined);
    const last = recent?.first();
    if (last && isPanel(last as never)) return;
    await channel.send({ ...vcPanel(channel.id), allowedMentions: { parse: [] } });
    // 前に出したものは消す
    for (const m of recent?.values() ?? []) if (isPanel(m as never)) await m.delete().catch(() => undefined);
  }
}

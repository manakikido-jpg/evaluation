import type { Guild, Message, VoiceBasedChannel, VoiceState } from 'discord.js';
import type { GuildConfig } from '../config.js';
import { logger } from '../lib/logger.js';
import { shuinId } from './ids.js';
import { vcPanel } from './views.js';

/** 話が流れたときに、いちばん下へ出し直す間隔（15 秒に 1 回） */
export const VC_PANEL_RESTICK_MS = 15_000;

/**
 * 通話のチャットのいちばん下に、いつも「この通話の人のプロフィールを見る」を出す。
 * - 通話に入った人がいたら、すぐ（いちばん下になければ）
 * - だれかがチャットに書いたら、15 秒に 1 回まで出し直す（BOT の書き込みは数えない）
 * 前に出したものは消すので、チャットに何枚もたまらない。
 */
export class VoicePanelApp {
  /** 通話ごとに 1 つずつ */
  private readonly queue = new Map<string, Promise<void>>();
  /** 出し直しを待っている通話 */
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly cfg: () => GuildConfig,
    private readonly restickMs = VC_PANEL_RESTICK_MS,
  ) {}

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
    this.enqueue(channel);
  }

  /** 通話のチャットに人が書いたら、15 秒後に 1 回だけ、いちばん下へ出し直す（BOT の書き込みは数えない） */
  onMessage(msg: Message): void {
    if (!msg.inGuild() || msg.guildId !== this.cfg().guildId || msg.author.bot) return;
    const channel = msg.channel;
    if (!channel.isVoiceBased() || this.skip(channel, msg.guild) || this.timers.has(channel.id)) return;
    this.timers.set(
      channel.id,
      setTimeout(() => {
        this.timers.delete(channel.id);
        this.enqueue(channel);
      }, this.restickMs),
    );
  }

  private enqueue(channel: VoiceBasedChannel): void {
    const prev = this.queue.get(channel.id) ?? Promise.resolve();
    const next = prev.then(() => this.post(channel)).catch((err) => logger.warn({ err, channelId: channel.id }, 'voice panel failed'));
    this.queue.set(channel.id, next);
  }

  private async post(channel: VoiceBasedChannel): Promise<void> {
    if (!channel.isTextBased() || !channel.isSendable()) return;
    const me = channel.client.user.id;
    const panelId = shuinId('vc', channel.id);
    type Msg = { author: { id: string; bot?: boolean }; components: { components: { customId?: string | null }[] }[] };
    const isPanel = (m: Msg) => m.author.id === me && m.components.some((r) => r.components.some((c) => 'customId' in c && c.customId === panelId));
    // すでにいちばん下にあれば何もしない（あとに BOT の書き込みしかなければ、いちばん下とみなす）
    const recent = await channel.messages.fetch({ limit: 20 }).catch(() => undefined);
    const last = [...(recent?.values() ?? [])].find((m) => isPanel(m as never) || !(m as Msg).author.bot);
    if (last && isPanel(last as never)) return;
    await channel.send({ ...vcPanel(channel.id), allowedMentions: { parse: [] } });
    // 前に出したものは消す
    for (const m of recent?.values() ?? []) if (isPanel(m as never)) await m.delete().catch(() => undefined);
  }
}

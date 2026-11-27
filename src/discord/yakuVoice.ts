import type { Guild, VoiceState } from 'discord.js';
import { adminLevelOf, type GuildConfig } from '../config.js';
import { logger } from '../lib/logger.js';
import { isEngawaName } from '../services/voiceUsage.js';
import { isYakudoshi } from '../services/yakuGate.js';

/**
 * 👹 厄のあいだは、通話は縁側だけ（本人の決定 2026-11-26）。
 * 縁側でない通話に入ったら切って、本人に DM で知らせる（DM は10分に1回まで）。奥の院（AFK）と、運営がいる通話（面接など）はそのまま。
 */
export class YakuVoiceApp {
  private notified = new Map<string, number>();
  constructor(private readonly cfg: () => GuildConfig) {}

  /** 起動したとき：いま縁側でない通話にいる厄の人を切る */
  async attach(guild: Guild): Promise<void> {
    if (guild.id !== this.cfg().guildId) return;
    for (const v of guild.voiceStates.cache.values()) await this.check(v);
  }

  async onVoiceStateUpdate(before: VoiceState, after: VoiceState): Promise<void> {
    if (after.guild.id !== this.cfg().guildId || !after.channelId || before.channelId === after.channelId) return;
    await this.check(after);
  }

  /** 厄の人が縁側でない通話にいたら切る。切ったら true */
  async check(v: VoiceState, now = Date.now()): Promise<boolean> {
    const m = v.member;
    if (!m || m.user.bot || !v.channel || !isYakudoshi(this.cfg(), m.roles.cache.keys())) return false;
    if (v.channelId === v.guild.afkChannelId || isEngawaName(v.channel.name)) return false;
    // 運営（神職・宮司）がいる通話は、面接などのために入れる
    const members = (v.channel as { members?: Map<string, { id: string; roles: { cache: Map<string, unknown> } }> }).members;
    if (members && [...members.values()].some((x) => x.id !== m.id && adminLevelOf(this.cfg(), [...x.roles.cache.keys()]))) return false;
    try {
      await v.disconnect('厄のあいだは縁側の通話だけ');
    } catch (err) {
      logger.warn({ err, memberId: m.id }, 'yaku voice disconnect failed');
      return false;
    }
    const last = this.notified.get(m.id);
    if (last === undefined || now - last >= 10 * 60_000) {
      this.notified.set(m.id, now);
      await m.send('👹 厄のあいだは、通話は縁側だけに入れます。免罪符は授与所から（運営との面接のあとに祓われます）。').catch(() => undefined);
    }
    return true;
  }
}

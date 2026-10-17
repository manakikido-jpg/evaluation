import { ChannelType, type Guild } from 'discord.js';
import type { GuildConfig } from '../config.js';
import { logger } from '../lib/logger.js';
import { EMA_COUNTER_INTERVAL_MS, EMA_COUNTER_TARGETS, emaCounterName, emaCounts } from '../services/emaCounter.js';

/** 全員を取得できてから数える。各チャンネルの変更間隔をあけ、未変更の名前は送らない。 */
export class EmaCounterApp {
  private guild?: Guild;
  private membersReady = false;
  private memberIds = new Set<string>();
  private membershipChanges?: Map<string, boolean>;
  private busy = false;
  private timer?: NodeJS.Timeout;
  private readonly lastAttempt = new Map<string, number>();
  constructor(private readonly cfg: () => GuildConfig, private readonly now = () => Date.now()) {}
  attach(guild: Guild, membersReady: boolean): void { this.guild = guild; this.membersReady = membersReady; this.memberIds = new Set(guild.members.cache.keys()); }
  memberChanged(guildId: string, memberId: string, present: boolean): void {
    if (guildId !== this.cfg().guildId) return;
    if (present) this.memberIds.add(memberId); else this.memberIds.delete(memberId);
    this.membershipChanges?.set(memberId, present);
    this.schedule(guildId);
  }
  schedule(guildId: string): void {
    if (guildId !== this.cfg().guildId) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; void this.tick(); }, 1500);
  }
  invalidate(): void { this.membersReady = false; }
  close(): void { clearTimeout(this.timer); this.timer = undefined; }
  async tick(): Promise<void> {
    const g = this.guild, cfg = this.cfg();
    if (!g || g.id !== cfg.guildId || !g.available || this.busy || !EMA_COUNTER_TARGETS.some((t) => cfg.emaCounter[t.key])) return;
    this.busy = true;
    try {
      if (!this.membersReady) {
        const changes = new Map<string, boolean>(); this.membershipChanges = changes;
        try {
          const members = await g.members.fetch();
          this.memberIds = new Set(members.keys());
          for (const [id, present] of changes) { if (present) this.memberIds.add(id); else this.memberIds.delete(id); }
          this.membersReady = true;
        } finally { this.membershipChanges = undefined; }
      }
      const counts = emaCounts(cfg, [...g.members.cache.values()].filter((m) => this.memberIds.has(m.id)).map((m) => ({ bot: m.user.bot, roles: m.roles.cache.keys() })));
      for (const target of EMA_COUNTER_TARGETS) {
        const id = cfg.emaCounter[target.key], count = counts[target.key];
        if (!id || count === undefined) continue;
        const channel = g.channels.cache.get(id);
        if (channel?.type !== ChannelType.GuildText) continue;
        const name = emaCounterName(cfg.emaCounter.names[target.key], count);
        if (channel.name === name || this.now() - (this.lastAttempt.get(id) ?? -Infinity) < EMA_COUNTER_INTERVAL_MS) continue;
        this.lastAttempt.set(id, this.now());
        try { await channel.setName(name, '絵馬殿の役職・性別ごとの在籍人数'); }
        catch (err) { logger.warn({ err, channelId: id }, 'ema counter rename failed'); }
      }
    } catch (err) { logger.warn({ err }, 'ema counter member list unavailable'); }
    finally { this.busy = false; }
  }
}

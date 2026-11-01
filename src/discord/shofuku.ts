import type { Guild } from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { shofukuConfig, shofukuPerks } from '../services/shofuku.js';

/** 🎍 招福詣: 毎分、招かれた人のお参り期間を延ばし、『招福』ロールを付ける（付いていない人だけ） */
export class ShofukuApp {
  private busy = false;
  constructor(private db: Db, private cfg: () => GuildConfig) {}
  async tick(guild: Guild, now = new Date()): Promise<void> {
    if (this.busy || guild.id !== this.cfg().guildId) return;
    this.busy = true;
    try {
      const { roleTargets } = await shofukuPerks(this.db, this.cfg(), now);
      const roleId = roleTargets.length ? (await shofukuConfig(this.db)).roleId : '';
      for (const id of roleTargets) {
        const m = guild.members.cache.get(id) ?? await guild.members.fetch(id).catch(() => undefined);
        if (!m || m.roles.cache.has(roleId)) continue;
        await m.roles.add(roleId, '🎍 招福詣で参拝された').catch((err: unknown) => logger.warn({ err, memberId: id }, 'shofuku role add failed'));
      }
    } finally { this.busy = false; }
  }
}

import { ChannelType, type Guild } from 'discord.js';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';
import { waitingGuides, type GuideConfig } from '../services/guideReception.js';
import { logger } from '../lib/logger.js';

const KEY = 'guide.waiting_channel_names';
const SUFFIX = '（入室⭕）';
const stateSchema = z.record(z.string(), z.object({ base: z.string(), managed: z.string(), attempts: z.array(z.number()) }));
/** 名前の元を永続化し、再起動・設定変更後も戻せるようにする。 */
export class GuideWaitingNames {
  private busy = false;
  constructor(private db: Db, private presence = false) {}
  async sync(guild: Guild, config: GuideConfig, now = Date.now()) {
    if (this.busy) return;
    this.busy = true;
    try {
      const [row] = await this.db.select().from(settings).where(eq(settings.key, KEY));
      const parsed = stateSchema.safeParse(row?.value ?? {});
      // 不正な記録で元の名前を上書きしない。
      if (!parsed.success) return;
      const state = parsed.data;
      let waiting = false;
      if (config.voiceChannelIds.length && config.roleId) {
        for (const id of await waitingGuides(this.db)) {
          const member = await guild.members.fetch({ user: id, force: true }).catch(() => undefined);
          if (member && !member.user.bot && member.roles.cache.has(config.roleId) && (!this.presence || (member.presence?.status !== 'offline' && member.presence?.status !== undefined))) {
            waiting = true;
            break;
          }
        }
      }
      const save = () => this.db.insert(settings).values({ key: KEY, value: state, updatedBy: 'system' }).onConflictDoUpdate({ target: settings.key, set: { value: state, updatedBy: 'system', updatedAt: new Date(now) } });
      for (const id of new Set([...config.voiceChannelIds, ...Object.keys(state)])) {
        // 別用途の「案内担当」の名前とは競合させない。
        if (id === config.dutyChannelId) continue;
        const ch = guild.channels.cache.get(id);
        if (ch?.type !== ChannelType.GuildVoice || typeof ch.setName !== 'function' || typeof ch.name !== 'string') continue;
        const open = waiting && config.voiceChannelIds.includes(id);
        let entry = state[id];
        if (!entry && !open) continue;
        if (!entry) entry = state[id] = { base: ch.name, managed: ch.name, attempts: [] };
        // 運営が手動で変えた名前を、新しい元の名前として尊重する。
        if (ch.name !== entry.managed && ch.name !== entry.base) {
          entry.base = ch.name;
          entry.managed = ch.name;
          await save();
        }
        const target = open && !entry.base.endsWith(SUFFIX) ? `${entry.base.slice(0, 100 - SUFFIX.length)}${SUFFIX}` : entry.base;
        if (ch.name === target) continue;
        entry.attempts = entry.attempts.filter(at => now - at < 10 * 60_000 + 1000);
        if (entry.attempts.length >= 2) continue;
        // 送信前に保存。失敗・再起動でも連打せず、元の名前を失わない。
        entry.attempts.push(now);
        entry.managed = target;
        await save();
        try { await ch.setName(target, '案内人の待機状態を表示'); }
        catch (err) { logger.warn({ err, channelId: id }, 'guide waiting rename failed'); }
      }
    } finally { this.busy = false; }
  }
}

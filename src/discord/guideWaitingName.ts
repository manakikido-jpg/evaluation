import { ChannelType, type Guild } from 'discord.js';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';
import { guideDuty, waitingGuides, type GuideConfig } from '../services/guideReception.js';
import { logger } from '../lib/logger.js';

const KEY = 'guide.waiting_channel_names';
const SUFFIX = '（入室⭕）';
const ABSENT_SUFFIX = '（案内人不在）';
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
      let waiting: boolean | undefined = false;
      if (config.voiceChannelIds.length) {
        const [standby, duty] = await Promise.all([waitingGuides(this.db), guideDuty(this.db)]);
        const dutyIds = new Set(duty);
        const candidates = new Set([...duty, ...standby]);
        let uncertain = candidates.size > 0 && !config.roleId;
        if (config.roleId) for (const id of candidates) {
          const member = await guild.members.fetch({ user: id, force: true }).catch((err: unknown) => {
            // 退会は確定している。不明な取得失敗は「不在」と決めつけない。
            if (!(err && typeof err === 'object' && 'code' in err && err.code === 10007)) {
              uncertain = true;
              logger.warn({ err }, 'guide availability member fetch failed');
            }
            return undefined;
          });
          if (!member || member.user.bot || !member.roles.cache.has(config.roleId)) continue;
          const status = member.presence?.status;
          // 明示的な担当中は終了するまで有効。VC接続中ならオフライン表示でも在席。
          if (dutyIds.has(id) || !this.presence || member.voice?.channelId || (status !== undefined && status !== 'offline')) {
            waiting = true;
            break;
          }
          if (status === undefined) uncertain = true;
        }
        if (!waiting && uncertain) waiting = undefined;
      }
      const save = () => this.db.insert(settings).values({ key: KEY, value: state, updatedBy: 'system' }).onConflictDoUpdate({ target: settings.key, set: { value: state, updatedBy: 'system', updatedAt: new Date(now) } });
      for (const id of new Set([...config.voiceChannelIds, ...Object.keys(state)])) {
        // 別用途の「案内担当」の名前とは競合させない。
        if (id === config.dutyChannelId) continue;
        const ch = guild.channels.cache.get(id);
        if (ch?.type !== ChannelType.GuildVoice || typeof ch.setName !== 'function' || typeof ch.name !== 'string') continue;
        const configured = config.voiceChannelIds.includes(id);
        if (configured && waiting === undefined) continue;
        const open = waiting === true && configured;
        let entry = state[id];
        if (!entry && !configured) continue;
        if (!entry) entry = state[id] = { base: ch.name, managed: ch.name, attempts: [] };
        // 運営が手動で変えた名前を、新しい元の名前として尊重する。
        if (ch.name !== entry.managed && ch.name !== entry.base) {
          entry.base = ch.name;
          entry.managed = ch.name;
          await save();
        }
        const suffix = open ? SUFFIX : ABSENT_SUFFIX;
        const base = entry.base.replace(/（(?:入室⭕|案内人不在)）$/, '');
        const target = configured ? `${base.slice(0, 100 - suffix.length)}${suffix}` : entry.base;
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

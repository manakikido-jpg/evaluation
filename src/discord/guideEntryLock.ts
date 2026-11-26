import { ChannelType, OverwriteType, PermissionFlagsBits, type Guild, type VoiceChannel } from 'discord.js';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { adminLevelOf, type GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { guideReceptions, settings } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { hasGuideRole, type GuideConfig } from '../services/guideReception.js';

const KEY = 'guide.entry_locks';
const valueSchema = z.object({ type: z.union([z.literal(0), z.literal(1)]), before: z.boolean().nullable(), applied: z.boolean(), existed: z.boolean(), previousApplied: z.boolean().optional() });
const stateSchema = z.record(z.string(), z.record(z.string(), valueSchema));
type Entry = z.infer<typeof valueSchema>;
const connectOf = (ch: VoiceChannel, id: string): boolean | null => {
  const o = ch.permissionOverwrites.cache.get(id);
  return o?.allow.has(PermissionFlagsBits.Connect) ? true : o?.deny.has(PermissionFlagsBits.Connect) ? false : null;
};

/** 接続権限だけを変える。元の値を先にDBへ保存し、失敗・再起動でも復元する。 */
export class GuideEntryLocks {
  private queue: Promise<void> = Promise.resolve();
  constructor(private db: Db, private cfg: () => GuildConfig) {}
  sync(guild: Guild, config: GuideConfig & { guideRoleIds: string[] }): Promise<Set<string>> {
    const run = this.queue.then(() => this.apply(guild, config));
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
  private async apply(guild: Guild, config: GuideConfig & { guideRoleIds: string[] }) {
    const [row] = await this.db.select().from(settings).where(eq(settings.key, KEY));
    const state = stateSchema.parse(row?.value ?? {});
    const save = () => this.db.insert(settings).values({ key: KEY, value: state, updatedBy: 'system' }).onConflictDoUpdate({ target: settings.key, set: { value: state, updatedBy: 'system', updatedAt: new Date() } });
    const assigned = await this.db.select().from(guideReceptions).where(and(eq(guideReceptions.status, 'assigned'), isNull(guideReceptions.departedAt)));
    const failed = new Set<string>();
    for (const channelId of new Set([...assigned.filter(r => config.voiceChannelIds.includes(r.channelId)).map(r => r.channelId), ...Object.keys(state)])) {
      try {
        const ch = await guild.channels.fetch(channelId, { force: true }).catch((err: { code?: number }) => {
          if (err?.code === 10003) return null;
          throw err;
        });
        if (!ch) { delete state[channelId]; await save(); continue; }
        if (ch.type !== ChannelType.GuildVoice || !ch.permissionOverwrites) { failed.add(channelId); continue; }
        const live = assigned.filter(r => r.channelId === channelId && config.voiceChannelIds.includes(channelId) && r.guideId && ch.members.has(r.visitorId) && ch.members.has(r.guideId));
        const desired = new Map<string, { type: 0 | 1; value: boolean }>();
        if (live.length) {
          const cfg = this.cfg();
          const staffRoles = cfg.ranks.filter(r => adminLevelOf(cfg, [r.roleId])).map(r => r.roleId);
          const allowedRoles = new Set([...config.guideRoleIds, ...staffRoles, ...(cfg.admin?.gujiRoleIds ?? []), ...(cfg.admin?.shinshokuRoleIds ?? [])].filter(id => id !== guild.id));
          desired.set(guild.id, { type: OverwriteType.Role, value: false });
          // 他のロール/個人の明示的な許可が @everyone の拒否を打ち消さないようにする。
          for (const o of ch.permissionOverwrites.cache.values()) {
            const m = o.type === OverwriteType.Member ? guild.members.cache.get(o.id) : undefined;
            const staff = m && (hasGuideRole(m, config.guideRoleIds) || adminLevelOf(cfg, [...m.roles.cache.keys()]));
            desired.set(o.id, { type: o.type, value: Boolean(staff || allowedRoles.has(o.id)) });
          }
          for (const id of allowedRoles) desired.set(id, { type: OverwriteType.Role, value: true });
          for (const m of ch.members.values()) desired.set(m.id, { type: OverwriteType.Member, value: true });
          if (guild.members.me) desired.set(guild.members.me.id, { type: OverwriteType.Member, value: true });
        }
        const entries = state[channelId] ??= {};
        const restore = async (id: string, entry: Entry) => {
          const current = ch.permissionOverwrites.cache.get(id);
          // 運営がその後変更した値は、復元で上書きしない。
          if (connectOf(ch, id) === entry.applied || (entry.previousApplied !== undefined && connectOf(ch, id) === entry.previousApplied)) {
            const otherBits = current && ((current.allow.bitfield | current.deny.bitfield) & ~PermissionFlagsBits.Connect);
            if (!entry.existed && !otherBits && entry.before === null) await ch.permissionOverwrites.delete(id, '案内の入室制限を元に戻す');
            else await ch.permissionOverwrites.edit(id, { Connect: entry.before }, { type: entry.type, reason: '案内の入室制限を元に戻す' });
          }
          delete entries[id]; await save();
        };
        // 在室者・案内人の許可を先に用意し、制限の途中でも参加者を締め出さない。
        for (const [id, target] of [...desired].sort((a, b) => Number(b[1].value) - Number(a[1].value))) {
          const current = connectOf(ch, id);
          if (current === target.value) continue;
          const entry = entries[id] ??= { type: target.type, before: current, applied: target.value, existed: ch.permissionOverwrites.cache.has(id) };
          // 適用前に保存するので、途中失敗でも元の権限を失わない。
          if (entry.applied !== target.value) entry.previousApplied = entry.applied;
          entry.applied = target.value; await save();
          await ch.permissionOverwrites.edit(id, { Connect: target.value }, { type: target.type, reason: '案内中は新しい入室を止める' });
        }
        // 先に一般の接続権限を元に戻してから、一時的な個人/ロールの許可を片付ける。
        for (const [id, entry] of Object.entries(entries).sort((a, b) => Number(a[1].applied) - Number(b[1].applied))) if (!desired.has(id)) await restore(id, entry);
        if (!Object.keys(entries).length) { delete state[channelId]; await save(); }
      } catch (err) { failed.add(channelId); logger.warn({ err, channelId }, 'guide entry lock failed'); }
    }
    return failed;
  }
}

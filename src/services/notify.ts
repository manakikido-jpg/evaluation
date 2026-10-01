import { and, eq, isNull } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { members, settings } from '../db/schema.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';

/**
 * 🔔 通知 OK／🔕 通知 NG。用意すると、募集（「〇〇を募集する」）と運営のお知らせの「⛩ すべての役職」は、
 * 通知 OK のロールだけを鳴らす（NG の人には鳴らない。@everyone・@here・決めたロールはそのまま）。
 * 用意したときに今いる人（役職のある人）全員に通知 OK を付け、新しく入った人も承認のときに OK から。
 * 本人は #授与所 などのボタンで切り替える。
 */

export type NotifyLevel = 'ok' | 'ng';
export const isNotifyLevel = (v: unknown): v is NotifyLevel => v === 'ok' || v === 'ng';
export const NOTIFY_LABEL: Record<NotifyLevel, string> = { ok: '🔔 通知OK', ng: '🔕 通知NG' };

export const notifyReady = (cfg: Pick<GuildConfig, 'notify'>): boolean => Boolean(cfg.notify.okRoleId && cfg.notify.ngRoleId);

/** 「すべての役職」・募集で鳴らすロール（用意していなければ役職のロール全部） */
export function pingRoleIds(cfg: Pick<GuildConfig, 'notify' | 'ranks'>): string[] {
  if (notifyReady(cfg)) return [cfg.notify.okRoleId!];
  return [...new Set(cfg.ranks.map((r) => r.roleId))];
}

/** 持っているロールから、今の選択（どちらもなければ undefined） */
export function notifyOf(cfg: Pick<GuildConfig, 'notify'>, roleIds: readonly string[]): NotifyLevel | undefined {
  if (cfg.notify.ngRoleId && roleIds.includes(cfg.notify.ngRoleId)) return 'ng';
  if (cfg.notify.okRoleId && roleIds.includes(cfg.notify.okRoleId)) return 'ok';
  return undefined;
}

/** 選んだほうを付けて、もう片方を外す（roleIds が分からなければ、もう片方を外してみる） */
export async function setNotify(
  ctx: { cfg: Pick<GuildConfig, 'notify' | 'guildId'>; discord: Pick<DiscordActions, 'addRole' | 'removeRole'> },
  memberId: string,
  level: NotifyLevel,
  roleIds?: readonly string[],
): Promise<'ok' | 'disabled'> {
  if (!notifyReady(ctx.cfg)) return 'disabled';
  const want = level === 'ok' ? ctx.cfg.notify.okRoleId! : ctx.cfg.notify.ngRoleId!;
  const other = level === 'ok' ? ctx.cfg.notify.ngRoleId! : ctx.cfg.notify.okRoleId!;
  const reason = `通知: ${NOTIFY_LABEL[level]}`;
  if (!roleIds?.includes(want)) await ctx.discord.addRole(ctx.cfg.guildId, memberId, want, reason);
  if (!roleIds || roleIds.includes(other)) {
    await ctx.discord.removeRole(ctx.cfg.guildId, memberId, other, reason).catch((err: unknown) => logger.warn({ err }, 'remove notify role failed'));
  }
  return 'ok';
}

/** 役職のある今いる人の、OK・NG・どちらもない人の数 */
export async function notifyCounts(db: Db, cfg: Pick<GuildConfig, 'notify' | 'ranks'>): Promise<{ ok: number; ng: number; none: number }> {
  const ranks = new Set(cfg.ranks.map((r) => r.roleId));
  const rows = await db.select({ roleIds: members.roleIds }).from(members).where(and(isNull(members.leftAt), eq(members.isBot, false)));
  const out = { ok: 0, ng: 0, none: 0 };
  for (const m of rows) {
    if (!m.roleIds.some((r) => ranks.has(r))) continue;
    out[notifyOf(cfg, m.roleIds) ?? 'none']++;
  }
  return out;
}

// ───────── 用意したときに、今いる人へ通知 OK を配る（少しずつ） ─────────

const KEY = 'notify.setup';
export type NotifySetupState = { at: string; by: string; targets: string[]; done: number; failed: string[]; finishedAt?: string };

export async function notifySetupState(db: Db): Promise<NotifySetupState | undefined> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  return row?.value as NotifySetupState | undefined;
}

/** 配る相手: 役職のある今いる人で、通知 OK も NG もまだ持っていない人 */
export async function notifyTargets(db: Db, cfg: Pick<GuildConfig, 'notify' | 'ranks'>): Promise<string[]> {
  const ranks = new Set(cfg.ranks.map((r) => r.roleId));
  const rows = await db.select({ id: members.id, roleIds: members.roleIds }).from(members).where(and(isNull(members.leftAt), eq(members.isBot, false)));
  return rows.filter((m) => m.roleIds.some((r) => ranks.has(r)) && !notifyOf(cfg, m.roleIds)).map((m) => m.id);
}

/** 配り始める（前の分が途中なら、残りに足す） */
export async function startNotifySetup(db: Db, cfg: GuildConfig, by: string, now = new Date()): Promise<NotifySetupState> {
  const prev = await notifySetupState(db);
  const left = prev && !prev.finishedAt ? prev.targets.slice(prev.done) : [];
  const targets = [...new Set([...left, ...(await notifyTargets(db, cfg))])];
  const state: NotifySetupState = { at: now.toISOString(), by, targets, done: 0, failed: [], ...(targets.length ? {} : { finishedAt: now.toISOString() }) };
  await db
    .insert(settings)
    .values({ key: KEY, value: state, updatedBy: by, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value: state, updatedBy: by, updatedAt: now } });
  return state;
}

/** 少し進める（budget 人まで）。終わったら true */
export async function runNotifySetup(db: Db, cfg: GuildConfig, discord: Pick<DiscordActions, 'addRole'>, budget = 10, now = new Date()): Promise<boolean> {
  const st = await notifySetupState(db);
  if (!st || st.finishedAt) return true;
  if (!notifyReady(cfg)) return true;
  const end = Math.min(st.targets.length, st.done + budget);
  const failed = [...st.failed];
  for (let i = st.done; i < end; i++) {
    const id = st.targets[i]!;
    try {
      const [m] = await db.select({ roleIds: members.roleIds }).from(members).where(eq(members.id, id));
      // もう自分で選んだ人・抜けた人はそのまま
      if (m && !notifyOf(cfg, m.roleIds)) {
        await discord.addRole(cfg.guildId, id, cfg.notify.okRoleId!, '通知 OK／NG を用意（はじめは OK）');
        await db.update(members).set({ roleIds: [...new Set([...m.roleIds, cfg.notify.okRoleId!])] }).where(eq(members.id, id));
      }
    } catch (err) {
      logger.warn({ err, memberId: id }, 'notify setup add failed');
      failed.push(id);
    }
  }
  const next: NotifySetupState = { ...st, done: end, failed, ...(end >= st.targets.length ? { finishedAt: now.toISOString() } : {}) };
  // 途中で押し直された（targets が変わった）ときは上書きしない
  const cur = await notifySetupState(db);
  if (cur?.at !== st.at) return false;
  await db.update(settings).set({ value: next, updatedAt: now }).where(eq(settings.key, KEY));
  return Boolean(next.finishedAt);
}

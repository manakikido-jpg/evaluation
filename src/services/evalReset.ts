import { and, eq, isNull } from 'drizzle-orm';
import type { GuildConfig, Rank } from '../config.js';
import type { Db } from '../db/client.js';
import { members, settings, shuin } from '../db/schema.js';
import { autoRanks } from '../domain/ranks.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { audit } from './audit.js';

/**
 * 評価のリセット（一度だけ）。
 * - 押されている朱印を全部「取り消し」にする（記録は残る・ご縁は 0 から。同じ相手にまた押せる。銭は戻さない）
 * - ご縁で上がる役職を、全員いちばん下（入鯖時の役職）に戻す（任命制の役職はそのまま。自動の役職を持っていない人もそのまま）
 * 役職の付け替えは Discord に 1 人ずつ頼むので、少しずつ進める（進み具合は settings の evaluation.reset）
 */

const KEY = 'evaluation.reset';

export type ResetTarget = { id: string; remove: string[]; add: string | null };
export type ResetState = {
  at: string;
  by: string;
  revoked: number;
  targets: ResetTarget[];
  done: number;
  failed: string[];
  finishedAt?: string;
  /** 朱印を戻したとき */
  undoneAt?: string;
};

export async function resetState(db: Db): Promise<ResetState | undefined> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  return row?.value as ResetState | undefined;
}

/** いちばん下の自動の役職（入鯖時の役職） */
export const baseRank = (ranks: readonly Rank[]) => autoRanks(ranks)[0];

/** 役職を戻す人（いちばん下より上の自動の役職を持っている人） */
export function demoteTargets(ranks: readonly Rank[], list: { id: string; roleIds: string[] }[]): ResetTarget[] {
  const base = baseRank(ranks);
  const upper = autoRanks(ranks).filter((r) => r.key !== base?.key && r.roleId !== base?.roleId);
  const out: ResetTarget[] = [];
  for (const m of list) {
    const remove = upper.filter((r) => m.roleIds.includes(r.roleId)).map((r) => r.roleId);
    if (!remove.length) continue;
    out.push({ id: m.id, remove, add: base && !m.roleIds.includes(base.roleId) ? base.roleId : null });
  }
  return out;
}

/** リセットを始める（もうしていれば already）。朱印はすぐ取り消し、役職は runDemotions で少しずつ */
export async function startEvaluationReset(db: Db, cfg: GuildConfig, by: string, now = new Date()): Promise<{ status: 'ok' | 'already'; state: ResetState }> {
  return db.transaction(async (tx) => {
    const [held] = await tx.select().from(settings).where(eq(settings.key, KEY)).for('update');
    if (held) return { status: 'already' as const, state: held.value as ResetState };
    const revoked = await tx.update(shuin).set({ revokedAt: now }).where(isNull(shuin.revokedAt)).returning({ g: shuin.giverId });
    const list = await tx.select({ id: members.id, roleIds: members.roleIds }).from(members).where(and(isNull(members.leftAt), eq(members.isBot, false)));
    const state: ResetState = { at: now.toISOString(), by, revoked: revoked.length, targets: demoteTargets(cfg.ranks, list), done: 0, failed: [] };
    await tx.insert(settings).values({ key: KEY, value: state, updatedBy: by, updatedAt: now });
    await audit(tx, { actorId: by, action: 'evaluation.reset', detail: { revoked: state.revoked, demote: state.targets.length }, via: 'web' });
    return { status: 'ok' as const, state };
  });
}

/** 役職の付け替えを少し進める（budget 人まで）。終わったら true */
export async function runDemotions(db: Db, cfg: GuildConfig, discord: Pick<DiscordActions, 'addRole' | 'removeRole'>, budget = 20, now = new Date()): Promise<boolean> {
  const st = await resetState(db);
  if (!st) return true;
  if (st.finishedAt) return true;
  const end = Math.min(st.targets.length, st.done + budget);
  const failed = [...st.failed];
  for (let i = st.done; i < end; i++) {
    const t = st.targets[i]!;
    try {
      if (t.add) await discord.addRole(cfg.guildId, t.id, t.add, '評価のリセット（役職をはじめに戻す）');
      for (const r of t.remove) await discord.removeRole(cfg.guildId, t.id, r, '評価のリセット（役職をはじめに戻す）');
      // BOT が同期するまでの間も、画面の役職が合うように
      const [m] = await db.select({ roleIds: members.roleIds }).from(members).where(eq(members.id, t.id));
      if (m) {
        const next = [...new Set([...m.roleIds, ...(t.add ? [t.add] : [])])].filter((r) => !t.remove.includes(r));
        await db.update(members).set({ roleIds: next }).where(eq(members.id, t.id));
      }
    } catch (err) {
      logger.warn({ err, memberId: t.id }, 'evaluation reset demote failed');
      failed.push(t.id);
    }
  }
  const next: ResetState = { ...st, done: end, failed, ...(end >= st.targets.length ? { finishedAt: now.toISOString() } : {}) };
  await db.update(settings).set({ value: next, updatedAt: now }).where(eq(settings.key, KEY));
  return Boolean(next.finishedAt);
}

/** 朱印だけ元に戻す（リセットで取り消した分。あとから押し直したものはそのまま）。役職は戻さない */
export async function undoShuinReset(db: Db, by: string, now = new Date()): Promise<number> {
  const st = await resetState(db);
  if (!st || st.undoneAt) return 0;
  const back = await db.update(shuin).set({ revokedAt: null }).where(eq(shuin.revokedAt, new Date(st.at))).returning({ g: shuin.giverId });
  await db.update(settings).set({ value: { ...st, undoneAt: now.toISOString() }, updatedAt: now }).where(eq(settings.key, KEY));
  await audit(db, { actorId: by, action: 'evaluation.reset_undo', detail: { restored: back.length }, via: 'web' });
  return back.length;
}

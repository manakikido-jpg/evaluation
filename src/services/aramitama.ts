import { and, count, eq, gte, isNotNull } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { invites, members, omairi } from '../db/schema.js';
import { startOmairi } from './applications.js';
import { emaPromotionEnabled } from './emaPromotion.js';
import { newSystemStartedAt } from './shuin.js';
import { newSystemRoles } from './ujikoKeep.js';

/**
 * 🔥 荒魂（評価落ち・新制度・本人の決定 2026-11-27）。
 * - お参り期間で氏子に届かなかった参拝者を、運営が判定カードで「荒魂にする」。
 * - 荒魂になってから招待した人が aramitamaInvites（3）人「1人」と数えられたら、BOT が参拝者に戻し、お参り期間を最初から始める（何度でも）。
 * - 荒魂のあいだ：絵馬（贈る・受け取る）・結び・キャストは使えない。
 * - ③④が済み、荒魂のロール ID が社務所Web に入っているときだけ使える。
 * 状態は omairi.status = 'aramitama'（decidedAt が荒魂になった時刻）。ロールの付け外しは呼ぶ側が行う。
 */

/** 荒魂のロール ID（③④が済み、ID が入っているときだけ。それ以外は null） */
export async function aramitamaRoleId(db: Db): Promise<string | null> {
  if (!(await newSystemStartedAt(db)) || !(await emaPromotionEnabled(db))) return null;
  return (await newSystemRoles(db)).aramitama ?? null;
}

/** 荒魂の人と、荒魂になった時刻 */
export async function aramitamaList(db: Db): Promise<{ memberId: string; since: Date }[]> {
  const rows = await db.select({ memberId: omairi.memberId, since: omairi.decidedAt }).from(omairi).where(and(eq(omairi.status, 'aramitama'), isNotNull(omairi.decidedAt)));
  return rows.map((r) => ({ memberId: r.memberId, since: r.since! }));
}

export type AramitamaProgress = { since: Date; invites: number; need: number };

/** 荒魂の人の進み具合（荒魂になってからの招待）。荒魂でなければ null */
export async function aramitamaProgress(db: Db, cfg: GuildConfig, memberId: string): Promise<AramitamaProgress | null> {
  const [row] = await db.select({ since: omairi.decidedAt }).from(omairi).where(and(eq(omairi.memberId, memberId), eq(omairi.status, 'aramitama')));
  if (!row?.since) return null;
  const [c] = await db.select({ n: count() }).from(invites).where(and(eq(invites.inviterId, memberId), gte(invites.qualifiedAt, row.since)));
  return { since: row.since, invites: Number(c?.n ?? 0), need: cfg.emaThresholds.aramitamaInvites };
}

/**
 * 招待がそろった荒魂を参拝者に戻す（お参り期間を最初から）。戻した人の ID を返す。
 * 退出した人は記録だけ片づける。
 */
export async function runAramitamaReturn(db: Db, cfg: GuildConfig, now: Date): Promise<string[]> {
  if (!(await aramitamaRoleId(db))) return [];
  const out: string[] = [];
  for (const a of await aramitamaList(db)) {
    const [m] = await db.select({ leftAt: members.leftAt }).from(members).where(eq(members.id, a.memberId));
    if (!m || m.leftAt) {
      await db.update(omairi).set({ status: 'removed', decidedBy: 'system', decidedAt: now }).where(and(eq(omairi.memberId, a.memberId), eq(omairi.status, 'aramitama')));
      continue;
    }
    const p = await aramitamaProgress(db, cfg, a.memberId);
    if (!p || p.invites < p.need) continue;
    await startOmairi(db, a.memberId, cfg.omairi.days, now);
    out.push(a.memberId);
  }
  return out;
}

import { and, desc, eq, gt, gte, isNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { boostTimeAttendance, boostTimes, type BoostTime } from '../db/schema.js';
import { deliverPresenceGift, requestPresenceGift, type PresenceGiftInput } from './presenceGifts.js';

/**
 * ⏱ 浮上の記録の時間（人が少ない時間帯の浮上をふやすため。社務所Web で日時を自由に決めて作る）。
 * - その間、BOT が 1 分ごとに通話にいる人（花びらがもらえる人と同じ: AFK・BOT はのぞく）へ 1 分ずつ足す
 * - 終わったら、決めた分以上いた人へ、銭・券をプレゼントできる（1 回の時間に 1 回だけ）
 */

export const BOOST_MAX_HOURS = 24;

export type BoostInput = { title: string; startAt: Date; endAt: Date; minMinutes: number };

export function validBoost(i: BoostInput): boolean {
  const len = i.endAt.getTime() - i.startAt.getTime();
  return !!i.title && i.title.length <= 60 && len > 0 && len <= BOOST_MAX_HOURS * 3_600_000 && Number.isInteger(i.minMinutes) && i.minMinutes >= 1 && i.minMinutes * 60_000 <= len;
}

export async function createBoost(db: Db, i: BoostInput, by: string): Promise<BoostTime | undefined> {
  if (!validBoost(i)) return undefined;
  const [row] = await db.insert(boostTimes).values({ ...i, createdBy: by }).returning();
  return row;
}

/** 時間・何分以上を直す（終わる前だけ） */
export async function updateBoost(db: Db, id: number, i: BoostInput, now: Date): Promise<BoostTime | undefined> {
  if (!validBoost(i)) return undefined;
  const [row] = await db.update(boostTimes).set(i).where(and(eq(boostTimes.id, id), isNull(boostTimes.canceledAt), gt(boostTimes.endAt, now))).returning();
  return row;
}

/** やめる（終わる前だけ。数えた分は残す） */
export async function cancelBoost(db: Db, id: number, now: Date): Promise<boolean> {
  const rows = await db.update(boostTimes).set({ canceledAt: now }).where(and(eq(boostTimes.id, id), isNull(boostTimes.canceledAt), gt(boostTimes.endAt, now))).returning({ id: boostTimes.id });
  return rows.length > 0;
}

export const listBoosts = (db: Db, limit = 50) => db.select().from(boostTimes).orderBy(desc(boostTimes.startAt)).limit(limit);
export const getBoost = async (db: Db, id: number) => (await db.select().from(boostTimes).where(eq(boostTimes.id, id)))[0];

/** いまの時間（やめたものはのぞく） */
export const activeBoosts = (db: Db, now: Date) =>
  db.select().from(boostTimes).where(and(isNull(boostTimes.canceledAt), lte(boostTimes.startAt, now), gt(boostTimes.endAt, now)));

/** 1 分ごと: いまの時間があれば、ids の人に 1 分ずつ足す。足した時間の数を返す */
export async function recordBoostTime(db: Db, ids: readonly string[], now: Date): Promise<number> {
  if (!ids.length) return 0;
  const list = await activeBoosts(db, now);
  for (const b of list) {
    await db
      .insert(boostTimeAttendance)
      .values([...new Set(ids)].map((memberId) => ({ boostId: b.id, memberId, minutes: 1, firstAt: now, lastAt: now })))
      .onConflictDoUpdate({ target: [boostTimeAttendance.boostId, boostTimeAttendance.memberId], set: { minutes: sql`${boostTimeAttendance.minutes} + 1`, lastAt: now } });
  }
  return list.length;
}

/** その時間にいた人（長くいた順） */
export const boostMembers = (db: Db, id: number) =>
  db.select().from(boostTimeAttendance).where(eq(boostTimeAttendance.boostId, id)).orderBy(desc(boostTimeAttendance.minutes), boostTimeAttendance.firstAt);

/** 決めた分以上いた人 */
export const boostQualified = (db: Db, b: Pick<BoostTime, 'id' | 'minMinutes'>) =>
  db.select().from(boostTimeAttendance).where(and(eq(boostTimeAttendance.boostId, b.id), gte(boostTimeAttendance.minutes, b.minMinutes)));

export type BoostGiftResult = { status: 'ok'; count: number } | { status: 'not_ended' | 'already' | 'none' | 'invalid' };

/**
 * 🎁 終わった時間の、決めた分以上いた人へプレゼント（1 回の時間に 1 回だけ。同時に押しても 1 回）。
 * 配った記録は「今いる人に配る」と同じ所に残る（回収もそこから）
 */
export async function giftBoost(db: Db, id: number, input: PresenceGiftInput, amount: number, note: string, by: string, now: Date): Promise<BoostGiftResult> {
  const b = await getBoost(db, id);
  if (!b) return { status: 'invalid' };
  if (b.endAt > now && !b.canceledAt) return { status: 'not_ended' };
  if (b.giftedAt) return { status: 'already' };
  const ids = (await boostQualified(db, b)).map((r) => r.memberId);
  if (!ids.length) return { status: 'none' };
  // 先に目印を付ける（付けられなければ、ほかの人が先に配った）
  const [mark] = await db.update(boostTimes).set({ giftedAt: now }).where(and(eq(boostTimes.id, id), isNull(boostTimes.giftedAt))).returning({ id: boostTimes.id });
  if (!mark) return { status: 'already' };
  const row = await requestPresenceGift(db, input, amount, note, by);
  if (!row) {
    await db.update(boostTimes).set({ giftedAt: null }).where(eq(boostTimes.id, id));
    return { status: 'invalid' };
  }
  const r = await deliverPresenceGift(db, row.id, ids, now);
  return { status: 'ok', count: r.status === 'ok' ? r.count : 0 };
}

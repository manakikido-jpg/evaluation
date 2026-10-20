import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { CoreTimeConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { coreTimeAttendance } from '../db/schema.js';
import { activeCoreTime, jstParts } from './coreTime.js';

/**
 * ⏰ コアタイムに通話に上がった人の記録。
 * - 毎分（BOT の 1 分ごとの仕事）、コアタイム中なら、通話にいる人（花びらがもらえる人と同じ: AFK・BOT などはのぞく）に 1 分ずつ足す
 * - 枠（日付と始まりの時刻）ごとに 1 人 1 行。はじめて来た時刻・最後にいた時刻も残す
 */

/** いまコアタイムなら、ids の人に 1 分ずつ足す。足した枠を返す */
export async function recordCoreTime(db: Db, ct: CoreTimeConfig, ids: readonly string[], now: Date): Promise<{ day: string; slot: string } | undefined> {
  const slot = activeCoreTime(ct, now);
  if (!slot || !ids.length) return undefined;
  const day = jstParts(now).date;
  const rows = [...new Set(ids)].map((memberId) => ({ day, slot: slot.start, memberId, minutes: 1, firstAt: now, lastAt: now }));
  await db
    .insert(coreTimeAttendance)
    .values(rows)
    .onConflictDoUpdate({
      target: [coreTimeAttendance.day, coreTimeAttendance.slot, coreTimeAttendance.memberId],
      set: { minutes: sql`${coreTimeAttendance.minutes} + 1`, lastAt: now },
    });
  return { day, slot: slot.start };
}

/** 最近のコアタイム（新しい順）: 来た人の数・合計の分 */
export async function coreTimeSessions(db: Db, sinceDay: string) {
  return db
    .select({ day: coreTimeAttendance.day, slot: coreTimeAttendance.slot, people: sql<number>`count(*)::int`, minutes: sql<number>`coalesce(sum(${coreTimeAttendance.minutes}), 0)::int` })
    .from(coreTimeAttendance)
    .where(gte(coreTimeAttendance.day, sinceDay))
    .groupBy(coreTimeAttendance.day, coreTimeAttendance.slot)
    .orderBy(desc(coreTimeAttendance.day), desc(coreTimeAttendance.slot));
}

/** 1 回のコアタイムに来た人（長くいた順） */
export async function coreTimeMembers(db: Db, day: string, slot: string) {
  return db
    .select()
    .from(coreTimeAttendance)
    .where(and(eq(coreTimeAttendance.day, day), eq(coreTimeAttendance.slot, slot)))
    .orderBy(desc(coreTimeAttendance.minutes), coreTimeAttendance.firstAt);
}

/** よく来る人（その日から）: 来た回数・合計の分・最後に来た日。minMinutes 分より短い回は数えない */
export async function coreTimeRegulars(db: Db, sinceDay: string, minMinutes = 1) {
  return db
    .select({
      memberId: coreTimeAttendance.memberId,
      times: sql<number>`count(*)::int`,
      minutes: sql<number>`coalesce(sum(${coreTimeAttendance.minutes}), 0)::int`,
      lastDay: sql<string>`max(${coreTimeAttendance.day})`,
    })
    .from(coreTimeAttendance)
    .where(and(gte(coreTimeAttendance.day, sinceDay), gte(coreTimeAttendance.minutes, minMinutes)))
    .groupBy(coreTimeAttendance.memberId)
    .orderBy(desc(sql`count(*)`), desc(sql`sum(${coreTimeAttendance.minutes})`));
}

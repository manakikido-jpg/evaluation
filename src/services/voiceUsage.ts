import { and, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { coinTx, tempVoice, voiceChannels, voicePairs, voiceUsage } from '../db/schema.js';
import { jstDate } from './activity.js';

/**
 * 通話の記録（浮上時間の管理）。1 分ごとに、
 * - だれがどの通話に何分いたか（日ごと）
 * - だれとだれが同じ通話に何分いたか（日ごと）
 * - 通話チャンネルの名前・カテゴリ（自分の通話部屋は作った人・種類も。消えたあとも見られるように）
 * を足していく。社務所Web の「通話の記録」とメンバーのページで見る。
 */

export type PresenceChannel = { id: string; name: string; categoryId: string | null; categoryName: string | null; memberIds: string[] };

/** 1 つの通話で組み合わせを数える上限（人が多すぎると組み合わせが増えすぎるため） */
const PAIR_MAX_MEMBERS = 25;
const DAY = 86_400_000;

export const sinceDate = (now: Date, days: number) => jstDate(new Date(now.getTime() - (days - 1) * DAY));

export async function recordPresence(db: Db, channels: PresenceChannel[], now = new Date()): Promise<void> {
  const date = jstDate(now);
  const active = channels.map((c) => ({ ...c, memberIds: [...new Set(c.memberIds)] })).filter((c) => c.memberIds.length);
  if (!active.length) return;
  const rooms = await db.select().from(tempVoice).where(inArray(tempVoice.channelId, active.map((c) => c.id)));
  for (const c of active) {
    const room = rooms.find((r) => r.channelId === c.id);
    const info = {
      name: c.name,
      categoryId: c.categoryId,
      categoryName: c.categoryName,
      ...(room ? { hubId: room.hubId, ownerId: room.ownerId, kind: room.kind } : {}),
      lastSeen: now,
    };
    await db
      .insert(voiceChannels)
      .values({ channelId: c.id, ...info, firstSeen: now })
      .onConflictDoUpdate({ target: voiceChannels.channelId, set: info });
  }
  await db
    .insert(voiceUsage)
    .values(active.flatMap((c) => c.memberIds.map((memberId) => ({ memberId, date, channelId: c.id, minutes: 1 }))))
    .onConflictDoUpdate({ target: [voiceUsage.memberId, voiceUsage.date, voiceUsage.channelId], set: { minutes: sql`${voiceUsage.minutes} + 1` } });
  const pairs: { memberA: string; memberB: string; date: string; minutes: number }[] = [];
  for (const c of active) {
    const ids = [...c.memberIds].sort().slice(0, PAIR_MAX_MEMBERS);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairs.push({ memberA: ids[i]!, memberB: ids[j]!, date, minutes: 1 });
  }
  if (pairs.length) {
    await db
      .insert(voicePairs)
      .values(pairs)
      .onConflictDoUpdate({ target: [voicePairs.memberA, voicePairs.memberB, voicePairs.date], set: { minutes: sql`${voicePairs.minutes} + 1` } });
  }
}

export type CategoryMinutes = { categoryId: string | null; categoryName: string; minutes: number };
export type MemberUsage = { memberId: string; total: number; byCategory: CategoryMinutes[] };

/** 期間の中の、人ごと・カテゴリごとの分（多い順） */
export async function usageByMember(db: Db, since: string): Promise<MemberUsage[]> {
  const rows = await db
    .select({
      memberId: voiceUsage.memberId,
      categoryId: voiceChannels.categoryId,
      categoryName: sql<string>`coalesce(max(${voiceChannels.categoryName}), 'カテゴリなし')`,
      minutes: sql<number>`sum(${voiceUsage.minutes})::int`,
    })
    .from(voiceUsage)
    .leftJoin(voiceChannels, eq(voiceChannels.channelId, voiceUsage.channelId))
    .where(gte(voiceUsage.date, since))
    .groupBy(voiceUsage.memberId, voiceChannels.categoryId);
  const by = new Map<string, MemberUsage>();
  for (const r of rows) {
    const m = by.get(r.memberId) ?? { memberId: r.memberId, total: 0, byCategory: [] };
    m.total += r.minutes;
    m.byCategory.push({ categoryId: r.categoryId, categoryName: r.categoryName, minutes: r.minutes });
    by.set(r.memberId, m);
  }
  for (const m of by.values()) m.byCategory.sort((a, b) => b.minutes - a.minutes);
  return [...by.values()].sort((a, b) => b.total - a.total);
}

/** 期間の中のカテゴリごとの合計（多い順） */
export async function usageByCategory(db: Db, since: string): Promise<CategoryMinutes[]> {
  const rows = await db
    .select({
      categoryId: voiceChannels.categoryId,
      categoryName: sql<string>`coalesce(max(${voiceChannels.categoryName}), 'カテゴリなし')`,
      minutes: sql<number>`sum(${voiceUsage.minutes})::int`,
    })
    .from(voiceUsage)
    .leftJoin(voiceChannels, eq(voiceChannels.channelId, voiceUsage.channelId))
    .where(gte(voiceUsage.date, since))
    .groupBy(voiceChannels.categoryId);
  return rows.sort((a, b) => b.minutes - a.minutes);
}

/** その人と同じ通話にいた時間が長い人 */
export async function partnersOf(db: Db, memberId: string, since: string, limit = 10): Promise<{ memberId: string; minutes: number }[]> {
  const sum = sql<number>`sum(${voicePairs.minutes})::int`;
  const [asA, asB] = await Promise.all([
    db
      .select({ other: voicePairs.memberB, minutes: sum })
      .from(voicePairs)
      .where(and(gte(voicePairs.date, since), eq(voicePairs.memberA, memberId)))
      .groupBy(voicePairs.memberB),
    db
      .select({ other: voicePairs.memberA, minutes: sum })
      .from(voicePairs)
      .where(and(gte(voicePairs.date, since), eq(voicePairs.memberB, memberId)))
      .groupBy(voicePairs.memberA),
  ]);
  const by = new Map<string, number>();
  for (const r of [...asA, ...asB]) by.set(r.other, (by.get(r.other) ?? 0) + r.minutes);
  return [...by.entries()]
    .map(([id, minutes]) => ({ memberId: id, minutes }))
    .sort((a, b) => b.minutes - a.minutes || (a.memberId < b.memberId ? -1 : 1))
    .slice(0, limit);
}

/** その人の、通話ごとの分（自分の通話部屋は種類も） */
export async function channelsOf(db: Db, memberId: string, since: string, limit = 15) {
  return db
    .select({
      channelId: voiceUsage.channelId,
      name: sql<string>`coalesce(max(${voiceChannels.name}), '（消えた通話）')`,
      categoryName: sql<string | null>`max(${voiceChannels.categoryName})`,
      hubId: sql<string | null>`max(${voiceChannels.hubId})`,
      kind: sql<string | null>`max(${voiceChannels.kind})`,
      minutes: sql<number>`sum(${voiceUsage.minutes})::int`,
    })
    .from(voiceUsage)
    .leftJoin(voiceChannels, eq(voiceChannels.channelId, voiceUsage.channelId))
    .where(and(eq(voiceUsage.memberId, memberId), gte(voiceUsage.date, since)))
    .groupBy(voiceUsage.channelId)
    .orderBy(desc(sql`sum(${voiceUsage.minutes})`))
    .limit(limit);
}

/** 自分の通話部屋（宿坊・宵宮など）の記録: 作った人・種類・ひらいていた時間・のべ時間・払われた花びら */
export async function roomHistory(db: Db, since: Date, limit = 100) {
  const rooms = await db
    .select()
    .from(voiceChannels)
    .where(and(isNotNull(voiceChannels.hubId), gte(voiceChannels.lastSeen, since)))
    .orderBy(desc(voiceChannels.firstSeen))
    .limit(limit);
  if (!rooms.length) return [];
  const ids = rooms.map((r) => r.channelId);
  const usage = await db
    .select({ channelId: voiceUsage.channelId, minutes: sql<number>`sum(${voiceUsage.minutes})::int`, people: sql<number>`count(distinct ${voiceUsage.memberId})::int` })
    .from(voiceUsage)
    .where(inArray(voiceUsage.channelId, ids))
    .groupBy(voiceUsage.channelId);
  const paid = await db
    .select({ channelId: sql<string>`${coinTx.detail}->>'channelId'`, amount: sql<number>`sum(-${coinTx.amount})::int` })
    .from(coinTx)
    .where(and(eq(coinTx.reason, 'room'), inArray(sql`${coinTx.detail}->>'channelId'`, ids)))
    .groupBy(sql`${coinTx.detail}->>'channelId'`);
  return rooms.map((r) => {
    const u = usage.find((x) => x.channelId === r.channelId);
    return { ...r, personMinutes: u?.minutes ?? 0, people: u?.people ?? 0, paid: paid.find((p) => p.channelId === r.channelId)?.amount ?? 0 };
  });
}

/** 期間の中で、いっしょにいた時間が長い 2 人 */
export async function topPairs(db: Db, since: string, limit = 20): Promise<{ memberA: string; memberB: string; minutes: number }[]> {
  return db
    .select({ memberA: voicePairs.memberA, memberB: voicePairs.memberB, minutes: sql<number>`sum(${voicePairs.minutes})::int` })
    .from(voicePairs)
    .where(gte(voicePairs.date, since))
    .groupBy(voicePairs.memberA, voicePairs.memberB)
    .orderBy(desc(sql`sum(${voicePairs.minutes})`))
    .limit(limit);
}

/** 「12時間34分」 */
export function fmtMinutes(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return h ? `${h}時間${min ? `${min}分` : ''}` : `${min}分`;
}

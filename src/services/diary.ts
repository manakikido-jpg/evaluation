import { and, eq, isNotNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { diaries } from '../db/schema.js';
import { spendWithin } from './economy.js';
import { audit } from './audit.js';

export type DiaryMode = 'owner' | 'everyone';
export const DIARY_PRICE = 500;
export const DIARY_DAYS = 14;
export type DiaryPlan = { price: number; days: number };
const DAY = 86_400_000;
const PLAN: DiaryPlan = { price: DIARY_PRICE, days: DIARY_DAYS };
/** 使えるか（期限なしで買った人はずっと） */
export const diaryActive = (d: { paidUntil: Date | null }, now = new Date()) => d.paidUntil === null || d.paidUntil > now;
export const diaryOf = async (db: Db, memberId: string) => (await db.select().from(diaries).where(eq(diaries.memberId, memberId)))[0];
export const diaryForThread = async (db: Db, threadId: string) => (await db.select().from(diaries).where(eq(diaries.threadId, threadId)))[0];
const lock = (tx: Db, memberId: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'diary:' + memberId}))`);
/**
 * 日記の権利を受ける（2 週間ごとに自動で更新）。銭と権利を一緒に保存し、押し直しでは支払わない。
 * 期限が切れた人が押すと、そこからまた 2 週間（自動更新もオンに戻す）
 */
export async function buyDiary(db: Db, memberId: string, plan: DiaryPlan = PLAN, now = new Date()): Promise<'ok' | 'owned' | 'poor'> {
  return db.transaction(async tx => {
    await lock(tx, memberId);
    const d = await diaryOf(tx, memberId);
    if (d && diaryActive(d, now)) return 'owned';
    if (!await spendWithin(tx, memberId, plan.price, 'shop', { item: 'diary_right', days: plan.days })) return 'poor';
    const paidUntil = new Date(now.getTime() + plan.days * DAY);
    if (d) await tx.update(diaries).set({ paidUntil, autoRenew: true, lockedAt: null }).where(eq(diaries.memberId, memberId));
    else await tx.insert(diaries).values({ memberId, paidUntil });
    await audit(tx, { actorId: memberId, action: d ? 'diary.resume' : 'diary.buy', detail: { price: plan.price, days: plan.days }, via: 'discord' });
    return 'ok';
  });
}

/** 自動更新を止める・また始める（止めても、今の期限までは使える） */
export async function setDiaryAutoRenew(db: Db, memberId: string, on: boolean): Promise<boolean> {
  const [row] = await db.update(diaries).set({ autoRenew: on }).where(and(eq(diaries.memberId, memberId), isNotNull(diaries.paidUntil))).returning();
  return Boolean(row);
}

export type DiaryTick = {
  /** 明日更新する（DM で知らせる） */
  remind: { memberId: string; paidUntil: Date }[];
  /** 自動で払って更新した */
  renewed: { memberId: string; threadId: string | null; paidUntil: Date; wasLocked: boolean }[];
  /** 払えなかった・止めていた: 日記に鍵をかける */
  expired: { memberId: string; threadId: string | null; reason: 'poor' | 'stopped' }[];
};

/** 1 分ごと: 前の日の知らせ・自動更新・期限切れ */
export async function diaryTick(db: Db, plan: DiaryPlan = PLAN, now = new Date()): Promise<DiaryTick> {
  const out: DiaryTick = { remind: [], renewed: [], expired: [] };
  const tomorrow = new Date(now.getTime() + DAY);
  for (const d of await db.select().from(diaries).where(and(isNotNull(diaries.paidUntil), lte(diaries.paidUntil, tomorrow)))) {
    const until = d.paidUntil!;
    if (until > now) {
      if (d.autoRenew && (!d.remindedFor || d.remindedFor.getTime() !== until.getTime())) {
        const [row] = await db.update(diaries).set({ remindedFor: until }).where(eq(diaries.memberId, d.memberId)).returning();
        if (row) out.remind.push({ memberId: d.memberId, paidUntil: until });
      }
      continue;
    }
    if (d.lockedAt) continue;
    const r = await db.transaction(async tx => {
      await lock(tx, d.memberId);
      const cur = await diaryOf(tx, d.memberId);
      if (!cur || !cur.paidUntil || cur.paidUntil > now || cur.lockedAt) return undefined;
      if (cur.autoRenew && await spendWithin(tx, d.memberId, plan.price, 'shop', { item: 'diary_right', renew: true, days: plan.days })) {
        // 期限の続きから（遅れて払っても、期間は減らない）
        const paidUntil = new Date(Math.max(cur.paidUntil.getTime(), now.getTime() - DAY) + plan.days * DAY);
        await tx.update(diaries).set({ paidUntil }).where(eq(diaries.memberId, d.memberId));
        await audit(tx, { actorId: 'system', targetId: d.memberId, action: 'diary.renew', detail: { price: plan.price }, via: 'system' });
        return { kind: 'renewed' as const, paidUntil };
      }
      await tx.update(diaries).set({ lockedAt: now }).where(eq(diaries.memberId, d.memberId));
      return { kind: 'expired' as const, reason: cur.autoRenew ? ('poor' as const) : ('stopped' as const) };
    });
    if (r?.kind === 'renewed') out.renewed.push({ memberId: d.memberId, threadId: d.threadId, paidUntil: r.paidUntil, wasLocked: false });
    if (r?.kind === 'expired') out.expired.push({ memberId: d.memberId, threadId: d.threadId, reason: r.reason });
  }
  return out;
}
/** Discord作成も同じロックの中で行い、同時押しで日記を増やさない。失敗しても権利は残る。 */
export async function createDiary(db: Db, memberId: string, mode: DiaryMode, create: () => Promise<string>, now = new Date()): Promise<{ status: 'ok' | 'exists'; threadId: string } | { status: 'no_right' }> {
  return db.transaction(async tx => {
    await lock(tx, memberId);
    const d = await diaryOf(tx, memberId);
    if (!d || !diaryActive(d, now)) return { status: 'no_right' as const };
    if (d.threadId) return { status: 'exists' as const, threadId: d.threadId };
    const threadId = await create();
    await tx.update(diaries).set({ threadId, mode }).where(eq(diaries.memberId, memberId));
    await audit(tx, { actorId: memberId, action: 'diary.create', detail: { threadId, mode }, via: 'discord' });
    return { status: 'ok' as const, threadId };
  });
}
export async function changeDiaryMode(db: Db, memberId: string, threadId: string, mode: DiaryMode): Promise<boolean> {
  return db.transaction(async tx => {
    await lock(tx, memberId);
    const d = await diaryOf(tx, memberId);
    if (!d || d.threadId !== threadId) return false;
    await tx.update(diaries).set({ mode }).where(eq(diaries.memberId, memberId));
    await audit(tx, { actorId: memberId, action: 'diary.mode', detail: { threadId, mode }, via: 'discord' });
    return true;
  });
}
/** スレッドが削除されたら権利を残して作り直せるようにする。 */
export async function clearDiaryThread(db: Db, threadId: string) {
  await db.update(diaries).set({ threadId: null }).where(eq(diaries.threadId, threadId));
}
export const mayPostDiary = (d: { memberId: string; mode: DiaryMode }, authorId: string, botId: string) => d.mode === 'everyone' || authorId === d.memberId || authorId === botId;

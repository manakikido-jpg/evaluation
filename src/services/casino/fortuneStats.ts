import { and, count, desc, gte, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { fortuneRounds, fortuneScratch } from '../../db/schema.js';
import { jstDay } from './fortune.js';

export const SCRATCH_PERIODS = { today: '今日', '7d': '直近7日', '30d': '直近30日', all: '全期間' } as const;
export type ScratchPeriod = keyof typeof SCRATCH_PERIODS;
export const scratchPeriod = (value: unknown): ScratchPeriod => typeof value === 'string' && Object.hasOwn(SCRATCH_PERIODS, value) ? value as ScratchPeriod : '30d';
export function scratchPeriodStart(period: ScratchPeriod, now: Date): Date | undefined {
  if (period === 'all') return undefined;
  const start = new Date(jstDay(now) + 'T00:00:00+09:00');
  start.setTime(start.getTime() - (period === '7d' ? 6 : period === '30d' ? 29 : 0) * 86400000);
  return start;
}
/** 購入は購入日、払戻は開封日。未開封の結果を返さない読み取り専用の集計。 */
export async function scratchFinances(db: Db, period: ScratchPeriod, now = new Date()) {
  const start = scratchPeriodStart(period, now), t = fortuneScratch;
  const purchased = and(lte(t.createdAt, now), start ? gte(t.createdAt, start) : undefined)!;
  const opened = and(isNotNull(t.openedAt), lte(t.openedAt, now), start ? gte(t.openedAt, start) : undefined)!;
  return db.transaction(async tx => {
    const [sales, paid, pending, prizes, recent] = await Promise.all([
      tx.select({ count: count(), amount: sql<string>`coalesce(sum(${t.price}), 0)` }).from(t).where(purchased),
      tx.select({ count: count(), basis: sql<string>`coalesce(sum(${t.price}), 0)`, amount: sql<string>`coalesce(sum(${t.payout}), 0)`, wins: sql<number>`count(*) filter (where ${t.payout} > 0)::int` }).from(t).where(opened),
      tx.select({ count: count() }).from(t).where(and(isNull(t.openedAt), lte(t.createdAt, now))),
      tx.select({ multiplier: sql<string>`${t.payout}::numeric / ${t.price}`, count: count(), amount: sql<string>`sum(${t.payout})`, min: sql<number>`min(${t.payout})`, max: sql<number>`max(${t.payout})` }).from(t).where(opened).groupBy(sql`${t.payout}::numeric / ${t.price}`),
      tx.select({ price: t.price, payout: t.payout, openedAt: t.openedAt }).from(t).where(and(opened, sql`${t.payout} > 0`)).orderBy(desc(t.openedAt), desc(t.id)).limit(20),
    ]);
    const revenue = Number(sales[0]!.amount), payout = Number(paid[0]!.amount), settledSales = Number(paid[0]!.basis);
    return { period, start, end: now, sold: sales[0]!.count, revenue, opened: paid[0]!.count, wins: paid[0]!.wins, payout, cashNet: revenue - payout, settledSales, settledNet: settledSales - payout, returnPct: settledSales ? payout / settledSales * 100 : null, pending: pending[0]!.count, prizes: prizes.map(p => ({ ...p, multiplier: Number(p.multiplier), amount: Number(p.amount) })), recent };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
export type ScratchFinances = Awaited<ReturnType<typeof scratchFinances>>;

/** 🎫 週末宝くじの、抽選が終わった回（新しい順。社務所の宝くじタブ） */
export const recentLotteryRounds = (db: Db, now = new Date(), limit = 12) =>
  db.select().from(fortuneRounds).where(and(isNotNull(fortuneRounds.settledAt), lte(fortuneRounds.drawAt, now))).orderBy(desc(fortuneRounds.drawAt)).limit(limit);

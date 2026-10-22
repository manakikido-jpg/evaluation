import { randomInt } from 'node:crypto';
import { and, asc, count, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { fortuneGamesSchema, type FortuneGamesConfig } from '../../config.js';
import type { Db } from '../../db/client.js';
import { fortuneRounds, fortuneScratch, fortuneTickets } from '../../db/schema.js';
import { addCoins, spendWithin, walletOf } from '../economy.js';

const nonce = z.string().uuid();
const lock = (tx: Db, key: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
export const SCRATCH_PRIZES = [
  { multiplier: 0, weight: 5500, symbol: '―' },
  { multiplier: 1, weight: 3000, symbol: '🌸' },
  { multiplier: 2, weight: 1200, symbol: '🍃' },
  { multiplier: 5, weight: 250, symbol: '⛩' },
  { multiplier: 10, weight: 50, symbol: '✨' },
] as const;
export const LOTTERY_TOTAL_LIMIT = 100000;
export const jstDay = (now: Date) => new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
/** 日曜21時JST（UTC日曜12時）。締切ぴったりなら次の週。 */
export function nextLotteryDraw(now: Date): Date {
  const next = new Date(now);
  next.setUTCHours(12, 0, 0, 0);
  next.setUTCDate(next.getUTCDate() + (7 - next.getUTCDay()) % 7);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 7);
  return next;
}
const choose = (max: number, pick: (max: number) => number) => {
  const n = pick(max);
  if (!Number.isInteger(n) || n < 0 || n >= max) throw Error('抽選をやり直してください。');
  return n;
};
export class FortuneError extends Error {}
export const fortuneErrorMessage = (err: unknown) => err instanceof FortuneError ? err.message : '処理の結果を確認できませんでした。履歴を確認して、同じ券からやり直してください。';
const fail = (message: string): never => { throw new FortuneError(message); };
const validNonce = (id: string) => nonce.safeParse(id).success || fail('購入番号を確認してください。画面を開き直してください。');
export type LotteryTier = { name: string; count: number; pct: number };
/** その回の等（前の回は 1 等 1 本に全額） */
export const roundTiers = (r: { tiers?: LotteryTier[] | null }): LotteryTier[] => r.tiers?.length ? r.tiers : [{ name: '1等', count: 1, pct: 100 }];
/** 等ごとの、1 本あたりの賞金（今の売上で計算。端数は切り捨て） */
export const tierPrizes = (r: Parameters<typeof projectedPrize>[0] & { tiers?: LotteryTier[] | null }) => {
  const pool = projectedPrize(r);
  return roundTiers(r).map((t) => ({ ...t, each: Math.floor((pool * t.pct) / 100 / t.count) }));
};
export const projectedPrize = (r: { price: number; sold: number; returnPct: number; bonus: number }) => r.sold ? Math.floor(r.price * r.sold * r.returnPct / 100) + r.bonus : 0;

export async function buyScratch(db: Db, memberId: string, id: string, raw: FortuneGamesConfig, clock = () => new Date(), pick = randomInt) {
  validNonce(id);
  const cfg = fortuneGamesSchema.parse(raw);
  return db.transaction(async tx => {
    await lock(tx, `scratch:${memberId}`);
    const [same] = await tx.select().from(fortuneScratch).where(eq(fortuneScratch.id, id));
    if (same) return same.memberId === memberId ? same.id : fail('この購入番号は使えません。');
    if (!cfg.enabled) return fail('いまはお休み中です。');
    // 通信が切れた券を先に開く。別の購入番号でも、未開封を増やさない。
    const [pending] = await tx.select().from(fortuneScratch).where(and(eq(fortuneScratch.memberId, memberId), isNull(fortuneScratch.openedAt)));
    if (pending) return pending.id;
    const now = clock(), day = jstDay(now);
    const [used] = await tx.select({ n: count() }).from(fortuneScratch).where(and(eq(fortuneScratch.memberId, memberId), eq(fortuneScratch.day, day)));
    if (used!.n >= cfg.scratchDailyLimit) return fail('今日の購入上限に達しました。');
    if (!await spendWithin(tx, memberId, cfg.scratchPrice, 'scratch_buy', { ticketId: id })) return fail('銭が足りません。');
    let draw = choose(10000, pick), mult = 0;
    for (const prize of SCRATCH_PRIZES) { if (draw < prize.weight) { mult = prize.multiplier; break; } draw -= prize.weight; }
    await tx.insert(fortuneScratch).values({ id, memberId, day, price: cfg.scratchPrice, payout: cfg.scratchPrice * mult, createdAt: now });
    return id;
  });
}
export async function revealScratch(db: Db, memberId: string, id: string, clock = () => new Date()) {
  validNonce(id);
  return db.transaction(async tx => {
    await lock(tx, `scratch:${memberId}`);
    const [ticket] = await tx.select().from(fortuneScratch).where(and(eq(fortuneScratch.id, id), eq(fortuneScratch.memberId, memberId)));
    if (!ticket) return fail('この券は見つかりません。');
    if (!ticket.openedAt) {
      if (ticket.payout > 0) await addCoins(tx, memberId, ticket.payout, 'scratch_prize', { ticketId: id });
      await tx.update(fortuneScratch).set({ openedAt: clock() }).where(eq(fortuneScratch.id, id));
    }
    const multiplier = ticket.payout / ticket.price;
    return { payout: ticket.payout, multiplier, symbols: multiplier ? Array(3).fill(SCRATCH_PRIZES.find(p => p.multiplier === multiplier)!.symbol) as string[] : ['🌸', '🍃', '⛩'], balance: (await walletOf(tx, memberId)).balance };
  });
}
export async function ensureLotteryRound(db: Db, raw: FortuneGamesConfig, now = new Date()) {
  const cfg = fortuneGamesSchema.parse(raw), drawAt = nextLotteryDraw(now), id = drawAt.toISOString();
  if (!cfg.enabled) return (await db.select().from(fortuneRounds).where(eq(fortuneRounds.id, id)))[0];
  await db.insert(fortuneRounds).values({ id, drawAt, price: cfg.lotteryPrice, perMember: cfg.lotteryLimit, returnPct: cfg.lotteryReturnPct, bonus: cfg.lotteryBonus, tiers: cfg.lotteryTiers }).onConflictDoNothing();
  return (await db.select().from(fortuneRounds).where(eq(fortuneRounds.id, id)))[0]!;
}
export async function buyLottery(db: Db, memberId: string, id: string, roundId: string, raw: FortuneGamesConfig, clock = () => new Date()) {
  validNonce(id);
  const cfg = fortuneGamesSchema.parse(raw);
  return db.transaction(async tx => {
    await lock(tx, `lottery:${roundId}`);
    const [same] = await tx.select().from(fortuneTickets).where(eq(fortuneTickets.id, id));
    if (same) return same.memberId === memberId && same.roundId === roundId ? same : fail('この購入番号は使えません。');
    if (!cfg.enabled) return fail('いまはお休み中です。');
    const [round] = await tx.select().from(fortuneRounds).where(eq(fortuneRounds.id, roundId));
    if (!round || round.settledAt || clock() >= round.drawAt) return fail('この回の販売は終わりました。画面を開き直してください。');
    const [used] = await tx.select({ n: count() }).from(fortuneTickets).where(and(eq(fortuneTickets.roundId, roundId), eq(fortuneTickets.memberId, memberId)));
    if (used!.n >= round.perMember) return fail('この回の購入上限に達しました。');
    if (round.sold >= LOTTERY_TOTAL_LIMIT) return fail('この回は売り切れました。');
    if (!await spendWithin(tx, memberId, round.price, 'lottery_buy', { ticketId: id, roundId })) return fail('銭が足りません。');
    const [ticket] = await tx.insert(fortuneTickets).values({ id, memberId, roundId, number: round.sold + 1, createdAt: clock() }).returning();
    await tx.update(fortuneRounds).set({ sold: round.sold + 1 }).where(eq(fortuneRounds.id, roundId));
    return ticket!;
  });
}
/** 期限が来た回を、停止中も精算。抽選結果と入金を同じトランザクションで保存する。 */
export async function settleLotteries(db: Db, now = new Date(), pick = randomInt) {
  const due = await db.select({ id: fortuneRounds.id }).from(fortuneRounds).where(and(isNull(fortuneRounds.settledAt), lte(fortuneRounds.drawAt, now))).orderBy(asc(fortuneRounds.drawAt)).limit(20);
  for (const { id } of due) await db.transaction(async tx => {
    await lock(tx, `lottery:${id}`);
    const [r] = await tx.select().from(fortuneRounds).where(eq(fortuneRounds.id, id));
    if (!r || r.settledAt || r.drawAt > now) return;
    let winnerId: string | null = null, winningNumber: number | null = null, payout = 0;
    const winners: { tier: string; number: number; memberId: string; payout: number }[] = [];
    if (r.sold) {
      // 等の順に、まだ当たっていない券から引く（1 枚の券は 1 回だけ当たる。券が足りなければ、残りの等は出ない）
      const left = Array.from({ length: r.sold }, (_, k) => k + 1);
      for (const t of tierPrizes(r)) {
        for (let k = 0; k < t.count && left.length; k++) {
          const number = left.splice(choose(left.length, pick), 1)[0]!;
          const [ticket] = await tx.select().from(fortuneTickets).where(and(eq(fortuneTickets.roundId, id), eq(fortuneTickets.number, number)));
          if (!ticket) throw Error('宝くじの券と販売枚数が一致しません。');
          if (t.each > 0) await addCoins(tx, ticket.memberId, t.each, 'lottery_prize', { roundId: id, winningNumber: number, tier: t.name });
          winners.push({ tier: t.name, number, memberId: ticket.memberId, payout: t.each });
          payout += t.each;
        }
      }
      winnerId = winners[0]?.memberId ?? null; winningNumber = winners[0]?.number ?? null;
    }
    await tx.update(fortuneRounds).set({ winnerId, winningNumber, payout, winners, settledAt: now }).where(eq(fortuneRounds.id, id));
  });
}
export async function fortuneState(db: Db, memberId: string, cfg: FortuneGamesConfig, now = new Date()) {
  const round = await ensureLotteryRound(db, cfg, now);
  const [scratches, tickets, rounds, used] = await Promise.all([
    db.select().from(fortuneScratch).where(eq(fortuneScratch.memberId, memberId)).orderBy(desc(fortuneScratch.createdAt)).limit(20),
    db.select().from(fortuneTickets).where(eq(fortuneTickets.memberId, memberId)).orderBy(desc(fortuneTickets.createdAt)).limit(100),
    db.select().from(fortuneRounds).where(lte(fortuneRounds.drawAt, now)).orderBy(desc(fortuneRounds.drawAt)).limit(8),
    db.select({ n: count() }).from(fortuneScratch).where(and(eq(fortuneScratch.memberId, memberId), eq(fortuneScratch.day, jstDay(now)))),
  ]);
  return { round, scratches: scratches.map(t => ({ ...t, payout: t.openedAt ? t.payout : null })), tickets, rounds, dailyUsed: used[0]!.n };
}

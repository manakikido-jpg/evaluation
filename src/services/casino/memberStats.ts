import { and, desc, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { casinoGames, coinTx, type CasinoGameRow } from '../../db/schema.js';
import { jstDate } from '../activity.js';
import { casinoStats, type CasinoStat } from './casino.js';
import { HOUSE_BOT_ID } from './tables/bots.js';

/**
 * 📊 カジノの記録（メンバーが見る）: 自分の成績・勝ち額ランキング・ゲームの人気・大当たり。
 * 勝ち負けは銭の出入り（賭けた・戻った・返金・卓への持ち込みと持ち帰り）で数える。どのゲームも同じ数え方。日付は日本時間
 */

const DAY = 86_400_000;
/** カジノの勝ち負けに数える銭の出入り */
export const CASINO_REASONS = ['casino_bet', 'casino_win', 'casino_refund', 'casino_buyin', 'casino_cashout', 'casino_hold'] as const;
const inCasino = inArray(coinTx.reason, [...CASINO_REASONS]);
const jstDay = sql<string>`to_char(${coinTx.at} + interval '9 hours', 'YYYY-MM-DD')`;

export type RankRange = 'today' | 'week' | 'month';
export const RANK_RANGES: Record<RankRange, string> = { today: '今日', week: '今週', month: '今月' };

/** 期間の始まり（日本時間。週は月曜から） */
export function rangeStart(range: RankRange, now = new Date()): Date {
  const today = jstDate(now);
  if (range === 'month') return new Date(`${today.slice(0, 8)}01T00:00:00+09:00`);
  const start = new Date(`${today}T00:00:00+09:00`);
  if (range === 'today') return start;
  const dow = new Date(`${today}T12:00:00+09:00`).getUTCDay(); // 0 = 日
  return new Date(start.getTime() - ((dow + 6) % 7) * DAY);
}

export type MyDay = { date: string; net: number; wagered: number };

/** 自分の日ごとの勝ち負け・賭けた量（days 日分。遊ばなかった日も 0 で入れる） */
export async function myDaily(db: Db, memberId: string, days: number, now = new Date()): Promise<MyDay[]> {
  const first = new Date(`${jstDate(new Date(now.getTime() - (days - 1) * DAY))}T00:00:00+09:00`);
  const rows = await db
    .select({
      date: jstDay,
      net: sql<number>`coalesce(sum(${coinTx.amount}), 0)::bigint`,
      wagered: sql<number>`coalesce(-sum(${coinTx.amount}) filter (where ${coinTx.reason} = 'casino_bet'), 0)::bigint`,
    })
    .from(coinTx)
    .where(and(eq(coinTx.memberId, memberId), inCasino, gte(coinTx.at, first)))
    .groupBy(jstDay);
  const by = new Map(rows.map((r) => [r.date, r]));
  return Array.from({ length: days }, (_, i) => {
    const date = jstDate(new Date(first.getTime() + i * DAY + 12 * 3_600_000));
    const r = by.get(date);
    return { date, net: Number(r?.net ?? 0), wagered: Number(r?.wagered ?? 0) };
  });
}

export type MyGame = { game: string; net: number; wagered: number; plays: number };

/** 自分のゲームごとの勝ち負け（since から。勝ち負けの大きい順） */
export async function myByGame(db: Db, memberId: string, since: Date): Promise<MyGame[]> {
  const game = sql<string>`coalesce(${coinTx.detail}->>'game', '')`;
  const [money, plays] = await Promise.all([
    db
      .select({
        game,
        net: sql<number>`coalesce(sum(${coinTx.amount}), 0)::bigint`,
        wagered: sql<number>`coalesce(-sum(${coinTx.amount}) filter (where ${coinTx.reason} = 'casino_bet'), 0)::bigint`,
      })
      .from(coinTx)
      .where(and(eq(coinTx.memberId, memberId), inCasino, gte(coinTx.at, since)))
      .groupBy(game),
    db
      .select({ game: casinoGames.game, n: sql<number>`count(*)::int` })
      .from(casinoGames)
      .where(and(eq(casinoGames.memberId, memberId), eq(casinoGames.status, 'done'), gte(casinoGames.createdAt, since)))
      .groupBy(casinoGames.game),
  ]);
  const count = new Map(plays.map((p) => [p.game, p.n]));
  return money
    .filter((m) => m.game)
    .map((m) => ({ game: m.game, net: Number(m.net), wagered: Number(m.wagered), plays: count.get(m.game) ?? 0 }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
}

/** 自分のいちばんの当たり（戻った − 賭けた の大きい順） */
export async function myBest(db: Db, memberId: string, limit = 5): Promise<CasinoGameRow[]> {
  return db
    .select()
    .from(casinoGames)
    .where(and(eq(casinoGames.memberId, memberId), eq(casinoGames.status, 'done'), sql`${casinoGames.payout} > ${casinoGames.bet}`))
    .orderBy(desc(sql`${casinoGames.payout} - ${casinoGames.bet}`))
    .limit(limit);
}

export type RankRow = { memberId: string; net: number; rank: number };

/**
 * 勝ち額ランキング: 期間の勝ち負けの大きい順（勝ち越した人だけ、上から limit 人）と、自分の順位（遊んでいなければ undefined）
 */
export async function winRanking(db: Db, since: Date, memberId: string, limit = 10): Promise<{ top: RankRow[]; me?: RankRow; players: number }> {
  const net = sql<number>`sum(${coinTx.amount})::bigint`;
  const rows = await db
    .select({ memberId: coinTx.memberId, net })
    .from(coinTx)
    .where(and(inCasino, gte(coinTx.at, since), ne(coinTx.memberId, HOUSE_BOT_ID)))
    .groupBy(coinTx.memberId)
    .orderBy(desc(net), coinTx.memberId);
  // 同じ額は同じ順位
  let rank = 0;
  let prev: number | undefined;
  const all = rows.map((r, i) => {
    const n = Number(r.net);
    if (n !== prev) rank = i + 1;
    prev = n;
    return { memberId: r.memberId, net: n, rank };
  });
  return { top: all.filter((r) => r.net > 0).slice(0, limit), me: all.find((r) => r.memberId === memberId), players: all.length };
}

/** 今日よく遊ばれているゲーム（遊んだ人の多い順） */
export async function popularToday(db: Db, now = new Date()): Promise<CasinoStat[]> {
  return (await casinoStats(db, rangeStart('today', now))).sort((a, b) => b.players - a.players || b.plays - a.plays);
}

/** 大当たりの記録: 倍率の高い順（戻った銭が賭けの 10 倍以上） */
export async function topMultipliers(db: Db, since: Date, limit = 10): Promise<CasinoGameRow[]> {
  return db
    .select()
    .from(casinoGames)
    .where(and(eq(casinoGames.status, 'done'), gte(casinoGames.finishedAt, since), sql`${casinoGames.bet} > 0`, sql`${casinoGames.payout} >= ${casinoGames.bet} * 10`, ne(casinoGames.memberId, HOUSE_BOT_ID)))
    .orderBy(desc(sql`${casinoGames.payout}::float / ${casinoGames.bet}`), desc(casinoGames.payout))
    .limit(limit);
}

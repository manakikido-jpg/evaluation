import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { mahjongResults } from '../../db/schema.js';

/**
 * 🀄 雀荘の戦績とランキング（mahjong_results から）。
 * 和了率・放銃率・リーチ率は、遊んだ局の数あたり。
 */

export type MjStats = {
  games: number;
  avgRank: number;
  /** 1〜4 位の回数 */
  ranks: [number, number, number, number];
  hands: number;
  winRate: number;
  dealinRate: number;
  riichiRate: number;
  best: { points: number; name: string | null } | null;
};

export async function mjStats(db: Db, memberId: string): Promise<MjStats> {
  const [row] = await db
    .select({
      games: sql<number>`count(*)::int`,
      avgRank: sql<number>`coalesce(avg(${mahjongResults.rank}), 0)::float`,
      r1: sql<number>`count(*) filter (where ${mahjongResults.rank} = 1)::int`,
      r2: sql<number>`count(*) filter (where ${mahjongResults.rank} = 2)::int`,
      r3: sql<number>`count(*) filter (where ${mahjongResults.rank} = 3)::int`,
      r4: sql<number>`count(*) filter (where ${mahjongResults.rank} = 4)::int`,
      hands: sql<number>`coalesce(sum(${mahjongResults.hands}), 0)::int`,
      wins: sql<number>`coalesce(sum(${mahjongResults.wins}), 0)::int`,
      dealins: sql<number>`coalesce(sum(${mahjongResults.dealins}), 0)::int`,
      riichi: sql<number>`coalesce(sum(${mahjongResults.riichi}), 0)::int`,
    })
    .from(mahjongResults)
    .where(eq(mahjongResults.memberId, memberId));
  const [best] = await db
    .select({ points: mahjongResults.bestPoints, name: mahjongResults.bestName })
    .from(mahjongResults)
    .where(and(eq(mahjongResults.memberId, memberId), sql`${mahjongResults.bestPoints} > 0`))
    .orderBy(desc(mahjongResults.bestPoints), desc(mahjongResults.finishedAt))
    .limit(1);
  const r = row!;
  const per = (n: number) => (r.hands > 0 ? n / r.hands : 0);
  return {
    games: r.games,
    avgRank: r.avgRank,
    ranks: [r.r1, r.r2, r.r3, r.r4],
    hands: r.hands,
    winRate: per(r.wins),
    dealinRate: per(r.dealins),
    riichiRate: per(r.riichi),
    best: best ?? null,
  };
}

export type MjRankRow = { memberId: string; name: string; games: number; avgRank: number; topRate: number; avgPoints: number };

/** ランキング（since から・minGames 戦以上。平均順位が低い順 → 対局数が多い順） */
export async function mjRanking(db: Db, since: Date, minGames = 3, limit = 20): Promise<MjRankRow[]> {
  const rows = await db
    .select({
      memberId: mahjongResults.memberId,
      name: sql<string>`(array_agg(${mahjongResults.name} order by ${mahjongResults.finishedAt} desc))[1]`,
      games: sql<number>`count(*)::int`,
      avgRank: sql<number>`avg(${mahjongResults.rank})::float`,
      tops: sql<number>`count(*) filter (where ${mahjongResults.rank} = 1)::int`,
      avgPoints: sql<number>`avg(${mahjongResults.points})::float`,
    })
    .from(mahjongResults)
    .where(gte(mahjongResults.finishedAt, since))
    .groupBy(mahjongResults.memberId)
    .having(sql`count(*) >= ${minGames}`)
    .orderBy(sql`avg(${mahjongResults.rank})`, sql`count(*) desc`)
    .limit(limit);
  return rows.map((r) => ({ memberId: r.memberId, name: r.name, games: r.games, avgRank: r.avgRank, topRate: r.games ? r.tops / r.games : 0, avgPoints: r.avgPoints }));
}

/** 日本時間の今月 1 日 0 時 */
export function monthStartJst(now = new Date()): Date {
  const j = new Date(now.getTime() + 9 * 3_600_000);
  return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), 1) - 9 * 3_600_000);
}

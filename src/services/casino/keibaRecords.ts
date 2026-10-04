import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { keibaBets, keibaEntries, keibaHorses, members, type KeibaHorseRow } from '../../db/schema.js';
import { KB_BET_TYPES, type KbBetType } from './keiba.js';

/**
 * 🏇 みんなでダービーの成績: 馬ごとのページ（1 走ずつ・距離と馬場の得意・産駒）と、メンバーの馬券成績。
 * 1 走ずつの記録（keiba_entries）と馬券（keiba_bets）は、この機能を入れてからのレースだけ
 */

export type KeibaEntryRow = typeof keibaEntries.$inferSelect;
export type KeibaBetRow = typeof keibaBets.$inferSelect;

/** 出走・1 着・2 着・3 着 */
export type Tally = { starts: number; wins: number; top2: number; top3: number };
const tally = (rows: readonly { pos: number }[]): Tally => ({
  starts: rows.length,
  wins: rows.filter((r) => r.pos === 1).length,
  top2: rows.filter((r) => r.pos <= 2).length,
  top3: rows.filter((r) => r.pos <= 3).length,
});

export type HorseProfile = {
  horse: KeibaHorseRow;
  ownerName: string | null;
  sire: { id: number; name: string } | null;
  foals: { id: number; name: string; starts: number; wins: number; retired: boolean }[];
  entries: KeibaEntryRow[];
  /** 距離ごと・馬場ごと（記録のあるレースから） */
  byDist: { dist: number; t: Tally }[];
  bySurface: { surface: number; t: Tally }[];
  /** 記録のあるレースのいちばん速いタイム（距離ごと）・平均の人気と着順 */
  best: { dist: number; time: string }[];
  avgPop: number | null;
  avgPos: number | null;
};

export async function horseProfile(db: Db, id: number, limit = 50): Promise<HorseProfile | null> {
  const [row] = await db.select({ h: keibaHorses, ownerName: members.displayName }).from(keibaHorses).leftJoin(members, eq(members.id, keibaHorses.ownerId)).where(eq(keibaHorses.id, id));
  if (!row) return null;
  const h = row.h;
  const [sire] = h.parentId ? await db.select({ id: keibaHorses.id, name: keibaHorses.name }).from(keibaHorses).where(eq(keibaHorses.id, h.parentId)) : [];
  const foals = await db
    .select({ id: keibaHorses.id, name: keibaHorses.name, starts: keibaHorses.starts, wins: keibaHorses.wins, retiredAt: keibaHorses.retiredAt })
    .from(keibaHorses)
    .where(eq(keibaHorses.parentId, id))
    .orderBy(asc(keibaHorses.id));
  const all = await db.select().from(keibaEntries).where(eq(keibaEntries.horseId, id)).orderBy(desc(keibaEntries.at), desc(keibaEntries.id));
  const group = <K extends number>(key: (r: KeibaEntryRow) => K) => {
    const m = new Map<K, KeibaEntryRow[]>();
    for (const r of all) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  };
  const toSec = (t: string) => {
    const [m, s] = t.split(':');
    return Number(m) * 60 + Number(s);
  };
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    horse: h,
    ownerName: row.ownerName ?? null,
    sire: sire ?? null,
    foals: foals.map((f) => ({ id: f.id, name: f.name, starts: f.starts, wins: f.wins, retired: f.retiredAt !== null })),
    entries: all.slice(0, limit),
    byDist: group((r) => r.dist).map(([dist, rows]) => ({ dist, t: tally(rows) })),
    bySurface: group((r) => r.surface).map(([surface, rows]) => ({ surface, t: tally(rows) })),
    best: group((r) => r.dist).map(([dist, rows]) => ({ dist, time: [...rows].sort((a, b) => toSec(a.time) - toSec(b.time))[0]!.time })),
    avgPop: avg(all.map((r) => r.pop).filter((x) => x > 0)),
    avgPos: avg(all.map((r) => r.pos)),
  };
}

export type DirectoryRow = KeibaHorseRow & { ownerName: string | null };

/** 馬名鑑: 走っている馬（賞金 → 勝ち星 → 出走の多い順） */
export async function horseDirectory(db: Db): Promise<DirectoryRow[]> {
  const rows = await db
    .select({ h: keibaHorses, ownerName: members.displayName })
    .from(keibaHorses)
    .leftJoin(members, eq(members.id, keibaHorses.ownerId))
    .where(isNull(keibaHorses.retiredAt))
    .orderBy(desc(keibaHorses.prize), desc(keibaHorses.wins), desc(keibaHorses.starts), asc(keibaHorses.id));
  return rows.map((r) => ({ ...r.h, ownerName: r.ownerName ?? null }));
}

/** 賭け方ごとの数字 */
export type BetTally = { tickets: number; hits: number; bet: number; payout: number };
export type MyBetStats = {
  total: BetTally & { races: number };
  byType: { type: KbBetType; t: BetTally }[];
  best: KeibaBetRow[];
  recent: KeibaBetRow[];
};

export async function myBetStats(db: Db, memberId: string, recent = 40): Promise<MyBetStats> {
  const sums = await db
    .select({
      type: keibaBets.type,
      tickets: sql<number>`count(*)::int`,
      hits: sql<number>`count(*) filter (where ${keibaBets.payout} > 0)::int`,
      bet: sql<number>`coalesce(sum(${keibaBets.amount}), 0)::int`,
      payout: sql<number>`coalesce(sum(${keibaBets.payout}), 0)::int`,
    })
    .from(keibaBets)
    .where(eq(keibaBets.memberId, memberId))
    .groupBy(keibaBets.type);
  // 同じ時刻・同じレースの馬券は 1 レース
  const [{ races } = { races: 0 }] = await db
    .select({ races: sql<number>`count(distinct (${keibaBets.race}, ${keibaBets.at}))::int` })
    .from(keibaBets)
    .where(eq(keibaBets.memberId, memberId));
  const byType = KB_BET_TYPES.map((type) => {
    const r = sums.find((x) => x.type === type);
    return { type, t: { tickets: r?.tickets ?? 0, hits: r?.hits ?? 0, bet: r?.bet ?? 0, payout: r?.payout ?? 0 } };
  });
  const total = byType.reduce((a, { t }) => ({ ...a, tickets: a.tickets + t.tickets, hits: a.hits + t.hits, bet: a.bet + t.bet, payout: a.payout + t.payout }), { races, tickets: 0, hits: 0, bet: 0, payout: 0 });
  const best = await db
    .select()
    .from(keibaBets)
    .where(and(eq(keibaBets.memberId, memberId), gt(keibaBets.payout, 0)))
    .orderBy(desc(keibaBets.payout), desc(keibaBets.at))
    .limit(5);
  const list = await db.select().from(keibaBets).where(eq(keibaBets.memberId, memberId)).orderBy(desc(keibaBets.at), desc(keibaBets.id)).limit(recent);
  return { total, byType, best, recent: list };
}

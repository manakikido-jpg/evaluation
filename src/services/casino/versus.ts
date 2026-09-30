import { and, desc, eq, gte, inArray, lt, or } from 'drizzle-orm';
import type { GuildConfig } from '../../config.js';
import type { Db } from '../../db/client.js';
import { casinoMatches, type CasinoMatch } from '../../db/schema.js';
import { addCoins, spendWithin } from '../economy.js';
import { checkBet, type BetCheck } from './casino.js';
import { initialBoard, othelloPlay, winnerOf, type OthelloState, type Stone } from './othello.js';

/**
 * メンバー同士の対戦（オセロ）。部屋を作った人が黒（先手）、入った人が白。
 * 賭けは両方から預かり、勝った人が 2 人分をもらう（引き分けは返す）。0 銭（賭けない）でもできる。
 * - 持ち時間: 1 手 MOVE_SECONDS 秒。過ぎたら置く番の人の負け
 * - 相手待ちのまま OPEN_MINUTES 分たったら、部屋を閉じて返す
 */

export const MOVE_SECONDS = 120;
export const OPEN_MINUTES = 30;

export type VersusState = OthelloState;

export const colorOf = (m: Pick<CasinoMatch, 'hostId' | 'guestId'>, memberId: string): Stone | undefined =>
  m.hostId === memberId ? 'B' : m.guestId === memberId ? 'W' : undefined;

export const playerOf = (m: Pick<CasinoMatch, 'hostId' | 'guestId'>, color: Stone) => (color === 'B' ? m.hostId : m.guestId);

export async function matchById(db: Db, id: number): Promise<CasinoMatch | undefined> {
  const [m] = await db.select().from(casinoMatches).where(eq(casinoMatches.id, id));
  return m;
}

/** その人が入っている（相手待ち・対戦中の）部屋 */
export async function myMatch(db: Db, memberId: string): Promise<CasinoMatch | undefined> {
  const [m] = await db
    .select()
    .from(casinoMatches)
    .where(and(inArray(casinoMatches.status, ['open', 'playing']), or(eq(casinoMatches.hostId, memberId), eq(casinoMatches.guestId, memberId))))
    .orderBy(desc(casinoMatches.id))
    .limit(1);
  return m;
}

export async function openMatches(db: Db): Promise<CasinoMatch[]> {
  return db.select().from(casinoMatches).where(inArray(casinoMatches.status, ['open', 'playing'])).orderBy(desc(casinoMatches.id)).limit(30);
}

export async function recentMatches(db: Db, limit = 10): Promise<CasinoMatch[]> {
  return db.select().from(casinoMatches).where(eq(casinoMatches.status, 'done')).orderBy(desc(casinoMatches.finishedAt)).limit(limit);
}

/** 賭けを確かめる（0 は賭けない対戦。上限・残高だけ見る） */
async function checkVersusBet(db: Db, cfg: GuildConfig, memberId: string, bet: number, now: Date): Promise<BetCheck> {
  if (bet === 0) return cfg.casino.enabled ? (cfg.casino.games.includes('versus') ? 'ok' : 'game_off') : 'closed';
  return checkBet(db, cfg, memberId, 'versus', bet, now);
}

export type MatchResult = { status: 'ok'; match: CasinoMatch } | { status: Exclude<BetCheck, 'ok'> | 'busy' | 'not_found' | 'self' | 'taken' | 'not_yours' | 'invalid' };

export async function createMatch(db: Db, cfg: GuildConfig, hostId: string, bet: number, now = new Date()): Promise<MatchResult> {
  if (await myMatch(db, hostId)) return { status: 'busy' };
  const check = await checkVersusBet(db, cfg, hostId, bet, now);
  if (check !== 'ok') return { status: check };
  const match = await db.transaction(async (tx) => {
    if (bet > 0 && !(await spendWithin(tx, hostId, bet, 'casino_bet', { game: 'versus' }))) return undefined;
    const state: VersusState = { board: initialBoard(), turn: 'B' };
    const [m] = await tx.insert(casinoMatches).values({ hostId, bet, state, createdAt: now, turnAt: now }).returning();
    return m;
  });
  return match ? { status: 'ok', match } : { status: 'poor' };
}

export async function joinMatch(db: Db, cfg: GuildConfig, id: number, guestId: string, now = new Date()): Promise<MatchResult> {
  const m = await matchById(db, id);
  if (!m || m.status !== 'open') return { status: 'not_found' };
  if (m.hostId === guestId) return { status: 'self' };
  if (await myMatch(db, guestId)) return { status: 'busy' };
  const check = await checkVersusBet(db, cfg, guestId, m.bet, now);
  if (check !== 'ok') return { status: check };
  const r = await db
    .transaction(async (tx) => {
      const [u] = await tx
        .update(casinoMatches)
        .set({ guestId, status: 'playing', turnAt: now, version: m.version + 1 })
        .where(and(eq(casinoMatches.id, id), eq(casinoMatches.status, 'open'), eq(casinoMatches.version, m.version)))
        .returning();
      if (!u) return 'taken' as const;
      if (m.bet > 0 && !(await spendWithin(tx, guestId, m.bet, 'casino_bet', { game: 'versus', id }))) throw new Poor();
      return u;
    })
    .catch((err: unknown) => {
      if (err instanceof Poor) return 'poor' as const;
      throw err;
    });
  return typeof r === 'string' ? { status: r } : { status: 'ok', match: r };
}

class Poor extends Error {}

/** 相手待ちの部屋を閉じる（作った人だけ）。賭けは返す */
export async function cancelMatch(db: Db, id: number, hostId: string, now = new Date()): Promise<MatchResult> {
  const m = await matchById(db, id);
  if (!m || m.status !== 'open') return { status: 'not_found' };
  if (m.hostId !== hostId) return { status: 'not_yours' };
  const done = await closeMatch(db, m, { status: 'cancelled', endReason: 'cancel' }, now);
  return done ? { status: 'ok', match: done } : { status: 'taken' };
}

/** 終わらせて、銭を渡す（同時に 2 回呼ばれても 1 回だけ） */
async function closeMatch(db: Db, m: CasinoMatch, end: { status: 'done' | 'cancelled'; endReason: string; winner?: Stone | null; state?: VersusState }, now: Date): Promise<CasinoMatch | undefined> {
  return db.transaction(async (tx) => {
    const winnerId = end.winner ? playerOf(m, end.winner) : null;
    const [u] = await tx
      .update(casinoMatches)
      .set({ status: end.status, endReason: end.endReason, winnerId, finishedAt: now, version: m.version + 1, ...(end.state ? { state: end.state } : {}) })
      .where(and(eq(casinoMatches.id, m.id), eq(casinoMatches.version, m.version), inArray(casinoMatches.status, ['open', 'playing'])))
      .returning();
    if (!u || m.bet <= 0) return u;
    if (end.status === 'cancelled') {
      await addCoins(tx, m.hostId, m.bet, 'casino_refund', { game: 'versus', id: m.id });
    } else if (winnerId) {
      await addCoins(tx, winnerId, m.bet * 2, 'casino_win', { game: 'versus', id: m.id });
    } else {
      await addCoins(tx, m.hostId, m.bet, 'casino_refund', { game: 'versus', id: m.id, draw: true });
      if (m.guestId) await addCoins(tx, m.guestId, m.bet, 'casino_refund', { game: 'versus', id: m.id, draw: true });
    }
    return u;
  });
}

export async function moveMatch(db: Db, id: number, memberId: string, idx: number, now = new Date()): Promise<MatchResult> {
  const m = await sweepOne(db, await matchById(db, id), now);
  if (!m || m.status !== 'playing') return { status: 'not_found' };
  const color = colorOf(m, memberId);
  if (!color) return { status: 'not_yours' };
  const s = m.state as VersusState;
  const next = othelloPlay(s, color, idx);
  if (!next) return { status: 'invalid' };
  if (next.turn === null) {
    const done = await closeMatch(db, m, { status: 'done', endReason: 'end', winner: winnerOf(next.board), state: next }, now);
    return done ? { status: 'ok', match: done } : { status: 'taken' };
  }
  const [u] = await db
    .update(casinoMatches)
    .set({ state: next, turnAt: now, version: m.version + 1 })
    .where(and(eq(casinoMatches.id, id), eq(casinoMatches.version, m.version), eq(casinoMatches.status, 'playing')))
    .returning();
  return u ? { status: 'ok', match: u } : { status: 'taken' };
}

export async function resignMatch(db: Db, id: number, memberId: string, now = new Date()): Promise<MatchResult> {
  const m = await matchById(db, id);
  if (!m || m.status !== 'playing') return { status: 'not_found' };
  const color = colorOf(m, memberId);
  if (!color) return { status: 'not_yours' };
  const done = await closeMatch(db, m, { status: 'done', endReason: 'resign', winner: color === 'B' ? 'W' : 'B' }, now);
  return done ? { status: 'ok', match: done } : { status: 'taken' };
}

/** 持ち時間を過ぎた・相手が来ない部屋を片付ける（読むたびに呼ぶ） */
async function sweepOne(db: Db, m: CasinoMatch | undefined, now: Date): Promise<CasinoMatch | undefined> {
  if (!m) return m;
  if (m.status === 'open' && now.getTime() - m.createdAt.getTime() > OPEN_MINUTES * 60_000) {
    return (await closeMatch(db, m, { status: 'cancelled', endReason: 'expired' }, now)) ?? (await matchById(db, m.id));
  }
  const turn = (m.state as VersusState).turn;
  if (m.status === 'playing' && turn && now.getTime() - m.turnAt.getTime() > MOVE_SECONDS * 1000) {
    return (await closeMatch(db, m, { status: 'done', endReason: 'timeout', winner: turn === 'B' ? 'W' : 'B' }, now)) ?? (await matchById(db, m.id));
  }
  return m;
}

export async function readMatch(db: Db, id: number, now = new Date()): Promise<CasinoMatch | undefined> {
  return sweepOne(db, await matchById(db, id), now);
}

export async function sweepMatches(db: Db, now = new Date()): Promise<void> {
  const stale = await db
    .select()
    .from(casinoMatches)
    .where(
      or(
        and(eq(casinoMatches.status, 'open'), lt(casinoMatches.createdAt, new Date(now.getTime() - OPEN_MINUTES * 60_000))),
        and(eq(casinoMatches.status, 'playing'), lt(casinoMatches.turnAt, new Date(now.getTime() - MOVE_SECONDS * 1000))),
      ),
    );
  for (const m of stale) await sweepOne(db, m, now);
}

/** 終わった対戦の数と、動いた銭（賭け × 2） */
export async function matchStats(db: Db, since: Date): Promise<{ plays: number; pot: number }> {
  const rows = await db
    .select({ bet: casinoMatches.bet })
    .from(casinoMatches)
    .where(and(eq(casinoMatches.status, 'done'), gte(casinoMatches.finishedAt, since)));
  return { plays: rows.length, pot: rows.reduce((n, r) => n + r.bet * 2, 0) };
}

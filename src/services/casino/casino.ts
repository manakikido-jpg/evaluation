import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { CasinoGame, GuildConfig } from '../../config.js';
import type { Db } from '../../db/client.js';
import { casinoGames, coinTx, type CasinoGameRow } from '../../db/schema.js';
import { jstDate } from '../activity.js';
import { addCoins, spendWithin, walletOf } from '../economy.js';
import { bacDeal, bacPayout, type BacBet, type BacResult } from './baccarat.js';
import { bjDouble, bjHit, bjPayout, bjStand, bjStart, canDouble, type BjState } from './blackjack.js';
import { cryptoRng, type Rng } from './cards.js';
import { hlCashout, hlGuess, hlPayout, hlStart, type HlGuess, type HlState } from './highlow.js';
import { cpuMove, applyMove, initialBoard, nextTurn, OTHELLO_LEVELS, othelloPlay, winnerOf, type OthelloLevel, type OthelloState } from './othello.js';
import { rouletteMultiplier, rouletteSpin, type RouletteBet } from './roulette.js';
import { slotSpin, type SlotKey } from './slots.js';

/**
 * カジノ（1 人で遊ぶゲーム）。賭けた銭は始めたときに引き、終わったときに 1 回だけ戻す（負けは 0）。
 * ゲームの中身（山札など）は DB だけに置き、画面には見せてよい分だけ出す。
 */

export const CASINO_LABEL: Record<CasinoGame, { emoji: string; name: string; note: string }> = {
  blackjack: { emoji: '🃏', name: 'ブラックジャック', note: '21 に近いほうが勝ち。ブラックジャックは 2.5 倍' },
  highlow: { emoji: '🔼', name: 'ハイ＆ロー', note: '次のカードが上か下か。当てるほど倍率が上がる' },
  baccarat: { emoji: '🎴', name: 'バカラ', note: 'プレイヤー・バンカー・タイ、どれが勝つか' },
  slots: { emoji: '🎰', name: 'スロット', note: '🌸🌸🌸 で 777 倍' },
  roulette: { emoji: '🎡', name: 'ルーレット', note: '赤黒は 2 倍・数字 1 つは 36 倍' },
  othello: { emoji: '⚫\uFE0F', name: 'オセロ（CPU）', note: 'CPU に勝てば、強さに合わせて 1.2〜2.2 倍' },
  versus: { emoji: '⚔\uFE0F', name: 'メンバー対戦（オセロ）', note: 'メンバー同士で賭けて対戦。勝った人が総取り' },
  bj_table: { emoji: '🃏', name: 'ブラックジャック卓', note: 'みんなで同じディーラーと勝負' },
  baccarat_table: { emoji: '🎴', name: 'バカラ卓', note: 'みんなで同じ勝負に賭ける' },
  roulette_table: { emoji: '🎡', name: 'ルーレット卓', note: 'みんなで同じ回転に賭ける' },
  poker: { emoji: '♠\uFE0F', name: 'ポーカー', note: 'テキサスホールデム。持ち込んだ銭で賭け合う' },
  daifugo: { emoji: '👑', name: '大富豪', note: '早く上がった順に賞金' },
  babanuki: { emoji: '🤡', name: 'ババ抜き', note: '最後にババを持っていた人の負け' },
};

export type BetCheck = 'ok' | 'closed' | 'game_off' | 'bad_bet' | 'limit' | 'poor';

/** 今日（日本時間）カジノで賭けた合計 */
export async function todayBets(db: Db, memberId: string, now = new Date()): Promise<number> {
  const since = new Date(`${jstDate(now)}T00:00:00+09:00`);
  const [row] = await db
    .select({ n: sql<number>`coalesce(-sum(${coinTx.amount}), 0)::int` })
    .from(coinTx)
    .where(and(eq(coinTx.memberId, memberId), eq(coinTx.reason, 'casino_bet'), gte(coinTx.at, since)));
  return row?.n ?? 0;
}

export async function checkBet(db: Db, cfg: GuildConfig, memberId: string, game: CasinoGame, bet: number, now = new Date()): Promise<BetCheck> {
  const c = cfg.casino;
  if (!c.enabled) return 'closed';
  if (!c.games.includes(game)) return 'game_off';
  if (!Number.isInteger(bet) || bet < c.minBet || bet > c.maxBet) return 'bad_bet';
  if (c.dailyBetLimit > 0 && (await todayBets(db, memberId, now)) + bet > c.dailyBetLimit) return 'limit';
  if ((await walletOf(db, memberId)).balance < bet) return 'poor';
  return 'ok';
}

export const BET_ERROR: Record<Exclude<BetCheck, 'ok'>, string> = {
  closed: 'いまカジノはお休みです。',
  game_off: 'このゲームはいま遊べません。',
  bad_bet: '賭ける銭の量を確かめてください。',
  limit: '今日賭けられる上限に届きました。また明日遊んでください。',
  poor: '銭が足りません。',
};

export type Played = { status: 'ok'; row: CasinoGameRow } | { status: Exclude<BetCheck, 'ok'> } | { status: 'busy'; row: CasinoGameRow };

/** 遊んでいる途中のゲーム（その種類で 1 つだけ） */
export async function activeGame(db: Db, memberId: string, game: CasinoGame): Promise<CasinoGameRow | undefined> {
  const [row] = await db
    .select()
    .from(casinoGames)
    .where(and(eq(casinoGames.memberId, memberId), eq(casinoGames.game, game), eq(casinoGames.status, 'playing')))
    .orderBy(desc(casinoGames.id))
    .limit(1);
  return row;
}

export async function gameById(db: Db, id: number): Promise<CasinoGameRow | undefined> {
  const [row] = await db.select().from(casinoGames).where(eq(casinoGames.id, id));
  return row;
}

class NotEnough extends Error {}

type Outcome = { state: unknown; done: boolean; payout: number };

/** 賭けて始める。始めた時点で終わるもの（スロットなど）は、そのまま払い戻す */
async function start(db: Db, cfg: GuildConfig, memberId: string, game: CasinoGame, bet: number, init: () => Outcome, now: Date): Promise<Played> {
  const busy = await activeGame(db, memberId, game);
  if (busy) return { status: 'busy', row: busy };
  const check = await checkBet(db, cfg, memberId, game, bet, now);
  if (check !== 'ok') return { status: check };
  const o = init();
  const row = await db.transaction(async (tx) => {
    const paid = await spendWithin(tx, memberId, bet, 'casino_bet', { game });
    if (!paid) return undefined;
    const [r] = await tx
      .insert(casinoGames)
      .values({ memberId, game, bet, state: o.state, status: o.done ? 'done' : 'playing', payout: o.done ? o.payout : 0, createdAt: now, finishedAt: o.done ? now : null })
      .returning();
    if (o.done && o.payout > 0) await addCoins(tx, memberId, o.payout, 'casino_win', { game, id: r!.id });
    return r;
  });
  if (!row) return { status: 'poor' };
  return { status: 'ok', row };
}

export type Acted = { status: 'ok'; row: CasinoGameRow } | { status: 'not_found' | 'done' | 'invalid' | 'poor' | 'conflict' };

/** 途中のゲームを 1 手進める。同時に 2 回押しても 1 回だけ（version で見分ける） */
async function act(db: Db, id: number, memberId: string, step: (row: CasinoGameRow) => (Outcome & { extraBet?: number }) | undefined, now: Date): Promise<Acted> {
  const row = await gameById(db, id);
  if (!row || row.memberId !== memberId) return { status: 'not_found' };
  if (row.status !== 'playing') return { status: 'done' };
  const o = step(row);
  if (!o) return { status: 'invalid' };
  const extra = o.extraBet ?? 0;
  const result = await db
    .transaction(async (tx) => {
      const payout = o.done ? o.payout : 0;
      const [r] = await tx
        .update(casinoGames)
        .set({ state: o.state, bet: row.bet + extra, version: row.version + 1, ...(o.done ? { status: 'done', payout, finishedAt: now } : {}) })
        .where(and(eq(casinoGames.id, id), eq(casinoGames.version, row.version), eq(casinoGames.status, 'playing')))
        .returning();
      if (!r) return 'conflict' as const;
      // 足りなければ、進めた分ごと取り消す
      if (extra > 0 && !(await spendWithin(tx, memberId, extra, 'casino_bet', { game: row.game, id, extra: true }))) throw new NotEnough();
      if (o.done && payout > 0) await addCoins(tx, memberId, payout, 'casino_win', { game: row.game, id });
      return r;
    })
    .catch((err: unknown) => {
      if (err instanceof NotEnough) return 'poor' as const;
      throw err;
    });
  if (typeof result === 'string') return { status: result };
  return { status: 'ok', row: result };
}

// ───────── 🃏 ブラックジャック ─────────

export function startBlackjack(db: Db, cfg: GuildConfig, memberId: string, bet: number, rng: Rng = cryptoRng, now = new Date()) {
  return start(db, cfg, memberId, 'blackjack', bet, () => {
    const s = bjStart(rng);
    return { state: s, done: s.phase === 'done', payout: s.result ? bjPayout(s.result, bet) : 0 };
  }, now);
}

export type BjAction = 'hit' | 'stand' | 'double';

export async function actBlackjack(db: Db, cfg: GuildConfig, id: number, memberId: string, action: BjAction, now = new Date()): Promise<Acted> {
  // ダブルダウンは、今日の上限にも数える
  if (action === 'double') {
    const row = await gameById(db, id);
    if (row && row.memberId === memberId && cfg.casino.dailyBetLimit > 0 && (await todayBets(db, memberId, now)) + row.bet > cfg.casino.dailyBetLimit) return { status: 'invalid' };
  }
  return act(db, id, memberId, (row) => {
    const s = row.state as BjState;
    if (action === 'double' && !canDouble(s)) return undefined;
    const next = action === 'hit' ? bjHit(s) : action === 'stand' ? bjStand(s) : bjDouble(s);
    const extraBet = action === 'double' ? row.bet : 0;
    const total = row.bet + extraBet;
    return { state: next, done: next.phase === 'done', payout: next.result ? bjPayout(next.result, total) : 0, extraBet };
  }, now);
}

// ───────── 🔼 ハイ＆ロー ─────────

export function startHighLow(db: Db, cfg: GuildConfig, memberId: string, bet: number, rng: Rng = cryptoRng, now = new Date()) {
  return start(db, cfg, memberId, 'highlow', bet, () => ({ state: hlStart(rng), done: false, payout: 0 }), now);
}

export function actHighLow(db: Db, id: number, memberId: string, action: HlGuess | 'cashout', rng: Rng = cryptoRng, now = new Date()): Promise<Acted> {
  return act(db, id, memberId, (row) => {
    const s = row.state as HlState;
    const next = action === 'cashout' ? hlCashout(s) : hlGuess(s, action, rng);
    if (next === s) return undefined;
    return { state: next, done: next.phase === 'done', payout: hlPayout(next, row.bet) };
  }, now);
}

// ───────── 🎴 バカラ・🎰 スロット・🎡 ルーレット（1 回で終わる） ─────────

export type BaccaratState = { bet: BacBet; result: BacResult };
export function playBaccarat(db: Db, cfg: GuildConfig, memberId: string, bet: number, on: BacBet, rng: Rng = cryptoRng, now = new Date()) {
  return start(db, cfg, memberId, 'baccarat', bet, () => {
    const result = bacDeal(rng);
    return { state: { bet: on, result } satisfies BaccaratState, done: true, payout: bacPayout(on, result, bet) };
  }, now);
}

export type SlotsState = { reels: SlotKey[]; multiplier: number };
export function playSlots(db: Db, cfg: GuildConfig, memberId: string, bet: number, rng: Rng = cryptoRng, now = new Date()) {
  return start(db, cfg, memberId, 'slots', bet, () => {
    const r = slotSpin(rng);
    return { state: r satisfies SlotsState, done: true, payout: bet * r.multiplier };
  }, now);
}

export type RouletteState = { bet: RouletteBet; number: number; multiplier: number };
export function playRoulette(db: Db, cfg: GuildConfig, memberId: string, bet: number, on: RouletteBet, rng: Rng = cryptoRng, now = new Date()) {
  return start(db, cfg, memberId, 'roulette', bet, () => {
    const n = rouletteSpin(rng);
    const multiplier = rouletteMultiplier(on, n);
    return { state: { bet: on, number: n, multiplier } satisfies RouletteState, done: true, payout: bet * multiplier };
  }, now);
}

// ───────── ⚫ オセロ（CPU） ─────────

export type OthelloCpuState = OthelloState & { result?: 'win' | 'lose' | 'draw' | 'resign' };

const othelloPayout = (s: OthelloCpuState, bet: number) =>
  s.result === 'win' ? Math.floor(bet * OTHELLO_LEVELS[s.level ?? 'easy'].mult) : s.result === 'draw' ? bet : 0;

function othelloFinish(s: OthelloState): OthelloCpuState {
  if (s.turn) return s;
  const w = winnerOf(s.board);
  return { ...s, result: w === null ? 'draw' : w === s.you ? 'win' : 'lose' };
}

/** you: 人の色（黒は先手）。白を選んだら CPU が先に置く */
export function startOthello(db: Db, cfg: GuildConfig, memberId: string, bet: number, level: OthelloLevel, you: 'B' | 'W' = 'B', rng: Rng = cryptoRng, now = new Date()) {
  return start(db, cfg, memberId, 'othello', bet, () => {
    let s: OthelloState = { board: initialBoard(), turn: 'B', you, level };
    if (you === 'W') {
      const m = cpuMove(s.board, 'B', level, rng)!;
      const b = applyMove(s.board, 'B', m)!;
      s = { ...s, board: b, turn: nextTurn(b, 'B'), last: m };
    }
    return { state: s, done: false, payout: 0 };
  }, now);
}

export function actOthello(db: Db, id: number, memberId: string, move: number | 'resign', rng: Rng = cryptoRng, now = new Date()): Promise<Acted> {
  return act(db, id, memberId, (row) => {
    const s = row.state as OthelloCpuState;
    if (move === 'resign') {
      const next: OthelloCpuState = { ...s, turn: null, result: 'resign' };
      return { state: next, done: true, payout: 0 };
    }
    const played = othelloPlay(s, s.you ?? 'B', move, rng);
    if (!played) return undefined;
    const next = othelloFinish(played);
    return { state: next, done: next.turn === null, payout: othelloPayout(next, row.bet) };
  }, now);
}

// ───────── 記録 ─────────

export async function recentGames(db: Db, memberId: string, limit = 10): Promise<CasinoGameRow[]> {
  return db
    .select()
    .from(casinoGames)
    .where(and(eq(casinoGames.memberId, memberId), eq(casinoGames.status, 'done')))
    .orderBy(desc(casinoGames.id))
    .limit(limit);
}

/** 最近の大当たり（戻った銭が賭けの 5 倍以上） */
export async function bigWins(db: Db, since: Date, limit = 8): Promise<CasinoGameRow[]> {
  return db
    .select()
    .from(casinoGames)
    .where(and(eq(casinoGames.status, 'done'), gte(casinoGames.finishedAt, since), sql`${casinoGames.payout} >= ${casinoGames.bet} * 5`))
    .orderBy(desc(casinoGames.payout))
    .limit(limit);
}

export type CasinoStat = { game: string; plays: number; wagered: number; paid: number; players: number };

/** ゲームごとの遊ばれた回数・賭けた合計・戻した合計（運営の画面） */
export async function casinoStats(db: Db, since: Date): Promise<CasinoStat[]> {
  return db
    .select({
      game: casinoGames.game,
      plays: sql<number>`count(*)::int`,
      wagered: sql<number>`coalesce(sum(${casinoGames.bet}), 0)::bigint`,
      paid: sql<number>`coalesce(sum(${casinoGames.payout}), 0)::bigint`,
      players: sql<number>`count(distinct ${casinoGames.memberId})::int`,
    })
    .from(casinoGames)
    .where(and(eq(casinoGames.status, 'done'), gte(casinoGames.finishedAt, since)))
    .groupBy(casinoGames.game)
    .then((rows) => rows.map((r) => ({ ...r, wagered: Number(r.wagered), paid: Number(r.paid) })));
}

/** 遊んだ人の数 */
export async function casinoPlayers(db: Db, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${casinoGames.memberId})::int` })
    .from(casinoGames)
    .where(gte(casinoGames.createdAt, since));
  return row?.n ?? 0;
}

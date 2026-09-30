import type { GuildConfig } from '../../../config.js';
import { bacDeal, bacPayout, BAC_BETS, type BacBet, type BacResult } from '../baccarat.js';
import { bjPayout, handValue, isBlackjack, type BjResult } from '../blackjack.js';
import { shuffledShoe, type Rng } from '../cards.js';
import { isRouletteBet, rouletteMultiplier, rouletteSpin, type RouletteBet } from '../roulette.js';
import { fail, intOf, ok, str, type Ctx, type Credit, type Form, type PlayRecord, type Step, type TableEngine, type Who } from './types.js';

/**
 * ディーラーのいる卓（ブラックジャック・バカラ・ルーレット）。座った人みんなが同じ回で、ディーラー（胴元）と勝負する。
 * - 賭けの時間: だれかが賭けてから BET_SECONDS 秒（みんなが賭けたらすぐ始まる）
 * - ブラックジャックは 1 人ずつ順番に。持ち時間 TURN_SECONDS 秒を過ぎたらスタンド
 * - 結果を見せてから、次の回へ
 * - 賭けずに IDLE_MINUTES 分いた人は席を立たせる
 */

export const BET_SECONDS = 15;
export const TURN_SECONDS = 20;
export const RESULT_SECONDS = 7;
export const IDLE_MINUTES = 10;

type Base = Who & { lastActive: number };

const validBet = (cfg: GuildConfig, n: number) => Number.isInteger(n) && n >= cfg.casino.minBet && n <= cfg.casino.maxBet;
const idleDue = (seats: Base[], busy: (s: Base) => boolean) => {
  const t = seats.filter((s) => !busy(s)).map((s) => s.lastActive + IDLE_MINUTES * 60_000);
  return t.length ? Math.min(...t) : null;
};
const minDue = (...xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? Math.min(...v) : null;
};

// ───────── 🃏 ブラックジャック卓 ─────────

export type BjSeat = Base & { bet: number; hand: number[]; doubled: boolean; done: boolean; left?: boolean; result?: BjResult; payout?: number };
export type BjTableState = {
  kind: 'bj_table';
  seats: BjSeat[];
  phase: 'betting' | 'playing' | 'result';
  deadline: number | null;
  shoe: number[];
  dealer: number[];
  turn: string | null;
  round: number;
};

const bjSeat = (w: Who, now: number): BjSeat => ({ ...w, lastActive: now, bet: 0, hand: [], doubled: false, done: false });

function bjDraw(s: BjTableState, rng: Rng): number {
  if (s.shoe.length < 20) s.shoe = shuffledShoe(6, rng);
  return s.shoe.pop()!;
}

function bjStartRound(state: BjTableState, ctx: Ctx): Step<BjTableState> {
  const s: BjTableState = structuredClone(state);
  if (s.shoe.length < 60) s.shoe = shuffledShoe(6, ctx.rng);
  const players = s.seats.filter((x) => x.bet > 0);
  for (const p of players) p.hand = [bjDraw(s, ctx.rng)];
  s.dealer = [bjDraw(s, ctx.rng)];
  for (const p of players) p.hand.push(bjDraw(s, ctx.rng));
  s.dealer.push(bjDraw(s, ctx.rng));
  for (const p of players) p.done = isBlackjack(p.hand) || isBlackjack(s.dealer);
  s.round++;
  s.phase = 'playing';
  return bjNextTurn(s, ctx);
}

function bjNextTurn(s: BjTableState, ctx: Ctx): Step<BjTableState> {
  const next = s.seats.find((x) => x.bet > 0 && !x.done);
  if (!next) return bjFinish(s, ctx);
  s.turn = next.id;
  s.deadline = ctx.now + TURN_SECONDS * 1000;
  return ok(s);
}

function bjFinish(s: BjTableState, ctx: Ctx): Step<BjTableState> {
  const players = s.seats.filter((x) => x.bet > 0);
  const dealerBj = isBlackjack(s.dealer);
  const contest = players.some((p) => handValue(p.hand).total <= 21 && !isBlackjack(p.hand));
  if (contest && !dealerBj) while (handValue(s.dealer).total < 17) s.dealer.push(bjDraw(s, ctx.rng));
  const d = handValue(s.dealer).total;
  const credits: Credit[] = [];
  const records: PlayRecord[] = [];
  for (const p of players) {
    const pv = handValue(p.hand).total;
    const pbj = isBlackjack(p.hand);
    p.result = pbj && dealerBj ? 'push' : pbj ? 'blackjack' : dealerBj ? 'dealer_blackjack' : pv > 21 ? 'bust' : d > 21 || pv > d ? 'win' : pv === d ? 'push' : 'lose';
    p.payout = bjPayout(p.result, p.bet);
    if (p.payout > 0) credits.push({ memberId: p.id, amount: p.payout, reason: 'casino_win' });
    records.push({ memberId: p.id, game: 'blackjack', bet: p.bet, payout: p.payout });
  }
  s.phase = 'result';
  s.turn = null;
  s.deadline = ctx.now + RESULT_SECONDS * 1000;
  return ok(s, { credits, records });
}

function bjAfterResult(state: BjTableState, now: number): BjTableState {
  const s = structuredClone(state);
  s.seats = s.seats.filter((x) => !x.left).map((x) => ({ ...x, bet: 0, hand: [], doubled: false, done: false, result: undefined, payout: undefined, lastActive: x.bet > 0 ? now : x.lastActive }));
  s.dealer = [];
  s.phase = 'betting';
  s.deadline = null;
  return s;
}

export const bjTable: TableEngine<BjTableState> = {
  kind: 'bj_table',
  maxSeats: 5,
  create: (host, _f, ctx) => ok({ kind: 'bj_table', seats: [bjSeat(host, ctx.now)], phase: 'betting', deadline: null, shoe: shuffledShoe(6, ctx.rng), dealer: [], turn: null, round: 0 }),
  join(s, who, _f, ctx) {
    if (s.seats.some((x) => x.id === who.id)) return ok(s);
    if (s.seats.length >= this.maxSeats) return fail('full');
    return ok({ ...s, seats: [...s.seats, bjSeat(who, ctx.now)] });
  },
  leave(state, id, ctx) {
    const s = structuredClone(state);
    const seat = s.seats.find((x) => x.id === id);
    if (!seat) return fail('not_seated');
    if (s.phase === 'betting') {
      s.seats = s.seats.filter((x) => x.id !== id);
      if (s.seats.every((x) => x.bet === 0)) s.deadline = null;
      return ok(s, seat.bet > 0 ? { credits: [{ memberId: id, amount: seat.bet, reason: 'casino_refund' }] } : undefined);
    }
    if (s.phase === 'result' || seat.bet === 0) {
      s.seats = s.seats.filter((x) => x.id !== id);
      return ok(s);
    }
    // 勝負の途中: スタンドしたことにして、終わったら席を立つ
    seat.left = true;
    seat.done = true;
    return s.turn === id ? bjNextTurn(s, ctx) : ok(s);
  },
  act(state, id, f, ctx) {
    const s = structuredClone(state);
    const seat = s.seats.find((x) => x.id === id);
    if (!seat) return fail('not_seated');
    const a = str(f, 'action');
    seat.lastActive = ctx.now;
    if (a === 'bet') {
      if (s.phase !== 'betting' || seat.bet > 0) return fail('invalid');
      const bet = intOf(f, 'bet');
      if (!validBet(ctx.cfg, bet)) return fail('bad_bet');
      seat.bet = bet;
      if (s.deadline === null) s.deadline = ctx.now + BET_SECONDS * 1000;
      const debit = { debits: [{ memberId: id, amount: bet, reason: 'casino_bet' as const, limited: true }] };
      if (s.seats.every((x) => x.bet > 0)) {
        const r = bjStartRound(s, ctx);
        return r.ok ? ok(r.state, { ...debit, credits: r.fx?.credits, records: r.fx?.records }) : r;
      }
      return ok(s, debit);
    }
    if (s.phase !== 'playing' || s.turn !== id || seat.done) return fail('not_your_turn');
    if (a === 'hit') {
      seat.hand.push(bjDraw(s, ctx.rng));
      const t = handValue(seat.hand).total;
      if (t >= 21) seat.done = true;
      return seat.done ? bjNextTurn(s, ctx) : ok({ ...s, deadline: ctx.now + TURN_SECONDS * 1000 });
    }
    if (a === 'stand') {
      seat.done = true;
      return bjNextTurn(s, ctx);
    }
    if (a === 'double') {
      if (seat.hand.length !== 2 || seat.doubled) return fail('invalid');
      const extra = seat.bet;
      seat.bet += extra;
      seat.doubled = true;
      seat.hand.push(bjDraw(s, ctx.rng));
      seat.done = true;
      const r = bjNextTurn(s, ctx);
      return r.ok ? ok(r.state, { debits: [{ memberId: id, amount: extra, reason: 'casino_bet', limited: true }], credits: r.fx?.credits, records: r.fx?.records }) : r;
    }
    return fail('invalid');
  },
  tick(s, ctx) {
    if (s.phase === 'betting') {
      if (s.deadline !== null && s.deadline <= ctx.now && s.seats.some((x) => x.bet > 0)) return bjStartRound(s, ctx);
      const idle = s.seats.filter((x) => x.bet === 0 && x.lastActive + IDLE_MINUTES * 60_000 <= ctx.now);
      if (idle.length) return ok({ ...s, seats: s.seats.filter((x) => !idle.includes(x)) });
      return null;
    }
    if (s.deadline === null || s.deadline > ctx.now) return null;
    if (s.phase === 'playing') {
      const st = structuredClone(s);
      const seat = st.seats.find((x) => x.id === st.turn);
      if (seat) seat.done = true;
      return bjNextTurn(st, ctx);
    }
    return ok(bjAfterResult(s, ctx.now));
  },
  due: (s) => (s.phase === 'betting' ? minDue(s.deadline, idleDue(s.seats, (x) => (x as BjSeat).bet > 0)) : s.deadline),
  seats: (s) => s.seats.filter((x) => !x.left).map((x) => x.id),
  closed: (s) => s.seats.length === 0,
};

// ───────── 🎴 バカラ卓 ─────────

export type BacSeat = Base & { bet: number; on: BacBet | null; payout?: number };
export type BacTableState = {
  kind: 'baccarat_table';
  seats: BacSeat[];
  phase: 'betting' | 'result';
  deadline: number | null;
  last: BacResult | null;
  /** これまでの勝ち（新しいものが後ろ） */
  history: BacBet[];
};

const bacSeat = (w: Who, now: number): BacSeat => ({ ...w, lastActive: now, bet: 0, on: null });

function bacRound(state: BacTableState, ctx: Ctx): Step<BacTableState> {
  const s = structuredClone(state);
  const r = bacDeal(ctx.rng);
  const credits: Credit[] = [];
  const records: PlayRecord[] = [];
  for (const p of s.seats.filter((x) => x.bet > 0 && x.on)) {
    p.payout = bacPayout(p.on!, r, p.bet);
    if (p.payout > 0) credits.push({ memberId: p.id, amount: p.payout, reason: 'casino_win' });
    records.push({ memberId: p.id, game: 'baccarat', bet: p.bet, payout: p.payout });
  }
  s.last = r;
  s.history = [...s.history, r.winner].slice(-30);
  s.phase = 'result';
  s.deadline = ctx.now + (RESULT_SECONDS + 2) * 1000;
  return ok(s, { credits, records });
}

export const baccaratTable: TableEngine<BacTableState> = {
  kind: 'baccarat_table',
  maxSeats: 8,
  create: (host, _f, ctx) => ok({ kind: 'baccarat_table', seats: [bacSeat(host, ctx.now)], phase: 'betting', deadline: null, last: null, history: [] }),
  join(s, who, _f, ctx) {
    if (s.seats.some((x) => x.id === who.id)) return ok(s);
    if (s.seats.length >= this.maxSeats) return fail('full');
    return ok({ ...s, seats: [...s.seats, bacSeat(who, ctx.now)] });
  },
  leave(s, id) {
    const seat = s.seats.find((x) => x.id === id);
    if (!seat) return fail('not_seated');
    const seats = s.seats.filter((x) => x.id !== id);
    const refund = s.phase === 'betting' && seat.bet > 0;
    return ok({ ...s, seats, deadline: s.phase === 'betting' && seats.every((x) => x.bet === 0) ? null : s.deadline }, refund ? { credits: [{ memberId: id, amount: seat.bet, reason: 'casino_refund' }] } : undefined);
  },
  act(state, id, f, ctx) {
    const s = structuredClone(state);
    const seat = s.seats.find((x) => x.id === id);
    if (!seat) return fail('not_seated');
    seat.lastActive = ctx.now;
    if (str(f, 'action') !== 'bet' || s.phase !== 'betting' || seat.bet > 0) return fail('invalid');
    const on = str(f, 'on') as BacBet;
    if (!BAC_BETS.includes(on)) return fail('invalid');
    const bet = intOf(f, 'bet');
    if (!validBet(ctx.cfg, bet)) return fail('bad_bet');
    seat.bet = bet;
    seat.on = on;
    if (s.deadline === null) s.deadline = ctx.now + BET_SECONDS * 1000;
    const debit = { debits: [{ memberId: id, amount: bet, reason: 'casino_bet' as const, limited: true }] };
    if (s.seats.every((x) => x.bet > 0)) {
      const r = bacRound(s, ctx);
      return r.ok ? ok(r.state, { ...debit, ...r.fx }) : r;
    }
    return ok(s, debit);
  },
  tick(s, ctx) {
    if (s.phase === 'betting') {
      if (s.deadline !== null && s.deadline <= ctx.now && s.seats.some((x) => x.bet > 0)) return bacRound(s, ctx);
      const idle = s.seats.filter((x) => x.bet === 0 && x.lastActive + IDLE_MINUTES * 60_000 <= ctx.now);
      return idle.length ? ok({ ...s, seats: s.seats.filter((x) => !idle.includes(x)) }) : null;
    }
    if (s.deadline === null || s.deadline > ctx.now) return null;
    return ok({
      ...s,
      phase: 'betting',
      deadline: null,
      seats: s.seats.map((x) => ({ ...x, lastActive: x.bet > 0 ? ctx.now : x.lastActive, bet: 0, on: null, payout: undefined })),
    });
  },
  due: (s) => (s.phase === 'betting' ? minDue(s.deadline, idleDue(s.seats, (x) => (x as BacSeat).bet > 0)) : s.deadline),
  seats: (s) => s.seats.map((x) => x.id),
  closed: (s) => s.seats.length === 0,
};

// ───────── 🎡 ルーレット卓 ─────────

export const ROULETTE_MAX_BETS = 10;
export type RlBet = { on: RouletteBet; amount: number };
export type RlSeat = Base & { bets: RlBet[]; ready: boolean; payout?: number };
export type RlTableState = {
  kind: 'roulette_table';
  seats: RlSeat[];
  phase: 'betting' | 'result';
  deadline: number | null;
  number: number | null;
  history: number[];
};

const rlSeat = (w: Who, now: number): RlSeat => ({ ...w, lastActive: now, bets: [], ready: false });
const rlTotal = (x: RlSeat) => x.bets.reduce((n, b) => n + b.amount, 0);

function rlRound(state: RlTableState, ctx: Ctx): Step<RlTableState> {
  const s = structuredClone(state);
  const n = rouletteSpin(ctx.rng);
  const credits: Credit[] = [];
  const records: PlayRecord[] = [];
  for (const p of s.seats.filter((x) => x.bets.length)) {
    p.payout = p.bets.reduce((sum, b) => sum + b.amount * rouletteMultiplier(b.on, n), 0);
    if (p.payout > 0) credits.push({ memberId: p.id, amount: p.payout, reason: 'casino_win' });
    records.push({ memberId: p.id, game: 'roulette', bet: rlTotal(p), payout: p.payout });
  }
  s.number = n;
  s.history = [...s.history, n].slice(-20);
  s.phase = 'result';
  s.deadline = ctx.now + (RESULT_SECONDS + 3) * 1000;
  return ok(s, { credits, records });
}

export const rouletteTable: TableEngine<RlTableState> = {
  kind: 'roulette_table',
  maxSeats: 8,
  create: (host, _f, ctx) => ok({ kind: 'roulette_table', seats: [rlSeat(host, ctx.now)], phase: 'betting', deadline: null, number: null, history: [] }),
  join(s, who, _f, ctx) {
    if (s.seats.some((x) => x.id === who.id)) return ok(s);
    if (s.seats.length >= this.maxSeats) return fail('full');
    return ok({ ...s, seats: [...s.seats, rlSeat(who, ctx.now)] });
  },
  leave(s, id) {
    const seat = s.seats.find((x) => x.id === id);
    if (!seat) return fail('not_seated');
    const seats = s.seats.filter((x) => x.id !== id);
    const refund = s.phase === 'betting' ? rlTotal(seat) : 0;
    return ok({ ...s, seats, deadline: s.phase === 'betting' && seats.every((x) => !x.bets.length) ? null : s.deadline }, refund ? { credits: [{ memberId: id, amount: refund, reason: 'casino_refund' }] } : undefined);
  },
  act(state, id, f, ctx) {
    const s = structuredClone(state);
    const seat = s.seats.find((x) => x.id === id);
    if (!seat) return fail('not_seated');
    seat.lastActive = ctx.now;
    if (s.phase !== 'betting') return fail('invalid');
    const a = str(f, 'action');
    if (a === 'bet') {
      const on = str(f, 'on');
      const amount = intOf(f, 'bet');
      if (!isRouletteBet(on)) return fail('invalid');
      if (!validBet(ctx.cfg, amount)) return fail('bad_bet');
      if (seat.bets.length >= ROULETTE_MAX_BETS) return fail('too_many');
      if (rlTotal(seat) + amount > ctx.cfg.casino.maxBet * ROULETTE_MAX_BETS) return fail('bad_bet');
      seat.bets.push({ on, amount });
      seat.ready = false;
      if (s.deadline === null) s.deadline = ctx.now + (BET_SECONDS + 10) * 1000;
      return ok(s, { debits: [{ memberId: id, amount, reason: 'casino_bet', limited: true }] });
    }
    if (a === 'clear') {
      const refund = rlTotal(seat);
      seat.bets = [];
      seat.ready = false;
      if (s.seats.every((x) => !x.bets.length)) s.deadline = null;
      return ok(s, refund ? { credits: [{ memberId: id, amount: refund, reason: 'casino_refund' }] } : undefined);
    }
    if (a === 'ready') {
      if (!seat.bets.length) return fail('invalid');
      seat.ready = true;
      // 賭けた人がみんな「回す」を押したら、すぐ回す（賭けていない人は待たない）
      const betting = s.seats.filter((x) => x.bets.length);
      if (betting.every((x) => x.ready)) return rlRound(s, ctx);
      return ok(s);
    }
    return fail('invalid');
  },
  tick(s, ctx) {
    if (s.phase === 'betting') {
      if (s.deadline !== null && s.deadline <= ctx.now && s.seats.some((x) => x.bets.length)) return rlRound(s, ctx);
      const idle = s.seats.filter((x) => !x.bets.length && x.lastActive + IDLE_MINUTES * 60_000 <= ctx.now);
      return idle.length ? ok({ ...s, seats: s.seats.filter((x) => !idle.includes(x)) }) : null;
    }
    if (s.deadline === null || s.deadline > ctx.now) return null;
    return ok({
      ...s,
      phase: 'betting',
      deadline: null,
      seats: s.seats.map((x) => ({ ...x, lastActive: x.bets.length ? ctx.now : x.lastActive, bets: [], ready: false, payout: undefined })),
    });
  },
  due: (s) => (s.phase === 'betting' ? minDue(s.deadline, idleDue(s.seats, (x) => (x as RlSeat).bets.length > 0)) : s.deadline),
  seats: (s) => s.seats.map((x) => x.id),
  closed: (s) => s.seats.length === 0,
};

export type { Form };

import { CHIN_MAX_LOSS, chinMoney, chinSettle, parentDecides, rollOnce, rollTurn, turnDone, turnHand, type ChinRoll } from '../chinchiro.js';
import { BET_SECONDS, IDLE_MINUTES, RESULT_SECONDS, TURN_SECONDS } from './dealer.js';
import { fail, intOf, ok, paceMult, paceOf, str, type Credit, type Ctx, type Pace, type PlayRecord, type Step, type TableEngine, type Who } from './types.js';

/**
 * 🎲 ちんちろ卓（1〜6 人）。みんなで同じ親（胴元）にサイコロで挑む。
 * - 賭けの時間: だれかが賭けてから BET_SECONDS 秒（みんな賭けたらすぐ）
 * - 親が先に振る。親がピンゾロ・ゾロ目・シゴロ・ヒフミ・目なしなら、子は振らずに決まる
 * - 親が目なら、子が 1 人ずつ「振る」（3 回まで。持ち時間を過ぎたら自動で振る）
 * - 負けは最大で賭けの 5 倍なので、賭けるときに 5 倍を預かる（賭け分は casino_bet、残りの 4 倍は casino_hold）。
 *   終わったら、勝ち分と、預かりの使わなかった分を返す
 */

export type ChSeat = Who & { lastActive: number; bet: number; rolls: ChinRoll[]; done: boolean; left?: boolean; mult?: number; payout?: number };
export type ChTableState = {
  kind: 'chinchiro_table';
  seats: ChSeat[];
  phase: 'betting' | 'rolling' | 'result';
  deadline: number | null;
  parent: ChinRoll[];
  turn: string | null;
  round: number;
  pace?: Pace;
};

const MAX_SEATS = 6;
const seatOf = (w: Who, now: number): ChSeat => ({ ...w, lastActive: now, bet: 0, rolls: [], done: false });
/** 預かる銭（賭けの 5 倍）の内訳 */
const holdOf = (bet: number) => bet * (CHIN_MAX_LOSS - 1);

function startRound(state: ChTableState, ctx: Ctx): Step<ChTableState> {
  const s: ChTableState = structuredClone(state);
  s.round++;
  s.parent = rollTurn(ctx.rng);
  for (const x of s.seats) {
    x.rolls = [];
    x.done = x.bet === 0;
  }
  if (parentDecides(turnHand(s.parent))) return finish(s, ctx);
  s.phase = 'rolling';
  return nextTurn(s, ctx);
}

function nextTurn(s: ChTableState, ctx: Ctx): Step<ChTableState> {
  const next = s.seats.find((x) => x.bet > 0 && !x.done);
  if (!next) return finish(s, ctx);
  s.turn = next.id;
  s.deadline = ctx.now + TURN_SECONDS * 1000 * paceMult(s);
  return ok(s);
}

function finish(s: ChTableState, ctx: Ctx): Step<ChTableState> {
  const parent = turnHand(s.parent);
  const decided = parentDecides(parent);
  const credits: Credit[] = [];
  const records: PlayRecord[] = [];
  for (const x of s.seats.filter((y) => y.bet > 0)) {
    x.mult = chinSettle(parent, decided ? null : turnHand(x.rolls));
    const { stake, payout } = chinMoney(x.bet, x.mult);
    x.payout = payout;
    // 預かり（5 倍）から、負けた分を引いて返す
    const back = x.bet + holdOf(x.bet) - stake;
    if (payout > 0) credits.push({ memberId: x.id, amount: payout, reason: 'casino_win' });
    if (back > 0) credits.push({ memberId: x.id, amount: back, reason: 'casino_refund' });
    records.push({ memberId: x.id, game: 'chinchiro_table', bet: stake, payout });
  }
  s.phase = 'result';
  s.turn = null;
  s.deadline = ctx.now + RESULT_SECONDS * 1000 + 2500;
  return ok(s, { credits, records });
}

function afterResult(state: ChTableState, now: number): ChTableState {
  const s = structuredClone(state);
  s.seats = s.seats.filter((x) => !x.left).map((x) => ({ ...x, bet: 0, rolls: [], done: false, mult: undefined, payout: undefined, lastActive: x.bet > 0 ? now : x.lastActive }));
  s.parent = [];
  s.phase = 'betting';
  s.deadline = null;
  return s;
}

export const chinchiroTable: TableEngine<ChTableState> = {
  kind: 'chinchiro_table',
  maxSeats: MAX_SEATS,
  create: (host, f, ctx) => ok({ kind: 'chinchiro_table', seats: [seatOf(host, ctx.now)], phase: 'betting', deadline: null, parent: [], turn: null, round: 0, pace: paceOf(f) }),
  join(s, who, _f, ctx) {
    if (s.seats.some((x) => x.id === who.id)) return ok(s);
    if (s.seats.length >= MAX_SEATS) return fail('full');
    return ok({ ...s, seats: [...s.seats, seatOf(who, ctx.now)] });
  },
  leave(state, id, ctx) {
    const s = structuredClone(state);
    const seat = s.seats.find((x) => x.id === id);
    if (!seat) return fail('not_seated');
    if (s.phase === 'betting') {
      s.seats = s.seats.filter((x) => x.id !== id);
      if (s.seats.every((x) => x.bet === 0)) s.deadline = null;
      return ok(s, seat.bet > 0 ? { credits: [{ memberId: id, amount: seat.bet + holdOf(seat.bet), reason: 'casino_refund' }] } : undefined);
    }
    if (s.phase === 'result' || seat.bet === 0) {
      s.seats = s.seats.filter((x) => x.id !== id);
      return ok(s);
    }
    // 勝負の途中: 残りは自動で振って、終わったら席を立つ
    seat.left = true;
    if (!seat.done) {
      seat.rolls = rollTurnFrom(seat.rolls, ctx);
      seat.done = true;
    }
    return s.turn === id ? nextTurn(s, ctx) : ok(s);
  },
  act(state, id, f, ctx) {
    const s = structuredClone(state);
    const seat = s.seats.find((x) => x.id === id);
    if (!seat) return fail('not_seated');
    seat.lastActive = ctx.now;
    const a = str(f, 'action');
    if (a === 'bet') {
      if (s.phase !== 'betting' || seat.bet > 0) return fail('invalid');
      const bet = intOf(f, 'bet');
      if (!Number.isInteger(bet) || bet < ctx.cfg.casino.minBet || bet > ctx.cfg.casino.maxBet) return fail('bad_bet');
      seat.bet = bet;
      if (s.deadline === null) s.deadline = ctx.now + BET_SECONDS * 1000 * paceMult(s);
      const debits = {
        debits: [
          { memberId: id, amount: bet, reason: 'casino_bet' as const, limited: true },
          { memberId: id, amount: holdOf(bet), reason: 'casino_hold' as const, limited: false },
        ],
      };
      if (s.seats.every((x) => x.bet > 0)) {
        const r = startRound(s, ctx);
        return r.ok ? ok(r.state, { ...debits, credits: r.fx?.credits, records: r.fx?.records }) : r;
      }
      return ok(s, debits);
    }
    if (a === 'roll') {
      if (s.phase !== 'rolling' || s.turn !== id || seat.done) return fail('not_your_turn');
      seat.rolls = rollOnce(seat.rolls, ctx.rng);
      if (turnDone(seat.rolls)) {
        seat.done = true;
        return nextTurn(s, ctx);
      }
      return ok({ ...s, deadline: ctx.now + TURN_SECONDS * 1000 * paceMult(s) });
    }
    return fail('invalid');
  },
  tick(s, ctx) {
    if (s.phase === 'betting') {
      if (s.deadline !== null && s.deadline <= ctx.now && s.seats.some((x) => x.bet > 0)) return startRound(s, ctx);
      const idle = s.seats.filter((x) => x.bet === 0 && x.lastActive + IDLE_MINUTES * 60_000 <= ctx.now);
      if (idle.length) return ok({ ...s, seats: s.seats.filter((x) => !idle.includes(x)) });
      return null;
    }
    if (s.deadline === null || s.deadline > ctx.now) return null;
    if (s.phase === 'rolling') {
      // 時間切れ: 残りを自動で振る
      const st = structuredClone(s);
      const seat = st.seats.find((x) => x.id === st.turn);
      if (seat) {
        seat.rolls = rollTurnFrom(seat.rolls, ctx);
        seat.done = true;
      }
      return nextTurn(st, ctx);
    }
    return ok(afterResult(s, ctx.now));
  },
  due: (s) => {
    if (s.phase !== 'betting') return s.deadline;
    const idle = s.seats.filter((x) => x.bet === 0).map((x) => x.lastActive + IDLE_MINUTES * 60_000);
    const v = [s.deadline, ...idle].filter((x): x is number => x !== null);
    return v.length ? Math.min(...v) : null;
  },
  seats: (s) => s.seats.filter((x) => !x.left).map((x) => x.id),
  closed: (s) => s.seats.length === 0,
};

/** 途中まで振った番を、最後まで振る */
function rollTurnFrom(rolls: ChinRoll[], ctx: Ctx): ChinRoll[] {
  let r = rolls;
  while (!turnDone(r)) r = rollOnce(r, ctx.rng);
  return r;
}

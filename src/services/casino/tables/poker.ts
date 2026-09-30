import { shuffledShoe } from '../cards.js';
import { bestHand, handName } from './pokerHands.js';
import { fail, intOf, ok, str, type Credit, type Ctx, type Form, type Step, type TableEngine, type Who } from './types.js';

/**
 * ポーカー（テキサスホールデム・ノーリミット）。2〜6 人。
 * 座るときに銭を持ち込み（チップ）、立つときにチップを銭に戻す。胴元の取り分はない（メンバー同士のやりとり）。
 * - 2 人以上そろうと START_SECONDS 秒で配る。ボタンは毎回ひとつ進む（2 人のときはボタンがスモールブラインド）
 * - 持ち時間 ACT_SECONDS 秒。過ぎたらチェック（できなければフォールド）。2 回続けて過ぎたら「休み」にする
 * - サイドポットあり。同じ強さなら分ける（端数はボタンの次の人から）
 */

export const ACT_SECONDS = 30;
export const START_SECONDS = 5;
export const SHOW_SECONDS = 8;
export const POKER_SEATS = 6;
/** 持ち込みはビッグブラインドの何倍から何倍まで */
export const BUYIN_MIN_BB = 20;
export const BUYIN_MAX_BB = 100;
/** 手の合間に、この分動いていない人は立たせて、チップを銭に戻す */
export const IDLE_MINUTES = 30;

export type PSeat = Who & {
  chips: number;
  hole: number[];
  /** この回（ストリート）に出した分 */
  bet: number;
  /** この手で出した合計 */
  total: number;
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  acted: boolean;
  sittingOut: boolean;
  timeouts: number;
  leaving: boolean;
  /** 最後に動いた時刻（休んだままの人を立たせる） */
  lastActive?: number;
};

export type PokerResult = {
  hand: number;
  winners: { id: string; name: string; amount: number; hand?: string }[];
  shown: { id: string; name: string; hole: number[]; hand: string }[];
  board: number[];
};

export type PokerState = {
  kind: 'poker';
  sb: number;
  bb: number;
  seats: (PSeat | null)[];
  button: number;
  phase: 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
  board: number[];
  deck: number[];
  turn: number | null;
  currentBet: number;
  minRaise: number;
  deadline: number | null;
  hand: number;
  result: PokerResult | null;
  log: string[];
};

/** ビッグブラインドの選び方（最低の賭けから） */
export const blindOptions = (minBet: number, maxBet: number) => [minBet, minBet * 2, minBet * 5, minBet * 10, minBet * 50].filter((bb, i, a) => bb >= 2 && a.indexOf(bb) === i && bb * BUYIN_MIN_BB <= maxBet * 20);

const buyRange = (s: Pick<PokerState, 'bb'>) => ({ min: s.bb * BUYIN_MIN_BB, max: s.bb * BUYIN_MAX_BB });
const seatOf = (s: PokerState, id: string) => s.seats.findIndex((x) => x?.id === id);
const canPlay = (x: PSeat | null): x is PSeat => Boolean(x && !x.sittingOut && !x.leaving && x.chips > 0);
const live = (x: PSeat | null): x is PSeat => Boolean(x && x.inHand && !x.folded);
const canAct = (x: PSeat | null): x is PSeat => live(x) && !x.allIn;
const log = (s: PokerState, line: string) => {
  s.log = [...s.log, line].slice(-14);
};

/** from の次から回って、条件に合う席 */
function nextSeat(s: PokerState, from: number, pred: (x: PSeat | null) => boolean): number | null {
  for (let i = 1; i <= POKER_SEATS; i++) {
    const j = (from + i) % POKER_SEATS;
    if (pred(s.seats[j]!)) return j;
  }
  return null;
}

/** 待っているとき: 2 人以上いれば配る時刻を決める */
function arm(s: PokerState, now: number): PokerState {
  if (s.phase !== 'waiting') return s;
  const n = s.seats.filter(canPlay).length;
  s.deadline = n >= 2 ? (s.deadline ?? now + START_SECONDS * 1000) : null;
  return s;
}

function pay(seat: PSeat, amount: number): number {
  const p = Math.min(seat.chips, amount);
  seat.chips -= p;
  seat.bet += p;
  seat.total += p;
  if (seat.chips === 0) seat.allIn = true;
  return p;
}

function startHand(state: PokerState, ctx: Ctx): Step<PokerState> {
  const s = structuredClone(state);
  const players = s.seats.map((x, i) => (canPlay(x) ? i : -1)).filter((i) => i >= 0);
  if (players.length < 2) return ok(arm({ ...s, deadline: null }, ctx.now));
  for (const x of s.seats) if (x) Object.assign(x, { hole: [], bet: 0, total: 0, inHand: false, folded: false, allIn: false, acted: false });
  for (const i of players) s.seats[i]!.inHand = true;
  s.hand++;
  s.button = nextSeat(s, s.button < 0 ? POKER_SEATS - 1 : s.button, (x) => Boolean(x?.inHand))!;
  const heads = players.length === 2;
  const sbIdx = heads ? s.button : nextSeat(s, s.button, (x) => Boolean(x?.inHand))!;
  const bbIdx = nextSeat(s, sbIdx, (x) => Boolean(x?.inHand))!;
  s.deck = shuffledShoe(1, ctx.rng);
  s.board = [];
  s.result = null;
  pay(s.seats[sbIdx]!, s.sb);
  pay(s.seats[bbIdx]!, s.bb);
  for (let r = 0; r < 2; r++) for (const i of players) s.seats[i]!.hole.push(s.deck.pop()!);
  s.currentBet = Math.max(s.seats[sbIdx]!.bet, s.seats[bbIdx]!.bet);
  s.minRaise = s.bb;
  s.phase = 'preflop';
  log(s, `— 第 ${s.hand} 手（ボタン: ${s.seats[s.button]!.name}）—`);
  const first = nextSeat(s, bbIdx, canAct);
  return proceed(s, ctx, first === null ? null : bbIdx);
}

/** 誰かが動いたあと: 1 人残り → 総取り / 回が終わった → 次の回 / まだ → 次の人 */
function proceed(s: PokerState, ctx: Ctx, from: number | null): Step<PokerState> {
  const alive = s.seats.filter(live);
  if (alive.length === 1) return awardSingle(s, ctx, alive[0]!);
  const need = (x: PSeat | null) => canAct(x) && (!x.acted || x.bet < s.currentBet);
  const next = from === null ? null : nextSeat(s, from, need);
  if (next !== null) {
    s.turn = next;
    s.deadline = ctx.now + ACT_SECONDS * 1000;
    return ok(s);
  }
  return nextStreet(s, ctx);
}

function nextStreet(s: PokerState, ctx: Ctx): Step<PokerState> {
  for (const x of s.seats) if (x) Object.assign(x, { bet: 0, acted: false });
  s.currentBet = 0;
  s.minRaise = s.bb;
  const deal = (n: number) => {
    s.deck.pop(); // バーン
    for (let i = 0; i < n; i++) s.board.push(s.deck.pop()!);
  };
  if (s.phase === 'preflop') {
    deal(3);
    s.phase = 'flop';
  } else if (s.phase === 'flop') {
    deal(1);
    s.phase = 'turn';
  } else if (s.phase === 'turn') {
    deal(1);
    s.phase = 'river';
  } else return showdown(s, ctx);
  // 動ける人が 1 人以下なら、最後まで開けて勝負
  if (s.seats.filter(canAct).length <= 1) return nextStreet(s, ctx);
  s.turn = null;
  return proceed(s, ctx, s.button);
}

function awardSingle(s: PokerState, ctx: Ctx, winner: PSeat): Step<PokerState> {
  const pot = s.seats.reduce((n, x) => n + (x?.total ?? 0), 0);
  winner.chips += pot;
  s.result = { hand: s.hand, winners: [{ id: winner.id, name: winner.name, amount: pot }], shown: [], board: [...s.board] };
  log(s, `${winner.name} が ${pot} を獲得（ほかの人が降りた）`);
  return endHand(s, ctx, 4);
}

/** サイドポットを分けて配る */
export function settlePots(seats: (PSeat | null)[], board: number[], button: number): { winners: Map<number, number>; scores: Map<number, number> } {
  const contrib = seats.map((x, i) => ({ i, total: x?.total ?? 0, live: live(x) })).filter((c) => c.total > 0);
  const scores = new Map<number, number>();
  for (const c of contrib) if (c.live) scores.set(c.i, bestHand([...seats[c.i]!.hole, ...board]).score);
  const levels = [...new Set(contrib.map((c) => c.total))].sort((a, b) => a - b);
  const winners = new Map<number, number>();
  let prev = 0;
  for (const level of levels) {
    const part = contrib.reduce((n, c) => n + Math.max(0, Math.min(c.total, level) - prev), 0);
    let eligible = contrib.filter((c) => c.live && c.total >= level).map((c) => c.i);
    if (!eligible.length) {
      // だれも受けていない分（出しすぎた分）は、残っている中で一番多く出した人へ
      const max = Math.max(...contrib.filter((c) => c.live).map((c) => c.total));
      eligible = contrib.filter((c) => c.live && c.total === max).map((c) => c.i);
    }
    const best = Math.max(...eligible.map((i) => scores.get(i)!));
    const tops = eligible.filter((i) => scores.get(i) === best);
    // 端数はボタンの次の人から
    tops.sort((a, b) => ((a - button + POKER_SEATS - 1) % POKER_SEATS) - ((b - button + POKER_SEATS - 1) % POKER_SEATS));
    const each = Math.floor(part / tops.length);
    let rest = part - each * tops.length;
    for (const i of tops) {
      winners.set(i, (winners.get(i) ?? 0) + each + (rest > 0 ? 1 : 0));
      if (rest > 0) rest--;
    }
    prev = level;
  }
  return { winners, scores };
}

function showdown(s: PokerState, ctx: Ctx): Step<PokerState> {
  const { winners, scores } = settlePots(s.seats, s.board, s.button);
  for (const [i, amount] of winners) s.seats[i]!.chips += amount;
  s.result = {
    hand: s.hand,
    winners: [...winners].map(([i, amount]) => ({ id: s.seats[i]!.id, name: s.seats[i]!.name, amount, hand: handName(scores.get(i)!) })),
    shown: [...scores].map(([i, sc]) => ({ id: s.seats[i]!.id, name: s.seats[i]!.name, hole: s.seats[i]!.hole, hand: handName(sc) })),
    board: [...s.board],
  };
  for (const w of s.result.winners) log(s, `${w.name} が ${w.amount} を獲得（${w.hand}）`);
  return endHand(s, ctx, SHOW_SECONDS);
}

function endHand(s: PokerState, ctx: Ctx, seconds: number): Step<PokerState> {
  s.phase = 'showdown';
  s.turn = null;
  s.deadline = ctx.now + seconds * 1000;
  return ok(s);
}

/** 手が終わって少したったら: 立つ人を立たせ、次の手を待つ */
function afterHand(state: PokerState, ctx: Ctx): Step<PokerState> {
  const s = structuredClone(state);
  const credits: Credit[] = [];
  s.seats = s.seats.map((x) => {
    if (!x) return null;
    if (x.leaving) {
      if (x.chips > 0) credits.push({ memberId: x.id, amount: x.chips, reason: 'casino_cashout' });
      return null;
    }
    return { ...x, hole: [], bet: 0, total: 0, inHand: false, folded: false, allIn: false, acted: false, sittingOut: x.sittingOut || x.timeouts >= 2 };
  });
  s.phase = 'waiting';
  s.board = [];
  s.deadline = null;
  s.currentBet = 0;
  return ok(arm(s, ctx.now), credits.length ? { credits } : undefined);
}

function doAction(s: PokerState, i: number, action: string, amount: number, ctx: Ctx): Step<PokerState> {
  const x = s.seats[i]!;
  const toCall = s.currentBet - x.bet;
  if (action === 'fold') {
    x.folded = true;
    log(s, `${x.name}: フォールド`);
  } else if (action === 'check') {
    if (toCall > 0) return fail('invalid');
    log(s, `${x.name}: チェック`);
  } else if (action === 'call') {
    if (toCall <= 0) return fail('invalid');
    const p = pay(x, toCall);
    log(s, `${x.name}: コール ${p}${x.allIn ? '（オールイン）' : ''}`);
  } else if (action === 'raise' || action === 'allin') {
    const max = x.bet + x.chips;
    const to = action === 'allin' ? max : amount;
    if (!Number.isInteger(to) || to > max) return fail('invalid');
    if (to <= s.currentBet) {
      if (action !== 'allin') return fail('invalid');
      pay(x, to - x.bet);
      log(s, `${x.name}: オールイン ${to}`);
    } else {
      if (to < s.currentBet + s.minRaise && to < max) return fail('min_raise');
      if (to - s.currentBet >= s.minRaise) s.minRaise = to - s.currentBet;
      s.currentBet = to;
      pay(x, to - x.bet);
      for (const o of s.seats) if (o && o !== x) o.acted = false;
      log(s, `${x.name}: ${s.currentBet === to && toCall === 0 && s.board.length ? 'ベット' : 'レイズ'} → ${to}${x.allIn ? '（オールイン）' : ''}`);
    }
  } else return fail('invalid');
  x.acted = true;
  return proceed(s, ctx, i);
}

const newSeat = (who: Who, chips: number, now: number): PSeat => ({ ...who, chips, hole: [], bet: 0, total: 0, inHand: false, folded: false, allIn: false, acted: false, sittingOut: false, timeouts: 0, leaving: false, lastActive: now });
const idleAt = (x: PSeat) => (x.lastActive ?? 0) + IDLE_MINUTES * 60_000;
/** 手の合間に、長く動いていない人（休んでいる・ひとりで待っている・チップがない） */
const idleSeats = (s: PokerState, now: number) => s.seats.filter((x): x is PSeat => Boolean(x && idleAt(x) <= now));

export const poker: TableEngine<PokerState> = {
  kind: 'poker',
  maxSeats: POKER_SEATS,
  create(host, f, ctx) {
    const bb = intOf(f, 'bb');
    if (!blindOptions(ctx.cfg.casino.minBet, ctx.cfg.casino.maxBet).includes(bb)) return fail('bad_bet');
    const s: PokerState = {
      kind: 'poker',
      sb: Math.max(1, Math.floor(bb / 2)),
      bb,
      seats: Array<PSeat | null>(POKER_SEATS).fill(null),
      button: -1,
      phase: 'waiting',
      board: [],
      deck: [],
      turn: null,
      currentBet: 0,
      minRaise: bb,
      deadline: null,
      hand: 0,
      result: null,
      log: [],
    };
    return this.join(s, host, f, ctx);
  },
  join(state, who, f, ctx) {
    if (seatOf(state, who.id) >= 0) return ok(state);
    const empty = state.seats.findIndex((x) => x === null);
    if (empty < 0) return fail('full');
    const buy = intOf(f, 'buyin');
    const r = buyRange(state);
    if (!Number.isInteger(buy) || buy < r.min || buy > r.max) return fail('bad_bet');
    const s = structuredClone(state);
    s.seats[empty] = newSeat(who, buy, ctx.now);
    log(s, `${who.name} が座りました（${buy}）`);
    return ok(arm(s, ctx.now), { debits: [{ memberId: who.id, amount: buy, reason: 'casino_buyin', limited: false }] });
  },
  leave(state, id, ctx) {
    const i = seatOf(state, id);
    if (i < 0) return fail('not_seated');
    const s = structuredClone(state);
    const x = s.seats[i]!;
    // 手の途中（降りていても、出した分はポットに残るので席は残す）
    const midHand = x.inHand && s.phase !== 'waiting' && s.phase !== 'showdown';
    if (!midHand) {
      s.seats[i] = null;
      log(s, `${x.name} が席を立ちました`);
      if (s.phase === 'waiting') arm(s, ctx.now);
      return ok(s, x.chips > 0 ? { credits: [{ memberId: id, amount: x.chips, reason: 'casino_cashout' }] } : undefined);
    }
    // 手の途中: 降りて、終わったら立つ
    x.leaving = true;
    if (!x.folded) {
      if (s.turn === i) return doAction(s, i, 'fold', 0, ctx);
      x.folded = true;
      log(s, `${x.name}: フォールド（席を立つ）`);
      const alive = s.seats.filter(live);
      if (alive.length === 1) return awardSingle(s, ctx, alive[0]!);
    }
    return ok(s);
  },
  act(state, id, f, ctx) {
    const i = seatOf(state, id);
    if (i < 0) return fail('not_seated');
    const s = structuredClone(state);
    const x = s.seats[i]!;
    x.lastActive = ctx.now;
    const a = str(f, 'action') ?? '';
    if (a === 'sitout' || a === 'sitin') {
      x.sittingOut = a === 'sitout';
      x.timeouts = 0;
      return ok(arm(s, ctx.now));
    }
    if (a === 'rebuy') {
      if (x.inHand && s.phase !== 'waiting' && s.phase !== 'showdown') return fail('invalid');
      const add = intOf(f, 'amount');
      const r = buyRange(s);
      if (!Number.isInteger(add) || add <= 0 || x.chips + add > r.max) return fail('bad_bet');
      x.chips += add;
      x.sittingOut = false;
      log(s, `${x.name} がチップを足しました（+${add}）`);
      return ok(arm(s, ctx.now), { debits: [{ memberId: id, amount: add, reason: 'casino_buyin', limited: false }] });
    }
    if (s.turn !== i || !['preflop', 'flop', 'turn', 'river'].includes(s.phase)) return fail('not_your_turn');
    x.timeouts = 0;
    return doAction(s, i, a, intOf(f, 'amount'), ctx);
  },
  tick(state, ctx) {
    if (state.phase === 'waiting') {
      const idle = idleSeats(state, ctx.now);
      if (idle.length) {
        const s = structuredClone(state);
        const ids = new Set(idle.map((x) => x.id));
        s.seats = s.seats.map((x) => (x && ids.has(x.id) ? null : x));
        for (const x of idle) log(s, `${x.name} は休んだままなので、席を立ちました`);
        const credits = idle.filter((x) => x.chips > 0).map((x) => ({ memberId: x.id, amount: x.chips, reason: 'casino_cashout' as const }));
        return ok(arm(s, ctx.now), credits.length ? { credits } : undefined);
      }
    }
    if (state.deadline === null || state.deadline > ctx.now) return null;
    if (state.phase === 'waiting') return startHand(state, ctx);
    if (state.phase === 'showdown') return afterHand(state, ctx);
    const t = state.turn;
    if (t === null) return null;
    const s = structuredClone(state);
    const x = s.seats[t]!;
    x.timeouts++;
    log(s, `${x.name}: 時間切れ`);
    return doAction(s, t, s.currentBet - x.bet > 0 ? 'fold' : 'check', 0, ctx);
  },
  due(s) {
    if (s.phase !== 'waiting') return s.deadline;
    const idle = s.seats.filter((x): x is PSeat => Boolean(x)).map(idleAt);
    const all = [s.deadline, ...idle].filter((v): v is number => v !== null);
    return all.length ? Math.min(...all) : null;
  },
  seats: (s) => s.seats.filter((x): x is PSeat => Boolean(x && !x.leaving)).map((x) => x.id),
  closed: (s) => s.seats.every((x) => x === null),
};

/** 人から見える卓（ほかの人の手札は、見せ合ったときだけ） */
export function pokerView(s: PokerState, viewer: string) {
  const me = seatOf(s, viewer);
  const x = me >= 0 ? s.seats[me]! : undefined;
  const toCall = x ? Math.max(0, s.currentBet - x.bet) : 0;
  const pot = s.seats.reduce((n, y) => n + (y?.total ?? 0), 0);
  const myTurn = x !== undefined && s.turn === me && ['preflop', 'flop', 'turn', 'river'].includes(s.phase);
  const minTo = Math.min(s.currentBet + s.minRaise, x ? x.bet + x.chips : 0);
  return { me, seat: x, toCall, pot, myTurn, minTo, maxTo: x ? x.bet + x.chips : 0, buy: buyRange(s) };
}

export type { Form };

import type { TableKind } from '../../../config.js';
import { rankOf, shuffledShoe, type Rng } from '../cards.js';
import { fail, intOf, list, ok, str, type Credit, type Ctx, type Form, type Step, type TableEngine, type Who } from './types.js';

/**
 * みんなで遊ぶトランプ（大富豪・ババ抜き）。部屋を作った人が参加費を決め、そろったら作った人が始める。
 * 参加費は座るときに預かり、終わったら上がった順に配る（0 銭なら賭けない）。
 * - 相手待ちのまま LOBBY_MINUTES 分たつと、部屋を閉じて返す
 * - 持ち時間を過ぎたら自動で動かす。途中で抜けた人は、すぐ自動で動かす
 */

export const LOBBY_MINUTES = 30;
export const JOKER = 52;
const DONE_SECONDS = 90;

export type PartySeat = Who & { hand: number[]; out: boolean; gone: boolean; timeouts: number };
type PartyBase = {
  seats: PartySeat[];
  entry: number;
  phase: 'lobby' | 'playing' | 'done' | 'closed';
  deadline: number | null;
  createdAt: number;
  turn: number | null;
  /** 上がった順（最後は負け） */
  order: string[];
  payouts: { id: string; name: string; amount: number }[];
  log: string[];
};

const addLog = (s: PartyBase, line: string) => {
  s.log = [...s.log, line].slice(-12);
};
const active = (s: PartyBase) => s.seats.map((x, i) => (!x.out ? i : -1)).filter((i) => i >= 0);
function nextActive(s: PartyBase, from: number): number | null {
  for (let k = 1; k <= s.seats.length; k++) {
    const j = (from + k) % s.seats.length;
    if (!s.seats[j]!.out) return j;
  }
  return null;
}

/** 分け方（上がった順。％） */
const SHARES: Record<number, number[]> = { 2: [100, 0], 3: [70, 30, 0], 4: [60, 30, 10, 0], 5: [50, 30, 20, 0, 0] };

function payoutByShares(s: PartyBase, shares: number[]): Credit[] {
  const pot = s.entry * s.seats.length;
  const amounts = shares.map((p) => Math.floor((pot * p) / 100));
  amounts[0]! += pot - amounts.reduce((a, b) => a + b, 0);
  s.payouts = s.order.map((id, i) => ({ id, name: s.seats.find((x) => x.id === id)!.name, amount: amounts[i] ?? 0 }));
  return s.payouts.filter((p) => p.amount > 0).map((p) => ({ memberId: p.id, amount: p.amount, reason: 'casino_win' as const }));
}

type PartyRules<S extends PartyBase> = {
  kind: TableKind;
  min: number;
  max: number;
  turnSeconds: number;
  deal(s: S, rng: Rng, now: number): S;
  /** 持ち時間切れ・抜けた人の代わりに動かす */
  auto(s: S, i: number, ctx: Ctx): Step<S>;
  play(s: S, i: number, form: Form, ctx: Ctx): Step<S>;
  /** 終わったときの配り方 */
  finish(s: S): Credit[];
  init(): Omit<S, keyof PartyBase>;
};

function partyEngine<S extends PartyBase>(r: PartyRules<S>): TableEngine<S> {
  const seat = (w: Who): PartySeat => ({ ...w, hand: [], out: false, gone: false, timeouts: 0 });
  return {
    kind: r.kind,
    maxSeats: r.max,
    create(host, f, ctx) {
      const entry = intOf(f, 'entry');
      if (!Number.isInteger(entry) || entry < 0 || (entry > 0 && (entry < ctx.cfg.casino.minBet || entry > ctx.cfg.casino.maxBet))) return fail('bad_bet');
      const s = { ...r.init(), seats: [seat(host)], entry, phase: 'lobby', deadline: ctx.now + LOBBY_MINUTES * 60_000, createdAt: ctx.now, turn: null, order: [], payouts: [], log: [] } as unknown as S;
      return ok(s, entry > 0 ? { debits: [{ memberId: host.id, amount: entry, reason: 'casino_bet', limited: true }] } : undefined);
    },
    join(s, who, _f) {
      if (s.seats.some((x) => x.id === who.id)) return ok(s);
      if (s.phase !== 'lobby') return fail('started');
      if (s.seats.length >= r.max) return fail('full');
      return ok({ ...s, seats: [...s.seats, seat(who)] }, s.entry > 0 ? { debits: [{ memberId: who.id, amount: s.entry, reason: 'casino_bet', limited: true }] } : undefined);
    },
    leave(state, id, ctx) {
      const i = state.seats.findIndex((x) => x.id === id);
      if (i < 0) return fail('not_seated');
      if (state.phase === 'lobby') {
        const seats = state.seats.filter((x) => x.id !== id);
        // 作った人が抜けたら、みんなに返して閉じる
        if (i === 0 || !seats.length) {
          return ok({ ...state, seats: [], phase: 'closed', deadline: null }, state.entry > 0 ? { credits: state.seats.map((x) => ({ memberId: x.id, amount: state.entry, reason: 'casino_refund' as const })) } : undefined);
        }
        return ok({ ...state, seats }, state.entry > 0 ? { credits: [{ memberId: id, amount: state.entry, reason: 'casino_refund' }] } : undefined);
      }
      if (state.phase !== 'playing') return ok({ ...state, seats: state.seats.map((x) => (x.id === id ? { ...x, gone: true } : x)) });
      const s = structuredClone(state);
      s.seats[i]!.gone = true;
      addLog(s, `${s.seats[i]!.name} が抜けました（自動で進めます）`);
      if (s.turn === i) s.deadline = ctx.now;
      return ok(s);
    },
    act(state, id, f, ctx) {
      const i = state.seats.findIndex((x) => x.id === id);
      if (i < 0) return fail('not_seated');
      if (str(f, 'action') === 'start') {
        if (state.phase !== 'lobby' || i !== 0) return fail('invalid');
        if (state.seats.length < r.min) return fail('need_players');
        const s = r.deal(structuredClone(state), ctx.rng, ctx.now);
        s.phase = 'playing';
        s.deadline = ctx.now + r.turnSeconds * 1000;
        return ok(s);
      }
      if (state.phase !== 'playing' || state.turn !== i) return fail('not_your_turn');
      const s = structuredClone(state);
      s.seats[i]!.timeouts = 0;
      return after(r.play(s, i, f, ctx), ctx);
    },
    tick(state, ctx) {
      if (state.deadline === null || state.deadline > ctx.now) return null;
      if (state.phase === 'lobby') {
        return ok({ ...state, seats: [], phase: 'closed', deadline: null }, state.entry > 0 ? { credits: state.seats.map((x) => ({ memberId: x.id, amount: state.entry, reason: 'casino_refund' as const })) } : undefined);
      }
      if (state.phase === 'done') return ok({ ...state, phase: 'closed', deadline: null });
      if (state.phase !== 'playing' || state.turn === null) return null;
      const s = structuredClone(state);
      const x = s.seats[s.turn!]!;
      if (!x.gone) {
        x.timeouts++;
        addLog(s, `${x.name}: 時間切れ`);
      }
      return after(r.auto(s, s.turn!, ctx), ctx);
    },
    due: (s) => s.deadline,
    // 終わった卓は、結果を見ている間もほかの卓に座れるように数えない
    seats: (s) => (s.phase === 'lobby' || s.phase === 'playing' ? s.seats.filter((x) => !x.gone).map((x) => x.id) : []),
    closed: (s) => s.phase === 'closed',
  };

  /** 動いたあと: 終わりなら配る。次の人の持ち時間（抜けた人はすぐ） */
  function after(step: Step<S>, ctx: Ctx): Step<S> {
    if (!step.ok) return step;
    const s = step.state;
    if (active(s).length <= 1) {
      for (const i of active(s)) {
        s.seats[i]!.out = true;
        s.order.push(s.seats[i]!.id);
      }
      s.phase = 'done';
      s.turn = null;
      s.deadline = ctx.now + DONE_SECONDS * 1000;
      const credits = r.finish(s);
      return ok(s, { debits: step.fx?.debits, credits: [...(step.fx?.credits ?? []), ...credits] });
    }
    const t = s.turn;
    s.deadline = t !== null && s.seats[t]!.gone ? ctx.now + 800 : ctx.now + r.turnSeconds * 1000;
    return ok(s, step.fx);
  }
}

// ───────── 👑 大富豪 ─────────

/** 強さ（3 が一番弱く、2 が一番強い。ジョーカーはその上） */
export const dStrength = (c: number) => (c === JOKER ? 13 : ((rankOf(c) + 10) % 13));
export type DField = { cards: number[]; n: number; strength: number; joker: boolean; by: number } | null;
export type DaifugoState = PartyBase & { kind: 'daifugo'; field: DField; passes: number[]; lastBy: number | null; revolution: boolean; played: number };

/** 出せる組か（同じ数字 1〜4 枚。ジョーカーはどの数字の代わりにもなる） */
export function dSet(cards: number[]): { n: number; strength: number; joker: boolean; rank: number | null } | undefined {
  if (!cards.length || cards.length > 4 || new Set(cards).size !== cards.length) return undefined;
  const nat = cards.filter((c) => c !== JOKER);
  if (!nat.length) return cards.length === 1 ? { n: 1, strength: 13, joker: true, rank: null } : undefined;
  const r = rankOf(nat[0]!);
  if (!nat.every((c) => rankOf(c) === r)) return undefined;
  return { n: cards.length, strength: dStrength(nat[0]!), joker: false, rank: r };
}

/** 場に出ているものに勝てるか */
export function dBeats(field: DField, play: NonNullable<ReturnType<typeof dSet>>, revolution: boolean): boolean {
  if (!field) return true;
  if (play.n !== field.n || field.joker) return false;
  if (play.joker) return true;
  return revolution ? play.strength < field.strength : play.strength > field.strength;
}

const sortHand = (h: number[], rev = false) => [...h].sort((a, b) => (rev ? dStrength(b) - dStrength(a) : dStrength(a) - dStrength(b)) || a - b);

function dPlay(s: DaifugoState, i: number, cards: number[]): Step<DaifugoState> {
  const x = s.seats[i]!;
  if (!cards.every((c) => x.hand.includes(c))) return fail('invalid');
  const set = dSet(cards);
  if (!set) return fail('bad_set');
  if (!dBeats(s.field, set, s.revolution)) return fail('weak');
  x.hand = x.hand.filter((c) => !cards.includes(c));
  s.played++;
  s.passes = [];
  s.lastBy = i;
  const label = cards.map(cardLabel).join(' ');
  let note = '';
  if (set.n === 4) {
    s.revolution = !s.revolution;
    note = s.revolution ? '・⚡ 革命！' : '・⚡ 革命返し！';
  }
  const eight = set.rank === 8;
  if (eight) note += '・✂ 8 切り';
  addLog(s, `${x.name}: ${label}${note}`);
  s.field = eight ? null : { cards, n: set.n, strength: set.strength, joker: set.joker, by: i };
  if (!x.hand.length) {
    x.out = true;
    s.order.push(x.id);
    addLog(s, `🎉 ${x.name} が ${s.order.length} 番目に上がりました`);
  }
  if (active(s).length <= 1) return ok(s);
  // 8 切りなら同じ人から（上がっていれば次の人）
  s.turn = eight && !x.out ? i : nextActive(s, i);
  return ok(s);
}

/** みんなが続けてパスしたら場を流す */
function maybeClear(s: DaifugoState): void {
  if (s.lastBy === null || !s.field) return;
  const others = active(s).filter((j) => j !== s.lastBy);
  if (others.every((j) => s.passes.includes(j))) {
    s.field = null;
    s.passes = [];
    addLog(s, '— 場が流れました —');
    s.turn = s.seats[s.lastBy]!.out ? nextActive(s, s.lastBy) : s.lastBy;
  }
}

function dPass(s: DaifugoState, i: number): Step<DaifugoState> {
  if (!s.field) return fail('must_play');
  s.passes.push(i);
  addLog(s, `${s.seats[i]!.name}: パス`);
  s.turn = nextActive(s, i);
  maybeClear(s);
  return ok(s);
}

export const cardLabel = (c: number) => {
  if (c === JOKER) return '🃏';
  const r = rankOf(c);
  return `${['♠', '♥', '♦', '♣'][Math.floor(c / 13)]}${['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'][r]}`;
};

export const daifugo = partyEngine<DaifugoState>({
  kind: 'daifugo',
  min: 3,
  max: 5,
  turnSeconds: 40,
  init: () => ({ kind: 'daifugo', field: null, passes: [], lastBy: null, revolution: false, played: 0 }) as never,
  deal(s, rng) {
    const deck = [...shuffledShoe(1, rng), JOKER];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = rng(i + 1);
      [deck[i], deck[j]] = [deck[j]!, deck[i]!];
    }
    deck.forEach((c, k) => s.seats[k % s.seats.length]!.hand.push(c));
    for (const x of s.seats) x.hand = sortHand(x.hand);
    // ♦3 を持っている人から
    const d3 = 2 * 13 + 2;
    s.turn = Math.max(0, s.seats.findIndex((x) => x.hand.includes(d3)));
    addLog(s, `配りました。${s.seats[s.turn]!.name} から始めます`);
    return s;
  },
  play(s, i, f) {
    if (str(f, 'action') === 'pass') return dPass(s, i);
    const cards = list(f, 'cards').map(Number).filter((n) => Number.isInteger(n));
    return dPlay(s, i, cards);
  },
  auto(s, i) {
    if (s.field) return dPass(s, i);
    // 場が空なら、一番弱い 1 枚
    const weakest = sortHand(s.seats[i]!.hand, s.revolution).find((c) => c !== JOKER) ?? s.seats[i]!.hand[0]!;
    return dPlay(s, i, [weakest]);
  },
  finish(s) {
    return payoutByShares(s, SHARES[s.seats.length] ?? SHARES[5]!);
  },
});

// ───────── 🃟 ババ抜き ─────────

export type BabaState = PartyBase & { kind: 'babanuki'; discarded: number; lastDraw: { by: string; from: string; pair: boolean } | null };

/** 同じ数字の 2 枚を捨てる（ジョーカーは捨てられない） */
export function dropPairs(hand: number[]): { hand: number[]; dropped: number } {
  const byRank = new Map<number, number[]>();
  for (const c of hand) {
    const k = c === JOKER ? -1 : rankOf(c);
    byRank.set(k, [...(byRank.get(k) ?? []), c]);
  }
  const out: number[] = [];
  let dropped = 0;
  for (const [k, cs] of byRank) {
    if (k === -1 || cs.length % 2 === 0) {
      if (k === -1) out.push(...cs);
      else dropped += cs.length;
      continue;
    }
    out.push(cs[0]!);
    dropped += cs.length - 1;
  }
  return { hand: out, dropped };
}

function shuffle<T>(a: T[], rng: Rng): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [b[i], b[j]] = [b[j]!, b[i]!];
  }
  return b;
}

function babaDraw(s: BabaState, i: number, pos: number, rng: Rng): Step<BabaState> {
  const t = nextActive(s, i);
  if (t === null) return fail('invalid');
  const target = s.seats[t]!;
  if (!Number.isInteger(pos) || pos < 0 || pos >= target.hand.length) return fail('invalid');
  const card = target.hand[pos]!;
  target.hand = shuffle(target.hand.filter((_, k) => k !== pos), rng);
  const me = s.seats[i]!;
  const before = me.hand.length + 1;
  const r = dropPairs([...me.hand, card]);
  me.hand = shuffle(r.hand, rng);
  s.discarded += r.dropped;
  const pair = r.hand.length < before;
  s.lastDraw = { by: me.id, from: target.id, pair };
  addLog(s, `${me.name} が ${target.name} から 1 枚引きました${pair ? '（そろった！）' : ''}`);
  for (const x of [target, me]) {
    if (!x.out && !x.hand.length) {
      x.out = true;
      s.order.push(x.id);
      addLog(s, `🎉 ${x.name} が上がりました`);
    }
  }
  s.turn = nextActive(s, i);
  return ok(s);
}

export const babanuki = partyEngine<BabaState>({
  kind: 'babanuki',
  min: 2,
  max: 5,
  turnSeconds: 25,
  init: () => ({ kind: 'babanuki', discarded: 0, lastDraw: null }) as never,
  deal(s, rng) {
    const deck = shuffle([...shuffledShoe(1, rng), JOKER], rng);
    deck.forEach((c, k) => s.seats[k % s.seats.length]!.hand.push(c));
    for (const x of s.seats) {
      const r = dropPairs(x.hand);
      x.hand = shuffle(r.hand, rng);
      s.discarded += r.dropped;
      if (!x.hand.length) {
        x.out = true;
        s.order.push(x.id);
      }
    }
    s.turn = active(s)[0] ?? 0;
    addLog(s, `配って、そろった分を捨てました。${s.seats[s.turn]!.name} から引きます`);
    return s;
  },
  play(s, i, f, ctx) {
    return babaDraw(s, i, intOf(f, 'pos'), ctx.rng);
  },
  auto(s, i, ctx) {
    const t = nextActive(s, i);
    return babaDraw(s, i, t === null ? 0 : ctx.rng(Math.max(1, s.seats[t]!.hand.length)), ctx.rng);
  },
  finish(s) {
    // 最後の人（ババ）以外で同じだけ分ける（端数は最初に上がった人）
    const pot = s.entry * s.seats.length;
    const winners = s.order.slice(0, -1);
    const each = Math.floor(pot / Math.max(1, winners.length));
    const amounts = winners.map((_, k) => each + (k === 0 ? pot - each * winners.length : 0));
    s.payouts = s.order.map((id, k) => ({ id, name: s.seats.find((x) => x.id === id)!.name, amount: amounts[k] ?? 0 }));
    return s.payouts.filter((p) => p.amount > 0).map((p) => ({ memberId: p.id, amount: p.amount, reason: 'casino_win' as const }));
  },
});

export type { Form };

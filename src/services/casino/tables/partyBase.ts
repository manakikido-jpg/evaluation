import type { TableKind } from '../../../config.js';
import type { Rng } from '../cards.js';
import { BOT_THINK_MS, nextBot } from './bots.js';
import { fail, intOf, ok, paceMult, paceOf, str, type Credit, type Ctx, type Form, type Step, type TableEngine, type Who, type Pace } from './types.js';

/**
 * みんなで遊ぶトランプ（大富豪・ババ抜き）の共通の流れ。部屋を作った人が参加費を決め、そろったら作った人が始める。
 * 参加費は座るときに預かり、終わったら上がった順に配る（0 銭なら賭けない）。
 * - 相手待ちのまま LOBBY_MINUTES 分たつと、部屋を閉じて返す
 * - 持ち時間を過ぎたら自動で動かす。途中で抜けた人は、すぐ自動で動かす
 * - 🤖 作った人は、相手待ちのあいだ BOT を入れられる（参加費は胴元が出す・BOT は少し考えてから動く）
 */

export const LOBBY_MINUTES = 30;
export const JOKER = 52;
const DONE_SECONDS = 90;

export type PartySeat = Who & { hand: number[]; out: boolean; gone: boolean; timeouts: number; bot?: boolean };
export type PartyBase = {
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
  pace?: Pace;
};

export const addLog = (s: PartyBase, line: string) => {
  s.log = [...s.log, line].slice(-12);
};
export const active = (s: PartyBase) => s.seats.map((x, i) => (!x.out ? i : -1)).filter((i) => i >= 0);
export function nextActive(s: PartyBase, from: number): number | null {
  for (let k = 1; k <= s.seats.length; k++) {
    const j = (from + k) % s.seats.length;
    if (!s.seats[j]!.out) return j;
  }
  return null;
}

/** 分け方（上がった順。％） */
export const SHARES: Record<number, number[]> = { 2: [100, 0], 3: [70, 30, 0], 4: [60, 30, 10, 0], 5: [50, 30, 20, 0, 0] };

export function payoutByShares(s: PartyBase, shares: number[]): Credit[] {
  const pot = s.entry * s.seats.length;
  const amounts = shares.map((p) => Math.floor((pot * p) / 100));
  amounts[0]! += pot - amounts.reduce((a, b) => a + b, 0);
  s.payouts = s.order.map((id, i) => ({ id, name: s.seats.find((x) => x.id === id)!.name, amount: amounts[i] ?? 0 }));
  return s.payouts.filter((p) => p.amount > 0).map((p) => ({ memberId: p.id, amount: p.amount, reason: 'casino_win' as const }));
}

export type PartyRules<S extends PartyBase> = {
  kind: TableKind;
  min: number;
  max: number;
  turnSeconds: number;
  deal(s: S, rng: Rng, now: number): S;
  /** 持ち時間切れ・抜けた人の代わりに動かす */
  auto(s: S, i: number, ctx: Ctx): Step<S>;
  /** 🤖 BOT の手（なければ auto） */
  bot?(s: S, i: number, ctx: Ctx): Step<S>;
  play(s: S, i: number, form: Form, ctx: Ctx): Step<S>;
  /** 終わったときの配り方 */
  finish(s: S): Credit[];
  /** f: 卓を立てたときのフォーム（ルールの選び方など） */
  init(f: Form): Omit<S, keyof PartyBase>;
};

export function partyEngine<S extends PartyBase>(r: PartyRules<S>): TableEngine<S> {
  const seat = (w: Who, bot = false): PartySeat => ({ ...w, hand: [], out: false, gone: false, timeouts: 0, ...(bot ? { bot: true } : {}) });
  const refundAll = (state: S) =>
    ok({ ...state, seats: [], phase: 'closed', deadline: null } as S, state.entry > 0 ? { credits: state.seats.map((x) => ({ memberId: x.id, amount: state.entry, reason: 'casino_refund' as const })) } : undefined);
  /** 次の番の人の持ち時間（抜けた人はすぐ・BOT は少し考えて） */
  const turnDeadline = (s: S, now: number) => {
    const x = s.turn !== null ? s.seats[s.turn] : undefined;
    return x?.gone ? now + 800 : x?.bot ? now + BOT_THINK_MS : now + r.turnSeconds * 1000 * paceMult(s);
  };
  return {
    kind: r.kind,
    maxSeats: r.max,
    create(host, f, ctx) {
      const entry = intOf(f, 'entry');
      if (!Number.isInteger(entry) || entry < 0 || (entry > 0 && (entry < ctx.cfg.casino.minBet || entry > ctx.cfg.casino.maxBet))) return fail('bad_bet');
      const s = { ...r.init(f), seats: [seat(host)], entry, phase: 'lobby', deadline: ctx.now + LOBBY_MINUTES * 60_000, createdAt: ctx.now, turn: null, order: [], payouts: [], log: [], pace: paceOf(f) } as unknown as S;
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
        // 作った人が抜けたら（BOT だけになったら）、みんなに返して閉じる
        if (i === 0 || !seats.some((x) => !x.bot)) return refundAll(state);
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
      const a = str(f, 'action');
      if (a === 'start') {
        if (state.phase !== 'lobby' || i !== 0) return fail('invalid');
        if (state.seats.length < r.min) return fail('need_players');
        const s = r.deal(structuredClone(state), ctx.rng, ctx.now);
        s.phase = 'playing';
        s.deadline = turnDeadline(s, ctx.now);
        return ok(s);
      }
      // 🤖 BOT を入れる・外す（作った人・相手待ちのあいだ）
      if (a === 'add_bot') {
        if (state.phase !== 'lobby' || i !== 0) return fail('invalid');
        if (state.seats.length >= r.max) return fail('full');
        const b = nextBot(state.seats.map((x) => x.id));
        return ok({ ...state, seats: [...state.seats, seat(b, true)] }, state.entry > 0 ? { debits: [{ memberId: b.id, amount: state.entry, reason: 'casino_bet', limited: false }] } : undefined);
      }
      if (a === 'remove_bot') {
        if (state.phase !== 'lobby' || i !== 0) return fail('invalid');
        const b = state.seats.find((x) => x.bot && x.id === str(f, 'bot')) ?? [...state.seats].reverse().find((x) => x.bot);
        if (!b) return fail('invalid');
        return ok({ ...state, seats: state.seats.filter((x) => x !== b) }, state.entry > 0 ? { credits: [{ memberId: b.id, amount: state.entry, reason: 'casino_refund' }] } : undefined);
      }
      if (state.phase !== 'playing' || state.turn !== i) return fail('not_your_turn');
      const s = structuredClone(state);
      s.seats[i]!.timeouts = 0;
      return after(r.play(s, i, f, ctx), ctx);
    },
    tick(state, ctx) {
      if (state.deadline === null || state.deadline > ctx.now) return null;
      if (state.phase === 'lobby') return refundAll(state);
      if (state.phase === 'done') return ok({ ...state, phase: 'closed', deadline: null });
      if (state.phase !== 'playing' || state.turn === null) return null;
      const s = structuredClone(state);
      const x = s.seats[s.turn!]!;
      if (x.bot && !x.gone) return after((r.bot ?? r.auto)(s, s.turn!, ctx), ctx);
      if (!x.gone) {
        x.timeouts++;
        addLog(s, `${x.name}: 時間切れ`);
      }
      return after(r.auto(s, s.turn!, ctx), ctx);
    },
    due: (s) => s.deadline,
    // 終わった卓は、結果を見ている間もほかの卓に座れるように数えない
    seats: (s) => (s.phase === 'lobby' || s.phase === 'playing' ? s.seats.filter((x) => !x.gone && !x.bot).map((x) => x.id) : []),
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
    s.deadline = turnDeadline(s, ctx.now);
    return ok(s, step.fx);
  }
}

export function shuffle<T>(a: T[], rng: Rng): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [b[i], b[j]] = [b[j]!, b[i]!];
  }
  return b;
}

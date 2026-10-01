import { rankOf, shuffledShoe, type Rng } from '../cards.js';
import { active, addLog, JOKER, nextActive, partyEngine, shuffle, type PartyBase } from './partyBase.js';
import { fail, intOf, ok, type Step } from './types.js';

/** みんなで遊ぶトランプ（大富豪は daifugo.ts・共通の流れは partyBase.ts） */
export * from './partyBase.js';
export * from './daifugo.js';

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


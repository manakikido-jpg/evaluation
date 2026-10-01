import type { Rng } from '../cards.js';
import { bestHand } from './pokerHands.js';
import type { PokerState, PSeat } from './poker.js';

/**
 * 🤖 ポーカーの BOT。
 * - プリフロップ: 6 人卓・100bb のソルバー（GTO Wizard の 6max キャッシュ）のレンジを手で写したもの。
 *   ポジションごとのオープン（UTG 約 17% … BTN 約 43%）・3bet・コール・4bet・オールインへのコールを、混ぜる割合つきで持つ
 * - フロップから: 相手の手を「ここまで残っていそうな手」から何百回も引いて勝率を出し、ポットオッズと比べて決める
 *   （強ければバリューベット・レイズ、ドローは時々セミブラフ、リバーは時々ブラフ。サイズは 1/3〜3/4 ポット）
 */

export type BotMove = { action: 'fold' | 'check' | 'call' | 'raise' | 'allin'; amount?: number };

const RANKS = 'AKQJT98765432';
const value = (c: number) => {
  const r = (c % 13) + 1;
  return r === 1 ? 14 : r;
};
const ch = (v: number) => RANKS[14 - v]!;
const suit = (c: number) => Math.floor(c / 13) % 4;

/** 2 枚の手の名前（AKs・T9o・77） */
export function handClass(hole: number[]): string {
  const [a, b] = [...hole].sort((x, y) => value(y) - value(x));
  if (value(a!) === value(b!)) return `${ch(value(a!))}${ch(value(b!))}`;
  return `${ch(value(a!))}${ch(value(b!))}${suit(a!) === suit(b!) ? 's' : 'o'}`;
}

/** 「22+, A2s+, KTo+, 76s@40」を、手 → 出す割合（0〜1）に */
export function parseRange(text: string): Map<string, number> {
  const out = new Map<string, number>();
  const idx = (c: string) => RANKS.indexOf(c);
  for (const raw of text.split(',').map((x) => x.trim()).filter(Boolean)) {
    const [body, f] = raw.split('@');
    const freq = f ? Number(f) / 100 : 1;
    const plus = body!.endsWith('+');
    const h = plus ? body!.slice(0, -1) : body!;
    const set = (k: string) => out.set(k, Math.max(out.get(k) ?? 0, freq));
    if (h.length === 2 && h[0] === h[1]) {
      // 22+ … 22 から AA まで
      if (!plus) set(h);
      else for (let i = idx(h[0]!); i >= 0; i--) set(`${RANKS[i]}${RANKS[i]}`);
      continue;
    }
    const [hi, lo, kind] = [h[0]!, h[1]!, h[2] ?? 's'];
    if (!plus) {
      set(`${hi}${lo}${kind}`);
      continue;
    }
    // A2s+ … A2s から AKs まで（上の札のすぐ下まで）
    for (let i = idx(lo); i > idx(hi); i--) set(`${hi}${RANKS[i]}${kind}`);
  }
  return out;
}

const R = {
  open: {
    UTG: parseRange('55+, 44@40, 33@20, A2s+, K5s+, Q9s+, JTs, J9s@30, T9s@70, 98s@20, 76s@40, 65s@50, 54s@50, ATo+, KJo+, KTo@50, QJo@50, A5o@30'),
    HJ: parseRange('33+, 22@30, A2s+, K3s+, Q8s+, J9s+, T9s, 98s@40, 87s@30, 76s@60, 65s@60, 54s@60, ATo+, A9o@60, A8o@20, A5o@50, KTo+, QJo, QTo@50, JTo@30'),
    CO: parseRange('22+, A2s+, K2s+, Q5s+, J7s+, T7s+, 97s+, 86s+, 75s+, 64s+, 54s, 43s@30, A7o+, A5o, A4o@50, K9o+, QTo+, JTo, T9o@30'),
    BTN: parseRange('22+, A2s+, K2s+, Q2s+, J3s+, T5s+, 95s+, 85s+, 74s+, 63s+, 53s+, 43s, A2o+, K7o+, Q8o+, J8o+, T8o+, 98o, 87o@50'),
    SB: parseRange('22+, A2s+, K2s+, Q3s+, J5s+, T6s+, 96s+, 85s+, 75s+, 64s+, 54s, A2o+, K8o+, Q9o+, J9o+, T9o'),
    /** 2 人だけ（ボタン = SB） */
    HU: parseRange('22+, A2s+, K2s+, Q2s+, J2s+, T3s+, 94s+, 84s+, 73s+, 63s+, 52s+, 42s+, A2o+, K2o+, Q5o+, J7o+, T7o+, 97o+, 87o, 76o@50'),
  },
  /** オープンに 3bet（バリュー＋ブラフ） */
  threeBet: parseRange('QQ+, AKs, AKo, JJ@50, AQs@50, A5s, A4s@70, KJs@30, 76s@20'),
  /** 後ろのポジションからのオープンには広めに 3bet */
  threeBetWide: parseRange('TT+, AJs+, AKo, AQo@50, KQs@60, A5s, A4s, A3s@50, KJs@40, QJs@20, 65s@20'),
  /** オープンにコール（ポジションあり） */
  callIp: parseRange('22+, ATs+, KTs+, QTs+, JTs, T9s, 98s, 87s@50, 76s@40, AQo, AJo@50, KQo@60'),
  /** BB のディフェンス（3bb くらいまでのオープン） */
  callBb: parseRange('22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 96s+, 85s+, 74s+, 64s+, 53s+, 43s, A2o+, K7o+, Q8o+, J8o+, T8o+, 97o+, 87o, 76o, 65o@50'),
  /** SB はほとんど 3bet かフォールド */
  callSb: parseRange('99@50, 88@50, 77@50, AQs, AJs, KQs'),
  /** 3bet されたとき */
  fourBet: parseRange('KK+, AKs, AKo@50, A5s@30'),
  callThreeBet: parseRange('JJ, TT, 99@50, AKo, AQs, AJs@50, KQs@50, QQ'),
  /** 4bet 以上・オールインされたとき */
  jam: parseRange('QQ+, AKs, AKo'),
  callJam: parseRange('JJ+, AKs, AKo, TT@50, AQs@50'),
} as const;

const inRange = (range: Map<string, number>, hole: number[], rng: Rng) => {
  const f = range.get(handClass(hole)) ?? 0;
  return f >= 1 || (f > 0 && rng(1000) < f * 1000);
};

/** 手の強さのおおまかな点（Chen の式）。相手の手を引くときの目安 */
export function chen(hole: number[]): number {
  const [a, b] = [...hole].sort((x, y) => value(y) - value(x)).map(value) as [number, number];
  const base = (v: number) => (v === 14 ? 10 : v === 13 ? 8 : v === 12 ? 7 : v === 11 ? 6 : v / 2);
  let pts = base(a);
  if (a === b) return Math.max(5, pts * 2);
  if (suit(hole[0]!) === suit(hole[1]!)) pts += 2;
  const gap = a - b - 1;
  pts -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && a < 12) pts += 1;
  return Math.ceil(pts);
}

const live = (x: PSeat | null): x is PSeat => Boolean(x && x.inHand && !x.folded);
const potOf = (s: PokerState) => s.seats.reduce((n, x) => n + (x?.total ?? 0), 0);

/** 席のポジション（BB から見て。2 人のときは HU） */
export function positionOf(s: PokerState, i: number): 'UTG' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB' | 'HU' {
  const order: number[] = [];
  for (let k = 1; k <= s.seats.length; k++) {
    const j = (s.button + k) % s.seats.length;
    if (s.seats[j]?.inHand) order.push(j);
  }
  // order: SB, BB, …, BTN（ボタンが最後）
  const n = order.length;
  if (n <= 2) return i === s.button ? 'HU' : 'BB';
  const k = order.indexOf(i);
  if (k === 0) return 'SB';
  if (k === 1) return 'BB';
  const fromBtn = n - 1 - k;
  return fromBtn === 0 ? 'BTN' : fromBtn === 1 ? 'CO' : fromBtn === 2 ? 'HJ' : 'UTG';
}

/**
 * 勝率（相手は「ここまで残っていそうな手」= Chen の点が minChen 以上から引く）。
 * iters 回、残りの場札と相手の手を引いて比べる（引き分けは分ける）
 */
export function equity(hole: number[], board: number[], opponents: number, rng: Rng, iters = 300, minChen = 4): number {
  const used = new Set([...hole, ...board]);
  const deck = Array.from({ length: 52 }, (_, c) => c).filter((c) => !used.has(c));
  let win = 0;
  for (let t = 0; t < iters; t++) {
    const d = [...deck];
    const draw = () => d.splice(rng(d.length), 1)[0]!;
    const opps: number[][] = [];
    for (let o = 0; o < opponents; o++) {
      let h: number[] = [];
      // 弱すぎる手は何回か引き直す（もう降りているはずなので）
      for (let tries = 0; tries < 6; tries++) {
        h = [draw(), draw()];
        if (chen(h) >= minChen || tries === 5) break;
        d.push(...h);
      }
      opps.push(h);
    }
    const full = [...board];
    while (full.length < 5) full.push(draw());
    const mine = bestHand([...hole, ...full]).score;
    let best = 0;
    let ties = 0;
    let lost = false;
    for (const h of opps) {
      const sc = bestHand([...h, ...full]).score;
      if (sc > mine) {
        lost = true;
        break;
      }
      if (sc === mine) ties++;
      best = Math.max(best, sc);
    }
    if (!lost) win += ties ? 1 / (ties + 1) : 1;
  }
  return win / iters;
}

/** to まで出す（レイズ）。持っている分を超えるならオールイン */
function raiseTo(x: PSeat, s: PokerState, to: number): BotMove {
  const max = x.bet + x.chips;
  const min = s.currentBet + s.minRaise;
  const t = Math.max(min, Math.round(to));
  return t >= max * 0.9 ? { action: 'allin' } : { action: 'raise', amount: t };
}

function preflop(s: PokerState, i: number, rng: Rng): BotMove {
  const x = s.seats[i]!;
  const hole = x.hole;
  const toCall = s.currentBet - x.bet;
  const level = s.currentBet / s.bb;
  const pos = positionOf(s, i);
  const stackBb = (x.chips + x.bet) / s.bb;
  const free = toCall <= 0;
  const callOrFold = (range: Map<string, number>): BotMove => (inRange(range, hole, rng) ? { action: 'call' } : free ? { action: 'check' } : { action: 'fold' });
  // オールインされている（コールすると残りが少ない）
  if (toCall >= x.chips * 0.6) return inRange(R.callJam, hole, rng) ? { action: x.chips <= toCall ? 'allin' : 'call' } : { action: 'fold' };
  // まだだれもレイズしていない（ブラインドだけ・リンプ）
  if (level <= 1) {
    if (pos === 'BB') return inRange(R.open.CO, hole, rng) && rng(100) < 50 ? raiseTo(x, s, s.bb * 3.5) : { action: 'check' };
    const range = pos === 'HU' ? R.open.HU : R.open[pos as 'UTG' | 'HJ' | 'CO' | 'BTN' | 'SB'];
    if (!inRange(range, hole, rng)) return free ? { action: 'check' } : { action: 'fold' };
    const limpers = s.seats.filter((y) => y && y !== x && y.inHand && y.bet >= s.bb).length - 1;
    const size = (pos === 'SB' ? 3 : 2.5) + Math.max(0, limpers);
    return raiseTo(x, s, s.bb * size);
  }
  // 1 回レイズされた（オープン）
  if (level <= 5) {
    const late = pos === 'BTN' || pos === 'CO' || pos === 'SB' || pos === 'BB' || pos === 'HU';
    if (inRange(late ? R.threeBetWide : R.threeBet, hole, rng)) return raiseTo(x, s, s.currentBet * (pos === 'SB' || pos === 'BB' ? 4 : 3));
    if (pos === 'BB' || pos === 'HU') return level <= 3.5 ? callOrFold(R.callBb) : callOrFold(R.callIp);
    if (pos === 'SB') return callOrFold(R.callSb);
    return callOrFold(R.callIp);
  }
  // 3bet された
  if (level <= 14 && stackBb > level * 2.5) {
    if (inRange(R.fourBet, hole, rng)) return raiseTo(x, s, s.currentBet * 2.3);
    return callOrFold(R.callThreeBet);
  }
  // 4bet 以上
  if (inRange(R.jam, hole, rng)) return { action: 'allin' };
  return free ? { action: 'check' } : { action: 'fold' };
}

function postflop(s: PokerState, i: number, rng: Rng): BotMove {
  const x = s.seats[i]!;
  const opps = s.seats.filter((y, j) => j !== i && live(y)).length;
  const eq = equity(x.hole, s.board, Math.max(1, opps), rng, 300, s.phase === 'river' ? 5 : 4);
  const pot = potOf(s);
  const toCall = s.currentBet - x.bet;
  const street = s.phase;
  const r = rng(1000) / 1000;
  const bet = (frac: number): BotMove => raiseTo(x, s, s.currentBet + Math.max(s.bb, pot * frac));
  // 相手が多いほど、強い手が要る
  const strong = 0.72 + (opps - 1) * 0.04;
  if (toCall <= 0) {
    if (eq >= strong) return bet(street === 'river' ? 0.75 : 0.66);
    if (eq >= 0.55) return r < 0.6 ? bet(0.33) : { action: 'check' };
    // ドロー（まだ札が来る）: 時々セミブラフ
    if (street !== 'river' && eq >= 0.3 && r < 0.35) return bet(0.5);
    // リバーの弱い手: たまにブラフ
    if (street === 'river' && eq < 0.2 && r < 0.12) return bet(0.75);
    return { action: 'check' };
  }
  const odds = toCall / (pot + toCall);
  if (eq >= strong + 0.08) return r < 0.7 ? raiseTo(x, s, s.currentBet * 3) : { action: 'call' };
  if (eq >= odds + 0.04) return { action: toCall >= x.chips ? 'allin' : 'call' };
  // 安いベットには、まだ見込みがあればついていく（降りすぎない）
  if (street !== 'river' && toCall <= pot * 0.35 && eq >= odds - 0.06) return { action: 'call' };
  return { action: 'fold' };
}

/** BOT の手 */
export function pokerBotMove(s: PokerState, i: number, rng: Rng): BotMove {
  return s.phase === 'preflop' ? preflop(s, i, rng) : postflop(s, i, rng);
}

import type { Rng } from './cards.js';

/**
 * ルーレット（ヨーロピアン: 0〜36 の 37 マス）。1 回の回転でいくつもの所に賭けられる。
 * 数字 1 つ: 36 倍 / 赤・黒・奇数・偶数・1〜18・19〜36: 2 倍 / ダズン・列: 3 倍（0 はどれにも入らない）
 */

export const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const ROULETTE_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];

export const ROULETTE_BETS = {
  red: { label: '🔴 赤', mult: 2 },
  black: { label: '⚫ 黒', mult: 2 },
  odd: { label: '奇数', mult: 2 },
  even: { label: '偶数', mult: 2 },
  low: { label: '1〜18', mult: 2 },
  high: { label: '19〜36', mult: 2 },
  dozen1: { label: '1〜12', mult: 3 },
  dozen2: { label: '13〜24', mult: 3 },
  dozen3: { label: '25〜36', mult: 3 },
  col1: { label: '1 列目（1・4・7…）', mult: 3 },
  col2: { label: '2 列目（2・5・8…）', mult: 3 },
  col3: { label: '3 列目（3・6・9…）', mult: 3 },
} as const;
export type RouletteBet = keyof typeof ROULETTE_BETS | `n${number}` | `i${string}`;
export type InsideBet = { on: RouletteBet; numbers: number[]; label: string; mult: number; edge: boolean };
/** 盤で接する数字だけを登録する。倍率は元の賭けを含む払戻（純利益は倍率−1）。 */
export const ROULETTE_INSIDE: InsideBet[] = [];
const inside = (numbers: number[], label: string, edge = false) => {
  numbers.sort((a, b) => a - b);
  ROULETTE_INSIDE.push({ on: `i${numbers.join('-')}`, numbers, label: `${label} ${numbers.join('・')}`, mult: 36 / numbers.length, edge });
};
for (let n = 1; n <= 36; n++) {
  if (n % 3 !== 0) inside([n, n + 1], 'スプリット');
  if (n <= 33) inside([n, n + 3], 'スプリット');
  if (n <= 32 && n % 3 !== 0) inside([n, n + 1, n + 3, n + 4], 'コーナー');
  if (n % 3 === 1) {
    inside([n, n + 1, n + 2], 'ストリート', true);
    if (n <= 31) inside([n, n + 1, n + 2, n + 3, n + 4, n + 5], 'シックスライン', true);
  }
}
for (let n = 1; n <= 3; n++) inside([0, n], 'スプリット');
inside([0, 1, 2], 'トリオ'); inside([0, 2, 3], 'トリオ');
inside([0, 1, 2, 3], 'ファーストフォー', true);
const insideByKey = new Map(ROULETTE_INSIDE.map((b) => [b.on, b]));
/** 存在する全賭け先。10か所などの人為的な制限は設けない。 */
export const ROULETTE_SPOT_COUNT = 37 + Object.keys(ROULETTE_BETS).length + ROULETTE_INSIDE.length;

export function isRouletteBet(v: unknown): v is RouletteBet {
  if (typeof v !== 'string') return false;
  if (Object.hasOwn(ROULETTE_BETS, v) || insideByKey.has(v as RouletteBet)) return true;
  const m = /^n(0|[1-9]\d?)$/.exec(v);
  return Boolean(m && Number(m[1]) <= 36);
}

export const rouletteColor = (n: number) => (n === 0 ? 'green' : RED_NUMBERS.has(n) ? 'red' : 'black');

export function rouletteBetLabel(bet: RouletteBet): string {
  if (bet.startsWith('n')) return `数字 ${bet.slice(1)}`;
  const inside = insideByKey.get(bet); if (inside) return inside.label;
  return ROULETTE_BETS[bet as keyof typeof ROULETTE_BETS].label;
}

/** 賭けの何倍が戻るか */
export function rouletteMultiplier(bet: RouletteBet, n: number): number {
  if (bet.startsWith('n')) return Number(bet.slice(1)) === n ? 36 : 0;
  const inside = insideByKey.get(bet); if (inside) return inside.numbers.includes(n) ? inside.mult : 0;
  if (n === 0) return 0;
  const hit: Record<keyof typeof ROULETTE_BETS, boolean> = {
    red: RED_NUMBERS.has(n),
    black: !RED_NUMBERS.has(n),
    odd: n % 2 === 1,
    even: n % 2 === 0,
    low: n <= 18,
    high: n >= 19,
    dozen1: n <= 12,
    dozen2: n >= 13 && n <= 24,
    dozen3: n >= 25,
    col1: n % 3 === 1,
    col2: n % 3 === 2,
    col3: n % 3 === 0,
  };
  const k = bet as keyof typeof ROULETTE_BETS;
  return hit[k] ? ROULETTE_BETS[k].mult : 0;
}

export const rouletteSpin = (rng: Rng) => rng(37);

// ───────── いくつもの所に賭ける ─────────

/** ルーレットの 1 か所に賭けられる最高（決めていなければ、ふつうの最高） */
export const rouletteMaxOf = (c: { minBet: number; maxBet: number; rouletteMaxBet: number }) => (c.rouletteMaxBet > 0 ? Math.max(c.rouletteMaxBet, c.minBet) : c.maxBet);

export type RouletteStake = { on: RouletteBet; amount: number };

/** フォームの「red:100,n7:50」を読む（同じ所はまとめる）。おかしければ null */
export function parseStakes(raw: unknown): RouletteStake[] | null {
  if (typeof raw !== 'string' || !raw || raw.length > 65536) return null;
  const map = new Map<string, number>();
  for (const part of raw.split(',')) {
    const m = /^([a-z0-9-]{2,24}):(\d{1,9})$/.exec(part);
    if (!m || !isRouletteBet(m[1])) return null;
    map.set(m[1]!, (map.get(m[1]!) ?? 0) + Number(m[2]));
  }
  if (!map.size || [...map.values()].some((n) => !Number.isSafeInteger(n))) return null;
  return [...map].map(([on, amount]) => ({ on: on as RouletteBet, amount }));
}

export const stakesTotal = (xs: { amount: number }[]) => xs.reduce((n, x) => n + x.amount, 0);
export const stakePayout = (x: RouletteStake, n: number) => x.amount * rouletteMultiplier(x.on, n);

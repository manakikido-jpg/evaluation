import type { Rng } from './cards.js';

/**
 * ルーレット（ヨーロピアン: 0〜36 の 37 マス）。1 回の回転で 1 つに賭ける。
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
export type RouletteBet = keyof typeof ROULETTE_BETS | `n${number}`;

export function isRouletteBet(v: unknown): v is RouletteBet {
  if (typeof v !== 'string') return false;
  if (Object.hasOwn(ROULETTE_BETS, v)) return true;
  const m = /^n(\d{1,2})$/.exec(v);
  return Boolean(m && Number(m[1]) <= 36);
}

export const rouletteColor = (n: number) => (n === 0 ? 'green' : RED_NUMBERS.has(n) ? 'red' : 'black');

export function rouletteBetLabel(bet: RouletteBet): string {
  if (bet.startsWith('n')) return `数字 ${bet.slice(1)}`;
  return ROULETTE_BETS[bet as keyof typeof ROULETTE_BETS].label;
}

/** 賭けの何倍が戻るか */
export function rouletteMultiplier(bet: RouletteBet, n: number): number {
  if (bet.startsWith('n')) return Number(bet.slice(1)) === n ? 36 : 0;
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

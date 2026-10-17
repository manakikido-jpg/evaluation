import { rankOf, type Rng } from './cards.js';

/**
 * ハイ＆ロー。出ているカードより次が「上」か「下」かを当てる。同じ数字は引き分けで、倍率・成功回数を保って続ける。
 * 当てるたびに倍率が「0.95 ÷ 引き分けを除いた成功確率」倍になり、好きなときに降りて受け取れる（外れたら 0）。
 * カードは毎回 52 枚から引く（前のカードは戻す）。
 */

export const HL_EDGE = 0.95;
/** 同じ数字を除く、勝敗が決まる数字の数。 */
export const HL_RESOLVED_RANKS = 12;
/** 倍率の上限（ここまで来たら自動で受け取る） */
export const HL_MAX_MULT = 100;
/** 当てられる回数の上限 */
export const HL_MAX_STEPS = 12;

export type HlGuess = 'high' | 'low';
export type HlState = {
  current: number;
  history: number[];
  /** 倍率の 1000 倍（1000 = 1 倍） */
  mult: number;
  steps: number;
  phase: 'playing' | 'done';
  result?: 'cashout' | 'lose';
  /** 直前が引き分けか（古い保存データにはない）。 */
  lastDraw?: boolean;
};

/** 当たる数字の数（13 のうち） */
export function hlWays(current: number, guess: HlGuess): number {
  const r = rankOf(current);
  return guess === 'high' ? 13 - r : r - 1;
}

/** 当てたときの次の倍率（1000 倍） */
export function hlNextMult(mult: number, current: number, guess: HlGuess): number {
  const ways = hlWays(current, guess);
  if (ways <= 0) return 0;
  return Math.min(HL_MAX_MULT * 1000, Math.floor((mult * HL_EDGE * HL_RESOLVED_RANKS) / ways));
}

export function hlStart(rng: Rng): HlState {
  return { current: rng(52), history: [], mult: 1000, steps: 0, phase: 'playing' };
}

export function hlGuess(s: HlState, guess: HlGuess, rng: Rng): HlState {
  if (s.phase !== 'playing' || hlWays(s.current, guess) <= 0) return s;
  const next = rng(52);
  const a = rankOf(s.current);
  const b = rankOf(next);
  const ok = guess === 'high' ? b > a : b < a;
  const history = [...s.history, s.current].slice(-HL_MAX_STEPS);
  if (a === b) return { ...s, history, current: next, lastDraw: true };
  if (!ok) return { ...s, history, current: next, mult: 0, phase: 'done', result: 'lose', lastDraw: false };
  const mult = hlNextMult(s.mult, s.current, guess);
  const steps = s.steps + 1;
  const done = steps >= HL_MAX_STEPS || mult >= HL_MAX_MULT * 1000;
  return { ...s, history, current: next, mult, steps, lastDraw: false, ...(done ? { phase: 'done' as const, result: 'cashout' as const } : {}) };
}

export function hlCashout(s: HlState): HlState {
  if (s.phase !== 'playing' || s.steps === 0) return s;
  return { ...s, phase: 'done', result: 'cashout', lastDraw: false };
}

export const hlPayout = (s: HlState, bet: number) => (s.result === 'cashout' ? Math.floor((bet * s.mult) / 1000) : 0);

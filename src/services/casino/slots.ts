import type { Rng } from './cards.js';

/**
 * スロット（3 リール）。リールごとに絵柄を重みで選ぶ。払い戻し率はおよそ 95%（テストで確かめる）。
 * - 3 つそろう: 絵柄ごとの倍率
 * - 🌸 が 2 つ: 15 倍 / 🌸 が 1 つ: 1 倍（賭けた分が戻る）
 * - 左の 2 つがそろう（🏮 以上）: 1〜3 倍
 */

export const SLOT_SYMBOLS = [
  { key: 'dango', emoji: '🍡', weight: 9, three: 6, two: 0 },
  { key: 'chime', emoji: '🎐', weight: 7, three: 12, two: 0 },
  { key: 'lantern', emoji: '🏮', weight: 6, three: 20, two: 1 },
  { key: 'fox', emoji: '🦊', weight: 4, three: 50, two: 2 },
  { key: 'torii', emoji: '⛩', weight: 3, three: 100, two: 3 },
  { key: 'sakura', emoji: '🌸', weight: 1, three: 777, two: 0 },
] as const;
export type SlotKey = (typeof SLOT_SYMBOLS)[number]['key'];
const TOTAL = SLOT_SYMBOLS.reduce((n, s) => n + s.weight, 0);
const sym = (k: SlotKey) => SLOT_SYMBOLS.find((s) => s.key === k)!;

export function spinReel(rng: Rng): SlotKey {
  let x = rng(TOTAL);
  for (const s of SLOT_SYMBOLS) {
    if (x < s.weight) return s.key;
    x -= s.weight;
  }
  return SLOT_SYMBOLS[0].key;
}

/** 賭けの何倍が戻るか */
export function slotMultiplier(reels: SlotKey[]): number {
  const [a, b, c] = reels;
  if (a === b && b === c) return sym(a!).three;
  const sakura = reels.filter((r) => r === 'sakura').length;
  if (sakura === 2) return 15;
  if (sakura === 1) return 1;
  if (a === b) return sym(a!).two;
  return 0;
}

export function slotSpin(rng: Rng): { reels: SlotKey[]; multiplier: number } {
  const reels = [spinReel(rng), spinReel(rng), spinReel(rng)];
  return { reels, multiplier: slotMultiplier(reels) };
}

export const slotEmoji = (k: SlotKey) => sym(k).emoji;

/** 払い戻し率（全部の組み合わせから計算） */
export function slotRtp(): number {
  let ev = 0;
  for (const a of SLOT_SYMBOLS) for (const b of SLOT_SYMBOLS) for (const c of SLOT_SYMBOLS) ev += ((a.weight * b.weight * c.weight) / TOTAL ** 3) * slotMultiplier([a.key, b.key, c.key]);
  return ev;
}

import { suitOf } from '../cards.js';

/**
 * ポーカーの役（7 枚から一番よい 5 枚）。強さは数（大きいほど強い）で比べる。
 * 数字は 2〜14（A = 14。A-2-3-4-5 のストレートは 5 が一番上）
 */

export const HAND_NAMES = ['ハイカード', 'ワンペア', 'ツーペア', 'スリーカード', 'ストレート', 'フラッシュ', 'フルハウス', 'フォーカード', 'ストレートフラッシュ'] as const;

const value = (c: number) => {
  const r = (c % 13) + 1;
  return r === 1 ? 14 : r;
};

/** 5 枚の強さ（カテゴリ × 15^5 + 並び） */
export function score5(cards: number[]): number {
  const vs = cards.map(value).sort((a, b) => b - a);
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]!));
  const uniq = [...new Set(vs)];
  let straightTop = 0;
  if (uniq.length === 5) {
    if (vs[0]! - vs[4]! === 4) straightTop = vs[0]!;
    else if (vs[0] === 14 && vs[1] === 5 && vs[4] === 2) straightTop = 5;
  }
  const counts = new Map<number, number>();
  for (const v of vs) counts.set(v, (counts.get(v) ?? 0) + 1);
  // 枚数の多い順・数字の大きい順
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const order = groups.flatMap(([v, n]) => Array<number>(n).fill(v));
  let cat: number;
  let ranks = order;
  if (straightTop && flush) {
    cat = 8;
    ranks = [straightTop, 0, 0, 0, 0];
  } else if (groups[0]![1] === 4) cat = 7;
  else if (groups[0]![1] === 3 && groups[1]![1] === 2) cat = 6;
  else if (flush) {
    cat = 5;
    ranks = vs;
  } else if (straightTop) {
    cat = 4;
    ranks = [straightTop, 0, 0, 0, 0];
  } else if (groups[0]![1] === 3) cat = 3;
  else if (groups[0]![1] === 2 && groups[1]![1] === 2) cat = 2;
  else if (groups[0]![1] === 2) cat = 1;
  else cat = 0;
  return ranks.reduce((n, r) => n * 15 + r, cat);
}

export const categoryOf = (score: number) => Math.floor(score / 15 ** 5);

/** 7 枚（5〜7 枚）から一番よい 5 枚 */
export function bestHand(cards: number[]): { score: number; cards: number[] } {
  let best = { score: -1, cards: [] as number[] };
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const five = [cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!];
            const s = score5(five);
            if (s > best.score) best = { score: s, cards: five };
          }
  return best;
}

export const handName = (score: number) => HAND_NAMES[categoryOf(score)]!;

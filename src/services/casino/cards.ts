import { randomInt } from 'node:crypto';

/**
 * カジノの乱数とトランプ。乱数はいつも node:crypto（テストでは差し替える）。
 * カードは 0〜51 の数: 数字 = c % 13 + 1（1 = A … 13 = K）、マーク = Math.floor(c / 13)（♠♥♦♣）
 */

/** 0 以上 n 未満の整数 */
export type Rng = (n: number) => number;
export const cryptoRng: Rng = (n) => randomInt(n);

export const rankOf = (c: number) => (c % 13) + 1;
export const suitOf = (c: number) => Math.floor(c / 13) % 4;
export const SUITS = ['♠', '♥', '♦', '♣'] as const;
const RANK_TEXT = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const rankText = (c: number) => RANK_TEXT[rankOf(c)]!;
export const isRed = (c: number) => suitOf(c) === 1 || suitOf(c) === 2;
export const cardText = (c: number) => `${SUITS[suitOf(c)]}${rankText(c)}`;

/** decks 組のトランプを切る（フィッシャー–イェーツ） */
export function shuffledShoe(decks: number, rng: Rng): number[] {
  const shoe: number[] = [];
  for (let d = 0; d < decks; d++) for (let c = 0; c < 52; c++) shoe.push(c);
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [shoe[i], shoe[j]] = [shoe[j]!, shoe[i]!];
  }
  return shoe;
}

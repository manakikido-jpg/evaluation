/**
 * 🀄 麻雀の牌。136 枚に 0〜135 の番号を付け、4 枚ずつ同じ種類（0〜33）。
 * 種類: 0〜8 萬子 1〜9 / 9〜17 筒子 / 18〜26 索子 / 27 東 28 南 29 西 30 北 / 31 白 32 發 33 中。
 * 赤ドラ: 各色の 5 の 1 枚目（16・52・88）。
 */

export const TILES = 136;
export const KINDS = 34;
export const EAST = 27;
export const HAKU = 31;
export const HATSU = 32;
export const CHUN = 33;

export const kindOf = (t: number) => t >> 2;
export const RED_TILES = [16, 52, 88] as const;
export const isRedTile = (t: number) => t === 16 || t === 52 || t === 88;
/** 0 萬子 1 筒子 2 索子 3 字牌 */
export const suitOf = (k: number) => (k < 27 ? Math.floor(k / 9) : 3);
/** 数牌の数字（字牌は 0） */
export const numOf = (k: number) => (k < 27 ? (k % 9) + 1 : 0);
export const isHonor = (k: number) => k >= 27;
export const isWind = (k: number) => k >= 27 && k <= 30;
export const isDragon = (k: number) => k >= 31;
export const isTerminal = (k: number) => k < 27 && (k % 9 === 0 || k % 9 === 8);
/** 么九牌（1・9・字牌） */
export const isYaochu = (k: number) => isHonor(k) || isTerminal(k);
export const YAOCHU = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33] as const;

/** ドラ表示牌の次の牌（ドラ） */
export function doraOf(indicator: number): number {
  if (indicator < 27) return indicator - (indicator % 9) + (((indicator % 9) + 1) % 9);
  if (indicator <= 30) return 27 + ((indicator - 27 + 1) % 4);
  return 31 + ((indicator - 31 + 1) % 3);
}

export function countsOf(tiles: readonly number[]): number[] {
  const c = new Array<number>(KINDS).fill(0);
  for (const t of tiles) c[kindOf(t)]!++;
  return c;
}

const KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const SUIT_NAME = ['萬', '筒', '索'];
const HONOR = ['東', '南', '西', '北', '白', '發', '中'];
export const WIND_NAME = ['東', '南', '西', '北'];

/** 「五萬」「3筒」「東」のような名前 */
export function kindName(k: number): string {
  if (k >= 27) return HONOR[k - 27]!;
  const n = numOf(k);
  return suitOf(k) === 0 ? `${KANJI[n - 1]}萬` : `${n}${SUIT_NAME[suitOf(k)]}`;
}
export const tileName = (t: number) => `${isRedTile(t) ? '赤' : ''}${kindName(kindOf(t))}`;

/** 牌の上の字・下の字（画面の牌） */
export function tileFace(k: number): { top: string; bottom: string } {
  if (k >= 27) return { top: HONOR[k - 27]!, bottom: '' };
  const n = numOf(k);
  return { top: suitOf(k) === 0 ? KANJI[n - 1]! : String(n), bottom: SUIT_NAME[suitOf(k)]! };
}

/** 並べる順（種類・赤は同じ種類の先） */
export const sortTiles = (tiles: readonly number[]) => [...tiles].sort((a, b) => a - b);

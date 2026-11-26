/**
 * 🧵 新制度の「結び」の決まり（設計 docs/new-system-design.md §2）。
 * 新制度のご縁の時代（④ご縁のリセットのあと）だけ使う。それまでは旧御朱印のまま（格の重み・昇格後の押し直し）。
 */

/** 結びの重み（贈った＝結んだ側の階級で決まる）：参拝者1／氏子1／世話役2 */
export const MUSUBI_WEIGHT: Readonly<Record<string, number>> = { sanpaisha: 1, ujiko: 1, sewayaku: 2 };

/** 総代・神職・宮司などの結びの重み（本人の決定 2026-11-26：1） */
export const MUSUBI_WEIGHT_DEFAULT = 1;

/** その階級の人が結んだときの重み */
export function musubiWeight(rankKey: string): number {
  return MUSUBI_WEIGHT[rankKey] ?? MUSUBI_WEIGHT_DEFAULT;
}

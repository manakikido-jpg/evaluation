/**
 * 🧵 新制度の「結び」の決まり（設計 docs/new-system-design.md §2）。
 * 新制度のご縁の時代（④ご縁のリセットのあと）だけ使う。それまでは旧御朱印のまま（格の重み・昇格後の押し直し）。
 */

/** 結びの重み：だれが結んでも等しく 1（本人の決定 2026-11-26。前は世話役だけ2） */
export const MUSUBI_WEIGHT_DEFAULT = 1;

/** その階級の人が結んだときの重み（いまは全員 1） */
export function musubiWeight(_rankKey: string): number {
  return MUSUBI_WEIGHT_DEFAULT;
}

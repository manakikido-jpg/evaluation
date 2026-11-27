/**
 * 🤝 招待の特典（新制度⑥）。「絵馬での昇格」（新制度）が ON のときだけ効く。
 * - 評価期間の延長：招待した人が参拝者になったとき、お参り期間中の招待主へ +1 日（上限なし）。
 * - ご縁（本人の決定 2026-11-27・11-26 の「なし」を撤回）：招待された人が通話に合計 4 時間いたら「1人」と数え、
 *   招待主へ 1 人につき +1。次の人数までは +2（参拝者：5人目まで・氏子：10人目まで・お世話役：上限なし）。
 *   参拝者→氏子の絵馬の補い（3つまで）も、この「1人」で数える。
 */
import type { Rank } from '../config.js';
import { highestRank } from './ranks.js';

/** 評価期間の延長：招待1人あたりの日数と、招待でのばせる合計の上限（日） */
export const INVITE_OMAIRI_EXT_DAYS = 1;
export const INVITE_OMAIRI_EXT_CAP_DAYS = Number.POSITIVE_INFINITY;

/** 招待された人が、通話にこの分いたら「1人」と数える */
export const INVITE_QUALIFY_MINUTES = 240;

/** 招待主の階級ごとの「+2 になる人数」（それより後は +1） */
export function inviteGoenDoubleCap(ranks: readonly Rank[], roleIds: readonly string[]): number {
  const key = highestRank(ranks, roleIds)?.key;
  if (key === 'sanpaisha') return 5;
  if (key === 'ujiko') return 10;
  if (key === 'sewayaku') return Number.POSITIVE_INFINITY;
  return 0;
}

/** 何人目の招待か（これまでにご縁をもらった招待の数 = before）から、今回のご縁 */
export function inviteGoenAmount(ranks: readonly Rank[], roleIds: readonly string[], before: number): 1 | 2 {
  return before < inviteGoenDoubleCap(ranks, roleIds) ? 2 : 1;
}

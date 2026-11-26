/**
 * 🤝 招待の特典（新制度⑥）。招待した人が参拝者になったときに、招待主へ。
 * 数字はたたき台。詳しくは docs/new-system-design.md。
 * 「絵馬での昇格」（新制度）が ON のときだけ効く。
 */
import type { Rank } from '../config.js';
import { highestRank } from './ranks.js';

/** 結び補填：招待主の階級ごとの「1人あたりのご縁」と「補填する人数の上限」 */
export type InviteGoenTier = { amount: number; cap: number };
export function inviteGoenTier(ranks: readonly Rank[], roleIds: readonly string[]): InviteGoenTier {
  const key = highestRank(ranks, roleIds)?.key;
  if (key === 'sanpaisha') return { amount: 2, cap: 5 }; // 最初の5人まで各2（上限10）
  if (key === 'ujiko') return { amount: 2, cap: 10 }; // 10人まで各2（上限20）
  if (key === 'sewayaku') return { amount: 2, cap: Number.POSITIVE_INFINITY }; // 全部2
  return { amount: 1, cap: Number.POSITIVE_INFINITY }; // それ以外（総代・神職・宮司など）：各1
}

/** 評価期間の延長：招待1人あたりの日数と、招待でのばせる合計の上限（日） */
export const INVITE_OMAIRI_EXT_DAYS = 1;
export const INVITE_OMAIRI_EXT_CAP_DAYS = Number.POSITIVE_INFINITY;

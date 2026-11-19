/**
 * 🎐 絵馬（評価の票）の決まり。2026年11月の新制度。
 * 詳しくは docs/new-system-design.md。数字はたたき台で、必要なら変える。
 */

/** いまは「氏子の票」だけ。あとで世話役・総代を足す。 */
export type EmaTier = 'ujiko';

/** 絵馬を贈るのに必要な「いっしょにいた」条件 */
export const EMA_DAYS_TOGETHER = 3; // 違う日◯日以上
export const EMA_MINUTES_TOGETHER = 180; // 合計◯分以上

/** 氏子の票は created_at から◯日で失効 */
export const EMA_EXPIRE_DAYS = 30;

/** 参拝者→氏子に必要な有効な絵馬の枚数 */
export const EMA_UJIKO_PROMOTE = 5;

/** これを割ると維持の警告（自動では降格しない） */
export const EMA_UJIKO_KEEP = 3;

/** 一言メッセージの最大文字数 */
export const EMA_MESSAGE_MAX = 100;

/** 氏子の票の有効期限の境目（この時刻より後に贈られたものが有効） */
export function emaFreshSince(now: Date): Date {
  return new Date(now.getTime() - EMA_EXPIRE_DAYS * 86_400_000);
}

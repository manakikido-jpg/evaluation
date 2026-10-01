import type { Who } from './types.js';

/**
 * 🤖 卓の BOT（ポーカー・大富豪・ババ抜き）。銭は胴元（鯖）が出す: BOT の参加費・持ち込みは引かず、
 * BOT が勝った分は鯖に戻る。カジノの収支には memberId = 'bot' の行で入る（bet = 鯖に戻った分・payout = 鯖が出した分）。
 */

export const BOT_PREFIX = 'bot:';
/** 収支の行に入れる名前 */
export const HOUSE_BOT_ID = 'bot';
export const isBot = (id: string) => id.startsWith(BOT_PREFIX);
/** BOT が考える時間（ms） */
export const BOT_THINK_MS = 1500;

const NAMES = ['🤖 鶴丸', '🤖 亀吉', '🤖 狐火', '🤖 狸腹', '🤖 猫又', '🤖 鷹目'];

/** まだ卓にいない BOT を 1 つ（ids: 卓にいる人） */
export function nextBot(ids: readonly string[]): Who {
  for (let k = 1; k <= NAMES.length; k++) {
    const id = `${BOT_PREFIX}${k}`;
    if (!ids.includes(id)) return { id, name: NAMES[k - 1]! };
  }
  const k = ids.length + 1;
  return { id: `${BOT_PREFIX}${k}`, name: `🤖 BOT ${k}` };
}

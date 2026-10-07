import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { grantJoinBonus, walletOf } from './economy.js';

/** 申請完了とロール付与の両方から呼ぶ。発行できた1回だけ知らせる。 */
export async function issueInitialCurrency(db: Db, cfg: GuildConfig, discord: Pick<DiscordActions, 'sendDm' | 'sendMessage'>, memberId: string): Promise<number> {
  const e = cfg.economy;
  const amount = await grantJoinBonus(db, memberId, e.joinBonus);
  if (!amount) return 0;
  const balance = await walletOf(db, memberId).then((w) => w.balance).catch(() => undefined);
  const detail = `${e.currencyEmoji} ${e.currencyName} ${amount.toLocaleString('ja-JP')} 枚${balance === undefined ? '' : `（残高 ${balance.toLocaleString('ja-JP')} 枚）`}`;
  // DMを受け取れない人でも、発行と運営へのお知らせは止めない。
  let delivered = false;
  try {
    delivered = await discord.sendDm(memberId, `初期通貨を発行されました。\n${detail}`);
  } catch (err) {
    logger.warn({ err, memberId }, 'initial currency dm failed');
  }
  const channelId = e.joinBonusChannelId ?? cfg.channels.log;
  if (e.joinBonusNotify && channelId) {
    try {
      await discord.sendMessage(channelId, { allowed_mentions: { parse: [] }, content: `${e.currencyEmoji} **初期通貨発行完了（初期配布）**\n<@${memberId}> さんに ${detail} を発行しました。${delivered ? '' : '\n本人へのDMは届きませんでした。'}` });
    } catch (err) {
      logger.warn({ err, memberId }, 'initial currency log failed');
    }
  }
  return amount;
}

import type { GuildConfig, Rank } from '../config.js';
import type { Db } from '../db/client.js';
import { decidePromotion, highestRank, type Promotion } from '../domain/ranks.js';
import { addCoins } from './economy.js';
import { giveShuin, revokeShuin } from './shuin.js';

/**
 * Discord に依存しない「朱印を押す／取り消す」の手順。
 * Discord 側はメンバー情報を渡し、結果に応じてメッセージ・ロール変更を行う。
 */

export type MemberInfo = { id: string; isBot: boolean; roleIds: readonly string[] };

export type GiveDenied =
  | 'self' // 自分に押そうとした
  | 'bot' // BOT には押せない
  | 'not_member' // 相手がサーバーにいない
  | 'giver_no_rank' // 押す人がまだ参拝者になっていない
  | 'yakudoshi' // 押す人が厄年
  | 'receiver_no_rank'; // 相手がまだ参拝者になっていない

export type GiveOutcome =
  | { kind: 'denied'; reason: GiveDenied }
  | { kind: 'given'; giverRank: Rank; weight: number; goen: number; restamped: boolean; promotion?: Promotion }
  | { kind: 'already'; weight: number; goen: number };

export async function giveFlow(
  db: Db,
  cfg: GuildConfig,
  giver: MemberInfo,
  receiver: MemberInfo | undefined,
): Promise<GiveOutcome> {
  if (!receiver) return { kind: 'denied', reason: 'not_member' };
  if (receiver.id === giver.id) return { kind: 'denied', reason: 'self' };
  if (receiver.isBot) return { kind: 'denied', reason: 'bot' };

  const yakudoshi = cfg.roles.yakudoshi;
  if (yakudoshi && giver.roleIds.includes(yakudoshi)) return { kind: 'denied', reason: 'yakudoshi' };

  const giverRank = highestRank(cfg.ranks, giver.roleIds);
  if (!giverRank) return { kind: 'denied', reason: 'giver_no_rank' };
  if (!highestRank(cfg.ranks, receiver.roleIds)) return { kind: 'denied', reason: 'receiver_no_rank' };

  // 朱印と通貨を一緒に記録する（途中で失敗したら、どちらも残さない）
  const res = await db.transaction(async (tx) => {
    const r = await giveShuin(tx, {
      giverId: giver.id,
      receiverId: receiver.id,
      weight: giverRank.weight,
      giverRank: giverRank.key,
    });
    // 通貨は同じ相手とは最初の 1 回だけ（取り消して押し直しても増えない）
    if (r.status === 'given' && !r.restamped) {
      const detail = { giverId: giver.id, receiverId: receiver.id };
      if (cfg.economy.shuinGive > 0) await addCoins(tx, giver.id, cfg.economy.shuinGive, 'shuin_give', detail);
      if (cfg.economy.shuinReceive > 0) await addCoins(tx, receiver.id, cfg.economy.shuinReceive, 'shuin_receive', detail);
    }
    return r;
  });
  if (res.status === 'already') return { kind: 'already', weight: res.weight, goen: res.goen };

  const promotion = decidePromotion(cfg.ranks, receiver.roleIds, res.goen);
  return {
    kind: 'given',
    giverRank,
    weight: res.weight,
    goen: res.goen,
    restamped: res.restamped,
    ...(promotion ? { promotion } : {}),
  };
}

export async function revokeFlow(db: Db, giverId: string, receiverId: string) {
  return revokeShuin(db, { giverId, receiverId });
}

import { adminLevelOf, type AdminLevel, type GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { memberEvents } from '../db/schema.js';
import { DiscordHttpError, type DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { audit } from './audit.js';
import { walletOf } from './economy.js';
import { eventsOf, getMember } from './members.js';
import {
  activeYakuCount,
  addMemo,
  buyMenzaifu,
  clearYakuByStaff,
  clearYakuForUnban,
  recordInstantBan,
  recordYaku,
  withMemberLock,
  type MenzaifuResult,
} from './yaku.js';

/**
 * 厄・BAN・キック・メモ。管理画面と Discord のコマンドの両方から呼ぶ。
 * DB の記録 → Discord への反映 → 操作の記録 の順に行う。
 * 本人への DM には神職の名前を出さない。
 */

export type ModCtx = { db: Db; cfg: GuildConfig; discord: DiscordActions };
export type Actor = { id: string; level: AdminLevel; via: 'web' | 'discord' | 'system' };

/** BOT が自動で行う操作（半自動承認・お参り期間の自動延長など） */
export const SYSTEM: Actor = { id: 'system', level: 'guji', via: 'system' };

export type Denied = 'self' | 'protected' | 'not_found';

/** 相手に操作してよいか。神職は神職・宮司に、宮司は宮司に操作できない */
export async function checkTarget(ctx: ModCtx, actor: Actor, targetId: string): Promise<Denied | undefined> {
  if (actor.id === targetId) return 'self';
  const target = await getMember(ctx.db, targetId);
  if (!target) return 'not_found';
  const level = adminLevelOf(ctx.cfg, target.roleIds);
  if (level === 'guji') return 'protected';
  if (level === 'shinshoku' && actor.level !== 'guji') return 'protected';
  return undefined;
}

const SIGN = '⛩ 咲楽ノ宮 社務所より';

export const dm = {
  warned: (reason: string, cfg: GuildConfig) => {
    const e = cfg.economy;
    return [
      SIGN,
      `厄が付きました（理由: ${reason}）。`,
      'もう 1 つ厄が付くと BAN になります。',
      e.menzaifuMaxUses > 0
        ? `${e.currencyEmoji}${e.currencyName} ${e.menzaifuPrice} で免罪符を購入すると、厄を祓えます（${e.menzaifuMaxUses} 回まで）。サーバーで \`/menzaifu\` を使ってください。`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  },
  bannedByYaku: (reason: string) => [SIGN, `厄が 2 つになったため BAN となりました（理由: ${reason}）。`].join('\n'),
  bannedInstantly: (reason: string) => [SIGN, `重大な違反（${reason}）のため BAN となりました。`].join('\n'),
  cleared: () => [SIGN, '厄が祓われました。'].join('\n'),
  kicked: (reason: string) => [SIGN, `サーバーから退出となりました（理由: ${reason}）。`].join('\n'),
};

async function safely(what: string, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (err) {
    logger.warn({ err, what }, 'discord action failed');
    return false;
  }
}

export type GiveYakuResult =
  | { status: 'denied'; reason: Denied }
  | { status: 'needs_confirm'; active: number }
  | { status: 'warned'; dmSent: boolean; roleOk: boolean }
  | { status: 'banned'; dmSent: boolean; banOk: boolean; /** 二重送信で、もう BAN 済みだった */ duplicate?: boolean };

/**
 * 厄を付ける。すでに 1 つある人に付けると BAN になるので、confirmBan が必要。
 */
export async function giveYaku(
  ctx: ModCtx,
  actor: Actor,
  targetId: string,
  reason: string,
  confirmBan: boolean,
): Promise<GiveYakuResult> {
  const denied = await checkTarget(ctx, actor, targetId);
  if (denied) return { status: 'denied', reason: denied };
  return withMemberLock(ctx.db, targetId, (tx) => giveYakuLocked({ ...ctx, db: tx }, actor, targetId, reason, confirmBan));
}

async function giveYakuLocked(ctx: ModCtx, actor: Actor, targetId: string, reason: string, confirmBan: boolean): Promise<GiveYakuResult> {
  const rec = await recordYaku(ctx.db, { memberId: targetId, reason, issuedBy: actor.id }, { confirmBan });
  if (rec.status === 'needs_confirm') return { status: 'needs_confirm', active: rec.active };
  if (rec.status === 'already_banned') {
    // 二重送信で、もう BAN 済み
    if (isBannedByEvents(await eventsOf(ctx.db, targetId))) return { status: 'banned', dmSent: false, banOk: true, duplicate: true };
    // 厄は 2 つあるのに、前回 Discord での BAN に失敗していた: BAN だけやり直す
    const banOk = await safely('ban', () => ctx.discord.ban(ctx.cfg.guildId, targetId, `厄 2 つ目: ${reason}`));
    await audit(ctx.db, { actorId: actor.id, targetId, action: 'member.ban', detail: { rule: 'yaku2', reason, ok: banOk, retry: true }, via: actor.via });
    if (banOk) await ctx.db.insert(memberEvents).values({ memberId: targetId, kind: 'ban', detail: { rule: 'yaku2', reason } });
    return { status: 'banned', dmSent: false, banOk };
  }
  const { id, active } = rec;
  const g = ctx.cfg.guildId;

  if (active >= 2) {
    // BAN すると DM が届かなくなるので、先に知らせる
    const dmSent = await ctx.discord.sendDm(targetId, dm.bannedByYaku(reason));
    const banOk = await safely('ban', () => ctx.discord.ban(g, targetId, `厄 2 つ目: ${reason}`));
    await audit(ctx.db, { actorId: actor.id, targetId, action: 'yaku.add', detail: { reason, yakuId: id, active }, via: actor.via });
    await audit(ctx.db, { actorId: actor.id, targetId, action: 'member.ban', detail: { rule: 'yaku2', reason, ok: banOk }, via: actor.via });
    if (banOk) await ctx.db.insert(memberEvents).values({ memberId: targetId, kind: 'ban', detail: { rule: 'yaku2', reason } });
    return { status: 'banned', dmSent, banOk };
  }

  const yakudoshi = ctx.cfg.roles.yakudoshi;
  const roleOk = yakudoshi ? await safely('add yakudoshi', () => ctx.discord.addRole(g, targetId, yakudoshi, `厄: ${reason}`)) : true;
  const dmSent = await ctx.discord.sendDm(targetId, dm.warned(reason, ctx.cfg));
  await audit(ctx.db, { actorId: actor.id, targetId, action: 'yaku.add', detail: { reason, yakuId: id, active, dmSent }, via: actor.via });
  return { status: 'warned', dmSent, roleOk };
}

export type InstantBanResult = { status: 'denied'; reason: Denied } | { status: 'banned'; dmSent: boolean; banOk: boolean };

/** 一発 BAN（重大な違反） */
export async function instantBan(ctx: ModCtx, actor: Actor, targetId: string, reason: string, note: string): Promise<InstantBanResult> {
  const denied = await checkTarget(ctx, actor, targetId);
  if (denied) return { status: 'denied', reason: denied };
  return withMemberLock(ctx.db, targetId, (tx) => instantBanLocked({ ...ctx, db: tx }, actor, targetId, reason, note));
}

async function instantBanLocked(ctx: ModCtx, actor: Actor, targetId: string, reason: string, note: string): Promise<InstantBanResult> {
  // 二重送信: もう BAN 済みなら何もしない
  if (isBannedByEvents(await eventsOf(ctx.db, targetId))) return { status: 'banned', dmSent: false, banOk: true };
  const full = note ? `${reason}（${note}）` : reason;
  const id = await recordInstantBan(ctx.db, { memberId: targetId, reason: full, issuedBy: actor.id });
  const dmSent = await ctx.discord.sendDm(targetId, dm.bannedInstantly(reason));
  const banOk = await safely('ban', () => ctx.discord.ban(ctx.cfg.guildId, targetId, `一発 BAN: ${full}`));
  await audit(ctx.db, { actorId: actor.id, targetId, action: 'member.ban', detail: { rule: 'instant', reason, note, yakuId: id, ok: banOk }, via: actor.via });
  if (banOk) await ctx.db.insert(memberEvents).values({ memberId: targetId, kind: 'ban', detail: { rule: 'instant', reason } });
  return { status: 'banned', dmSent, banOk };
}

export type ClearResult = { status: 'denied'; reason: Denied } | { status: 'none' } | { status: 'cleared'; remaining: number };

/** 神職による厄の取り消し */
export async function clearYaku(ctx: ModCtx, actor: Actor, targetId: string, note: string): Promise<ClearResult> {
  const denied = await checkTarget(ctx, actor, targetId);
  if (denied) return { status: 'denied', reason: denied };
  const r = await clearYakuByStaff(ctx.db, { memberId: targetId, by: actor.id, note });
  if (!r.cleared) return { status: 'none' };
  await afterCleared(ctx, targetId, r.remaining, '神職による取り消し');
  await audit(ctx.db, { actorId: actor.id, targetId, action: 'yaku.clear', detail: { note, remaining: r.remaining }, via: actor.via });
  return { status: 'cleared', remaining: r.remaining };
}

/** 本人が免罪符を買う（Discord の /menzaifu） */
export async function purchaseMenzaifu(ctx: ModCtx, memberId: string): Promise<MenzaifuResult> {
  const r = await buyMenzaifu(ctx.db, ctx.cfg.economy, memberId, async (tx) => (await walletOf(tx, memberId)).balance);
  if (r.status === 'ok') {
    await afterCleared(ctx, memberId, r.remaining, '免罪符');
    await audit(ctx.db, { actorId: memberId, targetId: memberId, action: 'yaku.menzaifu', detail: { price: r.price, remaining: r.remaining }, via: 'discord' });
  }
  return r;
}

async function afterCleared(ctx: ModCtx, memberId: string, remaining: number, why: string): Promise<void> {
  const yakudoshi = ctx.cfg.roles.yakudoshi;
  if (remaining === 0 && yakudoshi) {
    await safely('remove yakudoshi', () => ctx.discord.removeRole(ctx.cfg.guildId, memberId, yakudoshi, `厄が祓われた（${why}）`));
  }
  await ctx.discord.sendDm(memberId, dm.cleared());
}

export type KickResult = { status: 'denied'; reason: Denied } | { status: 'kicked'; dmSent: boolean; kickOk: boolean };

/** キック（宮司・神職のみ） */
export async function kickMember(ctx: ModCtx, actor: Actor, targetId: string, reason: string): Promise<KickResult> {
  const denied = await checkTarget(ctx, actor, targetId);
  if (denied) return { status: 'denied', reason: denied };
  const dmSent = await ctx.discord.sendDm(targetId, dm.kicked(reason));
  const kickOk = await safely('kick', () => ctx.discord.kick(ctx.cfg.guildId, targetId, reason));
  await audit(ctx.db, { actorId: actor.id, targetId, action: 'member.kick', detail: { reason, ok: kickOk }, via: actor.via });
  return { status: 'kicked', dmSent, kickOk };
}

export type UnbanResult =
  | { status: 'forbidden' }
  | { status: 'not_banned' }
  | { status: 'failed' }
  | { status: 'unbanned'; alreadyUnbanned: boolean; cleared: number; remaining: number };

/**
 * BAN を解除する（宮司のみ）。厄は keep 個（0 = 全部祓う、1 = 厄年からやり直し）だけ残す。
 * Discord 側ですでに解除されていても、厄の整理はする。入り直したら、入鯖申請からやり直し。
 */
export async function unbanMember(ctx: ModCtx, actor: Actor, memberId: string, keep: 0 | 1, note: string): Promise<UnbanResult> {
  if (actor.level !== 'guji') return { status: 'forbidden' };
  // BAN されていない人の厄を、解除のついでに消してしまわないように
  if (!isBannedByEvents(await eventsOf(ctx.db, memberId))) return { status: 'not_banned' };
  let alreadyUnbanned = false;
  try {
    await ctx.discord.unban(ctx.cfg.guildId, memberId, note ? `BAN 解除: ${note}` : 'BAN 解除');
  } catch (err) {
    // Unknown Ban（すでに解除されている）
    if (err instanceof DiscordHttpError && err.status === 404) alreadyUnbanned = true;
    else {
      logger.warn({ err }, 'unban failed');
      return { status: 'failed' };
    }
  }
  const { cleared, remaining } = await clearYakuForUnban(ctx.db, { memberId, by: actor.id, keep, note });
  await ctx.db.insert(memberEvents).values({ memberId, kind: 'unban', detail: { keep, remaining } });
  await audit(ctx.db, { actorId: actor.id, targetId: memberId, action: 'member.unban', detail: { keep, cleared, remaining, note, alreadyUnbanned }, via: actor.via });
  return { status: 'unbanned', alreadyUnbanned, cleared, remaining };
}

/** いま BAN されているか（記録の上で。最後の BAN のあとに解除がなければ BAN 中） */
export function isBannedByEvents(events: { kind: string; at: Date }[]): boolean {
  const last = [...events].filter((e) => e.kind === 'ban' || e.kind === 'unban').sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  return last?.kind === 'ban';
}

/** 申し送りメモ */
export async function writeMemo(ctx: ModCtx, actor: Actor, targetId: string, body: string): Promise<'ok' | 'not_found'> {
  if (!(await getMember(ctx.db, targetId))) return 'not_found';
  await addMemo(ctx.db, { memberId: targetId, body, authorId: actor.id });
  await audit(ctx.db, { actorId: actor.id, targetId, action: 'memo.add', via: actor.via });
  return 'ok';
}

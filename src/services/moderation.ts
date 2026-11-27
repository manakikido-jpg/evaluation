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
      '厄のあいだは、通話は縁側だけ・使えるのはお問い合わせ・おみくじ・物御籤だけになります。',
      e.menzaifuMaxUses > 0
        ? `#授与所 で厄祓い（${e.currencyEmoji}${e.currencyName} ${e.menzaifuPrice}）を受けると、運営との面接のあとに厄が祓われます（${e.menzaifuMaxUses} 回まで）。`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  },
  bannedByYaku: (reason: string) => [SIGN, `厄が 2 つになったため BAN となりました（理由: ${reason}）。`].join('\n'),
  bannedInstantly: (reason: string) => [SIGN, `重大な違反（${reason}）のため BAN となりました。`].join('\n'),
  cleared: () => [SIGN, '厄が祓われました。'].join('\n'),
  yakubaraiWaiting: () => [SIGN, '厄祓いを受け付けました。運営との面接のあとに厄が祓われます。運営から声がかかるまでお待ちください。'].join('\n'),
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

export type ClearResult =
  | { status: 'denied'; reason: Denied }
  /** 厄の記録はなかった。roleFixed: 👹厄年ロールだけ残っていたので外した（roleOk: 外せたか） */
  | { status: 'none'; roleFixed?: boolean; roleOk: boolean }
  /** roleOk: 厄が 0 になって 👹厄年ロールを外せたか（外さなくてよいときも true） */
  | { status: 'cleared'; remaining: number; roleOk: boolean };

/** 神職による厄の取り消し。厄の記録がないのに 👹厄年ロールだけ残っているときは、ロールを外す */
export async function clearYaku(ctx: ModCtx, actor: Actor, targetId: string, note: string): Promise<ClearResult> {
  const denied = await checkTarget(ctx, actor, targetId);
  if (denied) return { status: 'denied', reason: denied };
  const r = await clearYakuByStaff(ctx.db, { memberId: targetId, by: actor.id, note });
  if (!r.cleared) {
    const yakudoshi = ctx.cfg.roles.yakudoshi;
    const m = yakudoshi && r.remaining === 0 ? await getMember(ctx.db, targetId) : undefined;
    if (!yakudoshi || !m?.roleIds.includes(yakudoshi)) return { status: 'none', roleOk: true };
    const roleOk = await safely('remove leftover yakudoshi', () => ctx.discord.removeRole(ctx.cfg.guildId, targetId, yakudoshi, '厄の記録がないので、残っていた厄年を外す'));
    if (roleOk) await ctx.discord.sendDm(targetId, dm.cleared()).catch(() => false);
    await audit(ctx.db, { actorId: actor.id, targetId, action: 'yaku.role_fix', detail: { note, roleOk }, via: actor.via });
    return { status: 'none', roleFixed: true, roleOk };
  }
  const roleOk = await afterCleared(ctx, targetId, r.remaining, r.yakubarai ? '厄祓い（面接のあと）' : '神職による取り消し');
  await audit(ctx.db, { actorId: actor.id, targetId, action: 'yaku.clear', detail: { note, remaining: r.remaining, roleOk }, via: actor.via });
  return { status: 'cleared', remaining: r.remaining, roleOk };
}

/** 👹厄年ロールを外せなかったときの、運営への案内 */
export const YAKU_ROLE_FAILED = '⚠️ 👹厄年ロールを外せませんでした。Discord のサーバー設定 → ロールで、BOT のロールを「厄年」より上に動かしてから、もう一度「取り消す」を押してください（手で外してもかまいません）。';

/** 本人が厄祓いを買う（授与所・/厄祓い）。面接待ちになり、#記録 に運営への知らせ（祓うボタンつき）を出す */
export async function purchaseMenzaifu(ctx: ModCtx, memberId: string, roleIds?: readonly string[]): Promise<MenzaifuResult> {
  // 👹厄年ロールを手で付けた人など、厄の記録がなくてもロールがあれば申し込める
  const yakudoshi = ctx.cfg.roles.yakudoshi;
  const roles = roleIds ?? (await getMember(ctx.db, memberId))?.roleIds ?? [];
  const hasRole = Boolean(yakudoshi && roles.includes(yakudoshi));
  const r = await buyMenzaifu(ctx.db, ctx.cfg.economy, memberId, async (tx) => (await walletOf(tx, memberId)).balance, hasRole);
  if (r.status === 'ok') {
    await audit(ctx.db, { actorId: memberId, targetId: memberId, action: 'yaku.yakubarai', detail: { price: r.price }, via: 'discord' });
    await ctx.discord.sendDm(memberId, dm.yakubaraiWaiting()).catch(() => false);
    const log = ctx.cfg.channels.log;
    if (log) {
      await safely('yakubarai notice', () =>
        ctx.discord.sendMessage(log, {
          content: `🙏 厄祓いの申し込み <@${memberId}>（${ctx.cfg.economy.currencyEmoji}${r.price}）。面接をして、よければ「面接して祓う」を押してください。`,
          allowed_mentions: { parse: [] },
          components: [{ type: 1, components: [{ type: 2, style: 1, custom_id: `${YAKUBARAI_DONE}${memberId}`, label: '🙏 面接して祓う' }] }],
        }),
      );
    }
  }
  return r;
}

/** #記録 の「面接して祓う」ボタンの customId の頭 */
export const YAKUBARAI_DONE = 'yakubarai:done:';

/** 厄祓いを買ったときの返事（授与所・/厄祓い で同じ文） */
export function yakubaraiResultText(r: MenzaifuResult, e: Pick<GuildConfig['economy'], 'currencyEmoji' | 'currencyName'>): string {
  if (r.status === 'ok') return `🙏 厄祓いを申し込みました（${e.currencyEmoji}-${r.price}）。運営との面接のあとに祓われます。運営から声がかかるまでお待ちください。`;
  if (r.status === 'no_yaku') return `祓う厄がありません（${e.currencyName}は減っていません）。`;
  if (r.status === 'waiting') return 'もう申し込んでいます。運営との面接をお待ちください。';
  if (r.status === 'used_up') return `厄祓いは 1 人 ${r.max} 回までです。`;
  return `${e.currencyName}が足りません（${r.price} 枚必要・いま ${r.balance} 枚）。`;
}

async function afterCleared(ctx: ModCtx, memberId: string, remaining: number, why: string): Promise<boolean> {
  const yakudoshi = ctx.cfg.roles.yakudoshi;
  let roleOk = true;
  if (remaining === 0 && yakudoshi) {
    roleOk = await safely('remove yakudoshi', () => ctx.discord.removeRole(ctx.cfg.guildId, memberId, yakudoshi, `厄が祓われた（${why}）`));
  }
  await ctx.discord.sendDm(memberId, dm.cleared());
  return roleOk;
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

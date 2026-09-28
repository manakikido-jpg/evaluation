import { and, asc, desc, eq, isNotNull, isNull, lte, or } from 'drizzle-orm';
import type { AdminLevel, GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { members, tempGrants, type TempGrant } from '../db/schema.js';
import type { DiscordActions, GuildChannel, GuildRole } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { audit } from './audit.js';
import { staffRoleIds } from './meetings.js';
import { botTopPosition, dangerLabels, permsOf } from './roles.js';

/**
 * ⏳ 一時的なロール・チャンネルの権限: 運営が期限つきで付け、期限が来たら BOT が外す（1 分ごと）。
 * チャンネルの権限は、その人だけの上書きで付け、外すときは付ける前の上書きに戻す。
 * 危ない権限を持つロール・運営のロールを付けられるのは宮司だけ。
 */

export { DURATIONS, durationMinutes, isPermPreset, PERM_PRESETS, type DurationKey, type PermPreset } from './tempGrantPresets.js';
import { isPermPreset, PERM_PRESETS, type PermPreset } from './tempGrantPresets.js';

export type GrantCtx = { db: Db; cfg: GuildConfig; discord: DiscordActions };
export type GrantResult =
  | { status: 'granted' | 'extended'; grant: TempGrant }
  | { status: 'self' | 'guji_only' | 'locked' | 'already' | 'not_found' | 'failed' };

export const GRANT_MESSAGES: Record<Exclude<GrantResult['status'], 'granted' | 'extended'>, string> = {
  self: '自分には付けられません。',
  guji_only: '危ない権限を持つロール・運営のロールを付けられるのは宮司だけです。',
  locked: 'このロールは BOT からは付けられません（BOT のロールより上か、BOT などの自動のロール・みんな）。',
  already: 'その方はもうこのロールを持っています（一時的なものではありません）。',
  not_found: 'ロールかチャンネルが見つかりませんでした。',
  failed: 'Discord に反映できませんでした。BOT の「ロールの管理」「チャンネルの管理」の権限を確かめてください。',
};

/** 日本時間の「9/29（火）21:00」 */
export function jstShort(d: Date): string {
  const j = new Date(d.getTime() + 9 * 3_600_000);
  const w = ['日', '月', '火', '水', '木', '金', '土'][j.getUTCDay()];
  return `${j.getUTCMonth() + 1}/${j.getUTCDate()}（${w}）${String(j.getUTCHours()).padStart(2, '0')}:${String(j.getUTCMinutes()).padStart(2, '0')}`;
}

/** 残り（「あと 1 時間 20 分」） */
export function remaining(until: Date, now: Date): string {
  const m = Math.max(0, Math.ceil((until.getTime() - now.getTime()) / 60_000));
  if (m >= 1440) return `あと ${Math.floor(m / 1440)} 日${m % 1440 >= 60 ? ` ${Math.floor((m % 1440) / 60)} 時間` : ''}`;
  if (m >= 60) return `あと ${Math.floor(m / 60)} 時間${m % 60 ? ` ${m % 60} 分` : ''}`;
  return `あと ${m} 分`;
}

/** 何を付けたか（「@ロール」「#チャンネル の ✍ 書き込める」） */
export const grantLabel = (g: Pick<TempGrant, 'kind' | 'roleId' | 'channelId' | 'preset'>) =>
  g.kind === 'role' ? `<@&${g.roleId}>` : `<#${g.channelId}> の ${isPermPreset(g.preset) ? PERM_PRESETS[g.preset].label : g.preset}`;

async function log(ctx: GrantCtx, text: string): Promise<void> {
  const ch = ctx.cfg.channels.log;
  if (!ch) return;
  await ctx.discord.sendMessage(ch, { content: text }).catch((err) => logger.warn({ err }, 'temp grant log failed'));
}

async function active(db: Db, where: ReturnType<typeof and>): Promise<TempGrant | undefined> {
  const [row] = await db.select().from(tempGrants).where(and(isNull(tempGrants.endedAt), where));
  return row;
}

/** ロールを一時的に付ける（もう一時的に付いていれば期限を付け直す） */
export async function grantRole(
  ctx: GrantCtx,
  opts: { memberId: string; roleId: string; minutes: number; reason: string; by: string; byLevel: AdminLevel; roles: GuildRole[]; memberRoleIds?: readonly string[]; botId?: string; now?: Date; via?: 'web' | 'discord' },
): Promise<GrantResult> {
  const now = opts.now ?? new Date();
  if (opts.memberId === opts.by) return { status: 'self' };
  const role = opts.roles.find((r) => r.id === opts.roleId);
  if (!role) return { status: 'not_found' };
  if (role.id === ctx.cfg.guildId || role.managed || role.position >= botTopPosition(opts.roles, opts.botId)) return { status: 'locked' };
  const risky = dangerLabels(permsOf(role)).length > 0 || staffRoleIds(ctx.cfg).has(role.id);
  if (risky && opts.byLevel !== 'guji') return { status: 'guji_only' };
  const expiresAt = new Date(now.getTime() + opts.minutes * 60_000);
  const old = await active(ctx.db, and(eq(tempGrants.kind, 'role'), eq(tempGrants.memberId, opts.memberId), eq(tempGrants.roleId, opts.roleId)));
  if (old) {
    const [g] = await ctx.db.update(tempGrants).set({ expiresAt, reason: opts.reason || old.reason }).where(eq(tempGrants.id, old.id)).returning();
    await audit(ctx.db, { actorId: opts.by, action: 'temp.extend', targetId: opts.memberId, detail: { id: old.id, until: expiresAt.toISOString() }, via: opts.via ?? 'web' });
    await log(ctx, `⏳ <@${opts.by}> が <@${opts.memberId}> の <@&${opts.roleId}> を ${jstShort(expiresAt)} までにしました`);
    return { status: 'extended', grant: g! };
  }
  if (opts.memberRoleIds?.includes(opts.roleId)) return { status: 'already' };
  try {
    await ctx.discord.addRole(ctx.cfg.guildId, opts.memberId, opts.roleId, `一時的に付ける（${opts.minutes} 分）: ${opts.reason}`.slice(0, 400));
  } catch (err) {
    logger.warn({ err }, 'temp role add failed');
    return { status: 'failed' };
  }
  const [g] = await ctx.db
    .insert(tempGrants)
    .values({ kind: 'role', memberId: opts.memberId, roleId: opts.roleId, reason: opts.reason, grantedBy: opts.by, grantedAt: now, expiresAt })
    .returning();
  await audit(ctx.db, { actorId: opts.by, action: 'temp.grant', targetId: opts.memberId, detail: { id: g!.id, roleId: opts.roleId, minutes: opts.minutes, reason: opts.reason }, via: opts.via ?? 'web' });
  await log(ctx, `⏳ <@${opts.by}> が <@${opts.memberId}> に <@&${opts.roleId}> を ${jstShort(expiresAt)} まで付けました${opts.reason ? `（${opts.reason}）` : ''}`);
  await ctx.discord.sendDm(opts.memberId, `⏳ ${role.name} のロールが ${jstShort(expiresAt)} まで付きました。${opts.reason ? `（${opts.reason}）` : ''}`).catch(() => false);
  return { status: 'granted', grant: g! };
}

// ───────── ふつうのロール（期限なし）: /ロール ─────────

export type RoleChangeResult =
  | { status: 'given' | 'removed'; madePermanent?: boolean }
  | { status: 'self' | 'guji_only' | 'locked' | 'already' | 'not_has' | 'rank' | 'not_found' | 'failed' };

export const ROLE_CHANGE_MESSAGES: Record<Exclude<RoleChangeResult['status'], 'given' | 'removed'>, string> = {
  self: '自分のロールは変えられません。',
  guji_only: GRANT_MESSAGES.guji_only,
  locked: GRANT_MESSAGES.locked,
  already: 'その方はもうこのロールを持っています。',
  not_has: 'その方はこのロールを持っていません。',
  rank: 'ご縁で上がる役職のロールは BOT が付け外しするので、ここでは変えられません（任命制の役職なら宮司が付けられます）。',
  not_found: 'ロールが見つかりませんでした。',
  failed: 'Discord に反映できませんでした。BOT の「ロールの管理」の権限と、ロールの順番（BOT のロールより下か）を確かめてください。',
};

/**
 * ロールをふつうに（期限なしで）付ける・外す。一時ロールと同じ決まり（BOT より上・危ないロール・運営のロールは宮司だけ）。
 * 一時的に付いていたロールを「付ける」と、期限なしに変える（外さずに、一時の記録だけ終える）。
 * 一時的に付いていたロールを「外す」と、一時の記録も終える。
 */
export async function changeRole(
  ctx: GrantCtx,
  opts: { action: 'give' | 'remove'; memberId: string; roleId: string; reason: string; by: string; byLevel: AdminLevel; roles: GuildRole[]; memberRoleIds: readonly string[]; botId?: string; now?: Date; via?: 'web' | 'discord' },
): Promise<RoleChangeResult> {
  const now = opts.now ?? new Date();
  if (opts.memberId === opts.by) return { status: 'self' };
  const role = opts.roles.find((r) => r.id === opts.roleId);
  if (!role) return { status: 'not_found' };
  if (role.id === ctx.cfg.guildId || role.managed || role.position >= botTopPosition(opts.roles, opts.botId)) return { status: 'locked' };
  if (ctx.cfg.ranks.some((r) => r.auto && r.roleId === role.id)) return { status: 'rank' };
  const risky = dangerLabels(permsOf(role)).length > 0 || staffRoleIds(ctx.cfg).has(role.id);
  if (risky && opts.byLevel !== 'guji') return { status: 'guji_only' };
  const temp = await active(ctx.db, and(eq(tempGrants.kind, 'role'), eq(tempGrants.memberId, opts.memberId), eq(tempGrants.roleId, opts.roleId)));
  const has = opts.memberRoleIds.includes(opts.roleId);
  const via = opts.via ?? 'discord';
  const why = opts.reason ? `（${opts.reason}）` : '';
  if (opts.action === 'give') {
    if (has && !temp) return { status: 'already' };
    if (!has) {
      try {
        await ctx.discord.addRole(ctx.cfg.guildId, opts.memberId, opts.roleId, `ロールを付ける: ${opts.reason}`.slice(0, 400));
      } catch (err) {
        logger.warn({ err }, 'role add failed');
        return { status: 'failed' };
      }
    }
    if (temp) await ctx.db.update(tempGrants).set({ endedAt: now, endedBy: opts.by, endReason: 'permanent' }).where(eq(tempGrants.id, temp.id));
    await audit(ctx.db, { actorId: opts.by, action: 'role.give', targetId: opts.memberId, detail: { roleId: opts.roleId, reason: opts.reason, fromTemp: temp?.id }, via });
    await log(ctx, `🏷 <@${opts.by}> が <@${opts.memberId}> に <@&${opts.roleId}> を付けました${temp ? '（一時的 → 期限なし）' : ''}${why}`);
    return { status: 'given', madePermanent: Boolean(temp) };
  }
  if (!has) {
    // Discord ではもう外れているのに、一時の記録だけ残っていたら終える
    if (temp) await ctx.db.update(tempGrants).set({ endedAt: now, endedBy: opts.by, endReason: 'revoked' }).where(eq(tempGrants.id, temp.id));
    return { status: 'not_has' };
  }
  try {
    await ctx.discord.removeRole(ctx.cfg.guildId, opts.memberId, opts.roleId, `ロールを外す: ${opts.reason}`.slice(0, 400));
  } catch (err) {
    logger.warn({ err }, 'role remove failed');
    return { status: 'failed' };
  }
  if (temp) await ctx.db.update(tempGrants).set({ endedAt: now, endedBy: opts.by, endReason: 'revoked' }).where(eq(tempGrants.id, temp.id));
  await audit(ctx.db, { actorId: opts.by, action: 'role.remove', targetId: opts.memberId, detail: { roleId: opts.roleId, reason: opts.reason }, via });
  await log(ctx, `🏷 <@${opts.by}> が <@${opts.memberId}> の <@&${opts.roleId}> を外しました${why}`);
  return { status: 'removed' };
}

/** チャンネルの権限を一時的に付ける（その人だけの上書き。同じチャンネルにもう付いていれば、外してから付け直す） */
export async function grantPerm(
  ctx: GrantCtx,
  opts: { memberId: string; channelId: string; preset: PermPreset; minutes: number; reason: string; by: string; byLevel: AdminLevel; channels: GuildChannel[]; now?: Date; via?: 'web' | 'discord' },
): Promise<GrantResult> {
  const now = opts.now ?? new Date();
  if (opts.memberId === opts.by) return { status: 'self' };
  let channel = opts.channels.find((c) => c.id === opts.channelId && c.type !== 4);
  if (!channel) return { status: 'not_found' };
  const expiresAt = new Date(now.getTime() + opts.minutes * 60_000);
  const old = await active(ctx.db, and(eq(tempGrants.kind, 'perm'), eq(tempGrants.memberId, opts.memberId), eq(tempGrants.channelId, opts.channelId)));
  if (old && old.preset === opts.preset) {
    const [g] = await ctx.db.update(tempGrants).set({ expiresAt, reason: opts.reason || old.reason }).where(eq(tempGrants.id, old.id)).returning();
    await audit(ctx.db, { actorId: opts.by, action: 'temp.extend', targetId: opts.memberId, detail: { id: old.id, until: expiresAt.toISOString() }, via: opts.via ?? 'web' });
    await log(ctx, `⏳ <@${opts.by}> が <@${opts.memberId}> の ${grantLabel(old)} を ${jstShort(expiresAt)} までにしました`);
    return { status: 'extended', grant: g! };
  }
  if (old) {
    // 違う権限なら、前のを戻してから付け直す
    const r = await endGrant(ctx, old, opts.by, 'revoked', now, opts.via);
    if (r === 'failed') return { status: 'failed' };
    const prevOw = old.prevAllow === null ? undefined : { id: opts.memberId, type: 1 as const, allow: old.prevAllow, deny: old.prevDeny ?? '0' };
    channel = { ...channel, permission_overwrites: [...(channel.permission_overwrites ?? []).filter((o) => o.id !== opts.memberId), ...(prevOw ? [prevOw] : [])] };
  }
  const prev = (channel.permission_overwrites ?? []).find((o) => o.id === opts.memberId && o.type === 1);
  const p = PERM_PRESETS[opts.preset];
  const prevAllow = BigInt(prev?.allow ?? '0');
  const prevDeny = BigInt(prev?.deny ?? '0');
  const allow = (prevAllow | p.allow) & ~p.deny;
  const deny = (prevDeny & ~p.allow) | p.deny;
  try {
    await ctx.discord.setChannelOverwrite(opts.channelId, { id: opts.memberId, type: 1, allow: allow.toString(), deny: deny.toString() }, `一時的な権限（${opts.minutes} 分）: ${opts.reason}`.slice(0, 400));
  } catch (err) {
    logger.warn({ err }, 'temp perm set failed');
    return { status: 'failed' };
  }
  const [g] = await ctx.db
    .insert(tempGrants)
    .values({
      kind: 'perm',
      memberId: opts.memberId,
      channelId: opts.channelId,
      preset: opts.preset,
      prevAllow: prev ? prev.allow : null,
      prevDeny: prev ? prev.deny : null,
      reason: opts.reason,
      grantedBy: opts.by,
      grantedAt: now,
      expiresAt,
    })
    .returning();
  await audit(ctx.db, { actorId: opts.by, action: 'temp.grant', targetId: opts.memberId, detail: { id: g!.id, channelId: opts.channelId, preset: opts.preset, minutes: opts.minutes, reason: opts.reason }, via: opts.via ?? 'web' });
  await log(ctx, `⏳ <@${opts.by}> が <@${opts.memberId}> に ${grantLabel(g!)} を ${jstShort(expiresAt)} まで付けました${opts.reason ? `（${opts.reason}）` : ''}`);
  await ctx.discord.sendDm(opts.memberId, `⏳ #${channel.name} で「${p.label.replace(/^\S+ /, '')}」が ${jstShort(expiresAt)} までになりました。${opts.reason ? `（${opts.reason}）` : ''}`).catch(() => false);
  return { status: 'granted', grant: g! };
}

/** 消えていた（ロール・チャンネル・人がいない）なら、外せたことにする */
const gone = (err: unknown) => /\b404\b|Unknown (Role|Channel|Member|Overwrite)/i.test(String((err as Error)?.message ?? err));

/** 外す（期限・手で）。Discord に反映できなければ 'failed'（期限のときは次の 1 分でもう一度） */
export async function endGrant(ctx: GrantCtx, g: TempGrant, by: string, reason: 'expired' | 'revoked', now = new Date(), via: 'web' | 'discord' = 'web'): Promise<'ended' | 'failed'> {
  try {
    if (g.kind === 'role' && g.roleId) {
      await ctx.discord.removeRole(ctx.cfg.guildId, g.memberId, g.roleId, reason === 'expired' ? '一時的なロールの期限' : '一時的なロールを外した');
    } else if (g.kind === 'perm' && g.channelId) {
      const why = reason === 'expired' ? '一時的な権限の期限' : '一時的な権限を外した';
      if (g.prevAllow !== null) await ctx.discord.setChannelOverwrite(g.channelId, { id: g.memberId, type: 1, allow: g.prevAllow, deny: g.prevDeny ?? '0' }, why);
      else if (ctx.discord.deleteChannelOverwrite) await ctx.discord.deleteChannelOverwrite(g.channelId, g.memberId, why);
      else await ctx.discord.setChannelOverwrite(g.channelId, { id: g.memberId, type: 1, allow: '0', deny: '0' }, why);
    }
  } catch (err) {
    if (!gone(err)) {
      logger.warn({ err, id: g.id }, 'temp grant end failed');
      return 'failed';
    }
  }
  await ctx.db.update(tempGrants).set({ endedAt: now, endedBy: by, endReason: reason }).where(eq(tempGrants.id, g.id));
  await audit(ctx.db, { actorId: by, action: reason === 'expired' ? 'temp.expire' : 'temp.revoke', targetId: g.memberId, detail: { id: g.id }, via: by === 'system' ? 'system' : via });
  await log(ctx, reason === 'expired' ? `⌛ <@${g.memberId}> の ${grantLabel(g)} が期限で外れました` : `⏹ <@${by}> が <@${g.memberId}> の ${grantLabel(g)} を外しました`);
  return 'ended';
}

export async function getGrant(db: Db, id: number): Promise<TempGrant | undefined> {
  const [row] = await db.select().from(tempGrants).where(eq(tempGrants.id, id));
  return row;
}

/** 期限をのばす（今の期限から）。終わっていれば false */
export async function extendGrant(ctx: GrantCtx, id: number, minutes: number, by: string): Promise<boolean> {
  const g = await getGrant(ctx.db, id);
  if (!g || g.endedAt) return false;
  const expiresAt = new Date(g.expiresAt.getTime() + minutes * 60_000);
  await ctx.db.update(tempGrants).set({ expiresAt }).where(eq(tempGrants.id, id));
  await audit(ctx.db, { actorId: by, action: 'temp.extend', targetId: g.memberId, detail: { id, until: expiresAt.toISOString() }, via: 'web' });
  await log(ctx, `⏳ <@${by}> が <@${g.memberId}> の ${grantLabel(g)} を ${jstShort(expiresAt)} までにのばしました`);
  return true;
}

export async function activeGrants(db: Db, opts: { memberId?: string } = {}): Promise<TempGrant[]> {
  return db
    .select()
    .from(tempGrants)
    .where(and(isNull(tempGrants.endedAt), opts.memberId ? eq(tempGrants.memberId, opts.memberId) : undefined))
    .orderBy(asc(tempGrants.expiresAt));
}

export async function endedGrants(db: Db, limit = 50): Promise<TempGrant[]> {
  return db.select().from(tempGrants).where(isNotNull(tempGrants.endedAt)).orderBy(desc(tempGrants.endedAt)).limit(limit);
}

/** 1 分ごと: 期限が来たものを外す。外した数 */
export async function expireTick(ctx: GrantCtx, now = new Date()): Promise<number> {
  const due = await ctx.db
    .select()
    .from(tempGrants)
    .where(and(isNull(tempGrants.endedAt), lte(tempGrants.expiresAt, now)));
  let n = 0;
  for (const g of due) if ((await endGrant(ctx, g, 'system', 'expired', now)) === 'ended') n++;
  return n;
}

// ───────── 相手を選ぶ（社務所Web） ─────────

/** 今いる人の名前（候補に出す） */
export async function activeMemberNames(db: Db): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: members.id, name: members.displayName })
    .from(members)
    .where(and(isNull(members.leftAt), eq(members.isBot, false)))
    .orderBy(asc(members.displayName));
}

/** 名前・ユーザー名・ID から今いる人を 1 人見つける（何人も当たれば見つからないことにする） */
export async function findActiveMember(db: Db, v: string): Promise<string | undefined> {
  const q = v.trim();
  if (!q) return undefined;
  const rows = await db
    .select({ id: members.id })
    .from(members)
    .where(and(isNull(members.leftAt), eq(members.isBot, false), or(eq(members.id, q), eq(members.displayName, q), eq(members.username, q))));
  return rows.length === 1 ? rows[0]!.id : undefined;
}

export async function memberRoleIdsOf(db: Db, id: string): Promise<string[]> {
  const [m] = await db.select({ roleIds: members.roleIds }).from(members).where(eq(members.id, id));
  return m?.roleIds ?? [];
}

import { and, desc, eq, isNull } from 'drizzle-orm';
import type { DiscordActions, GuildRole } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { TICKET_KINDS, type GuildConfig, type TicketKind } from '../config.js';
import type { Db } from '../db/client.js';
import { giftBatches, members, type GiftBatch } from '../db/schema.js';
import { addCustom, customName, listCustomTickets } from './customTickets.js';
import { ADMIN_COINS_MAX, addCoins } from './economy.js';
import { botTopPosition, dangerLabels, permsOf, roleKind } from './roles.js';
import { getItem, grantRoleItem } from './shop.js';
import { addTickets, TICKET_LABEL } from './tickets.js';

/**
 * 全員へのプレゼント（社務所Web・/配る・宮司）: 銭・券・自由な券・授与品（色守りなどのロール）を、今いる人みんなに同じだけ贈る。
 * 同じ画面から 2 回送られても（二度押し・再読み込み）1 回だけ贈る。
 */

export type GiftItem =
  | { kind: 'coins' }
  | { kind: 'ticket'; ticket: TicketKind }
  | { kind: 'custom'; id: number; label: string }
  /** 授与品（ロールの品物）。数は 1 つだけ（期間のある品は、持っていればその分のばす） */
  | { kind: 'shop'; id: number; label: string }
  /** ふつうのロール（記念・お詫びなど）。もう持っている人には付けない */
  | { kind: 'role'; id: string; label: string };

/** 授与品を贈ったあと、Discord で付ける・外すロール（呼び出し側が反映する） */
export type GiftRoleChange = { memberId: string; roleId: string; removeRoleIds: string[] };

/** 券を一度に贈れる上限 */
export const GIFT_TICKETS_MAX = 100;

/** 画面で選んだ値（coins / 券の種類 / custom:<id>）を読む。止めている自由な券も贈れる */
export async function parseGiftItem(db: Db, raw: unknown): Promise<GiftItem | undefined> {
  if (raw === 'coins') return { kind: 'coins' };
  if (typeof raw !== 'string') return undefined;
  if (TICKET_KINDS.includes(raw as TicketKind)) return { kind: 'ticket', ticket: raw as TicketKind };
  const shop = /^shop:(\d+)$/.exec(raw);
  if (shop) {
    const item = await getItem(db, Number(shop[1]));
    return item && item.kind === 'role' && item.roleId && item.roleGroup !== 'vip' ? { kind: 'shop', id: item.id, label: `${item.emoji}${item.name}` } : undefined;
  }
  const m = /^custom:(\d+)$/.exec(raw);
  if (!m) return undefined;
  const t = (await listCustomTickets(db)).find((x) => x.id === Number(m[1]));
  return t && { kind: 'custom', id: t.id, label: customName(t) };
}

/**
 * 贈れるロール: 役目のない（役職・運営・年齢・色守りなどでない）、危ない権限のない、BOT が付けられるロール
 */
export function giftableRole(cfg: GuildConfig, role: GuildRole, all: readonly GuildRole[], botId?: string): boolean {
  if (role.id === cfg.guildId || role.managed || roleKind(cfg, role) !== undefined) return false;
  if (dangerLabels(permsOf(role)).length) return false;
  const top = botTopPosition([...all], botId);
  return top === 0 || role.position < top;
}

/** role:<id> を読む（贈れるロールだけ） */
export function parseGiftRole(cfg: GuildConfig, raw: unknown, all: readonly GuildRole[], botId?: string): GiftItem | undefined {
  const m = typeof raw === 'string' ? /^role:(\d{17,20})$/.exec(raw) : null;
  const role = m ? all.find((r) => r.id === m[1]) : undefined;
  return role && giftableRole(cfg, role, all, botId) ? { kind: 'role', id: role.id, label: `@${role.name}` } : undefined;
}

export const giftItemValue = (item: GiftItem) => (item.kind === 'coins' ? 'coins' : item.kind === 'ticket' ? item.ticket : `${item.kind}:${item.id}`);

export function giftItemLabel(item: GiftItem, coin: { name: string; emoji: string }): string {
  if (item.kind === 'coins') return `${coin.emoji}${coin.name}`;
  if (item.kind === 'ticket') return `${TICKET_LABEL[item.ticket].emoji}${TICKET_LABEL[item.ticket].name}`;
  return item.label;
}

export const validGiftCount = (item: GiftItem, count: number) =>
  Number.isInteger(count) && count >= 1 && count <= (item.kind === 'coins' ? ADMIN_COINS_MAX : item.kind === 'shop' || item.kind === 'role' ? 1 : GIFT_TICKETS_MAX);

/** 数の単位 */
export const giftUnit = (item: GiftItem) => (item.kind === 'shop' || item.kind === 'role' ? 'つ' : '枚');

export type GiftInput = {
  item: GiftItem;
  label: string;
  count: number;
  note: string;
  memberIds: readonly string[];
  roleId?: string;
  by: string;
  nonce: string;
};

export async function giftToAll(
  db: Db,
  input: GiftInput,
  now = new Date(),
): Promise<{ status: 'ok'; batch: GiftBatch; roles: GiftRoleChange[] } | { status: 'duplicate' } | { status: 'invalid' }> {
  if (!validGiftCount(input.item, input.count) || !input.note.trim()) return { status: 'invalid' };
  const ids = [...new Set(input.memberIds)];
  return db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(giftBatches)
      .values({
        nonce: input.nonce,
        item: giftItemValue(input.item),
        label: input.label,
        count: input.count,
        note: input.note,
        roleId: input.roleId ?? null,
        recipients: ids.length,
        by: input.by,
      })
      .onConflictDoNothing({ target: giftBatches.nonce })
      .returning();
    if (!batch) return { status: 'duplicate' as const };
    const item = input.item.kind === 'shop' ? await getItem(tx, input.item.id) : undefined;
    if (input.item.kind === 'shop' && !item) throw new Error('shop item disappeared');
    const roles: GiftRoleChange[] = [];
    const roleId = input.item.kind === 'role' ? input.item.id : undefined;
    // ロール: もう持っている人には付けない
    const held = roleId ? new Set((await tx.select({ id: members.id, roleIds: members.roleIds }).from(members)).filter((m) => m.roleIds.includes(roleId)).map((m) => m.id)) : undefined;
    for (const id of ids) {
      if (input.item.kind === 'coins') await addCoins(tx, id, input.count, 'admin_grant', { note: input.note, by: input.by, gift: batch.id });
      else if (input.item.kind === 'ticket') await addTickets(tx, id, input.item.ticket, input.count);
      else if (input.item.kind === 'custom') await addCustom(tx, id, input.item.id, input.count);
      else if (input.item.kind === 'role') {
        if (!held!.has(id)) roles.push({ memberId: id, roleId: input.item.id, removeRoleIds: [] });
      } else {
        // もう持っている（期間のない品）人には贈らない
        const r = await grantRoleItem(tx, item!, id, now);
        if (r.status === 'ok') roles.push({ memberId: id, roleId: item!.roleId!, removeRoleIds: r.removeRoleIds });
      }
    }
    return { status: 'ok' as const, batch, roles };
  });
}

/**
 * 贈る相手: 役職のある今いる人（BOT・退出した人を除く）。roleId があればそのロールを持っている人だけ。
 * joinedBy があれば、その時までに入った人だけ（入った日がわからない人は、前からいる人として入れる）
 */
export async function giftTargets(db: Db, rankRoleIds: readonly string[], roleId?: string, joinedBy?: Date): Promise<string[]> {
  const rows = await db
    .select({ id: members.id, roleIds: members.roleIds, joinedAt: members.joinedAt })
    .from(members)
    .where(and(isNull(members.leftAt), eq(members.isBot, false)));
  return rows
    .filter((m) => m.roleIds.some((r) => rankRoleIds.includes(r)) && (!roleId || m.roleIds.includes(roleId)) && (!joinedBy || !m.joinedAt || m.joinedAt <= joinedBy))
    .map((m) => m.id);
}

/** 画面の日付（YYYY-MM-DD）を、その日の終わり（日本時間）にする */
export function endOfJstDay(raw: unknown): Date | undefined {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const d = new Date(`${raw}T23:59:59.999+09:00`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function recentGifts(db: Db, limit = 10): Promise<GiftBatch[]> {
  return db.select().from(giftBatches).orderBy(desc(giftBatches.createdAt), desc(giftBatches.id)).limit(limit);
}

export async function getGift(db: Db, id: number): Promise<GiftBatch | undefined> {
  const [row] = await db.select().from(giftBatches).where(eq(giftBatches.id, id));
  return row;
}

/** お知らせの文面（チャンネルに出す） */
export function giftAnnouncement(
  label: string,
  count: number,
  note: string,
  unit: string,
  roleName?: string,
  opts: { role?: boolean; joinedBy?: string } = {},
): string {
  const since = opts.joinedBy ? `${Number(opts.joinedBy.slice(5, 7))}月${Number(opts.joinedBy.slice(8, 10))}日までに入った` : '';
  const who = roleName ? `${since ? `${since} ` : ''}@${roleName} のみなさん` : `${since}みなさん`;
  return [
    `🎁 **運営から${who}へプレゼント！**`,
    opts.role ? `ロール **${label}** をお付けしました。` : `${label} を **${count.toLocaleString('ja-JP')} ${unit}** ずつお渡ししました。`,
    ...(note ? [`> ${note}`] : []),
  ].join('\n');
}

/** 授与品を贈った人に、Discord でロールを付ける（入れ替わる色守りなどは外す）。付けられた人数を返す */
export async function applyGiftRoles(discord: Pick<DiscordActions, 'addRole' | 'removeRole'>, guildId: string, roles: readonly GiftRoleChange[]): Promise<number> {
  let ok = 0;
  for (const r of roles) {
    try {
      for (const old of r.removeRoleIds) await discord.removeRole(guildId, r.memberId, old, '授与品のプレゼント（入れ替え）').catch(() => undefined);
      await discord.addRole(guildId, r.memberId, r.roleId, 'プレゼント');
      ok++;
    } catch (err) {
      logger.warn({ err, memberId: r.memberId }, 'gift role add failed');
    }
  }
  return ok;
}

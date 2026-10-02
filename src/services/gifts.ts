import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm';
import type { DiscordActions, GuildRole } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { TICKET_KINDS, type GuildConfig, type TicketKind } from '../config.js';
import type { Db } from '../db/client.js';
import { coinTx, giftBatches, members, shopPurchases, type GiftBatch } from '../db/schema.js';
import { addCustom, customName, listCustomTickets, takeCustom } from './customTickets.js';
import { ADMIN_COINS_MAX, addCoins, deductUpTo } from './economy.js';
import { botTopPosition, dangerLabels, permsOf, roleKind } from './roles.js';
import { getItem, grantRoleItem } from './shop.js';
import { addTickets, takeTickets, TICKET_LABEL } from './tickets.js';

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
  /** この時までに入った人だけ（絞ったとき） */
  joinedBy?: Date;
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
        joinedBy: input.joinedBy ?? null,
        memberIds: ids,
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

// ───────── 入った日を直す（あとから取り消す） ─────────

export type NarrowTarget = { memberId: string; name: string; joinedAt: Date | null };

/** いまの「入った日」の上限（贈った時より後の日にしていても、贈った時までに入った人にしか渡っていない） */
const upperOf = (b: GiftBatch) => (b.joinedBy && b.joinedBy < b.createdAt ? b.joinedBy : b.createdAt);

/**
 * 入った日を joinedBy（その日の終わり）に直したとき、取り消す相手: 贈った相手のうち、joinedBy より後に入った人。
 * 贈った相手が記録されていない前のプレゼントは、銭なら出入りの記録から、券・ロールは「入った日が joinedBy の後で、贈った時まで」で探す
 * （入った日がわからない人は、前からいる人として取り消さない）
 */
export async function narrowTargets(db: Db, batch: GiftBatch, joinedBy: Date, rankRoleIds: readonly string[]): Promise<NarrowTarget[]> {
  const upper = upperOf(batch);
  if (joinedBy >= upper) return [];
  let ids: string[] | undefined = batch.memberIds ?? undefined;
  if (!ids && batch.item === 'coins') {
    const rows = await db
      .select({ id: coinTx.memberId })
      .from(coinTx)
      .where(and(eq(coinTx.reason, 'admin_grant'), sql`${coinTx.detail}->>'gift' = ${String(batch.id)}`));
    ids = rows.map((r) => r.id);
  }
  const rows = await db
    .select({ id: members.id, name: members.displayName, roleIds: members.roleIds, joinedAt: members.joinedAt, leftAt: members.leftAt, isBot: members.isBot })
    .from(members)
    .where(and(isNotNull(members.joinedAt), gt(members.joinedAt, joinedBy), lte(members.joinedAt, upper), ...(ids ? [inArray(members.id, ids.length ? ids : [''])] : [])));
  // 記録がないときは、贈ったときにいた・役職のある人（ロールで絞っていたら、そのロールを持っている人）
  const present = (m: (typeof rows)[number]) =>
    !m.isBot && (!m.leftAt || m.leftAt > batch.createdAt) && m.roleIds.some((r) => rankRoleIds.includes(r)) && (!batch.roleId || m.roleIds.includes(batch.roleId));
  return rows
    .filter((m) => ids || present(m))
    .sort((a, b) => (a.joinedAt?.getTime() ?? 0) - (b.joinedAt?.getTime() ?? 0))
    .map((m) => ({ memberId: m.id, name: m.name, joinedAt: m.joinedAt }));
}

/** 取り消したあと、Discord で外す・付け直すロール */
export type NarrowRoleChange = { memberId: string; remove: string[]; add: string[] };

export type NarrowResult = {
  status: 'ok';
  members: number;
  /** 取り戻せた量（銭・券の合計） */
  taken: number;
  /** もう使っていて、全部は取り戻せなかった人 */
  short: number;
  roles: NarrowRoleChange[];
};

/**
 * 入った日を直して、余分に渡った人から取り消す（宮司）。銭・券は残っている分まで。ロールは外す（授与品は、前に持っていた分に戻す）。
 * 同じ日で 2 回押しても、2 回目は相手がいないので何もしない
 */
export async function narrowGift(
  db: Db,
  batchId: number,
  joinedBy: Date,
  rankRoleIds: readonly string[],
  by: string,
  now = new Date(),
): Promise<NarrowResult | { status: 'not_found' | 'none' }> {
  return db.transaction(async (tx) => {
    const [batch] = await tx.select().from(giftBatches).where(eq(giftBatches.id, batchId)).for('update');
    if (!batch) return { status: 'not_found' as const };
    const targets = await narrowTargets(tx, batch, joinedBy, rankRoleIds);
    if (!targets.length) return { status: 'none' as const };
    const item = batch.item;
    const custom = /^custom:(\d+)$/.exec(item);
    const shop = /^shop:(\d+)$/.exec(item);
    const role = /^role:(\d+)$/.exec(item);
    let taken = 0;
    let short = 0;
    const roles: NarrowRoleChange[] = [];
    const note = `プレゼントの取り消し（入った日の直し）: ${batch.label}`;
    for (const t of targets) {
      let got = batch.count;
      if (item === 'coins') got = await deductUpTo(tx, t.memberId, batch.count, 'admin_take', { note, by, gift: batch.id });
      else if (TICKET_KINDS.includes(item as TicketKind)) got = await takeTickets(tx, t.memberId, item as TicketKind, batch.count);
      else if (custom) got = await takeCustom(tx, t.memberId, Number(custom[1]), batch.count);
      else if (role) roles.push({ memberId: t.memberId, remove: [role[1]!], add: [] });
      else if (shop) {
        const r = await undoShopGift(tx, batch, Number(shop[1]), t.memberId, now);
        if (r) roles.push(r);
      }
      if (item === 'coins' || TICKET_KINDS.includes(item as TicketKind) || custom) {
        taken += got;
        if (got < batch.count) short++;
      }
    }
    const left = new Set(targets.map((t) => t.memberId));
    await tx
      .update(giftBatches)
      .set({ joinedBy, recipients: Math.max(0, batch.recipients - targets.length), ...(batch.memberIds ? { memberIds: batch.memberIds.filter((id) => !left.has(id)) } : {}) })
      .where(eq(giftBatches.id, batch.id));
    return { status: 'ok' as const, members: targets.length, taken, short, roles };
  });
}

/**
 * 授与品のプレゼントを取り消す: そのとき増えた品を終わりにして、そのとき終わった品（同じ品の前の期限・入れ替えた色）を戻す
 */
async function undoShopGift(tx: Db, batch: GiftBatch, itemId: number, memberId: string, now: Date): Promise<NarrowRoleChange | undefined> {
  const at = batch.createdAt.getTime();
  const [p] = await tx
    .select()
    .from(shopPurchases)
    .where(
      and(
        eq(shopPurchases.memberId, memberId),
        eq(shopPurchases.itemId, itemId),
        eq(shopPurchases.price, 0),
        gte(shopPurchases.createdAt, new Date(at)),
        lt(shopPurchases.createdAt, new Date(at + 1)),
      ),
    );
  if (!p) return undefined;
  await tx.update(shopPurchases).set({ endedAt: now }).where(and(eq(shopPurchases.id, p.id), isNull(shopPurchases.endedAt)));
  const ended = await tx
    .select()
    .from(shopPurchases)
    .where(
      and(
        eq(shopPurchases.memberId, memberId),
        eq(shopPurchases.kind, 'role'),
        lt(shopPurchases.id, p.id),
        gte(shopPurchases.endedAt, new Date(at - 60_000)),
        lte(shopPurchases.endedAt, new Date(at + 60_000)),
      ),
    );
  const back = ended.filter((q) => q.roleId && (!q.expiresAt || q.expiresAt > now));
  for (const q of back) await tx.update(shopPurchases).set({ endedAt: null }).where(eq(shopPurchases.id, q.id));
  const add = [...new Set(back.map((q) => q.roleId!))];
  return { memberId, remove: p.roleId && !add.includes(p.roleId) ? [p.roleId] : [], add: add.filter((r) => r !== p.roleId) };
}

/** 取り消したロールを Discord に反映する。できた人数 */
export async function applyNarrowRoles(discord: Pick<DiscordActions, 'addRole' | 'removeRole'>, guildId: string, roles: readonly NarrowRoleChange[]): Promise<number> {
  let ok = 0;
  for (const r of roles) {
    try {
      for (const id of r.remove) await discord.removeRole(guildId, r.memberId, id, 'プレゼントの取り消し（入った日の直し）');
      for (const id of r.add) await discord.addRole(guildId, r.memberId, id, 'プレゼントの取り消し（前の品に戻す）');
      ok++;
    } catch (err) {
      logger.warn({ err, memberId: r.memberId }, 'gift narrow role change failed');
    }
  }
  return ok;
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

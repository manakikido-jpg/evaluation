import { and, desc, eq, isNull } from 'drizzle-orm';
import { TICKET_KINDS, type TicketKind } from '../config.js';
import type { Db } from '../db/client.js';
import { giftBatches, members, type GiftBatch } from '../db/schema.js';
import { addCustom, customName, listCustomTickets } from './customTickets.js';
import { ADMIN_COINS_MAX, addCoins } from './economy.js';
import { addTickets, TICKET_LABEL } from './tickets.js';

/**
 * 全員へのプレゼント（社務所Web・宮司）: 銭・券・自由な券を、今いる人みんなに同じだけ贈る。
 * 同じ画面から 2 回送られても（二度押し・再読み込み）1 回だけ贈る。
 */

export type GiftItem = { kind: 'coins' } | { kind: 'ticket'; ticket: TicketKind } | { kind: 'custom'; id: number; label: string };

/** 券を一度に贈れる上限 */
export const GIFT_TICKETS_MAX = 100;

/** 画面で選んだ値（coins / 券の種類 / custom:<id>）を読む。止めている自由な券も贈れる */
export async function parseGiftItem(db: Db, raw: unknown): Promise<GiftItem | undefined> {
  if (raw === 'coins') return { kind: 'coins' };
  if (typeof raw !== 'string') return undefined;
  if (TICKET_KINDS.includes(raw as TicketKind)) return { kind: 'ticket', ticket: raw as TicketKind };
  const m = /^custom:(\d+)$/.exec(raw);
  if (!m) return undefined;
  const t = (await listCustomTickets(db)).find((x) => x.id === Number(m[1]));
  return t && { kind: 'custom', id: t.id, label: customName(t) };
}

export const giftItemValue = (item: GiftItem) => (item.kind === 'coins' ? 'coins' : item.kind === 'ticket' ? item.ticket : `custom:${item.id}`);

export function giftItemLabel(item: GiftItem, coin: { name: string; emoji: string }): string {
  if (item.kind === 'coins') return `${coin.emoji}${coin.name}`;
  if (item.kind === 'ticket') return `${TICKET_LABEL[item.ticket].emoji}${TICKET_LABEL[item.ticket].name}`;
  return item.label;
}

export const validGiftCount = (item: GiftItem, count: number) =>
  Number.isInteger(count) && count >= 1 && count <= (item.kind === 'coins' ? ADMIN_COINS_MAX : GIFT_TICKETS_MAX);

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

export async function giftToAll(db: Db, input: GiftInput): Promise<{ status: 'ok'; batch: GiftBatch } | { status: 'duplicate' } | { status: 'invalid' }> {
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
    for (const id of ids) {
      if (input.item.kind === 'coins') await addCoins(tx, id, input.count, 'admin_grant', { note: input.note, by: input.by, gift: batch.id });
      else if (input.item.kind === 'ticket') await addTickets(tx, id, input.item.ticket, input.count);
      else await addCustom(tx, id, input.item.id, input.count);
    }
    return { status: 'ok' as const, batch };
  });
}

/** 贈る相手: 役職のある今いる人（BOT・退出した人を除く）。roleId があればそのロールを持っている人だけ */
export async function giftTargets(db: Db, rankRoleIds: readonly string[], roleId?: string): Promise<string[]> {
  const rows = await db.select({ id: members.id, roleIds: members.roleIds }).from(members).where(and(isNull(members.leftAt), eq(members.isBot, false)));
  return rows.filter((m) => m.roleIds.some((r) => rankRoleIds.includes(r)) && (!roleId || m.roleIds.includes(roleId))).map((m) => m.id);
}

export async function recentGifts(db: Db, limit = 10): Promise<GiftBatch[]> {
  return db.select().from(giftBatches).orderBy(desc(giftBatches.createdAt), desc(giftBatches.id)).limit(limit);
}

export async function getGift(db: Db, id: number): Promise<GiftBatch | undefined> {
  const [row] = await db.select().from(giftBatches).where(eq(giftBatches.id, id));
  return row;
}

/** お知らせの文面（チャンネルに出す） */
export function giftAnnouncement(label: string, count: number, note: string, unit: string, roleName?: string): string {
  const who = roleName ? `@${roleName} のみなさん` : 'みなさん';
  return [
    `🎁 **運営から${who}へプレゼント！**`,
    `${label} を **${count.toLocaleString('ja-JP')} ${unit}** ずつお渡ししました。`,
    ...(note ? [`> ${note}`] : []),
  ].join('\n');
}

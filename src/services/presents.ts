import { and, eq, gte, sql } from 'drizzle-orm';
import { TICKET_KINDS, type GuildConfig, type TicketKind } from '../config.js';
import type { Db } from '../db/client.js';
import { customTicketHoldings, customTickets, tickets } from '../db/schema.js';
import { autoRanks, currentAutoRank } from '../domain/ranks.js';
import { customHoldingsOf, customName } from './customTickets.js';
import { TICKET_LABEL, ticketName, ticketsOf } from './tickets.js';

/**
 * 💝 /贈る: 持っている券・自由な券を、サーバーのほかの人に贈る（個人から個人へ）。
 * 贈れるのは 2 段目の自動役職（氏子）以上か運営（作ったばかりのサブ垢から集められないように）。
 */

export type PresentItem = { kind: 'ticket'; ticket: TicketKind } | { kind: 'custom'; id: number };

export const PRESENT_MAX = 100;

export function parsePresentItem(raw: string): PresentItem | undefined {
  if ((TICKET_KINDS as readonly string[]).includes(raw)) return { kind: 'ticket', ticket: raw as TicketKind };
  const m = /^custom:(\d{1,9})$/.exec(raw);
  return m ? { kind: 'custom', id: Number(m[1]) } : undefined;
}

/** 持ち物 1 つ（value: 券の種類か custom:ID / manual: 「使う」で使える。ほかは使う場面で自動で使う） */
export type Holding = { value: string; label: string; count: number; note: string; manual: boolean };

/** 自分が持っていて贈れるもの（/持ち物・/贈る の候補） */
export async function presentChoices(db: Db, memberId: string): Promise<Holding[]> {
  const [t, customs] = await Promise.all([ticketsOf(db, memberId), customHoldingsOf(db, memberId)]);
  return [
    ...TICKET_KINDS.filter((k) => t[k] > 0).map((k) => ({ value: k, label: ticketName(k), count: t[k], note: TICKET_LABEL[k].note, manual: TICKET_LABEL[k].use === 'manual' })),
    ...customs
      .filter((c) => c.count > 0)
      .map((c) => ({ value: `custom:${c.ticket.id}`, label: customName(c.ticket), count: c.count, note: c.ticket.note || '運営に知らせて、対応してもらう券', manual: true })),
  ];
}

export type PresentMember = { id: string; roleIds: readonly string[]; bot?: boolean };

export type PresentResult =
  | { status: 'ok'; label: string; count: number; left: number }
  | { status: 'self' | 'not_member' | 'invalid' | 'no_rank' }
  | { status: 'rank_too_low'; rankName: string }
  | { status: 'not_enough'; label: string; have: number };

/** 贈る: 送る人から減らして、相手に足す（同時に押しても持っている分より多くは減らない） */
export async function sendPresent(db: Db, cfg: GuildConfig, from: PresentMember, to: PresentMember, item: PresentItem, count: number): Promise<PresentResult> {
  if (!Number.isInteger(count) || count < 1 || count > PRESENT_MAX) return { status: 'invalid' };
  if (from.id === to.id) return { status: 'self' };
  const hasRank = (roleIds: readonly string[]) => cfg.ranks.some((r) => roleIds.includes(r.roleId));
  if (to.bot || !hasRank(to.roleIds)) return { status: 'not_member' };
  if (!hasRank(from.roleIds)) return { status: 'no_rank' };
  const [first, second] = autoRanks(cfg.ranks);
  const current = currentAutoRank(cfg.ranks, from.roleIds);
  const isStaff = cfg.ranks.some((r) => !r.auto && from.roleIds.includes(r.roleId));
  if (second && !isStaff && (!current || current.key === first?.key)) return { status: 'rank_too_low', rankName: second.name };

  return db.transaction(async (tx) => {
    if (item.kind === 'ticket') {
      const label = ticketName(item.ticket);
      const [row] = await tx
        .update(tickets)
        .set({ count: sql`${tickets.count} - ${count}`, updatedAt: new Date() })
        .where(and(eq(tickets.memberId, from.id), eq(tickets.kind, item.ticket), gte(tickets.count, count)))
        .returning({ count: tickets.count });
      if (!row) return { status: 'not_enough' as const, label, have: (await ticketsOf(tx, from.id))[item.ticket] };
      await tx
        .insert(tickets)
        .values({ memberId: to.id, kind: item.ticket, count })
        .onConflictDoUpdate({ target: [tickets.memberId, tickets.kind], set: { count: sql`${tickets.count} + ${count}`, updatedAt: new Date() } });
      return { status: 'ok' as const, label, count, left: row.count };
    }
    const [ticket] = await tx.select().from(customTickets).where(eq(customTickets.id, item.id));
    if (!ticket) return { status: 'invalid' as const };
    const label = customName(ticket);
    const [row] = await tx
      .update(customTicketHoldings)
      .set({ count: sql`${customTicketHoldings.count} - ${count}` })
      .where(and(eq(customTicketHoldings.memberId, from.id), eq(customTicketHoldings.ticketId, item.id), gte(customTicketHoldings.count, count)))
      .returning({ count: customTicketHoldings.count });
    if (!row) {
      const [have] = await tx
        .select({ count: customTicketHoldings.count })
        .from(customTicketHoldings)
        .where(and(eq(customTicketHoldings.memberId, from.id), eq(customTicketHoldings.ticketId, item.id)));
      return { status: 'not_enough' as const, label, have: have?.count ?? 0 };
    }
    await tx
      .insert(customTicketHoldings)
      .values({ memberId: to.id, ticketId: item.id, count })
      .onConflictDoUpdate({ target: [customTicketHoldings.memberId, customTicketHoldings.ticketId], set: { count: sql`${customTicketHoldings.count} + ${count}` } });
    return { status: 'ok' as const, label, count, left: row.count };
  });
}

export const PRESENT_MESSAGES: Record<Exclude<PresentResult['status'], 'ok' | 'rank_too_low' | 'not_enough'>, string> = {
  self: '自分には贈れません。',
  not_member: 'その方には贈れません（BOT や、まだ役職のない方・サーバーにいない方）。',
  invalid: '贈るものか数が正しくありません（候補から選んで、数は 1〜100）。',
  no_rank: '役職のある方だけ贈れます。',
};

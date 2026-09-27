import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { customTicketHoldings, customTickets, gachaClaims, type CustomTicket, type GachaClaim } from '../db/schema.js';

/**
 * 自由な券: 運営が名前を決める券（例: 通話デート券・リクエスト曲券）。物御籤の中身にしたり、運営が渡したりできる。
 * 持っている人が /物御籤 の「🎟 券を使う」から使うと、運営に知らせて（gacha_claims）、運営が対応したら「渡した」を押す。
 */

export async function listCustomTickets(db: Db): Promise<CustomTicket[]> {
  return db.select().from(customTickets).orderBy(asc(customTickets.id));
}

export async function createCustomTicket(db: Db, t: { emoji: string; name: string; note: string }): Promise<CustomTicket> {
  const [row] = await db.insert(customTickets).values(t).returning();
  return row!;
}

export async function setCustomTicketEnabled(db: Db, id: number, enabled: boolean): Promise<CustomTicket | undefined> {
  const [row] = await db.update(customTickets).set({ enabled }).where(eq(customTickets.id, id)).returning();
  return row;
}

export const customName = (t: Pick<CustomTicket, 'emoji' | 'name'>) => `${t.emoji}${t.name}`;

/** その人が持っている自由な券（持っているものだけ） */
export async function customHoldingsOf(db: Db, memberId: string): Promise<{ ticket: CustomTicket; count: number }[]> {
  const rows = await db
    .select({ ticket: customTickets, count: customTicketHoldings.count })
    .from(customTicketHoldings)
    .innerJoin(customTickets, eq(customTickets.id, customTicketHoldings.ticketId))
    .where(and(eq(customTicketHoldings.memberId, memberId), gt(customTicketHoldings.count, 0)))
    .orderBy(asc(customTickets.id));
  return rows;
}

/** 自由な券を持っている人（管理画面） */
export async function customHolders(db: Db): Promise<{ memberId: string; ticket: CustomTicket; count: number }[]> {
  return db
    .select({ memberId: customTicketHoldings.memberId, ticket: customTickets, count: customTicketHoldings.count })
    .from(customTicketHoldings)
    .innerJoin(customTickets, eq(customTickets.id, customTicketHoldings.ticketId))
    .where(gt(customTicketHoldings.count, 0))
    .orderBy(desc(customTicketHoldings.count));
}

export async function addCustom(tx: Db, memberId: string, ticketId: number, count: number): Promise<void> {
  if (count <= 0) return;
  await tx
    .insert(customTicketHoldings)
    .values({ memberId, ticketId, count })
    .onConflictDoUpdate({ target: [customTicketHoldings.memberId, customTicketHoldings.ticketId], set: { count: sql`${customTicketHoldings.count} + ${count}` } });
}

/** 減らす（持っている分まで）。減らした枚数 */
export async function takeCustom(tx: Db, memberId: string, ticketId: number, count: number): Promise<number> {
  if (count <= 0) return 0;
  const [row] = await tx
    .select()
    .from(customTicketHoldings)
    .where(and(eq(customTicketHoldings.memberId, memberId), eq(customTicketHoldings.ticketId, ticketId)));
  const take = Math.min(row?.count ?? 0, count);
  if (take <= 0) return 0;
  await tx
    .update(customTicketHoldings)
    .set({ count: sql`${customTicketHoldings.count} - ${take}` })
    .where(and(eq(customTicketHoldings.memberId, memberId), eq(customTicketHoldings.ticketId, ticketId)));
  return take;
}

/** 使う: 1 枚減らして、運営が対応するものとして記録（止めている券も、持っていれば使える） */
export async function useCustom(db: Db, memberId: string, ticketId: number): Promise<{ status: 'ok'; claim: GachaClaim; ticket: CustomTicket } | { status: 'no_ticket' }> {
  return db.transaction(async (tx) => {
    const [ticket] = await tx.select().from(customTickets).where(eq(customTickets.id, ticketId));
    if (!ticket) return { status: 'no_ticket' as const };
    const used = await tx
      .update(customTicketHoldings)
      .set({ count: sql`${customTicketHoldings.count} - 1` })
      .where(and(eq(customTicketHoldings.memberId, memberId), eq(customTicketHoldings.ticketId, ticketId), gt(customTicketHoldings.count, 0)))
      .returning();
    if (!used.length) return { status: 'no_ticket' as const };
    const [claim] = await tx
      .insert(gachaClaims)
      .values({ memberId, label: `${customName(ticket)}（使った）` })
      .returning();
    return { status: 'ok' as const, claim: claim!, ticket };
  });
}

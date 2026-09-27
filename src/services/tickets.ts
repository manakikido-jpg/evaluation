import { and, eq, gt, sql } from 'drizzle-orm';
import type { TicketKind } from '../config.js';
import type { Db } from '../db/client.js';
import { tickets } from '../db/schema.js';

/**
 * 券（物御籤で出る）。持っていれば自動で使う。
 * 部屋代無料: 宿坊はその部屋の部屋代・宵宮は 1 時間分 / 絵馬のピン留め: 「絵馬の奉納」が無料 / 市場の手数料なし: 売れたとき手数料を引かない
 */

export const TICKET_LABEL: Record<TicketKind, { emoji: string; name: string; note: string }> = {
  room_free: { emoji: '🎫', name: '部屋代無料券', note: '宿坊はその部屋の部屋代、宵宮は 1 時間分が無料（部屋代を払うときに自動で使う）' },
  ema_pin: { emoji: '📌', name: '絵馬のピン留め券', note: '授与所の「絵馬の奉納」が無料（受けるときに自動で使う）' },
  market_nofee: { emoji: '🏪', name: '市場の手数料なし券', note: '市場で売れたとき、手数料を引かずに受け取れる（自動で使う）' },
};

export async function ticketsOf(db: Db, memberId: string): Promise<Record<TicketKind, number>> {
  const rows = await db.select().from(tickets).where(eq(tickets.memberId, memberId));
  const out: Record<TicketKind, number> = { room_free: 0, ema_pin: 0, market_nofee: 0 };
  for (const r of rows) out[r.kind] = r.count;
  return out;
}

export async function addTickets(tx: Db, memberId: string, kind: TicketKind, count: number): Promise<void> {
  if (count <= 0) return;
  await tx
    .insert(tickets)
    .values({ memberId, kind, count })
    .onConflictDoUpdate({ target: [tickets.memberId, tickets.kind], set: { count: sql`${tickets.count} + ${count}`, updatedAt: new Date() } });
}

/** 1 枚使う。持っていなければ false（同時に使っても 0 より減らない） */
export async function useTicket(tx: Db, memberId: string, kind: TicketKind): Promise<boolean> {
  const rows = await tx
    .update(tickets)
    .set({ count: sql`${tickets.count} - 1`, updatedAt: new Date() })
    .where(and(eq(tickets.memberId, memberId), eq(tickets.kind, kind), gt(tickets.count, 0)))
    .returning({ count: tickets.count });
  return rows.length > 0;
}

/** 持っている券の一行（なければ undefined） */
export function ticketLine(t: Record<TicketKind, number>): string | undefined {
  const parts = (Object.keys(TICKET_LABEL) as TicketKind[]).filter((k) => t[k] > 0).map((k) => `${TICKET_LABEL[k].emoji}${TICKET_LABEL[k].name} ×${t[k]}`);
  return parts.length ? parts.join('　') : undefined;
}

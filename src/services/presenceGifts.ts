import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { TICKET_KINDS, type TicketKind } from '../config.js';
import type { Db } from '../db/client.js';
import { coinTx, presenceGifts, type PresenceGift } from '../db/schema.js';
import { addCoins, deductUpTo, validAdminAmount } from './economy.js';
import { addTickets, takeTickets } from './tickets.js';

/**
 * 🎁 浮上している人へのプレゼント。
 * 社務所Web で運営（宮司）が受け付けて、BOT が 1 分以内に、そのときオンラインの人へ配る。
 * 配るのは 1 件につき 1 回だけ（status を pending → done にするのと、配るのを同じトランザクションで）。
 */

/** 券は 1 人 10 枚まで */
export const PRESENCE_TICKET_MAX = 10;

export type PresenceGiftInput = { kind: 'coins' } | { kind: 'ticket'; ticketKind: string };

export function validPresenceGift(input: PresenceGiftInput, amount: number): boolean {
  if (input.kind === 'coins') return validAdminAmount(amount);
  return (TICKET_KINDS as readonly string[]).includes(input.ticketKind) && Number.isInteger(amount) && amount >= 1 && amount <= PRESENCE_TICKET_MAX;
}

export async function requestPresenceGift(db: Db, input: PresenceGiftInput, amount: number, note: string, by: string): Promise<PresenceGift | undefined> {
  if (!validPresenceGift(input, amount) || !note) return undefined;
  const [row] = await db
    .insert(presenceGifts)
    .values({ kind: input.kind, ticketKind: input.kind === 'ticket' ? input.ticketKind : null, amount, note, createdBy: by })
    .returning();
  return row;
}

export const recentPresenceGifts = (db: Db, limit = 10) => db.select().from(presenceGifts).orderBy(desc(presenceGifts.id)).limit(limit);
export const pendingPresenceGifts = (db: Db) => db.select().from(presenceGifts).where(eq(presenceGifts.status, 'pending')).orderBy(presenceGifts.id);

/** 1 件を配る（いまオンラインの人 memberIds へ）。もう配っていれば何もしない */
export async function deliverPresenceGift(db: Db, id: number, memberIds: readonly string[], now = new Date()): Promise<{ status: 'ok'; count: number } | { status: 'done' }> {
  return db.transaction(async (tx) => {
    const [g] = await tx.select().from(presenceGifts).where(and(eq(presenceGifts.id, id), eq(presenceGifts.status, 'pending'))).for('update');
    if (!g) return { status: 'done' as const };
    const ids = [...new Set(memberIds)];
    for (const m of ids) {
      if (g.kind === 'coins') await addCoins(tx, m, g.amount, 'admin_grant', { note: g.note, by: g.createdBy, presenceGift: g.id });
      else await addTickets(tx, m, g.ticketKind as TicketKind, g.amount);
    }
    await tx.update(presenceGifts).set({ status: 'done', count: ids.length, doneAt: now, memberIds: ids }).where(eq(presenceGifts.id, id));
    return { status: 'ok' as const, count: ids.length };
  });
}

/** 配れなかった（オンラインを見る設定がオフなど） */
export async function failPresenceGift(db: Db, id: number, reason: string, now = new Date()): Promise<void> {
  await db.update(presenceGifts).set({ status: 'failed', reason, doneAt: now }).where(and(eq(presenceGifts.id, id), eq(presenceGifts.status, 'pending')));
}

/**
 * ↩ まちがって配ったものを回収する（1 件 1 回）。
 * 配った人それぞれから、配った量を取りもどす（もう使っていて足りなければ、残っている分だけ）。
 * 取りもどした合計と、少なかった人の数を返す。
 */
export async function revokePresenceGift(db: Db, id: number, by: string, now = new Date()): Promise<{ status: 'ok'; taken: number; short: number; people: number } | { status: 'not_found' }> {
  return db.transaction(async (tx) => {
    const [g] = await tx.select().from(presenceGifts).where(and(eq(presenceGifts.id, id), eq(presenceGifts.status, 'done'), isNull(presenceGifts.revokedAt))).for('update');
    if (!g) return { status: 'not_found' as const };
    let ids = g.memberIds;
    // 前の形（配った人を残していない）の銭は、銭の出入りから探す
    if (!ids.length && g.kind === 'coins') {
      const rows = await tx.select({ m: coinTx.memberId }).from(coinTx).where(and(eq(coinTx.reason, 'admin_grant'), sql`(${coinTx.detail}->>'presenceGift')::bigint = ${g.id}`));
      ids = [...new Set(rows.map((r) => r.m))];
    }
    let taken = 0;
    let short = 0;
    for (const m of ids) {
      const t = g.kind === 'coins' ? await deductUpTo(tx, m, g.amount, 'admin_take', { note: `回収: ${g.note}`, by, presenceGift: g.id }) : await takeTickets(tx, m, g.ticketKind as TicketKind, g.amount);
      taken += t;
      if (t < g.amount) short++;
    }
    await tx.update(presenceGifts).set({ revokedAt: now, revokedBy: by }).where(eq(presenceGifts.id, id));
    return { status: 'ok' as const, taken, short, people: ids.length };
  });
}

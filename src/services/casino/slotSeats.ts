import { and, eq, ne, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { casinoGames, members, slotAtMachines, slotSeats } from '../../db/schema.js';
import { audit } from '../audit.js';

export const SLOT_IDLE_MINUTES = 3;
export const SLOT_AWAY_MINUTES = 5;
export type SlotSeat = { memberId: string; name: string; avatar: string | null; until: Date; away: boolean };
export const seatUntil = (playedAt: Date | null, awayUntil: Date | null) => awayUntil ?? (playedAt ? new Date(playedAt.getTime() + SLOT_IDLE_MINUTES * 60_000) : null);
export class SlotOccupied extends Error {}

/** 賭けのトランザクション内で席を確保する。通常機の席の操作は同じ鍵で順番に行う。 */
export async function claimSlotSeat(tx: Db, memberId: string, machine: number, now: Date) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('casino:slots:seats'))`);
  const [s] = await tx.select().from(slotSeats).where(eq(slotSeats.machine, machine));
  const until = s && seatUntil(s.playedAt, s.awayUntil);
  if (s && s.memberId !== memberId && until && until > now) throw new SlotOccupied();
  await tx.delete(slotSeats).where(and(eq(slotSeats.memberId, memberId), ne(slotSeats.machine, machine)));
  await tx.insert(slotSeats).values({ machine, memberId, playedAt: now }).onConflictDoUpdate({ target: slotSeats.machine, set: { memberId, playedAt: now, awayUntil: null } });
}

export async function slotSeatViews(db: Db, now: Date): Promise<Record<number, SlotSeat>> {
  const rows = await db.select({ s: slotSeats, name: members.displayName, avatar: members.avatarUrl }).from(slotSeats).leftJoin(members, eq(members.id, slotSeats.memberId));
  return Object.fromEntries(rows.flatMap(({ s, name, avatar }) => {
    const until = seatUntil(s.playedAt, s.awayUntil)!;
    return until > now ? [[s.machine, { memberId: s.memberId, name: name ?? 'メンバー', avatar, until, away: Boolean(s.awayUntil) }]] : [];
  }));
}

/** 離席ボタンの連打では期限を延ばさない。戻る・退席も本人の有効な席だけ。 */
export async function changeSlotSeat(db: Db, game: 'slots' | 'atslot', memberId: string, machine: number, action: 'away' | 'return' | 'leave', now: Date): Promise<'ok' | 'expired' | 'unfinished'> {
  return db.transaction(async (tx) => {
    if (game === 'slots') await tx.execute(sql`select pg_advisory_xact_lock(hashtext('casino:slots:seats'))`);
    const table = game === 'slots' ? slotSeats : slotAtMachines;
    const [row] = await tx.select().from(table).where(eq(table.machine, machine)).for('update');
    const owner = row && ('memberId' in row ? row.memberId : row.seatBy);
    const playedAt = row && ('playedAt' in row ? row.playedAt : row.seatAt);
    const until = row && seatUntil(playedAt ?? null, row.awayUntil);
    if (owner !== memberId || !until || until <= now) return 'expired';
    const [busy] = await tx.select({ id: casinoGames.id }).from(casinoGames).where(and(eq(casinoGames.memberId, memberId), eq(casinoGames.game, game), eq(casinoGames.status, 'playing'))).limit(1);
    if (busy) return 'unfinished';
    const awayUntil = action === 'away' ? row!.awayUntil ?? new Date(now.getTime() + SLOT_AWAY_MINUTES * 60_000) : null;
    if (game === 'slots') {
      if (action === 'leave') await tx.delete(slotSeats).where(eq(slotSeats.machine, machine));
      else await tx.update(slotSeats).set({ awayUntil, ...(action === 'return' ? { playedAt: now } : {}) }).where(eq(slotSeats.machine, machine));
    } else {
      await tx.update(slotAtMachines).set(action === 'leave' ? { seatBy: null, seatAt: null, awayUntil: null } : { awayUntil, ...(action === 'return' ? { seatAt: now } : {}) }).where(eq(slotAtMachines.machine, machine));
    }
    await audit(tx, { actorId: memberId, action: 'casino.slot_seat', detail: { game, machine, action, awayUntil }, via: 'web' });
    return 'ok';
  });
}

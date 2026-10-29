import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { castSessions, type CastAttendance, type CastSession } from '../db/schema.js';

export const CAST_ATTENDANCE_GAP_MS = 120_000;
export const activeCastCalls = (db: Db) => db.select().from(castSessions).where(eq(castSessions.status, 'active'));

export async function markCastAttendanceUncertain(db: Db, id: number, now = new Date()): Promise<void> {
  await db.transaction(async tx => {
    const [s] = await tx.select().from(castSessions).where(eq(castSessions.id, id)).for('update');
    if (s?.status === 'active') await tx.update(castSessions).set({ attendance: {
      ...(s.attendance ?? { epoch: 'unavailable', checkedAt: now.toISOString(), customerJoinedAt: null, castJoinedAt: null, customerPresent: false, castPresent: false }), uncertain: true,
    } }).where(eq(castSessions.id, id));
  });
}

/** 入室した事実は残す。現在の空室だけを根拠に欠席とはしない。 */
export async function observeCastAttendance(db: Db, id: number, input: { epoch: string; members: readonly string[]; seenId?: string; starting?: boolean }, now = new Date()): Promise<void> {
  await db.transaction(async tx => {
    const [s] = await tx.select().from(castSessions).where(eq(castSessions.id, id)).for('update');
    if (!s || s.status !== 'active' || !s.startedAt) return;
    const old = s.attendance;
    if (old && new Date(old.checkedAt) > now) return;
    const present = (who: string) => input.members.includes(who);
    const within = now >= s.startedAt && (!s.endsAt || now <= s.endsAt);
    const seen = (who: string) => within && (present(who) || input.seenId === who);
    const uncertain = old
      ? old.uncertain || old.epoch !== input.epoch || now.getTime() - Date.parse(old.checkedAt) > CAST_ATTENDANCE_GAP_MS
      : !input.starting || now.getTime() - s.startedAt.getTime() > 10_000;
    const attendance: CastAttendance = {
      epoch: input.epoch, checkedAt: now.toISOString(), uncertain,
      customerJoinedAt: old?.customerJoinedAt ?? (seen(s.customerId) ? now.toISOString() : null),
      castJoinedAt: old?.castJoinedAt ?? (seen(s.castId) ? now.toISOString() : null),
      customerPresent: present(s.customerId), castPresent: present(s.castId),
    };
    await tx.update(castSessions).set({ attendance }).where(eq(castSessions.id, id));
  });
}

export async function recordCastVoice(db: Db, channelId: string, epoch: string, members: readonly string[], seenId: string, now: Date): Promise<void> {
  const sessions = await db.select({ id: castSessions.id }).from(castSessions).where(and(eq(castSessions.channelId, channelId), inArray(castSessions.status, ['active'])));
  for (const s of sessions) await observeCastAttendance(db, s.id, { epoch, members, seenId }, now);
}

/** 過去の未追跡予約は変更しない。不確かな新予約は運営確認へ回す。 */
export function attendanceAtFinish(s: CastSession, now: Date, graceMinutes: number): 'normal' | 'customer_absent' | 'cast_absent' | 'review' {
  const a = s.attendance;
  if (!s.startAt || !a || (a.customerJoinedAt && a.castJoinedAt)) return 'normal';
  if (a.uncertain || !s.startedAt || now.getTime() - Date.parse(a.checkedAt) > CAST_ATTENDANCE_GAP_MS || now.getTime() < s.startedAt.getTime() + graceMinutes * 60000) return 'review';
  if (!a.customerJoinedAt && a.castJoinedAt && a.castPresent) return 'customer_absent';
  if (!a.castJoinedAt && a.customerJoinedAt && a.customerPresent) return 'cast_absent';
  return 'review';
}

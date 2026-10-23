import { and, eq, isNotNull, isNull, lte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { castSessions } from '../db/schema.js';
import { isDeliverySession } from './cast.js';

export const CAST_THREAD_CLOSE_DELAY = 15 * 60_000;

/** 終了した通話予約だけ。共有スレッドは、全件が終了して15分たつまで残す。 */
export async function closeFinishedReservationThreads(
  db: Db,
  closeThread: (id: string) => Promise<void>,
  now = new Date(),
): Promise<void> {
  const due = await db.select().from(castSessions).where(and(
    isNotNull(castSessions.threadId), isNull(castSessions.threadClosedAt),
    isNotNull(castSessions.startAt), eq(castSessions.status, 'done'),
    lte(castSessions.closedAt, new Date(now.getTime() - CAST_THREAD_CLOSE_DELAY)),
  ));
  let failure: unknown;
  for (const threadId of new Set(due.filter(s => !isDeliverySession(s)).map(s => s.threadId!))) {
    const sessions = await db.select().from(castSessions).where(eq(castSessions.threadId, threadId));
    if (sessions.some(s => isDeliverySession(s) || s.status !== 'done' || !s.closedAt || s.closedAt.getTime() + CAST_THREAD_CLOSE_DELAY > now.getTime())) continue;
    // 成功してから記録する。失敗時は次の毎分処理・再起動後に再試行する。
    try {
      await closeThread(threadId);
      await db.update(castSessions).set({ threadClosedAt: now }).where(eq(castSessions.threadId, threadId));
    } catch (err) { failure ??= err; }
  }
  if (failure) throw failure;
}

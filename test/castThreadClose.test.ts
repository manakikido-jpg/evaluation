import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { castSessions } from '../src/db/schema.js';
import { closeFinishedReservationThreads } from '../src/services/castThreadClose.js';
import { makeDb } from './helpers.js';
let db: Db, close: () => Promise<void>;
const end = new Date('2026-10-24T01:00:00Z');
const now = new Date(end.getTime() + 15 * 60_000);
beforeEach(async () => { ({ db, close } = await makeDb()); });
afterEach(async () => { await close(); });
async function reservation(values: Partial<typeof castSessions.$inferInsert> = {}) {
  return (await db.insert(castSessions).values({ castId: 'cast', customerId: 'customer', plan: '30', minutes: 30, price: 300,
    status: 'done', startAt: new Date(end.getTime() - 30 * 60_000), closedAt: end, endsAt: end, threadId: 'thread', ...values }).returning())[0]!;
}
it('15分直前には閉じず、15分で閉じて再実行・再起動相当でも繰り返さない', async () => {
  const s = await reservation(), archive = vi.fn(async () => {});
  await closeFinishedReservationThreads(db, archive, new Date(now.getTime() - 1));
  expect(archive).not.toHaveBeenCalled();
  await closeFinishedReservationThreads(db, archive, now);
  expect(archive).toHaveBeenCalledExactlyOnceWith('thread');
  expect((await db.select().from(castSessions).where(eq(castSessions.id, s.id)))[0]!.threadClosedAt).toEqual(now);
  await closeFinishedReservationThreads(db, archive, new Date(now.getTime() + 60_000));
  expect(archive).toHaveBeenCalledOnce();
});
it('共有スレッドの延長中・終了後15分未満は閉じない', async () => {
  await reservation();
  const other = await reservation({ status: 'active', closedAt: null, endsAt: new Date(now.getTime() + 30 * 60_000) });
  const archive = vi.fn(async () => {});
  await closeFinishedReservationThreads(db, archive, now);
  expect(archive).not.toHaveBeenCalled();
  await db.update(castSessions).set({ status: 'done', closedAt: now }).where(eq(castSessions.id, other.id));
  await closeFinishedReservationThreads(db, archive, now);
  expect(archive).not.toHaveBeenCalled();
  await closeFinishedReservationThreads(db, archive, new Date(now.getTime() + 15 * 60_000));
  expect(archive).toHaveBeenCalledExactlyOnceWith('thread');
});
it('納品・通報・取り消し・予約でない通話は対象外', async () => {
  await reservation({ plan: 'dlv:art', threadId: 'delivery' });
  await reservation({ status: 'disputed', threadId: 'dispute' });
  await reservation({ status: 'canceled', threadId: 'cancel' });
  await reservation({ startAt: null, threadId: 'instant' });
  const archive = vi.fn(async () => {});
  await closeFinishedReservationThreads(db, archive, now);
  expect(archive).not.toHaveBeenCalled();
});
it('Discord失敗では完了記録を残さず、停止期間後でも再試行できる', async () => {
  const s = await reservation();
  await expect(closeFinishedReservationThreads(db, async () => { throw Error('403'); }, now)).rejects.toThrow('403');
  expect((await db.select().from(castSessions).where(eq(castSessions.id, s.id)))[0]!.threadClosedAt).toBeNull();
  const archive = vi.fn(async () => {});
  await closeFinishedReservationThreads(db, archive, new Date(now.getTime() + 24 * 3600_000));
  expect(archive).toHaveBeenCalledExactlyOnceWith('thread');
});

it('1件の権限エラーでほかのスレッドのクローズを止めない', async () => {
  await reservation({ threadId: 'forbidden' });
  await reservation({ threadId: 'closable' });
  const archive = vi.fn(async (id: string) => { if (id === 'forbidden') throw Error('403'); });
  await expect(closeFinishedReservationThreads(db, archive, now)).rejects.toThrow('403');
  expect(archive).toHaveBeenCalledWith('closable');
  const rows = await db.select().from(castSessions);
  expect(rows.find(s => s.threadId === 'closable')!.threadClosedAt).toEqual(now);
  expect(rows.find(s => s.threadId === 'forbidden')!.threadClosedAt).toBeNull();
});

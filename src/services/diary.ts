import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { diaries } from '../db/schema.js';
import { spendWithin } from './economy.js';
import { audit } from './audit.js';

export type DiaryMode = 'owner' | 'everyone';
export const DIARY_PRICE = 500;
export const diaryOf = async (db: Db, memberId: string) => (await db.select().from(diaries).where(eq(diaries.memberId, memberId)))[0];
export const diaryForThread = async (db: Db, threadId: string) => (await db.select().from(diaries).where(eq(diaries.threadId, threadId)))[0];
const lock = (tx: Db, memberId: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'diary:' + memberId}))`);
/** 権利は期限なし。銭と権利を一緒に保存し、押し直しでは支払わない。 */
export async function buyDiary(db: Db, memberId: string): Promise<'ok' | 'owned' | 'poor'> {
  return db.transaction(async tx => {
    await lock(tx, memberId);
    if (await diaryOf(tx, memberId)) return 'owned';
    if (!await spendWithin(tx, memberId, DIARY_PRICE, 'shop', { item: 'diary_right' })) return 'poor';
    await tx.insert(diaries).values({ memberId });
    await audit(tx, { actorId: memberId, action: 'diary.buy', detail: { price: DIARY_PRICE }, via: 'discord' });
    return 'ok';
  });
}
/** Discord作成も同じロックの中で行い、同時押しで日記を増やさない。失敗しても権利は残る。 */
export async function createDiary(db: Db, memberId: string, mode: DiaryMode, create: () => Promise<string>): Promise<{ status: 'ok' | 'exists'; threadId: string } | { status: 'no_right' }> {
  return db.transaction(async tx => {
    await lock(tx, memberId);
    const d = await diaryOf(tx, memberId);
    if (!d) return { status: 'no_right' as const };
    if (d.threadId) return { status: 'exists' as const, threadId: d.threadId };
    const threadId = await create();
    await tx.update(diaries).set({ threadId, mode }).where(eq(diaries.memberId, memberId));
    await audit(tx, { actorId: memberId, action: 'diary.create', detail: { threadId, mode }, via: 'discord' });
    return { status: 'ok' as const, threadId };
  });
}
export async function changeDiaryMode(db: Db, memberId: string, threadId: string, mode: DiaryMode): Promise<boolean> {
  return db.transaction(async tx => {
    await lock(tx, memberId);
    const d = await diaryOf(tx, memberId);
    if (!d || d.threadId !== threadId) return false;
    await tx.update(diaries).set({ mode }).where(eq(diaries.memberId, memberId));
    await audit(tx, { actorId: memberId, action: 'diary.mode', detail: { threadId, mode }, via: 'discord' });
    return true;
  });
}
/** スレッドが削除されたら権利を残して作り直せるようにする。 */
export async function clearDiaryThread(db: Db, threadId: string) {
  await db.update(diaries).set({ threadId: null }).where(eq(diaries.threadId, threadId));
}
export const mayPostDiary = (d: { memberId: string; mode: DiaryMode }, authorId: string, botId: string) => d.mode === 'everyone' || authorId === d.memberId || authorId === botId;

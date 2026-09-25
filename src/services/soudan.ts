import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { soudan, soudanMessages, soudanSenders, type Soudan, type SoudanMessage } from '../db/schema.js';

/**
 * 匿名相談。送った人の ID は soudan_senders にだけ保存し、
 * 神職の画面・Discord の通知には出さない（宮司が確認したときだけ読み、記録に残す）。
 */

export async function createSoudan(db: Db, senderId: string, body: string): Promise<number> {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(soudan).values({}).returning({ id: soudan.id });
    const id = row!.id;
    await tx.insert(soudanSenders).values({ soudanId: id, senderId });
    await tx.insert(soudanMessages).values({ soudanId: id, fromRole: 'sender', body });
    return id;
  });
}

/** 相談した本人が続きを送る。本人の相談でなければ not_found（他人の相談番号を当てても書き込めない） */
export async function appendFromSender(db: Db, soudanId: number, senderId: string, body: string): Promise<'ok' | 'not_found'> {
  const owner = await senderOf(db, soudanId);
  if (owner !== senderId) return 'not_found';
  await db.insert(soudanMessages).values({ soudanId, fromRole: 'sender', body });
  // 完了にしたあとでも、続きが来たらもう一度開く
  await db.update(soudan).set({ status: 'open', updatedAt: sql`now()` }).where(eq(soudan.id, soudanId));
  return 'ok';
}

export async function appendFromStaff(db: Db, soudanId: number, staffId: string, body: string): Promise<boolean> {
  const s = await getSoudan(db, soudanId);
  if (!s) return false;
  await db.insert(soudanMessages).values({ soudanId, fromRole: 'staff', staffId, body });
  await db
    .update(soudan)
    .set({ status: s.status === 'open' ? 'in_progress' : s.status, assigneeId: s.assigneeId ?? staffId, updatedAt: sql`now()` })
    .where(eq(soudan.id, soudanId));
  return true;
}

/** 相談した人の ID（DM を送るため・宮司の確認用。画面にそのまま出さない） */
export async function senderOf(db: Db, soudanId: number): Promise<string | undefined> {
  const [row] = await db.select({ senderId: soudanSenders.senderId }).from(soudanSenders).where(eq(soudanSenders.soudanId, soudanId));
  return row?.senderId;
}

export async function setSoudanStatus(db: Db, soudanId: number, status: 'open' | 'in_progress' | 'done', assigneeId?: string): Promise<boolean> {
  const rows = await db
    .update(soudan)
    .set({ status, ...(assigneeId ? { assigneeId } : {}), updatedAt: sql`now()` })
    .where(eq(soudan.id, soudanId))
    .returning({ id: soudan.id });
  return rows.length > 0;
}

export async function setSoudanCard(db: Db, soudanId: number, channelId: string, messageId: string): Promise<void> {
  await db.update(soudan).set({ channelId, messageId }).where(eq(soudan.id, soudanId));
}

export async function getSoudan(db: Db, soudanId: number): Promise<Soudan | undefined> {
  const [row] = await db.select().from(soudan).where(eq(soudan.id, soudanId));
  return row;
}

export async function soudanMessagesOf(db: Db, soudanId: number): Promise<SoudanMessage[]> {
  return db.select().from(soudanMessages).where(eq(soudanMessages.soudanId, soudanId)).orderBy(asc(soudanMessages.createdAt), asc(soudanMessages.id));
}

export async function listSoudan(db: Db, statuses: string[] = ['open', 'in_progress', 'done'], limit = 100) {
  const rows = await db.select().from(soudan).where(inArray(soudan.status, statuses)).orderBy(desc(soudan.updatedAt)).limit(limit);
  // 一覧に最初の一言を出す
  const firsts = rows.length
    ? await db
        .select({ soudanId: soudanMessages.soudanId, body: soudanMessages.body, n: sql<number>`count(*) over (partition by ${soudanMessages.soudanId})`.mapWith(Number) })
        .from(soudanMessages)
        .where(inArray(soudanMessages.soudanId, rows.map((r) => r.id)))
        .orderBy(asc(soudanMessages.id))
    : [];
  const first = new Map<number, { body: string; n: number }>();
  for (const f of firsts) if (!first.has(f.soudanId)) first.set(f.soudanId, { body: f.body, n: f.n });
  return rows.map((r) => ({ ...r, firstBody: first.get(r.id)?.body ?? '', messageCount: first.get(r.id)?.n ?? 0 }));
}

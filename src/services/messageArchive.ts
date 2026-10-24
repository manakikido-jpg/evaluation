import { and, desc, eq, gte, ilike, inArray, isNotNull, lt, lte, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { messageArchive, messageArchiveFiles, type ArchivedMessage } from '../db/schema.js';
import { detectImage } from './notices.js';

/**
 * 📚 書き込みの記録。だれが・いつ・どこに・何を書いたか、書きかえ・消した時刻と消した人を残す。
 * 写真は 8MB まで中身も残す（動画などは名前と大きさだけ）。90 日たったら消す。宮司だけが社務所Web で見る。
 */
export const ARCHIVE_DAYS = 90;
export const ARCHIVE_IMAGE_MAX = 8 * 1024 * 1024;

export type ArchiveInput = {
  id: string; channelId: string; authorId: string; authorName: string; content: string; createdAt: Date;
  attachments: { name: string; size: number; contentType: string | null; url: string }[];
};

/** 書き込みを残す。写真は fetchFile で中身を取って残す（失敗しても文は残す） */
export async function archiveMessage(db: Db, m: ArchiveInput, fetchFile: (url: string) => Promise<Uint8Array | undefined>): Promise<void> {
  const attachments: ArchivedMessage['attachments'] = [];
  for (const a of m.attachments.slice(0, 10)) {
    const entry: ArchivedMessage['attachments'][number] = { name: a.name.slice(0, 200), size: a.size, contentType: a.contentType };
    if (a.contentType?.startsWith('image/') && a.size <= ARCHIVE_IMAGE_MAX) {
      const data = await fetchFile(a.url).catch(() => undefined);
      const kind = data && data.length <= ARCHIVE_IMAGE_MAX ? detectImage(data) : undefined;
      if (data && kind) {
        const [row] = await db.insert(messageArchiveFiles).values({ messageId: m.id, contentType: kind.type, data }).returning({ id: messageArchiveFiles.id });
        entry.fileId = row!.id;
      }
    }
    attachments.push(entry);
  }
  await db.insert(messageArchive).values({ messageId: m.id, channelId: m.channelId, authorId: m.authorId, authorName: m.authorName.slice(0, 100), content: m.content, attachments, createdAt: m.createdAt }).onConflictDoNothing();
}

/** 書きかえられた: 前の文を edits に足して、今の文にする */
export async function archiveEdit(db: Db, id: string, content: string, at = new Date()): Promise<void> {
  await db.update(messageArchive).set({
    edits: sql`${messageArchive.edits} || jsonb_build_array(jsonb_build_object('content', ${messageArchive.content}, 'at', ${at.toISOString()}::text))`,
    content,
  }).where(and(eq(messageArchive.messageId, id), sql`${messageArchive.content} is distinct from ${content}`));
}

/** 消された（消した人が分かれば残す。先に分かった人を上書きしない） */
export async function archiveDeleted(db: Db, ids: string[], by: string | undefined, at = new Date()): Promise<void> {
  if (!ids.length) return;
  await db.update(messageArchive).set({ deletedAt: sql`coalesce(${messageArchive.deletedAt}, ${at.toISOString()}::timestamptz)`, ...(by ? { deletedBy: sql`coalesce(${messageArchive.deletedBy}, ${by})` } : {}) }).where(inArray(messageArchive.messageId, ids));
}

/** 90 日より前の記録を消す */
export async function pruneArchive(db: Db, now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - ARCHIVE_DAYS * 86_400_000);
  const old = await db.delete(messageArchive).where(lt(messageArchive.createdAt, before)).returning({ id: messageArchive.messageId });
  await db.delete(messageArchiveFiles).where(lt(messageArchiveFiles.createdAt, before));
  return old.length;
}

export type ArchiveQuery = { author?: string; channel?: string; text?: string; from?: Date; to?: Date; deleted?: boolean; limit?: number };
export async function searchArchive(db: Db, q: ArchiveQuery): Promise<ArchivedMessage[]> {
  const where: SQL[] = [];
  if (q.author) where.push(eq(messageArchive.authorId, q.author));
  if (q.channel) where.push(eq(messageArchive.channelId, q.channel));
  if (q.text) where.push(ilike(messageArchive.content, `%${q.text.replace(/[%_\\]/g, (c) => `\\${c}`)}%`));
  if (q.from) where.push(gte(messageArchive.createdAt, q.from));
  if (q.to) where.push(lte(messageArchive.createdAt, q.to));
  if (q.deleted) where.push(isNotNull(messageArchive.deletedAt));
  return db.select().from(messageArchive).where(where.length ? and(...where) : undefined).orderBy(desc(messageArchive.createdAt)).limit(Math.min(q.limit ?? 200, 500));
}

export async function archiveFile(db: Db, id: number) {
  const [row] = await db.select().from(messageArchiveFiles).where(eq(messageArchiveFiles.id, id));
  return row;
}

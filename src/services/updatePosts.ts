import { createHash } from 'node:crypto';
import { and, desc, eq, getTableColumns, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { settings, updatePosts, type UpdatePost } from '../db/schema.js';
import type { MessageBody } from '../lib/discordRest.js';
import { audit } from './audit.js';
import { detectImage, NOTICE_IMAGE_MAX } from './notices.js';

/**
 * 📝 サーバーの更新のお知らせ。まとめ係（決めたロールの人）が専用ページで下書きして申請し、
 * 宮司・神職が社務所Web で許可すると、決めたチャンネルに投稿する。
 */
const snowflake = z.string().regex(/^\d{17,20}$/);
export const updatePostConfigSchema = z.object({
  /** まとめ係のロール */
  roleId: snowflake.optional(),
  /** 許可したら投稿するチャンネル */
  channelId: snowflake.optional(),
});
export type UpdatePostConfig = z.infer<typeof updatePostConfigSchema>;
const KEY = 'update_posts';

export const TITLE_MAX = 80;
export const BODY_MAX = 1800;

export async function loadUpdatePostConfig(db: Db): Promise<UpdatePostConfig> {
  const [r] = await db.select().from(settings).where(eq(settings.key, KEY));
  const parsed = updatePostConfigSchema.safeParse(r?.value ?? {});
  return parsed.success ? parsed.data : {};
}
export async function saveUpdatePostConfig(db: Db, config: UpdatePostConfig, by: string) {
  const value = updatePostConfigSchema.parse(config);
  await db.insert(settings).values({ key: KEY, value, updatedBy: by }).onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: by, updatedAt: new Date() } });
  await audit(db, { actorId: by, action: 'update_post.settings', detail: value, via: 'web' });
}

const SHU = 0xd7003a;
/** Discord に出す本文（題があれば太字で 1 行目に） */
export const updatePostText = (p: Pick<UpdatePost, 'title' | 'body'>) => (p.title ? `**${p.title}**\n\n${p.body}` : p.body).slice(0, 2000);
/** Discord に送る形（掲示と同じ: カードか普通のメッセージ。写真は上か下） */
export function updatePostMessage(p: Pick<UpdatePost, 'id' | 'title' | 'body' | 'style' | 'imageType' | 'imageData' | 'imagePosition'>): MessageBody {
  const text = updatePostText(p);
  const ext = p.imageData ? detectImage(p.imageData)?.ext : undefined;
  const file = p.imageData && p.imageType && ext ? { name: `update-${p.id}.${ext}`, contentType: p.imageType, data: p.imageData } : undefined;
  const files = file ? { files: [file] } : {};
  if (p.style === 'text') return { content: text, embeds: [], allowed_mentions: { parse: [] }, ...files };
  if (!file) return { embeds: [{ description: text, color: SHU }], allowed_mentions: { parse: [] } };
  const picture = { url: `attachment://${file.name}` };
  const embeds = p.imagePosition === 'top' ? [{ color: SHU, image: picture }, { description: text, color: SHU }] : [{ description: text, color: SHU, image: picture }];
  return { embeds, allowed_mentions: { parse: [] }, ...files };
}

export type UpdatePostInput = { title: string; body: string; style: 'embed' | 'text'; imagePosition: 'top' | 'bottom' };
export function parseUpdatePost(b: Record<string, unknown>): UpdatePostInput | undefined {
  const title = String(b.title ?? '').trim();
  const body = String(b.body ?? '').replace(/\r\n/g, '\n').trim();
  if (!body || body.length > BODY_MAX || title.length > TITLE_MAX) return undefined;
  return { title, body, style: b.style === 'text' ? 'text' : 'embed', imagePosition: b.imagePosition === 'top' ? 'top' : 'bottom' };
}

/** 選んだ写真を確かめる（なければ undefined） */
export function checkUpdateImage(data: Uint8Array): { type: string; data: Uint8Array; hash: string } | 'too_big' | 'bad_type' {
  if (data.length > NOTICE_IMAGE_MAX) return 'too_big';
  const kind = detectImage(data);
  if (!kind) return 'bad_type';
  return { type: kind.type, data, hash: createHash('sha256').update(data).digest('hex').slice(0, 16) };
}

// 一覧では写真の中身は読まない
const { imageData: _skip, ...light } = getTableColumns(updatePosts);
export type UpdatePostRow = Omit<UpdatePost, 'imageData'>;
export const myUpdatePosts = (db: Db, authorId: string): Promise<UpdatePostRow[]> =>
  db.select(light).from(updatePosts).where(eq(updatePosts.authorId, authorId)).orderBy(desc(updatePosts.updatedAt)).limit(50);

export const listUpdatePosts = (db: Db, status: UpdatePost['status'][], limit = 50): Promise<UpdatePostRow[]> =>
  db.select(light).from(updatePosts).where(inArray(updatePosts.status, status)).orderBy(desc(updatePosts.updatedAt)).limit(limit);

export async function getUpdatePost(db: Db, id: number) {
  const [row] = await db.select().from(updatePosts).where(eq(updatePosts.id, id));
  return row;
}

/** 下書きを新しく作る・直す。直せるのは本人の「下書き」「戻した」ものだけ */
export async function saveUpdateDraft(db: Db, author: { id: string; name: string }, input: UpdatePostInput, id?: number, now = new Date(), image?: { type: string; data: Uint8Array; hash: string } | 'remove'): Promise<UpdatePost | undefined> {
  const img = image === 'remove' ? { imageType: null, imageData: null, imageHash: null } : image ? { imageType: image.type, imageData: image.data, imageHash: image.hash } : {};
  if (id === undefined) {
    const [row] = await db.insert(updatePosts).values({ authorId: author.id, authorName: author.name, ...input, ...img, createdAt: now, updatedAt: now }).returning();
    await audit(db, { actorId: author.id, action: 'update_post.draft', detail: { id: row!.id }, via: 'web' });
    return row;
  }
  const [row] = await db.update(updatePosts).set({ ...input, ...img, authorName: author.name, status: 'draft', updatedAt: now })
    .where(and(eq(updatePosts.id, id), eq(updatePosts.authorId, author.id), inArray(updatePosts.status, ['draft', 'rejected']))).returning();
  if (row) await audit(db, { actorId: author.id, action: 'update_post.draft', detail: { id }, via: 'web' });
  return row;
}

/** 申請する（下書き・戻した → 許可待ち） */
export async function submitUpdatePost(db: Db, authorId: string, id: number, now = new Date()) {
  const [row] = await db.update(updatePosts).set({ status: 'pending', submittedAt: now, updatedAt: now, note: '' })
    .where(and(eq(updatePosts.id, id), eq(updatePosts.authorId, authorId), inArray(updatePosts.status, ['draft', 'rejected']))).returning();
  if (row) await audit(db, { actorId: authorId, action: 'update_post.submit', detail: { id }, via: 'web' });
  return row;
}

/** 申請を取り消して下書きに戻す（許可待ちのときだけ） */
export async function withdrawUpdatePost(db: Db, authorId: string, id: number, now = new Date()) {
  const [row] = await db.update(updatePosts).set({ status: 'draft', updatedAt: now })
    .where(and(eq(updatePosts.id, id), eq(updatePosts.authorId, authorId), eq(updatePosts.status, 'pending'))).returning();
  return row;
}

/** 下書きを消す（投稿したものは消さない） */
export async function deleteUpdateDraft(db: Db, authorId: string, id: number) {
  const rows = await db.delete(updatePosts).where(and(eq(updatePosts.id, id), eq(updatePosts.authorId, authorId), inArray(updatePosts.status, ['draft', 'rejected']))).returning();
  return rows.length > 0;
}

/**
 * 許可して投稿する。同時に押されても 1 回だけ（許可待ち → 投稿した、を先に取る）。
 * 送れなかったら許可待ちに戻す。
 */
export async function approveUpdatePost(db: Db, id: number, by: string, channelId: string, send: (body: MessageBody) => Promise<string | undefined>, now = new Date()): Promise<'ok' | 'gone' | 'failed'> {
  const [row] = await db.update(updatePosts).set({ status: 'posted', decidedBy: by, decidedAt: now, channelId, updatedAt: now })
    .where(and(eq(updatePosts.id, id), eq(updatePosts.status, 'pending'))).returning();
  if (!row) return 'gone';
  let messageId: string | undefined;
  try { messageId = await send(updatePostMessage(row)); }
  catch {
    await db.update(updatePosts).set({ status: 'pending', decidedBy: null, decidedAt: null, channelId: null }).where(eq(updatePosts.id, id));
    return 'failed';
  }
  await db.update(updatePosts).set({ messageId: messageId ?? null }).where(eq(updatePosts.id, id));
  await audit(db, { actorId: by, targetId: row.authorId, action: 'update_post.approve', detail: { id, channelId, messageId }, via: 'web' });
  return 'ok';
}

/** 戻す（ひとことを付けて、まとめ係が直せるように） */
export async function rejectUpdatePost(db: Db, id: number, by: string, note: string, now = new Date()) {
  const [row] = await db.update(updatePosts).set({ status: 'rejected', note: note.slice(0, 300), decidedBy: by, decidedAt: now, updatedAt: now })
    .where(and(eq(updatePosts.id, id), eq(updatePosts.status, 'pending'))).returning();
  if (row) await audit(db, { actorId: by, targetId: row.authorId, action: 'update_post.reject', detail: { id }, via: 'web' });
  return row;
}

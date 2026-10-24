import { createHash } from 'node:crypto';
import { and, desc, eq, getTableColumns, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { settings, updatePosts, type UpdatePost } from '../db/schema.js';
import type { MessageBody } from '../lib/discordRest.js';
import { audit } from './audit.js';
import { detectImage, mentionAllowed, mentionValue, mentionHead, NOTICE_IMAGE_MAX, resolveMention } from './notices.js';

/**
 * 📝 サーバーの更新のお知らせ。まとめ係（決めたロールの人）が専用ページで下書きして申請し、
 * 宮司・神職が社務所Web で許可すると、決めたチャンネルに投稿する。
 */
const snowflake = z.string().regex(/^\d{17,20}$/);
export const updatePostConfigSchema = z.object({
  /** まとめ係のロール */
  roleId: snowflake.optional(),
  /** 前の形: 投稿先を選んでいない投稿文の行き先 */
  channelId: snowflake.optional(),
  /** まとめ係が選べる投稿先。まだ決めていなければ、名前で DEFAULT_CHANNEL_NAMES を探す */
  channelIds: z.array(snowflake).max(50).optional(),
});
export type UpdatePostConfig = z.infer<typeof updatePostConfigSchema>;
const KEY = 'update_posts';

/** はじめに選べる投稿先（チャンネルの名前に、この文字が入っているもの） */
export const DEFAULT_CHANNEL_NAMES = ['お触書', '境内‐雑談', '授与所のしきたり', '本殿のしきたり', '宿坊のしきたり', '縁日のしきたり', '院のしきたり', '遊郭のしきたり', 'イベント告知'];
// ‐ - ー － などのちがいは気にしない
const norm = (s: string) => s.replace(/[‐\-－–—ー‑]/g, '-').toLowerCase();
type Ch = { id: string; name: string; type: number };
/** まとめ係が選べる投稿先（テキスト・お知らせのチャンネルだけ。並びはサーバーの順） */
export function postableUpdateChannels<T extends Ch>(conf: UpdatePostConfig, channels: T[]): T[] {
  const text = channels.filter((c) => c.type === 0 || c.type === 5);
  if (conf.channelIds) return text.filter((c) => conf.channelIds!.includes(c.id));
  // 「院のしきたり」が「本殿のしきたり」などにまちがって当たらないよう、名前の終わりで合わせる
  return text.filter((c) => DEFAULT_CHANNEL_NAMES.some((n) => norm(c.name).endsWith(norm(n)) && (n !== '院のしきたり' || !/[殿坊]のしきたり$/.test(c.name))));
}

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
/** メンションはカードの外（メッセージの上）。普通のメッセージなら 1 行目。「すべての役職」は rankRoleIds に置きかえる */
export function updatePostMessage(p: Pick<UpdatePost, 'id' | 'title' | 'body' | 'style' | 'imageType' | 'imageData' | 'imagePosition' | 'mention'>, rankRoleIds: readonly string[] = []): MessageBody {
  const text = updatePostText(p);
  const mention = resolveMention(p.mention, rankRoleIds);
  const head = mentionHead(mention);
  const allowed_mentions = mentionAllowed(mention);
  const ext = p.imageData ? detectImage(p.imageData)?.ext : undefined;
  const file = p.imageData && p.imageType && ext ? { name: `update-${p.id}.${ext}`, contentType: p.imageType, data: p.imageData } : undefined;
  const files = file ? { files: [file] } : {};
  if (p.style === 'text') return { content: head ? `${head}\n${text}`.slice(0, 2000) : text, embeds: [], allowed_mentions, ...files };
  if (!file) return { content: head, embeds: [{ description: text, color: SHU }], allowed_mentions };
  const picture = { url: `attachment://${file.name}` };
  const embeds = p.imagePosition === 'top' ? [{ color: SHU, image: picture }, { description: text, color: SHU }] : [{ description: text, color: SHU, image: picture }];
  return { content: head, embeds, allowed_mentions, ...files };
}

export type UpdatePostInput = { title: string; body: string; style: 'embed' | 'text'; imagePosition: 'top' | 'bottom'; mention: string; targetChannelId: string | null };
/** 選べる投稿先・ロールだけを受け取る（ほかは消す） */
/** 選んだメンションを保存する形に（「🔔 通知あり」は通知OK のロール） */
export function updatePostMention(b: Record<string, unknown>, allowed: { roleIds: Set<string>; notifyRoleId?: string }): string {
  if (b.mentionKind === 'notify') return allowed.notifyRoleId ?? '';
  const roles = [b.mentionRoles ?? []].flat().filter((v): v is string => typeof v === 'string');
  return mentionValue(b.mentionKind, roles, allowed.roleIds);
}
/** notifyRoleId: 「🔔 通知あり」のロール（mentionKind が notify のとき、このロールに通知する） */
export function parseUpdatePost(b: Record<string, unknown>, allowed: { channelIds: Set<string>; roleIds: Set<string>; notifyRoleId?: string } = { channelIds: new Set(), roleIds: new Set() }): UpdatePostInput | undefined {
  const title = String(b.title ?? '').trim();
  const body = String(b.body ?? '').replace(/\r\n/g, '\n').trim();
  if (!body || body.length > BODY_MAX || title.length > TITLE_MAX) return undefined;
  const target = typeof b.targetChannelId === 'string' && allowed.channelIds.has(b.targetChannelId) ? b.targetChannelId : null;
  return { title, body, style: b.style === 'text' ? 'text' : 'embed', imagePosition: b.imagePosition === 'top' ? 'top' : 'bottom', mention: updatePostMention(b, allowed), targetChannelId: target };
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
export async function approveUpdatePost(db: Db, id: number, by: string, channelOf: (post: UpdatePost) => string | undefined, send: (channelId: string, body: MessageBody) => Promise<string | undefined>, rankRoleIds: readonly string[] = [], now = new Date()): Promise<'ok' | 'gone' | 'failed' | 'nochannel'> {
  const current = await getUpdatePost(db, id);
  if (!current || current.status !== 'pending') return 'gone';
  const channelId = channelOf(current);
  if (!channelId) return 'nochannel';
  const [row] = await db.update(updatePosts).set({ status: 'posted', decidedBy: by, decidedAt: now, channelId, updatedAt: now })
    .where(and(eq(updatePosts.id, id), eq(updatePosts.status, 'pending'))).returning();
  if (!row) return 'gone';
  let messageId: string | undefined;
  try { messageId = await send(channelId, updatePostMessage(row, rankRoleIds)); }
  catch {
    await db.update(updatePosts).set({ status: 'pending', decidedBy: null, decidedAt: null, channelId: null }).where(eq(updatePosts.id, id));
    return 'failed';
  }
  await db.update(updatePosts).set({ messageId: messageId ?? null }).where(eq(updatePosts.id, id));
  await audit(db, { actorId: by, targetId: row.authorId, action: 'update_post.approve', detail: { id, channelId, messageId }, via: 'web' });
  return 'ok';
}

/** 許可する人が、許可待ちの題と本文をその場で直す（許可待ちのときだけ） */
export async function editPendingUpdatePost(db: Db, id: number, by: string, input: { title: string; body: string }, now = new Date()) {
  const title = input.title.trim().slice(0, TITLE_MAX);
  const body = input.body.trim().slice(0, BODY_MAX);
  if (!body) return undefined;
  const [row] = await db.update(updatePosts).set({ title, body, updatedAt: now })
    .where(and(eq(updatePosts.id, id), eq(updatePosts.status, 'pending'))).returning();
  if (row) await audit(db, { actorId: by, targetId: row.authorId, action: 'update_post.edit', detail: { id }, via: 'web' });
  return row;
}

/** 戻す（ひとことを付けて、まとめ係が直せるように） */
export async function rejectUpdatePost(db: Db, id: number, by: string, note: string, now = new Date()) {
  const [row] = await db.update(updatePosts).set({ status: 'rejected', note: note.slice(0, 300), decidedBy: by, decidedAt: now, updatedAt: now })
    .where(and(eq(updatePosts.id, id), eq(updatePosts.status, 'pending'))).returning();
  if (row) await audit(db, { actorId: by, targetId: row.authorId, action: 'update_post.reject', detail: { id }, via: 'web' });
  return row;
}

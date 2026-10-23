import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { and, asc, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { settings, stickerDrafts, type StickerDraft } from '../db/schema.js';
import { DiscordHttpError, type GuildSticker } from '../lib/discordRest.js';
import { audit } from './audit.js';

export const STICKER_UPLOAD_MAX = 8 * 1024 * 1024;
export const STICKER_MAX = 512 * 1024;
export const stickerConfigSchema = z.object({ roleId: z.string().regex(/^\d{17,20}$/).optional() });
export async function loadStickerConfig(db: Db) {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'sticker_desk'));
  return stickerConfigSchema.parse(row?.value ?? {});
}
export async function saveStickerConfig(db: Db, input: unknown, by: string) {
  const value = stickerConfigSchema.parse(input);
  await db.insert(settings).values({ key: 'sticker_desk', value, updatedBy: by }).onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: by, updatedAt: new Date() } });
  await audit(db, { actorId: by, action: 'sticker.settings', via: 'web' });
}
export const stickerInputSchema = z.object({ name: z.string().trim().min(2).max(30), description: z.string().trim().max(100).refine(v => !v || v.length >= 2), tags: z.string().trim().min(1).max(200) });
/** 原画像の拡張子・MIMEを信用せず復号し、透過と縦横比を保った320px静止PNGへ整える。 */
export async function prepareSticker(data: Uint8Array) {
  if (!data.length || data.length > STICKER_UPLOAD_MAX) throw Error('画像は8MBまでです。');
  // APNGを先頭フレームだけにして登録しない。
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (bytes.subarray(1, 4).toString() === 'PNG') {
    for (let offset = 8; offset + 12 <= data.length;) {
      const size = bytes.readUInt32BE(offset);
      if (bytes.subarray(offset + 4, offset + 8).toString() === 'acTL') throw Error('今回は静止画のみ対応しています。');
      offset += 12 + size;
    }
  }
  const source = sharp(data, { limitInputPixels: 16_777_216, failOn: 'error' });
  const meta = await source.metadata();
  if (!['png', 'jpeg', 'webp'].includes(meta.format ?? '') || (meta.pages ?? 1) > 1) throw Error('静止画のPNG・JPEG・WebPを選んでください。');
  const imageData = await source.rotate().resize(320, 320, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  if (imageData.length > STICKER_MAX) throw Error('変換後の画像が512KiBを超えています。');
  return { imageData, imageHash: createHash('sha256').update(imageData).digest('hex') };
}
const { imageData: _data, ...light } = getTableColumns(stickerDrafts);
export const listStickers = (db: Db, author?: string) => db.select(light).from(stickerDrafts).where(author ? eq(stickerDrafts.authorId, author) : undefined).orderBy(asc(stickerDrafts.position), asc(stickerDrafts.id)).limit(300);
export const getSticker = async (db: Db, id: number) => (await db.select().from(stickerDrafts).where(eq(stickerDrafts.id, id)))[0];
export async function saveSticker(db: Db, author: { id: string; name: string }, input: z.infer<typeof stickerInputSchema>, image?: Awaited<ReturnType<typeof prepareSticker>>, id?: number) {
  const parsed = stickerInputSchema.parse(input);
  if (id === undefined) {
    if (!image) return undefined;
    return (await db.insert(stickerDrafts).values({ ...parsed, ...image, authorId: author.id, authorName: author.name }).returning())[0];
  }
  return (await db.update(stickerDrafts).set({ ...parsed, ...image, status: 'draft', note: '', updatedAt: new Date() }).where(and(eq(stickerDrafts.id, id), eq(stickerDrafts.authorId, author.id), inArray(stickerDrafts.status, ['draft', 'rejected']))).returning())[0];
}
export async function submitSticker(db: Db, id: number, author: string) {
  return (await db.update(stickerDrafts).set({ status: 'pending', note: '', updatedAt: new Date() }).where(and(eq(stickerDrafts.id, id), eq(stickerDrafts.authorId, author), inArray(stickerDrafts.status, ['draft', 'rejected']))).returning())[0];
}
export async function rejectSticker(db: Db, id: number, by: string, note: string) {
  const [row] = await db.update(stickerDrafts).set({ status: 'rejected', note: note.trim().slice(0, 300), decidedBy: by }).where(and(eq(stickerDrafts.id, id), eq(stickerDrafts.status, 'pending'))).returning();
  if (row) await audit(db, { actorId: by, targetId: row.authorId, action: 'sticker.reject', detail: { id }, via: 'web' });
  return row;
}
/** DiscordへのPOSTは一度だけ。結果不明は再送せず運営による照合を待つ。 */
export async function registerSticker(db: Db, id: number, by: string, create: (row: StickerDraft) => Promise<GuildSticker>, expectedRevision?: Date) {
  const [row] = await db.update(stickerDrafts).set({ status: 'registering', decidedBy: by, updatedAt: new Date() }).where(and(eq(stickerDrafts.id, id), eq(stickerDrafts.status, 'pending'), expectedRevision ? eq(stickerDrafts.updatedAt, expectedRevision) : undefined)).returning();
  if (!row) return 'gone';
  let sticker: GuildSticker;
  try {
    sticker = await create(row);
    if (!/^\d{17,20}$/.test(sticker.id)) throw Error('登録先IDを確認できませんでした。');
  } catch (err) {
    const certain = err instanceof DiscordHttpError && err.status >= 400 && err.status < 500 && err.status !== 408;
    await db.update(stickerDrafts).set({ status: certain ? 'pending' : 'uncertain', note: certain ? '登録できませんでした。空き枠・BOTの権限・画像条件を確認してください。' : '登録結果を確認できません。Discordのスタンプ一覧と照合してください。' }).where(eq(stickerDrafts.id, id));
    return certain ? 'failed' : 'uncertain';
  }
  await db.update(stickerDrafts).set({ status: 'registered', stickerId: sticker.id, note: '', updatedAt: new Date() }).where(eq(stickerDrafts.id, id));
  await audit(db, { actorId: by, targetId: row.authorId, action: 'sticker.register', detail: { id, stickerId: sticker.id }, via: 'web' });
  return 'registered';
}
/** 送信中に停止した場合も、Discord側を確認してから人が結果を確定する。 */
export async function reconcileSticker(db: Db, id: number, by: string, stickerId: string, fetch: () => Promise<GuildSticker[]>, absent: boolean) {
  const row = await getSticker(db, id);
  if (!row || !['registering', 'uncertain'].includes(row.status)) return false;
  if (row.updatedAt.getTime() > Date.now() - 120_000) return false;
  const list = await fetch();
  const found = list.find(s => s.id === stickerId && s.name === row.name);
  if (stickerId ? !found : !absent || list.some(s => s.name === row.name)) return false;
  const [saved] = await db.update(stickerDrafts).set({ status: found ? 'registered' : 'pending', stickerId: found?.id ?? null, note: '', updatedAt: new Date() }).where(and(eq(stickerDrafts.id, id), eq(stickerDrafts.updatedAt, row.updatedAt), inArray(stickerDrafts.status, ['registering', 'uncertain']))).returning();
  if (saved) await audit(db, { actorId: by, action: 'sticker.reconcile', detail: { id, stickerId: found?.id }, via: 'web' });
  return !!saved;
}
/** 管理一覧だけの並び順。削除再登録は行わない。 */
export async function moveSticker(db: Db, id: number, direction: 'up' | 'down', by: string) {
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('sticker_order'))`);
    const rows = await tx.select({ id: stickerDrafts.id }).from(stickerDrafts).orderBy(asc(stickerDrafts.position), asc(stickerDrafts.id)).for('update');
    const index = rows.findIndex(r => r.id === id), next = index + (direction === 'up' ? -1 : 1);
    if (index < 0 || next < 0 || next >= rows.length) return;
    [rows[index], rows[next]] = [rows[next]!, rows[index]!];
    for (const [position, row] of rows.entries()) await tx.update(stickerDrafts).set({ position }).where(eq(stickerDrafts.id, row.id));
  });
  await audit(db, { actorId: by, action: 'sticker.order', detail: { id, direction }, via: 'web' });
}

export async function stickerCreatorRole(db: Db, roles: { id: string; name: string; managed?: boolean }[]) {
  const configured = (await loadStickerConfig(db)).roleId;
  if (configured) return roles.some(r => r.id === configured && !r.managed) ? configured : undefined;
  const matches = roles.filter(r => !r.managed && r.name === 'スタンプ製作者');
  return matches.length === 1 ? matches[0]!.id : undefined;
}

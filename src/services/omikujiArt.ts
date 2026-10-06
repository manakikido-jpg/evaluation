import { createHash } from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import { OMIKUJI_SPECIAL_MAX } from '../config.js';
import type { Db } from '../db/client.js';
import { slotArt } from '../db/schema.js';
import { detectImage } from './notices.js';

/**
 * 🎴 運営吉の絵（社務所Web で入れる）。AT 機の絵と同じ表に omikuji-1〜4 の名前で入れる。
 * Discord には絵そのものを添えて送るので、外から見られる URL はいらない
 */

export const OMIKUJI_ART_MAX_BYTES = 4 * 1024 * 1024;
const keyOf = (n: number) => `omikuji-${n}`;
export const isOmikujiArtNo = (n: number) => Number.isInteger(n) && n >= 1 && n <= OMIKUJI_SPECIAL_MAX;
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

export async function saveOmikujiArt(db: Db, n: number, data: Uint8Array): Promise<'ok' | 'bad_key' | 'bad_image' | 'too_big'> {
  if (!isOmikujiArtNo(n)) return 'bad_key';
  if (data.byteLength > OMIKUJI_ART_MAX_BYTES) return 'too_big';
  const kind = detectImage(data);
  if (!kind) return 'bad_image';
  const hash = createHash('sha256').update(data).digest('hex').slice(0, 16);
  await db
    .insert(slotArt)
    .values({ key: keyOf(n), contentType: kind.type, data, hash })
    .onConflictDoUpdate({ target: slotArt.key, set: { contentType: kind.type, data, hash, updatedAt: new Date() } });
  return 'ok';
}

export async function loadOmikujiArt(db: Db, n: number): Promise<{ contentType: string; data: Uint8Array; hash: string; name: string } | undefined> {
  if (!isOmikujiArtNo(n)) return undefined;
  const [row] = await db.select().from(slotArt).where(eq(slotArt.key, keyOf(n)));
  return row && { contentType: row.contentType, data: row.data, hash: row.hash, name: `unei${n}.${EXT[row.contentType] ?? 'png'}` };
}

export async function deleteOmikujiArt(db: Db, n: number): Promise<void> {
  if (isOmikujiArtNo(n)) await db.delete(slotArt).where(eq(slotArt.key, keyOf(n)));
}

/** 入っている絵の印（番号 → hash）。中身は読まない */
export async function omikujiArtHashes(db: Db): Promise<Record<number, string>> {
  const rows = await db.select({ key: slotArt.key, hash: slotArt.hash }).from(slotArt).where(like(slotArt.key, 'omikuji-%'));
  return Object.fromEntries(rows.flatMap((r) => (/^omikuji-(\d)$/.test(r.key) ? [[Number(r.key.slice(8)), r.hash]] : [])));
}

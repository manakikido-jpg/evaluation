import { eq, like, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';
export type CastIntroPost = { castId: string; channelId: string; messageId: string; hash: string };
const key = (castId: string, channelId: string) => `cast_intro:${castId}:${channelId}`;
/** 同じ人の投稿・更新を順に処理し、連打による重複投稿を防ぐ */
export async function withCastIntroLock<T>(db: Db, castId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cast-intro:${castId}`}))`);
    return fn(tx as Db);
  });
}
export async function castIntroPosts(db: Db, castId?: string): Promise<CastIntroPost[]> {
  const rows = await db.select().from(settings).where(like(settings.key, castId ? `cast_intro:${castId}:%` : 'cast_intro:%'));
  return rows.flatMap(r => {
    const v = r.value as Partial<CastIntroPost> | null;
    return v && typeof v.castId === 'string' && typeof v.channelId === 'string' && typeof v.messageId === 'string' ? [{ castId: v.castId, channelId: v.channelId, messageId: v.messageId, hash: typeof v.hash === 'string' ? v.hash : '' }] : [];
  });
}
export async function saveCastIntroPost(db: Db, post: CastIntroPost, onlyIfMissing = false) {
  const insert = db.insert(settings).values({ key: key(post.castId, post.channelId), value: post, updatedBy: 'system' });
  if (onlyIfMissing) await insert.onConflictDoNothing();
  else await insert.onConflictDoUpdate({ target: settings.key, set: { value: post, updatedBy: 'system', updatedAt: new Date() } });
}
export async function forgetCastIntroPost(db: Db, post: CastIntroPost) {
  await db.delete(settings).where(eq(settings.key, key(post.castId, post.channelId)));
}
/** 自分のBOTが出した紹介の選ぶ欄から、担当するキャストを見つける */
export function castIntroId(components: unknown): string | undefined {
  if (!Array.isArray(components)) return;
  for (const row of components) {
    if (!row || typeof row !== 'object' || row.type !== 1 || !Array.isArray(row.components)) continue;
    for (const item of row.components) {
      if (item?.type !== 3 || typeof item.custom_id !== 'string') continue;
      const match = /^cast:plansel:(\d{17,20})$/.exec(item.custom_id);
      if (match) return match[1];
    }
  }
}

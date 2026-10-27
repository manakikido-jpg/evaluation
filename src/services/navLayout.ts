import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';
import { audit } from './audit.js';

/**
 * 🧭 社務所Web の左のメニューの並び方（宮司が全員分を決める）。
 * groups: カテゴリの名前と、その中のページ（メニューの key）の順番。
 * ここにないページは、もとのカテゴリのいちばん後ろに出る（新しく足したページも消えない）。
 */
const KEY = 'web.nav';
export const navLayoutSchema = z.object({
  groups: z.array(z.object({ title: z.string().trim().min(1).max(20), keys: z.array(z.string().regex(/^[a-z0-9]{1,30}$/)).max(100) })).max(20),
});
export type NavLayout = z.infer<typeof navLayoutSchema>;

export async function loadNavLayout(db: Db): Promise<NavLayout | undefined> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  const r = navLayoutSchema.safeParse(row?.value);
  return r.success && r.data.groups.length ? r.data : undefined;
}
export async function saveNavLayout(db: Db, input: unknown, by: string): Promise<NavLayout> {
  const value = navLayoutSchema.parse(input);
  // 同じページを 2 か所に出さない（前にあるほうを使う）
  const seen = new Set<string>();
  value.groups = value.groups.map(g => ({ title: g.title, keys: g.keys.filter(k => !seen.has(k) && seen.add(k)) }));
  await db.transaction(async tx => {
    await tx.insert(settings).values({ key: KEY, value, updatedBy: by }).onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: by, updatedAt: new Date() } });
    await audit(tx, { actorId: by, action: 'web.nav_save', detail: { groups: value.groups.map(g => g.title) }, via: 'web' });
  });
  return value;
}
export async function resetNavLayout(db: Db, by: string) {
  await db.delete(settings).where(eq(settings.key, KEY));
  await audit(db, { actorId: by, action: 'web.nav_reset', detail: {}, via: 'web' });
}

import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Rank } from '../config.js';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';
import { audit } from './audit.js';

/**
 * 🎖 任命したときに一緒に付けるロール（例: 衛士 ＋ 新役衛士）。
 * 役職（rank の key）ごとに 1 つ。社務所Web の「役職」で宮司が選ぶ。
 * - その役職のロールが付いたら、一緒に付ける（Discord で手で付けても、社務所Web で付けても）
 * - もっと格の高い役職のロールが付いたら（役職が上がったら）外す
 * - その役職のロールが外れたら、一緒に外す
 */
const KEY = 'ranks.appoint_roles';
const snowflake = z.string().regex(/^\d{17,20}$/);
export const appointRolesSchema = z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), snowflake);
export type AppointRoles = z.infer<typeof appointRolesSchema>;

export async function loadAppointRoles(db: Db): Promise<AppointRoles> {
  const [r] = await db.select().from(settings).where(eq(settings.key, KEY));
  const parsed = appointRolesSchema.safeParse(r?.value ?? {});
  return parsed.success ? parsed.data : {};
}

export async function saveAppointRoles(db: Db, value: AppointRoles, by: string): Promise<void> {
  const v = appointRolesSchema.parse(value);
  await db.transaction(async (tx) => {
    await tx.insert(settings).values({ key: KEY, value: v, updatedBy: by }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedBy: by, updatedAt: new Date() } });
    await audit(tx as Db, { actorId: by, action: 'ranks.appoint_roles', detail: v, via: 'web' });
  });
}

/**
 * ロールが変わったときに、付ける・外す「一緒のロール」（計算だけ）。
 * 役職のロールが付いた → その役職の一緒のロールを付ける。
 * 格の高い役職が付いた・その役職が外れた → 低い役職の一緒のロールを外す（いま付けるものは外さない）。
 */
export function appointRoleChanges(ranks: readonly Rank[], map: AppointRoles, before: ReadonlySet<string>, after: ReadonlySet<string>): { add: string[]; remove: string[] } {
  const gained = ranks.filter((r) => after.has(r.roleId) && !before.has(r.roleId));
  const lost = ranks.filter((r) => before.has(r.roleId) && !after.has(r.roleId));
  if (!gained.length && !lost.length) return { add: [], remove: [] };
  const rankRoleIds = new Set(ranks.map((r) => r.roleId));
  // 役職そのもののロールは、一緒のロールとして付け外ししない（設定のまちがいで役職を消さないように）
  const companion = (r: Rank) => { const id = map[r.key]; return id && !rankRoleIds.has(id) ? id : undefined; };
  const add = new Set<string>();
  for (const r of gained) { const id = companion(r); if (id && !after.has(id)) add.add(id); }
  const keep = new Set([...add, ...gained.map(companion).filter((x): x is string => Boolean(x))]);
  const top = Math.max(0, ...gained.map((g) => g.weight));
  const remove = new Set<string>();
  for (const r of ranks) {
    const id = companion(r);
    if (!id || !after.has(id) || keep.has(id)) continue;
    const promoted = gained.some((g) => g.key !== r.key) && top > r.weight;
    if (promoted || lost.some((l) => l.key === r.key)) remove.add(id);
  }
  return { add: [...add], remove: [...remove] };
}

import { desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { members, securityWatch, type SecurityWatchRow } from '../db/schema.js';

/** 🛡 要注意リスト: 運営が登録した人。入ったら知らせ、案内人のロール付与と自動の承認を止める */

export const WATCH_REASON_MAX = 200;

export async function watchOf(db: Db, memberId: string): Promise<SecurityWatchRow | undefined> {
  const [row] = await db.select().from(securityWatch).where(eq(securityWatch.memberId, memberId));
  return row;
}

export async function listWatch(db: Db): Promise<SecurityWatchRow[]> {
  return db.select().from(securityWatch).orderBy(desc(securityWatch.addedAt));
}

/** 登録（もうあれば理由を上書き）。ID の形がちがえば false */
export async function addWatch(db: Db, memberId: string, reason: string, addedBy: string, now = new Date()): Promise<boolean> {
  const r = reason.trim().slice(0, WATCH_REASON_MAX);
  if (!/^\d{15,25}$/.test(memberId) || !r) return false;
  await db
    .insert(securityWatch)
    .values({ memberId, reason: r, addedBy, addedAt: now })
    .onConflictDoUpdate({ target: securityWatch.memberId, set: { reason: r, addedBy, addedAt: now } });
  return true;
}

export async function removeWatch(db: Db, memberId: string): Promise<boolean> {
  return (await db.delete(securityWatch).where(eq(securityWatch.memberId, memberId)).returning()).length > 0;
}

/** 名前（表示名）を ID から（リストの表示用） */
export async function namesOf(db: Db, ids: readonly string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db.select({ id: members.id, name: members.displayName }).from(members).where(inArray(members.id, [...ids]));
  return new Map(rows.map((m) => [m.id, m.name ?? m.id]));
}

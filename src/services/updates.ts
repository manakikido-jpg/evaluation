import { eq } from 'drizzle-orm';
import { LATEST_CHANGE_ID } from '../changelog.js';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';

/** 更新履歴: 運営の人ごとに「どこまで読んだか」を覚える */
const key = (userId: string) => `updates_seen:${userId}`;

export async function seenChangeId(db: Db, userId: string): Promise<string | undefined> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key(userId)));
  const v = row?.value as { id?: unknown } | undefined;
  return typeof v?.id === 'string' ? v.id : undefined;
}

export async function markChangesSeen(db: Db, userId: string, id = LATEST_CHANGE_ID): Promise<void> {
  const value = { id };
  await db
    .insert(settings)
    .values({ key: key(userId), value, updatedBy: userId })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: userId, updatedAt: new Date() } });
}

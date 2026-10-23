import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';

/** 奥の院（AFK）で BOT がミュートした人。BOT が止まっても外し忘れないように DB に残す */
const KEY = 'afk.muted';

export async function afkMutedIds(db: Db): Promise<string[]> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  const v = row?.value as { ids?: unknown } | undefined;
  return Array.isArray(v?.ids) ? v.ids.filter((x): x is string => typeof x === 'string') : [];
}

/** 覚える（on）・忘れる（off）。同時に呼ばれても順に入れる */
export async function markAfkMuted(db: Db, memberId: string, on: boolean): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${KEY}))`);
    const [row] = await tx.select().from(settings).where(eq(settings.key, KEY)).for('update');
    const v = row?.value as { ids?: unknown } | undefined;
    const before = Array.isArray(v?.ids) ? v.ids.filter((x): x is string => typeof x === 'string') : [];
    const after = on ? (before.includes(memberId) ? before : [...before, memberId]) : before.filter((x) => x !== memberId);
    if (after.length === before.length) return;
    await tx.insert(settings).values({ key: KEY, value: { ids: after }, updatedBy: 'system' }).onConflictDoUpdate({ target: settings.key, set: { value: { ids: after }, updatedBy: 'system', updatedAt: new Date() } });
  });
}

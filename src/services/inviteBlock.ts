import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';
import { audit } from './audit.js';

/**
 * 🚫 招待リンクを作れない人。
 * 登録した人が Discord で招待を作ったら BOT がすぐ消し、/招待リンク でも出さない。
 */
const KEY = 'invite.blocked';
export type InviteBlock = { id: string; note: string; by: string; at: string };

export async function inviteBlocks(db: Db): Promise<InviteBlock[]> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  const v = row?.value as { list?: unknown } | undefined;
  return Array.isArray(v?.list) ? (v.list as InviteBlock[]).filter((x) => typeof x?.id === 'string') : [];
}

export async function isInviteBlocked(db: Db, memberId: string): Promise<boolean> {
  return (await inviteBlocks(db)).some((b) => b.id === memberId);
}

/** 足す（on）・外す（off）。同時に押されても順に入れる */
export async function setInviteBlock(db: Db, memberId: string, on: boolean, by: string, note = '', now = new Date()): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${KEY}))`);
    const before = await inviteBlocks(tx);
    const has = before.some((b) => b.id === memberId);
    if (on === has) return false;
    const list = on ? [...before, { id: memberId, note: note.slice(0, 200), by, at: now.toISOString() }] : before.filter((b) => b.id !== memberId);
    await tx.insert(settings).values({ key: KEY, value: { list }, updatedBy: by }).onConflictDoUpdate({ target: settings.key, set: { value: { list }, updatedBy: by, updatedAt: now } });
    await audit(tx, { actorId: by, targetId: memberId, action: on ? 'invite.block' : 'invite.unblock', detail: { note: note.slice(0, 200) }, via: 'web' });
    return true;
  });
}

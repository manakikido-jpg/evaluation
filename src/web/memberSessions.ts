import { createHash } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { memberSessions, type MemberSession } from '../db/schema.js';
import type { DiscordUser } from './discordApi.js';
import { randomToken } from './sessions.js';

/**
 * カジノのログイン（メンバーが Discord でログイン）。運営のログイン（admin_sessions）とは別の表・別の Cookie で、
 * こちらでログインしても運営の画面には入れない。
 */

export const MEMBER_SESSION_DAYS = 7;
/** サーバーにいるか・位のロールがあるかを確かめ直す間隔 */
export const MEMBER_RECHECK_MS = 10 * 60_000;

const hash = (token: string) => createHash('sha256').update(`member:${token}`).digest('hex');

export async function createMemberSession(db: Db, user: DiscordUser, now = new Date()): Promise<string> {
  const token = randomToken();
  await db.insert(memberSessions).values({
    id: hash(token),
    userId: user.id,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    csrfToken: randomToken(),
    checkedAt: now,
    expiresAt: new Date(now.getTime() + MEMBER_SESSION_DAYS * 86_400_000),
  });
  await db.delete(memberSessions).where(lt(memberSessions.expiresAt, now));
  return token;
}

export async function findMemberSession(db: Db, token: string, now = new Date()): Promise<MemberSession | undefined> {
  const [s] = await db.select().from(memberSessions).where(eq(memberSessions.id, hash(token)));
  if (!s || s.expiresAt <= now) return undefined;
  return s;
}

export async function markMemberChecked(db: Db, id: string, now = new Date()): Promise<void> {
  await db.update(memberSessions).set({ checkedAt: now }).where(eq(memberSessions.id, id));
}

export async function deleteMemberSession(db: Db, id: string): Promise<void> {
  await db.delete(memberSessions).where(eq(memberSessions.id, id));
}

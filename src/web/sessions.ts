import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import type { WebAccess } from '../config.js';
import type { Db } from '../db/client.js';
import { adminSessions, type AdminSession } from '../db/schema.js';
import type { DiscordUser } from './discordApi.js';

export const SESSION_HOURS = 12;
/** Discord のロールを確かめ直す間隔 */
export const RECHECK_MS = 5 * 60_000;

export const randomToken = () => randomBytes(32).toString('base64url');
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** ログイン状態を作る。返すトークンは Cookie に入れ、DB にはハッシュだけ保存する */
export async function createSession(db: Db, user: DiscordUser, access: WebAccess, now = new Date()): Promise<string> {
  const token = randomToken();
  await db.insert(adminSessions).values({
    id: hash(token),
    userId: user.id,
    username: user.displayName,
    avatarUrl: user.avatarUrl,
    level: access.level,
    pages: access.pages,
    csrfToken: randomToken(),
    checkedAt: now,
    expiresAt: new Date(now.getTime() + SESSION_HOURS * 3_600_000),
  });
  // ついでに期限切れを掃除
  await db.delete(adminSessions).where(lt(adminSessions.expiresAt, now));
  return token;
}

export async function findSession(db: Db, token: string, now = new Date()): Promise<AdminSession | undefined> {
  const [s] = await db.select().from(adminSessions).where(eq(adminSessions.id, hash(token)));
  if (!s || s.expiresAt <= now) return undefined;
  return s;
}

export async function markChecked(db: Db, id: string, access: WebAccess, now = new Date()): Promise<void> {
  await db.update(adminSessions).set({ checkedAt: now, level: access.level, pages: access.pages }).where(eq(adminSessions.id, id));
}

/** 入れる人・ページを変えたとき: 次に開いたときに全員を確かめ直す */
export async function recheckAllSessions(db: Db): Promise<void> {
  await db.update(adminSessions).set({ checkedAt: new Date(0) });
}

export async function deleteSession(db: Db, id: string): Promise<void> {
  await db.delete(adminSessions).where(eq(adminSessions.id, id));
}

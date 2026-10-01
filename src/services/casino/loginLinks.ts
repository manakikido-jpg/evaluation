import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { memberLoginLinks } from '../../db/schema.js';

/**
 * カジノにログインなしで入るリンク。/カジノ を打った本人に BOT がリンクを渡し（本人にだけ見える返事）、
 * 開いて「入る」を押すとカジノに入れる（Discord のログイン画面を通らない）。
 * 1 回きり・LINK_MINUTES 分だけ。表に置くのは印のハッシュだけ
 */

export const LINK_MINUTES = 10;
const hash = (token: string) => createHash('sha256').update(`casino-link:${token}`).digest('hex');
export const validLinkToken = (t: string) => /^[A-Za-z0-9_-]{43}$/.test(t);

export type LinkUser = { id: string; displayName: string; avatarUrl: string | null };

export async function createLoginLink(db: Db, user: LinkUser, now = new Date()): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.insert(memberLoginLinks).values({ id: hash(token), userId: user.id, displayName: user.displayName, avatarUrl: user.avatarUrl, expiresAt: new Date(now.getTime() + LINK_MINUTES * 60_000), createdAt: now });
  // 古いものは消す
  await db.delete(memberLoginLinks).where(lt(memberLoginLinks.expiresAt, new Date(now.getTime() - 86_400_000)));
  return token;
}

/** まだ使えるリンクか（見るだけ。使ったことにはしない） */
export async function peekLoginLink(db: Db, token: string, now = new Date()): Promise<LinkUser | undefined> {
  if (!validLinkToken(token)) return undefined;
  const [r] = await db
    .select()
    .from(memberLoginLinks)
    .where(and(eq(memberLoginLinks.id, hash(token)), isNull(memberLoginLinks.usedAt), gt(memberLoginLinks.expiresAt, now)));
  return r ? { id: r.userId, displayName: r.displayName, avatarUrl: r.avatarUrl } : undefined;
}

/** リンクを使う（同時に 2 回押しても 1 回だけ） */
export async function useLoginLink(db: Db, token: string, now = new Date()): Promise<LinkUser | undefined> {
  if (!validLinkToken(token)) return undefined;
  const [r] = await db
    .update(memberLoginLinks)
    .set({ usedAt: now })
    .where(and(eq(memberLoginLinks.id, hash(token)), isNull(memberLoginLinks.usedAt), gt(memberLoginLinks.expiresAt, now)))
    .returning();
  return r ? { id: r.userId, displayName: r.displayName, avatarUrl: r.avatarUrl } : undefined;
}

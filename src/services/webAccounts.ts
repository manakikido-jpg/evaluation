import { randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { and, asc, eq, ne } from 'drizzle-orm';
import { WEB_PAGE_KEYS, type WebAccess, type WebPage } from '../config.js';
import type { Db } from '../db/client.js';
import { adminSessions, webAccounts, type WebAccount } from '../db/schema.js';

/**
 * 社務所Web の ID とパスワード。宮司が発行する（最初の 1 人は VPS のコマンドで作る）。
 * パスワードは scrypt のハッシュだけを保存し、発行したときに 1 回だけ画面に出す。
 */

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const KEYLEN = 64;

/** 続けて間違えたら、しばらくログインできない */
export const LOGIN_LOCK = { tries: 5, minutes: 15 } as const;

export const LOGIN_ID_RE = /^[a-z0-9_.-]{3,32}$/;
export const normalizeLoginId = (raw: string) => raw.trim().toLowerCase();

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEYLEN);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = await scryptAsync(password, Buffer.from(salt, 'base64'), want.length);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** 読み間違えにくい文字だけで作るパスワード（0/O・1/l/I などは使わない） */
export function generatePassword(length = 14): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from({ length }, () => chars[randomInt(chars.length)]).join('');
}

export type AccountInput = { loginId: string; name: string; level: 'guji' | 'shinshoku'; pages: WebPage[] | null; memberId?: string | null };

export type CreateResult = { status: 'ok'; account: WebAccount; password: string } | { status: 'bad_id' } | { status: 'taken' } | { status: 'bad_name' };

export async function createAccount(db: Db, input: AccountInput, by: string, now = new Date()): Promise<CreateResult> {
  const loginId = normalizeLoginId(input.loginId);
  const name = input.name.trim().slice(0, 40);
  if (!LOGIN_ID_RE.test(loginId)) return { status: 'bad_id' };
  if (!name) return { status: 'bad_name' };
  const [dup] = await db.select({ id: webAccounts.id }).from(webAccounts).where(eq(webAccounts.loginId, loginId));
  if (dup) return { status: 'taken' };
  const password = generatePassword();
  const [account] = await db
    .insert(webAccounts)
    .values({ loginId, name, level: input.level, pages: cleanPages(input.level, input.pages), memberId: input.memberId ?? null, passwordHash: await hashPassword(password), createdBy: by, createdAt: now })
    .returning();
  return { status: 'ok', account: account!, password };
}

/** 宮司はいつも全部。神職は選んだページ（null は全部） */
const cleanPages = (level: 'guji' | 'shinshoku', pages: WebPage[] | null) => (level === 'guji' || !pages ? null : WEB_PAGE_KEYS.filter((k) => pages.includes(k)));

export async function listAccounts(db: Db): Promise<WebAccount[]> {
  return db.select().from(webAccounts).orderBy(asc(webAccounts.id));
}

export async function getAccount(db: Db, id: number): Promise<WebAccount | undefined> {
  const [a] = await db.select().from(webAccounts).where(eq(webAccounts.id, id));
  return a;
}

export async function accountByLoginId(db: Db, loginId: string): Promise<WebAccount | undefined> {
  const [a] = await db.select().from(webAccounts).where(eq(webAccounts.loginId, normalizeLoginId(loginId)));
  return a;
}

/** ほかに使える宮司がいるか（最後の宮司を止める・神職にする・消すのは断る） */
async function otherActiveGuji(db: Db, id: number): Promise<boolean> {
  const [other] = await db
    .select({ id: webAccounts.id })
    .from(webAccounts)
    .where(and(ne(webAccounts.id, id), eq(webAccounts.level, 'guji'), eq(webAccounts.disabled, false)))
    .limit(1);
  return Boolean(other);
}

export type ChangeResult = 'ok' | 'not_found' | 'last_guji' | 'bad_name';

export async function updateAccount(db: Db, id: number, patch: { name: string; level: 'guji' | 'shinshoku'; pages: WebPage[] | null; memberId?: string | null }): Promise<ChangeResult> {
  const a = await getAccount(db, id);
  if (!a) return 'not_found';
  const name = patch.name.trim().slice(0, 40);
  if (!name) return 'bad_name';
  if (a.level === 'guji' && patch.level !== 'guji' && !a.disabled && !(await otherActiveGuji(db, id))) return 'last_guji';
  await db
    .update(webAccounts)
    .set({ name, level: patch.level, pages: cleanPages(patch.level, patch.pages), memberId: patch.memberId ?? null })
    .where(eq(webAccounts.id, id));
  return 'ok';
}

/** パスワードを作り直す（ロックも外す）。ログイン中の分はログアウトさせる */
export async function resetPassword(db: Db, id: number): Promise<{ status: 'ok'; password: string; account: WebAccount } | { status: 'not_found' }> {
  const a = await getAccount(db, id);
  if (!a) return { status: 'not_found' };
  const password = generatePassword();
  await db.update(webAccounts).set({ passwordHash: await hashPassword(password), failedCount: 0, lockedUntil: null }).where(eq(webAccounts.id, id));
  await db.delete(adminSessions).where(eq(adminSessions.accountId, id));
  return { status: 'ok', password, account: a };
}

/** 止める・戻す。止めたらログイン中の分もログアウトさせる */
export async function setDisabled(db: Db, id: number, disabled: boolean): Promise<ChangeResult> {
  const a = await getAccount(db, id);
  if (!a) return 'not_found';
  if (disabled && a.level === 'guji' && !(await otherActiveGuji(db, id))) return 'last_guji';
  await db.update(webAccounts).set({ disabled, ...(disabled ? {} : { failedCount: 0, lockedUntil: null }) }).where(eq(webAccounts.id, id));
  if (disabled) await db.delete(adminSessions).where(eq(adminSessions.accountId, id));
  return 'ok';
}

export async function deleteAccount(db: Db, id: number): Promise<ChangeResult> {
  const a = await getAccount(db, id);
  if (!a) return 'not_found';
  if (a.level === 'guji' && !a.disabled && !(await otherActiveGuji(db, id))) return 'last_guji';
  await db.delete(adminSessions).where(eq(adminSessions.accountId, id));
  await db.delete(webAccounts).where(eq(webAccounts.id, id));
  return 'ok';
}

export type LoginResult = { status: 'ok'; account: WebAccount } | { status: 'wrong' | 'disabled' } | { status: 'locked'; until: Date };

/** ID とパスワードを確かめる。続けて間違えると LOGIN_LOCK の分だけ止める（ない ID でも同じくらい時間をかける） */
export async function checkLogin(db: Db, loginId: string, password: string, now = new Date()): Promise<LoginResult> {
  const a = await accountByLoginId(db, loginId);
  if (!a) {
    await verifyPassword(password, `scrypt$${randomBytes(16).toString('base64')}$${randomBytes(KEYLEN).toString('base64')}`);
    return { status: 'wrong' };
  }
  if (a.lockedUntil && a.lockedUntil > now) return { status: 'locked', until: a.lockedUntil };
  const ok = await verifyPassword(password, a.passwordHash);
  if (!ok) {
    const failed = a.failedCount + 1;
    const lock = failed >= LOGIN_LOCK.tries;
    const until = new Date(now.getTime() + LOGIN_LOCK.minutes * 60_000);
    await db
      .update(webAccounts)
      .set({ failedCount: lock ? 0 : failed, lockedUntil: lock ? until : a.lockedUntil })
      .where(eq(webAccounts.id, a.id));
    return lock ? { status: 'locked', until } : { status: 'wrong' };
  }
  if (a.disabled) return { status: 'disabled' };
  await db.update(webAccounts).set({ failedCount: 0, lockedUntil: null, lastLoginAt: now }).where(eq(webAccounts.id, a.id));
  return { status: 'ok', account: a };
}

/** アカウントで入れるページ（止めていれば undefined） */
export function accountAccess(a: Pick<WebAccount, 'level' | 'pages' | 'disabled'>): WebAccess | undefined {
  if (a.disabled) return undefined;
  if (a.level === 'guji') return { level: 'guji', pages: null };
  return { level: 'shinshoku', pages: (a.pages as WebPage[] | null) ?? null };
}

/** セッションの userId（Discord の人を結びつけていればその ID、なければ acct:番号） */
export const accountUserId = (a: Pick<WebAccount, 'id' | 'memberId'>) => a.memberId ?? `acct:${a.id}`;

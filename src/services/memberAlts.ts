import { createHash, randomInt } from 'node:crypto';
import { and, desc, eq, gt, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { memberAltCodes, memberAlts, memberAltTries, settings, wallets } from '../db/schema.js';
import { audit } from './audit.js';
import { addCoins, spendWithin } from './economy.js';
import { isStaffAlt } from './staffAlts.js';

/**
 * 🔗 メンバーのサブアカウント。
 * - サブアカウントは、申告して運営が承認すれば使ってよい（申告しないサブはルール違反）
 * - 申告は、サブの人が Discord の /サブ垢 申告 で本アカウントを選ぶ。運営が社務所Web で承認・却下する（運営が直接登録もできる）
 * - 承認したサブは、銭が入らず、朱印を押せず・押されず、招待の記録とお礼に入らない（二重に稼げないように）
 * - 承認したとき、サブが持っていた銭は本アカウントへ移す（本アカウント側が申告したものは、移さない）
 * - 申告は、サブ側（/サブ垢 申告・パネル）でも、本アカウント側（/サブ垢 本アカから申告・パネル）でもできる
 */
export type MemberAlt = typeof memberAlts.$inferSelect;
const ID = /^\d{17,20}$/;

export async function listMemberAlts(db: Db): Promise<MemberAlt[]> {
  return db.select().from(memberAlts).orderBy(desc(memberAlts.createdAt));
}
export async function memberAltOf(db: Db, altId: string): Promise<MemberAlt | undefined> {
  const [row] = await db.select().from(memberAlts).where(eq(memberAlts.altId, altId));
  return row;
}
/** その人の承認ずみ・申告中のサブ */
export async function altsOfMain(db: Db, mainId: string): Promise<MemberAlt[]> {
  return db.select().from(memberAlts).where(eq(memberAlts.mainId, mainId)).orderBy(desc(memberAlts.createdAt));
}

export type AltRequestResult = 'ok' | 'invalid' | 'self' | 'exists' | 'main_is_alt' | 'alt_has_alts' | 'staff_alt';

/** 申告する（申告中にする）。via: discord = 本人の申告、web = 運営が入れた */
export async function requestMemberAlt(db: Db, input: { altId: string; mainId: string; note?: string; reason?: string; by: string; via?: 'discord' | 'web'; verified?: boolean }): Promise<AltRequestResult> {
  const { altId, mainId } = input;
  if (!ID.test(altId) || !ID.test(mainId)) return 'invalid';
  if (altId === mainId) return 'self';
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('member_alts'))`);
    if (await memberAltOf(tx, altId)) return 'exists';
    // 本アカウントがだれかのサブなら、紐づけない（サブのサブは作らない）
    if (await memberAltOf(tx, mainId)) return 'main_is_alt';
    // サブにする人に、もうサブがいれば紐づけない
    if ((await altsOfMain(tx, altId)).length) return 'alt_has_alts';
    if ((await isStaffAlt(tx, altId)) || (await isStaffAlt(tx, mainId))) return 'staff_alt';
    await tx.insert(memberAlts).values({ altId, mainId, note: (input.note ?? '').slice(0, 200), requestedBy: input.by, verified: input.verified ?? false, reason: (input.reason ?? '').trim().slice(0, 300) });
    await audit(tx, { actorId: input.by, targetId: altId, action: 'member_alt.request', detail: { mainId, reason: (input.reason ?? '').trim().slice(0, 300) }, via: input.via ?? 'discord' });
    return 'ok';
  });
}

/** 承認する。サブの銭は本アカウントへ移す（同じトランザクションで） */
export async function approveMemberAlt(db: Db, altId: string, by: string, now = new Date(), via: 'web' | 'discord' = 'web'): Promise<{ status: 'ok'; moved: number; kept: boolean } | { status: 'not_found' | 'done' }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('member_alts'))`);
    const row = await memberAltOf(tx, altId);
    if (!row) return { status: 'not_found' as const };
    if (row.status === 'approved') return { status: 'done' as const };
    // 本アカウント側が申告したものは、サブの銭を移さない（他人のアカウントを「自分のサブ」と申告して、銭を取れないように）
    const kept = row.requestedBy === row.mainId && !row.verified;
    const [w] = await tx.select().from(wallets).where(eq(wallets.memberId, altId)).for('update');
    const moved = kept ? 0 : Math.max(0, w?.balance ?? 0);
    // 先に銭を移してから承認にする（承認のあとはサブに銭が入らないため）
    if (moved > 0) {
      if (!(await spendWithin(tx, altId, moved, 'adjust', { kind: 'member_alt', to: row.mainId, by }))) throw new Error('alt wallet move failed');
      await addCoins(tx, row.mainId, moved, 'adjust', { kind: 'member_alt', from: altId, by });
    }
    await tx.update(memberAlts).set({ status: 'approved', decidedBy: by, decidedAt: now }).where(and(eq(memberAlts.altId, altId), eq(memberAlts.status, 'pending')));
    await audit(tx, { actorId: by, targetId: altId, action: 'member_alt.approve', detail: { mainId: row.mainId, moved, verified: row.verified }, via });
    return { status: 'ok' as const, moved, kept };
  });
}

/** 却下する（申告中）・外す（承認ずみ）。記録は消して、監査記録に残す */
export async function removeMemberAlt(db: Db, altId: string, by: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const row = await memberAltOf(tx, altId);
    if (!row) return false;
    await tx.delete(memberAlts).where(eq(memberAlts.altId, altId));
    await audit(tx, { actorId: by, targetId: altId, action: row.status === 'approved' ? 'member_alt.remove' : 'member_alt.reject', detail: { mainId: row.mainId }, via: 'web' });
    return true;
  });
}

// ───────── 🔑 合言葉でつなぐ ─────────

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const ALT_CODE_LENGTH = 6;
export const ALT_CODE_TTL_MS = 10 * 60_000;
const MAX_FAILS = 5;
const FAIL_WINDOW_MS = 10 * 60_000;
const CFG_KEY = 'member_alts.config';

const hashCode = (code: string) => createHash('sha256').update(code).digest('hex');
/** 大文字にして、数字と英字だけにする（空白・「-」は無視） */
export const normalizeAltCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, '');

export type AltConfig = { requireApproval: boolean; joinRoleIds: string[] };
/** 設定（合言葉のあと運営の承認を待つか・申請ずみのサブが入ったときに付けるロール） */
export async function altConfig(db: Db): Promise<AltConfig> {
  const [row] = await db.select().from(settings).where(eq(settings.key, CFG_KEY));
  const v = (row?.value ?? {}) as { requireApproval?: unknown; joinRoleIds?: unknown };
  const ids = Array.isArray(v.joinRoleIds) ? v.joinRoleIds.filter((x): x is string => typeof x === 'string' && ID.test(x)) : [];
  return { requireApproval: v.requireApproval === true, joinRoleIds: ids.slice(0, 5) };
}
/** 合言葉が合ったあと、運営の承認を待つか（はじめは待たずに、その場でつなぐ） */
export async function altRequireApproval(db: Db): Promise<boolean> {
  return (await altConfig(db)).requireApproval;
}
export async function saveAltConfig(db: Db, patch: Partial<AltConfig>, by: string): Promise<void> {
  const value = { ...(await altConfig(db)), ...patch, joinRoleIds: (patch.joinRoleIds ?? (await altConfig(db)).joinRoleIds).slice(0, 5) };
  await db.insert(settings).values({ key: CFG_KEY, value, updatedBy: by }).onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: by, updatedAt: new Date() } });
  await audit(db, { actorId: by, action: 'member_alt.config', detail: value, via: 'web' });
}
export const setAltRequireApproval = (db: Db, on: boolean, by: string) => saveAltConfig(db, { requireApproval: on }, by);

/** 承認ずみのサブが入ったときに、自動で付けるロール（なければ undefined。そのときは、ふつうの入り方になる） */
export async function subJoinPlan(db: Db, altId: string): Promise<{ mainId: string; roleIds: string[] } | undefined> {
  const row = await memberAltOf(db, altId);
  if (!row || row.status !== 'approved') return undefined;
  const { joinRoleIds } = await altConfig(db);
  return joinRoleIds.length ? { mainId: row.mainId, roleIds: joinRoleIds } : undefined;
}

/** 本アカウントが合言葉をもらう（前の合言葉は使えなくなる） */
export async function issueAltCode(db: Db, mainId: string, now = new Date()): Promise<{ status: 'ok'; code: string; expiresAt: Date } | { status: 'invalid' | 'main_is_alt' | 'staff_alt' }> {
  if (!ID.test(mainId)) return { status: 'invalid' };
  // サブのアカウントは、合言葉を出せない（サブのサブは作らない）
  if (await memberAltOf(db, mainId)) return { status: 'main_is_alt' };
  if (await isStaffAlt(db, mainId)) return { status: 'staff_alt' };
  const code = Array.from({ length: ALT_CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  const expiresAt = new Date(now.getTime() + ALT_CODE_TTL_MS);
  await db.transaction(async (tx) => {
    await tx.delete(memberAltCodes).where(lt(memberAltCodes.expiresAt, now));
    await tx.delete(memberAltCodes).where(eq(memberAltCodes.mainId, mainId));
    await tx.insert(memberAltCodes).values({ mainId, codeHash: hashCode(code), expiresAt });
  });
  return { status: 'ok', code, expiresAt };
}

export type RedeemResult =
  | { status: 'linked'; mainId: string; moved: number }
  | { status: 'pending'; mainId: string }
  | { status: 'invalid_code' | 'locked' | 'invalid' | 'self' | 'exists' | 'main_is_alt' | 'alt_has_alts' | 'staff_alt' };

class RedeemAbort extends Error {
  constructor(readonly result: RedeemResult) { super('redeem aborted'); }
}

/**
 * サブのアカウントが合言葉を入れる。合えば、本アカウントのサブとしてつなぐ（両方の操作を確かめたので、
 * 運営の承認なしでつなぎ、サブの銭は本アカウントへ移す。設定で「運営の承認を待つ」にもできる）。
 * 合言葉は 1 回だけ。続けて 5 回まちがえると 10 分は入れられない
 */
export async function redeemAltCode(db: Db, altId: string, rawCode: string, now = new Date()): Promise<RedeemResult> {
  if (!ID.test(altId)) return { status: 'invalid' };
  const [t] = await db.select().from(memberAltTries).where(eq(memberAltTries.memberId, altId));
  if (t && now.getTime() - t.since.getTime() < FAIL_WINDOW_MS && t.fails >= MAX_FAILS) return { status: 'locked' };
  const code = normalizeAltCode(rawCode);
  try {
    const result = await db.transaction(async (tx) => {
      // 合言葉を取りだす（同時に入れても、使えるのは 1 人だけ）
      const [claimed] = code.length === ALT_CODE_LENGTH
        ? await tx.delete(memberAltCodes).where(and(eq(memberAltCodes.codeHash, hashCode(code)), gt(memberAltCodes.expiresAt, now))).returning()
        : [];
      if (!claimed) throw new RedeemAbort({ status: 'invalid_code' });
      // つなげないときは、全部もどす（合言葉も使わなかったことにする）
      const r = await requestMemberAlt(tx, { altId, mainId: claimed.mainId, by: altId, via: 'discord', verified: true, note: '合言葉で確認' });
      if (r !== 'ok') throw new RedeemAbort({ status: r });
      if (await altRequireApproval(tx)) return { status: 'pending' as const, mainId: claimed.mainId };
      const a = await approveMemberAlt(tx, altId, altId, now, 'discord');
      return { status: 'linked' as const, mainId: claimed.mainId, moved: a.status === 'ok' ? a.moved : 0 };
    });
    await db.delete(memberAltTries).where(eq(memberAltTries.memberId, altId));
    return result;
  } catch (e) {
    if (!(e instanceof RedeemAbort)) throw e;
    if (e.result.status === 'invalid_code') {
      const fresh = t && now.getTime() - t.since.getTime() < FAIL_WINDOW_MS;
      await db.insert(memberAltTries).values({ memberId: altId, fails: 1, since: now })
        .onConflictDoUpdate({ target: memberAltTries.memberId, set: fresh ? { fails: sql`${memberAltTries.fails} + 1` } : { fails: 1, since: now } });
    }
    return e.result;
  }
}


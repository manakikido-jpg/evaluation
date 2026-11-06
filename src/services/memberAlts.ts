import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { memberAlts, wallets } from '../db/schema.js';
import { audit } from './audit.js';
import { addCoins, spendWithin } from './economy.js';
import { isStaffAlt } from './staffAlts.js';

/**
 * 🔗 メンバーのサブアカウント。
 * - サブアカウントは、申告して運営が承認すれば使ってよい（申告しないサブはルール違反）
 * - 申告は、サブの人が Discord の /サブ垢 申告 で本アカウントを選ぶ。運営が社務所Web で承認・却下する（運営が直接登録もできる）
 * - 承認したサブは、銭が入らず、朱印を押せず・押されず、招待の記録とお礼に入らない（二重に稼げないように）
 * - 承認したとき、サブが持っていた銭は本アカウントへ移す
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
export async function requestMemberAlt(db: Db, input: { altId: string; mainId: string; note?: string; by: string; via?: 'discord' | 'web' }): Promise<AltRequestResult> {
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
    await tx.insert(memberAlts).values({ altId, mainId, note: (input.note ?? '').slice(0, 200), requestedBy: input.by });
    await audit(tx, { actorId: input.by, targetId: altId, action: 'member_alt.request', detail: { mainId }, via: input.via ?? 'discord' });
    return 'ok';
  });
}

/** 承認する。サブの銭は本アカウントへ移す（同じトランザクションで） */
export async function approveMemberAlt(db: Db, altId: string, by: string, now = new Date()): Promise<{ status: 'ok'; moved: number } | { status: 'not_found' | 'done' }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('member_alts'))`);
    const row = await memberAltOf(tx, altId);
    if (!row) return { status: 'not_found' as const };
    if (row.status === 'approved') return { status: 'done' as const };
    const [w] = await tx.select().from(wallets).where(eq(wallets.memberId, altId)).for('update');
    const moved = Math.max(0, w?.balance ?? 0);
    // 先に銭を移してから承認にする（承認のあとはサブに銭が入らないため）
    if (moved > 0) {
      if (!(await spendWithin(tx, altId, moved, 'adjust', { kind: 'member_alt', to: row.mainId, by }))) throw new Error('alt wallet move failed');
      await addCoins(tx, row.mainId, moved, 'adjust', { kind: 'member_alt', from: altId, by });
    }
    await tx.update(memberAlts).set({ status: 'approved', decidedBy: by, decidedAt: now }).where(and(eq(memberAlts.altId, altId), eq(memberAlts.status, 'pending')));
    await audit(tx, { actorId: by, targetId: altId, action: 'member_alt.approve', detail: { mainId: row.mainId, moved }, via: 'web' });
    return { status: 'ok' as const, moved };
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

import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { settings, wallets } from '../db/schema.js';
import { audit } from './audit.js';
import { spendWithin } from './economy.js';

/**
 * 🕶 運営のサブアカウント（見え方の確認・BOT やカジノを試す・名前を出さずに見回る）。
 * - 銭を持たない（入ってくる銭は入れない。登録したとき残っていた銭は 0 にする）
 * - 朱印を押せない・押されない、招待の記録やお礼に入れない
 * - 社務所Web には入れない
 * - メンバーから分からないように、ロールなどの目印は付けない（BOT の記録だけで見分ける）
 */
const KEY = 'staff.alts';
export type StaffAlt = { id: string; ownerId: string; note: string; by: string; at: string };

export async function staffAlts(db: Db): Promise<StaffAlt[]> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  const v = row?.value as { list?: unknown } | undefined;
  return Array.isArray(v?.list) ? (v.list as StaffAlt[]).filter((a) => typeof a?.id === 'string') : [];
}

export async function isStaffAlt(db: Db, memberId: string): Promise<boolean> {
  return (await staffAlts(db)).some((a) => a.id === memberId);
}

/** 登録する（on）・外す（off）。登録したときは、持っている銭を 0 にする */
export async function setStaffAlt(db: Db, memberId: string, on: boolean, by: string, ownerId = '', note = '', now = new Date()): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${KEY}))`);
    const before = await staffAlts(tx);
    const has = before.some((a) => a.id === memberId);
    if (on === has) return false;
    const list = on ? [...before, { id: memberId, ownerId, note: note.slice(0, 200), by, at: now.toISOString() }] : before.filter((a) => a.id !== memberId);
    await tx.insert(settings).values({ key: KEY, value: { list }, updatedBy: by }).onConflictDoUpdate({ target: settings.key, set: { value: { list }, updatedBy: by, updatedAt: now } });
    let cleared = 0;
    if (on) {
      const [w] = await tx.select().from(wallets).where(eq(wallets.memberId, memberId)).for('update');
      cleared = w?.balance ?? 0;
      if (cleared && !(await spendWithin(tx, memberId, cleared, 'adjust', { kind: 'staff_alt', by }))) throw new Error('staff alt wallet clear failed');
    }
    await audit(tx, { actorId: by, targetId: memberId, action: on ? 'staff_alt.add' : 'staff_alt.remove', detail: { ownerId, note: note.slice(0, 200), cleared }, via: 'web' });
    return true;
  });
}

import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { keibaHorses, keibaShares, members } from '../../db/schema.js';
import { addCoins, spendWithin } from '../economy.js';

/**
 * 🤝 共同所有（一口馬主）。馬は 10 口。馬主が 1 口の値段を決めて売りに出し、ほかの人が 1 口ずつ買う。
 * - 1 口の値段は「馬の値段 ÷ 10」の 1〜3 倍。元の馬主は 1 口以上残す
 * - 賞金・功労金・ロイヤリティは口の数で分ける（端数は馬主）
 * - 調教・出走・引退を決める馬主（owner_id）は、いちばん多く口を持つ人（同じなら今の馬主のまま）
 * - 口の売り直しはできない。馬を売れるのは、口を 1 人で持っているときだけ
 */

export const KB_SHARE_UNITS = 10;
export const KB_SHARE_MULT_MAX = 3;

export type Holder = { memberId: string; units: number };

export const sharePriceRange = (horsePrice: number): [number, number] => {
  const unit = Math.max(1, Math.floor(horsePrice / KB_SHARE_UNITS));
  return [unit, unit * KB_SHARE_MULT_MAX];
};

/** 口を持つ人（行がなければ馬主が 10 口） */
export async function holdersOf(db: Db, horseId: number, ownerId: string | null): Promise<Holder[]> {
  const rows = await db.select({ memberId: keibaShares.memberId, units: keibaShares.units }).from(keibaShares).where(eq(keibaShares.horseId, horseId));
  if (rows.length) return rows.sort((a, b) => b.units - a.units || (a.memberId === ownerId ? -1 : b.memberId === ownerId ? 1 : 0));
  return ownerId ? [{ memberId: ownerId, units: KB_SHARE_UNITS }] : [];
}

/** 口の数で分ける（端数は馬主へ） */
export function splitByShares(holders: readonly Holder[], amount: number, ownerId: string): { memberId: string; amount: number }[] {
  if (amount <= 0) return [];
  const total = holders.reduce((n, h) => n + h.units, 0);
  if (!total || holders.length <= 1) return [{ memberId: holders[0]?.memberId ?? ownerId, amount }];
  const out = holders.map((h) => ({ memberId: h.memberId, amount: Math.floor((amount * h.units) / total) }));
  const rest = amount - out.reduce((n, x) => n + x.amount, 0);
  const owner = out.find((x) => x.memberId === ownerId) ?? out[0]!;
  owner.amount += rest;
  return out.filter((x) => x.amount > 0);
}

/** 共同所有の馬だけ（馬 → 口を持つ人） */
export async function sharesOf(db: Db, horseIds: readonly number[]): Promise<Map<number, Holder[]>> {
  const m = new Map<number, Holder[]>();
  if (!horseIds.length) return m;
  const rows = await db.select().from(keibaShares).where(inArray(keibaShares.horseId, [...horseIds]));
  for (const r of rows) m.set(r.horseId, [...(m.get(r.horseId) ?? []), { memberId: r.memberId, units: r.units }]);
  for (const [k, v] of m) if (v.length <= 1) m.delete(k);
  return m;
}

/** 銭を口の数で渡す（tx の中で） */
export async function payByShares(tx: Db, horseId: number, ownerId: string, amount: number, reason: 'keiba_prize', detail: Record<string, unknown>): Promise<void> {
  for (const x of splitByShares(await holdersOf(tx, horseId, ownerId), amount, ownerId)) await addCoins(tx, x.memberId, x.amount, reason, detail);
}

/** 一口の募集を出す・やめる（price = null） */
export async function offerShares(db: Db, memberId: string, horseId: number, price: number | null, horsePrice: number): Promise<'ok' | 'not_found' | 'invalid'> {
  const [lo, hi] = sharePriceRange(horsePrice);
  if (price !== null && !(Number.isInteger(price) && price >= lo && price <= hi)) return 'invalid';
  return db.transaction(async (tx) => {
    const [h] = await tx.select().from(keibaHorses).where(and(eq(keibaHorses.id, horseId), eq(keibaHorses.ownerId, memberId), isNull(keibaHorses.retiredAt))).for('update');
    if (!h) return 'not_found' as const;
    if (price !== null) {
      const [any] = await tx.select({ m: keibaShares.memberId }).from(keibaShares).where(eq(keibaShares.horseId, horseId)).limit(1);
      if (!any) await tx.insert(keibaShares).values({ horseId, memberId, units: KB_SHARE_UNITS });
    }
    await tx.update(keibaHorses).set({ sharePrice: price, ...(price !== null ? { salePrice: null } : {}) }).where(eq(keibaHorses.id, horseId));
    return 'ok' as const;
  });
}

export type ShareBuy = 'ok' | 'not_found' | 'self' | 'sold_out' | 'poor';

/** 一口買う（今の馬主の口から 1 口。馬主は 1 口以上残す） */
export async function buyShare(db: Db, buyerId: string, horseId: number): Promise<ShareBuy> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'keiba_share:' + horseId}))`);
    const [h] = await tx.select().from(keibaHorses).where(and(eq(keibaHorses.id, horseId), isNotNull(keibaHorses.sharePrice), isNull(keibaHorses.retiredAt))).for('update');
    if (!h || !h.ownerId) return 'not_found' as const;
    if (h.ownerId === buyerId) return 'self' as const;
    const holders = await holdersOf(tx, horseId, h.ownerId);
    const seller = holders.find((x) => x.memberId === h.ownerId);
    if (!seller || seller.units <= 1) return 'sold_out' as const;
    const price = h.sharePrice!;
    if (!(await spendWithin(tx, buyerId, price, 'keiba_trade', { share: horseId, name: h.name }))) return 'poor' as const;
    await addCoins(tx, h.ownerId, price, 'keiba_trade', { share: horseId, name: h.name, by: buyerId });
    await tx.update(keibaShares).set({ units: seller.units - 1 }).where(and(eq(keibaShares.horseId, horseId), eq(keibaShares.memberId, h.ownerId)));
    await tx
      .insert(keibaShares)
      .values({ horseId, memberId: buyerId, units: 1 })
      .onConflictDoUpdate({ target: [keibaShares.horseId, keibaShares.memberId], set: { units: sql`${keibaShares.units} + 1` } });
    // いちばん多く持つ人が馬主（同じなら今の馬主のまま）
    const after = await holdersOf(tx, horseId, h.ownerId);
    const top = after[0]!;
    const mine = after.find((x) => x.memberId === h.ownerId)!.units;
    if (top.memberId !== h.ownerId && top.units > mine) await tx.update(keibaHorses).set({ ownerId: top.memberId, sharePrice: null }).where(eq(keibaHorses.id, horseId));
    // 売り切れたら募集を閉じる
    else if (mine <= 1) await tx.update(keibaHorses).set({ sharePrice: null }).where(eq(keibaHorses.id, horseId));
    return 'ok' as const;
  });
}

/** 口を持っているか（馬を 1 人で持っていないと売れない） */
export async function hasCoOwners(db: Db, horseId: number): Promise<boolean> {
  return (await sharesOf(db, [horseId])).has(horseId);
}

/** 一口を募集している馬 */
export async function shareOffers(db: Db) {
  const rows = await db
    .select({ h: keibaHorses, ownerName: members.displayName })
    .from(keibaHorses)
    .leftJoin(members, eq(members.id, keibaHorses.ownerId))
    .where(and(isNotNull(keibaHorses.sharePrice), isNull(keibaHorses.retiredAt)));
  const shares = await sharesOf(db, rows.map((r) => r.h.id));
  return rows.map((r) => {
    const holders = shares.get(r.h.id) ?? [{ memberId: r.h.ownerId ?? '', units: KB_SHARE_UNITS }];
    return { ...r.h, ownerName: r.ownerName, left: (holders.find((x) => x.memberId === r.h.ownerId)?.units ?? 1) - 1, holders: holders.length };
  });
}

/** 自分が口を持っている（馬主ではない）馬 */
export async function mySharedHorses(db: Db, memberId: string) {
  const rows = await db
    .select({ h: keibaHorses, units: keibaShares.units, ownerName: members.displayName })
    .from(keibaShares)
    .innerJoin(keibaHorses, eq(keibaHorses.id, keibaShares.horseId))
    .leftJoin(members, eq(members.id, keibaHorses.ownerId))
    .where(eq(keibaShares.memberId, memberId));
  return rows.filter((r) => r.h.ownerId !== memberId).map((r) => ({ id: r.h.id, name: r.h.name, units: r.units, ownerName: r.ownerName, starts: r.h.starts, wins: r.h.wins, prize: r.h.prize, retired: r.h.retiredAt !== null }));
}

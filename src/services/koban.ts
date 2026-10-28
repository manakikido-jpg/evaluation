import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { kobanPurchases, members, shopItems, shopPurchases, wallets } from '../db/schema.js';
import { KOBAN_VALUES, kobanPrice, kobanValue } from '../domain/koban.js';
import { addCoins, spendWithin, walletOf } from './economy.js';
import { audit } from './audit.js';
export class KobanError extends Error {}
const validId = (id: string) => z.string().uuid().safeParse(id).success;
async function activeMember(db: Db, id: string) {
  const [member] = await db.select().from(members).where(eq(members.id, id));
  if (!member || member.leftAt || member.isBot) throw new KobanError('在籍中のメンバーを確認できません。');
  return member;
}
/** 同じ購入確認番号は一度だけ。購入と額面分の預かり・手数料・持ち物を原子的に保存する。staff: 運営は手数料なし（額面だけ払う） */
export async function buyKoban(db: Db, memberId: string, itemId: number, nonce: string, now = new Date(), staff = false) {
  if (!validId(nonce)) throw new KobanError('購入画面を開き直してください。');
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'shop:' + memberId}))`);
    const [existing] = await tx.select().from(kobanPurchases).where(eq(kobanPurchases.id, nonce));
    if (existing) {
      const [purchase] = await tx.select().from(shopPurchases).where(eq(shopPurchases.id, existing.purchaseId));
      if (existing.memberId !== memberId || purchase?.itemId !== itemId) throw new KobanError('この購入確認は使えません。');
      return { receipt: existing, balance: (await walletOf(tx, memberId)).balance, repeated: true };
    }
    await activeMember(tx, memberId);
    const [item] = await tx.select().from(shopItems).where(eq(shopItems.id, itemId)).for('update');
    const value = item && kobanValue(item.kind);
    if (!item?.enabled || value === undefined) throw new KobanError('この小判は販売していません。');
    const price = staff ? value : kobanPrice(value), fee = price - value;
    const [wallet] = await tx.select().from(wallets).where(eq(wallets.memberId, memberId)).for('update');
    if (!wallet || wallet.balance < price) throw new KobanError(`銭が足りません（${price.toLocaleString('ja-JP')}銭必要）。`);
    if (!(await spendWithin(tx, memberId, value, 'koban_buy', { kobanId: nonce, itemId, faceValue: value }))) throw new Error('koban principal payment failed');
    if (fee > 0 && !(await spendWithin(tx, memberId, fee, 'koban_fee', { kobanId: nonce, itemId, faceValue: value }))) throw new Error('koban fee payment failed');
    const [purchase] = await tx.insert(shopPurchases).values({ memberId, itemId, kind: item.kind, price, createdAt: now }).returning();
    const [receipt] = await tx.insert(kobanPurchases).values({ id: nonce, purchaseId: purchase!.id, memberId, faceValue: value, price, fee, createdAt: now }).returning();
    await audit(tx, { actorId: memberId, action: 'koban.buy', detail: { kobanId: nonce, faceValue: value, price, fee, ...(staff ? { staff: true } : {}) }, via: 'discord' });
    return { receipt: receipt!, balance: wallet.balance - price, repeated: false };
  });
}
export const heldKoban = (db: Db, memberId: string) => db.select().from(kobanPurchases).where(and(eq(kobanPurchases.memberId, memberId), isNull(kobanPurchases.sentAt))).orderBy(asc(kobanPurchases.createdAt), asc(kobanPurchases.id));
export async function ownedKoban(db: Db, memberId: string, id: string) {
  const [row] = await db.select().from(kobanPurchases).where(and(eq(kobanPurchases.id, id), eq(kobanPurchases.memberId, memberId), isNull(kobanPurchases.sentAt)));
  return row;
}
/** 送ると1枚を使い切り、受取人には額面だけが入る。追加の手数料はない。 */
export async function sendKoban(db: Db, memberId: string, id: string, targetId: string, now = new Date()) {
  if (!/^\d{17,20}$/.test(targetId) || memberId === targetId) throw new KobanError('自分以外のサーバーメンバーを選んでください。');
  return db.transaction(async tx => {
    await activeMember(tx, memberId); await activeMember(tx, targetId);
    const [receipt] = await tx.update(kobanPurchases).set({ targetId, sentAt: now }).where(and(eq(kobanPurchases.id, id), eq(kobanPurchases.memberId, memberId), isNull(kobanPurchases.sentAt))).returning();
    if (!receipt) throw new KobanError('この小判は送付済みか、持っていません。');
    const balance = await addCoins(tx, targetId, receipt.faceValue, 'koban_redeem', { kobanId: id, from: memberId });
    await tx.update(shopPurchases).set({ targetId, endedAt: now }).where(eq(shopPurchases.id, receipt.purchaseId));
    await audit(tx, { actorId: memberId, targetId, action: 'koban.send', detail: { kobanId: id, faceValue: receipt.faceValue }, via: 'discord' });
    return { value: receipt.faceValue, balance };
  });
}
/** 累計。未送付の額面は手数料収益と分けて表示する。 */
export async function kobanStats(db: Db) {
  const rows = await db.select({ value: kobanPurchases.faceValue, count: sql<number>`count(*)::int`, sales: sql<number>`coalesce(sum(${kobanPurchases.price}),0)::float8`, fee: sql<number>`coalesce(sum(${kobanPurchases.fee}),0)::float8`, sent: sql<number>`count(${kobanPurchases.sentAt})::int` }).from(kobanPurchases).groupBy(kobanPurchases.faceValue);
  return KOBAN_VALUES.map(value => {
    const row = rows.find(r => r.value === value);
    return { value, count: row?.count ?? 0, sales: row?.sales ?? 0, fee: row?.fee ?? 0, sent: row?.sent ?? 0, pending: (row?.count ?? 0) - (row?.sent ?? 0) };
  });
}
export type KobanStats = Awaited<ReturnType<typeof kobanStats>>;

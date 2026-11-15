import { and, eq, sql } from 'drizzle-orm';
import { adminLevelOf, type GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { coinTx, directTransfers, members, wallets, type DirectTransfer } from '../db/schema.js';
import { giftBlockedRank } from '../domain/ranks.js';
import { addCoins, spendWithin, walletOf } from './economy.js';
import { giftDailyLimitOf, giftIsStaff, giftSentToday } from './shop.js';
import { isRestrictedAccount } from './staffAlts.js';
import { audit } from './audit.js';

export const TRANSFER_FEE_PERCENT = 50;
export const MAX_TRANSFER_AMOUNT = 1_000_000_000;
const MAX_INT = 2_147_483_647;
const idOk = (id: string) => /^\d{17,20}$/.test(id);
export class TransferError extends Error {}
export const transferIsStaff = (cfg: GuildConfig, roles: readonly string[]) => giftIsStaff(cfg, roles) || Boolean(adminLevelOf(cfg, roles));
export type TransferMember = { id: string; roleIds: readonly string[]; bot?: boolean };
/** 相手に入る額の50％を上乗せ。1銭未満は切り上げる。運営は既存の手数料免除を使う。 */
export function transferQuote(amount: number, free = false) {
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_TRANSFER_AMOUNT) throw new TransferError('送る額を正しい整数で入れてください。');
  const fee = free ? 0 : Math.ceil(amount / 2);
  return { amount, fee, total: amount + fee };
}
const lock = (tx: Db, key: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
async function checkMembers(tx: Db, cfg: GuildConfig, from: TransferMember, to: TransferMember) {
  if (!idOk(from.id) || !idOk(to.id) || from.id === to.id) throw new TransferError('自分以外のサーバーメンバーを選んでください。');
  if (from.bot || to.bot || !(cfg.ranks.some(r => to.roleIds.includes(r.roleId)) || transferIsStaff(cfg, to.roleIds))) throw new TransferError('BOTや入鯖が承認されていない人には送れません。');
  const need = transferIsStaff(cfg, from.roleIds) ? undefined : giftBlockedRank(cfg.ranks, from.roleIds);
  if (need) throw new TransferError(`送金は「${need.name}」以上になるとできます。`);
  for (const who of [from, to]) {
    const [m] = await tx.select().from(members).where(eq(members.id, who.id));
    if (!m || m.leftAt || m.isBot) throw new TransferError('在籍中のメンバーを確認できません。');
    if (await isRestrictedAccount(tx, who.id)) throw new TransferError('サブアカウントからも、サブアカウントへも送金できません。');
  }
}
async function checkPayment(tx: Db, cfg: GuildConfig, from: TransferMember, to: TransferMember, amount: number, now: Date) {
  const e = cfg.economy, staff = transferIsStaff(cfg, from.roleIds), quote = transferQuote(amount, staff);
  if (amount < e.giftMin || (!staff && amount > e.giftMax)) throw new TransferError(`1回に送れるのは${e.giftMin.toLocaleString('ja-JP')}〜${e.giftMax.toLocaleString('ja-JP')}銭です。`);
  if (!staff) {
    const left = Math.max(0, giftDailyLimitOf(cfg, from.roleIds) - await giftSentToday(tx, from.id, now));
    if (amount > left) throw new TransferError(`今日送れるのは、あと${left.toLocaleString('ja-JP')}銭までです（手数料を除く受取額で数えます）。`);
  }
  // 既存の銭操作と同じ行をロックし、手数料だけ払えない状態を防ぐ。
  for (const id of [from.id, to.id].sort()) await tx.select().from(wallets).where(eq(wallets.memberId, id)).for('update');
  const balance = (await walletOf(tx, from.id)).balance;
  if (balance < quote.total) throw new TransferError(`銭が足りません。手数料込みで${quote.total.toLocaleString('ja-JP')}銭必要です（残高${balance.toLocaleString('ja-JP')}銭）。`);
  const target = await walletOf(tx, to.id);
  if (target.balance + amount > MAX_INT || target.lifetimeEarned + amount > MAX_INT) throw new TransferError('相手の残高が多いため、この額は受け取れません。');
  await checkMembers(tx, cfg, from, to);
  return { ...quote, balance };
}
async function lockPeople(tx: Db, from: string, to: string) {
  for (const id of [from, to].sort()) await lock(tx, `shop:${id}`);
}
export async function ownedTransfer(db: Db, id: string, fromId: string) {
  const [row] = await db.select().from(directTransfers).where(and(eq(directTransfers.id, id), eq(directTransfers.fromId, fromId)));
  return row;
}
/** 確認用に保存するだけ。この時点では銭を引かない。 */
export async function prepareTransfer(db: Db, cfg: GuildConfig, input: { id: string; from: TransferMember; to: TransferMember; amount: number; note?: string }, now = new Date()) {
  if (!idOk(input.id)) throw new TransferError('送金画面を開き直してください。');
  transferQuote(input.amount);
  const note = (input.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return db.transaction(async tx => {
    await lock(tx, `transfer:${input.id}`);
    const [old] = await tx.select().from(directTransfers).where(eq(directTransfers.id, input.id));
    if (old) {
      if (old.fromId !== input.from.id || old.toId !== input.to.id || old.amount !== input.amount || old.note !== note) throw new TransferError('この確認番号は使えません。');
      return old;
    }
    await lockPeople(tx, input.from.id, input.to.id);
    const quote = await checkPayment(tx, cfg, input.from, input.to, input.amount, now);
    const [row] = await tx.insert(directTransfers).values({ id: input.id, fromId: input.from.id, toId: input.to.id, amount: quote.amount, fee: quote.fee, total: quote.total, note, createdAt: now, expiresAt: new Date(+now + 10 * 60_000) }).returning();
    return row!;
  });
}
/** 受取額・手数料・確定結果・監査を同じトランザクションで保存する。 */
export async function confirmTransfer(db: Db, cfg: GuildConfig, id: string, from: TransferMember, to: TransferMember, now = new Date()) {
  return db.transaction(async tx => {
    await lock(tx, `transfer:${id}`);
    const row = await ownedTransfer(tx, id, from.id);
    if (!row || row.toId !== to.id) throw new TransferError('この送金の確認は使えません。');
    if (row.status === 'sent') return { transfer: row, balance: (await walletOf(tx, from.id)).balance, repeated: true };
    if (row.status !== 'pending' || row.expiresAt <= now) throw new TransferError('この確認は終了しました。/送金からやり直してください。');
    await lockPeople(tx, from.id, to.id);
    const quote = await checkPayment(tx, cfg, from, to, row.amount, now);
    if (quote.fee !== row.fee || quote.total !== row.total) throw new TransferError('送金の条件が変わりました。/送金からやり直してください。');
    const detail = { transferId: row.id, to: row.toId, amount: row.amount };
    if (!(await spendWithin(tx, from.id, row.amount, 'gift_send', detail))) throw new TransferError('送金できませんでした。残高やアカウントの状態を確認してください。');
    if (row.fee > 0 && !(await spendWithin(tx, from.id, row.fee, 'gift_fee', { ...detail, percent: TRANSFER_FEE_PERCENT }))) throw new Error('transfer fee payment failed');
    await addCoins(tx, to.id, row.amount, 'gift_receive', { transferId: row.id, from: row.fromId, note: row.note });
    // サブアカウント設定が同時に変わって受取を止めた場合も、引き落としを全て戻す。
    const [credited] = await tx.select({ id: coinTx.id }).from(coinTx).where(and(eq(coinTx.memberId, to.id), eq(coinTx.reason, 'gift_receive'), sql`${coinTx.detail}->>'transferId' = ${row.id}`));
    if (!credited) throw new TransferError('相手が受け取れなかったため、送金はしていません。');
    const [sent] = await tx.update(directTransfers).set({ status: 'sent', sentAt: now }).where(eq(directTransfers.id, row.id)).returning();
    await audit(tx, { actorId: from.id, targetId: to.id, action: 'transfer.send', detail: { transferId: row.id, amount: row.amount, fee: row.fee, total: row.total, percent: row.fee === 0 ? 0 : TRANSFER_FEE_PERCENT }, via: 'discord' });
    return { transfer: sent!, balance: quote.balance - quote.total, repeated: false };
  });
}
export async function cancelTransfer(db: Db, id: string, fromId: string) {
  return db.transaction(async tx => {
    await lock(tx, `transfer:${id}`);
    const row = await ownedTransfer(tx, id, fromId);
    if (!row) throw new TransferError('この送金の確認は使えません。');
    if (row.status === 'sent') throw new TransferError('この送金は確定済みです。取り消しはできません。');
    await tx.update(directTransfers).set({ status: 'cancelled' }).where(eq(directTransfers.id, row.id));
  });
}

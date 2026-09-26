import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { coinTx, members, wallets } from '../db/schema.js';

/**
 * 鯖内通貨（花びら）。
 * 残高（wallets）と入出金の記録（coin_tx）は必ず同じトランザクションで変える。
 */

export type CoinReason = 'voice' | 'shuin_give' | 'shuin_receive' | 'shuin_revoke' | 'menzaifu' | 'omikuji' | 'join_bonus' | 'adjust';

/** 増やす（amount > 0） */
export async function addCoins(
  db: Db,
  memberId: string,
  amount: number,
  reason: CoinReason,
  detail: Record<string, unknown> = {},
): Promise<number> {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('amount must be a positive integer');
  return db.transaction(async (tx) => {
    const [w] = await tx
      .insert(wallets)
      .values({ memberId, balance: amount, lifetimeEarned: amount })
      .onConflictDoUpdate({
        target: wallets.memberId,
        set: {
          balance: sql`${wallets.balance} + ${amount}`,
          lifetimeEarned: sql`${wallets.lifetimeEarned} + ${amount}`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ balance: wallets.balance });
    await tx.insert(coinTx).values({ memberId, amount, reason, detail });
    return w!.balance;
  });
}

/**
 * 使う。残高が足りなければ何もしないで false。
 * 条件付き UPDATE なので、同時に使っても残高がマイナスにならない。
 */
export async function spendCoins(
  db: Db,
  memberId: string,
  amount: number,
  reason: CoinReason,
  detail: Record<string, unknown> = {},
): Promise<boolean> {
  return db.transaction((tx) => spendWithin(tx, memberId, amount, reason, detail));
}

/** spendCoins の中身。すでにトランザクションの中にいるときに使う */
export async function spendWithin(
  tx: Db,
  memberId: string,
  amount: number,
  reason: CoinReason,
  detail: Record<string, unknown> = {},
): Promise<boolean> {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('amount must be a positive integer');
  const updated = await tx
    .update(wallets)
    .set({ balance: sql`${wallets.balance} - ${amount}`, updatedAt: sql`now()` })
    .where(and(eq(wallets.memberId, memberId), gte(wallets.balance, amount)))
    .returning({ balance: wallets.balance });
  if (!updated.length) return false;
  await tx.insert(coinTx).values({ memberId, amount: -amount, reason, detail });
  return true;
}

/** できるだけ減らす（残高が足りなければ 0 まで）。減らした量を返す。朱印の取り消しで使う */
export async function deductUpTo(
  db: Db,
  memberId: string,
  amount: number,
  reason: CoinReason,
  detail: Record<string, unknown> = {},
): Promise<number> {
  if (amount <= 0) return 0;
  return db.transaction(async (tx) => {
    const [w] = await tx.select({ balance: wallets.balance }).from(wallets).where(eq(wallets.memberId, memberId)).for('update');
    const take = Math.min(w?.balance ?? 0, amount);
    if (take <= 0) return 0;
    await tx
      .update(wallets)
      .set({ balance: sql`${wallets.balance} - ${take}`, updatedAt: sql`now()` })
      .where(eq(wallets.memberId, memberId));
    await tx.insert(coinTx).values({ memberId, amount: -take, reason, detail });
    return take;
  });
}

export async function walletOf(db: Db, memberId: string): Promise<{ balance: number; lifetimeEarned: number }> {
  const [w] = await db
    .select({ balance: wallets.balance, lifetimeEarned: wallets.lifetimeEarned })
    .from(wallets)
    .where(eq(wallets.memberId, memberId));
  return w ?? { balance: 0, lifetimeEarned: 0 };
}

export async function recentCoinTx(db: Db, memberId: string, limit = 20) {
  return db.select().from(coinTx).where(eq(coinTx.memberId, memberId)).orderBy(desc(coinTx.at), desc(coinTx.id)).limit(limit);
}

/**
 * 初期配布: まだもらっていない人にだけ配る（1 人 1 回。入り直しても、管理画面から何度押しても 2 回目はない）。
 * 配った量を返す（もらい済み・量が 0 なら 0）
 */
export async function grantJoinBonus(db: Db, memberId: string, amount: number): Promise<number> {
  if (amount <= 0) return 0;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'join_bonus:' + memberId}))`);
    const [already] = await tx
      .select({ id: coinTx.id })
      .from(coinTx)
      .where(and(eq(coinTx.memberId, memberId), eq(coinTx.reason, 'join_bonus')))
      .limit(1);
    if (already) return 0;
    await addCoins(tx, memberId, amount, 'join_bonus');
    return amount;
  });
}

/** 今いる人（役職ロールを持つ・BOT でない・退出していない）のうち、まだもらっていない人に配る */
export async function grantJoinBonusToAll(db: Db, amount: number, rankRoleIds: readonly string[]): Promise<{ granted: number; total: number }> {
  const rows = await db.select({ id: members.id, roleIds: members.roleIds }).from(members).where(and(isNull(members.leftAt), eq(members.isBot, false)));
  const targets = rows.filter((m) => m.roleIds.some((r) => rankRoleIds.includes(r)));
  let granted = 0;
  for (const m of targets) if ((await grantJoinBonus(db, m.id, amount)) > 0) granted++;
  return { granted, total: targets.length };
}

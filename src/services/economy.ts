import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { coinTx, members, wallets } from '../db/schema.js';

/**
 * 鯖内通貨（花びら）。
 * 残高（wallets）と入出金の記録（coin_tx）は必ず同じトランザクションで変える。
 */

export type CoinReason =
  | 'voice'
  | 'shuin_give'
  | 'shuin_receive'
  | 'shuin_revoke'
  | 'menzaifu'
  | 'omikuji'
  | 'omikuji_streak'
  | 'join_bonus'
  | 'onboarding'
  | 'invite'
  | 'invite_active'
  | 'shop'
  | 'shop_refund'
  | 'gift_send'
  | 'gift_receive'
  | 'otoshidama_put'
  | 'otoshidama_get'
  | 'otoshidama_refund'
  | 'board_hold'
  | 'board_reward'
  | 'board_refund'
  | 'cast_pay'
  | 'cast_reward'
  | 'cast_refund'
  | 'boost'
  | 'room'
  | 'gacha'
  | 'gacha_prize'
  | 'gacha_refund'
  | 'gacha_reset'
  | 'gacha_share'
  | 'market_buy'
  | 'market_sell'
  | 'market_refund'
  | 'admin_grant'
  | 'admin_take'
  | 'saisen'
  | 'casino_bet'
  | 'casino_win'
  | 'casino_refund'
  | 'casino_buyin'
  | 'casino_cashout'
  | 'casino_hold'
  | 'keiba_buy'
  | 'keiba_prize'
  | 'keiba_train'
  | 'keiba_trade'
  | 'adjust';

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

/** 今いる人（役職ロールを持つ・BOT でない・退出していない） */
export async function currentMemberIds(db: Db, rankRoleIds: readonly string[]): Promise<string[]> {
  const rows = await db.select({ id: members.id, roleIds: members.roleIds }).from(members).where(and(isNull(members.leftAt), eq(members.isBot, false)));
  return rows.filter((m) => m.roleIds.some((r) => rankRoleIds.includes(r))).map((m) => m.id);
}

/** 今いる人のうち、まだもらっていない人に配る */
export async function grantJoinBonusToAll(db: Db, amount: number, rankRoleIds: readonly string[]): Promise<{ granted: number; total: number }> {
  const targets = await currentMemberIds(db, rankRoleIds);
  let granted = 0;
  for (const id of targets) if ((await grantJoinBonus(db, id, amount)) > 0) granted++;
  return { granted, total: targets.length };
}

// ───────── 運営から送る・減らす（管理画面・宮司） ─────────

/** 1 回に送れる上限（打ち間違いで桁が増えないように） */
export const ADMIN_COINS_MAX = 100_000;

export type AdminCoinsInput = {
  memberIds: string[];
  amount: number;
  /** 理由（記録に残る） */
  note: string;
  by: string;
  /** 画面を開いたときに作る番号。同じ番号は 1 回だけ（ボタンの二度押し・再送信で 2 回送らない） */
  nonce: string;
};

export const validAdminAmount = (n: number) => Number.isInteger(n) && n >= 1 && n <= ADMIN_COINS_MAX;

/** 同じ番号でもう送っていたら true（トランザクションの中で、番号ごとの鍵を取ってから呼ぶ） */
async function nonceUsed(tx: Db, nonce: string): Promise<boolean> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'admin_coins:' + nonce}))`);
  const [row] = await tx
    .select({ id: coinTx.id })
    .from(coinTx)
    .where(and(inArray(coinTx.reason, ['admin_grant', 'admin_take']), sql`${coinTx.detail}->>'nonce' = ${nonce}`))
    .limit(1);
  return Boolean(row);
}

/** 運営から送る。全員分を 1 つのトランザクションで（途中で失敗したら誰にも送らない） */
export async function adminGrant(db: Db, input: AdminCoinsInput): Promise<{ status: 'ok'; count: number } | { status: 'duplicate' }> {
  if (!validAdminAmount(input.amount)) throw new Error('invalid amount');
  return db.transaction(async (tx) => {
    if (await nonceUsed(tx, input.nonce)) return { status: 'duplicate' as const };
    const ids = [...new Set(input.memberIds)];
    for (const id of ids) await addCoins(tx, id, input.amount, 'admin_grant', { note: input.note, by: input.by, nonce: input.nonce });
    return { status: 'ok' as const, count: ids.length };
  });
}

/** 運営が減らす（送りすぎたときなど）。残高より多くは減らさない。減らした量を返す */
export async function adminTake(
  db: Db,
  input: Omit<AdminCoinsInput, 'memberIds'> & { memberId: string },
): Promise<{ status: 'ok'; taken: number } | { status: 'duplicate' }> {
  if (!validAdminAmount(input.amount)) throw new Error('invalid amount');
  return db.transaction(async (tx) => {
    if (await nonceUsed(tx, input.nonce)) return { status: 'duplicate' as const };
    const taken = await deductUpTo(tx, input.memberId, input.amount, 'admin_take', { note: input.note, by: input.by, nonce: input.nonce });
    return { status: 'ok' as const, taken };
  });
}

/** 銭の出入りの理由（社務所Web・/残高 で表示） */
export const COIN_REASON_LABEL: Record<string, string> = {
  voice: '通話',
  shuin_give: '朱印を押した',
  shuin_receive: '朱印を頂いた',
  omikuji: 'おみくじ',
  join_bonus: '初期配布',
  shop: 'ショップ',
  shop_refund: 'ショップの払い戻し',
  gift_send: '贈り物を贈った',
  gift_receive: '贈り物をもらった',
  otoshidama_put: 'お年玉袋を置いた',
  otoshidama_get: 'お年玉袋から受け取った',
  otoshidama_refund: 'お年玉袋の残りが戻った',
  board_hold: '掲示板の報酬を預けた',
  board_reward: '掲示板の報酬をもらった',
  board_refund: '掲示板の報酬が戻った',
  cast_pay: 'キャストを指名した',
  cast_reward: 'キャストの売り上げ',
  cast_refund: 'キャストの指名の払い戻し',
  boost: '奉納（ブースト）のお礼',
  room: '通話部屋',
  gacha: '物御籤',
  gacha_prize: '物御籤の当たり',
  gacha_refund: '物御籤の払い戻し',
  gacha_reset: '物御籤のリセット（当たりの銭を戻してもらった）',
  gacha_share: '物御籤のおすそ分け',
  onboarding: 'はじめての参拝のお祝い',
  omikuji_streak: 'おみくじの連続日数のおまけ',
  invite: '招待のお礼',
  invite_active: '招待した人の浮上ボーナス',
  market_buy: '市場で買った',
  market_sell: '市場で売れた',
  market_refund: '市場の返金',
  admin_grant: '運営から',
  admin_take: '運営が減らした',
  saisen: 'お賽銭（持ちすぎた分）',
  shuin_revoke: '朱印の取り消し',
  menzaifu: '免罪符',
  casino_bet: 'カジノで賭けた',
  casino_win: 'カジノの払い戻し（勝ち）',
  casino_refund: 'カジノの返金',
  casino_buyin: 'ポーカーの卓に持ち込んだ',
  casino_cashout: 'ポーカーの卓から引き上げた',
  casino_hold: 'ちんちろ卓で預けた（負けの備え・残りは返る）',
  keiba_buy: '🏇 馬を買った（馬主）',
  keiba_prize: '🏇 馬主の賞金・出走手当',
  keiba_train: '🏇 調教',
  keiba_trade: '🏇 馬の売り買い',
  adjust: '調整',
};

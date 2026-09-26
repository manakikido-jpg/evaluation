import { and, asc, eq, gte, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { EconomyConfig, GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { coinTx, shopItems, shopPurchases, type ShopItem, type ShopPurchase } from '../db/schema.js';
import { autoRanks, currentAutoRank } from '../domain/ranks.js';
import { jstDate } from './activity.js';
import { addCoins, spendWithin, walletOf } from './economy.js';

/**
 * ショップ（授与品）。花びらで品物を買う。
 * 買うときは「花びらを払う → 記録」を 1 つのトランザクションで行い、
 * そのあとの Discord の操作（ロールを付ける・投稿する・ピン留め）に失敗したら refund で払い戻す。
 */

export type ShopKind = ShopItem['kind'];
const DAY = 86_400_000;

/** 1 人ずつ順番に（二重に押しても二重に払わない） */
async function lock(tx: Db, memberId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'shop:' + memberId}))`);
}

// ───────── 品物 ─────────

export async function listItems(db: Db, opts: { enabledOnly?: boolean } = {}): Promise<ShopItem[]> {
  const rows = await db.select().from(shopItems).orderBy(asc(shopItems.position), asc(shopItems.id));
  return opts.enabledOnly ? rows.filter((r) => r.enabled) : rows;
}

export async function getItem(db: Db, id: number): Promise<ShopItem | undefined> {
  const [row] = await db.select().from(shopItems).where(eq(shopItems.id, id));
  return row;
}

/** 表示する値段（免罪符は設定の値段） */
export const priceOf = (item: ShopItem, economy: EconomyConfig) => (item.kind === 'menzaifu' ? economy.menzaifuPrice : item.price);

export type ItemPatch = Partial<Pick<ShopItem, 'name' | 'emoji' | 'description' | 'price' | 'durationDays' | 'enabled' | 'position' | 'roleId' | 'roleGroup'>>;

export async function updateItem(db: Db, id: number, patch: ItemPatch): Promise<void> {
  await db.update(shopItems).set({ ...patch, updatedAt: new Date() }).where(eq(shopItems.id, id));
}

export async function createItem(db: Db, item: Omit<typeof shopItems.$inferInsert, 'id' | 'updatedAt'>): Promise<ShopItem> {
  const [row] = await db.insert(shopItems).values(item).returning();
  return row!;
}

export async function deleteItem(db: Db, id: number): Promise<void> {
  await db.delete(shopItems).where(eq(shopItems.id, id));
}

/** 最初から置く品物（ロールのものは、セットアップが作ったロールを渡す）。同じものがあれば作らない */
export async function seedDefaultItems(
  db: Db,
  roles: { colors: { roleId: string; name: string; emoji: string }[]; titles: { roleId: string; name: string; emoji: string }[] },
): Promise<number> {
  const existing = await listItems(db);
  let pos = existing.reduce((n, i) => Math.max(n, i.position), 0);
  let created = 0;
  const add = async (item: Omit<typeof shopItems.$inferInsert, 'id' | 'updatedAt' | 'position'>) => {
    await createItem(db, { ...item, position: ++pos });
    created++;
  };
  for (const c of roles.colors) {
    if (existing.some((i) => i.roleId === c.roleId)) continue;
    await add({ kind: 'role', name: `色守り（${c.name}）`, emoji: c.emoji, description: '30 日間、名前がこの色になる（買い替えると前の色は外れる）', price: 1500, roleId: c.roleId, roleGroup: 'color', durationDays: 30 });
  }
  for (const t of roles.titles) {
    if (existing.some((i) => i.roleId === t.roleId)) continue;
    await add({ kind: 'role', name: `称号「${t.name}」`, emoji: t.emoji, description: 'プロフィールに称号のロールが付く（ずっと）', price: 2000, roleId: t.roleId, roleGroup: 'title', durationDays: null });
  }
  const singles: Omit<typeof shopItems.$inferInsert, 'id' | 'updatedAt' | 'position'>[] = [
    { kind: 'hanafubuki', name: '花吹雪', emoji: '🌸', description: '選んだ人へ、#境内 にお祝いのメッセージを出す', price: 300 },
    { kind: 'gift', name: '贈り物', emoji: '🎁', description: '花びらをほかの人に贈る（手数料なし）', price: 0 },
    { kind: 'ema_pin', name: '絵馬の奉納', emoji: '📌', description: '#絵馬 の自分の自己紹介を 7 日間ピン留め', price: 800, durationDays: 7 },
    { kind: 'omikuji_extra', name: 'おみくじ もう 1 回', emoji: '🎟', description: 'その日のおみくじを、もう 1 回引ける（1 日 1 回まで）', price: 100 },
    { kind: 'menzaifu', name: '免罪符', emoji: '🧾', description: '厄を 1 つ祓う（1 人 1 回まで。値段は設定の値）', price: 0 },
  ];
  for (const s of singles) if (!existing.some((i) => i.kind === s.kind)) await add(s);
  return created;
}

// ───────── 買う ─────────

export type BuyResult =
  | { status: 'ok'; purchase: ShopPurchase; balance: number; /** 買い替えで外すロール */ removeRoleIds: string[] }
  | { status: 'insufficient'; price: number; balance: number }
  | { status: 'owned' }
  | { status: 'disabled' };

/**
 * ロール（色守り・称号）を買う。期限つきのものを同じものでもう一度買うと、期限が延びる。
 * 同じ組（色）の別のものを持っていたら、その記録を終わりにして、外すロールを返す。
 */
export async function buyRole(db: Db, item: ShopItem, memberId: string, now = new Date()): Promise<BuyResult> {
  if (!item.enabled || item.kind !== 'role' || !item.roleId) return { status: 'disabled' };
  return db.transaction(async (tx) => {
    await lock(tx, memberId);
    const active = await tx
      .select()
      .from(shopPurchases)
      .where(and(eq(shopPurchases.memberId, memberId), eq(shopPurchases.kind, 'role'), isNull(shopPurchases.endedAt)));
    const same = active.find((p) => p.roleId === item.roleId);
    if (same && !item.durationDays) return { status: 'owned' };
    if (item.price > 0 && !(await spendWithin(tx, memberId, item.price, 'shop', { itemId: item.id, name: item.name }))) {
      return { status: 'insufficient', price: item.price, balance: (await walletOf(tx, memberId)).balance };
    }
    // 同じものの延長: 今の期限（切れていれば今）から足す
    const base = same?.expiresAt && same.expiresAt > now ? same.expiresAt : now;
    const expiresAt = item.durationDays ? new Date(base.getTime() + item.durationDays * DAY) : null;
    if (same) await tx.update(shopPurchases).set({ endedAt: now }).where(eq(shopPurchases.id, same.id));
    // 同じ組の別のロール（色の買い替え）は外す
    const groupItems = item.roleGroup ? await tx.select().from(shopItems).where(eq(shopItems.roleGroup, item.roleGroup)) : [];
    const groupRoles = new Set(groupItems.map((i) => i.roleId).filter((r): r is string => Boolean(r) && r !== item.roleId));
    const replaced = active.filter((p) => p.roleId && groupRoles.has(p.roleId));
    for (const p of replaced) await tx.update(shopPurchases).set({ endedAt: now }).where(eq(shopPurchases.id, p.id));
    const [purchase] = await tx
      .insert(shopPurchases)
      .values({ memberId, itemId: item.id, kind: 'role', price: item.price, roleId: item.roleId, expiresAt })
      .returning();
    return { status: 'ok', purchase: purchase!, balance: (await walletOf(tx, memberId)).balance, removeRoleIds: replaced.map((p) => p.roleId!) };
  });
}

/** 花吹雪・絵馬の奉納・おみくじもう 1 回: 払って記録する（中身は呼び出し側） */
export async function buySimple(
  db: Db,
  item: ShopItem,
  memberId: string,
  extra: { targetId?: string; channelId?: string; messageId?: string } = {},
  now = new Date(),
): Promise<BuyResult> {
  if (!item.enabled || !['hanafubuki', 'ema_pin', 'omikuji_extra'].includes(item.kind)) return { status: 'disabled' };
  return db.transaction(async (tx) => {
    await lock(tx, memberId);
    if (item.price > 0 && !(await spendWithin(tx, memberId, item.price, 'shop', { itemId: item.id, name: item.name, ...extra }))) {
      return { status: 'insufficient', price: item.price, balance: (await walletOf(tx, memberId)).balance };
    }
    const expiresAt = item.durationDays ? new Date(now.getTime() + item.durationDays * DAY) : null;
    const [purchase] = await tx
      .insert(shopPurchases)
      .values({ memberId, itemId: item.id, kind: item.kind, price: item.price, expiresAt, ...extra })
      .returning();
    return { status: 'ok', purchase: purchase!, balance: (await walletOf(tx, memberId)).balance, removeRoleIds: [] };
  });
}

/** Discord の操作に失敗したとき: 払った花びらを戻し、記録を終わりにする */
export async function refund(db: Db, purchase: ShopPurchase, now = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    const ended = await tx
      .update(shopPurchases)
      .set({ endedAt: now })
      .where(and(eq(shopPurchases.id, purchase.id), isNull(shopPurchases.endedAt)))
      .returning({ id: shopPurchases.id });
    if (ended.length && purchase.price > 0) await addCoins(tx, purchase.memberId, purchase.price, 'shop_refund', { purchaseId: purchase.id });
  });
}

// ───────── 贈り物 ─────────

export type GiftResult =
  | { status: 'ok'; balance: number }
  | { status: 'self' }
  | { status: 'rank_too_low'; rankName: string }
  | { status: 'bad_amount'; min: number; max: number }
  | { status: 'daily_limit'; left: number }
  | { status: 'insufficient'; balance: number };

/**
 * 花びらを贈る（手数料なし）。サブアカウントで初期配布を集められないよう、
 * 贈れるのは 2 段目の役職（氏子）以上の人だけ。1 日に贈れる合計にも上限がある。
 */
export async function giveGift(db: Db, cfg: GuildConfig, from: { id: string; roleIds: readonly string[] }, toId: string, amount: number, now = new Date()): Promise<GiftResult> {
  const e = cfg.economy;
  if (from.id === toId) return { status: 'self' };
  const [first, second] = autoRanks(cfg.ranks);
  const current = currentAutoRank(cfg.ranks, from.roleIds);
  const isStaff = cfg.ranks.some((r) => !r.auto && from.roleIds.includes(r.roleId));
  if (second && !isStaff && (!current || current.key === first?.key)) return { status: 'rank_too_low', rankName: second.name };
  if (!Number.isInteger(amount) || amount < e.giftMin || amount > e.giftMax) return { status: 'bad_amount', min: e.giftMin, max: e.giftMax };
  return db.transaction(async (tx) => {
    await lock(tx, from.id);
    const since = startOfJstDay(now);
    const [sent] = await tx
      .select({ total: sql<number>`coalesce(sum(-${coinTx.amount}), 0)::int` })
      .from(coinTx)
      .where(and(eq(coinTx.memberId, from.id), eq(coinTx.reason, 'gift_send'), gte(coinTx.at, since)));
    const left = e.giftDailyLimit - Number(sent?.total ?? 0);
    if (amount > left) return { status: 'daily_limit', left: Math.max(0, left) };
    if (!(await spendWithin(tx, from.id, amount, 'gift_send', { to: toId }))) return { status: 'insufficient', balance: (await walletOf(tx, from.id)).balance };
    await addCoins(tx, toId, amount, 'gift_receive', { from: from.id });
    return { status: 'ok', balance: (await walletOf(tx, from.id)).balance };
  });
}

function startOfJstDay(now: Date): Date {
  return new Date(`${jstDate(now)}T00:00:00+09:00`);
}

// ───────── 期限 ─────────

/** 期限が来たもの（色守りのロール・絵馬のピン留め） */
export async function duePurchases(db: Db, now = new Date()): Promise<ShopPurchase[]> {
  return db
    .select()
    .from(shopPurchases)
    .where(and(isNull(shopPurchases.endedAt), isNotNull(shopPurchases.expiresAt), lte(shopPurchases.expiresAt, now)));
}

export async function endPurchase(db: Db, id: number, now = new Date()): Promise<void> {
  await db.update(shopPurchases).set({ endedAt: now }).where(eq(shopPurchases.id, id));
}

/** その人が今持っている（期限内の）ロールの品物 */
export async function activeRolePurchases(db: Db, memberId: string): Promise<ShopPurchase[]> {
  return db
    .select()
    .from(shopPurchases)
    .where(and(eq(shopPurchases.memberId, memberId), eq(shopPurchases.kind, 'role'), isNull(shopPurchases.endedAt)));
}

/** 管理画面: 最近の購入 */
export async function recentPurchases(db: Db, limit = 50): Promise<ShopPurchase[]> {
  return db.select().from(shopPurchases).orderBy(sql`${shopPurchases.createdAt} desc`).limit(limit);
}

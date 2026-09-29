import { and, asc, eq, gte, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { salePrice } from './economyEvents.js';
import type { EconomyConfig, GuildConfig, TicketKind } from '../config.js';
import type { Db } from '../db/client.js';
import { coinTx, shopItems, shopPurchases, type ShopItem, type ShopPurchase } from '../db/schema.js';
import { autoRanks, currentAutoRank } from '../domain/ranks.js';
import { jstDate } from './activity.js';
import { addCoins, spendWithin, walletOf } from './economy.js';
import { addTickets, useTicket } from './tickets.js';

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

/** 奉納（ブースト）割引が効く品物（免罪符・贈り物・お年玉袋の手数料はのぞく） */
export const discountable = (item: ShopItem) => item.kind !== 'menzaifu' && item.kind !== 'gift' && item.kind !== 'otoshidama';

/** 払う値段（免罪符は設定の値段。奉納している人は割引、絵馬の奉納は無料。1 枚未満は切り上げ） */
export const priceOf = (item: ShopItem, economy: EconomyConfig, booster = false) => {
  const base = item.kind === 'menzaifu' ? economy.menzaifuPrice : item.price;
  if (booster && item.kind === 'ema_pin') return 0;
  // 期間限定の授与品セール（免罪符・贈り物はのぞく）
  const onSale = item.kind === 'menzaifu' || item.kind === 'gift' || item.kind === 'otoshidama' ? base : salePrice(base, economy.shopSalePercent);
  if (!booster || !discountable(item) || economy.boostDiscountPercent <= 0) return onSale;
  return Math.ceil((onSale * (100 - economy.boostDiscountPercent)) / 100);
};

export type ItemPatch = Partial<Pick<ShopItem, 'name' | 'emoji' | 'description' | 'price' | 'durationDays' | 'enabled' | 'position' | 'roleId' | 'roleGroup' | 'boosterOnly'>>;

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
  roles: {
    colors: { roleId: string; name: string; emoji: string; boosterOnly?: boolean }[];
    titles: { roleId: string; name: string; emoji: string; boosterOnly?: boolean }[];
    license?: { roleId: string };
  },
): Promise<number> {
  const existing = await listItems(db);
  let pos = existing.reduce((n, i) => Math.max(n, i.position), 0);
  let created = 0;
  const add = async (item: Omit<typeof shopItems.$inferInsert, 'id' | 'updatedAt' | 'position'>) => {
    await createItem(db, { ...item, position: ++pos });
    created++;
  };
  const BOOSTER_NOTE = '奉納（ブースト）している方だけ。奉納をやめると外れます';
  for (const c of roles.colors) {
    if (existing.some((i) => i.roleId === c.roleId)) continue;
    if (c.boosterOnly) {
      await add({ kind: 'role', name: `色守り（${c.name}）`, emoji: c.emoji, description: `名前がこの色になる。${BOOSTER_NOTE}`, price: 0, roleId: c.roleId, roleGroup: 'color', durationDays: null, boosterOnly: true });
      continue;
    }
    await add({ kind: 'role', name: `色守り（${c.name}）`, emoji: c.emoji, description: '30 日間、名前がこの色になる（買い替えると前の色は外れる）', price: 1500, roleId: c.roleId, roleGroup: 'color', durationDays: 30 });
  }
  for (const t of roles.titles) {
    if (existing.some((i) => i.roleId === t.roleId)) continue;
    if (t.boosterOnly) {
      await add({ kind: 'role', name: `称号「${t.name}」`, emoji: t.emoji, description: `プロフィールに称号のロールが付く。${BOOSTER_NOTE}`, price: 0, roleId: t.roleId, roleGroup: 'title', durationDays: null, boosterOnly: true });
      continue;
    }
    await add({ kind: 'role', name: `称号「${t.name}」`, emoji: t.emoji, description: 'プロフィールに称号のロールが付く（ずっと）', price: 2000, roleId: t.roleId, roleGroup: 'title', durationDays: null });
  }
  // 開業権利: #市場 に出品できる（ずっと）
  if (roles.license && !existing.some((i) => i.roleId === roles.license!.roleId)) {
    await add({ kind: 'role', name: '開業権利', emoji: '🏪', description: '#市場 に出品できるようになる（ずっと）', price: 3000, roleId: roles.license.roleId, roleGroup: null, durationDays: null });
  }
  const singles: Omit<typeof shopItems.$inferInsert, 'id' | 'updatedAt' | 'position'>[] = [
    { kind: 'hanafubuki', name: '花吹雪', emoji: '🌸', description: '選んだ人へ、#境内 にお祝いのメッセージを出す', price: 300 },
    { kind: 'gift', name: '贈り物', emoji: '🎁', description: '銭をほかの人に贈る（手数料なし）', price: 0 },
    { kind: 'ema_pin', name: '絵馬の奉納', emoji: '📌', description: '自分の自己紹介（#絵馬-男性・#絵馬-女性）を 7 日間ピン留め', price: 800, durationDays: 7 },
    { kind: 'omikuji_extra', name: 'おみくじ もう 1 回', emoji: '🎟', description: 'その日のおみくじを、もう 1 回引ける（1 日 1 回まで）', price: 100 },
    { kind: 'menzaifu', name: '免罪符', emoji: '🧾', description: '厄を 1 つ祓う（1 人 1 回まで。値段は設定の値）', price: 0 },
  ];
  singles.push(
    { kind: 'otoshidama', name: 'お年玉袋', emoji: '🧧', description: '銭を入れた袋をチャンネルに置くと、先着の人がボタンで受け取れる（量は運しだい）', price: 0 },
    { kind: 'mycolor', name: '自分だけの色', emoji: '🎨', description: '好きな色の、自分専用の色ロールを BOT が作る（色守りより上に出る）', price: 5000, durationDays: 30 },
  );
  for (const s of singles) if (!existing.some((i) => i.kind === s.kind)) await add(s);
  return created;
}

// ───────── 買う ─────────

export type BuyResult =
  | {
      status: 'ok';
      purchase: ShopPurchase;
      balance: number;
      /** 買い替えで外すロール */ removeRoleIds: string[];
      /** 券を使った（銭は払っていない） */ ticket?: boolean;
      /** 割引券を使った（%） */ discount?: number;
    }
  | { status: 'insufficient'; price: number; balance: number }
  | { status: 'owned' }
  | { status: 'disabled' }
  | { status: 'no_ticket' };

// ───────── 割引券 ─────────

export type DiscountTicket = 'shop_10' | 'shop_30' | 'shop_50';
export const DISCOUNT_TICKETS: DiscountTicket[] = ['shop_10', 'shop_30', 'shop_50'];
export const DISCOUNT_PERCENT: Record<DiscountTicket, number> = { shop_10: 10, shop_30: 30, shop_50: 50 };
/** 割引した値段（1 枚未満は切り上げ） */
export const discountedPrice = (price: number, t: DiscountTicket) => Math.ceil((price * (100 - DISCOUNT_PERCENT[t])) / 100);

class NoTicket extends Error {}

/** 割引券を 1 枚使う（なければ取り消し。払った分も戻る） */
async function takeDiscount(tx: Db, memberId: string, t: DiscountTicket | undefined): Promise<void> {
  if (t && !(await useTicket(tx, memberId, t))) throw new NoTicket();
}

async function withDiscount(discount: DiscountTicket | undefined, run: () => Promise<BuyResult>): Promise<BuyResult> {
  try {
    return await run();
  } catch (err) {
    if (discount && err instanceof NoTicket) return { status: 'no_ticket' };
    throw err;
  }
}

/**
 * ロール（色守り・称号）を買う。期限つきのものを同じものでもう一度買うと、期限が延びる。
 * 同じ組（色）の別のものを持っていたら、その記録を終わりにして、外すロールを返す。
 */
export async function buyRole(db: Db, item: ShopItem, memberId: string, now = new Date(), price = item.price, discount?: DiscountTicket): Promise<BuyResult> {
  if (!item.enabled || item.kind !== 'role' || !item.roleId) return { status: 'disabled' };
  if (discount) price = discountedPrice(price, discount);
  return withDiscount(discount, () => db.transaction(async (tx) => {
    await lock(tx, memberId);
    const active = await tx
      .select()
      .from(shopPurchases)
      .where(and(eq(shopPurchases.memberId, memberId), eq(shopPurchases.kind, 'role'), isNull(shopPurchases.endedAt)));
    const same = active.find((p) => p.roleId === item.roleId);
    if (same && !item.durationDays) return { status: 'owned' };
    if (price > 0 && !(await spendWithin(tx, memberId, price, 'shop', { itemId: item.id, name: item.name, ...(discount ? { ticket: discount } : {}) }))) {
      return { status: 'insufficient', price, balance: (await walletOf(tx, memberId)).balance };
    }
    await takeDiscount(tx, memberId, discount);
    const { purchase, removeRoleIds } = await recordRoleItem(tx, item, memberId, now, price, active, same, discount);
    return { status: 'ok', purchase, balance: (await walletOf(tx, memberId)).balance, removeRoleIds, ...(discount ? { discount: DISCOUNT_PERCENT[discount] } : {}) };
  }));
}

type ActivePurchase = typeof shopPurchases.$inferSelect;

/** ロールの品を記録する（期限を足す・同じ組の別のロールを終わりにする）。払うのは呼び出し側 */
async function recordRoleItem(
  tx: Db,
  item: ShopItem,
  memberId: string,
  now: Date,
  price: number,
  active: ActivePurchase[],
  same: ActivePurchase | undefined,
  ticket?: TicketKind,
): Promise<{ purchase: ShopPurchase; removeRoleIds: string[] }> {
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
    .values({ memberId, itemId: item.id, kind: 'role', price, roleId: item.roleId, expiresAt, ticket: ticket ?? null })
    .returning();
  return { purchase: purchase!, removeRoleIds: replaced.map((p) => p.roleId!) };
}

/**
 * ロールの品を無料で渡す（物御籤）。ショップで止めている品でも渡せる。
 * ずっと持てる品をもう持っていれば 'owned'。期限つきなら期限を延ばす。
 */
export async function grantRoleItem(
  tx: Db,
  item: ShopItem,
  memberId: string,
  now = new Date(),
): Promise<{ status: 'ok'; purchase: ShopPurchase; removeRoleIds: string[] } | { status: 'owned' | 'disabled' }> {
  if (item.kind !== 'role' || !item.roleId) return { status: 'disabled' };
  await lock(tx, memberId);
  const active = await tx
    .select()
    .from(shopPurchases)
    .where(and(eq(shopPurchases.memberId, memberId), eq(shopPurchases.kind, 'role'), isNull(shopPurchases.endedAt)));
  const same = active.find((p) => p.roleId === item.roleId);
  if (same && !item.durationDays) return { status: 'owned' };
  return { status: 'ok', ...(await recordRoleItem(tx, item, memberId, now, 0, active, same)) };
}

// ───────── 🎁 プレゼント ─────────

/** プレゼントにできる品（色守り・称号など、ロールの品。VIP・奉納している人だけの品はのぞく） */
export const presentable = (item: ShopItem) => item.kind === 'role' && Boolean(item.roleId) && item.roleGroup !== 'vip' && !item.boosterOnly;

export type PresentBuyResult =
  | BuyResult
  | { status: 'self' }
  | { status: 'not_member' }
  | { status: 'rank_too_low'; rankName: string };

/**
 * 授与品をプレゼントとして買う: 買う人が払い、相手が受ける（ロールを付けるのは呼び出し側）。
 * 贈れるのは 2 段目の役職（氏子）以上か運営（サブアカウントの初期配布で買って集められないように）。相手は役職のある人。
 * ずっと持てる品を相手がもう持っていれば 'owned'、期限つきなら相手の期限が延びる
 */
export async function buyPresent(
  db: Db,
  cfg: GuildConfig,
  item: ShopItem,
  from: { id: string; roleIds: readonly string[] },
  to: { id: string; roleIds: readonly string[]; bot?: boolean },
  price = item.price,
  now = new Date(),
): Promise<PresentBuyResult> {
  if (!item.enabled || !presentable(item)) return { status: 'disabled' };
  if (from.id === to.id) return { status: 'self' };
  if (to.bot || !cfg.ranks.some((r) => to.roleIds.includes(r.roleId))) return { status: 'not_member' };
  const [first, second] = autoRanks(cfg.ranks);
  const current = currentAutoRank(cfg.ranks, from.roleIds);
  const isStaff = cfg.ranks.some((r) => !r.auto && from.roleIds.includes(r.roleId));
  if (second && !isStaff && (!current || current.key === first?.key)) return { status: 'rank_too_low', rankName: second.name };
  return db.transaction(async (tx) => {
    // 2 人とも順番に（いつも同じ順で取って、待ち合わせにならないように）
    for (const id of [from.id, to.id].sort()) await lock(tx, id);
    const active = await tx
      .select()
      .from(shopPurchases)
      .where(and(eq(shopPurchases.memberId, to.id), eq(shopPurchases.kind, 'role'), isNull(shopPurchases.endedAt)));
    const same = active.find((p) => p.roleId === item.roleId);
    if (same && !item.durationDays) return { status: 'owned' as const };
    if (price > 0 && !(await spendWithin(tx, from.id, price, 'shop', { itemId: item.id, name: item.name, presentTo: to.id }))) {
      return { status: 'insufficient' as const, price, balance: (await walletOf(tx, from.id)).balance };
    }
    const r = await recordRoleItem(tx, item, to.id, now, price, active, same);
    const [purchase] = await tx.update(shopPurchases).set({ giftFrom: from.id }).where(eq(shopPurchases.id, r.purchase.id)).returning();
    return { status: 'ok' as const, purchase: purchase!, balance: (await walletOf(tx, from.id)).balance, removeRoleIds: r.removeRoleIds };
  });
}

/** 花吹雪・絵馬の奉納・おみくじもう 1 回: 払って記録する（中身は呼び出し側） */
export async function buySimple(
  db: Db,
  item: ShopItem,
  memberId: string,
  extra: { targetId?: string; channelId?: string; messageId?: string } = {},
  now = new Date(),
  price = item.price,
  discount?: DiscountTicket,
): Promise<BuyResult> {
  if (!item.enabled || !['hanafubuki', 'ema_pin', 'omikuji_extra'].includes(item.kind)) return { status: 'disabled' };
  return withDiscount(discount, () => db.transaction(async (tx) => {
    await lock(tx, memberId);
    // 絵馬の奉納: 絵馬のピン留め券を持っていれば、それを使って無料（割引券は使わない）
    const ticket = item.kind === 'ema_pin' && price > 0 && (await useTicket(tx, memberId, 'ema_pin'));
    if (ticket) price = 0;
    const used = ticket ? undefined : discount;
    if (used) price = discountedPrice(price, used);
    if (price > 0 && !(await spendWithin(tx, memberId, price, 'shop', { itemId: item.id, name: item.name, ...extra, ...(used ? { ticket: used } : {}) }))) {
      return { status: 'insufficient', price, balance: (await walletOf(tx, memberId)).balance };
    }
    await takeDiscount(tx, memberId, used);
    const expiresAt = item.durationDays ? new Date(now.getTime() + item.durationDays * DAY) : null;
    const [purchase] = await tx
      .insert(shopPurchases)
      .values({ memberId, itemId: item.id, kind: item.kind, price, expiresAt, ...extra, ticket: ticket ? 'ema_pin' : (used ?? null) })
      .returning();
    return {
      status: 'ok',
      purchase: purchase!,
      balance: (await walletOf(tx, memberId)).balance,
      removeRoleIds: [],
      ...(ticket ? { ticket: true } : {}),
      ...(used ? { discount: DISCOUNT_PERCENT[used] } : {}),
    };
  }));
}

// ───────── 🎨 自分だけの色 ─────────

/** 選べる色の見本（和の色）。色コードで好きな色にもできる */
export const MY_COLORS: { key: string; name: string; emoji: string; color: number }[] = [
  { key: 'sakura', name: '桜色', emoji: '🌸', color: 0xf4a7b9 },
  { key: 'momo', name: '桃色', emoji: '🍑', color: 0xf09199 },
  { key: 'botan', name: '牡丹色', emoji: '🌺', color: 0xe7609e },
  { key: 'kurenai', name: '紅', emoji: '🔴', color: 0xd7003a },
  { key: 'shu', name: '朱色', emoji: '🟠', color: 0xeb6101 },
  { key: 'yamabuki', name: '山吹色', emoji: '🟡', color: 0xf8b500 },
  { key: 'nanohana', name: '菜の花色', emoji: '🌼', color: 0xffec47 },
  { key: 'kin', name: '金色', emoji: '✨', color: 0xe6b422 },
  { key: 'wakakusa', name: '若草色', emoji: '🌱', color: 0xc3d825 },
  { key: 'matcha', name: '抹茶色', emoji: '🍵', color: 0xc5c56a },
  { key: 'hisui', name: '翡翠色', emoji: '💚', color: 0x38b48b },
  { key: 'mizu', name: '水色', emoji: '💧', color: 0xbce2e8 },
  { key: 'sora', name: '空色', emoji: '☁️', color: 0xa0d8ef },
  { key: 'ruri', name: '瑠璃色', emoji: '🔵', color: 0x1e50a2 },
  { key: 'fuji', name: '藤色', emoji: '💜', color: 0xbbbcde },
  { key: 'sumire', name: '菫色', emoji: '🟣', color: 0x7058a3 },
  { key: 'kohaku', name: '琥珀色', emoji: '🟤', color: 0xbf783a },
  { key: 'gin', name: '白銀', emoji: '🤍', color: 0xe5e4e6 },
];

/** 「#ff88aa」「ff88aa」「#f8a」を色の数に。黒（0）は Discord では「色なし」なので、ほぼ黒にする */
export function parseHexColor(raw: string): number | undefined {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw.trim().replace(/^＃/, '#'));
  if (!m) return undefined;
  const hex = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  return Number.parseInt(hex, 16) || 0x010101;
}

export const hexOf = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

/** その人の今の「自分だけの色」 */
export async function activeMyColor(db: Db, memberId: string): Promise<ShopPurchase | undefined> {
  const [row] = await db
    .select()
    .from(shopPurchases)
    .where(and(eq(shopPurchases.memberId, memberId), eq(shopPurchases.kind, 'mycolor'), isNull(shopPurchases.endedAt)));
  return row;
}

export type MyColorResult =
  | { status: 'ok'; purchase: ShopPurchase; balance: number; /** 前から持っていて、色を変えて期間を延ばした */ extended: boolean; previousExpiresAt: Date | null }
  | { status: 'insufficient'; price: number; balance: number }
  | { status: 'disabled' };

/** 払って記録する（ロールを作る・色を変えるのは呼び出し側）。持っていれば期間を延ばす */
export async function buyMyColor(db: Db, item: ShopItem, memberId: string, color: number, now = new Date(), price = item.price): Promise<MyColorResult> {
  if (!item.enabled || item.kind !== 'mycolor') return { status: 'disabled' };
  return db.transaction(async (tx) => {
    await lock(tx, memberId);
    if (price > 0 && !(await spendWithin(tx, memberId, price, 'shop', { itemId: item.id, name: item.name, color: hexOf(color) }))) {
      return { status: 'insufficient' as const, price, balance: (await walletOf(tx, memberId)).balance };
    }
    const [active] = await tx
      .select()
      .from(shopPurchases)
      .where(and(eq(shopPurchases.memberId, memberId), eq(shopPurchases.kind, 'mycolor'), isNull(shopPurchases.endedAt)));
    const balance = async () => (await walletOf(tx, memberId)).balance;
    if (active) {
      const base = active.expiresAt && active.expiresAt > now ? active.expiresAt : now;
      const expiresAt = item.durationDays && active.expiresAt ? new Date(base.getTime() + item.durationDays * DAY) : null;
      const [purchase] = await tx.update(shopPurchases).set({ expiresAt }).where(eq(shopPurchases.id, active.id)).returning();
      return { status: 'ok' as const, purchase: purchase!, balance: await balance(), extended: true, previousExpiresAt: active.expiresAt };
    }
    const expiresAt = item.durationDays ? new Date(now.getTime() + item.durationDays * DAY) : null;
    const [purchase] = await tx.insert(shopPurchases).values({ memberId, itemId: item.id, kind: 'mycolor', price, expiresAt }).returning();
    return { status: 'ok' as const, purchase: purchase!, balance: await balance(), extended: false, previousExpiresAt: null };
  });
}

export async function setPurchaseRole(db: Db, purchaseId: number, roleId: string): Promise<void> {
  await db.update(shopPurchases).set({ roleId }).where(eq(shopPurchases.id, purchaseId));
}

/** ロールを作れなかった・色を変えられなかったとき: 払った分を戻す（延ばしたときは期間も元に戻す） */
export async function undoMyColor(db: Db, r: Extract<MyColorResult, { status: 'ok' }>, price: number): Promise<void> {
  if (!r.extended) return refund(db, { ...r.purchase, price });
  await db.transaction(async (tx) => {
    await tx.update(shopPurchases).set({ expiresAt: r.previousExpiresAt }).where(eq(shopPurchases.id, r.purchase.id));
    if (price > 0) await addCoins(tx, r.purchase.memberId, price, 'shop_refund', { purchaseId: r.purchase.id });
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
    // プレゼントは買った人に戻す
    if (ended.length && purchase.price > 0) await addCoins(tx, purchase.giftFrom ?? purchase.memberId, purchase.price, 'shop_refund', { purchaseId: purchase.id });
    // 使った券（割引券・絵馬のピン留め券）も戻す
    if (ended.length && purchase.ticket) await addTickets(tx, purchase.memberId, purchase.ticket, 1);
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

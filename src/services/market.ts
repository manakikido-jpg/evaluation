import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { marketListings, marketOrders, type MarketListing, type MarketOrder } from '../db/schema.js';
import { addCoins, spendWithin, walletOf } from './economy.js';
import { useTicket } from './tickets.js';
import { getMember } from './members.js';

/**
 * 市場: 開業権利（🏪 開業ロール）を持つ人が、イラスト・歌・作成物・通話などを花びらで売る。
 * 本物のお金は扱わない。性的なものは出品できない（しきたり）。
 * 買った人の花びらは預かっておき、「受け取った」を押すか、期限（autoReleaseDays）が来たら売った人に渡す（手数料を引いて）。
 * 「問題あり」を押すと運営が判断する（返す・渡す）。手数料の分はどこにも渡さない（花びらが増えすぎないように）。
 */

export type MarketCategory = 'illust' | 'voice' | 'craft' | 'call' | 'other';

export const MARKET_CATEGORIES: Record<MarketCategory, { label: string; emoji: string; adultOnly?: boolean }> = {
  illust: { label: 'イラスト', emoji: '🎨' },
  voice: { label: '歌・音声', emoji: '🎤' },
  craft: { label: '作成物（アイコン・動画など）', emoji: '🛠' },
  call: { label: '通話（雑談・寝落ち）', emoji: '📞', adultOnly: true },
  other: { label: 'その他', emoji: '📦' },
};
export const isMarketCategory = (v: unknown): v is MarketCategory => typeof v === 'string' && Object.hasOwn(MARKET_CATEGORIES, v);

export const MARKET_PRICE_MAX = 1_000_000;
const DAY = 86_400_000;

export const feeOf = (cfg: GuildConfig, price: number) => Math.floor((price * cfg.market.feePercent) / 100);

const isAdult = async (db: Db, id: string) => (await getMember(db, id))?.ageGroup === 'adult';

// ───────── 出品 ─────────

export type ListingResult =
  | { status: 'ok'; listing: MarketListing }
  | { status: 'no_license' | 'adult_only' | 'invalid' | 'disabled' };

export async function createListing(
  db: Db,
  cfg: GuildConfig,
  seller: { id: string; roleIds: readonly string[] },
  input: { category: string; title: string; description: string; price: number },
): Promise<ListingResult> {
  const merchant = cfg.roles.merchant;
  if (!merchant) return { status: 'disabled' };
  if (!seller.roleIds.includes(merchant)) return { status: 'no_license' };
  const title = input.title.trim();
  if (!isMarketCategory(input.category) || !title || title.length > 60 || input.description.length > 1000) return { status: 'invalid' };
  if (!Number.isInteger(input.price) || input.price < 1 || input.price > MARKET_PRICE_MAX) return { status: 'invalid' };
  if (MARKET_CATEGORIES[input.category].adultOnly && !(await isAdult(db, seller.id))) return { status: 'adult_only' };
  const [listing] = await db
    .insert(marketListings)
    .values({ sellerId: seller.id, category: input.category, title, description: input.description.trim(), price: input.price })
    .returning();
  return { status: 'ok', listing: listing! };
}

export async function setListingMessage(db: Db, id: number, channelId: string, messageId: string): Promise<void> {
  await db.update(marketListings).set({ channelId, messageId }).where(eq(marketListings.id, id));
}

export async function getListing(db: Db, id: number): Promise<MarketListing | undefined> {
  const [row] = await db.select().from(marketListings).where(eq(marketListings.id, id));
  return row;
}

/** 受付を終える（売った人は closed、運営は removed） */
export async function closeListing(db: Db, id: number, by: 'seller' | 'staff'): Promise<MarketListing | undefined> {
  const [row] = await db
    .update(marketListings)
    .set({ status: by === 'staff' ? 'removed' : 'closed', updatedAt: new Date() })
    .where(and(eq(marketListings.id, id), eq(marketListings.status, 'open')))
    .returning();
  return row;
}

// ───────── 買う・受け取る ─────────

export type BuyResult =
  | { status: 'ok'; order: MarketOrder; balance: number }
  | { status: 'insufficient'; price: number; balance: number }
  | { status: 'not_open' | 'self' | 'adult_only' };

export async function buyListing(db: Db, cfg: GuildConfig, listingId: number, buyerId: string, now = new Date()): Promise<BuyResult> {
  const listing = await getListing(db, listingId);
  if (!listing || listing.status !== 'open') return { status: 'not_open' };
  if (listing.sellerId === buyerId) return { status: 'self' };
  // 通話は 18 歳以上どうしだけ
  if (MARKET_CATEGORIES[listing.category as MarketCategory]?.adultOnly && !((await isAdult(db, buyerId)) && (await isAdult(db, listing.sellerId)))) {
    return { status: 'adult_only' };
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'market:' + buyerId}))`);
    const fee = feeOf(cfg, listing.price);
    if (!(await spendWithin(tx, buyerId, listing.price, 'market_buy', { listingId, title: listing.title }))) {
      return { status: 'insufficient' as const, price: listing.price, balance: (await walletOf(tx, buyerId)).balance };
    }
    const [order] = await tx
      .insert(marketOrders)
      .values({
        listingId,
        buyerId,
        sellerId: listing.sellerId,
        price: listing.price,
        fee,
        autoReleaseAt: new Date(now.getTime() + cfg.market.autoReleaseDays * DAY),
      })
      .returning();
    return { status: 'ok' as const, order: order!, balance: (await walletOf(tx, buyerId)).balance };
  });
}

export async function setOrderThread(db: Db, id: number, threadId: string): Promise<void> {
  await db.update(marketOrders).set({ threadId }).where(eq(marketOrders.id, id));
}

export async function getOrder(db: Db, id: number): Promise<MarketOrder | undefined> {
  const [row] = await db.select().from(marketOrders).where(eq(marketOrders.id, id));
  return row;
}

/** 売った人に渡す（受け取った・期限・運営）。預かり中か問題ありのものだけ */
export async function releaseOrder(db: Db, id: number, by: string, now = new Date()): Promise<MarketOrder | undefined> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .update(marketOrders)
      .set({ status: 'completed', closedAt: now, decidedBy: by })
      .where(and(eq(marketOrders.id, id), inArray(marketOrders.status, ['paid', 'disputed'])))
      .returning();
    if (!order) return undefined;
    // 市場の手数料なし券を持っていれば、手数料を引かない
    if (order.fee > 0 && (await useTicket(tx, order.sellerId, 'market_nofee'))) {
      const [noFee] = await tx.update(marketOrders).set({ fee: 0 }).where(eq(marketOrders.id, id)).returning();
      await addCoins(tx, order.sellerId, order.price, 'market_sell', { orderId: id, fee: 0, ticket: 'market_nofee' });
      return noFee ?? order;
    }
    const pay = order.price - order.fee;
    if (pay > 0) await addCoins(tx, order.sellerId, pay, 'market_sell', { orderId: id, fee: order.fee });
    return order;
  });
}

/** 買った人に戻す（運営）。預かり中か問題ありのものだけ */
export async function refundOrder(db: Db, id: number, by: string, now = new Date()): Promise<MarketOrder | undefined> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .update(marketOrders)
      .set({ status: 'refunded', closedAt: now, decidedBy: by })
      .where(and(eq(marketOrders.id, id), inArray(marketOrders.status, ['paid', 'disputed'])))
      .returning();
    if (!order) return undefined;
    await addCoins(tx, order.buyerId, order.price, 'market_refund', { orderId: id });
    return order;
  });
}

/** 「問題あり」（買った人）。預かり中のものだけ。運営が判断するまで期限で渡さない */
export async function disputeOrder(db: Db, id: number): Promise<MarketOrder | undefined> {
  const [order] = await db
    .update(marketOrders)
    .set({ status: 'disputed' })
    .where(and(eq(marketOrders.id, id), eq(marketOrders.status, 'paid')))
    .returning();
  return order;
}

/** 期限が来た預かり中の取引を、売った人に渡す */
export async function autoReleaseOrders(db: Db, now = new Date()): Promise<MarketOrder[]> {
  const due = await db
    .select({ id: marketOrders.id })
    .from(marketOrders)
    .where(and(eq(marketOrders.status, 'paid'), lte(marketOrders.autoReleaseAt, now)));
  const out: MarketOrder[] = [];
  for (const d of due) {
    const o = await releaseOrder(db, d.id, 'system', now);
    if (o) out.push(o);
  }
  return out;
}

// ───────── 管理画面 ─────────

export async function recentListings(db: Db, limit = 100): Promise<MarketListing[]> {
  return db.select().from(marketListings).orderBy(desc(marketListings.createdAt)).limit(limit);
}

/** 問題ありを先に、新しい順 */
export async function recentOrders(db: Db, limit = 100): Promise<MarketOrder[]> {
  return db
    .select()
    .from(marketOrders)
    .orderBy(sql`case when ${marketOrders.status} = 'disputed' then 0 when ${marketOrders.status} = 'paid' then 1 else 2 end`, desc(marketOrders.createdAt))
    .limit(limit);
}

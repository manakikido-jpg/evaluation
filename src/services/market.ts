import { and, avg, count, desc, eq, inArray, isNotNull, lte, ne, sql } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { marketBids, marketListings, marketOffers, marketOrders, marketRequests, type MarketBid, type MarketListing, type MarketOffer, type MarketOrder, type MarketRequest } from '../db/schema.js';
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
  call: { label: '通話', emoji: '📞', adultOnly: true },
  other: { label: 'その他', emoji: '📦' },
};
export const isMarketCategory = (v: unknown): v is MarketCategory => typeof v === 'string' && Object.hasOwn(MARKET_CATEGORIES, v);

/** 通話の種類 */
export type CallKind = 'twoshot' | 'sleep' | 'care' | 'consult' | 'other';
export const CALL_KINDS: Record<CallKind, { label: string; emoji: string; note?: string }> = {
  twoshot: { label: 'ツーショ', emoji: '💞' },
  sleep: { label: '寝かしつけ', emoji: '🌙' },
  care: { label: 'メンケア', emoji: '🫂', note: '話を聞く・励ますもので、専門家の相談ではありません' },
  consult: { label: '相談', emoji: '💬' },
  other: { label: 'その他', emoji: '📦' },
};
export const isCallKind = (v: unknown): v is CallKind => typeof v === 'string' && Object.hasOwn(CALL_KINDS, v);
/** 「📞 通話・🌙 寝かしつけ」のような種類の名前 */
export function kindLabel(category: string, sub?: string | null): string {
  const c = MARKET_CATEGORIES[category as MarketCategory] ?? MARKET_CATEGORIES.other;
  const k = category === 'call' && isCallKind(sub) ? CALL_KINDS[sub] : undefined;
  return k ? `${c.emoji} ${c.label}・${k.emoji} ${k.label}` : `${c.emoji} ${c.label}`;
}

/** 受付の上限（同時に受ける取引の数）の最大 */
export const MARKET_CAPACITY_MAX = 20;
/** 📞 今すぐ通話 OK の長さ */
export const STANDBY_MINUTES = 30;
/** 提案に返事がないまま、この日数で取り下げ */
export const OFFER_DAYS = 3;
/** 予定の時刻からこの分たっても始まらなければ「来なかった」を押せる */
export const NOSHOW_MINUTES = 10;

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
  input: { category: string; title: string; description: string; price: number; pricing?: 'fixed' | 'offer'; subcategory?: string | null; capacity?: number; imageUrl?: string | null },
): Promise<ListingResult> {
  const merchant = cfg.roles.merchant;
  if (!merchant) return { status: 'disabled' };
  if (!seller.roleIds.includes(merchant)) return { status: 'no_license' };
  const title = input.title.trim();
  if (!isMarketCategory(input.category) || !title || title.length > 60 || input.description.length > 1000) return { status: 'invalid' };
  if (!Number.isInteger(input.price) || input.price < 1 || input.price > MARKET_PRICE_MAX) return { status: 'invalid' };
  const capacity = input.capacity ?? 0;
  if (!Number.isInteger(capacity) || capacity < 0 || capacity > MARKET_CAPACITY_MAX) return { status: 'invalid' };
  const sub = input.category === 'call' ? (isCallKind(input.subcategory) ? input.subcategory : 'other') : null;
  if (MARKET_CATEGORIES[input.category].adultOnly && !(await isAdult(db, seller.id))) return { status: 'adult_only' };
  const [listing] = await db
    .insert(marketListings)
    .values({
      sellerId: seller.id,
      category: input.category,
      subcategory: sub,
      title,
      description: input.description.trim(),
      price: input.price,
      pricing: input.pricing === 'offer' ? 'offer' : 'fixed',
      capacity,
      imageUrl: input.imageUrl ?? null,
    })
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

/** 売った人の受付中の出品（評価が変わったらカードを直すため） */
export async function openListingsOf(db: Db, sellerId: string): Promise<MarketListing[]> {
  return db
    .select()
    .from(marketListings)
    .where(and(eq(marketListings.sellerId, sellerId), eq(marketListings.status, 'open')))
    .limit(25);
}

/** 受付を終える（売った人は closed、運営は removed） */
export async function closeListing(db: Db, id: number, by: 'seller' | 'staff'): Promise<MarketListing | undefined> {
  const [row] = await db
    .update(marketListings)
    .set({ status: by === 'staff' ? 'removed' : 'closed', standbyUntil: null, updatedAt: new Date() })
    .where(and(eq(marketListings.id, id), eq(marketListings.status, 'open')))
    .returning();
  return row;
}

// ───────── 買う・受け取る ─────────

export type BuyResult =
  | { status: 'ok'; order: MarketOrder; balance: number }
  | { status: 'insufficient'; price: number; balance: number }
  | { status: 'not_open' | 'self' | 'adult_only' | 'full' | 'offer_only' };

/** いま受けている取引の数（預かり中・問題あり） */
export async function activeOrders(db: Db, listingId: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(marketOrders)
    .where(and(eq(marketOrders.listingId, listingId), inArray(marketOrders.status, ['paid', 'disputed'])));
  return row?.n ?? 0;
}

/** 通話は 18 歳以上どうしだけ */
async function adultPair(db: Db, category: string, a: string, b: string): Promise<boolean> {
  if (!MARKET_CATEGORIES[category as MarketCategory]?.adultOnly) return true;
  return (await isAdult(db, a)) && (await isAdult(db, b));
}

/** 銭を預かって取引を始める（同じトランザクションで）。足りなければ undefined */
async function startOrder(
  tx: Db,
  cfg: GuildConfig,
  o: { listingId: number; requestId?: number; buyerId: string; sellerId: string; price: number; title: string },
  now: Date,
): Promise<MarketOrder | undefined> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'market:' + o.buyerId}))`);
  if (!(await spendWithin(tx, o.buyerId, o.price, 'market_buy', { listingId: o.listingId, ...(o.requestId ? { requestId: o.requestId } : {}), title: o.title }))) return undefined;
  const [order] = await tx
    .insert(marketOrders)
    .values({
      listingId: o.listingId,
      requestId: o.requestId ?? null,
      buyerId: o.buyerId,
      sellerId: o.sellerId,
      price: o.price,
      fee: feeOf(cfg, o.price),
      autoReleaseAt: new Date(now.getTime() + cfg.market.autoReleaseDays * DAY),
    })
    .returning();
  return order!;
}

export async function buyListing(db: Db, cfg: GuildConfig, listingId: number, buyerId: string, now = new Date()): Promise<BuyResult> {
  const listing = await getListing(db, listingId);
  if (!listing || listing.status !== 'open') return { status: 'not_open' };
  if (listing.sellerId === buyerId) return { status: 'self' };
  if (listing.pricing === 'offer') return { status: 'offer_only' };
  if (!(await adultPair(db, listing.category, buyerId, listing.sellerId))) return { status: 'adult_only' };
  return db.transaction(async (tx) => {
    // 受付の上限（同時に受ける数）
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'market-listing:' + listingId}))`);
    if (listing.capacity > 0 && (await activeOrders(tx, listingId)) >= listing.capacity) return { status: 'full' as const };
    const order = await startOrder(tx, cfg, { listingId, buyerId, sellerId: listing.sellerId, price: listing.price, title: listing.title }, now);
    if (!order) return { status: 'insufficient' as const, price: listing.price, balance: (await walletOf(tx, buyerId)).balance };
    return { status: 'ok' as const, order, balance: (await walletOf(tx, buyerId)).balance };
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
export async function disputeOrder(db: Db, id: number, kind: 'problem' | 'noshow' = 'problem'): Promise<MarketOrder | undefined> {
  const [order] = await db
    .update(marketOrders)
    .set({ status: 'disputed', disputeKind: kind })
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

// ───────── 取引の中身（出品・依頼のどちらから） ─────────

export type OrderInfo = { title: string; category: string; subcategory: string | null };
export async function orderInfo(db: Db, o: Pick<MarketOrder, 'listingId' | 'requestId'>): Promise<OrderInfo> {
  if (o.requestId) {
    const r = await getRequest(db, o.requestId);
    return { title: r?.title ?? `依頼 #${o.requestId}`, category: r?.category ?? 'other', subcategory: r?.subcategory ?? null };
  }
  const l = await getListing(db, o.listingId);
  return { title: l?.title ?? `出品 #${o.listingId}`, category: l?.category ?? 'other', subcategory: l?.subcategory ?? null };
}

// ───────── 💬 値段の提案 ─────────

export type OfferResult =
  | { status: 'ok'; offer: MarketOffer }
  | { status: 'not_open' | 'self' | 'adult_only' | 'not_offer' | 'too_low' | 'invalid' }
  | { status: 'insufficient'; balance: number };

/** 提案を出す（同じ出品に返事待ちの提案があれば、出し直す） */
export async function makeOffer(db: Db, listingId: number, buyerId: string, amount: number, note: string): Promise<OfferResult> {
  const l = await getListing(db, listingId);
  if (!l || l.status !== 'open') return { status: 'not_open' };
  if (l.pricing !== 'offer') return { status: 'not_offer' };
  if (l.sellerId === buyerId) return { status: 'self' };
  if (!Number.isInteger(amount) || amount < 1 || amount > MARKET_PRICE_MAX || note.length > 300) return { status: 'invalid' };
  if (amount < l.price) return { status: 'too_low' };
  if (!(await adultPair(db, l.category, buyerId, l.sellerId))) return { status: 'adult_only' };
  const balance = (await walletOf(db, buyerId)).balance;
  if (balance < amount) return { status: 'insufficient', balance };
  return db.transaction(async (tx) => {
    await tx
      .update(marketOffers)
      .set({ status: 'cancelled', decidedAt: new Date() })
      .where(and(eq(marketOffers.listingId, listingId), eq(marketOffers.buyerId, buyerId), eq(marketOffers.status, 'pending')));
    const [offer] = await tx.insert(marketOffers).values({ listingId, buyerId, sellerId: l.sellerId, amount, note: note.trim() }).returning();
    return { status: 'ok' as const, offer: offer! };
  });
}

export async function getOffer(db: Db, id: number): Promise<MarketOffer | undefined> {
  const [row] = await db.select().from(marketOffers).where(eq(marketOffers.id, id));
  return row;
}

export async function pendingOffers(db: Db, listingId: number): Promise<MarketOffer[]> {
  return db
    .select()
    .from(marketOffers)
    .where(and(eq(marketOffers.listingId, listingId), eq(marketOffers.status, 'pending')))
    .orderBy(desc(marketOffers.amount), marketOffers.id)
    .limit(25);
}

export type AcceptResult =
  | { status: 'ok'; order: MarketOrder }
  | { status: 'gone' | 'not_open' | 'full' | 'forbidden' }
  | { status: 'insufficient' };

/** 提案を受ける（出品した人）。買いたい人の銭が足りなければ、提案は断ったことにする */
export async function acceptOffer(db: Db, cfg: GuildConfig, offerId: number, sellerId: string, now = new Date()): Promise<AcceptResult> {
  const offer = await getOffer(db, offerId);
  if (!offer || offer.status !== 'pending') return { status: 'gone' };
  if (offer.sellerId !== sellerId) return { status: 'forbidden' };
  const l = await getListing(db, offer.listingId);
  if (!l || l.status !== 'open') return { status: 'not_open' };
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'market-listing:' + l.id}))`);
    if (l.capacity > 0 && (await activeOrders(tx, l.id)) >= l.capacity) return { status: 'full' as const };
    const [held] = await tx.update(marketOffers).set({ status: 'accepted', decidedAt: now }).where(and(eq(marketOffers.id, offerId), eq(marketOffers.status, 'pending'))).returning();
    if (!held) return { status: 'gone' as const };
    const order = await startOrder(tx, cfg, { listingId: l.id, buyerId: offer.buyerId, sellerId: l.sellerId, price: offer.amount, title: l.title }, now);
    if (!order) {
      await tx.update(marketOffers).set({ status: 'declined', decidedAt: now }).where(eq(marketOffers.id, offerId));
      return { status: 'insufficient' as const };
    }
    await tx.update(marketOffers).set({ orderId: order.id }).where(eq(marketOffers.id, offerId));
    return { status: 'ok' as const, order };
  });
}

/** 断る（出品した人）・取り下げる（出した人） */
export async function declineOffer(db: Db, offerId: number, by: string): Promise<MarketOffer | undefined> {
  const offer = await getOffer(db, offerId);
  if (!offer || (offer.sellerId !== by && offer.buyerId !== by)) return undefined;
  const [row] = await db
    .update(marketOffers)
    .set({ status: offer.sellerId === by ? 'declined' : 'cancelled', decidedAt: new Date() })
    .where(and(eq(marketOffers.id, offerId), eq(marketOffers.status, 'pending')))
    .returning();
  return row;
}

/** 返事のないまま OFFER_DAYS 日たった提案・受付を終えた出品への提案を取り下げる */
export async function expireOffers(db: Db, now = new Date()): Promise<MarketOffer[]> {
  const old = new Date(now.getTime() - OFFER_DAYS * DAY);
  const closed = db.select({ id: marketListings.id }).from(marketListings).where(ne(marketListings.status, 'open'));
  return db
    .update(marketOffers)
    .set({ status: 'expired', decidedAt: now })
    .where(and(eq(marketOffers.status, 'pending'), sql`(${marketOffers.createdAt} <= ${old} or ${marketOffers.listingId} in (${closed}))`))
    .returning();
}

// ───────── 📞 今すぐ通話 OK ─────────

/** 待機中にする（STANDBY_MINUTES 分）・やめる。通話の出品だけ */
export async function setStandby(db: Db, listingId: number, sellerId: string, on: boolean, now = new Date()): Promise<MarketListing | undefined> {
  const [row] = await db
    .update(marketListings)
    .set({ standbyUntil: on ? new Date(now.getTime() + STANDBY_MINUTES * 60_000) : null, updatedAt: now })
    .where(and(eq(marketListings.id, listingId), eq(marketListings.sellerId, sellerId), eq(marketListings.status, 'open'), eq(marketListings.category, 'call')))
    .returning();
  return row;
}

export const isStandby = (l: Pick<MarketListing, 'standbyUntil'>, now = new Date()) => Boolean(l.standbyUntil && l.standbyUntil > now);

/** 今すぐ通話できる出品（待機の残りが長い順） */
export async function standbyListings(db: Db, now = new Date()): Promise<MarketListing[]> {
  return db
    .select()
    .from(marketListings)
    .where(and(eq(marketListings.status, 'open'), sql`${marketListings.standbyUntil} > ${now}`))
    .orderBy(desc(marketListings.standbyUntil))
    .limit(20);
}

/** 待機の時間が切れた出品（カードを直すため。消してから返す） */
export async function expireStandby(db: Db, now = new Date()): Promise<MarketListing[]> {
  return db
    .update(marketListings)
    .set({ standbyUntil: null })
    .where(and(isNotNull(marketListings.standbyUntil), lte(marketListings.standbyUntil, now)))
    .returning();
}

// ───────── ⭐ 評価 ─────────

export type RateResult = { status: 'ok'; order: MarketOrder } | { status: 'forbidden' | 'not_done' | 'already' | 'invalid' };

/** 評価する（買った人・取引が終わってから・1 回だけ） */
export async function rateOrder(db: Db, orderId: number, buyerId: string, rating: number, review: string, now = new Date()): Promise<RateResult> {
  const o = await getOrder(db, orderId);
  if (!o || o.buyerId !== buyerId) return { status: 'forbidden' };
  if (o.status !== 'completed') return { status: 'not_done' };
  if (o.rating !== null) return { status: 'already' };
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || review.length > 200) return { status: 'invalid' };
  const [row] = await db
    .update(marketOrders)
    .set({ rating, review: review.trim() || null, ratedAt: now })
    .where(and(eq(marketOrders.id, orderId), sql`${marketOrders.rating} is null`))
    .returning();
  return row ? { status: 'ok', order: row } : { status: 'already' };
}

/** 売った人の評価（平均と件数） */
export async function sellerRating(db: Db, sellerId: string): Promise<{ avg: number; count: number }> {
  const [row] = await db
    .select({ avg: avg(marketOrders.rating), n: count(marketOrders.rating) })
    .from(marketOrders)
    .where(and(eq(marketOrders.sellerId, sellerId), isNotNull(marketOrders.rating)));
  return { avg: row?.avg ? Number(row.avg) : 0, count: row?.n ?? 0 };
}

export async function recentReviews(db: Db, sellerId: string, limit = 5): Promise<MarketOrder[]> {
  return db
    .select()
    .from(marketOrders)
    .where(and(eq(marketOrders.sellerId, sellerId), isNotNull(marketOrders.rating)))
    .orderBy(desc(marketOrders.ratedAt))
    .limit(limit);
}

// ───────── 📅 予定・🚫 来なかった ─────────

/** 通話の予定を決める（買った人・売った人。預かり中だけ） */
export async function scheduleOrder(db: Db, orderId: number, by: string, at: Date): Promise<MarketOrder | undefined> {
  const o = await getOrder(db, orderId);
  if (!o || (o.buyerId !== by && o.sellerId !== by) || o.status !== 'paid') return undefined;
  const [row] = await db.update(marketOrders).set({ scheduledAt: at }).where(eq(marketOrders.id, orderId)).returning();
  return row;
}

export type NoShowResult = { status: 'ok'; order: MarketOrder } | { status: 'forbidden' | 'not_call' | 'not_paid' } | { status: 'too_early'; at: Date };

/** 🚫 来なかった（買った人・通話・予定の NOSHOW_MINUTES 分あと）。運営が確かめる */
export async function reportNoShow(db: Db, orderId: number, buyerId: string, now = new Date()): Promise<NoShowResult> {
  const o = await getOrder(db, orderId);
  if (!o || o.buyerId !== buyerId) return { status: 'forbidden' };
  if (o.status !== 'paid') return { status: 'not_paid' };
  if ((await orderInfo(db, o)).category !== 'call') return { status: 'not_call' };
  if (o.scheduledAt) {
    const at = new Date(o.scheduledAt.getTime() + NOSHOW_MINUTES * 60_000);
    if (now < at) return { status: 'too_early', at };
  }
  const d = await disputeOrder(db, orderId, 'noshow');
  return d ? { status: 'ok', order: d } : { status: 'not_paid' };
}

/** 「10/5 21:00」「21:00」（今日・過ぎていれば明日）を日本時間の時刻に */
export function parseJstTime(raw: string, now = new Date()): Date | undefined {
  const t = raw.trim().replace(/[０-９：／]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const m = /^(?:(\d{1,2})[/月](\d{1,2})日?\s*)?(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return undefined;
  const jst = new Date(now.getTime() + 9 * 3_600_000);
  let year = jst.getUTCFullYear();
  const month = m[1] ? Number(m[1]) : jst.getUTCMonth() + 1;
  const day = m[2] ? Number(m[2]) : jst.getUTCDate();
  const [h, min] = [Number(m[3]), Number(m[4])];
  if (month < 1 || month > 12 || day < 1 || day > 31 || h > 23 || min > 59) return undefined;
  let at = new Date(Date.UTC(year, month - 1, day, h - 9, min));
  if (m[1] && at.getTime() < now.getTime() - 30 * DAY) at = new Date(Date.UTC(++year, month - 1, day, h - 9, min));
  if (!m[1] && at <= now) at = new Date(at.getTime() + DAY);
  return at;
}

// ───────── 📝 依頼の募集 ─────────

export type RequestResult = { status: 'ok'; request: MarketRequest } | { status: 'invalid' | 'adult_only' | 'too_many' };
/** 1 人が同時に出せる依頼 */
export const REQUESTS_PER_MEMBER = 3;

export async function createRequest(
  db: Db,
  requesterId: string,
  input: { category: string; subcategory?: string | null; title: string; description: string; budget: number; imageUrl?: string | null },
): Promise<RequestResult> {
  const title = input.title.trim();
  if (!isMarketCategory(input.category) || !title || title.length > 60 || input.description.length > 1000) return { status: 'invalid' };
  if (!Number.isInteger(input.budget) || input.budget < 1 || input.budget > MARKET_PRICE_MAX) return { status: 'invalid' };
  if (MARKET_CATEGORIES[input.category].adultOnly && !(await isAdult(db, requesterId))) return { status: 'adult_only' };
  const [open] = await db
    .select({ n: count() })
    .from(marketRequests)
    .where(and(eq(marketRequests.requesterId, requesterId), eq(marketRequests.status, 'open')));
  if ((open?.n ?? 0) >= REQUESTS_PER_MEMBER) return { status: 'too_many' };
  const [request] = await db
    .insert(marketRequests)
    .values({
      requesterId,
      category: input.category,
      subcategory: input.category === 'call' ? (isCallKind(input.subcategory) ? input.subcategory : 'other') : null,
      title,
      description: input.description.trim(),
      budget: input.budget,
      imageUrl: input.imageUrl ?? null,
    })
    .returning();
  return { status: 'ok', request: request! };
}

export async function getRequest(db: Db, id: number): Promise<MarketRequest | undefined> {
  const [row] = await db.select().from(marketRequests).where(eq(marketRequests.id, id));
  return row;
}

export async function setRequestMessage(db: Db, id: number, channelId: string, messageId: string): Promise<void> {
  await db.update(marketRequests).set({ channelId, messageId }).where(eq(marketRequests.id, id));
}

export async function setImage(db: Db, kind: 'listing' | 'request', id: number, imageUrl: string | null): Promise<void> {
  if (kind === 'listing') await db.update(marketListings).set({ imageUrl, updatedAt: new Date() }).where(eq(marketListings.id, id));
  else await db.update(marketRequests).set({ imageUrl, updatedAt: new Date() }).where(eq(marketRequests.id, id));
}

/** 締め切る（依頼した人・運営）。手を挙げた人は断ったことに */
export async function closeRequest(db: Db, id: number): Promise<MarketRequest | undefined> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(marketRequests)
      .set({ status: 'closed', updatedAt: new Date() })
      .where(and(eq(marketRequests.id, id), eq(marketRequests.status, 'open')))
      .returning();
    if (row) await tx.update(marketBids).set({ status: 'declined' }).where(and(eq(marketBids.requestId, id), eq(marketBids.status, 'pending')));
    return row;
  });
}

export type BidResult = { status: 'ok'; bid: MarketBid; again: boolean } | { status: 'not_open' | 'self' | 'no_license' | 'adult_only' | 'invalid' };

/** ✋ 手を挙げる（開業権利のある人。もう挙げていれば値段と一言を直す） */
export async function bidRequest(
  db: Db,
  cfg: GuildConfig,
  requestId: number,
  seller: { id: string; roleIds: readonly string[] },
  amount: number,
  note: string,
): Promise<BidResult> {
  const r = await getRequest(db, requestId);
  if (!r || r.status !== 'open') return { status: 'not_open' };
  if (r.requesterId === seller.id) return { status: 'self' };
  const merchant = cfg.roles.merchant;
  if (!merchant || !seller.roleIds.includes(merchant)) return { status: 'no_license' };
  if (!Number.isInteger(amount) || amount < 1 || amount > MARKET_PRICE_MAX || note.length > 300) return { status: 'invalid' };
  if (!(await adultPair(db, r.category, r.requesterId, seller.id))) return { status: 'adult_only' };
  const [before] = await db.select().from(marketBids).where(and(eq(marketBids.requestId, requestId), eq(marketBids.sellerId, seller.id)));
  const [bid] = await db
    .insert(marketBids)
    .values({ requestId, sellerId: seller.id, amount, note: note.trim() })
    .onConflictDoUpdate({ target: [marketBids.requestId, marketBids.sellerId], set: { amount, note: note.trim(), status: 'pending' } })
    .returning();
  return { status: 'ok', bid: bid!, again: Boolean(before) };
}

export async function requestBids(db: Db, requestId: number): Promise<MarketBid[]> {
  return db
    .select()
    .from(marketBids)
    .where(and(eq(marketBids.requestId, requestId), eq(marketBids.status, 'pending')))
    .orderBy(marketBids.amount, marketBids.id)
    .limit(25);
}

export async function getBid(db: Db, id: number): Promise<MarketBid | undefined> {
  const [row] = await db.select().from(marketBids).where(eq(marketBids.id, id));
  return row;
}

/** 手を挙げた人にお願いする（依頼した人）。その値段で銭を預かって取引を始め、ほかの人は断ったことに */
export async function acceptBid(db: Db, cfg: GuildConfig, bidId: number, requesterId: string, now = new Date()): Promise<AcceptResult> {
  const bid = await getBid(db, bidId);
  if (!bid || bid.status !== 'pending') return { status: 'gone' };
  const r = await getRequest(db, bid.requestId);
  if (!r) return { status: 'gone' };
  if (r.requesterId !== requesterId) return { status: 'forbidden' };
  if (r.status !== 'open') return { status: 'not_open' };
  return db.transaction(async (tx) => {
    const [held] = await tx.update(marketRequests).set({ status: 'matched', updatedAt: now }).where(and(eq(marketRequests.id, r.id), eq(marketRequests.status, 'open'))).returning();
    if (!held) return { status: 'not_open' as const };
    const order = await startOrder(tx, cfg, { listingId: 0, requestId: r.id, buyerId: requesterId, sellerId: bid.sellerId, price: bid.amount, title: r.title }, now);
    if (!order) throw new NotEnough();
    await tx.update(marketBids).set({ status: 'accepted', orderId: order.id }).where(eq(marketBids.id, bidId));
    await tx.update(marketBids).set({ status: 'declined' }).where(and(eq(marketBids.requestId, r.id), eq(marketBids.status, 'pending')));
    return { status: 'ok' as const, order };
  }).catch((err: unknown) => {
    if (err instanceof NotEnough) return { status: 'insufficient' as const };
    throw err;
  });
}

class NotEnough extends Error {}

/** 依頼に手を挙げている数 */
export async function bidCount(db: Db, requestId: number): Promise<number> {
  const [row] = await db.select({ n: count() }).from(marketBids).where(and(eq(marketBids.requestId, requestId), eq(marketBids.status, 'pending')));
  return row?.n ?? 0;
}

export async function recentRequests(db: Db, limit = 100): Promise<MarketRequest[]> {
  return db.select().from(marketRequests).orderBy(desc(marketRequests.createdAt)).limit(limit);
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

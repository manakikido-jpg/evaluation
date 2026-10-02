import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GuildConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { members } from '../src/db/schema.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import {
  acceptBid,
  acceptOffer,
  autoReleaseOrders,
  bidCount,
  bidRequest,
  buyListing,
  closeListing,
  closeRequest,
  createListing,
  createRequest,
  declineOffer,
  disputeOrder,
  expireOffers,
  expireStandby,
  feeOf,
  getListing,
  getRequest,
  isStandby,
  kindLabel,
  makeOffer,
  parseJstTime,
  pendingOffers,
  rateOrder,
  recentOrders,
  refundOrder,
  releaseOrder,
  reportNoShow,
  requestBids,
  scheduleOrder,
  sellerRating,
  setStandby,
  standbyListings,
} from '../src/services/market.js';
import { listingCard, toAmount } from '../src/discord/market.js';
import { cfg as baseCfg, makeDb } from './helpers.js';

const MERCHANT = '100000000000000077';
const SELLER = '830000000000000001';
const BUYER = '830000000000000002';
const BUYER2 = '830000000000000003';
const T0 = new Date('2026-09-26T12:00:00Z');
const DAY = 86_400_000;

const cfg: GuildConfig = { ...baseCfg, roles: { ...baseCfg.roles, merchant: MERCHANT }, market: { feePercent: 10, autoReleaseDays: 7 } };
const seller = { id: SELLER, roleIds: [MERCHANT] };
const item = { category: 'illust', title: 'アイコン描きます', description: '1 枚', price: 1000 };

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  await db.insert(members).values([
    { id: SELLER, username: 's', displayName: 's', ageGroup: 'adult' },
    { id: BUYER, username: 'b', displayName: 'b', ageGroup: 'adult' },
    { id: BUYER2, username: 'c', displayName: 'c', ageGroup: 'adult' },
  ]);
});
afterEach(async () => {
  await close();
});

const listed = async () => {
  const r = await createListing(db, cfg, seller, item);
  if (r.status !== 'ok') throw new Error(r.status);
  return r.listing;
};
const bought = async () => {
  const l = await listed();
  await addCoins(db, BUYER, 5000, 'adjust');
  const r = await buyListing(db, cfg, l.id, BUYER, T0);
  if (r.status !== 'ok') throw new Error(r.status);
  return r.order;
};

describe('出品', () => {
  it('開業ロールがないと出せない。開業ロールの設定がなければ使えない', async () => {
    expect((await createListing(db, cfg, { id: SELLER, roleIds: [] }, item)).status).toBe('no_license');
    expect((await createListing(db, { ...cfg, roles: baseCfg.roles }, seller, item)).status).toBe('disabled');
    expect((await createListing(db, cfg, seller, item)).status).toBe('ok');
  });

  it('おかしな内容は断る（種類・題名・値段）', async () => {
    expect((await createListing(db, cfg, seller, { ...item, category: 'adult' })).status).toBe('invalid');
    expect((await createListing(db, cfg, seller, { ...item, title: '  ' })).status).toBe('invalid');
    expect((await createListing(db, cfg, seller, { ...item, title: 'あ'.repeat(61) })).status).toBe('invalid');
    expect((await createListing(db, cfg, seller, { ...item, price: 0 })).status).toBe('invalid');
    expect((await createListing(db, cfg, seller, { ...item, price: 1.5 })).status).toBe('invalid');
    expect((await createListing(db, cfg, seller, { ...item, price: 1_000_001 })).status).toBe('invalid');
  });

  it('通話は 18 歳以上だけが出せる・買える', async () => {
    await db.update(members).set({ ageGroup: 'minor' });
    expect((await createListing(db, cfg, seller, { ...item, category: 'call' })).status).toBe('adult_only');
    await db.update(members).set({ ageGroup: 'adult' });
    const r = await createListing(db, cfg, seller, { ...item, category: 'call' });
    if (r.status !== 'ok') throw new Error(r.status);
    await addCoins(db, BUYER, 5000, 'adjust');
    await db.update(members).set({ ageGroup: 'unknown' }).where(eq(members.id, BUYER));
    expect((await buyListing(db, cfg, r.listing.id, BUYER, T0)).status).toBe('adult_only');
    expect((await walletOf(db, BUYER)).balance).toBe(5000);
  });

  it('受付を終えると買えない（本人は closed・運営は removed）', async () => {
    const l = await listed();
    expect((await closeListing(db, l.id, 'staff'))?.status).toBe('removed');
    expect(await closeListing(db, l.id, 'seller')).toBeUndefined();
    await addCoins(db, BUYER, 5000, 'adjust');
    expect((await buyListing(db, cfg, l.id, BUYER, T0)).status).toBe('not_open');
    expect((await getListing(db, l.id))?.status).toBe('removed');
  });
});

describe('買う・受け取る', () => {
  it('自分のものは買えない。足りなければ買えない', async () => {
    const l = await listed();
    expect((await buyListing(db, cfg, l.id, SELLER, T0)).status).toBe('self');
    await addCoins(db, BUYER, 999, 'adjust');
    expect(await buyListing(db, cfg, l.id, BUYER, T0)).toMatchObject({ status: 'insufficient', price: 1000, balance: 999 });
  });

  it('買うと預かり、受け取ったら手数料を引いて売った人へ。2 回は渡さない', async () => {
    const o = await bought();
    expect(o).toMatchObject({ price: 1000, fee: 100, status: 'paid' });
    expect(o.autoReleaseAt?.getTime()).toBe(T0.getTime() + 7 * DAY);
    expect((await walletOf(db, BUYER)).balance).toBe(4000);
    expect((await walletOf(db, SELLER)).balance).toBe(0);
    expect((await releaseOrder(db, o.id, BUYER))?.status).toBe('completed');
    expect(await releaseOrder(db, o.id, BUYER)).toBeUndefined();
    expect(await refundOrder(db, o.id, 'staff')).toBeUndefined();
    expect((await walletOf(db, SELLER)).balance).toBe(900);
  });

  it('手数料は切り捨て。0% なら全部', () => {
    expect(feeOf(cfg, 999)).toBe(99);
    expect(feeOf({ ...cfg, market: { feePercent: 0, autoReleaseDays: 7 } }, 999)).toBe(0);
  });

  it('問題ありは期限で渡さない。運営が返すと買った人に全額戻る', async () => {
    const o = await bought();
    expect((await disputeOrder(db, o.id))?.status).toBe('disputed');
    expect(await autoReleaseOrders(db, new Date(T0.getTime() + 30 * DAY))).toEqual([]);
    expect((await recentOrders(db))[0]?.status).toBe('disputed');
    expect((await refundOrder(db, o.id, 'staff'))?.status).toBe('refunded');
    expect((await walletOf(db, BUYER)).balance).toBe(5000);
    expect((await walletOf(db, SELLER)).balance).toBe(0);
  });

  it('期限が来た預かりは売った人へ渡す（期限前は渡さない）', async () => {
    const o = await bought();
    expect(await autoReleaseOrders(db, new Date(T0.getTime() + 6 * DAY))).toEqual([]);
    const done = await autoReleaseOrders(db, new Date(T0.getTime() + 7 * DAY));
    expect(done.map((d) => [d.id, d.decidedBy])).toEqual([[o.id, 'system']]);
    expect((await walletOf(db, SELLER)).balance).toBe(900);
  });
});

const desc = (card: ReturnType<typeof listingCard>) => card.embeds[0]!.description;
const ids = (card: ReturnType<typeof listingCard>) => card.components.flatMap((r) => r.toJSON().components.map((b) => ('custom_id' in b ? b.custom_id : undefined)));

describe('💬 値段の提案', () => {
  const offerItem = { ...item, pricing: 'offer' as const, price: 500 };
  const offerListed = async () => {
    const r = await createListing(db, cfg, seller, offerItem);
    if (r.status !== 'ok') throw new Error(r.status);
    return r.listing;
  };

  it('最低額より下・自分・足りないときは出せない。「買う」では買えない', async () => {
    const l = await offerListed();
    await addCoins(db, BUYER, 1000, 'adjust');
    expect((await buyListing(db, cfg, l.id, BUYER, T0)).status).toBe('offer_only');
    expect((await makeOffer(db, l.id, BUYER, 499, '')).status).toBe('too_low');
    expect((await makeOffer(db, l.id, SELLER, 600, '')).status).toBe('self');
    expect(await makeOffer(db, l.id, BUYER, 1500, '')).toMatchObject({ status: 'insufficient', balance: 1000 });
    expect((await makeOffer(db, (await listed()).id, BUYER, 1000, '')).status).toBe('not_offer');
  });

  it('出し直すと前の提案は取り下げ。受けると、その値段で預かって取引に。ほかの提案は残る', async () => {
    const l = await offerListed();
    await addCoins(db, BUYER, 2000, 'adjust');
    await addCoins(db, BUYER2, 2000, 'adjust');
    await makeOffer(db, l.id, BUYER, 600, '');
    const again = await makeOffer(db, l.id, BUYER, 800, '明日の夜に');
    await makeOffer(db, l.id, BUYER2, 700, '');
    if (again.status !== 'ok') throw new Error(again.status);
    expect((await pendingOffers(db, l.id)).map((o) => [o.buyerId, o.amount])).toEqual([
      [BUYER, 800],
      [BUYER2, 700],
    ]);
    expect((await acceptOffer(db, cfg, again.offer.id, BUYER2, T0)).status).toBe('forbidden');
    const r = await acceptOffer(db, cfg, again.offer.id, SELLER, T0);
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.order).toMatchObject({ price: 800, fee: 80, buyerId: BUYER, status: 'paid' });
    expect((await walletOf(db, BUYER)).balance).toBe(1200);
    expect((await acceptOffer(db, cfg, again.offer.id, SELLER, T0)).status).toBe('gone');
    expect((await pendingOffers(db, l.id)).map((o) => o.buyerId)).toEqual([BUYER2]);
  });

  it('受けるときに銭が足りなければ、取り消しになる。断る・期限切れ', async () => {
    const l = await offerListed();
    await addCoins(db, BUYER, 1000, 'adjust');
    const o = await makeOffer(db, l.id, BUYER, 900, '');
    if (o.status !== 'ok') throw new Error(o.status);
    // ほかで使ってしまった
    const r = await createListing(db, cfg, seller, { ...item, price: 600 });
    expect(r.status === 'ok' && (await buyListing(db, cfg, r.listing.id, BUYER, T0)).status).toBe('ok');
    expect((await acceptOffer(db, cfg, o.offer.id, SELLER, T0)).status).toBe('insufficient');
    expect(await pendingOffers(db, l.id)).toEqual([]);
    expect((await walletOf(db, BUYER)).balance).toBe(400);
    await addCoins(db, BUYER, 100, 'adjust');

    const o2 = await makeOffer(db, l.id, BUYER, 500, '');
    if (o2.status !== 'ok') throw new Error(o2.status);
    expect((await declineOffer(db, o2.offer.id, BUYER2))).toBeUndefined();
    expect((await declineOffer(db, o2.offer.id, SELLER))?.status).toBe('declined');

    await makeOffer(db, l.id, BUYER, 500, '');
    expect(await expireOffers(db, new Date(Date.now() + 2 * DAY))).toEqual([]);
    expect((await expireOffers(db, new Date(Date.now() + 3 * DAY + 60_000))).map((x) => x.status)).toEqual(['expired']);
    // 受付を終えた出品への提案はすぐ取り下げ
    await makeOffer(db, l.id, BUYER, 500, '');
    await closeListing(db, l.id, 'seller');
    expect((await expireOffers(db)).length).toBe(1);
  });

  it('カードは「○○枚から」と「値段を提案する」', async () => {
    const card = listingCard(await offerListed(), cfg);
    expect(desc(card)).toContain('500 枚から');
    expect(ids(card)).toEqual(['market:offer:1', 'market:offers:1', 'market:close:1']);
  });
});

describe('⏳ 受付の上限', () => {
  it('上限まで取引が進んでいると買えない。終わるとまた買える', async () => {
    const r = await createListing(db, cfg, seller, { ...item, capacity: 1 });
    if (r.status !== 'ok') throw new Error(r.status);
    await addCoins(db, BUYER, 5000, 'adjust');
    await addCoins(db, BUYER2, 5000, 'adjust');
    const first = await buyListing(db, cfg, r.listing.id, BUYER, T0);
    if (first.status !== 'ok') throw new Error(first.status);
    expect((await buyListing(db, cfg, r.listing.id, BUYER2, T0)).status).toBe('full');
    expect(desc(listingCard(r.listing, cfg, { active: 1 }))).toContain('受付: 1 / 1 件（いまいっぱいです）');
    await releaseOrder(db, first.order.id, BUYER);
    expect((await buyListing(db, cfg, r.listing.id, BUYER2, T0)).status).toBe('ok');
    expect((await createListing(db, cfg, seller, { ...item, capacity: 21 })).status).toBe('invalid');
  });
});

describe('📞 今すぐ通話 OK', () => {
  it('通話の出品だけ、本人が 30 分待機中にできる。時間が来たら消える', async () => {
    const call = await createListing(db, cfg, seller, { ...item, category: 'call', subcategory: 'sleep' });
    if (call.status !== 'ok') throw new Error(call.status);
    expect(call.listing.subcategory).toBe('sleep');
    expect(kindLabel('call', 'sleep')).toBe('📞 通話・🌙 寝かしつけ');
    const illust = await listed();
    expect(await setStandby(db, illust.id, SELLER, true, T0)).toBeUndefined();
    expect(await setStandby(db, call.listing.id, BUYER, true, T0)).toBeUndefined();
    const on = await setStandby(db, call.listing.id, SELLER, true, T0);
    expect(on && isStandby(on, new Date(T0.getTime() + 29 * 60_000))).toBe(true);
    expect((await standbyListings(db, T0)).map((l) => l.id)).toEqual([call.listing.id]);
    const card = listingCard(on!, cfg, { now: T0 });
    expect(card.embeds[0]!.title.startsWith('🟢')).toBe(true);
    expect(ids(card)).toContain(`market:sb:${call.listing.id}`);
    expect(await expireStandby(db, new Date(T0.getTime() + 29 * 60_000))).toEqual([]);
    expect((await expireStandby(db, new Date(T0.getTime() + 30 * 60_000))).map((l) => l.id)).toEqual([call.listing.id]);
    expect(await standbyListings(db, T0)).toEqual([]);
  });

  it('通話の種類が分からなければ「その他」。通話以外は種類なし', async () => {
    const a = await createListing(db, cfg, seller, { ...item, category: 'call', subcategory: 'x' });
    const b = await createListing(db, cfg, seller, { ...item, subcategory: 'sleep' });
    expect(a.status === 'ok' && a.listing.subcategory).toBe('other');
    expect(b.status === 'ok' && b.listing.subcategory).toBeNull();
  });
});

describe('⭐ 評価', () => {
  it('買った人が、終わってから 1 回だけ。平均がカードに出る', async () => {
    const o = await bought();
    expect((await rateOrder(db, o.id, BUYER, 5, '')).status).toBe('not_done');
    await releaseOrder(db, o.id, BUYER);
    expect((await rateOrder(db, o.id, SELLER, 5, '')).status).toBe('forbidden');
    expect((await rateOrder(db, o.id, BUYER, 6, '')).status).toBe('invalid');
    expect((await rateOrder(db, o.id, BUYER, 4, ' よかった ')).status).toBe('ok');
    expect((await rateOrder(db, o.id, BUYER, 5, '')).status).toBe('already');
    const o2 = await buyListing(db, cfg, o.listingId, BUYER, T0);
    if (o2.status !== 'ok') throw new Error(o2.status);
    await releaseOrder(db, o2.order.id, BUYER);
    await rateOrder(db, o2.order.id, BUYER, 5, '');
    const rating = await sellerRating(db, SELLER);
    expect(rating).toEqual({ avg: 4.5, count: 2 });
    expect(desc(listingCard((await getListing(db, o.listingId))!, cfg, { rating }))).toContain('⭐ **4.5**（2 件）');
  });
});

describe('🚫 すっぽかし', () => {
  it('通話の取引で、予定の 10 分あとから買った人が押せる。運営が確かめるまで渡さない', async () => {
    const call = await createListing(db, cfg, seller, { ...item, category: 'call' });
    if (call.status !== 'ok') throw new Error(call.status);
    await addCoins(db, BUYER, 5000, 'adjust');
    const r = await buyListing(db, cfg, call.listing.id, BUYER, T0);
    if (r.status !== 'ok') throw new Error(r.status);
    const at = new Date(T0.getTime() + 3_600_000);
    expect(await scheduleOrder(db, r.order.id, BUYER2, at)).toBeUndefined();
    expect((await scheduleOrder(db, r.order.id, SELLER, at))?.scheduledAt?.getTime()).toBe(at.getTime());
    expect((await reportNoShow(db, r.order.id, SELLER, at)).status).toBe('forbidden');
    expect(await reportNoShow(db, r.order.id, BUYER, new Date(at.getTime() + 9 * 60_000))).toMatchObject({ status: 'too_early' });
    const ns = await reportNoShow(db, r.order.id, BUYER, new Date(at.getTime() + 10 * 60_000));
    expect(ns.status === 'ok' && [ns.order.status, ns.order.disputeKind]).toEqual(['disputed', 'noshow']);
    expect(await autoReleaseOrders(db, new Date(T0.getTime() + 30 * DAY))).toEqual([]);
    expect((await refundOrder(db, r.order.id, 'staff'))?.status).toBe('refunded');
    expect((await walletOf(db, BUYER)).balance).toBe(5000);
  });

  it('通話でない取引では押せない', async () => {
    const o = await bought();
    expect((await reportNoShow(db, o.id, BUYER, T0)).status).toBe('not_call');
  });

  it('日時の読み取り（日本時間）', () => {
    const now = new Date('2026-10-01T12:00:00Z'); // 21:00 JST
    expect(parseJstTime('10/5 21:00', now)?.toISOString()).toBe('2026-10-05T12:00:00.000Z');
    expect(parseJstTime('２２：３０', now)?.toISOString()).toBe('2026-10-01T13:30:00.000Z');
    expect(parseJstTime('20:00', now)?.toISOString()).toBe('2026-10-02T11:00:00.000Z');
    expect(parseJstTime('1/3 9:00', now)?.toISOString()).toBe('2027-01-03T00:00:00.000Z');
    expect(parseJstTime('25:00', now)).toBeUndefined();
    expect(parseJstTime('あした', now)).toBeUndefined();
  });
});

describe('📝 依頼の募集', () => {
  const req = { category: 'illust', title: '立ち絵がほしい', description: '', budget: 1500 };

  it('だれでも出せる（1 人 3 件まで）。通話は 18 歳以上', async () => {
    for (let n = 0; n < 3; n++) expect((await createRequest(db, BUYER, req)).status).toBe('ok');
    expect((await createRequest(db, BUYER, req)).status).toBe('too_many');
    expect((await createRequest(db, BUYER, { ...req, budget: 0 })).status).toBe('invalid');
    await db.update(members).set({ ageGroup: 'minor' }).where(eq(members.id, BUYER2));
    expect((await createRequest(db, BUYER2, { ...req, category: 'call' })).status).toBe('adult_only');
  });

  it('開業権利のある人が手を挙げ（出し直しもできる）、依頼した人が選ぶとその値段で取引に', async () => {
    const r = await createRequest(db, BUYER, req);
    if (r.status !== 'ok') throw new Error(r.status);
    const id = r.request.id;
    expect((await bidRequest(db, cfg, id, { id: BUYER2, roleIds: [] }, 1000, '')).status).toBe('no_license');
    expect((await bidRequest(db, cfg, id, { id: BUYER, roleIds: [MERCHANT] }, 1000, '')).status).toBe('self');
    expect((await bidRequest(db, cfg, id, seller, 1400, '')).status).toBe('ok');
    const again = await bidRequest(db, cfg, id, seller, 1200, '3 日で');
    expect(again.status === 'ok' && again.again).toBe(true);
    await bidRequest(db, cfg, id, { id: BUYER2, roleIds: [MERCHANT] }, 1300, '');
    expect(await bidCount(db, id)).toBe(2);
    const bids = await requestBids(db, id);
    expect(bids.map((b) => [b.sellerId, b.amount])).toEqual([
      [SELLER, 1200],
      [BUYER2, 1300],
    ]);
    expect((await acceptBid(db, cfg, bids[0]!.id, BUYER, T0)).status).toBe('insufficient');
    expect((await getRequest(db, id))?.status).toBe('open');
    await addCoins(db, BUYER, 2000, 'adjust');
    expect((await acceptBid(db, cfg, bids[0]!.id, SELLER, T0)).status).toBe('forbidden');
    const ok = await acceptBid(db, cfg, bids[0]!.id, BUYER, T0);
    if (ok.status !== 'ok') throw new Error(ok.status);
    expect(ok.order).toMatchObject({ requestId: id, listingId: 0, sellerId: SELLER, price: 1200, fee: 120 });
    expect((await walletOf(db, BUYER)).balance).toBe(800);
    expect((await getRequest(db, id))?.status).toBe('matched');
    expect(await requestBids(db, id)).toEqual([]);
    expect((await acceptBid(db, cfg, bids[1]!.id, BUYER, T0)).status).toBe('gone');
    await releaseOrder(db, ok.order.id, BUYER);
    expect((await walletOf(db, SELLER)).balance).toBe(1080);
  });

  it('締め切ると手を挙げられない', async () => {
    const r = await createRequest(db, BUYER, req);
    if (r.status !== 'ok') throw new Error(r.status);
    await bidRequest(db, cfg, r.request.id, seller, 1000, '');
    expect((await closeRequest(db, r.request.id))?.status).toBe('closed');
    expect(await requestBids(db, r.request.id)).toEqual([]);
    expect((await bidRequest(db, cfg, r.request.id, seller, 1000, '')).status).toBe('not_open');
  });
});

describe('数の読み取り', () => {
  it('全角・カンマ・「枚」を読む', () => {
    expect(toAmount('１,０００枚')).toBe(1000);
    expect(toAmount(' 500 銭')).toBe(500);
    expect(toAmount('')).toBeUndefined();
    expect(Number.isNaN(toAmount('たくさん'))).toBe(true);
  });
});

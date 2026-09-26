import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GuildConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { members } from '../src/db/schema.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import {
  autoReleaseOrders,
  buyListing,
  closeListing,
  createListing,
  disputeOrder,
  feeOf,
  getListing,
  recentOrders,
  refundOrder,
  releaseOrder,
} from '../src/services/market.js';
import { cfg as baseCfg, makeDb } from './helpers.js';

const MERCHANT = '100000000000000077';
const SELLER = '830000000000000001';
const BUYER = '830000000000000002';
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

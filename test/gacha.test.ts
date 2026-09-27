import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gachaSchema, type GuildConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { gachaDraws, members, tempVoice } from '../src/db/schema.js';
import { gachaMenu, prizeText, pullLine } from '../src/discord/gacha.js';
import { panelMessage } from '../src/discord/panels.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { drawGacha, gachaRates, gachaStateOf, gachaStats, pickTier, untilPity } from '../src/services/gacha.js';
import { buyListing, createListing, releaseOrder } from '../src/services/market.js';
import { changeRoomKind, payEntry, roomOf, startRoom } from '../src/services/rooms.js';
import { applyOverrides, overridesSchema } from '../src/services/settings.js';
import { buySimple, listItems, refund, seedDefaultItems } from '../src/services/shop.js';
import { addTickets, ticketLine, ticketsOf } from '../src/services/tickets.js';
import { cfg as baseCfg, makeDb } from './helpers.js';

const U = '830000000000000001';
const B = '830000000000000002';
const R1 = '100000000000000091';
const R2 = '100000000000000092';
const NEOCHI = '960000000000000001';
const YOIMIYA = '960000000000000002';
const ROOM = '961000000000000001';
const MERCHANT = '100000000000000077';
const T0 = new Date('2026-09-27T12:00:00Z');

const g = gachaSchema.parse({ roleIds: [R1, R2] });
const cfg: GuildConfig = {
  ...baseCfg,
  gacha: g,
  roles: { ...baseCfg.roles, merchant: MERCHANT },
  market: { feePercent: 10, autoReleaseDays: 7 },
  tempVoice: {
    hubs: [
      { channelId: NEOCHI, name: '🌙 {name}の宿坊' },
      { channelId: YOIMIYA, name: '🍶 {name}の部屋' },
    ],
  },
  rooms: { once: { public: 50, invite: 200, secret: 300, twoshot: 400 }, hourly: { public: 100, invite: 200, secret: 300, twoshot: 400 }, boosterDiscountPercent: 0 },
};

/** 決まった順に数を返す（運勢 → ロール選び、の順に使う） */
const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length]!;
};

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
});
afterEach(async () => {
  await close();
});

describe('物御籤の設定', () => {
  it('標準: 500 枚・天井 30・大吉 3 / 中吉 12 / 小吉 25 / 吉 60', () => {
    const d = gachaSchema.parse({});
    expect(d).toMatchObject({ enabled: true, price: 500, pity: 30, rates: { daikichi: 3, chukichi: 12, shokichi: 25, kichi: 60 } });
    expect(gachaRates(d)).toEqual({ daikichi: 3, chukichi: 12, shokichi: 25, kichi: 60 });
    expect(d.prizes.daikichi).toMatchObject({ role: true, ticket: 'room_free', count: 3 });
    expect(gachaSchema.safeParse({ rates: { daikichi: 0, chukichi: 0, shokichi: 0, kichi: 0 } }).success).toBe(false);
  });

  it('運勢は出やすさの順に決まる', () => {
    expect(pickTier(g, () => 0)).toBe('daikichi');
    expect(pickTier(g, () => 0.029)).toBe('daikichi');
    expect(pickTier(g, () => 0.031)).toBe('chukichi');
    expect(pickTier(g, () => 0.2)).toBe('shokichi');
    expect(pickTier(g, () => 0.99)).toBe('kichi');
  });

  it('管理画面の上書き（全部置きかえる）', () => {
    const o = overridesSchema.parse({ gacha: { price: 300, pity: 0, roleIds: [R1] } });
    const c = applyOverrides(baseCfg, o);
    expect(c.gacha).toMatchObject({ price: 300, pity: 0, roleIds: [R1], rates: { daikichi: 3 } });
    expect(applyOverrides(baseCfg, overridesSchema.parse({})).gacha.price).toBe(500);
  });
});

describe('引く', () => {
  it('花びらが足りなければ引けない（減らない）', async () => {
    await addCoins(db, U, 499, 'adjust');
    expect(await drawGacha(db, g, U, 1, [])).toEqual({ status: 'insufficient', price: 500, balance: 499 });
    expect(await drawGacha(db, g, U, 10, [])).toMatchObject({ status: 'insufficient', price: 5000 });
    expect(await drawGacha(db, { ...g, enabled: false }, U, 1, [])).toEqual({ status: 'disabled' });
    expect((await walletOf(db, U)).balance).toBe(499);
  });

  it('吉 → 絵馬のピン留め券、小吉 → 市場の手数料なし券、中吉 → 部屋代無料券', async () => {
    await addCoins(db, U, 1500, 'adjust');
    const r1 = await drawGacha(db, g, U, 1, [], () => 0.99);
    const r2 = await drawGacha(db, g, U, 1, [], () => 0.2);
    const r3 = await drawGacha(db, g, U, 1, [], () => 0.1);
    if (r1.status !== 'ok' || r2.status !== 'ok' || r3.status !== 'ok') throw new Error('draw');
    expect(r1.pulls[0]).toEqual({ tier: 'kichi', pity: false, ticket: 'ema_pin', count: 1, coins: 0 });
    expect(r2.pulls[0]).toMatchObject({ tier: 'shokichi', ticket: 'market_nofee' });
    expect(r3.pulls[0]).toMatchObject({ tier: 'chukichi', ticket: 'room_free' });
    expect(r3.tickets).toEqual({ room_free: 1, ema_pin: 1, market_nofee: 1 });
    expect(r3.balance).toBe(0);
    expect(await gachaStateOf(db, U)).toEqual({ sinceTop: 3, total: 3 });
  });

  it('大吉: まだ持っていない限定ロール。全部持っていたら部屋代無料券 ×3', async () => {
    await addCoins(db, U, 1500, 'adjust');
    const a = await drawGacha(db, g, U, 1, [R1], () => 0);
    if (a.status !== 'ok') throw new Error(a.status);
    expect(a.pulls[0]).toMatchObject({ tier: 'daikichi', roleId: R2, count: 0 });
    expect(a.pulls[0]?.ticket).toBeUndefined();
    const b = await drawGacha(db, g, U, 1, [R1, R2], () => 0);
    if (b.status !== 'ok') throw new Error(b.status);
    expect(b.pulls[0]).toMatchObject({ tier: 'daikichi', ticket: 'room_free', count: 3 });
    expect(b.pulls[0]?.roleId).toBeUndefined();
    // ロールを選んでいなければ券
    const c = await drawGacha(db, { ...g, roleIds: [] }, U, 1, [], () => 0);
    if (c.status !== 'ok') throw new Error(c.status);
    expect(c.pulls[0]).toMatchObject({ ticket: 'room_free', count: 3 });
    expect((await ticketsOf(db, U)).room_free).toBe(6);
  });

  it('10 連: 同じ回で同じロールは 2 回出ない。10 回分払う', async () => {
    await addCoins(db, U, 5000, 'adjust');
    const r = await drawGacha(db, g, U, 10, [], () => 0);
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.pulls).toHaveLength(10);
    const roles = r.pulls.map((p) => p.roleId).filter(Boolean);
    expect(new Set(roles).size).toBe(2);
    expect(r.pulls.filter((p) => p.ticket === 'room_free')).toHaveLength(8);
    expect(r.balance).toBe(0);
    expect(await db.select().from(gachaDraws)).toHaveLength(10);
    expect((await gachaStats(db)).byTier.daikichi).toBe(10);
  });

  it('天井: 大吉が出ないまま 30 回目は必ず大吉。出たら数え直し', async () => {
    await addCoins(db, U, 500 * 31, 'adjust');
    const r = await drawGacha(db, g, U, 10, [], () => 0.99);
    const r2 = await drawGacha(db, g, U, 10, [], () => 0.99);
    if (r.status !== 'ok' || r2.status !== 'ok') throw new Error('draw');
    expect(r2.sinceTop).toBe(20);
    expect(untilPity(g, r2.sinceTop)).toBe(10);
    const r3 = await drawGacha(db, g, U, 10, [], () => 0.99);
    if (r3.status !== 'ok') throw new Error(r3.status);
    expect(r3.pulls.slice(0, 9).every((p) => p.tier === 'kichi')).toBe(true);
    expect(r3.pulls[9]).toMatchObject({ tier: 'daikichi', pity: true });
    expect(r3.sinceTop).toBe(0);
    // 天井なし
    expect(untilPity({ pity: 0 }, 99)).toBeUndefined();
    const r4 = await drawGacha(db, { ...g, pity: 0 }, U, 1, [], () => 0.99);
    expect(r4.status === 'ok' && r4.pulls[0]?.tier).toBe('kichi');
  });

  it('おまけの花びら', async () => {
    await addCoins(db, U, 500, 'adjust');
    const gg = { ...g, prizes: { ...g.prizes, kichi: { role: false, ticket: 'none' as const, count: 0, coins: 100 } } };
    const r = await drawGacha(db, gg, U, 1, [], () => 0.99);
    expect(r).toMatchObject({ status: 'ok', balance: 100, pulls: [{ tier: 'kichi', coins: 100, count: 0 }] });
  });
});

describe('券を使う', () => {
  it('宿坊: 部屋代無料券でひらく → 種類を変えても払わない', async () => {
    await addTickets(db, U, 'room_free', 1);
    await db.insert(tempVoice).values({ channelId: ROOM, ownerId: U, hubId: NEOCHI, createdAt: T0 });
    expect(await startRoom(db, cfg, ROOM, T0)).toEqual({ status: 'ok', charged: 0, ticket: true });
    expect(await changeRoomKind(db, cfg, ROOM, 'secret')).toEqual({ status: 'ok', charged: 0 });
    expect((await roomOf(db, ROOM))?.freeTicket).toBe(true);
    expect((await ticketsOf(db, U)).room_free).toBe(0);
  });

  it('宿坊: 公開が無料なら、種類を選んで払うときに券を使う', async () => {
    await addTickets(db, U, 'room_free', 2);
    await db.insert(tempVoice).values({ channelId: ROOM, ownerId: U, hubId: NEOCHI, createdAt: T0 });
    const free = { ...cfg, rooms: { ...cfg.rooms, once: { ...cfg.rooms.once, public: 0 } } };
    expect(await startRoom(db, free, ROOM, T0)).toEqual({ status: 'ok', charged: 0 });
    expect(await changeRoomKind(db, free, ROOM, 'invite')).toEqual({ status: 'ok', charged: 0, ticket: true });
    expect((await ticketsOf(db, U)).room_free).toBe(1);
  });

  it('宵宮: 1 時間分を券で', async () => {
    await addTickets(db, B, 'room_free', 1);
    await db.insert(tempVoice).values({ channelId: ROOM, ownerId: U, hubId: YOIMIYA, createdAt: T0 });
    expect(await payEntry(db, cfg, ROOM, B, T0)).toEqual({ status: 'ok', charged: 0, ticket: true });
    expect(await payEntry(db, cfg, ROOM, B, T0)).toEqual({ status: 'already', charged: 0 });
    expect((await ticketsOf(db, B)).room_free).toBe(0);
  });

  it('市場: 手数料なし券があれば、売れたとき全部受け取る', async () => {
    await db.insert(members).values([
      { id: U, username: 's', displayName: 's', ageGroup: 'adult' },
      { id: B, username: 'b', displayName: 'b', ageGroup: 'adult' },
    ]);
    await addTickets(db, U, 'market_nofee', 1);
    const l = await createListing(db, cfg, { id: U, roleIds: [MERCHANT] }, { category: 'illust', title: 'アイコン', description: '1 枚', price: 1000 });
    if (l.status !== 'ok') throw new Error(l.status);
    await addCoins(db, B, 5000, 'adjust');
    const o = await buyListing(db, cfg, l.listing.id, B, T0);
    if (o.status !== 'ok') throw new Error(o.status);
    expect(o.order.fee).toBe(100);
    expect(await releaseOrder(db, o.order.id, B)).toMatchObject({ status: 'completed', fee: 0 });
    expect((await walletOf(db, U)).balance).toBe(1000);
    expect((await ticketsOf(db, U)).market_nofee).toBe(0);
  });

  it('絵馬の奉納: 絵馬のピン留め券で無料。失敗して戻すときは花びらは戻さない', async () => {
    await seedDefaultItems(db, { colors: [], titles: [] });
    const ema = (await listItems(db)).find((i) => i.kind === 'ema_pin')!;
    await addTickets(db, U, 'ema_pin', 1);
    const r = await buySimple(db, ema, U, { channelId: 'c', messageId: 'm' }, T0, 800);
    expect(r).toMatchObject({ status: 'ok', ticket: true, balance: 0 });
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.purchase.price).toBe(0);
    await refund(db, r.purchase);
    expect((await walletOf(db, U)).balance).toBe(0);
    // 券がなければ花びら
    expect(await buySimple(db, ema, U, {}, T0, 800)).toMatchObject({ status: 'insufficient', price: 800 });
  });
});

describe('物御籤の画面', () => {
  it('値段・割合・中身・天井・持っている券と、1 回 / 10 連のボタン', () => {
    const m = JSON.stringify(gachaMenu(g, { balance: 600, sinceTop: 25, tickets: { room_free: 2, ema_pin: 0, market_nofee: 0 } }, '🌸花びら'));
    for (const t of [
      '500',
      '5,000',
      '大吉',
      '3%',
      '60%',
      '限定の色守り・称号',
      'あと **5** 回',
      '部屋代無料券 ×2',
      'gacha:draw:1',
      'gacha:draw:10',
      '本物のお金は使いません',
    ])
      expect(m).toContain(t);
    // 10 連の分は足りないので押せない
    const menu = gachaMenu(g, { balance: 600, sinceTop: 0, tickets: { room_free: 0, ema_pin: 0, market_nofee: 0 } }, '🌸花びら');
    const buttons = menu.components[0]!.toJSON().components as { disabled?: boolean }[];
    expect(buttons.map((b) => Boolean(b.disabled))).toEqual([false, true]);
  });

  it('中身の説明・結果の一行・券の一行・パネル', () => {
    expect(prizeText(g.prizes.daikichi, 2)).toContain('全部持っていたら 🎫部屋代無料券 ×3');
    expect(prizeText(g.prizes.daikichi, 0)).toBe('🎫部屋代無料券 ×3');
    expect(pullLine({ tier: 'daikichi', pity: true, roleId: R1, count: 0, coins: 0 }, () => '金の桜')).toBe('🌸 **大吉**（天井） … 「金の桜」');
    expect(ticketLine({ room_free: 0, ema_pin: 1, market_nofee: 0 })).toBe('📌絵馬のピン留め券 ×1');
    expect(ticketLine({ room_free: 0, ema_pin: 0, market_nofee: 0 })).toBeUndefined();
    expect(JSON.stringify(panelMessage('gacha'))).toContain('gacha:open');
  });
});

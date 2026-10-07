import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gachaSchema, type GuildConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { gachaDraws, members, shopPurchases, tempVoice } from '../src/db/schema.js';
import { gachaMenu, pullLine, tierPrizeText } from '../src/discord/gacha.js';
import { panelMessage } from '../src/discord/panels.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import {
  createPrize,
  deletePrize,
  drawGacha,
  effectiveRates,
  ensureGachaPrizes,
  gachaRates,
  gachaStateOf,
  gachaStats,
  listPrizes,
  pickTier,
  prizeChances,
  untilPity,
  updatePrize,
} from '../src/services/gacha.js';
import { buyListing, createListing, releaseOrder } from '../src/services/market.js';
import { changeRoomKind, payEntry, roomOf, startRoom } from '../src/services/rooms.js';
import { applyOverrides, overridesSchema } from '../src/services/settings.js';
import { buySimple, listItems, refund, seedDefaultItems } from '../src/services/shop.js';
import { addTickets, emptyTickets, ticketLine, ticketsOf } from '../src/services/tickets.js';
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
    expect(d).toMatchObject({ enabled: true, price: 500, pity: 30, rates: { super: 0.01, daikichi: 3, chukichi: 12, shokichi: 25, kichi: 60 } });
    expect(gachaRates(d)).toEqual({ super: 0.01, daikichi: 3, chukichi: 12, shokichi: 25, kichi: 59.99 });
    // 前に保存した設定（超大当たりがない）も読める
    expect(gachaSchema.parse({ rates: { daikichi: 3, chukichi: 12, shokichi: 25, kichi: 60 } }).rates.super).toBe(0.01);
    expect(d.prizes.daikichi).toMatchObject({ role: true, ticket: 'room_free', count: 3 });
    expect(gachaSchema.safeParse({ rates: { super: 0, daikichi: 0, chukichi: 0, shokichi: 0, kichi: 0 } }).success).toBe(false);
  });

  it('運勢は出やすさの順に決まる', () => {
    expect(pickTier(g, () => 0)).toBe('super');
    expect(pickTier(g, () => 0.0002)).toBe('daikichi');
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
    expect(r1.pulls[0]).toMatchObject({ tier: 'kichi', pity: false, kind: 'ticket', ticket: 'ema_pin', count: 1, coins: 0 });
    expect(r2.pulls[0]).toMatchObject({ tier: 'shokichi', ticket: 'market_nofee' });
    expect(r3.pulls[0]).toMatchObject({ tier: 'chukichi', ticket: 'room_free' });
    expect(r3.tickets).toMatchObject({ room_free: 1, ema_pin: 1, market_nofee: 1 });
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
    // ロールの中身を消せば券
    for (const p of (await listPrizes(db)).filter((x) => x.kind === 'role')) await deletePrize(db, p.id);
    const c = await drawGacha(db, g, U, 1, [], () => 0);
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

describe('中身（社務所Web で変える）', () => {
  it('最初の中身は設定から 1 回だけ作る（全部消しても作り直さない）', async () => {
    await ensureGachaPrizes(db, g);
    const list = await listPrizes(db);
    expect(list.map((p) => [p.tier, p.kind, p.roleId ?? p.ticket, p.amount, p.fallback])).toEqual([
      ['daikichi', 'role', R1, 1, false],
      ['daikichi', 'role', R2, 1, false],
      ['daikichi', 'ticket', 'room_free', 3, true],
      ['chukichi', 'ticket', 'room_free', 1, false],
      ['shokichi', 'ticket', 'market_nofee', 1, false],
      ['kichi', 'ticket', 'ema_pin', 1, false],
    ]);
    for (const p of list) await deletePrize(db, p.id);
    await ensureGachaPrizes(db, g);
    expect(await listPrizes(db)).toEqual([]);
  });

  it('確率: 運勢の割合 × 重み。OFF の中身は出ない。中身のない運勢は出ない', async () => {
    await ensureGachaPrizes(db, g);
    const list = await listPrizes(db);
    const c = prizeChances(g, list);
    expect(list.map((p) => c.get(p.id))).toEqual([1.5, 1.5, 0, 12, 25, 60]);
    // 吉の中身を OFF → 吉は出ない（ほかの運勢で割り直す）
    const kichi = list.find((p) => p.tier === 'kichi')!;
    await updatePrize(db, kichi.id, { enabled: false });
    const off = await listPrizes(db);
    expect(effectiveRates(g, off)).toEqual({ super: 0, daikichi: 7.5, chukichi: 30, shokichi: 62.5, kichi: 0 });
    await addCoins(db, U, 500, 'adjust');
    const r = await drawGacha(db, g, U, 1, [], () => 0.99);
    expect(r).toMatchObject({ status: 'ok', pulls: [{ tier: 'shokichi' }] });
    // 重みで出やすさを変える
    const coins = await createPrize(db, { tier: 'chukichi', kind: 'coins', amount: 300, weight: 3, fallback: false });
    expect(prizeChances(g, await listPrizes(db)).get(coins.id)).toBe(22.5);
  });

  it('中身が全部 OFF なら引けない（花びらは減らない）', async () => {
    await ensureGachaPrizes(db, g);
    for (const p of await listPrizes(db)) await updatePrize(db, p.id, { enabled: false });
    await addCoins(db, U, 500, 'adjust');
    expect(await drawGacha(db, g, U, 1, [])).toEqual({ status: 'empty' });
    expect((await walletOf(db, U)).balance).toBe(500);
  });

  it('ロールだけの中身: 全部持ったら、残りの回数分は払い戻す', async () => {
    await ensureGachaPrizes(db, g);
    for (const p of await listPrizes(db)) await deletePrize(db, p.id);
    await createPrize(db, { tier: 'kichi', kind: 'role', roleId: R1, amount: 1, weight: 1, fallback: false });
    await createPrize(db, { tier: 'kichi', kind: 'role', roleId: R2, amount: 1, weight: 1, fallback: false });
    await addCoins(db, U, 5000, 'adjust');
    const r = await drawGacha(db, g, U, 10, [], () => 0.5);
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.pulls.map((p) => p.roleId).sort()).toEqual([R1, R2]);
    expect(r.refunded).toBe(8);
    expect(r.balance).toBe(4000);
    expect(await gachaStateOf(db, U)).toMatchObject({ total: 2 });
    expect(await drawGacha(db, g, U, 1, [R1, R2])).toEqual({ status: 'empty' });
  });

  it('ショップの品: 色守りは期限つきで記録し、前の色を外す。ずっと持つ称号は、持っていれば出ない', async () => {
    const SAKURA = '100000000000000081';
    const FUJI = '100000000000000082';
    const TITLE = '100000000000000083';
    await seedDefaultItems(db, {
      colors: [
        { roleId: SAKURA, name: '桜', emoji: '🌸' },
        { roleId: FUJI, name: '藤', emoji: '💜' },
      ],
      titles: [{ roleId: TITLE, name: '酒豪', emoji: '🍶' }],
    });
    const items = await listItems(db);
    const sakura = items.find((i) => i.roleId === SAKURA)!;
    const fuji = items.find((i) => i.roleId === FUJI)!;
    const title = items.find((i) => i.roleId === TITLE)!;
    await ensureGachaPrizes(db, g);
    for (const p of await listPrizes(db)) await deletePrize(db, p.id);
    const ps = await createPrize(db, { tier: 'kichi', kind: 'shop', shopItemId: sakura.id, amount: 1, weight: 1, fallback: false });
    await addCoins(db, U, 2000, 'adjust');
    const a = await drawGacha(db, g, U, 1, [], () => 0.5, T0);
    if (a.status !== 'ok') throw new Error(a.status);
    expect(a.pulls[0]).toMatchObject({ kind: 'shop', roleId: SAKURA, shopItemId: sakura.id, removeRoleIds: [] });
    expect(a.pulls[0]?.expiresAt?.getTime()).toBe(T0.getTime() + 30 * 86_400_000);
    // 藤に替えると、桜の記録は終わって外す
    await updatePrize(db, ps.id, { enabled: false });
    await createPrize(db, { tier: 'kichi', kind: 'shop', shopItemId: fuji.id, amount: 1, weight: 1, fallback: false });
    const b = await drawGacha(db, g, U, 1, [SAKURA], () => 0.5, T0);
    expect(b).toMatchObject({ status: 'ok', pulls: [{ roleId: FUJI, removeRoleIds: [SAKURA] }] });
    expect((await db.select().from(shopPurchases)).map((p) => [p.roleId, p.price, Boolean(p.endedAt)])).toEqual([
      [SAKURA, 0, true],
      [FUJI, 0, false],
    ]);
    // 称号（ずっと）を持っていれば出ない
    for (const p of await listPrizes(db)) await deletePrize(db, p.id);
    await createPrize(db, { tier: 'kichi', kind: 'shop', shopItemId: title.id, amount: 1, weight: 1, fallback: false });
    expect(await drawGacha(db, g, U, 1, [TITLE])).toEqual({ status: 'empty' });
  });
});

describe('🎊 超大当たり・運営が渡す賞品', () => {
  it('超大当たりに運営が渡す賞品を入れると 0.01% で出る。残りが 0 になったら出ない。当たりは記録して「渡した」にできる', async () => {
    const { listClaims, deliverClaim } = await import('../src/services/gacha.js');
    await ensureGachaPrizes(db, g);
    const nitro = await createPrize(db, { tier: 'super', kind: 'special', label: 'Discord Nitro 1 か月分', stock: 1, amount: 1, weight: 1, fallback: false });
    const list = await listPrizes(db);
    expect(prizeChances(g, list).get(nitro.id)).toBe(0.01);
    expect(effectiveRates(g, list).super).toBe(0.01);
    await addCoins(db, U, 1000, 'adjust');
    const r = await drawGacha(db, g, U, 1, [], () => 0);
    expect(r).toMatchObject({ status: 'ok', pulls: [{ tier: 'super', kind: 'special', special: { label: 'Discord Nitro 1 か月分' } }] });
    // 大吉ではないので天井は数え続ける
    expect(await gachaStateOf(db, U)).toMatchObject({ sinceTop: 1 });
    expect((await listPrizes(db)).find((p) => p.id === nitro.id)?.stock).toBe(0);
    expect(effectiveRates(g, await listPrizes(db)).super).toBe(0);
    // 残りがないので、次は超大当たりにならない
    const r2 = await drawGacha(db, g, U, 1, [], () => 0);
    expect(r2.status === 'ok' && r2.pulls[0]?.tier).toBe('daikichi');
    const claims = await listClaims(db);
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ memberId: U, label: 'Discord Nitro 1 か月分', deliveredAt: null });
    expect(await deliverClaim(db, claims[0]!.id, 'staff', T0)).toMatchObject({ deliveredBy: 'staff' });
    expect(await deliverClaim(db, claims[0]!.id, 'staff', T0)).toBeUndefined();
    expect(pullLine({ tier: 'super', pity: false, prizeId: 1, kind: 'special', special: { label: 'Nitro', claimId: 1 }, count: 0, coins: 0 }, () => 'x')).toBe(
      '🎊 **超大当たり** … 🎊 Nitro（運営からお渡しします）',
    );
  });
});

describe('リセット', () => {
  it('引いた分の銭を返し、出た券・銭・ロールを取り上げる（残っている分まで）。記録と天井は消える', async () => {
    const { gachaResetPreview, resetGacha } = await import('../src/services/gacha.js');
    const { useTicket } = await import('../src/services/tickets.js');
    await ensureGachaPrizes(db, g);
    await createPrize(db, { tier: 'kichi', kind: 'coins', amount: 100, weight: 1, fallback: false });
    await addCoins(db, U, 2000, 'adjust');
    // 大吉（ロール R1）・吉（絵馬券 か 100 銭）を 3 回
    await drawGacha(db, g, U, 1, [], () => 0);
    await drawGacha(db, g, U, 1, [R1], () => 0.99);
    await drawGacha(db, g, U, 1, [R1], seq(0.99, 0));
    const before = await gachaResetPreview(db);
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ memberId: U, draws: 3, refund: 1500, roleIds: [R1] });
    const t = await ticketsOf(db, U);
    // 券を 1 枚使ってしまっていたら、残っている分だけ取り上げる
    if (t.ema_pin > 0) await useTicket(db, U, 'ema_pin');
    const balanceBefore = (await walletOf(db, U)).balance;
    const r = await resetGacha(db, T0);
    expect(r).toMatchObject({ members: 1, draws: 3, refunded: 1500, removeRoles: [{ memberId: U, roleId: R1 }] });
    expect((await walletOf(db, U)).balance).toBe(balanceBefore + 1500 - r.coinsTaken);
    expect(await ticketsOf(db, U)).toMatchObject({ ema_pin: 0, room_free: 0 });
    expect(await gachaStateOf(db, U)).toEqual({ sinceTop: 0, total: 0 });
    expect(await gachaResetPreview(db)).toEqual([]);
    // 中身はそのまま
    expect((await listPrizes(db)).length).toBeGreaterThan(0);
  });
});

describe('券を使う', () => {
  it('宿坊: 部屋代無料券でひらく → 種類を変えても払わない', async () => {
    await addTickets(db, U, 'room_free', 1);
    await db.insert(tempVoice).values({ channelId: ROOM, ownerId: U, hubId: NEOCHI, createdAt: T0 });
    expect(await startRoom(db, cfg, ROOM, T0)).toEqual({ status: 'ok', charged: 0, ticket: true, ticketKind: 'room_free' });
    expect(await changeRoomKind(db, cfg, ROOM, 'secret')).toEqual({ status: 'ok', charged: 0 });
    expect((await roomOf(db, ROOM))?.freeTicket).toBe(true);
    expect((await ticketsOf(db, U)).room_free).toBe(0);
  });

  it('宿坊: 公開が無料なら、種類を選んで払うときに券を使う', async () => {
    await addTickets(db, U, 'room_free', 2);
    await db.insert(tempVoice).values({ channelId: ROOM, ownerId: U, hubId: NEOCHI, createdAt: T0 });
    const free = { ...cfg, rooms: { ...cfg.rooms, once: { ...cfg.rooms.once, public: 0 } } };
    expect(await startRoom(db, free, ROOM, T0)).toEqual({ status: 'ok', charged: 0 });
    expect(await changeRoomKind(db, free, ROOM, 'invite')).toEqual({ status: 'ok', charged: 0, ticket: true, ticketKind: 'room_free' });
    expect((await ticketsOf(db, U)).room_free).toBe(1);
  });

  it('宵宮: 1 時間分を券で', async () => {
    await addTickets(db, B, 'room_free', 1);
    await db.insert(tempVoice).values({ channelId: ROOM, ownerId: U, hubId: YOIMIYA, createdAt: T0 });
    expect(await payEntry(db, cfg, ROOM, B, T0)).toEqual({ status: 'ok', charged: 0, ticket: true, ticketKind: 'room_free' });
    expect(await payEntry(db, cfg, ROOM, B, T0)).toEqual({ status: 'already', charged: 0 });
    expect((await ticketsOf(db, B)).room_free).toBe(0);
  });

  it('種類ごとの券: その種類の無料券を先に使い、ほかの種類の券は使わない', async () => {
    await addTickets(db, U, 'room_free_secret', 1);
    await addTickets(db, U, 'room_free_invite', 1);
    await addCoins(db, U, 1000, 'adjust');
    await db.insert(tempVoice).values({ channelId: ROOM, ownerId: U, hubId: NEOCHI, createdAt: T0 });
    // 公開の分は、公開の券がないので払う
    expect(await startRoom(db, cfg, ROOM, T0)).toEqual({ status: 'ok', charged: 50 });
    expect(await changeRoomKind(db, cfg, ROOM, 'secret', T0)).toEqual({ status: 'ok', charged: 0, ticket: true, ticketKind: 'room_free_secret' });
    expect(await ticketsOf(db, U)).toMatchObject({ room_free_secret: 0, room_free_invite: 1 });
  });

  it('半額券: 半分だけ払う（足りなければ券は使わない）', async () => {
    await addTickets(db, B, 'room_half_public', 1);
    await db.insert(tempVoice).values({ channelId: ROOM, ownerId: U, hubId: YOIMIYA, createdAt: T0 });
    expect(await payEntry(db, cfg, ROOM, B, T0)).toEqual({ status: 'insufficient', price: 100 });
    expect((await ticketsOf(db, B)).room_half_public).toBe(1);
    await addCoins(db, B, 50, 'adjust');
    expect(await payEntry(db, cfg, ROOM, B, T0)).toEqual({ status: 'ok', charged: 50, ticketKind: 'room_half_public' });
    expect((await walletOf(db, B)).balance).toBe(0);
  });

  it('一日券: 使い始めてから 24 時間はその種類の部屋代が無料（券は 1 枚だけ）', async () => {
    const { hourlyPerPerson } = await import('../src/services/rooms.js');
    await addTickets(db, B, 'room_day_public', 1);
    await db.insert(tempVoice).values({ channelId: ROOM, ownerId: U, hubId: YOIMIYA, createdAt: T0 });
    expect(await payEntry(db, cfg, ROOM, B, T0)).toEqual({ status: 'ok', charged: 0, ticket: true, ticketKind: 'room_day_public' });
    expect((await ticketsOf(db, B)).room_day_public).toBe(0);
    const h = (n: number) => new Date(T0.getTime() + n * 3_600_000);
    expect(await hourlyPerPerson(db, cfg, [{ channelId: ROOM, memberIds: [B] }], h(1))).toEqual([{ action: 'paid', channelId: ROOM, memberId: B, charged: 0 }]);
    expect(await hourlyPerPerson(db, cfg, [{ channelId: ROOM, memberIds: [B] }], h(23))).toEqual([{ action: 'paid', channelId: ROOM, memberId: B, charged: 0 }]);
    // 24 時間たったら払う（足りないので注意）
    expect((await hourlyPerPerson(db, cfg, [{ channelId: ROOM, memberIds: [B] }], h(25)))[0]).toMatchObject({ action: 'warned' });
  });

  it('ショップの割引券: 割り引いて払い、券を 1 枚使う。払い戻すと券も戻る。券がなければ買えない', async () => {
    const { buyRole, DISCOUNT_TICKETS } = await import('../src/services/shop.js');
    expect(DISCOUNT_TICKETS).toEqual(['shop_10', 'shop_30', 'shop_50']);
    const SAKURA = '100000000000000081';
    await seedDefaultItems(db, { colors: [{ roleId: SAKURA, name: '桜', emoji: '🌸' }], titles: [] });
    const color = (await listItems(db)).find((i) => i.roleId === SAKURA)!;
    await addCoins(db, U, 1500, 'adjust');
    expect(await buyRole(db, color, U, T0, 1500, 'shop_30')).toEqual({ status: 'no_ticket' });
    expect((await walletOf(db, U)).balance).toBe(1500);
    await addTickets(db, U, 'shop_30', 1);
    const r = await buyRole(db, color, U, T0, 1500, 'shop_30');
    expect(r).toMatchObject({ status: 'ok', balance: 450, discount: 30 });
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.purchase).toMatchObject({ price: 1050, ticket: 'shop_30' });
    expect((await ticketsOf(db, U)).shop_30).toBe(0);
    await refund(db, r.purchase);
    expect((await walletOf(db, U)).balance).toBe(1500);
    expect((await ticketsOf(db, U)).shop_30).toBe(1);
    // 足りなければ券は減らない
    await addTickets(db, B, 'shop_10', 1);
    expect(await buyRole(db, color, B, T0, 1500, 'shop_10')).toMatchObject({ status: 'insufficient', price: 1350 });
    expect((await ticketsOf(db, B)).shop_10).toBe(1);
  });

  it('券の名前と説明は全部そろっている', async () => {
    const { TICKET_KINDS } = await import('../src/config.js');
    const { TICKET_LABEL, MANUAL_TICKETS } = await import('../src/services/tickets.js');
    for (const k of TICKET_KINDS) expect(TICKET_LABEL[k]?.name).toBeTruthy();
    expect(TICKET_LABEL.room_half_twoshot.name).toBe('💞ツーショットの部屋代半額券');
    expect(MANUAL_TICKETS).toEqual(['fuku', 'luck', 'omikuji_extra', 'gacha_free', 'gacha_gold10', 'gacha_gift', 'name_deco', 'casino_boost']);
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

  it('絵馬の奉納: 絵馬のピン留め券で無料。失敗して戻すときは券を戻す（銭は戻さない）', async () => {
    await seedDefaultItems(db, { colors: [], titles: [] });
    const ema = (await listItems(db)).find((i) => i.kind === 'ema_pin')!;
    await addTickets(db, U, 'ema_pin', 1);
    const r = await buySimple(db, ema, U, { channelId: 'c', messageId: 'm' }, T0, 800);
    expect(r).toMatchObject({ status: 'ok', ticket: true, balance: 0 });
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.purchase.price).toBe(0);
    expect(r.purchase.ticket).toBe('ema_pin');
    await refund(db, r.purchase);
    expect((await walletOf(db, U)).balance).toBe(0);
    expect((await ticketsOf(db, U)).ema_pin).toBe(1);
    // 券がなければ銭
    await buySimple(db, ema, U, {}, T0, 800);
    expect(await buySimple(db, ema, U, {}, T0, 800)).toMatchObject({ status: 'insufficient', price: 800 });
  });
});

describe('物御籤の画面', () => {
  const names = { role: (id: string) => (id === R1 ? '金の桜' : id === R2 ? '銀の月' : undefined), shop: () => undefined };

  it('値段・割合・中身と確率・天井・持っている券と、1 回 / 10 連のボタン', async () => {
    await ensureGachaPrizes(db, g);
    const prizes = await listPrizes(db);
    const m = JSON.stringify(gachaMenu(g, prizes, names, { balance: 600, sinceTop: 25, tickets: { ...emptyTickets(), room_free: 2, ema_pin: 0, market_nofee: 0 } }, '🌸花びら'));
    for (const t of [
      '500',
      '5,000',
      '大吉 3%',
      'あと **5** 回',
      '部屋代無料券 ×2',
      'gacha:draw:1',
      'gacha:draw:10',
      '本物のお金は使いません',
    ])
      expect(m).toContain(t);
    // 10 連の分は足りないので押せない
    const menu = gachaMenu(g, prizes, names, { balance: 600, sinceTop: 0, tickets: { ...emptyTickets(), room_free: 0, ema_pin: 0, market_nofee: 0 } }, '🌸花びら');
    const buttons = menu.components[0]!.toJSON().components as { disabled?: boolean }[];
    expect(buttons.map((b) => Boolean(b.disabled))).toEqual([false, true, false]);
    expect(tierPrizeText(g, prizes, 'kichi', names)).toBe('📌絵馬のピン留め券 ×1 60%');
    expect(tierPrizeText(g, prizes, 'daikichi', names)).toContain('「金の桜」 1.5%');
    expect(tierPrizeText(g, prizes, 'daikichi', names)).toContain('出せないときは 🎫部屋代無料券 ×3');
    // 画面には運勢ごとの中身は並べない（「中身と排出率」で見る）
    expect(JSON.stringify(menu.embeds)).not.toContain('金の桜');
  });

  it('結果の一行・券の一行・パネル', () => {
    expect(pullLine({ tier: 'daikichi', pity: true, prizeId: 1, kind: 'role', roleId: R1, count: 0, coins: 0 }, () => '金の桜')).toBe('🌸 **大吉**（天井） … 「金の桜」');
    expect(
      pullLine(
        { tier: 'kichi', pity: false, prizeId: 2, kind: 'shop', roleId: R1, shopItemId: 3, shopName: '🌸色守り（桜）', expiresAt: null, count: 0, coins: 0 },
        () => 'x',
      ),
    ).toBe('🍡 **吉** … 🌸色守り（桜）');
    expect(ticketLine({ ...emptyTickets(), room_free: 0, ema_pin: 1, market_nofee: 0 })).toBe('📌絵馬のピン留め券 ×1');
    expect(ticketLine({ ...emptyTickets(), room_free: 0, ema_pin: 0, market_nofee: 0 })).toBeUndefined();
    expect(JSON.stringify(panelMessage('gacha'))).toContain('gacha:open');
  });
});

describe('物御籤のはじめての 1 回', () => {
  it('1 人 1 回だけ無料。銭は減らず、記録は 0 枚。リセットしても戻らない。メニューとボタン', async () => {
    const { firstFreeLeft, resetGacha } = await import('../src/services/gacha.js');
    expect(await firstFreeLeft(db, U)).toBe(true);
    expect(await drawGacha(db, g, U, 10, [], () => 0.99, T0, { first: true })).toEqual({ status: 'disabled' });
    expect(await drawGacha(db, g, U, 1, [], () => 0.99, T0, { first: true, free: true })).toEqual({ status: 'disabled' });
    const r = await drawGacha(db, g, U, 1, [], () => 0.99, T0, { first: true });
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.pulls).toHaveLength(1);
    expect(r.balance).toBe(0);
    expect((await db.select().from(gachaDraws))[0]?.price).toBe(0);
    expect(await firstFreeLeft(db, U)).toBe(false);
    expect(await drawGacha(db, g, U, 1, [], () => 0.99, T0, { first: true })).toEqual({ status: 'no_ticket' });
    await resetGacha(db, T0);
    expect(await firstFreeLeft(db, U)).toBe(false);
    // メニュー: まだの人にだけボタン
    const prizes = await listPrizes(db);
    const names = { role: () => 'ロール', shop: () => undefined, coin: '銭', custom: () => undefined };
    const menu = (firstFree: boolean) => JSON.stringify(gachaMenu(g, prizes, names, { balance: 0, sinceTop: 0, tickets: emptyTickets(), firstFree }, '銭'));
    expect(menu(true)).toContain('gacha:draw:first');
    expect(menu(true)).toContain('はじめての 1 回は無料');
    expect(menu(false)).not.toContain('gacha:draw:first');
    // 置くボタンは「物御籤売り場へ入る」・読みは「ものみくじ」
    const panel = JSON.stringify(panelMessage('gacha'));
    expect(panel).toContain('物御籤売り場へ入る');
    expect(panel).toContain('attachment://gacha-prayer.png');
    expect(panel).toContain('ものみくじ');
    expect(panelMessage('gacha').embeds[0]?.description).toBeUndefined();
  });
});

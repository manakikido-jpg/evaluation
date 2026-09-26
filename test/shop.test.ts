import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { drawOmikuji, omikujiToday } from '../src/services/omikuji.js';
import { buyRole, buySimple, duePurchases, giveGift, listItems, priceOf, refund, seedDefaultItems } from '../src/services/shop.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const SAKURA = '960000000000000001';
const FUJI = '960000000000000002';
const TITLE = '960000000000000003';
let db: Db;
let close: () => Promise<void>;
const now = new Date('2026-09-27T03:00:00Z');
const DAY = 86_400_000;

beforeEach(async () => {
  ({ db, close } = await makeDb());
  await seedDefaultItems(db, {
    colors: [
      { roleId: SAKURA, name: '桜', emoji: '🌸' },
      { roleId: FUJI, name: '藤', emoji: '💜' },
    ],
    titles: [{ roleId: TITLE, name: '酒豪', emoji: '🍶' }],
  });
});
afterEach(async () => {
  await close();
});

const item = async (pred: (i: Awaited<ReturnType<typeof listItems>>[number]) => boolean) => (await listItems(db)).find(pred)!;

describe('品物', () => {
  it('最初の品物: 色守り 2・称号 1・花吹雪・贈り物・絵馬の奉納・おみくじもう 1 回・免罪符。2 回目は作らない', async () => {
    const items = await listItems(db);
    expect(items.map((i) => i.kind)).toEqual(['role', 'role', 'role', 'hanafubuki', 'gift', 'ema_pin', 'omikuji_extra', 'menzaifu']);
    expect(await seedDefaultItems(db, { colors: [{ roleId: SAKURA, name: '桜', emoji: '🌸' }], titles: [] })).toBe(0);
    const menzaifu = items.find((i) => i.kind === 'menzaifu')!;
    expect(priceOf(menzaifu, cfg.economy)).toBe(cfg.economy.menzaifuPrice);
  });
});

describe('色守り・称号', () => {
  it('買うとロールと 30 日の期限。花びらが足りなければ買えない', async () => {
    const sakura = await item((i) => i.roleId === SAKURA);
    expect(await buyRole(db, sakura, 'A', now)).toEqual({ status: 'insufficient', price: 1500, balance: 0 });
    await addCoins(db, 'A', 2000, 'adjust');
    const r = await buyRole(db, sakura, 'A', now);
    expect(r).toMatchObject({ status: 'ok', balance: 500, removeRoleIds: [] });
    if (r.status !== 'ok') return;
    expect(r.purchase.expiresAt?.getTime()).toBe(now.getTime() + 30 * DAY);
  });

  it('色を買い替えると、前の色は外す。同じ色は期限が延びる', async () => {
    await addCoins(db, 'A', 10000, 'adjust');
    const sakura = await item((i) => i.roleId === SAKURA);
    const fuji = await item((i) => i.roleId === FUJI);
    await buyRole(db, sakura, 'A', now);
    const again = await buyRole(db, sakura, 'A', new Date(now.getTime() + DAY));
    expect(again.status === 'ok' && again.purchase.expiresAt?.getTime()).toBe(now.getTime() + 60 * DAY);
    const swap = await buyRole(db, fuji, 'A', now);
    expect(swap).toMatchObject({ status: 'ok', removeRoleIds: [SAKURA] });
  });

  it('称号はずっと。持っていたらもう買えない（花びらも減らない）', async () => {
    await addCoins(db, 'A', 5000, 'adjust');
    const title = await item((i) => i.roleId === TITLE);
    const r = await buyRole(db, title, 'A', now);
    expect(r.status === 'ok' && r.purchase.expiresAt).toBeNull();
    expect(await buyRole(db, title, 'A', now)).toEqual({ status: 'owned' });
    expect((await walletOf(db, 'A')).balance).toBe(3000);
  });

  it('二重に押しても 1 回だけ払う', async () => {
    await addCoins(db, 'A', 5000, 'adjust');
    const title = await item((i) => i.roleId === TITLE);
    const rs = await Promise.all([buyRole(db, title, 'A', now), buyRole(db, title, 'A', now)]);
    expect(rs.map((r) => r.status).sort()).toEqual(['ok', 'owned']);
    expect((await walletOf(db, 'A')).balance).toBe(3000);
  });

  it('売っていない品物は買えない', async () => {
    const sakura = await item((i) => i.roleId === SAKURA);
    expect(await buyRole(db, { ...sakura, enabled: false }, 'A', now)).toEqual({ status: 'disabled' });
  });

  it('期限が来たものを探せる。払い戻すと花びらが戻る', async () => {
    await addCoins(db, 'A', 2000, 'adjust');
    const sakura = await item((i) => i.roleId === SAKURA);
    const r = await buyRole(db, sakura, 'A', now);
    if (r.status !== 'ok') throw new Error();
    expect(await duePurchases(db, new Date(now.getTime() + 29 * DAY))).toEqual([]);
    expect((await duePurchases(db, new Date(now.getTime() + 31 * DAY))).map((p) => p.id)).toEqual([r.purchase.id]);
    await refund(db, r.purchase);
    await refund(db, r.purchase);
    expect((await walletOf(db, 'A')).balance).toBe(2000);
  });
});

describe('花吹雪・おみくじもう 1 回', () => {
  it('花吹雪は払って相手を記録', async () => {
    await addCoins(db, 'A', 1000, 'adjust');
    const hana = await item((i) => i.kind === 'hanafubuki');
    const r = await buySimple(db, hana, 'A', { targetId: 'B' }, now);
    expect(r).toMatchObject({ status: 'ok', balance: 700 });
    expect(r.status === 'ok' && r.purchase.targetId).toBe('B');
  });

  it('おみくじのもう 1 回は、その日のうちに 1 回だけ', async () => {
    expect(await omikujiToday(db, 'A', now)).toEqual({ drawn: false, extraUsed: false });
    await drawOmikuji(db, cfg.economy, 'A', now);
    expect(await omikujiToday(db, 'A', now)).toEqual({ drawn: true, extraUsed: false });
    expect((await drawOmikuji(db, cfg.economy, 'A', now, Math.random, { extra: true })).status).toBe('drawn');
    expect((await drawOmikuji(db, cfg.economy, 'A', now, Math.random, { extra: true })).status).toBe('already');
    expect(await omikujiToday(db, 'A', now)).toEqual({ drawn: true, extraUsed: true });
    expect(await omikujiToday(db, 'A', new Date(now.getTime() + DAY))).toEqual({ drawn: false, extraUsed: false });
  });
});

describe('贈り物', () => {
  const ujiko = { id: 'A', roleIds: [ROLE.ujiko] };

  it('贈った分が相手に届く（手数料なし）', async () => {
    await addCoins(db, 'A', 3000, 'adjust');
    expect(await giveGift(db, cfg, ujiko, 'B', 500, now)).toEqual({ status: 'ok', balance: 2500 });
    expect((await walletOf(db, 'B')).balance).toBe(500);
  });

  it('参拝者（1 段目）は贈れない。自分にも贈れない。量の範囲', async () => {
    await addCoins(db, 'A', 3000, 'adjust');
    expect(await giveGift(db, cfg, { id: 'A', roleIds: [ROLE.sanpaisha] }, 'B', 100, now)).toEqual({ status: 'rank_too_low', rankName: '氏子' });
    expect(await giveGift(db, cfg, ujiko, 'A', 100, now)).toEqual({ status: 'self' });
    expect(await giveGift(db, cfg, ujiko, 'B', 5, now)).toEqual({ status: 'bad_amount', min: 10, max: 1000 });
    expect(await giveGift(db, cfg, ujiko, 'B', 1001, now)).toEqual({ status: 'bad_amount', min: 10, max: 1000 });
    // 神職は参拝者の役職でも贈れる
    expect((await giveGift(db, cfg, { id: 'A', roleIds: [ROLE.shinshoku] }, 'B', 100, now)).status).toBe('ok');
  });

  it('1 日に贈れる合計は 1000 まで（日本時間の 0 時に戻る）', async () => {
    await addCoins(db, 'A', 5000, 'adjust');
    expect((await giveGift(db, cfg, ujiko, 'B', 700, now)).status).toBe('ok');
    expect(await giveGift(db, cfg, ujiko, 'C', 400, now)).toEqual({ status: 'daily_limit', left: 300 });
    // 同時に贈っても上限は超えない
    const rs = await Promise.all([giveGift(db, cfg, ujiko, 'B', 300, now), giveGift(db, cfg, ujiko, 'C', 300, now)]);
    expect(rs.map((r) => r.status).sort()).toEqual(['daily_limit', 'ok']);
    const tomorrow = new Date(now.getTime() + DAY);
    expect((await giveGift(db, cfg, ujiko, 'B', 1000, tomorrow)).status).toBe('ok');
  });

  it('花びらが足りなければ贈れない', async () => {
    await addCoins(db, 'A', 50, 'adjust');
    expect(await giveGift(db, cfg, ujiko, 'B', 100, now)).toEqual({ status: 'insufficient', balance: 50 });
  });
});

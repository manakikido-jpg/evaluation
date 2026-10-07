import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { casinoStyles, casinoStyleDraws, coinTx, gachaState } from '../src/db/schema.js';
import { casinoGachaSchema } from '../src/config.js';
import { drawStyles, stylesOf, activeStyles, equipStyle, STYLE_ITEMS, styleChances, tableStyles } from '../src/services/casino/styles.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { ticketsOf } from '../src/services/tickets.js';
import { applyOverrides, overridesSchema } from '../src/services/settings.js';
import { cfg, makeDb } from './helpers.js';
let db: Db, close: () => Promise<void>;
const A = '760000000000000001';
const g = { ...cfg.casinoGacha, enabled: true };
const now = new Date('2026-10-07T12:00:00Z');
beforeEach(async () => {
  ({ db, close } = await makeDb());
  await addCoins(db, A, 100000, 'adjust');
});
afterEach(async () => close());
describe('カジノの景品と着せ替え', () => {
  it('18種類・率は100％。未所持だけ出て、そろったら券になる', () => {
    expect(STYLE_ITEMS).toHaveLength(18);
    const owned = ['yozakura'];
    const c = styleChances(g, owned);
    expect(c.reduce((n, i) => n + i.chance, 0)).toBeCloseTo(100);
    expect(c.find((i) => i.key === 'yozakura')!.chance).toBe(0);
    expect(c.find((i) => i.key === 'stars')!.chance).toBeCloseTo(70 / 15);
    const all = styleChances(
      g,
      STYLE_ITEMS.filter((i) => i.slot).map((i) => i.key),
    );
    expect(all.find((i) => i.key === 'trial')!.chance).toBe(90);
  });
  it('同じ依頼の同時再送は1回分の支払い・景品。ふつうの物御籤は触らない', async () => {
    const results = await Promise.all([1, 2, 3].map(() => drawStyles(db, g, A, 'same-request', 10, 'web', () => 0)));
    expect(results.filter((r) => r.status === 'ok' && !r.replay)).toHaveLength(1);
    expect((await walletOf(db, A)).balance).toBe(95000);
    const s = await stylesOf(db, A);
    expect(s.owned).toHaveLength(10);
    expect(new Set(s.owned).size).toBe(10);
    expect(await db.select().from(casinoStyleDraws)).toHaveLength(1);
    expect(await db.select().from(gachaState)).toHaveLength(0);
    expect((await db.select().from(coinTx)).filter((x) => x.reason === 'gacha')).toHaveLength(1);
  });
  it('天井が来たら、券の乱数でも未所持の品を保証する', async () => {
    const small = { ...g, pity: 3 };
    for (let n = 0; n < 3; n++) await drawStyles(db, small, A, `pity-${n}`, 1, 'web', () => 0.99);
    const s = await stylesOf(db, A);
    expect(s.owned).toEqual(['lucky']);
    expect(s.pity).toBe(0);
    expect((await ticketsOf(db, A)).casino_boost).toBe(2);
  });
  it('お試し券は所持品に、大勝負の札は既存の持ち物に入る', async () => {
    await drawStyles(db, g, A, 'trial', 1, 'web', () => 0.75);
    await drawStyles(db, g, A, 'boost', 1, 'web', () => 0.95);
    expect((await stylesOf(db, A)).tickets).toBe(1);
    expect((await ticketsOf(db, A)).casino_boost).toBe(1);
  });
  it('残高不足・休止・不正な回数では景品も支払いもない。途中失敗も全部戻る', async () => {
    expect(await drawStyles(db, { ...g, price: 100000 }, A, 'expensive', 10, 'web')).toEqual({ status: 'funds' });
    expect(await drawStyles(db, { ...g, enabled: false }, A, 'off', 1, 'web')).toEqual({ status: 'off' });
    expect(await drawStyles(db, g, A, 'bad', 2, 'web')).toEqual({ status: 'invalid' });
    await expect(drawStyles(db, g, A, 'error', 10, 'web', () => NaN)).rejects.toThrow();
    expect((await walletOf(db, A)).balance).toBe(100000);
    expect((await stylesOf(db, A)).owned).toEqual([]);
    expect(await db.select().from(casinoStyleDraws)).toHaveLength(0);
  });
  it('未所持は装備できない。装備・はずす・24時間のお試しは元の装備を守る', async () => {
    await db.insert(casinoStyles).values({ memberId: A, owned: ['stars'], equipped: { background: 'stars' }, tickets: 2 });
    expect(await equipStyle(db, A, 'background', 'gold', false, now)).toBe('not_owned');
    expect(await equipStyle(db, A, 'title', 'gold', false, now)).toBe('invalid');
    expect(await equipStyle(db, A, 'background', 'gold', true, now)).toBe('ok');
    expect(await equipStyle(db, A, 'background', 'gold', true, now)).toBe('active');
    const s = await stylesOf(db, A);
    expect(s.tickets).toBe(1);
    expect(activeStyles(s, now).background).toBe('gold');
    expect(activeStyles(s, new Date(now.getTime() + 86400000)).background).toBe('stars');
    expect(await equipStyle(db, A, 'background', '', false, now)).toBe('ok');
    expect(activeStyles(await stylesOf(db, A), now).background).toBeUndefined();
    expect(await equipStyle(db, A, 'background', 'stars', false, now)).toBe('ok');
    expect(activeStyles(await stylesOf(db, A), now).background).toBe('stars');
  });
  it('お試しは同時に使っても1枚。所持品や対象外には使えない', async () => {
    await db.insert(casinoStyles).values({ memberId: A, tickets: 2, owned: ['gold'] });
    expect(await equipStyle(db, A, 'background', 'gold', true, now)).toBe('invalid');
    expect(await equipStyle(db, A, 'title', 'gambler', true, now)).toBe('invalid');
    const rs = await Promise.all([1, 2].map(() => equipStyle(db, A, 'table', 'dragon', true, now)));
    expect(rs.sort()).toEqual(['active', 'ok']);
    expect((await stylesOf(db, A)).tickets).toBe(1);
  });
  it('卓のメンバーだけの見た目を読み、期限切れも反映する', async () => {
    await db.insert(casinoStyles).values([
      { memberId: A, owned: ['gambler'], equipped: { title: 'gambler' }, trialKey: 'dragon', trialUntil: now },
      { memberId: 'other', owned: ['gold'], equipped: { background: 'gold' } },
    ]);
    expect(await tableStyles(db, { seats: [null, { id: A }, { id: 'bot' }] }, now)).toEqual({ [A]: { title: 'gambler' } });
    expect(await tableStyles(db, {}, now)).toEqual({});
  });
  it('設定の合計を検証し、保存した設定を適用する', () => {
    expect(casinoGachaSchema.safeParse({ cosmeticPercent: 95, boostPercent: 10 }).success).toBe(false);
    const o = overridesSchema.parse({ casinoGacha: { ...g, price: 250 } });
    expect(applyOverrides(cfg, o).casinoGacha.price).toBe(250);
    expect(casinoGachaSchema.parse({}).enabled).toBe(false);
  });
});

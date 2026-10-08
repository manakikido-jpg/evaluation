import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { casinoGachaSchema } from '../src/config.js';
import { shopItems } from '../src/db/schema.js';
import { gachaItemCounts, gachaSummaries, recentGachaDraws } from '../src/services/casino/gachaStats.js';
import { drawCost, drawStyles, drawableStyles, equipStyle, giveStyle, setStyleCatalog, styleChances, styleItem, stylesOf, takeStyle } from '../src/services/casino/styles.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { buySimple } from '../src/services/shop.js';
import { cfg, makeDb } from './helpers.js';

let db: Db, close: () => Promise<void>;
const A = '760000000000000011';
const base = { ...cfg.casinoGacha, enabled: true };
beforeEach(async () => {
  ({ db, close } = await makeDb());
  await addCoins(db, A, 100000, 'adjust');
});
afterEach(async () => {
  setStyleCatalog({});
  await close();
});

describe('🎴 勝負の御籤の調整', () => {
  it('品ごとの出やすさ（重み）・外した品は出ない・大勝負の札を外すとその分はお試し券', () => {
    const g = casinoGachaSchema.parse({ ...base, items: { yozakura: { weight: 3 }, stars: { enabled: false }, gold: { weight: 0 }, boost: { enabled: false } } });
    const c = new Map(styleChances(g, []).map((i) => [i.key, i.chance]));
    // 見た目の品 16 種のうち 2 つが出ない → 14 種。夜桜だけ重み 3 → 合計 16
    expect(c.get('yozakura')).toBeCloseTo((70 * 3) / 16);
    expect(c.get('foxroom')).toBeCloseTo(70 / 16);
    expect(c.get('stars')).toBe(0);
    expect(c.get('gold')).toBe(0);
    expect(c.get('boost')).toBe(0);
    expect(c.get('trial')).toBeCloseTo(30);
    expect([...c.values()].reduce((n, x) => n + x, 0)).toBeCloseTo(100);
    // 出す品を全部持てば「そろった」（外した品は数えない）
    expect(drawableStyles(g, drawableStyles(g, []).map((i) => i.key))).toEqual([]);
    expect(casinoGachaSchema.safeParse({ items: { yozakura: { weight: -1 } } }).success).toBe(false);
  });

  it('10 連の値段（0 なら × 10）。引いても外した品は出ない', async () => {
    expect(drawCost(base, 10)).toBe(base.price * 10);
    const g = casinoGachaSchema.parse({ ...base, tenPrice: 4000, items: Object.fromEntries(['yozakura', 'stars', 'gold', 'foxroom', 'festival', 'sakura', 'dragon', 'fox', 'fan', 'gem', 'hanafuda', 'petals', 'bell', 'lifetime', 'gambler'].map((k) => [k, { enabled: false }])) });
    expect(drawCost(g, 10)).toBe(4000);
    expect(drawCost(g, 1)).toBe(g.price);
    const r = await drawStyles(db, g, A, 'r1', 10, 'web', () => 0);
    expect(r).toMatchObject({ status: 'ok', cost: 4000 });
    expect((await walletOf(db, A)).balance).toBe(96000);
    // 出る見た目の品は「幸運の持ち主」だけ
    expect((await stylesOf(db, A)).owned).toEqual(['lucky']);
    // 記録のまとめ
    const [day] = await gachaSummaries(db, new Date(Date.now() + 1000));
    expect(day).toMatchObject({ draws: 1, pulls: 10, sales: 4000, players: 1 });
    expect((await gachaItemCounts(db, new Date(0))).get('lucky')).toBe(1);
    expect((await recentGachaDraws(db))[0]).toMatchObject({ memberId: A, cost: 4000 });
  });

  it('名前・絵文字・説明を変えると、画面の名前が変わる（空ならはじめの名前）', () => {
    setStyleCatalog({ yozakura: { enabled: true, weight: 1, name: '春の夜', emoji: '🌙' }, stars: { enabled: true, weight: 1, name: '' } });
    expect(styleItem('yozakura')).toMatchObject({ name: '春の夜', emoji: '🌙', note: '夜桜と灯りに包まれる背景' });
    expect(styleItem('stars')?.name).toBe('星降る遊技場');
    setStyleCatalog({});
    expect(styleItem('yozakura')?.name).toBe('夜桜の間');
  });

  it('運営が渡す・取り上げる（付けていたら外す）。お試し券は何枚でも', async () => {
    expect(await giveStyle(db, A, 'gold')).toBe('ok');
    expect(await giveStyle(db, A, 'gold')).toBe('owned');
    expect(await giveStyle(db, A, 'boost')).toBe('invalid');
    expect(await giveStyle(db, A, 'trial')).toBe('ok');
    expect(await giveStyle(db, A, 'trial')).toBe('ok');
    expect(await equipStyle(db, A, 'background', 'gold', false)).toBe('ok');
    expect(await takeStyle(db, A, 'gold')).toBe('ok');
    expect(await takeStyle(db, A, 'gold')).toBe('none');
    const s = await stylesOf(db, A);
    expect(s).toMatchObject({ owned: [], equipped: {}, tickets: 2 });
  });

  it('授与所で受ける: 見た目の品は 1 人 1 つ（持っていたら払わない）・お試し券は何枚でも', async () => {
    const [item] = await db.insert(shopItems).values({ kind: 'casino_style', name: '黄金の社', emoji: '🏯', price: 3000, styleKey: 'gold' }).returning();
    const [trial] = await db.insert(shopItems).values({ kind: 'casino_style', name: 'お試し券', emoji: '🎟', price: 200, styleKey: 'trial' }).returning();
    const [broken] = await db.insert(shopItems).values({ kind: 'casino_style', name: 'こわれた品', price: 1, styleKey: 'nope' }).returning();
    expect((await buySimple(db, item!, A)).status).toBe('ok');
    expect((await buySimple(db, item!, A)).status).toBe('owned');
    expect((await buySimple(db, broken!, A)).status).toBe('disabled');
    expect((await buySimple(db, trial!, A)).status).toBe('ok');
    expect((await buySimple(db, trial!, A)).status).toBe('ok');
    expect((await walletOf(db, A)).balance).toBe(100000 - 3000 - 400);
    expect(await stylesOf(db, A)).toMatchObject({ owned: ['gold'], tickets: 2 });
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gachaSchema } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { members } from '../src/db/schema.js';
import { gachaFeatured, gachaMenu, gachaRatesView, pullLine } from '../src/discord/gacha.js';
import { panelMessage } from '../src/discord/panels.js';
import { banzukeData, jstMonth, renderBanzuke } from '../src/services/banzuke.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import {
  collectionOf,
  createPrize,
  deletePrize,
  drawGacha,
  effectiveRates,
  ensureGachaPrizes,
  listPrizes,
  prizeChances,
  resetGacha,
  shareFortune,
  ZODIAC,
  zodiacLine,
} from '../src/services/gacha.js';
import { addPresetPrizes, presetPrizes } from '../src/services/gachaPresets.js';
import { emptyTickets } from '../src/services/tickets.js';
import { makeDb } from './helpers.js';

const U = '830000000000000001';
const B = '830000000000000002';
const TITLE = '100000000000000099';
const T0 = new Date('2026-10-10T12:00:00Z');
const g = gachaSchema.parse({});

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  await ensureGachaPrizes(db, g);
  for (const p of await listPrizes(db)) await deletePrize(db, p.id);
});
afterEach(async () => {
  await close();
});

describe('🐉 十二支のお守り', () => {
  it('まだ持っていないものが 1 つずつ。12 そろうと決めたロール。そろったら出ない', async () => {
    await createPrize(db, { tier: 'kichi', kind: 'zodiac', roleId: TITLE, amount: 1, weight: 1, fallback: false });
    await addCoins(db, U, 500 * 13, 'adjust');
    const r = await drawGacha(db, g, U, 10, [], () => 0.5, T0);
    if (r.status !== 'ok') throw new Error(r.status);
    expect(new Set(r.pulls.map((p) => p.zodiac?.key)).size).toBe(10);
    expect(r.pulls[9]?.zodiac).toMatchObject({ count: 10, complete: false });
    const r2 = await drawGacha(db, g, U, 2, [], () => 0.5, T0);
    if (r2.status !== 'ok') throw new Error(r2.status);
    expect(r2.pulls[1]).toMatchObject({ zodiac: { count: 12, complete: true }, roleId: TITLE });
    expect(pullLine(r2.pulls[1]!, () => '十二支守')).toContain('（12/12） 🎉 十二支がそろいました！');
    expect((await collectionOf(db, U)).length).toBe(12);
    expect(zodiacLine(await collectionOf(db, U))).toBe(ZODIAC.map((z) => z.emoji).join(''));
    // そろったら出ない（払い戻し）
    expect(await drawGacha(db, g, U, 1, [TITLE], () => 0.5, T0)).toEqual({ status: 'empty' });
    // メニューに並びが出る
    const menu = JSON.stringify(gachaMenu(g, await listPrizes(db), { role: () => undefined, shop: () => undefined }, { balance: 0, sinceTop: 0, tickets: emptyTickets(), zodiac: ['ne', 'tora'] }, '🪙銭').embeds);
    expect(menu).toContain('🐉 十二支: 🐭・🐯・・・・・・・・・（2/12）');
    // リセットで集めたものも消える
    await resetGacha(db, T0);
    expect(await collectionOf(db, U)).toEqual([]);
  });
});

describe('🎍 期間限定', () => {
  it('期間の間だけ出る（外なら確率 0・引けない）', async () => {
    const start = new Date('2026-10-01T00:00:00+09:00');
    const end = new Date('2026-11-01T00:00:00+09:00');
    const p = await createPrize(db, { tier: 'kichi', kind: 'coins', amount: 10, weight: 1, fallback: false, startsAt: start, endsAt: end });
    expect(prizeChances(g, await listPrizes(db), T0).get(p.id)).toBeGreaterThan(0);
    expect(effectiveRates(g, await listPrizes(db), new Date('2026-11-02T00:00:00Z')).kichi).toBe(0);
    await addCoins(db, U, 500, 'adjust');
    expect(await drawGacha(db, g, U, 1, [], () => 0.5, new Date('2026-09-20T00:00:00Z'))).toEqual({ status: 'empty' });
    expect(await drawGacha(db, g, U, 1, [], () => 0.5, T0)).toMatchObject({ status: 'ok' });
  });
});

describe('🍶 おすそ分け・番付・おすすめ', () => {
  it('おすそ分け: 同じ通話の人それぞれに（自分はのぞく）', async () => {
    expect(await shareFortune(db, U, [U, B, B], 50)).toEqual([B]);
    expect((await walletOf(db, B)).balance).toBe(50);
    expect((await walletOf(db, U)).balance).toBe(0);
    expect(await shareFortune(db, U, [B], 0)).toEqual([]);
    expect(g.share).toBe(50);
  });

  it('番付: 今月よく引いた人・大吉を多く引いた人', async () => {
    await db.insert(members).values([
      { id: U, username: 'u', displayName: 'さくら', ageGroup: 'adult' },
      { id: B, username: 'b', displayName: 'もみじ', ageGroup: 'adult' },
    ]);
    await createPrize(db, { tier: 'daikichi', kind: 'coins', amount: 1, weight: 1, fallback: false });
    await createPrize(db, { tier: 'kichi', kind: 'coins', amount: 1, weight: 1, fallback: false });
    await addCoins(db, U, 1500, 'adjust');
    await addCoins(db, B, 500, 'adjust');
    await drawGacha(db, g, U, 1, [], () => 0.0005, T0);
    await drawGacha(db, g, U, 2, [], () => 0.9, T0);
    await drawGacha(db, g, B, 1, [], () => 0.9, T0);
    const d = await banzukeData(db, jstMonth(T0));
    expect(d.gachaDraws?.map((e) => [e.name, e.value])).toEqual([
      ['さくら', 3],
      ['もみじ', 1],
    ]);
    expect(d.gachaTops?.map((e) => [e.name, e.value])).toEqual([['さくら', 1]]);
    expect(JSON.stringify(renderBanzuke(d))).toContain('物御籤をよく引いた人');
  });

  it('おすすめの中身: まとめて足し、2 回押しても増えない', async () => {
    const list = presetPrizes({ gold: '100000000000000081', zodiac: TITLE }, []);
    expect(list.find((p) => p.kind === 'special')).toMatchObject({ tier: 'super', label: 'Discord Nitro 1 か月分', stock: 1 });
    expect(list.find((p) => p.kind === 'zodiac')).toMatchObject({ tier: 'shokichi', roleId: TITLE });
    const n = await addPresetPrizes(db, list);
    expect(n).toBe(list.length);
    expect(await addPresetPrizes(db, list)).toBe(0);
    expect(effectiveRates(g, await listPrizes(db)).super).toBe(0.01);
  });
});

describe('📜 中身と排出率', () => {
  it('運勢ごとに中身を全部と、それぞれの %。代わり・残り・期間限定も出る。パネルにもボタン', async () => {
    await createPrize(db, { tier: 'super', kind: 'special', label: 'Discord Nitro 1 か月分', stock: 1, amount: 1, weight: 1, fallback: false });
    await createPrize(db, { tier: 'daikichi', kind: 'role', roleId: '100000000000000081', amount: 1, weight: 1, fallback: false });
    await createPrize(db, { tier: 'daikichi', kind: 'ticket', ticket: 'room_free', amount: 3, weight: 1, fallback: true });
    await createPrize(db, { tier: 'kichi', kind: 'coins', amount: 100, weight: 1, fallback: false, endsAt: new Date('2026-11-01T00:00:00+09:00') });
    const view = gachaRatesView(g, await listPrizes(db), { role: () => '金色', shop: () => undefined, coin: '🪙銭' }, '🪙銭', T0);
    const text = JSON.stringify(view);
    expect(view.embeds.map((e) => e.title)).toEqual(['🎊 超大当たり　0.016%', '🌸 大吉　4.76%', '🍡 吉　95.22%']);
    for (const t of ['**0.016%** … 🎊 Discord Nitro 1 か月分（残り 1）', '「金色」（持っていたら出ない）', '代わり … 🎫部屋代無料券 ×3', '🎍 10/31 まで', '天井', '1 回 500 枚']) expect(text).toContain(t);
    expect(JSON.stringify(panelMessage('gacha'))).toContain('gacha:rates');
  });
});

describe('✨ 今の目玉', () => {
  const names = { role: () => '金色', shop: () => undefined, coin: '🪙銭' };
  it('超大当たりの中身（残り）と期間限定の中身を、物御籤の画面のいちばん上に。なければ出さない', async () => {
    await createPrize(db, { tier: 'daikichi', kind: 'role', roleId: '100000000000000081', amount: 1, weight: 1, fallback: false });
    expect(gachaFeatured(g, await listPrizes(db), names, T0)).toBeUndefined();
    await createPrize(db, { tier: 'super', kind: 'special', label: 'Discord Nitro 1 か月分', stock: 2, amount: 1, weight: 1, fallback: false });
    await createPrize(db, { tier: 'kichi', kind: 'coins', amount: 100, weight: 1, fallback: false, endsAt: new Date('2026-11-01T00:00:00+09:00') });
    // 期間が終わったもの・残りのないものは出さない
    await createPrize(db, { tier: 'kichi', kind: 'coins', amount: 50, weight: 1, fallback: false, endsAt: new Date('2026-10-01T00:00:00+09:00') });
    await createPrize(db, { tier: 'super', kind: 'special', label: '売り切れ', stock: 0, amount: 1, weight: 1, fallback: false });
    const f = gachaFeatured(g, await listPrizes(db), names, T0)!;
    expect(f.title).toBe('✨ 今の目玉');
    for (const t of ['超大当たり', '### 🌟 🎊 Discord Nitro 1 か月分', '🔥 残り 2', '🎍 **期間限定**', '10/31 まで']) expect(f.description).toContain(t);
    expect(f.description).not.toContain('売り切れ');
    expect(f.description).not.toContain('×50');
    // 画面: 目玉がいちばん上。下の一覧の超大当たりは短く
    const menu = gachaMenu(g, await listPrizes(db), names, { balance: 0, sinceTop: 0, tickets: emptyTickets() }, '🪙銭');
    expect(menu.embeds.map((e) => e.title)).toEqual(['✨ 今の目玉', '🎁 物御籤']);
    expect(menu.embeds[1]!.description).toContain('↑ 上の「✨ 今の目玉」');
  });
});

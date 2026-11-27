import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { members, omamoriHoldings, shopItems, voiceChannels, voiceUsage, type ShopItem } from '../src/db/schema.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { buyOmamori, consumeOmamori, omamoriCount, omamoriStatus } from '../src/services/omamori.js';
import { setEmaPromotion } from '../src/services/emaPromotion.js';
import { resetAllShuin } from '../src/services/shuin.js';
import { runUjikoKeep, setNewSystemRoles } from '../src/services/ujikoKeep.js';
import { priceOf } from '../src/services/shop.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const U = '895000000000000001';
const ENG = '895000000000000100';
const NOW = new Date('2026-12-10T03:00:00Z'); // 木曜（日本時間 12:00）。今週の月曜は 12-07
const DAY = 86_400_000;
let db: Db, close: () => Promise<void>, item: ShopItem;

beforeEach(async () => {
  ({ db, close } = await makeDb());
  await db.insert(members).values({ id: U, username: 'u', displayName: '氏子', roleIds: [ROLE.ujiko] });
  await db.insert(voiceChannels).values({ channelId: ENG, name: '縁側１' });
  item = (await db.insert(shopItems).values({ kind: 'omamori', name: 'お守り', emoji: '🧿', description: '', price: 30000, position: 1 }).returning())[0]!;
  await addCoins(db, U, 100_000, 'admin_grant', {});
});
afterEach(async () => close());

const engawa = (date: string, minutes: number) => db.insert(voiceUsage).values({ memberId: U, date, channelId: ENG, minutes });

describe('🧿 お守り', () => {
  it('縁側が40時間に届かない週は買えない。届いた週に1個だけ買える（値段は割引なしの30,000銭）', async () => {
    await engawa('2026-12-07', 1000);
    await engawa('2026-12-08', 1000);
    expect(await omamoriStatus(db, cfg, U, NOW)).toMatchObject({ week: null, reason: 'time', minutes: 2000, need: 2400 });
    expect(await buyOmamori(db, cfg, item, U, NOW)).toMatchObject({ status: 'denied' });
    await engawa('2026-12-09', 400);
    expect(await omamoriStatus(db, cfg, U, NOW)).toMatchObject({ week: '2026-12-07' });
    expect(priceOf(item, { ...cfg.economy, shopSalePercent: 50, boostDiscountPercent: 20 }, true)).toBe(30000);
    expect(await buyOmamori(db, cfg, item, U, NOW)).toMatchObject({ status: 'ok', count: 1, price: 30000, balance: 70_000 });
    // 同じ週は2個目を買えない
    expect(await buyOmamori(db, cfg, item, U, NOW)).toMatchObject({ status: 'denied', s: { reason: 'bought' } });
    expect((await walletOf(db, U)).balance).toBe(70_000);
  });

  it('先週の分も買える。銭が足りなければ何も残らない。3個まで', async () => {
    await engawa('2026-12-01', 2400); // 先週
    await engawa('2026-12-08', 2400); // 今週
    expect(await buyOmamori(db, cfg, item, U, NOW)).toMatchObject({ status: 'ok', count: 1 });
    expect(await buyOmamori(db, cfg, item, U, NOW)).toMatchObject({ status: 'ok', count: 2 });
    // 次の週：縁側はあるが銭が足りない
    const next = new Date(NOW.getTime() + 7 * DAY);
    await engawa('2026-12-15', 2400);
    expect(await buyOmamori(db, cfg, { ...item, price: 50_000 }, U, next)).toMatchObject({ status: 'insufficient', price: 50_000, balance: 40_000 });
    expect(await omamoriCount(db, U)).toBe(2);
    expect((await walletOf(db, U)).balance).toBe(40_000);
    expect(await buyOmamori(db, cfg, item, U, next)).toMatchObject({ status: 'ok', count: 3 });
    // 4個目は持てない
    await engawa('2026-12-22', 2400);
    expect(await buyOmamori(db, cfg, item, U, new Date(next.getTime() + 7 * DAY))).toMatchObject({ status: 'denied', s: { reason: 'full' } });
  });

  it('使うと1個減る。持っていなければ使えない', async () => {
    expect(await consumeOmamori(db, U, NOW)).toBe(false);
    await db.insert(omamoriHoldings).values([{ memberId: U, week: '2026-11-23' }, { memberId: U, week: '2026-11-30' }]);
    expect(await consumeOmamori(db, U, NOW)).toBe(true);
    expect(await omamoriCount(db, U)).toBe(1);
  });

  it('キープの判定：元氏子のロールが未設定のあいだは、お守りを使わない', async () => {
    const T0 = new Date('2026-12-01T03:00:00Z');
    await setEmaPromotion(db, true, 'guji');
    await resetAllShuin(db, 'guji', T0);
    await db.insert(omamoriHoldings).values({ memberId: U, week: '2026-11-23' });
    const deps = { consumeOmamori: (id: string) => consumeOmamori(db, id) };
    await runUjikoKeep(db, cfg, new Date(T0.getTime() + DAY), deps);
    expect(await runUjikoKeep(db, cfg, new Date(T0.getTime() + 30 * DAY), deps)).toMatchObject([{ type: 'hold' }]);
    expect(await omamoriCount(db, U)).toBe(1);
    // ロールを入れたら、お守りを1個使って防ぐ
    await setNewSystemRoles(db, { motoUjiko: '895000000000009999' }, 'guji');
    expect(await runUjikoKeep(db, cfg, new Date(T0.getTime() + 31 * DAY), deps)).toMatchObject([{ type: 'omamori' }]);
    expect(await omamoriCount(db, U)).toBe(0);
  });
});

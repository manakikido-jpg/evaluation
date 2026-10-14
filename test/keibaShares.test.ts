import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { keibaHorses, keibaShares } from '../src/db/schema.js';
import { buyShare, holdersOf, mySharedHorses, offerShares, shareOffers, sharePriceRange, splitByShares } from '../src/services/casino/keibaShares.js';
import { addHorse, loadRoster, retireOwnHorse, setSale } from '../src/services/casino/keibaStable.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { makeDb } from './helpers.js';

const A = '760000000000000001';
const B = '760000000000000002';
const C = '760000000000000003';
let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  for (const id of [A, B, C]) await addCoins(db, id, 10000, 'admin_grant');
});
afterEach(async () => {
  await close();
});
const bal = async (id: string) => (await walletOf(db, id)).balance;

describe('🤝 共同所有（一口馬主）', () => {
  it('口の数で分ける（端数は馬主）', () => {
    expect(sharePriceRange(3000)).toEqual([300, 900]);
    expect(splitByShares([{ memberId: A, units: 7 }, { memberId: B, units: 3 }], 101, A)).toEqual([
      { memberId: A, amount: 71 },
      { memberId: B, amount: 30 },
    ]);
    expect(splitByShares([{ memberId: A, units: 10 }], 50, A)).toEqual([{ memberId: A, amount: 50 }]);
    expect(splitByShares([], 50, A)).toEqual([{ memberId: A, amount: 50 }]);
  });

  it('募集 → 1 口ずつ買う。馬主は 1 口残す。多く持った人が馬主になる。売れない', async () => {
    const h = (await addHorse(db, 'ナカマウマ', undefined, A))!;
    expect(await offerShares(db, A, h.id, 200, 3000)).toBe('invalid');
    expect(await offerShares(db, B, h.id, 500, 3000)).toBe('not_found');
    expect(await offerShares(db, A, h.id, 500, 3000)).toBe('ok');
    expect((await shareOffers(db)).map((x) => [x.name, x.left])).toEqual([['ナカマウマ', 9]]);
    expect(await buyShare(db, A, h.id)).toBe('self');
    expect(await buyShare(db, B, h.id)).toBe('ok');
    expect(await bal(B)).toBe(9500);
    expect(await bal(A)).toBe(10500);
    expect(await holdersOf(db, h.id, A)).toEqual([
      { memberId: A, units: 9 },
      { memberId: B, units: 1 },
    ]);
    expect(await mySharedHorses(db, B)).toMatchObject([{ name: 'ナカマウマ', units: 1 }]);
    // 口を持つ人がいると売れない
    expect(await setSale(db, A, h.id, 5000)).toBe(false);
    // B が 5 口・A が 5 口 → 同じなので A のまま。B が 6 口目で B が馬主に
    for (let k = 0; k < 4; k++) expect(await buyShare(db, B, h.id)).toBe('ok');
    expect((await db.select().from(keibaHorses).where(eq(keibaHorses.id, h.id)))[0]!.ownerId).toBe(A);
    expect(await buyShare(db, B, h.id)).toBe('ok');
    const after = (await db.select().from(keibaHorses).where(eq(keibaHorses.id, h.id)))[0]!;
    expect(after.ownerId).toBe(B);
    expect(after.sharePrice).toBeNull();
    expect(await buyShare(db, C, h.id)).toBe('not_found');
    // 名簿にも口の情報が付く（賞金を分けるため）
    const roster = await loadRoster(db);
    expect(roster.find((x) => x.id === h.id)?.shares?.length).toBe(2);
  });

  it('引退の功労金は口の数で分ける', async () => {
    const h = (await addHorse(db, 'ミンナノウマ', undefined, A))!;
    await db.update(keibaHorses).set({ wins: 2 }).where(eq(keibaHorses.id, h.id));
    await offerShares(db, A, h.id, 300, 3000);
    // B が 4 口・C が 1 口 → A 5 口で馬主のまま
    for (let k = 0; k < 4; k++) expect(await buyShare(db, B, h.id)).toBe('ok');
    expect(await buyShare(db, C, h.id)).toBe('ok');
    expect(await holdersOf(db, h.id, A)).toEqual([
      { memberId: A, units: 5 },
      { memberId: B, units: 4 },
      { memberId: C, units: 1 },
    ]);
    const before = [await bal(A), await bal(B), await bal(C)];
    // 功労金 2 勝 × 500 = 1000 → A 500・B 400・C 100
    expect(await retireOwnHorse(db, A, h.id, new Date(), 500)).toBe(1000);
    expect([(await bal(A)) - before[0]!, (await bal(B)) - before[1]!, (await bal(C)) - before[2]!]).toEqual([500, 400, 100]);
  });

  it('馬主は最後の 1 口は売らない', async () => {
    const h = (await addHorse(db, 'ウリキレ', undefined, A))!;
    await offerShares(db, A, h.id, 300, 3000);
    await db.insert(keibaShares).values({ horseId: h.id, memberId: B, units: 9 });
    await db.update(keibaShares).set({ units: 1 }).where(and(eq(keibaShares.horseId, h.id), eq(keibaShares.memberId, A)));
    expect(await buyShare(db, C, h.id)).toBe('sold_out');
    expect(await bal(C)).toBe(10000);
  });
});

describe('🤝 レースの賞金を口の数で分ける', () => {
  it('馬主の馬の賞金・手当が、口を持つ人に分かれて入る', async () => {
    const { keiba } = await import('../src/services/casino/tables/keiba.js');
    const { newStable, seeded } = await import('../src/services/casino/keiba.js');
    const { cfg } = await import('./helpers.js');
    const roster = Array.from({ length: 8 }, (_, i) => ({ ...newStable(seeded(i + 1)), id: i + 1, name: `S${i + 1}`, starts: 3, wins: 0, ownerId: A, shares: [{ memberId: A, units: 6 }, { memberId: B, units: 4 }] }));
    let n = 7;
    const rng = (k: number) => (n = (n * 1103515245 + 12345) % 2147483648) % k;
    const ctx = (now: number) => ({ now, rng, cfg: { ...cfg, casino: { ...cfg.casino, dailyBetLimit: 0 } }, roster });
    const t0 = Date.parse('2026-10-02T12:00:00Z');
    let s = (keiba.create({ id: A, name: 'あ' }, { cls: '1' }, ctx(t0)) as { ok: true; state: import('../src/services/casino/tables/keiba.js').KbState }).state;
    s = (keiba.act(s, A, { action: 'bet', type: 'win', a: '1', bet: '100' }, ctx(t0)) as { ok: true; state: typeof s }).state;
    s = (keiba.act(s, A, { action: 'start' }, ctx(t0)) as { ok: true; state: typeof s }).state;
    const fin = keiba.tick(s, ctx(s.deadline));
    if (!fin || !fin.ok) throw new Error('no finish');
    const got = (id: string) => (fin.fx?.credits ?? []).filter((c) => c.memberId === id && c.reason === 'keiba_prize').reduce((x, c) => x + c.amount, 0);
    expect(got(B)).toBeGreaterThan(0);
    // 4 : 6 くらい（端数は馬主）
    expect(got(B) / (got(A) + got(B))).toBeGreaterThan(0.35);
    expect(got(B) / (got(A) + got(B))).toBeLessThanOrEqual(0.4);
  });
});

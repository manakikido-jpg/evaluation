import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { fortuneRounds, fortuneScratch } from '../src/db/schema.js';
import { lotteryFinances } from '../src/services/casino/fortuneStats.js';
import { makeDb } from './helpers.js';

let db: Db, close: () => Promise<void>;
const NOW = new Date('2026-10-25T13:00:00Z');
beforeEach(async () => { ({ db, close } = await makeDb()); });
afterEach(async () => close());
const round = (id: string, drawAt: Date, price: number, sold: number, payout: number, settled: boolean) =>
  ({ id, drawAt, price, perMember: 10, returnPct: 50, bonus: 0, sold, payout, settledAt: settled ? drawAt : null });

it('宝くじだけの売上・賞金・収支を出し、スクラッチと抽選前の回は入れない', async () => {
  await db.insert(fortuneRounds).values([
    round('2026-10-18', new Date('2026-10-18T12:00:00Z'), 100, 30, 2500, true),
    round('2026-10-11', new Date('2026-10-11T12:00:00Z'), 200, 10, 1000, true),
    round('2026-11-01', new Date('2026-11-01T12:00:00Z'), 100, 5, 0, false),
  ]);
  await db.insert(fortuneScratch).values({ id: randomUUID(), memberId: '760000000000000001', day: '2026-10-22', price: 100, payout: 5000, createdAt: NOW, openedAt: NOW });
  expect(await lotteryFinances(db, NOW)).toEqual({ rounds: 2, sold: 40, revenue: 5000, payout: 3500, net: 1500 });
});

it('抽選がまだないときは 0', async () => {
  expect(await lotteryFinances(db, NOW)).toEqual({ rounds: 0, sold: 0, revenue: 0, payout: 0, net: 0 });
});

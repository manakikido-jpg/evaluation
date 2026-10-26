import { afterEach, beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { members } from '../src/db/schema.js';
import { walletOf } from '../src/services/economy.js';
import { payCredit } from '../src/services/casino/tables/service.js';
import { cfg, makeDb } from './helpers.js';

const M = '760000000000000555';
let db: Db, close: () => Promise<void>;
beforeEach(async () => { ({ db, close } = await makeDb()); await db.insert(members).values({ id: M, username: 'm', displayName: 'm' }); });
afterEach(async () => close());

it('満額の最低保証（keiba_purse_bet）は 1 人 1 日の上限まで。賭けていない分（keiba_purse）とは別に数える', async () => {
  const c = { ...cfg, casino: { ...cfg.casino, keibaBetDailyCap: 1000, keibaNoBetDailyCap: 100 } };
  const now = new Date('2026-10-26T03:00:00Z');
  expect(await payCredit(db, c, { memberId: M, amount: 800, reason: 'keiba_prize', cap: 'keiba_purse_bet' }, now, 'keiba', 1)).toBe(800);
  expect(await payCredit(db, c, { memberId: M, amount: 800, reason: 'keiba_prize', cap: 'keiba_purse_bet' }, now, 'keiba', 1)).toBe(200);
  expect(await payCredit(db, c, { memberId: M, amount: 80, reason: 'keiba_prize', cap: 'keiba_purse' }, now, 'keiba', 1)).toBe(80);
  expect((await walletOf(db, M)).balance).toBe(1080);
});

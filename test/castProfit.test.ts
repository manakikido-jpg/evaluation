import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { castChampagnes, castSessions } from '../src/db/schema.js';
import { castProfit } from '../src/services/castProfit.js';
import { addCoins } from '../src/services/economy.js';
import { makeDb } from './helpers.js';

const CAST = '880000000000000002', CUSTOMER = '880000000000000001';
const START = new Date('2026-09-30T15:00:00Z'), END = new Date('2026-10-31T15:00:00Z');
const IN = new Date('2026-10-20T03:00:00Z');

describe('💹 キャストの運営の収支', () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await makeDb());
  });
  afterEach(async () => close());

  it('指名・納品の取り分と、シャンパンを別枠で数える。月のごほうびは引く', async () => {
    const base = { castId: CAST, customerId: CUSTOMER, plan: '30', minutes: 30 };
    const [done] = await db.insert(castSessions).values({ ...base, price: 1000, paid: 900, status: 'done', closedAt: IN }).returning();
    const [declined] = await db.insert(castSessions).values({ ...base, price: 500, paid: 0, status: 'declined', closedAt: IN }).returning();
    await addCoins(db, CUSTOMER, 500, 'cast_refund', { sessionId: declined!.id });
    // ほかの月・預かり中は数えない
    await db.insert(castSessions).values({ ...base, price: 700, paid: 600, status: 'done', closedAt: new Date('2026-09-10T00:00:00Z') });
    await db.insert(castSessions).values({ ...base, price: 300, status: 'accepted' });
    await db.insert(castChampagnes).values([
      { id: 'a', sessionId: done!.id, customerId: CUSTOMER, castId: CAST, channelId: 'r', bottle: 'sakura', bottleName: '桜のしずく', price: 500, fee: 150, expiresAt: IN, paidAt: IN },
      { id: 'b', sessionId: done!.id, customerId: CUSTOMER, castId: CAST, channelId: 'r', bottle: 'moon', bottleName: '月夜の泡', price: 1000, fee: 300, expiresAt: IN },
    ]);
    await addCoins(db, CAST, 200, 'cast_rank_bonus', {});
    const p = await castProfit(db, START, END);
    expect(p.sessions).toEqual({ count: 2, sales: 1500, refunds: 500, toCasts: 900, fees: 100 });
    expect(p.champagne).toEqual({ count: 1, sales: 500, toCasts: 350, fees: 150 });
    expect(p.escrow).toBe(300);
    // ごほうびは今の時刻で記録されるので、今月をふくむ範囲で数える
    const now = await castProfit(db, START, new Date(Date.now() + 86_400_000));
    expect(now.net).toBe(100 + 150 - now.rankBonus);
  });
});

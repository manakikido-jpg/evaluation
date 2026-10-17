import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { casinoGames } from '../src/db/schema.js';
import { avgAtWin, findAtSevenMisses, payAtSevenRefund, showsSevens } from '../src/services/casino/atRefund.js';
import { AT_IDLE_STOPS, AT_REELS } from '../src/services/casino/slotAt.js';
import { walletOf } from '../src/services/economy.js';
import { makeDb } from './helpers.js';

const A = '790000000000000001';
const B = '790000000000000002';
const STAFF = '790000000000000009';
let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
});
afterEach(async () => {
  await close();
});

// 中段に鬼7 がそろう目
const oni = [0, 1, 2].map((r) => AT_REELS[r]!.indexOf('r7'));
const game = (memberId: string, state: Record<string, unknown>) =>
  db.insert(casinoGames).values({ memberId, game: 'atslot', bet: 30, status: 'done', state: { v: 1, machine: 1, setting: 1, during: 'normal', navi: null, hint: 0, events: [], ...state } }).returning();

describe('🦊 AT 機の補填', () => {
  it('7 がそろって見えたのに白狐目でなかった回を人ごとに数え、平均の獲得を 1 回だけ渡す', async () => {
    expect(showsSevens(oni)).toBe(true);
    expect(showsSevens(AT_IDLE_STOPS)).toBe(false);
    await game(A, { role: 'none', stops: oni });
    await game(A, { role: 'bell', stops: oni });
    await game(A, { role: 'byakko', stops: oni }); // ちゃんと当たった回は数えない
    await game(B, { role: 'none', stops: oni, waiting: true }); // 押し順待ちの目は数えない
    await game(B, { role: 'none', stops: AT_IDLE_STOPS });
    await game(B, { role: 'none', stops: AT_IDLE_STOPS, events: [{ k: 'at_end', games: 50, won: 1000, sets: 1 }] });
    await game(B, { role: 'none', stops: AT_IDLE_STOPS, events: [{ k: 'at_end', games: 80, won: 2001, sets: 2 }] });

    expect((await findAtSevenMisses(db)).rows).toEqual([{ memberId: A, games: expect.any(Array) }]);
    expect((await findAtSevenMisses(db)).rows[0]!.games).toHaveLength(2);
    expect(await avgAtWin(db)).toEqual({ avg: 1500, count: 2 });

    expect(await payAtSevenRefund(db, 0, STAFF)).toEqual({ people: 0, games: 0, total: 0 });
    expect(await payAtSevenRefund(db, 1500, STAFF)).toEqual({ people: 1, games: 2, total: 3000 });
    expect((await walletOf(db, A)).balance).toBe(3000);
    // 2 回目は渡さない
    expect(await payAtSevenRefund(db, 1500, STAFF)).toEqual({ people: 0, games: 0, total: 0 });
    expect((await walletOf(db, A)).balance).toBe(3000);
    expect((await findAtSevenMisses(db)).rows).toEqual([]);
  });
});

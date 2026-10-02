import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { mahjongResults } from '../src/db/schema.js';
import { mjRanking, mjStats, monthStartJst } from '../src/services/casino/mahjongStats.js';
import { makeDb } from './helpers.js';

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
});
afterEach(async () => {
  await close();
});

const row = (memberId: string, rank: number, extra: Partial<typeof mahjongResults.$inferInsert> = {}) => ({
  tableId: 1,
  memberId,
  name: memberId,
  rank,
  points: 40000 - rank * 5000,
  length: 'tonpu',
  hands: 5,
  wins: rank === 1 ? 2 : 0,
  dealins: rank === 4 ? 1 : 0,
  riichi: 1,
  finishedAt: new Date('2026-10-02T03:00:00Z'),
  ...extra,
});

describe('🀄 雀荘の戦績', () => {
  it('通算の戦績（平均順位・順位の回数・和了率など・最高の和了）', async () => {
    await db.insert(mahjongResults).values([row('a', 1, { bestPoints: 12000, bestName: '跳満' }), row('a', 2), row('a', 4, { bestPoints: 2000, bestName: '立直' }), row('b', 3)]);
    const s = await mjStats(db, 'a');
    expect(s.games).toBe(3);
    expect(s.avgRank).toBeCloseTo(7 / 3);
    expect(s.ranks).toEqual([1, 1, 0, 1]);
    expect(s.hands).toBe(15);
    expect(s.winRate).toBeCloseTo(2 / 15);
    expect(s.dealinRate).toBeCloseTo(1 / 15);
    expect(s.best).toEqual({ points: 12000, name: '跳満' });
    expect((await mjStats(db, 'nobody')).games).toBe(0);
  });

  it('今月のランキング: 3 戦以上・平均順位の低い順', async () => {
    const old = { finishedAt: new Date('2026-09-20T00:00:00Z') };
    await db.insert(mahjongResults).values([
      ...[1, 1, 2].map((r) => row('top', r)),
      ...[2, 3, 2, 1].map((r) => row('mid', r)),
      ...[1, 1].map((r) => row('few', r)),
      ...[1, 1, 1].map((r) => row('lastmonth', r, old)),
    ]);
    const since = monthStartJst(new Date('2026-10-03T00:00:00Z'));
    expect(since.toISOString()).toBe('2026-09-30T15:00:00.000Z');
    const r = await mjRanking(db, since, 3);
    expect(r.map((x) => x.memberId)).toEqual(['top', 'mid']);
    expect(r[0]).toMatchObject({ games: 3, avgRank: 4 / 3 });
    expect(r[0]!.topRate).toBeCloseTo(2 / 3);
  });
});

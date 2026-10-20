import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { castSessions } from '../src/db/schema.js';
import { castPanel } from '../src/discord/cast.js';
import { awardCastRank, castRanking, monthKey, monthOf, parseMonth, pastRankWinners } from '../src/services/castRank.js';
import { walletOf } from '../src/services/economy.js';
import { makeDb } from './helpers.js';

const A = '880000000000000101';
const B = '880000000000000102';
const C = '880000000000000103';
const U1 = '880000000000000201';
const U2 = '880000000000000202';
// 9 月の終わった指名（日本時間）
const SEP = new Date('2026-09-15T03:00:00Z');

describe('🏆 キャストのランキング', () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await makeDb());
  });
  afterEach(async () => {
    await close();
  });

  const add = (castId: string, customerId: string, status: string, paid = 0, at = SEP, rating: number | null = null) =>
    db.insert(castSessions).values({ castId, customerId, plan: '30', minutes: 30, price: paid, paid, status: status as never, createdAt: at, closedAt: at, rating });

  it('月の名前と月のはじめ（日本時間）', () => {
    expect(monthKey(monthOf(new Date('2026-09-30T16:00:00Z')))).toBe('2026-10');
    expect(monthKey(monthOf(new Date('2026-10-05T00:00:00Z'), -1))).toBe('2026-09');
    expect(monthKey(parseMonth('2026-01')!)).toBe('2026-01');
    expect(parseMonth('2026-13')).toBeUndefined();
    expect(parseMonth('x')).toBeUndefined();
  });

  it('くわしいランキング: 指名の多い順。売り上げ・評価・お客・断った・取り消し・来なかったを数える', async () => {
    await add(A, U1, 'done', 300, SEP, 5);
    await add(A, U1, 'done', 300, SEP, 4);
    await add(A, U2, 'done', 500);
    await add(A, U2, 'canceled');
    await add(B, U1, 'done', 1000);
    await add(B, U2, 'declined');
    await add(B, U2, 'noshow_cast');
    await add(C, U1, 'done', 100, new Date('2026-10-02T03:00:00Z'));
    const rows = await castRanking(db, parseMonth('2026-09')!);
    expect(rows.map((r) => r.castId)).toEqual([A, B]);
    expect(rows[0]).toMatchObject({ count: 3, earned: 1100, ratingAvg: 4.5, ratings: 2, customers: 2, repeaters: 1, canceled: 1 });
    expect(rows[1]).toMatchObject({ count: 1, earned: 1000, declined: 1, noShow: 1 });
  });

  it('毎月 1 日に 1 回だけ発表して、1 位に銭をわたす（もう一度呼んでもわたさない）', async () => {
    await add(A, U1, 'done', 300);
    await add(B, U1, 'done', 300);
    await add(B, U2, 'done', 300);
    const now = new Date('2026-09-30T16:30:00Z'); // 10/1 1:30（日本時間）
    const r = await awardCastRank(db, { rankBonus: 1000 }, now);
    expect(r).toMatchObject({ month: '2026-09', winnerId: B, bonus: 1000 });
    expect(r!.top.map((x) => x.castId)).toEqual([B, A]);
    expect((await walletOf(db, B)).balance).toBe(1000);
    expect(await awardCastRank(db, { rankBonus: 1000 }, now)).toBeUndefined();
    expect((await walletOf(db, B)).balance).toBe(1000);
    expect(await pastRankWinners(db)).toEqual([B]);
  });

  it('同時に呼ばれても銭は 1 回だけ', async () => {
    await add(A, U1, 'done', 300);
    const now = new Date('2026-10-01T00:00:00Z');
    const rs = await Promise.all([awardCastRank(db, { rankBonus: 500 }, now), awardCastRank(db, { rankBonus: 500 }, now)]);
    expect(rs.filter(Boolean)).toHaveLength(1);
    expect((await walletOf(db, A)).balance).toBe(500);
  });

  it('8 日より後（月の途中に入れたとき）は、先月の分を出さない。指名がない月は何も出さない', async () => {
    await add(A, U1, 'done', 300);
    expect(await awardCastRank(db, { rankBonus: 500 }, new Date('2026-10-20T00:00:00Z'))).toBeUndefined();
    expect((await walletOf(db, A)).balance).toBe(0);
    expect(await awardCastRank(db, { rankBonus: 500 }, new Date('2026-11-01T00:00:00Z'))).toBeUndefined();
  });

  it('メニュー（パネル）に今月の上位 3 人が出る', () => {
    const body = castPanel([], undefined, undefined, [{ name: 'あ', count: 5 }, { name: 'い', count: 3 }, { name: 'う', count: 1 }, { name: 'え', count: 1 }]);
    const text = body.embeds![0]!.description!;
    expect(text).toContain('🏆 今月の上位: 🥇 あ（5 回）　🥈 い（3 回）　🥉 う（1 回）');
    expect(text).not.toContain('え（');
    expect(castPanel([], undefined, undefined, []).embeds![0]!.description).not.toContain('🏆');
  });
});

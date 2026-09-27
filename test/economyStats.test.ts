import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { coinTx } from '../src/db/schema.js';
import { addCoins, spendWithin } from '../src/services/economy.js';
import { balanceDistribution, bigTransactions, economyOverview, flowOf, rangeStart } from '../src/services/economyStats.js';
import { recordJoin, recordLeave } from '../src/services/members.js';
import { makeDb } from './helpers.js';

const A = '860000000000000001';
const B = '860000000000000002';
const C = '860000000000000003';
const GONE = '860000000000000004';
const NOW = new Date('2026-09-27T12:00:00+09:00');
const DAY = 86_400_000;
const snap = (id: string) => ({ id, username: id, displayName: `n${id.slice(-1)}`, avatarUrl: null, roleIds: [], isBot: false, joinedAt: null });

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  for (const id of [A, B, C, GONE]) await recordJoin(db, snap(id));
});
afterEach(async () => {
  await close();
});

/** 日時を決めて出入りを入れる */
async function tx(memberId: string, amount: number, reason: string, at: Date) {
  if (amount > 0) await addCoins(db, memberId, amount, reason as never);
  else await spendWithin(db, memberId, -amount, reason as never, {});
  // いちばん新しい記録の日時を合わせる
  const { desc, eq } = await import('drizzle-orm');
  const [last] = await db.select().from(coinTx).where(eq(coinTx.memberId, memberId)).orderBy(desc(coinTx.id)).limit(1);
  await db.update(coinTx).set({ at }).where(eq(coinTx.id, last!.id));
}

describe('経済', () => {
  it('理由ごとの分け方', () => {
    expect(flowOf('voice')).toBe('issue');
    expect(flowOf('gacha')).toBe('income');
    expect(flowOf('market_sell')).toBe('income');
    expect(flowOf('gift_send')).toBe('transfer');
    expect(flowOf('admin_grant')).toBe('admin');
    expect(flowOf('なぞ')).toBe('admin');
  });

  it('配った・鯖の収入（払い戻し・市場の手数料）・調整・出回る量の推移', async () => {
    const d = (n: number) => new Date(NOW.getTime() - n * DAY);
    await tx(A, 3000, 'join_bonus', d(40)); // 期間の前
    await tx(A, 100, 'voice', d(5));
    await tx(B, 3000, 'join_bonus', d(5));
    await tx(A, -500, 'gacha', d(3));
    await tx(A, 50, 'gacha_refund', d(3));
    await tx(B, -1000, 'shop', d(2));
    // 市場: B が 200 で買い、A に 180（手数料 20）
    await tx(B, -200, 'market_buy', d(1));
    await tx(A, 180, 'market_sell', d(1));
    // 贈り物（行き来だけ）
    await tx(B, -100, 'gift_send', d(1));
    await tx(C, 100, 'gift_receive', d(1));
    await tx(C, 1000, 'admin_grant', d(0));

    const o = await economyOverview(db, '30d', NOW);
    expect(o.supply).toBe(3000 + 100 + 3000 - 500 + 50 - 1000 - 200 + 180 + 1000);
    expect(o.issued).toBe(3100);
    expect(o.income).toBe(500 - 50 + 1000 + 20);
    expect(o.admin).toBe(1000);
    expect(o.net).toBe(3100 - 1470 + 1000);
    expect(o.giftVolume).toBe(100);
    expect(o.marketVolume).toBe(180);
    expect(o.incomeLines.map((l) => [l.label, l.amount, l.count])).toEqual([
      ['授与品（ショップ）', 1000, 1],
      ['物御籤', 450, 1],
      ['市場の手数料', 20, 1],
    ]);
    expect(o.issueLines.map((l) => [l.label, l.amount])).toEqual([
      ['初期配布', 3000],
      ['通話', 100],
    ]);
    // 出回る量: 最後の区切りは今の量、期間の前は 3000
    expect(o.buckets).toHaveLength(30);
    expect(o.buckets.at(-1)!.supply).toBe(o.supply);
    expect(o.buckets[0]!.supply).toBe(3000);
    expect(o.buckets.reduce((n, b) => n + b.issued, 0)).toBe(3100);
    expect(o.buckets.reduce((n, b) => n + b.income, 0)).toBe(1470);

    const big = await bigTransactions(db, rangeStart('30d', NOW));
    expect(big[0]).toMatchObject({ reason: 'join_bonus', amount: 3000 });
  });

  it('持っている量のかたより（退出した人・0 枚の人は数えない）', async () => {
    await addCoins(db, A, 9000, 'adjust');
    await addCoins(db, B, 1000, 'adjust');
    await addCoins(db, GONE, 50000, 'adjust');
    await recordLeave(db, GONE);
    const d = await balanceDistribution(db);
    expect(d).toMatchObject({ holders: 2, total: 10000, average: 5000, median: 5000, top10Share: 0.9 });
    expect(d.gini).toBe(0.4);
    expect(d.top.map((t) => t.memberId)).toEqual([A, B]);
    expect(d.bands.find((b) => b.label === '5,000〜9,999')).toMatchObject({ members: 1, total: 9000 });
  });
});

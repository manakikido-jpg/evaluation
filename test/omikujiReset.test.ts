import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { coinTx } from '../src/db/schema.js';
import { spendCoins, walletOf } from '../src/services/economy.js';
import { drawOmikuji, omikujiToday } from '../src/services/omikuji.js';
import { planOmikujiReset, resetOmikujiDay } from '../src/services/omikujiReset.js';
import { ticketsOf } from '../src/services/tickets.js';
import { cfg, makeDb } from './helpers.js';

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
});
afterEach(async () => close());

const economy = { ...cfg.economy, omikujiBase: 10 };
const streak = { rewards: [{ days: 3, repeat: true, coins: 50, ticket: 'gacha_free' as const, tickets: 1 }] };
/** 日本時間の正午 */
const day = (d: number) => new Date(Date.UTC(2026, 9, d, 3));
const draw = async (id: string, d: number, extra = false) => {
  const r = await drawOmikuji(db, economy, id, day(d), () => 0.5, { streak, extra });
  if (r.status !== 'drawn') throw new Error('not drawn');
  return r;
};

describe('🔄 今日のおみくじのリセット', () => {
  it('引いた全員の記録を消し、入った銭（もう 1 回・続けたおまけも）と券を取り戻す。使った分は残高まで', async () => {
    await draw('A', 1);
    await draw('A', 2);
    const before = (await walletOf(db, 'A')).balance;
    const a3 = await draw('A', 3);
    expect(a3.bonus.map((b) => b.days)).toEqual([3]);
    const a3x = await draw('A', 3, true);
    expect((await ticketsOf(db, 'A')).gacha_free).toBe(1);
    const b3 = await draw('B', 3);
    // B はもう少し使ってしまった
    await spendCoins(db, 'B', b3.amount - 3, 'shop');

    const plan = await planOmikujiReset(db, '2026-10-03', streak);
    expect(plan.members.map((m) => m.memberId)).toEqual(['A', 'B']);
    expect(plan.members[0]).toMatchObject({ draws: 2, coins: a3.amount + a3x.amount + 50, take: a3.amount + a3x.amount + 50, tickets: [{ kind: 'gacha_free', count: 1 }] });
    expect(plan.members[1]).toMatchObject({ draws: 1, coins: b3.amount, take: 3, tickets: [] });
    expect(plan).toMatchObject({ date: '2026-10-03', draws: 3 });

    const done = await resetOmikujiDay(db, '2026-10-03', streak, 'G');
    expect(done.take).toBe(plan.take);
    expect((await walletOf(db, 'A')).balance).toBe(before);
    expect((await walletOf(db, 'B')).balance).toBe(0);
    expect((await ticketsOf(db, 'A')).gacha_free).toBe(0);
    expect(await omikujiToday(db, 'A', day(3))).toEqual({ drawn: false, extraUsed: false });
    // 前の日の記録はそのまま（連続日数は消えない）
    expect(await omikujiToday(db, 'A', day(2))).toMatchObject({ drawn: true });
    const takes = await db.select().from(coinTx).where(eq(coinTx.reason, 'admin_take'));
    expect(takes.map((t) => [t.memberId, t.amount, (t.detail as { note?: string }).note])).toEqual([
      ['A', -(a3.amount + a3x.amount + 50), '今日のおみくじのリセット'],
      ['B', -3, '今日のおみくじのリセット'],
    ]);

    // もう一度押しても何もしない
    expect((await resetOmikujiDay(db, '2026-10-03', streak, 'G')).members).toEqual([]);

    // 引き直せる。もう一度リセットしても、前に数えた銭は数えない
    const again = await draw('A', 3);
    expect(again.streak).toBe(3);
    const plan2 = await planOmikujiReset(db, '2026-10-03', streak);
    expect(plan2.members).toEqual([{ memberId: 'A', draws: 1, coins: again.amount + 50, take: again.amount + 50, tickets: [{ kind: 'gacha_free', count: 1 }] }]);
    await resetOmikujiDay(db, '2026-10-03', streak, 'G');
    expect((await walletOf(db, 'A')).balance).toBe(before);
  });

  it('同時に押しても 1 回だけ', async () => {
    await draw('A', 5);
    const rs = await Promise.all([resetOmikujiDay(db, '2026-10-05', streak, 'G'), resetOmikujiDay(db, '2026-10-05', streak, 'G')]);
    expect(rs.map((r) => r.members.length).sort()).toEqual([0, 1]);
    expect((await walletOf(db, 'A')).balance).toBe(0);
    expect(await db.select().from(coinTx).where(eq(coinTx.reason, 'admin_take'))).toHaveLength(1);
  });
});

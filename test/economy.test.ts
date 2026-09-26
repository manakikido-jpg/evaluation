import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { addMessageCounts, eligibleVoiceMembers, jstDate, recentActivity, voiceTick } from '../src/services/activity.js';
import { addCoins, deductUpTo, recentCoinTx, spendCoins, walletOf } from '../src/services/economy.js';
import { giveFlow, revokeFlow } from '../src/services/flows.js';
import { cfg, makeDb, member, ROLE } from './helpers.js';

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
});
afterEach(async () => {
  await close();
});

const A = '810000000000000001';
const B = '810000000000000002';

describe('花びら（通貨）', () => {
  it('増やす・使う・記録が残る', async () => {
    expect(await addCoins(db, A, 100, 'adjust')).toBe(100);
    expect(await spendCoins(db, A, 30, 'menzaifu')).toBe(true);
    expect(await walletOf(db, A)).toEqual({ balance: 70, lifetimeEarned: 100 });
    expect((await recentCoinTx(db, A)).map((t) => t.amount)).toEqual([-30, 100]);
  });

  it('足りなければ使えない（残高はそのまま）', async () => {
    await addCoins(db, A, 10, 'adjust');
    expect(await spendCoins(db, A, 11, 'menzaifu')).toBe(false);
    expect((await walletOf(db, A)).balance).toBe(10);
    expect(await spendCoins(db, B, 1, 'menzaifu')).toBe(false);
  });

  it('同時に使ってもマイナスにならない', async () => {
    await addCoins(db, A, 100, 'adjust');
    const r = await Promise.all(Array.from({ length: 5 }, () => spendCoins(db, A, 40, 'menzaifu')));
    expect(r.filter(Boolean)).toHaveLength(2);
    expect((await walletOf(db, A)).balance).toBe(20);
  });

  it('できるだけ減らす', async () => {
    await addCoins(db, A, 3, 'adjust');
    expect(await deductUpTo(db, A, 5, 'shuin_revoke')).toBe(3);
    expect(await deductUpTo(db, A, 5, 'shuin_revoke')).toBe(0);
  });

  it('朱印を押すと、押した人・押された人の両方がもらえる（同じ相手とは 1 回だけ）', async () => {
    await giveFlow(db, cfg, member(A, ROLE.ujiko), member(B, ROLE.sanpaisha));
    expect((await walletOf(db, A)).balance).toBe(cfg.economy.shuinGive);
    expect((await walletOf(db, B)).balance).toBe(cfg.economy.shuinReceive);
    // 取り消して押し直しても増えない
    await revokeFlow(db, A, B);
    await giveFlow(db, cfg, member(A, ROLE.ujiko), member(B, ROLE.sanpaisha));
    expect((await walletOf(db, A)).balance).toBe(cfg.economy.shuinGive);
    expect((await walletOf(db, B)).balance).toBe(cfg.economy.shuinReceive);
  });
});

describe('通話', () => {
  it('数える人: 2 人以上・BOT とスピーカーミュートと除外チャンネルは数えない', () => {
    const r = eligibleVoiceMembers(
      [
        { id: 'c1', members: [{ id: 'a', bot: false, deaf: false }, { id: 'b', bot: false, deaf: false }, { id: 'x', bot: false, deaf: true }] },
        { id: 'c2', members: [{ id: 'c', bot: false, deaf: false }, { id: 'bot', bot: true, deaf: false }] },
        { id: 'afk', members: [{ id: 'd', bot: false, deaf: false }, { id: 'e', bot: false, deaf: false }] },
      ],
      new Set(['afk']),
    );
    expect(r).toEqual(['a', 'b']);
  });

  it('10 分ごとにもらえて、1 日の上限で止まる', async () => {
    const economy = { ...cfg.economy, voicePer10Min: 5, voiceDailyCap: 12 };
    const t0 = Date.parse('2026-09-25T03:00:00Z');
    let total = 0;
    for (let m = 1; m <= 40; m++) {
      const got = await voiceTick(db, economy, [A], new Date(t0 + m * 60_000));
      total += got.reduce((s, g) => s + g.amount, 0);
    }
    // 10 分: 5、20 分: 5、30 分: 2（上限 12）、40 分: 0
    expect(total).toBe(12);
    expect((await walletOf(db, A)).balance).toBe(12);
    const [today] = await recentActivity(db, A);
    expect(today).toMatchObject({ vcMinutes: 40, vcCoins: 12 });
  });

  it('日本時間の日付が変わると上限もリセット', async () => {
    const economy = { ...cfg.economy, voicePer10Min: 5, voiceDailyCap: 5 };
    // 日本時間 23:50〜 と 翌 0:00〜
    const lateNight = Date.parse('2026-09-25T14:50:00Z');
    for (let m = 1; m <= 10; m++) await voiceTick(db, economy, [A], new Date(lateNight + (m - 1) * 60_000));
    for (let m = 1; m <= 10; m++) await voiceTick(db, economy, [A], new Date(lateNight + (10 + m) * 60_000));
    expect((await walletOf(db, A)).balance).toBe(10);
    expect(jstDate(new Date(lateNight))).toBe('2026-09-25');
    expect(jstDate(new Date(lateNight + 11 * 60_000))).toBe('2026-09-26');
  });

  it('発言数をまとめて足す', async () => {
    const now = new Date('2026-09-25T03:00:00Z');
    await addMessageCounts(db, new Map([[A, 3]]), now);
    await addMessageCounts(db, new Map([[A, 2], [B, 1]]), now);
    expect((await recentActivity(db, A))[0]?.messageCount).toBe(5);
    expect((await recentActivity(db, B))[0]?.messageCount).toBe(1);
  });
});

describe('初期配布', () => {
  it('1 人 1 回だけ。何度呼んでも 2 回目はない', async () => {
    const { grantJoinBonus, walletOf } = await import('../src/services/economy.js');
    const results = await Promise.all([grantJoinBonus(db, 'A', 3000), grantJoinBonus(db, 'A', 3000)]);
    expect(results.sort()).toEqual([0, 3000]);
    expect((await walletOf(db, 'A')).balance).toBe(3000);
    expect(await grantJoinBonus(db, 'B', 0)).toBe(0);
  });

  it('今いる人にまとめて配る: 役職がある在籍中の人だけ。もらい済みの人は飛ばす', async () => {
    const { grantJoinBonus, grantJoinBonusToAll, walletOf } = await import('../src/services/economy.js');
    const { recordJoin, recordLeave } = await import('../src/services/members.js');
    const join = (id: string, roleIds: string[], isBot = false) =>
      recordJoin(db, { id, username: id, displayName: id, avatarUrl: null, roleIds, isBot, joinedAt: null });
    await join('M1', [ROLE.sanpaisha]);
    await join('M2', [ROLE.ujiko]);
    await join('NOROLE', []);
    await join('BOT', [ROLE.sanpaisha], true);
    await join('LEFT', [ROLE.sanpaisha]);
    await recordLeave(db, 'LEFT');
    await grantJoinBonus(db, 'M2', 3000);
    const ranks = cfg.ranks.map((r) => r.roleId);
    expect(await grantJoinBonusToAll(db, 3000, ranks)).toEqual({ granted: 1, total: 2 });
    expect((await walletOf(db, 'M1')).balance).toBe(3000);
    expect((await walletOf(db, 'M2')).balance).toBe(3000);
    expect((await walletOf(db, 'NOROLE')).balance).toBe(0);
    expect(await grantJoinBonusToAll(db, 3000, ranks)).toEqual({ granted: 0, total: 2 });
  });
});

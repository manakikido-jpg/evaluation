import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GuildConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { casinoGames, coinTx } from '../src/db/schema.js';
import { bigWins } from '../src/services/casino/casino.js';
import { myBest, myByGame, myDaily, popularToday, rangeStart, topMultipliers, winRanking } from '../src/services/casino/memberStats.js';
import { houseProfitOn, profitShareDm, profitShareLog, recentProfitShares, settleProfitShare, shareEach, shareRecipients } from '../src/services/casino/profitShare.js';
import { addCoins, spendWithin, walletOf } from '../src/services/economy.js';
import { recordJoin, recordLeave } from '../src/services/members.js';
import { cfg, makeDb, ROLE } from './helpers.js';
import { eq } from 'drizzle-orm';

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
});
afterEach(async () => close());

const G1 = '770000000000000001';
const G2 = '770000000000000002';
const P = '770000000000000003';
const OLD = '770000000000000004';
const join = (id: string, roleIds: string[], isBot = false) =>
  recordJoin(db, { id, username: id, displayName: `n${id.slice(-1)}`, avatarUrl: null, roleIds, isBot, joinedAt: new Date('2026-09-01T00:00:00Z') });
/** その日（日本時間の昼）に遊んだ記録 */
const game = (date: string, bet: number, payout: number, memberId = P, g = 'slots') =>
  db.insert(casinoGames).values({ memberId, game: g, bet, payout, state: {}, status: 'done', createdAt: new Date(`${date}T12:00:00+09:00`), finishedAt: new Date(`${date}T12:00:00+09:00`) });

describe('💰 カジノの収益の分け前', () => {
  it('1 人あたり: % ずつ。合計が収支を超えるときは山分け。赤字・0 人は 0', () => {
    expect(shareEach(1000, 25, 2)).toBe(250);
    expect(shareEach(999, 25, 2)).toBe(249);
    expect(shareEach(1000, 25, 5)).toBe(200);
    expect(shareEach(-500, 25, 2)).toBe(0);
    expect(shareEach(1000, 25, 0)).toBe(0);
    expect(shareEach(1000, 0, 2)).toBe(0);
  });

  it('受け取る人は、いる宮司だけ（神職・抜けた人・BOT は入れない）', async () => {
    await join(G1, [ROLE.guji]);
    await join(G2, [ROLE.guji, ROLE.sanpaisha]);
    await join(P, [ROLE.shinshoku]);
    await join(OLD, [ROLE.guji]);
    await recordLeave(db, OLD);
    await join('770000000000000099', [ROLE.guji], true);
    expect(await shareRecipients(db, cfg)).toEqual([G1, G2]);
  });

  it('はじめは「始めた日」の印だけ。次の日から、前の日の黒字の 25% を宮司それぞれへ（1 日 1 回だけ）', async () => {
    await join(G1, [ROLE.guji]);
    await join(G2, [ROLE.guji]);
    await game('2026-10-06', 3000, 1000);
    await game('2026-10-07', 1000, 0);
    await game('2026-10-07', 500, 300, 'bot');
    await game('2026-10-07', 1000, 5000);
    await game('2026-10-07', 6000, 0);
    // 10/7 の胴元の収支: (1000 - 0) + (500 - 300) + (1000 - 5000) + (6000 - 0) = 3200
    expect(await houseProfitOn(db, '2026-10-07')).toBe(3200);
    // 10/7 に動き始めた → 10/6 は印だけ
    const start = await settleProfitShare(db, cfg, new Date('2026-10-07T03:00:00Z'));
    expect(start).toMatchObject({ date: '2026-10-06', note: 'start', paid: 0, profit: 2000 });
    expect(profitShareLog(start!, '🪙銭')).toBeUndefined();
    expect(await settleProfitShare(db, cfg, new Date('2026-10-07T10:00:00Z'))).toBeUndefined();
    // 10/8 の 0 時を過ぎた → 10/7 の分
    const r = await settleProfitShare(db, cfg, new Date('2026-10-07T15:00:30Z'));
    expect(r).toMatchObject({ date: '2026-10-07', profit: 3200, percent: 25, paid: 1600, note: null });
    expect(r!.recipients).toEqual([
      { memberId: G1, amount: 800 },
      { memberId: G2, amount: 800 },
    ]);
    expect((await walletOf(db, G1)).balance).toBe(800);
    const tx = await db.select().from(coinTx).where(eq(coinTx.memberId, G1));
    expect(tx.map((t) => [t.reason, t.amount])).toEqual([['casino_share', 800]]);
    // 同じ日は 2 回渡さない（同時に動いても）
    const again = await Promise.all([settleProfitShare(db, cfg, new Date('2026-10-07T15:01:00Z')), settleProfitShare(db, cfg, new Date('2026-10-07T15:01:00Z'))]);
    expect(again).toEqual([undefined, undefined]);
    expect((await walletOf(db, G1)).balance).toBe(800);
    expect(profitShareDm(r!, 800, '🪙銭')).toBe('💰 10/7 のカジノの収益（胴元の収支 +3,200 枚）の 25%、🪙銭 **800 枚**が入りました（咲楽ノ宮）。');
    expect(profitShareLog(r!, '🪙銭')).toBe(`💰 10/7 のカジノの胴元の収支: +3,200 枚 → 宮司に 25% ずつ: <@${G1}> 🪙銭 800 枚・<@${G2}> 🪙銭 800 枚`);
    expect((await recentProfitShares(db)).map((s) => s.date)).toEqual(['2026-10-07', '2026-10-06']);
  });

  it('赤字の日は 0（持ちこさない）・止めているとき・宮司がいないとき', async () => {
    await join(G1, [ROLE.guji]);
    await settleProfitShare(db, cfg, new Date('2026-10-05T03:00:00Z'));
    await game('2026-10-05', 100, 900);
    const loss = await settleProfitShare(db, cfg, new Date('2026-10-05T15:00:30Z'));
    expect(loss).toMatchObject({ date: '2026-10-05', profit: -800, paid: 0, note: 'loss' });
    expect(profitShareLog(loss!, '銭')).toContain('黒字ではないので');
    await game('2026-10-06', 1000, 0);
    const off: GuildConfig = { ...cfg, casino: { ...cfg.casino, profitSharePercent: 0 } };
    expect(await settleProfitShare(db, off, new Date('2026-10-06T15:00:30Z'))).toMatchObject({ note: 'off', paid: 0 });
    expect((await walletOf(db, G1)).balance).toBe(0);
    await recordLeave(db, G1);
    await game('2026-10-07', 1000, 0);
    expect(await settleProfitShare(db, cfg, new Date('2026-10-07T15:00:30Z'))).toMatchObject({ note: 'no_one', paid: 0 });
  });
});

describe('📊 カジノの記録', () => {
  it('期間の始まり（日本時間。週は月曜から）', () => {
    // 2026-10-07 は水曜
    const now = new Date('2026-10-07T12:00:00Z');
    expect(rangeStart('today', now)).toEqual(new Date('2026-10-07T00:00:00+09:00'));
    expect(rangeStart('week', now)).toEqual(new Date('2026-10-05T00:00:00+09:00'));
    expect(rangeStart('month', now)).toEqual(new Date('2026-10-01T00:00:00+09:00'));
    expect(rangeStart('week', new Date('2026-10-04T05:00:00Z'))).toEqual(new Date('2026-09-28T00:00:00+09:00'));
  });

  it('自分の成績・勝ち額ランキング（同じ額は同じ順位・負け越しは上位に出さない）', async () => {
    // 銭の出入りは DB の今の時刻で残るので、今の時刻で確かめる
    const now = new Date();
    const since = new Date(now.getTime() - 86_400_000);
    for (const id of [G1, G2, P]) await addCoins(db, id, 10_000, 'admin_grant');
    const play = async (id: string, bet: number, win: number, g: string) => {
      await spendWithin(db, id, bet, 'casino_bet', { game: g });
      if (win > 0) await addCoins(db, id, win, 'casino_win', { game: g });
    };
    await play(P, 100, 500, 'slots');
    await play(P, 200, 0, 'blackjack');
    await play(G1, 100, 300, 'slots');
    await play(G2, 1000, 0, 'roulette');
    const r = await winRanking(db, since, G2);
    expect(r.top).toEqual([
      { memberId: P, net: 200, rank: 1 },
      { memberId: G1, net: 200, rank: 1 },
    ].sort((a, b) => a.memberId.localeCompare(b.memberId)));
    expect(r.me).toEqual({ memberId: G2, net: -1000, rank: 3 });
    expect(r.players).toBe(3);
    const days = await myDaily(db, P, 30, now);
    expect(days).toHaveLength(30);
    expect(days.at(-1)).toMatchObject({ net: 200, wagered: 300 });
    expect(await myByGame(db, P, since)).toEqual([
      { game: 'slots', net: 400, wagered: 100, plays: 0 },
      { game: 'blackjack', net: -200, wagered: 200, plays: 0 },
    ]);
  });

  it('大当たり: 胴元の BOT の記録は出さない。倍率の高い順・いちばんの当たり・今日の人気', async () => {
    const now = new Date();
    const today = new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
    const at = new Date(`${today}T00:30:00+09:00`) > now ? now : new Date(`${today}T00:30:00+09:00`);
    const row = (memberId: string, bet: number, payout: number, g = 'slots') => db.insert(casinoGames).values({ memberId, game: g, bet, payout, state: {}, status: 'done', createdAt: at, finishedAt: at });
    await row('bot', 0, 5000, 'poker');
    await row(P, 100, 2000);
    await row(G1, 1000, 6000, 'roulette');
    await row(G1, 100, 100, 'roulette');
    const since = new Date(now.getTime() - 86_400_000);
    expect((await bigWins(db, since, 10)).map((w) => w.memberId)).toEqual([G1, P]);
    expect((await topMultipliers(db, since)).map((w) => [w.memberId, w.payout / w.bet])).toEqual([[P, 20]]);
    expect((await myBest(db, G1)).map((g) => g.payout - g.bet)).toEqual([5000]);
    const pop = await popularToday(db, now);
    expect(pop.find((s) => s.game === 'roulette')).toMatchObject({ players: 1, plays: 2 });
  });
});

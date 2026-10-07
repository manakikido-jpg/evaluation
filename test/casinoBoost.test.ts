import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sharedMaxBet, type GuildConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { casinoBoostText } from '../src/discord/gacha.js';
import { casinoBoostNote } from '../src/discord/shop.js';
import { walletView } from '../src/discord/wallet.js';
import { buffsOf } from '../src/services/buffs.js';
import { baseCasino, boostCasino, casinoBoostUntil, casinoCfgFor, nextJstMidnight, useCasinoBoost } from '../src/services/casino/boost.js';
import { checkBet, playRoulette, todayBets } from '../src/services/casino/casino.js';
import { actTable, createTable } from '../src/services/casino/tables/service.js';
import { addCoins, spendWithin, walletOf } from '../src/services/economy.js';
import { buySimple, listItems, seedDefaultItems } from '../src/services/shop.js';
import { addTickets, emptyTickets, ticketsOf } from '../src/services/tickets.js';
import { cfg, makeDb } from './helpers.js';

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
});
afterEach(async () => close());

const A = { id: '760000000000000001', name: 'a' };
const B = { id: '760000000000000002', name: 'b' };
// 日本時間 2026-10-07 21:00
const now = new Date('2026-10-07T12:00:00Z');
const c0 = { ...cfg.casino, minBet: 10, maxBet: 1000, rouletteMaxBet: 0, dailyBetLimit: 20000, boostMult: 5 };
const bcfg: GuildConfig = { ...cfg, casino: c0 };

describe('🎰 大勝負の札', () => {
  it('上限を倍率の分だけ上げる（0 = 上限なしはそのまま）・元に戻せる・二重には上げない', () => {
    const b = boostCasino(c0);
    expect([b.maxBet, b.dailyBetLimit, b.rouletteMaxBet]).toEqual([5000, 100000, 0]);
    expect(boostCasino(b)).toBe(b);
    expect(boostCasino({ ...c0, dailyBetLimit: 0, rouletteMaxBet: 300 })).toMatchObject({ dailyBetLimit: 0, rouletteMaxBet: 1500 });
    expect(baseCasino(b)).toEqual(c0);
    // 卓の参加費・ブラインドは元の 1 回の最高
    expect(sharedMaxBet(b)).toBe(1000);
    expect(sharedMaxBet(c0)).toBe(1000);
  });

  it('使うと、その日の日本時間 0 時まで効く。効いている日は使えない（札は減らない）', async () => {
    expect(await useCasinoBoost(db, A.id, now)).toEqual({ status: 'no_ticket' });
    await addTickets(db, A.id, 'casino_boost', 2);
    const midnight = new Date('2026-10-07T15:00:00Z');
    expect(nextJstMidnight(now)).toEqual(midnight);
    expect(await useCasinoBoost(db, A.id, now)).toEqual({ status: 'ok', until: midnight });
    expect(await useCasinoBoost(db, A.id, new Date(now.getTime() + 60_000))).toEqual({ status: 'active', until: midnight });
    expect((await ticketsOf(db, A.id)).casino_boost).toBe(1);
    expect(await casinoBoostUntil(db, A.id, now)).toEqual(midnight);
    // 0 時を過ぎたら切れる。次の日はまた使える
    const next = new Date('2026-10-07T15:00:01Z');
    expect(await casinoBoostUntil(db, A.id, next)).toBeUndefined();
    expect(await useCasinoBoost(db, A.id, next)).toEqual({ status: 'ok', until: new Date('2026-10-08T15:00:00Z') });
    expect((await ticketsOf(db, A.id)).casino_boost).toBe(0);
  });

  it('同時に押しても、札は 1 枚だけ使う', async () => {
    await addTickets(db, A.id, 'casino_boost', 3);
    const rs = await Promise.all([useCasinoBoost(db, A.id, now), useCasinoBoost(db, A.id, now), useCasinoBoost(db, A.id, now)]);
    expect(rs.map((r) => r.status).sort()).toEqual(['active', 'active', 'ok']);
    expect((await ticketsOf(db, A.id)).casino_boost).toBe(2);
  });

  it('効いている人だけ、1 回の最高・1 日の合計が上がる（ほかの人の札で上がった設定を渡されても、その人の分）', async () => {
    await addCoins(db, A.id, 200_000, 'adjust');
    await addCoins(db, B.id, 200_000, 'adjust');
    expect(await checkBet(db, bcfg, A.id, 'blackjack', 3000, now)).toBe('bad_bet');
    await addTickets(db, A.id, 'casino_boost', 1);
    await useCasinoBoost(db, A.id, now);
    expect(await checkBet(db, bcfg, A.id, 'blackjack', 3000, now)).toBe('ok');
    expect(await checkBet(db, bcfg, A.id, 'blackjack', 5001, now)).toBe('bad_bet');
    expect(await checkBet(db, bcfg, B.id, 'blackjack', 3000, now)).toBe('bad_bet');
    const forA = await casinoCfgFor(db, bcfg, A.id, now);
    expect(forA.casino.maxBet).toBe(5000);
    expect((await casinoCfgFor(db, forA, B.id, now)).casino).toEqual(c0);
    // 次の日は元どおり
    expect(await checkBet(db, bcfg, A.id, 'blackjack', 3000, new Date('2026-10-07T15:00:01Z'))).toBe('bad_bet');
  });

  it('ルーレット: 1 か所の最高も上がる', async () => {
    await addCoins(db, A.id, 100_000, 'adjust');
    const stake = [{ on: 'red' as const, amount: 2000 }];
    expect((await playRoulette(db, bcfg, A.id, stake, () => 0, now)).status).toBe('bad_bet');
    await addTickets(db, A.id, 'casino_boost', 1);
    await useCasinoBoost(db, A.id, now);
    expect((await playRoulette(db, bcfg, A.id, stake, () => 0, now)).status).toBe('ok');
  });

  it('卓: 自分の賭けは上がる。みんなで払う参加費は元の上限のまま', async () => {
    const tcfg: GuildConfig = { ...bcfg, casino: { ...c0, dailyBetLimit: 0 } };
    await addCoins(db, A.id, 100_000, 'adjust');
    await addTickets(db, A.id, 'casino_boost', 1);
    await useCasinoBoost(db, A.id, now);
    // 大富豪の参加費は 1,000 まで（札が効いていても）
    expect((await createTable(db, tcfg, 'daifugo', A, { entry: '3000' }, now)).status).toBe('bad_bet');
    const t = await createTable(db, tcfg, 'baccarat_table', A, {}, now);
    const id = 'table' in t ? t.table.id : 0;
    expect((await actTable(db, tcfg, id, A.id, { action: 'bet', bet: '3000', on: 'player' }, now)).status).toBe('ok');
    // 勝ち負けはすぐ決まることがあるので、賭けた量で確かめる
    expect(await todayBets(db, A.id, now)).toBe(3000);
  });

  it('卓の 1 日の上限は人ごと', async () => {
    const lcfg: GuildConfig = { ...bcfg, casino: { ...c0, dailyBetLimit: 1000 } };
    for (const m of [A, B]) {
      await addCoins(db, m.id, 100_000, 'adjust');
      // 今日もう 500 賭けている
      await spendWithin(db, m.id, 500, 'casino_bet', { game: 'blackjack' });
    }
    await addTickets(db, A.id, 'casino_boost', 1);
    await useCasinoBoost(db, A.id, now);
    const t = await createTable(db, lcfg, 'baccarat_table', A, {}, now);
    const id = 'table' in t ? t.table.id : 0;
    // A は 1 日 5,000 まで
    expect((await actTable(db, lcfg, id, A.id, { action: 'bet', bet: '3000', on: 'player' }, now)).status).toBe('ok');
    // B は 1 日 1,000 まで（同じ卓にいても、A の札では上がらない）
    const t2 = await createTable(db, lcfg, 'baccarat_table', B, {}, now);
    const id2 = 'table' in t2 ? t2.table.id : 0;
    expect((await actTable(db, lcfg, id2, B.id, { action: 'bet', bet: '600', on: 'player' }, now)).status).toBe('limit');
    expect((await actTable(db, lcfg, id2, B.id, { action: 'bet', bet: '500', on: 'player' }, now)).status).toBe('ok');
  });

  it('授与所: 買うと持ち物に 1 枚入る（銭は払う）', async () => {
    await seedDefaultItems(db, { colors: [], titles: [] });
    const item = (await listItems(db)).find((i) => i.kind === 'casino_boost')!;
    expect(item).toMatchObject({ name: '大勝負の札', price: 1000, enabled: true });
    await addCoins(db, A.id, 1500, 'adjust');
    expect((await buySimple(db, item, A.id, {}, now)).status).toBe('ok');
    expect((await ticketsOf(db, A.id)).casino_boost).toBe(1);
    expect((await walletOf(db, A.id)).balance).toBe(500);
    expect((await buySimple(db, item, A.id, {}, now)).status).toBe('insufficient');
    expect((await ticketsOf(db, A.id)).casino_boost).toBe(1);
  });

  it('文: 使ったとき・授与所の説明・/残高', async () => {
    const until = new Date('2026-10-07T15:00:00Z');
    expect(casinoBoostText(c0, '銭', { status: 'ok', until })).toContain('1 回 **5,000** 枚まで・1 日の合計 **100,000** 枚まで');
    expect(casinoBoostText(c0, '銭', { status: 'active', until })).toContain('札は減っていません');
    expect(casinoBoostText(c0, '銭', { status: 'no_ticket' })).toBe('🎰 大勝負の札がありません。');
    expect(casinoBoostNote(c0)).toContain('1 回の最高 1,000 → **5,000** 枚・1 日の合計 20,000 → **100,000** 枚');
    await addTickets(db, A.id, 'casino_boost', 1);
    await useCasinoBoost(db, A.id, now);
    const buffs = await buffsOf(db, A.id, now);
    expect(buffs.casinoUntil).toEqual(until);
    const v = walletView(cfg.economy, { balance: 0, lifetimeEarned: 0, today: { vcCoins: 0, vcMinutes: 0 }, recent: [], tickets: emptyTickets(), custom: [], buffs });
    expect(v.embeds[0]!.description).toContain('🎰 大勝負の札');
  });
});

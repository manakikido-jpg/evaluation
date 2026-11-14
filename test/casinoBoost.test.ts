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
import { styleChances } from '../src/services/casino/styles.js';
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
    expect(await useCasinoBoost(db, A.id, now)).toEqual({ status: 'ok', until: midnight, level: 1 });
    expect(await useCasinoBoost(db, A.id, new Date(now.getTime() + 60_000))).toEqual({ status: 'active', until: midnight, level: 1 });
    expect((await ticketsOf(db, A.id)).casino_boost).toBe(1);
    expect(await casinoBoostUntil(db, A.id, now)).toEqual(midnight);
    // 0 時を過ぎたら切れる。次の日はまた使える
    const next = new Date('2026-10-07T15:00:01Z');
    expect(await casinoBoostUntil(db, A.id, next)).toBeUndefined();
    expect(await useCasinoBoost(db, A.id, next)).toEqual({ status: 'ok', until: new Date('2026-10-08T15:00:00Z'), level: 1 });
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

  it('ルーレット: 札が効いていても、合計の上限は「1 か所の最高 × 所の数」（ふつうの 1 回の最高 × 倍率で断らない）', async () => {
    await addCoins(db, A.id, 100_000, 'adjust');
    await addTickets(db, A.id, 'casino_boost', 1);
    await useCasinoBoost(db, A.id, now);
    // 札で 1 回の最高は 1,000 × 5 = 5,000。1 か所 1,000 を 7 か所 = 7,000（5,000 をこえる）
    const many = (['red', 'odd', 'low', 'dozen1', 'col1', 'n1', 'n3'] as const).map((on) => ({ on, amount: 1000 }));
    expect((await playRoulette(db, bcfg, A.id, many, () => 0, now)).status).toBe('ok');
    // 1 か所が最高（5,000）をこえるのは、今までどおり断る
    expect((await playRoulette(db, bcfg, A.id, [{ on: 'red' as const, amount: 5001 }], () => 0, now)).status).toBe('bad_bet');
    // 1 日の上限（20,000 × 5 = 100,000）は、今までどおり見る
    const tight: GuildConfig = { ...bcfg, casino: { ...c0, dailyBetLimit: 1000 } };
    expect((await playRoulette(db, tight, A.id, many, () => 0, now)).status).toBe('limit');
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

  it('卓のルーレット: 取り消して返した賭けは、1 日の上限に数えない（札が効いていても上限に届かない）', async () => {
    const rcfg: GuildConfig = { ...cfg, casino: { ...c0, games: [...cfg.casino.games, 'roulette_table'] as never, dailyBetLimit: 1000 } };
    await addCoins(db, A.id, 100_000, 'adjust');
    await addTickets(db, A.id, 'casino_boost', 1);
    await useCasinoBoost(db, A.id, now);
    const t = await createTable(db, rcfg, 'roulette_table', A, {}, now);
    const id = 'table' in t ? t.table.id : 0;
    // 札で 1 日 5,000 まで。3,000 置いて取り消すのを 3 回しても、上限に届かない
    for (let k = 0; k < 3; k++) {
      expect((await actTable(db, rcfg, id, A.id, { action: 'bet', bet: '3000', on: 'red' }, now)).status).toBe('ok');
      expect((await actTable(db, rcfg, id, A.id, { action: 'clear' }, now)).status).toBe('ok');
    }
    expect(await todayBets(db, A.id, now)).toBe(0);
    expect((await actTable(db, rcfg, id, A.id, { action: 'bet', bet: '3000', on: 'red' }, now)).status).toBe('ok');
    expect(await todayBets(db, A.id, now)).toBe(3000);
    // 本当に賭けた分は数える（あと 2,000 まで）
    expect((await actTable(db, rcfg, id, A.id, { action: 'bet', bet: '2001', on: 'black' }, now)).status).toBe('limit');
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
    expect(casinoBoostText(c0, '銭', { status: 'ok', until, level: 1 })).toContain('1 回 **5,000** 枚まで・1 日の合計 **100,000** 枚まで');
    expect(casinoBoostText(c0, '銭', { status: 'active', until, level: 1 })).toContain('札は減っていません');
    expect(casinoBoostText(c0, '銭', { status: 'no_ticket' })).toBe('🎰 大勝負の札がありません。');
    expect(casinoBoostNote(c0)).toContain('1 回の最高 1,000 → **5,000** 枚・1 日の合計 20,000 → **100,000** 枚');
    await addTickets(db, A.id, 'casino_boost', 1);
    await useCasinoBoost(db, A.id, now);
    const buffs = await buffsOf(db, A.id, now);
    expect(buffs.casinoUntil).toEqual(until);
    const v = walletView(cfg.economy, { balance: 0, lifetimeEarned: 0, today: { vcCoins: 0, vcMinutes: 0 }, recent: [], tickets: emptyTickets(), custom: [], buffs });
    expect(v.embeds[0]!.fields.find(f => f.name === '✨ 効いている効果')!.value).toContain('🎰 大勝負の札');
  });
});

describe('🎰 大勝負の札の設定', () => {
  it('上限ごとに別の倍率（0 は全体の倍率・1 は上げない）と、重ねた枚数', () => {
    const c = { ...c0, rouletteMaxBet: 300, boostMaxBetMult: 3, boostRouletteMult: 1, boostDailyMult: 0 };
    expect(boostCasino(c)).toMatchObject({ maxBet: 3000, rouletteMaxBet: 300, dailyBetLimit: 100000 });
    expect(boostCasino(c, 2)).toMatchObject({ maxBet: 6000, rouletteMaxBet: 300, dailyBetLimit: 200000 });
  });

  it('効く長さを時間で・1 日 1 枚だけ（設定で 2 枚にしていても重ねない）・切れたあとも今日は使えない', async () => {
    await addTickets(db, A.id, 'casino_boost', 5);
    const opts = { boostHours: 2, boostPerDay: 2 };
    const end = new Date(now.getTime() + 2 * 3_600_000);
    expect(await useCasinoBoost(db, A.id, now, opts)).toEqual({ status: 'ok', until: end, level: 1 });
    expect(await useCasinoBoost(db, A.id, new Date(now.getTime() + 60_000), opts)).toEqual({ status: 'active', until: end, level: 1 });
    expect((await casinoCfgFor(db, bcfg, A.id, new Date(now.getTime() + 180_000))).casino.maxBet).toBe(5000);
    // 切れたあとも、今日（日本時間）はもう使えない
    expect(await useCasinoBoost(db, A.id, new Date(end.getTime() + 1000), opts)).toEqual({ status: 'limit' });
    expect((await ticketsOf(db, A.id)).casino_boost).toBe(4);
    expect(casinoBoostText(c0, '銭', { status: 'limit' })).toContain('今日はもう大勝負の札を 1 枚使いました');
  });

  it('🎰 大勝負の札（極）: 極の倍率で上がる・ふつうの札とあわせて 1 日 1 枚・授与所と勝負の御籤から手に入る', async () => {
    const c = { ...c0, boostExMult: 20 };
    const g = { ...cfg, casino: c } as GuildConfig;
    expect(boostCasino(c, 1, true).maxBet).toBe(20000);
    await addTickets(db, A.id, 'casino_boost_ex', 1);
    await addTickets(db, A.id, 'casino_boost', 1);
    const r = await useCasinoBoost(db, A.id, now, {}, true);
    expect(r).toMatchObject({ status: 'ok', ex: true });
    expect(casinoBoostText(c, '銭', r, true)).toContain('大勝負の札（極）を使いました');
    expect(casinoBoostText(c, '銭', r, true)).toContain('1 回 **20,000** 枚まで');
    expect((await casinoCfgFor(db, g, A.id, now)).casino.maxBet).toBe(20000);
    expect((await useCasinoBoost(db, A.id, now)).status).toBe('active');
    expect((await ticketsOf(db, A.id)).casino_boost).toBe(1);
    expect((await ticketsOf(db, A.id)).casino_boost_ex).toBe(0);
    expect(await useCasinoBoost(db, A.id, now, {}, true)).toMatchObject({ status: 'active', ex: true });
    // 授与所
    await seedDefaultItems(db, { colors: [], titles: [] });
    const item = (await listItems(db)).find((i) => i.kind === 'casino_boost_ex')!;
    expect(item).toMatchObject({ name: '大勝負の札（極）', enabled: true });
    await addCoins(db, A.id, item.price, 'adjust');
    expect((await buySimple(db, item, A.id, {}, now)).status).toBe('ok');
    expect((await ticketsOf(db, A.id)).casino_boost_ex).toBe(1);
    // 勝負の御籤: 割合を決めると出る（はじめは 0）
    expect(styleChances({ ...cfg.casinoGacha }, []).find((i) => i.key === 'boost_ex')!.chance).toBe(0);
    expect(styleChances({ ...cfg.casinoGacha, boostExPercent: 5 }, []).find((i) => i.key === 'boost_ex')!.chance).toBe(5);
  });

  it('🎰 ふつうの札のあとに極の札: 極に上書きして元の上限の 20 倍（終わる時はそのまま）。極のあとはもう使えない', async () => {
    const c = { ...c0 };
    expect(boostCasino(c, 1, true).maxBet).toBe(20000);
    await addTickets(db, A.id, 'casino_boost', 1);
    await addTickets(db, A.id, 'casino_boost_ex', 2);
    const first = await useCasinoBoost(db, A.id, now);
    expect(first).toMatchObject({ status: 'ok', level: 1 });
    const up = await useCasinoBoost(db, A.id, now, {}, true);
    expect(up).toMatchObject({ status: 'ok', ex: true, upgraded: true, until: (first as { until: Date }).until });
    expect(casinoBoostText(c, '銭', up, true)).toContain('極に上書き');
    expect((await casinoCfgFor(db, { ...cfg, casino: c } as GuildConfig, A.id, now)).casino.maxBet).toBe(20000);
    expect(await useCasinoBoost(db, A.id, now, {}, true)).toMatchObject({ status: 'active', ex: true });
    expect((await ticketsOf(db, A.id)).casino_boost_ex).toBe(1);
  });
});

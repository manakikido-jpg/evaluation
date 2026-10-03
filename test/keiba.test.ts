import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GuildConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { keibaHorses } from '../src/db/schema.js';
import type { Rng } from '../src/services/casino/cards.js';
import {
  addToPool,
  estimate,
  finalOdds,
  KB_HORSES,
  KB_SEED,
  KB_TAKE,
  liveOdds,
  makeRace,
  poolTotal,
  seeded as seededFloat,
  seedPools,
  simulate,
  startOf,
  ticketOdds,
  classOf,
  prizesOf,
  appearanceOf,
  newStable,
  type KbStable,
} from '../src/services/casino/keiba.js';
import {
  addHorse,
  applyKeibaResults,
  breedFoal,
  buyFromOwner,
  buyHorse,
  horsesForSale,
  leadingOwners,
  listHorses,
  loadRoster,
  myHorses,
  nameOwnHorse,
  ownerSilk,
  renameHorse,
  restHorse,
  retireOwnHorse,
  retireToBreed,
  setOwnerSilk,
  setRetired,
  setSale,
  trainHorse,
  KB_ROSTER_MIN,
} from '../src/services/casino/keibaStable.js';
import { keibaTick, winMessage } from '../src/services/casino/keibaNotify.js';
import { boxKeys, keiba, ticketKey, type KbState } from '../src/services/casino/tables/keiba.js';
import { actTable, createTable, joinTable, leaveTable, pollTable, tableById } from '../src/services/casino/tables/service.js';
import type { Ctx } from '../src/services/casino/tables/types.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { cfg, makeDb } from './helpers.js';

const rngOf = (seed: number): Rng => {
  let x = seed;
  return (n) => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return Math.floor((x / 2147483648) * n);
  };
};
const tcfg: GuildConfig = { ...cfg, casino: { ...cfg.casino, dailyBetLimit: 0 } };
const A = { id: '760000000000000001', name: 'さくら' };
const B = { id: '760000000000000002', name: 'もみじ' };
const ctx = (now: number, seed = 1): Ctx => ({ now, rng: rngOf(seed), cfg: tcfg });

describe('🏇 レースとオッズ', () => {
  it('8 頭のレース。同じ種なら同じ結果。ラップ・通過順・実況のもと', () => {
    const { race, horses } = makeRace(rngOf(3), 1, { dist: 1600 });
    expect(horses).toHaveLength(KB_HORSES);
    expect(new Set(horses.map((h) => h.name)).size).toBe(KB_HORSES);
    const a = simulate(race, horses, seededFloat(7), true);
    const b = simulate(race, horses, seededFloat(7), true);
    expect(a.order).toEqual(b.order);
    expect([...a.order].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(a.laps).toHaveLength(1600 / 200);
    // ラップを足すと勝ち時計
    expect(a.laps!.reduce((x, y) => x + y, 0)).toBeCloseTo(Math.min(...a.times), 0);
    expect(a.frames!.every((f) => f.length === a.frames![0]!.length)).toBe(true);
    expect(a.lanes!.length).toBe(KB_HORSES);
    expect(a.corners![0]!.length).toBeGreaterThan(0);
    // 1600m は 2 コーナーの奥から（1 周 2000m のゴールから 400m 先）
    expect(startOf(1600)).toBe(400);
    expect(startOf(2400)).toBe(1600);
  });

  it('見込みは強い馬ほど高い。BOT のお客さんの賭けは見込みの割合', () => {
    const { race, horses } = makeRace(rngOf(5), 1, { dist: 2000 });
    const est = estimate(race, horses, 11, 300);
    expect(est.p.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 5);
    expect(est.p3.reduce((x, y) => x + y, 0)).toBeCloseTo(3, 5);
    const pools = seedPools(est);
    expect(Math.abs(poolTotal(pools, 'win') - KB_SEED)).toBeLessThan(KB_HORSES);
    const fav = est.p.indexOf(Math.max(...est.p)) + 1;
    const long = est.p.indexOf(Math.min(...est.p)) + 1;
    expect(liveOdds(pools, 'win', String(fav)).lo).toBeLessThan(liveOdds(pools, 'win', String(long)).lo);
  });

  it('みんなが賭けるとオッズが動く。払い戻しは胴元の取り分を引いた分', () => {
    const pools = { win: [100, 100, 100, 100, 100, 100, 100, 100], place: Array(8).fill(100), quinella: { '1-2': 50, '1-3': 50 }, wide: { '1-2': 50, '1-3': 50, '2-3': 50 } };
    const before = liveOdds(pools, 'win', '1').lo;
    addToPool(pools, 'win', '1', 800);
    expect(liveOdds(pools, 'win', '1').lo).toBeLessThan(before);
    const f = finalOdds(pools, [1, 2, 3, 4, 5, 6, 7, 8]);
    // 単勝: (1600 × 0.9) / 900 = 1.6 倍
    expect(f.win).toEqual([1, Math.floor(((1600 * (1 - KB_TAKE)) / 900) * 10)]);
    expect(ticketOdds(f, 'win', '1')).toBe(16);
    expect(ticketOdds(f, 'win', '2')).toBe(0);
    expect(f.place.map(([no]) => no)).toEqual([1, 2, 3]);
    expect(ticketOdds(f, 'quinella', '1-2')).toBeGreaterThan(10);
    expect(ticketOdds(f, 'wide', '2-3')).toBeGreaterThanOrEqual(10);
    expect(ticketOdds(f, 'wide', '4-5')).toBe(0);
    // 当たりの賭けがとても多くても 1.0 倍（元返し）より下にはならない
    addToPool(pools, 'win', '1', 100000);
    expect(finalOdds(pools, [1, 2, 3, 4, 5, 6, 7, 8]).win[1]).toBe(10);
  });

  it('まとめて買う: 単勝は 1 頭ずつ、馬連・ワイドは選んだ馬の組み合わせ全部（ボックス）', () => {
    expect(boxKeys('win', [3, 5, 3])).toEqual(['3', '5']);
    expect(boxKeys('quinella', [1, 4, 2])).toEqual(['1-4', '1-2', '2-4']);
    expect(boxKeys('wide', [2])).toEqual([undefined]);
    expect(boxKeys('place', [9])).toEqual([undefined]);
    const t0 = new Date('2026-10-02T12:00:00Z').getTime();
    let s = (keiba.create(A, {}, ctx(t0)) as { state: KbState }).state;
    const r = keiba.act(s, A.id, { action: 'bets', type: 'wide', h: ['1', '2', '3'], bet: '100' }, ctx(t0));
    expect(r.ok && r.fx?.debits).toEqual([{ memberId: A.id, amount: 300, reason: 'casino_bet', limited: true }]);
    s = (r as { state: KbState }).state;
    expect(s.tickets.map((x) => x.key)).toEqual(['1-2', '1-3', '2-3']);
    // 20 枚まで（8 頭のボックスは 28 点）
    expect(keiba.act(s, A.id, { action: 'bets', type: 'quinella', h: ['1', '2', '3', '4', '5', '6', '7', '8'], bet: '10' }, ctx(t0))).toEqual({ ok: false, error: 'too_many' });
    expect(keiba.act(s, A.id, { action: 'bets', type: 'quinella', h: ['1'], bet: '10' }, ctx(t0))).toEqual({ ok: false, error: 'invalid' });
  });

  it('馬券の書き方', () => {
    expect(ticketKey('win', 3, 0)).toBe('3');
    expect(ticketKey('quinella', 5, 2)).toBe('2-5');
    expect(ticketKey('wide', 2, 2)).toBeUndefined();
    expect(ticketKey('place', 9, 0)).toBeUndefined();
  });
});

describe('🏇 クラスと重賞・賞金', () => {
  const horse = (id: number, starts: number, wins: number, ownerId: string | null = null): KbStable => ({ ...newStable(seededFloat(id)), id, name: `H${id}`, starts, wins, ownerId });

  it('クラス: 新馬 → 未勝利 → 1〜3 勝 → オープン。そのクラスの馬から選ぶ。座っている馬主の馬を先に', () => {
    expect([classOf({ starts: 0, wins: 0 }), classOf({ starts: 3, wins: 0 }), classOf({ starts: 3, wins: 1 }), classOf({ starts: 9, wins: 3 }), classOf({ starts: 20, wins: 7 })]).toEqual([0, 1, 2, 4, 5]);
    const roster = [
      ...Array.from({ length: 10 }, (_, i) => horse(i + 1, 5, 0)),
      ...Array.from({ length: 10 }, (_, i) => horse(i + 11, 12, 5)),
      horse(99, 4, 5, A.id),
    ];
    const g1 = makeRace(rngOf(4), 1, { cls: 8, name: '咲楽ノ宮ダービー' }, roster);
    expect(g1.race.name).toBe('咲楽ノ宮ダービー（G1）');
    expect(g1.horses.every((h) => h.cls === 5)).toBe(true);
    const maiden = makeRace(rngOf(4), 1, { cls: 1 }, roster);
    expect(maiden.race.name).toBe('未勝利');
    expect(maiden.horses.every((h) => h.wins === 0)).toBe(true);
    // 馬主が座っていれば、その馬が出る
    for (let seed = 1; seed < 6; seed++) expect(makeRace(rngOf(seed), 1, { cls: 6, priority: new Set([A.id]) }, roster).horses.some((h) => h.id === 99)).toBe(true);
  });

  it('賞金: メンバーが賭けた合計の数 %（重賞ほど多い）を 1〜5 着で 50・20・13・10・7。馬主の馬には出走手当も', () => {
    expect(prizesOf(0, 10000)).toEqual([150, 60, 39, 30, 21]);
    expect(prizesOf(8, 10000)).toEqual([400, 160, 104, 80, 56]);
    // 賞金と出走手当（8 頭）を合わせても、胴元の取り分 10% を超えない
    expect(Math.max(...[0, 1, 2, 3, 4, 5, 6, 7, 8].map((c) => prizesOf(c, 100000).reduce((a, b) => a + b, 0) + 8 * appearanceOf(100000)))).toBeLessThanOrEqual(10000);
    expect(prizesOf(5, 0)).toEqual([0, 0, 0, 0, 0]);
    // ゴールで馬主に払う
    const t0 = new Date('2026-10-02T12:00:00Z').getTime();
    const roster = Array.from({ length: 8 }, (_, i) => horse(i + 1, 0, 0, i === 0 ? B.id : null));
    let s = (keiba.create(A, { cls: '0' }, { ...ctx(t0), roster }) as { state: KbState }).state;
    s = (keiba.act(s, A.id, { action: 'bets', type: 'win', h: ['1', '2', '3', '4', '5', '6', '7', '8'], bet: '1000' }, ctx(t0)) as { state: KbState }).state;
    s = (keiba.act(s, A.id, { action: 'start' }, ctx(t0, 5)) as { state: KbState }).state;
    const fin = keiba.tick(s, ctx(s.deadline));
    if (!fin || !fin.ok) throw new Error('no finish');
    const pos = fin.state.run!.order.indexOf(fin.state.horses.find((h) => h.ownerId === B.id)!.no);
    const prize = (pos < 5 ? prizesOf(0, 8000)[pos]! : 0) + appearanceOf(8000);
    expect(fin.fx?.credits?.filter((c) => c.reason === 'keiba_prize')).toEqual(prize ? [{ memberId: B.id, amount: prize, reason: 'keiba_prize' }] : []);
    expect(fin.fx?.keiba?.find((r) => r.horseId === 1)?.prize).toBe(prize);
  });
});

describe('🏇 卓（受付 → 発走 → 結果 → 次のレース）', () => {
  const t0 = new Date('2026-10-02T12:00:00Z').getTime();

  it('受付中に賭ける・取り消す。開いた人は締め切って発走。ゴールで払う', () => {
    const c = keiba.create(A, { window: '1', title: '  咲楽ノ宮ダービー  ', dist: '1200' }, ctx(t0));
    if (!c.ok) throw new Error(c.error);
    let s = c.state;
    expect(s.race.name).toBe('咲楽ノ宮ダービー');
    expect(s.race.dist).toBe(1200);
    expect(s.deadline).toBe(t0 + 60_000);
    s = (keiba.join(s, B, {}, ctx(t0)) as { state: KbState }).state;
    const bet = keiba.act(s, A.id, { action: 'bet', type: 'win', a: '3', bet: '100' }, ctx(t0));
    expect(bet.ok && bet.fx?.debits).toEqual([{ memberId: A.id, amount: 100, reason: 'casino_bet', limited: true }]);
    s = (bet as { state: KbState }).state;
    const w = s.pools.win[2]!;
    s = (keiba.act(s, A.id, { action: 'bet', type: 'win', a: '3', bet: '50' }, ctx(t0)) as { state: KbState }).state;
    expect(s.tickets).toEqual([{ memberId: A.id, name: 'さくら', t: 'win', key: '3', amount: 150 }]);
    expect(s.pools.win[2]).toBe(w + 50);
    expect(keiba.act(s, A.id, { action: 'bet', type: 'win', a: '3', bet: '0' }, ctx(t0))).toEqual({ ok: false, error: 'bad_bet' });
    s = (keiba.act(s, B.id, { action: 'bet', type: 'quinella', a: '1', b: '2', bet: '100' }, ctx(t0)) as { state: KbState }).state;
    const cancel = keiba.act(s, B.id, { action: 'cancel' }, ctx(t0));
    expect(cancel.ok && cancel.fx?.credits).toEqual([{ memberId: B.id, amount: 100, reason: 'casino_refund' }]);
    s = (cancel as { state: KbState }).state;
    expect(s.real).toBe(150);
    // 開いた人だけ発走できる
    expect(keiba.act(s, B.id, { action: 'start' }, ctx(t0))).toEqual({ ok: false, error: 'host_only' });
    const go = keiba.act(s, A.id, { action: 'start' }, ctx(t0, 9));
    if (!go.ok) throw new Error(go.error);
    s = go.state;
    expect(s.phase).toBe('racing');
    expect(s.run!.calls.length).toBeGreaterThanOrEqual(5);
    expect(keiba.act(s, A.id, { action: 'bet', type: 'win', a: '1', bet: '100' }, ctx(t0))).toEqual({ ok: false, error: 'started' });
    // ゴール: 払い戻しと収支
    const fin = keiba.tick(s, ctx(s.deadline));
    if (!fin || !fin.ok) throw new Error('no finish');
    s = fin.state;
    expect(s.phase).toBe('result');
    const won = s.final!.win[0] === 3;
    expect(fin.fx?.records).toEqual([{ memberId: A.id, game: 'keiba', bet: 150, payout: won ? Math.floor((150 * s.final!.win[1]) / 10) : 0 }]);
    expect(s.history[0]!.order).toEqual(s.run!.order.slice(0, 3));
    // 次のレースの受付（馬が入れ替わる）
    const next = keiba.tick(s, ctx(s.deadline, 4));
    if (!next || !next.ok) throw new Error('no next');
    expect(next.state.phase).toBe('betting');
    expect(next.state.race.n).toBe(2);
    expect(next.state.tickets).toEqual([]);
  });

  it('受付中に立つと賭けは戻る。だれもいなくなったら閉じる', () => {
    let s = (keiba.create(A, {}, ctx(t0)) as { state: KbState }).state;
    s = (keiba.act(s, A.id, { action: 'bet', type: 'place', a: '2', bet: '30' }, ctx(t0)) as { state: KbState }).state;
    const out = keiba.leave(s, A.id, ctx(t0));
    expect(out.ok && out.fx?.credits).toEqual([{ memberId: A.id, amount: 30, reason: 'casino_refund' }]);
    expect(keiba.closed((out as { state: KbState }).state, t0)).toBe(true);
  });
});

describe('🏇 名簿と卓のサービス', () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await makeDb());
    await addCoins(db, A.id, 5000, 'admin_grant');
    await addCoins(db, B.id, 5000, 'admin_grant');
  });
  afterEach(async () => {
    await close();
  });

  it('名前を決めて入れる・変える・引退。足りなければ BOT が足す', async () => {
    const h = await addHorse(db, 'サクラノヒメ');
    expect(h?.name).toBe('サクラノヒメ');
    expect(await addHorse(db, 'サクラノヒメ')).toBeUndefined();
    expect(await addHorse(db, '  ')).toBeUndefined();
    expect(await renameHorse(db, h!.id, 'ハナノヒメ')).toBe('ok');
    expect(await renameHorse(db, h!.id, 'あ'.repeat(19))).toBe('invalid');
    const roster = await loadRoster(db);
    expect(roster).toHaveLength(KB_ROSTER_MIN);
    expect(roster.some((x) => x.name === 'ハナノヒメ')).toBe(true);
    expect(await setRetired(db, h!.id, true)).toBe(true);
    expect((await loadRoster(db)).some((x) => x.id === h!.id)).toBe(false);
    expect(await renameHorse(db, roster[1]!.id, 'ハナノヒメ')).toBe('ok');
    // 同じ名前の馬が走っているあいだは戻せない
    expect(await setRetired(db, h!.id, false)).toBe(false);
    expect((await listHorses(db)).at(-1)!.id).toBe(h!.id);
  });

  it('🐴 馬主: 買う（銭は胴元へ）・デビュー前は名前を変えられる・持てる頭数・引退', async () => {
    expect(await buyHorse(db, A.id, 'サクラノヒメ', 3000, 2)).toMatchObject({ status: 'ok', horse: { name: 'サクラノヒメ', ownerId: A.id, starts: 0 } });
    expect((await walletOf(db, A.id)).balance).toBe(2000);
    expect((await buyHorse(db, B.id, 'サクラノヒメ', 3000, 2)).status).toBe('taken');
    expect((await buyHorse(db, A.id, '', 3000, 2)).status).toBe('invalid');
    expect((await buyHorse(db, A.id, 'ハナノヒメ', 3000, 2)).status).toBe('poor');
    expect((await buyHorse(db, A.id, 'ハナノヒメ', 3000, 0)).status).toBe('off');
    const [mine] = await myHorses(db, A.id);
    expect(await nameOwnHorse(db, A.id, mine!.id, 'ハナノヒメ')).toBe('ok');
    expect(await nameOwnHorse(db, B.id, mine!.id, 'ちがう人')).toBe('not_found');
    await db.update(keibaHorses).set({ starts: 1 });
    expect(await nameOwnHorse(db, A.id, mine!.id, 'もういちど')).toBe('debuted');
    // 持てるのは 1 頭まで → 引退させるとまた買える
    await addCoins(db, A.id, 3000, 'admin_grant');
    expect((await buyHorse(db, A.id, 'ツキノヒメ', 3000, 1)).status).toBe('too_many');
    expect(await retireOwnHorse(db, A.id, mine!.id)).toBe(true);
    expect((await buyHorse(db, A.id, 'ツキノヒメ', 3000, 1)).status).toBe('ok');
    // 名簿に馬主の名前が入る
    expect((await loadRoster(db)).find((h) => h.name === 'ツキノヒメ')?.ownerId).toBe(A.id);
  });

  it('🐴 馬主のうれしいこと: 勝負服・調教・放牧・売り買い・繁殖と産駒', async () => {
    const t0 = new Date('2026-10-03T03:00:00Z');
    await addCoins(db, A.id, 20000, 'admin_grant');
    const bought = await buyHorse(db, A.id, 'サクラノヒメ', 3000, 3);
    if (bought.status !== 'ok') throw new Error(bought.status);
    const id = bought.horse.id;
    // 勝負服: 持っている馬もこれから買う馬もその服
    await setOwnerSilk(db, A.id, { base: '#1e63d6', accent: '#ffffff', pattern: 2 });
    expect(await ownerSilk(db, A.id)).toEqual({ base: '#1e63d6', accent: '#ffffff', pattern: 2 });
    expect((await myHorses(db, A.id))[0]!.silk).toEqual({ base: '#1e63d6', accent: '#ffffff', pattern: 2 });
    // 調教: 調子 +1・速さが少し伸びる・6 時間に 1 回
    const spd0 = (await myHorses(db, A.id))[0]!.spd;
    expect(await trainHorse(db, A.id, id, 300, t0)).toBe('ok');
    expect(await trainHorse(db, A.id, id, 300, new Date(t0.getTime() + 3_600_000))).toBe('cooldown');
    expect(await trainHorse(db, B.id, id, 300, t0)).toBe('not_found');
    const trained = (await myHorses(db, A.id))[0]!;
    expect(trained).toMatchObject({ trainBoost: 1, fatigue: 15 });
    expect(trained.spd).toBe(spd0 + 2);
    // 走ると疲れがたまり、調教の上乗せは使い切る。疲れすぎると名簿に出ない
    await applyKeibaResults(db, [{ horseId: id, pos: 1, race: '新馬', dist: 1600, surface: 0, prize: 120, ownerId: A.id, name: 'サクラノヒメ', cls: 0 }], t0);
    await applyKeibaResults(db, [{ horseId: id, pos: 2, race: '未勝利', dist: 1600, surface: 0, prize: 50, ownerId: A.id, name: 'サクラノヒメ', cls: 1 }], t0);
    await applyKeibaResults(db, [{ horseId: id, pos: 9, race: '1勝クラス', dist: 1600, surface: 0, prize: 5, ownerId: A.id, name: 'サクラノヒメ', cls: 2 }], t0);
    expect((await myHorses(db, A.id))[0]).toMatchObject({ fatigue: 90, trainBoost: 0, wins: 1, prize: 175 });
    expect((await loadRoster(db, t0)).some((h) => h.id === id)).toBe(false);
    expect((await loadRoster(db, new Date(t0.getTime() + 3 * 3_600_000))).some((h) => h.id === id)).toBe(true);
    // 放牧: 1 時間出ない・疲れが抜ける
    expect(await restHorse(db, A.id, id, t0)).toBe(true);
    expect((await myHorses(db, A.id))[0]!.fatigue).toBe(0);
    expect((await loadRoster(db, new Date(t0.getTime() + 30 * 60_000))).some((h) => h.id === id)).toBe(false);
    // リーディングオーナー
    expect(await leadingOwners(db, new Date(t0.getTime() - 1000))).toMatchObject([{ ownerId: A.id, prize: 175, wins: 1, runs: 3 }]);
    // 売り買い: 手数料 5% を引いて売った人へ。買った人の勝負服になる
    expect(await setSale(db, A.id, id, 50)).toBe(false);
    expect(await setSale(db, A.id, id, 5000)).toBe(true);
    expect((await horsesForSale(db)).map((h) => h.id)).toEqual([id]);
    expect(await buyFromOwner(db, A.id, id, 3)).toBe('self');
    const before = (await walletOf(db, A.id)).balance;
    expect(await buyFromOwner(db, B.id, id, 3)).toBe('ok');
    expect((await walletOf(db, B.id)).balance).toBe(0);
    expect((await walletOf(db, A.id)).balance).toBe(before + 4750);
    expect((await myHorses(db, B.id))[0]).toMatchObject({ id, salePrice: null });
    // 繁殖入り（1 勝以上）→ 産駒を半額で 3 頭まで
    await addCoins(db, B.id, 10000, 'admin_grant');
    const other = await buyHorse(db, B.id, 'ツキノヒメ', 1000, 3);
    if (other.status !== 'ok') throw new Error(other.status);
    expect(await retireToBreed(db, B.id, other.horse.id)).toBe('no_wins');
    expect(await retireToBreed(db, B.id, id)).toBe('ok');
    const foal = await breedFoal(db, B.id, id, 'サクラノコ', 1500, 3);
    expect(foal).toMatchObject({ status: 'ok', horse: { name: 'サクラノコ', parentId: id, ownerId: B.id, age: 2 } });
    expect((await loadRoster(db, new Date(t0.getTime() + 10 * 3_600_000))).find((h) => h.name === 'サクラノコ')?.sire).toBe('サクラノヒメ');
    expect((await breedFoal(db, A.id, id, 'ちがう人の', 1500, 3)).status).toBe('not_found');
  });

  it('🏆 馬主の馬が勝ったら Discord でお祝い。馬主ロール・G1 馬主ロール', async () => {
    const tcfg2: GuildConfig = { ...tcfg, casino: { ...tcfg.casino, keibaAnnounceChannelId: '760000000000000900', keibaOwnerRoleId: '760000000000000901', keibaG1RoleId: '760000000000000902' } };
    const { recordJoin } = await import('../src/services/members.js');
    await recordJoin(db, { id: A.id, username: 'a', displayName: 'さくら', avatarUrl: null, roleIds: [], isBot: false, joinedAt: null });
    await recordJoin(db, { id: B.id, username: 'b', displayName: 'もみじ', avatarUrl: null, roleIds: ['760000000000000901'], isBot: false, joinedAt: null });
    const h = await buyHorse(db, A.id, 'サクラノヒメ', 1000, 3);
    if (h.status !== 'ok') throw new Error(h.status);
    await applyKeibaResults(db, [{ horseId: h.horse.id, pos: 1, race: '咲楽ノ宮ダービー（G1）', dist: 2400, surface: 0, prize: 800, ownerId: A.id, name: 'サクラノヒメ', cls: 8 }]);
    const log: string[] = [];
    const discord = {
      sendMessage: async (ch: string, b: { content?: string }) => {
        log.push(`send ${ch} ${b.content}`);
        return { id: '1' };
      },
      addRole: async (_g: string, u: string, r: string) => void log.push(`add ${u} ${r}`),
      removeRole: async (_g: string, u: string, r: string) => void log.push(`remove ${u} ${r}`),
    };
    await keibaTick({ db, cfg: tcfg2, discord });
    expect(log[0]).toContain('🏆 **咲楽ノ宮ダービー（G1）** を **サクラノヒメ** が制しました！');
    expect(log[0]).toContain(`<@${A.id}>`);
    expect(log).toContain(`add ${A.id} 760000000000000901`);
    expect(log).toContain(`add ${A.id} 760000000000000902`);
    // B は馬を持っていないので外す
    expect(log).toContain(`remove ${B.id} 760000000000000901`);
    // 2 回目は流さない
    log.length = 0;
    await keibaTick({ db, cfg: tcfg2, discord });
    expect(log.some((l) => l.startsWith('send'))).toBe(false);
    expect(winMessage({ race: '1勝クラス', horseName: 'X', ownerId: A.id, prize: 0, cls: 2 }, '銭')).toContain('1勝クラス「1勝クラス」で **X** が勝ちました！');
  });

  it('レースを開くと名簿から 8 頭。ゴールで払い、馬の成績がたまる', async () => {
    const now = new Date('2026-10-02T12:00:00Z');
    const c = await createTable(db, tcfg, 'keiba', A, { window: '1', dist: '1200' }, now, rngOf(2));
    if (c.status !== 'ok' || !('table' in c)) throw new Error(c.status);
    const id = c.table.id;
    const s0 = c.table.state as KbState;
    const ids = new Set((await listHorses(db)).map((h) => h.id));
    expect(s0.horses.every((h) => ids.has(h.id))).toBe(true);
    expect((await joinTable(db, tcfg, id, B, {}, now)).status).toBe('ok');
    expect((await actTable(db, tcfg, id, A.id, { action: 'bet', type: 'win', a: '1', bet: '200' }, now)).status).toBe('ok');
    expect((await actTable(db, tcfg, id, B.id, { action: 'bet', type: 'wide', a: '1', b: '2', bet: '100' }, now)).status).toBe('ok');
    expect((await walletOf(db, A.id)).balance).toBe(4800);
    // 締め切り → 発走 → ゴール
    const racing = await pollTable(db, tcfg, id, new Date(now.getTime() + 61_000), rngOf(3));
    const r = racing!.state as KbState;
    expect(r.phase).toBe('racing');
    const done = await pollTable(db, tcfg, id, new Date(r.deadline + 10));
    const d = done!.state as KbState;
    expect(d.phase).toBe('result');
    const paidA = d.tickets.filter((t) => t.memberId === A.id).reduce((n, t) => n + (t.payout ?? 0), 0);
    expect((await walletOf(db, A.id)).balance).toBe(4800 + paidA);
    const rows = await db.select().from(keibaHorses);
    const ran = rows.filter((h) => h.starts === 1);
    expect(ran).toHaveLength(8);
    const winner = ran.find((h) => h.id === d.horses[d.run!.order[0]! - 1]!.id)!;
    expect(winner.wins).toBe(1);
    expect(winner.recent[0]).toMatchObject({ pos: 1, dist: 1200 });
    // 発走のあとに立っても、払い戻しはそのまま（受付中なら戻る）
    expect((await leaveTable(db, tcfg, id, B.id, new Date(r.deadline + 20))).status).toBe('ok');
    expect((await tableById(db, id))?.status).toBe('open');
  });
});

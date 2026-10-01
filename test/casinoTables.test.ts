import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GuildConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import type { Rng } from '../src/services/casino/cards.js';
import { baccaratTable, bjTable, BET_SECONDS, rouletteTable, type BjTableState } from '../src/services/casino/tables/dealer.js';
import { babanuki, daifugo, dBeats, dropPairs, dSet, JOKER, type BabaState, type DaifugoState } from '../src/services/casino/tables/party.js';
import { poker, settlePots, type PokerState, type PSeat } from '../src/services/casino/tables/poker.js';
import { bestHand, handName, score5 } from '../src/services/casino/tables/pokerHands.js';
import { actTable, createTable, joinTable, leaveTable, myTable, pollTable, tableById } from '../src/services/casino/tables/service.js';
import type { Ctx, Effects, Step, TableEngine } from '../src/services/casino/tables/types.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { cfg, makeDb } from './helpers.js';

const seeded = (seed: number): Rng => {
  let x = seed;
  return (n) => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return Math.floor((x / 2147483648) * n);
  };
};
/** カード（数字 r: 1 = A … 13 = K、マーク s） */
const C = (r: number, s = 0) => s * 13 + r - 1;
const tcfg: GuildConfig = { ...cfg, casino: { ...cfg.casino, dailyBetLimit: 0 } };
const P = (n: number) => ({ id: `75000000000000000${n}`, name: `p${n}` });

describe('♠ ポーカーの役', () => {
  it('役の強さの順', () => {
    const sf = score5([C(9), C(10), C(11), C(12), C(13)]);
    const quads = score5([C(9), C(9, 1), C(9, 2), C(9, 3), C(2)]);
    const full = score5([C(9), C(9, 1), C(9, 2), C(2), C(2, 1)]);
    const flush = score5([C(2), C(5), C(7), C(9), C(12)]);
    const straight = score5([C(5), C(6, 1), C(7), C(8), C(9)]);
    const wheel = score5([C(1), C(2, 1), C(3), C(4), C(5)]);
    const trips = score5([C(9), C(9, 1), C(9, 2), C(3), C(2)]);
    const two = score5([C(9), C(9, 1), C(3, 2), C(3), C(2)]);
    const one = score5([C(9), C(9, 1), C(4, 2), C(3), C(2)]);
    const high = score5([C(1), C(9, 1), C(4, 2), C(3), C(2)]);
    expect([sf, quads, full, flush, straight, trips, two, one, high].every((v, i, a) => i === 0 || a[i - 1]! > v)).toBe(true);
    expect(straight).toBeGreaterThan(wheel);
    expect(wheel).toBeGreaterThan(trips);
    expect(handName(full)).toBe('フルハウス');
    // キッカーで決まる
    expect(score5([C(9), C(9, 1), C(13), C(3), C(2)])).toBeGreaterThan(score5([C(9, 2), C(9, 3), C(12), C(3, 1), C(2, 1)]));
    expect(handName(bestHand([C(1), C(13), C(12), C(11), C(10), C(2, 1), C(3, 2)]).score)).toBe('ストレートフラッシュ');
  });

  it('サイドポット: 少なくオールインした人は、出した分までしか取れない', () => {
    const seat = (id: string, total: number, hole: number[], folded = false): PSeat => ({
      id, name: id, chips: 0, hole, bet: 0, total, inHand: true, folded, allIn: true, acted: true, sittingOut: false, timeouts: 0, leaving: false,
    });
    const board = [C(2, 1), C(7, 2), C(9, 3), C(11, 0), C(4, 1)];
    // a（一番強い）は 100 だけ、b は 300、c は 300（b が c より強い）、d は 50 出して降りた
    const seats = [seat('a', 100, [C(1), C(1, 1)]), seat('b', 300, [C(13), C(13, 1)]), seat('c', 300, [C(12), C(3, 2)]), seat('d', 50, [C(5), C(6)], true), null, null];
    const { winners } = settlePots(seats, board, 0);
    expect(winners.get(0)).toBe(100 * 3 + 50);
    expect(winners.get(1)).toBe(400);
    expect(winners.get(2)).toBeUndefined();
    // 分け合い（端数はボタンの次から）
    const split = settlePots([seat('x', 51, [C(2), C(3)]), seat('y', 50, [C(2, 2), C(3, 3)]), null, null, null, null], [C(10), C(11, 1), C(12, 2), C(13, 3), C(1, 1)], 0);
    expect(split.winners.get(0)! + split.winners.get(1)!).toBe(101);
  });
});

/** 卓のゲームを DB なしで動かす（銭の出入りを数える） */
function sim<S>(engine: TableEngine<S>, seed: number) {
  const bank = new Map<string, number>();
  let now = 1_000_000;
  const rng = seeded(seed);
  const ctx = (): Ctx => ({ now, rng, cfg: tcfg });
  const money = (fx?: Effects) => {
    for (const d of fx?.debits ?? []) bank.set(d.memberId, (bank.get(d.memberId) ?? 0) - d.amount);
    for (const c of fx?.credits ?? []) bank.set(c.memberId, (bank.get(c.memberId) ?? 0) + c.amount);
  };
  const run = (step: Step<S>): S => {
    if (!step.ok) throw new Error(step.error);
    money(step.fx);
    return step.state;
  };
  const advance = (s: S, ms: number): S => {
    now += ms;
    let st = s;
    for (let i = 0; i < 50; i++) {
      const d = engine.due(st);
      if (d === null || d > now) break;
      const r = engine.tick(st, ctx());
      if (!r) break;
      st = run(r);
    }
    return st;
  };
  return { bank, ctx, run, advance, rng, get now() { return now; } };
}

describe('♠ ポーカー（卓）', () => {
  it('たくさん打っても、チップと銭の合計は変わらない', () => {
    for (const seed of [1, 2, 3]) {
      const t = sim(poker, seed);
      let s = t.run(poker.create(P(1), { bb: '20', buyin: '1000' }, t.ctx()));
      for (const n of [2, 3, 4]) s = t.run(poker.join(s, P(n), { buyin: String(400 + n * 100) }, t.ctx()));
      const chips = (st: PokerState) => st.seats.reduce((a, x) => a + (x?.chips ?? 0) + (x?.total ?? 0) - (x && st.phase === 'waiting' ? 0 : 0), 0);
      const acts = ['fold', 'check', 'call', 'raise', 'allin'];
      let hands = 0;
      for (let step = 0; step < 3000 && hands < 40; step++) {
        s = t.advance(s, 1000);
        if (s.phase === 'showdown') {
          hands = s.hand;
          continue;
        }
        if (s.turn === null) continue;
        const x = s.seats[s.turn]!;
        const a = acts[t.rng(acts.length)]!;
        const to = s.currentBet + s.minRaise + t.rng(100);
        const r = poker.act(s, x.id, { action: a, amount: String(to) }, t.ctx());
        if (r.ok) s = t.run(r);
        // 合計はいつも同じ（持ち込み 1000 + 500 + 600 + 700）
        const inPlay = s.seats.reduce((n, y) => n + (y?.chips ?? 0), 0) + (s.phase === 'showdown' || s.phase === 'waiting' ? 0 : s.seats.reduce((n, y) => n + (y?.total ?? 0), 0));
        const out = [...t.bank.values()].reduce((a2, b) => a2 + b, 0);
        expect(inPlay + out).toBe(0);
        void chips;
      }
      expect(s.hand).toBeGreaterThan(5);
      // みんな立つと、全部戻る
      for (const n of [1, 2, 3, 4]) {
        if (s.seats.some((x) => x?.id === P(n).id)) s = t.run(poker.leave(s, P(n).id, t.ctx()));
      }
      s = t.advance(s, 60_000);
      expect([...t.bank.values()].reduce((a, b) => a + b, 0)).toBe(0);
      expect(poker.closed(s, t.now)).toBe(true);
    }
  });

  it('2 人: ボタンがスモールブラインドで先に動く。フォールドで相手の総取り', () => {
    const t = sim(poker, 9);
    let s = t.run(poker.create(P(1), { bb: '20', buyin: '1000' }, t.ctx()));
    expect(poker.join(s, P(2), { buyin: '100' }, t.ctx())).toEqual({ ok: false, error: 'bad_bet' });
    s = t.run(poker.join(s, P(2), { buyin: '1000' }, t.ctx()));
    s = t.advance(s, 6000);
    expect(s.phase).toBe('preflop');
    const btn = s.seats[s.button]!;
    expect(btn.bet).toBe(10);
    expect(s.turn).toBe(s.button);
    expect(poker.act(s, btn.id, { action: 'check' }, t.ctx())).toEqual({ ok: false, error: 'invalid' });
    s = t.run(poker.act(s, btn.id, { action: 'fold' }, t.ctx()));
    expect(s.phase).toBe('showdown');
    expect(s.result!.winners[0]!.amount).toBe(30);
    const other = s.seats.find((x) => x && x.id !== btn.id)!;
    expect(other.chips).toBe(1010);
    // 時間切れはチェック、できなければフォールド
    s = t.advance(s, 9000);
    s = t.advance(s, 6000);
    expect(s.phase).toBe('preflop');
    s = t.advance(s, 31_000);
    expect(s.log.some((l) => l.includes('時間切れ'))).toBe(true);
  });
});

describe('🃏 ブラックジャック卓', () => {
  it('みんな賭けたらすぐ配る。順番に動き、最後にまとめて払う', () => {
    const t = sim(bjTable, 4);
    let s = t.run(bjTable.create(P(1), {}, t.ctx()));
    s = t.run(bjTable.join(s, P(2), {}, t.ctx()));
    expect(bjTable.act(s, P(1).id, { action: 'bet', bet: '5' }, t.ctx())).toEqual({ ok: false, error: 'bad_bet' });
    s = t.run(bjTable.act(s, P(1).id, { action: 'bet', bet: '100' }, t.ctx()));
    expect(s.phase).toBe('betting');
    expect(s.deadline).toBe(t.now + BET_SECONDS * 1000);
    s = t.run(bjTable.act(s, P(2).id, { action: 'bet', bet: '200' }, t.ctx()));
    expect(['playing', 'result']).toContain(s.phase);
    let guard = 0;
    while (s.phase === 'playing' && guard++ < 20) {
      const who = s.turn!;
      expect(bjTable.act(s, who === P(1).id ? P(2).id : P(1).id, { action: 'hit' }, t.ctx())).toEqual({ ok: false, error: 'not_your_turn' });
      s = t.run(bjTable.act(s, who, { action: 'stand' }, t.ctx()));
    }
    expect(s.phase).toBe('result');
    for (const x of s.seats) expect(x.payout).toBeDefined();
    const net = [...t.bank.values()].reduce((a, b) => a + b, 0);
    expect(net).toBe(s.seats.reduce((n, x) => n + x.payout! - x.bet, 0));
    s = t.advance(s, 8000);
    expect(s).toMatchObject({ phase: 'betting', deadline: null });
    expect(s.seats.every((x) => x.bet === 0 && !x.hand.length)).toBe(true);
  });

  it('賭けの時間が過ぎたら、賭けた人だけで始める。時間切れはスタンド。賭けたまま抜けたら返す', () => {
    const t = sim(bjTable, 5);
    let s: BjTableState = t.run(bjTable.create(P(1), {}, t.ctx()));
    s = t.run(bjTable.join(s, P(2), {}, t.ctx()));
    s = t.run(bjTable.join(s, P(3), {}, t.ctx()));
    s = t.run(bjTable.act(s, P(3).id, { action: 'bet', bet: '50' }, t.ctx()));
    s = t.run(bjTable.leave(s, P(3).id, t.ctx()));
    expect(t.bank.get(P(3).id)).toBe(0);
    s = t.run(bjTable.act(s, P(1).id, { action: 'bet', bet: '100' }, t.ctx()));
    s = t.advance(s, (BET_SECONDS + 1) * 1000);
    expect(s.phase === 'playing' || s.phase === 'result').toBe(true);
    expect(s.seats.find((x) => x.id === P(2).id)!.hand).toEqual([]);
    s = t.advance(s, 25_000);
    expect(['result', 'betting']).toContain(s.phase);
  });
});

describe('🎴🎡 バカラ卓・ルーレット卓', () => {
  it('バカラ: みんな賭けたら配って払う', () => {
    const t = sim(baccaratTable, 6);
    let s = t.run(baccaratTable.create(P(1), {}, t.ctx()));
    s = t.run(baccaratTable.join(s, P(2), {}, t.ctx()));
    s = t.run(baccaratTable.act(s, P(1).id, { action: 'bet', bet: '100', on: 'player' }, t.ctx()));
    s = t.run(baccaratTable.act(s, P(2).id, { action: 'bet', bet: '100', on: 'banker' }, t.ctx()));
    expect(s.phase).toBe('result');
    expect(s.history).toHaveLength(1);
    expect(s.last).not.toBeNull();
  });

  it('ルーレット: いくつも賭けられる。「回す」をみんな押したら回る。取り消しは返す', () => {
    const t = sim(rouletteTable, 7);
    let s = t.run(rouletteTable.create(P(1), {}, t.ctx()));
    s = t.run(rouletteTable.join(s, P(2), {}, t.ctx()));
    s = t.run(rouletteTable.act(s, P(1).id, { action: 'bet', bet: '100', on: 'red' }, t.ctx()));
    s = t.run(rouletteTable.act(s, P(1).id, { action: 'bet', bet: '50', on: 'n7' }, t.ctx()));
    s = t.run(rouletteTable.act(s, P(2).id, { action: 'bet', bet: '10', on: 'odd' }, t.ctx()));
    s = t.run(rouletteTable.act(s, P(2).id, { action: 'clear' }, t.ctx()));
    expect(t.bank.get(P(2).id)).toBe(0);
    s = t.run(rouletteTable.act(s, P(1).id, { action: 'ready' }, t.ctx()));
    // 考え中の人（P2）がいるので、時間まで待つ
    expect(s.phase).toBe('betting');
    s = t.advance(s, 26_000);
    expect(s.phase).toBe('result');
    const seat = s.seats.find((x) => x.id === P(1).id)!;
    expect(t.bank.get(P(1).id)).toBe(-150 + seat.payout!);
  });
});

describe('🎡 ルーレット卓（盤からまとめて）', () => {
  it('まとめて置くと「回す」も押したことになる。みんな押したら回る', () => {
    const t = sim(rouletteTable, 8);
    let s = t.run(rouletteTable.create(P(1), {}, t.ctx()));
    s = t.run(rouletteTable.join(s, P(2), {}, t.ctx()));
    expect(rouletteTable.act(s, P(1).id, { action: 'bets', bets: 'purple:10' }, t.ctx())).toEqual({ ok: false, error: 'invalid' });
    expect(rouletteTable.act(s, P(1).id, { action: 'bets', bets: 'red:5' }, t.ctx())).toEqual({ ok: false, error: 'bad_bet' });
    s = t.run(rouletteTable.act(s, P(1).id, { action: 'bets', bets: 'red:100,n7:50' }, t.ctx()));
    expect(s.seats[0]).toMatchObject({ ready: true, bets: [{ on: 'red', amount: 100 }, { on: 'n7', amount: 50 }] });
    expect(s.phase).toBe('betting');
    s = t.run(rouletteTable.act(s, P(2).id, { action: 'bets', bets: 'odd:30' }, t.ctx()));
    expect(s.phase).toBe('result');
    expect(t.bank.get(P(1).id)).toBe(-150 + s.seats[0]!.payout!);
  });
});

describe('👑 大富豪', () => {
  it('出せる組・勝てるか（革命・ジョーカー）', () => {
    expect(dSet([C(5), C(5, 1)])).toMatchObject({ n: 2, rank: 5 });
    expect(dSet([C(5), C(6)])).toBeUndefined();
    expect(dSet([C(5), JOKER])).toMatchObject({ n: 2, rank: 5 });
    expect(dSet([JOKER])).toMatchObject({ n: 1, joker: true });
    const field = { cards: [C(10)], n: 1, strength: dSet([C(10)])!.strength, joker: false, by: 0 };
    expect(dBeats(field, dSet([C(2)])!, false)).toBe(true);
    expect(dBeats(field, dSet([C(4)])!, false)).toBe(false);
    expect(dBeats(field, dSet([C(4)])!, true)).toBe(true);
    expect(dBeats(field, dSet([JOKER])!, true)).toBe(true);
    expect(dBeats(field, dSet([C(2), C(2, 1)])!, false)).toBe(false);
  });

  it('最後まで打つと、上がった順に配る（合計は参加費の合計）', () => {
    for (const seed of [11, 12]) {
      const t = sim(daifugo, seed);
      let s: DaifugoState = t.run(daifugo.create(P(1), { entry: '100' }, t.ctx()));
      for (const n of [2, 3, 4]) s = t.run(daifugo.join(s, P(n), {}, t.ctx()));
      expect(daifugo.act(s, P(2).id, { action: 'start' }, t.ctx())).toEqual({ ok: false, error: 'invalid' });
      s = t.run(daifugo.act(s, P(1).id, { action: 'start' }, t.ctx()));
      expect(s.seats.reduce((n, x) => n + x.hand.length, 0)).toBe(53);
      // 自分の番の人が、出せるなら一番弱い 1 枚、出せなければパス
      for (let k = 0; k < 400 && s.phase === 'playing'; k++) {
        const i = s.turn!;
        const x = s.seats[i]!;
        const single = x.hand.find((c) => dBeats(s.field, dSet([c])!, s.revolution) && (!s.field || s.field.n === 1));
        const r = single !== undefined ? daifugo.act(s, x.id, { action: 'play', cards: [String(single)] }, t.ctx()) : daifugo.act(s, x.id, { action: 'pass' }, t.ctx());
        s = r.ok ? t.run(r) : t.advance(s, 41_000);
      }
      expect(s.phase).toBe('done');
      expect(s.order).toHaveLength(4);
      expect(s.payouts.map((p) => p.amount)).toEqual([240, 120, 40, 0]);
      expect([...t.bank.values()].reduce((a, b) => a + b, 0)).toBe(0);
      s = t.advance(s, 100_000);
      expect(daifugo.closed(s, t.now)).toBe(true);
    }
  });

  it('相手待ちで作った人が抜けたら、みんなに返して閉じる', () => {
    const t = sim(daifugo, 13);
    let s = t.run(daifugo.create(P(1), { entry: '100' }, t.ctx()));
    s = t.run(daifugo.join(s, P(2), {}, t.ctx()));
    s = t.run(daifugo.leave(s, P(1).id, t.ctx()));
    expect(s.phase).toBe('closed');
    expect([...t.bank.values()].every((v) => v === 0)).toBe(true);
  });
});

describe('🃟 ババ抜き', () => {
  it('そろった分は捨てる', () => {
    expect(dropPairs([C(5), C(5, 1), C(5, 2), C(7), JOKER])).toEqual({ hand: [C(5), C(7), JOKER], dropped: 2 });
  });

  it('時間切れで自動で引いても、最後はババを持った 1 人が残る', () => {
    const t = sim(babanuki, 21);
    let s: BabaState = t.run(babanuki.create(P(1), { entry: '90' }, t.ctx()));
    for (const n of [2, 3, 4]) s = t.run(babanuki.join(s, P(n), {}, t.ctx()));
    s = t.run(babanuki.act(s, P(1).id, { action: 'start' }, t.ctx()));
    for (let k = 0; k < 500 && s.phase === 'playing'; k++) s = t.advance(s, 26_000);
    expect(s.phase).toBe('done');
    const loser = s.order[s.order.length - 1]!;
    expect(s.seats.find((x) => x.id === loser)!.hand).toEqual([JOKER]);
    expect(s.payouts.find((p) => p.id === loser)!.amount).toBe(0);
    expect(s.payouts.reduce((n, p) => n + p.amount, 0)).toBe(360);
    expect(t.bank.get(loser)).toBe(-90);
  });
});

describe('卓（DB）', () => {
  let db: Db;
  let close: () => Promise<void>;
  const A = P(1);
  const B = P(2);
  beforeEach(async () => {
    ({ db, close } = await makeDb());
    await addCoins(db, A.id, 5000, 'admin_grant');
    await addCoins(db, B.id, 5000, 'admin_grant');
  });
  afterEach(async () => {
    await close();
  });
  const bal = async (id: string) => (await walletOf(db, id)).balance;

  it('ポーカー: 持ち込み・1 人 1 卓・立つと戻る', async () => {
    const now = new Date('2026-10-01T12:00:00Z');
    const c = await createTable(db, tcfg, 'poker', A, { bb: '20', buyin: '1000' }, now, seeded(1));
    expect(c.status).toBe('ok');
    const id = 'table' in c ? c.table.id : 0;
    expect(await bal(A.id)).toBe(4000);
    expect((await createTable(db, tcfg, 'bj_table', A, {}, now)).status).toBe('seated');
    expect((await joinTable(db, tcfg, id, B, { buyin: '9999' }, now)).status).toBe('bad_bet');
    expect((await joinTable(db, tcfg, id, B, { buyin: '600' }, now)).status).toBe('ok');
    expect(await bal(B.id)).toBe(4400);
    expect((await myTable(db, B.id))?.id).toBe(id);
    const later = new Date(now.getTime() + 6000);
    const t = await pollTable(db, tcfg, id, later, seeded(2));
    expect((t!.state as PokerState).phase).toBe('preflop');
    const s = t!.state as PokerState;
    const mover = s.seats[s.turn!]!;
    expect((await actTable(db, tcfg, id, mover.id, { action: 'fold' }, later)).status).toBe('ok');
    // 手の途中でなければ、すぐ立てる
    const done = new Date(later.getTime() + 10_000);
    await pollTable(db, tcfg, id, done);
    await leaveTable(db, tcfg, id, A.id, done);
    await leaveTable(db, tcfg, id, B.id, done);
    expect((await bal(A.id)) + (await bal(B.id))).toBe(10_000);
    expect((await tableById(db, id))?.status).toBe('closed');
  });

  it('銭が足りなければ、何も変えない。ディーラー卓は収支に入る', async () => {
    const now = new Date('2026-10-01T12:00:00Z');
    const c = await createTable(db, tcfg, 'baccarat_table', A, {}, now);
    const id = 'table' in c ? c.table.id : 0;
    const poorCfg = { ...tcfg, casino: { ...tcfg.casino, maxBet: 100_000 } };
    expect((await actTable(db, poorCfg, id, A.id, { action: 'bet', bet: '6000', on: 'player' }, now)).status).toBe('poor');
    expect(await bal(A.id)).toBe(5000);
    expect((await actTable(db, tcfg, id, A.id, { action: 'bet', bet: '100', on: 'player' }, now)).status).toBe('ok');
    const { casinoStats } = await import('../src/services/casino/casino.js');
    const stats = await casinoStats(db, new Date(now.getTime() - 60_000));
    expect(stats.find((x) => x.game === 'baccarat')).toMatchObject({ plays: 1, wagered: 100 });
  });
});

describe('♠ ポーカー: 放っておかれた卓', () => {
  it('手の合間に 30 分動かない人は立たせて、チップを返す', () => {
    const t = sim(poker, 31);
    let s = t.run(poker.create(P(1), { bb: '20', buyin: '800' }, t.ctx()));
    expect(poker.due(s)).toBe(t.now + 30 * 60_000);
    s = t.advance(s, 31 * 60_000);
    expect(poker.closed(s, t.now)).toBe(true);
    expect(t.bank.get(P(1).id)).toBe(0);
  });
});

describe('⏱ 持ち時間を長くする', () => {
  it('卓を立てる人が選んだ倍率で、持ち時間が長くなる（前の卓はふつう）', () => {
    const t = sim(poker, 41);
    let s = t.run(poker.create(P(1), { bb: '20', buyin: '800', pace: 'relaxed' }, t.ctx()));
    s = t.run(poker.join(s, P(2), { buyin: '800' }, t.ctx()));
    s = t.advance(s, 6000);
    expect(s.phase).toBe('preflop');
    expect(s.deadline).toBe(t.now + 120_000);
    s = t.advance(s, 60_000);
    expect(s.log.some((l) => l.includes('時間切れ'))).toBe(false);

    const b = sim(bjTable, 42);
    let bs = b.run(bjTable.create(P(1), { pace: 'slow' }, b.ctx()));
    bs = b.run(bjTable.join(bs, P(2), {}, b.ctx()));
    bs = b.run(bjTable.act(bs, P(1).id, { action: 'bet', bet: '100' }, b.ctx()));
    expect(bs.deadline).toBe(b.now + BET_SECONDS * 2000);
    // 選ばなかった・おかしな値は「ふつう」
    expect(b.run(bjTable.create(P(3), { pace: 'forever' }, b.ctx())).pace).toBe('normal');

    const d = sim(daifugo, 43);
    let ds = d.run(daifugo.create(P(1), { entry: '0', pace: 'relaxed' }, d.ctx()));
    for (const n of [2, 3]) ds = d.run(daifugo.join(ds, P(n), {}, d.ctx()));
    ds = d.run(daifugo.act(ds, P(1).id, { action: 'start' }, d.ctx()));
    expect(ds.deadline).toBe(d.now + 160_000);
  });
});

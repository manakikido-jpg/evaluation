import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GuildConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import type { Rng } from '../src/services/casino/cards.js';
import { isBot } from '../src/services/casino/tables/bots.js';
import { active, babanuki, daifugo, dBotSimple, dBotStrong, type BabaState, type DaifugoState } from '../src/services/casino/tables/party.js';
import { poker, type PokerState } from '../src/services/casino/tables/poker.js';
import { chen, equity, handClass, parseRange, pokerBotMove, positionOf } from '../src/services/casino/tables/pokerBot.js';
import { actTable, createTable, leaveTable, pollTable, tableById } from '../src/services/casino/tables/service.js';
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
const C = (r: number, s = 0) => s * 13 + r - 1;
const tcfg: GuildConfig = { ...cfg, casino: { ...cfg.casino, dailyBetLimit: 0 } };
const P = (n: number) => ({ id: `76000000000000000${n}`, name: `p${n}` });

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
    for (let i = 0; i < 200; i++) {
      const d = engine.due(st);
      if (d === null || d > now) break;
      const r = engine.tick(st, ctx());
      if (!r) break;
      st = run(r);
    }
    return st;
  };
  return { bank, ctx, run, advance, rng };
}

describe('🤖 ポーカーの BOT', () => {
  it('手の名前・レンジの読み方・ポジション', () => {
    expect(handClass([C(1, 0), C(13, 0)])).toBe('AKs');
    expect(handClass([C(9, 1), C(10, 2)])).toBe('T9o');
    expect(handClass([C(7, 1), C(7, 2)])).toBe('77');
    const r = parseRange('TT+, A2s+, KTo+, 76s@40');
    expect([...r.keys()].filter((k) => k.length === 2)).toEqual(['TT', 'JJ', 'QQ', 'KK', 'AA']);
    expect(r.get('A2s')).toBe(1);
    expect(r.get('AKs')).toBe(1);
    expect(r.has('AAs')).toBe(false);
    expect(r.get('KQo')).toBe(1);
    expect(r.has('K9o')).toBe(false);
    expect(r.get('76s')).toBe(0.4);
    expect(chen([C(1), C(1, 1)])).toBe(20);
    expect(chen([C(7), C(2, 1)])).toBeLessThan(2);
  });

  it('勝率: AA は 72o にほぼ勝つ。フロップでセットは強い', () => {
    const rng = seeded(3);
    expect(equity([C(1), C(1, 1)], [], 1, rng, 400, 0)).toBeGreaterThan(0.8);
    expect(equity([C(7), C(2, 1)], [], 1, rng, 400, 0)).toBeLessThan(0.4);
    expect(equity([C(9), C(9, 1)], [C(9, 2), C(4, 3), C(13, 0)], 1, rng, 300)).toBeGreaterThan(0.85);
  });

  it('プリフロップ: UTG は AA を上げて 72o を降りる。強い手はオールインにコール', () => {
    const t = sim(poker, 5);
    let s = t.run(poker.create(P(1), { bb: '20', buyin: '2000' }, t.ctx()));
    for (const n of [2, 3, 4, 5, 6]) s = t.run(poker.join(s, P(n), { buyin: '2000' }, t.ctx()));
    s = t.advance(s, 6000);
    expect(s.phase).toBe('preflop');
    const i = s.turn!;
    expect(positionOf(s, i)).toBe('UTG');
    const withHole = (hole: number[]) => {
      const c = structuredClone(s);
      c.seats[i]!.hole = hole;
      return c;
    };
    expect(pokerBotMove(withHole([C(1), C(1, 1)]), i, seeded(1))).toMatchObject({ action: 'raise', amount: 50 });
    expect(pokerBotMove(withHole([C(7), C(2, 1)]), i, seeded(1))).toEqual({ action: 'fold' });
    // オールインされた
    const shove = withHole([C(1), C(1, 1)]);
    shove.currentBet = 2000;
    expect(['call', 'allin']).toContain(pokerBotMove(shove, i, seeded(1)).action);
    shove.seats[i]!.hole = [C(9), C(4, 1)];
    expect(pokerBotMove(shove, i, seeded(1))).toEqual({ action: 'fold' });
  });

  it('卓に入れる・BOT どうしと人で打っても銭の合計は合う（BOT の分は胴元）・人が立つと BOT も立つ', () => {
    for (const seed of [1, 2]) {
      const t = sim(poker, seed);
      let s: PokerState = t.run(poker.create(P(1), { bb: '20', buyin: '1000' }, t.ctx()));
      for (let k = 0; k < 3; k++) s = t.run(poker.act(s, P(1).id, { action: 'add_bot' }, t.ctx()));
      const bots = s.seats.filter((x) => x?.bot);
      expect(bots).toHaveLength(3);
      expect(bots.map((b) => b!.chips)).toEqual([2000, 2000, 2000]);
      expect(poker.seats(s)).toEqual([P(1).id]);
      let hands = 0;
      for (let step = 0; step < 4000 && hands < 15; step++) {
        s = t.advance(s, 2000);
        hands = s.hand;
        if (s.turn !== null && !s.seats[s.turn]!.bot && ['preflop', 'flop', 'turn', 'river'].includes(s.phase)) {
          const x = s.seats[s.turn]!;
          const r = poker.act(s, x.id, { action: s.currentBet > x.bet ? 'call' : 'check' }, t.ctx());
          s = r.ok ? t.run(r) : s;
        }
      }
      expect(hands).toBeGreaterThanOrEqual(10);
      s = t.run(poker.leave(s, P(1).id, t.ctx()));
      // BOT は 1 手 1.5 秒（手が終わると、人がいないので BOT も立つ）
      for (let k = 0; k < 120 && !poker.closed(s, 0); k++) s = t.advance(s, 2000);
      expect(poker.closed(s, 0)).toBe(true);
      // 人の銭 + 胴元（BOT）の銭 = 0
      expect([...t.bank.values()].reduce((a, b) => a + b, 0)).toBe(0);
    }
  });
});

describe('🤖 大富豪・ババ抜きの BOT', () => {
  it('作った人だけが入れられる・相手待ちのあいだだけ・外すと返す・BOT だけ残ったら閉じる', () => {
    const t = sim(daifugo, 1);
    let s: DaifugoState = t.run(daifugo.create(P(1), { entry: '100' }, t.ctx()));
    s = t.run(daifugo.join(s, P(2), {}, t.ctx()));
    expect(daifugo.act(s, P(2).id, { action: 'add_bot' }, t.ctx())).toEqual({ ok: false, error: 'invalid' });
    s = t.run(daifugo.act(s, P(1).id, { action: 'add_bot' }, t.ctx()));
    s = t.run(daifugo.act(s, P(1).id, { action: 'add_bot' }, t.ctx()));
    expect(s.seats.filter((x) => x.bot).map((x) => x.name)).toEqual(['🤖 鶴丸', '🤖 亀吉']);
    expect(daifugo.seats(s)).toEqual([P(1).id, P(2).id]);
    s = t.run(daifugo.act(s, P(1).id, { action: 'remove_bot', bot: 'bot:2' }, t.ctx()));
    expect(s.seats).toHaveLength(3);
    // 2 人目が抜けて、作った人が抜けると閉じて全部返す
    s = t.run(daifugo.leave(s, P(2).id, t.ctx()));
    s = t.run(daifugo.leave(s, P(1).id, t.ctx()));
    expect(s.phase).toBe('closed');
    expect([...t.bank.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('大富豪: 人 1 人と BOT 3 人で最後まで（BOT は自分で動く）。銭は合う', () => {
    for (const seed of [3, 4, 5]) {
      const t = sim(daifugo, seed);
      let s: DaifugoState = t.run(daifugo.create(P(1), { entry: '100', rules_set: '1', rules: ['revolution', 'eight', 'joker', 'give7', 'drop10', 'stairs'] }, t.ctx()));
      for (let k = 0; k < 3; k++) s = t.run(daifugo.act(s, P(1).id, { action: 'add_bot' }, t.ctx()));
      s = t.run(daifugo.act(s, P(1).id, { action: 'start' }, t.ctx()));
      for (let k = 0; k < 600 && s.phase === 'playing'; k++) {
        // 人は時間切れまかせ・BOT は 1.5 秒で動く
        s = t.advance(s, 2000);
        if (s.turn !== null && !s.seats[s.turn]!.bot) s = t.advance(s, 41_000);
      }
      expect(s.phase).toBe('done');
      expect(s.order).toHaveLength(4);
      expect([...t.bank.values()].reduce((a, b) => a + b, 0)).toBe(0);
      expect(s.seats.filter((x) => x.bot && x.timeouts > 0)).toHaveLength(0);
    }
  });

  it('大富豪の BOT は、弱い札から出し、ジョーカー・2 は温存する', () => {
    const t = sim(daifugo, 7);
    let s: DaifugoState = t.run(daifugo.create(P(1), { entry: '0' }, t.ctx()));
    for (let k = 0; k < 2; k++) s = t.run(daifugo.act(s, P(1).id, { action: 'add_bot' }, t.ctx()));
    s = t.run(daifugo.act(s, P(1).id, { action: 'start' }, t.ctx()));
    const b = s.seats.findIndex((x) => x.bot);
    const c = structuredClone(s);
    c.turn = b;
    c.field = null;
    c.seats[b]!.hand = [C(3, 0), C(3, 1), C(9, 0), C(2, 0), 52];
    c.deadline = t.ctx().now;
    const r = daifugo.tick(c, t.ctx());
    expect(r?.ok).toBe(true);
    if (!r?.ok) return;
    // 3 のペアを出す（崩さない・強い札は残す）
    expect(r.state.seats[b]!.hand.sort((x, y) => x - y)).toEqual([C(2, 0), C(9, 0), 52].sort((x, y) => x - y));
  });

  it('大富豪の強い BOT: 相手の手札はのぞかない（見えている枚数が同じなら、中身が入れ替わっても同じ手）', () => {
    const t = sim(daifugo, 11);
    let s: DaifugoState = t.run(daifugo.create(P(1), { entry: '0' }, t.ctx()));
    for (let k = 0; k < 3; k++) s = t.run(daifugo.act(s, P(1).id, { action: 'add_bot' }, t.ctx()));
    s = t.run(daifugo.act(s, P(1).id, { action: 'start' }, t.ctx()));
    for (let k = 0; k < 20 && s.phase === 'playing'; k++) {
      const i = s.turn!;
      const a = dBotStrong(structuredClone(s), i);
      // ほかの人の手札をまぜて配りなおす（枚数は同じ）
      const b = structuredClone(s);
      const others = b.seats.map((_, j) => j).filter((j) => j !== i);
      const pool = others.flatMap((j) => b.seats[j]!.hand).reverse();
      for (const j of others) b.seats[j]!.hand = pool.splice(0, s.seats[j]!.hand.length);
      const c = dBotStrong(b, i);
      expect(a.ok && c.ok).toBe(true);
      if (!a.ok || !c.ok) return;
      expect(c.state.seats[i]!.hand).toEqual(a.state.seats[i]!.hand);
      s = a.state;
    }
  });

  it('大富豪の強い BOT は、かんたんな BOT より上に上がる（反則上がりもしない）', () => {
    let strong = 0;
    let simple = 0;
    let fouls = 0;
    const games = 24;
    for (let g = 0; g < games; g++) {
      const t = sim(daifugo, 100 + g);
      let s: DaifugoState = t.run(daifugo.create(P(1), { entry: '0', rules_set: '1', rules: ['revolution', 'eight', 'joker', 'stairs', 'foul'] }, t.ctx()));
      for (let k = 0; k < 3; k++) s = t.run(daifugo.act(s, P(1).id, { action: 'add_bot' }, t.ctx()));
      s = t.run(daifugo.act(s, P(1).id, { action: 'start' }, t.ctx()));
      const me = g % 4;
      for (let k = 0; k < 1000 && active(s).length > 1; k++) {
        const i = s.turn!;
        const r = (i === me ? dBotStrong : dBotSimple)(structuredClone(s), i);
        if (!r.ok) throw new Error(r.error);
        s = r.state;
      }
      expect(active(s).length).toBeLessThanOrEqual(1);
      const order = [...s.order, ...s.seats.filter((x) => !x.out).map((x) => x.id), ...[...(s.fouls ?? [])].reverse()];
      s.seats.forEach((x, k) => (k === me ? (strong += order.indexOf(x.id)) : (simple += order.indexOf(x.id) / 3)));
      if (s.fouls?.includes(s.seats[me]!.id)) fouls++;
    }
    // 4 人なので、どちらも同じ強さなら平均 1.5（0 が 1 位）
    expect(strong / games).toBeLessThan(1.0);
    expect(strong / games).toBeLessThan(simple / games - 0.8);
    expect(fouls).toBe(0);
  });

  it('ババ抜き: BOT と最後まで', () => {
    const t = sim(babanuki, 2);
    let s: BabaState = t.run(babanuki.create(P(1), { entry: '50' }, t.ctx()));
    s = t.run(babanuki.act(s, P(1).id, { action: 'add_bot' }, t.ctx()));
    s = t.run(babanuki.act(s, P(1).id, { action: 'add_bot' }, t.ctx()));
    s = t.run(babanuki.act(s, P(1).id, { action: 'start' }, t.ctx()));
    for (let k = 0; k < 400 && s.phase === 'playing'; k++) s = t.advance(s, 26_000);
    expect(s.phase).toBe('done');
    expect([...t.bank.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('🤖 BOT の銭（DB）', () => {
  let db: Db;
  let close: () => Promise<void>;
  const A = P(1);
  beforeEach(async () => {
    ({ db, close } = await makeDb());
    await addCoins(db, A.id, 5000, 'admin_grant');
  });
  afterEach(async () => {
    await close();
  });

  it('BOT の参加費は引かず（胴元）、収支に bot の行で入る。遊んだ人には数えない', async () => {
    const now = new Date('2026-10-01T12:00:00Z');
    const c = await createTable(db, tcfg, 'daifugo', A, { entry: '100' }, now);
    const id = 'table' in c ? c.table.id : 0;
    expect((await actTable(db, tcfg, id, A.id, { action: 'add_bot' }, now)).status).toBe('ok');
    expect((await actTable(db, tcfg, id, A.id, { action: 'add_bot' }, now)).status).toBe('ok');
    expect((await walletOf(db, A.id)).balance).toBe(4900);
    const { casinoStats } = await import('../src/services/casino/casino.js');
    const stats = await casinoStats(db, new Date(now.getTime() - 60_000));
    expect(stats.find((x) => x.game === 'daifugo')).toMatchObject({ plays: 2, wagered: 0, paid: 200, players: 0 });
    expect((await actTable(db, tcfg, id, A.id, { action: 'start' }, now)).status).toBe('ok');
    // 最後まで（人は時間切れまかせ）
    let t = await tableById(db, id);
    for (let k = 0; k < 300 && t?.status === 'open' && (t.state as DaifugoState).phase === 'playing'; k++) {
      const at = new Date(now.getTime() + (k + 1) * 45_000);
      t = await pollTable(db, tcfg, id, at, seeded(k + 1));
    }
    const st = t!.state as DaifugoState;
    expect(st.phase).toBe('done');
    const won = st.payouts.find((p) => p.id === A.id)?.amount ?? 0;
    expect((await walletOf(db, A.id)).balance).toBe(4900 + won);
    const after = (await casinoStats(db, new Date(now.getTime() - 60_000))).find((x) => x.game === 'daifugo')!;
    // 胴元の収支 = BOT が取った分 - BOT の参加費 = -(人が増えた分)
    expect(after.wagered - after.paid).toBe(-(won - 100));
    expect(st.payouts.filter((p) => isBot(p.id)).length).toBeGreaterThanOrEqual(0);
    await leaveTable(db, tcfg, id, A.id, now).catch(() => undefined);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseGuildConfig, type GuildConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { slotAtMachines } from '../src/db/schema.js';
import type { Rng } from '../src/services/casino/cards.js';
import { AT_CEILING, AT_IDLE_STOPS, AT_SET_GAMES, atLookOf, atMult, atStopsFor, atWinLine, newAtMachine, simulateAt, stepAt, type AtMachine } from '../src/services/casino/slotAt.js';
import { atFloorData, leaveAt, orderAt, playAt, type AtGameState } from '../src/services/casino/slotAtPlay.js';
import { atBattle, atShow } from '../src/services/casino/slotAtShow.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { cfg as baseCfg, makeDb } from './helpers.js';

const seeded = (seed: number): Rng => {
  let x = seed >>> 0 || 1;
  return (n) => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) % n;
  };
};
/** いつも 0 を返す（押し順ベル・ナビは左中右・いちばん初めの目） */
const zero: Rng = () => 0;
/** いつも最大を返す（役ははずれ・抽選ははずれ） */
const top: Rng = (n) => n - 1;

describe('🦊 AT 機の中身', () => {
  it('役ごとの止まる目は、その役だけに見える。止まったままの目はどの役にも見えない', () => {
    for (const look of ['bell', 'replay', 'suika', 'chance', 'byakko', 'scherry', 'wcherry', 'none'] as const) {
      for (const seed of [1, 2, 3]) expect(atLookOf(atStopsFor(look, seeded(seed)))).toBe(look);
    }
    expect(atLookOf(AT_IDLE_STOPS)).toBe('none');
  });

  it('ラインは 5 本: ベル・リプレイ・スイカ・チャンス目・白狐目は、上段・中段・下段・斜めのどれか 1 本にそろう', () => {
    for (const look of ['bell', 'replay', 'suika', 'chance', 'byakko'] as const) {
      const lines = new Set<number>();
      for (let seed = 1; seed < 400; seed++) {
        const st = atStopsFor(look, seeded(seed));
        expect(atLookOf(st)).toBe(look);
        lines.add(atWinLine(st));
      }
      expect(lines.has(-1)).toBe(false);
      // 中段だけではない
      expect(lines.size).toBeGreaterThan(1);
    }
    expect(atWinLine(AT_IDLE_STOPS)).toBe(-1);
    expect(atWinLine(atStopsFor('scherry', seeded(3)))).toBe(-1);
  });

  it('押し順ベル: AT 中はナビどおりなら 3 倍、ちがえば 0。通常時は 6 回に 1 回（lucky）', () => {
    expect(atMult('oshijun', { navi: [1, 2, 0], order: [1, 2, 0] })).toBe(3);
    expect(atMult('oshijun', { navi: [1, 2, 0], order: [0, 1, 2] })).toBe(0);
    expect(atMult('oshijun', { navi: null, lucky: true })).toBe(3);
    expect(atMult('oshijun', { navi: null, lucky: false })).toBe(0);
    expect(atMult('suika', { navi: null })).toBe(5);
    expect(atMult('none', { navi: null })).toBe(0);
  });

  it('天井: 通常時 700 G で前兆 → AT（継続率 66% 以上）。前兆の最後で AT 突入', () => {
    let m: AtMachine = { ...newAtMachine(), games: AT_CEILING - 1 };
    const r = stepAt(m, 1, top);
    expect(r.next.phase).toBe('zenchou');
    expect(r.next.tenjou).toBe(true);
    expect(r.next.nextRate).toBeGreaterThanOrEqual(66);
    m = { ...r.next, zenchou: 1 };
    const s = stepAt(m, 1, top);
    expect(s.next.phase).toBe('at');
    expect(s.next.at).toMatchObject({ left: AT_SET_GAMES, set: 1 });
    expect(s.step.events[0]).toMatchObject({ k: 'at_start', tenjou: true });
    expect(s.step.hint).toBe(3);
  });

  it('AT: 1 ゲームごとに残りが減り、セットの終わりで継続バトル（勝てば次のセット・負ければ終わり）', () => {
    const at = (rate: number): AtMachine => ({ ...newAtMachine(), phase: 'at', at: { left: 1, set: 1, rate, tokka: 0, games: 10, added: 0, won: 300 } });
    const win = stepAt(at(100), 1, top);
    expect(win.step.events).toContainEqual({ k: 'battle', win: true, set: 1 });
    expect(win.next.at).toMatchObject({ left: AT_SET_GAMES, set: 2 });
    const lose = stepAt(at(0), 1, top);
    expect(lose.step.events).toContainEqual({ k: 'battle', win: false, set: 1 });
    expect(lose.step.events).toContainEqual({ k: 'at_end', games: 11, won: 300, sets: 1 });
    expect(lose.next).toMatchObject({ phase: 'normal', at: null, games: 0 });
    // 押し順ベルにはナビが付く
    const bell = stepAt({ ...at(50), at: { left: 20, set: 1, rate: 50, tokka: 0, games: 0, added: 0, won: 0 } }, 1, zero);
    expect(bell.step.role).toBe('oshijun');
    expect(bell.step.navi).toEqual([0, 1, 2]);
    expect(bell.next.at!.left).toBe(19);
  });

  it('払い戻し率: 設定 1 はおよそ 95%（胴元が勝つ）・設定 6 のほうが高い', () => {
    const r1 = simulateAt(1, 1_500_000, seeded(11));
    const r6 = simulateAt(6, 1_500_000, seeded(11));
    expect(r1.rtp).toBeGreaterThan(0.88);
    expect(r1.rtp).toBeLessThan(1.0);
    expect(r6.rtp).toBeGreaterThan(r1.rtp);
    expect(r6.rtp).toBeLessThan(1.1);
    expect(r1.ats).toBeGreaterThan(1000);
  }, 60_000);
});

describe('🦊 AT 機の演出（見せ方だけ）', () => {
  it('AT が決まったゲームは、フリーズ・虹・確定音・1 段強い予告のどれか。白狐目はいつもフリーズ', () => {
    const prev = newAtMachine();
    for (let seed = 1; seed < 200; seed++) {
      const rng = seeded(seed);
      const r = stepAt(prev, 1, rng);
      const show = atShow(prev, r.step, r.next, rng);
      const won = r.next.phase === 'zenchou';
      // 虹とフリーズは当たりのときだけ
      if (!won) {
        expect(show.freeze).toBe(false);
        expect(show.lever).not.toBe('rainbow');
        expect(show.stop3).not.toBe('rainbow');
        expect(show.kakutei).toBe(false);
      }
    }
    const byakko = stepAt(prev, 1, top);
    const fake = { ...byakko.step, role: 'byakko' as const };
    const won = atShow(prev, fake, { ...prev, phase: 'zenchou', zenchou: 1 }, top);
    expect(won.freeze).toBe(true);
  });

  it('前兆の最後（AT 突入）は鬼が目の前・溜めあり。AT 中は舞台が白狐ラッシュ・特化は乱舞', () => {
    const z: AtMachine = { ...newAtMachine(), phase: 'zenchou', zenchou: 1, nextRate: 66 };
    const r = stepAt(z, 1, top);
    const s = atShow(z, r.step, r.next, top);
    expect(s).toMatchObject({ stage: 'forest', oni: 3, hold: true });
    const at: AtMachine = { ...newAtMachine(), phase: 'at', at: { left: 20, set: 1, rate: 50, tokka: 0, games: 0, added: 0, won: 0 } };
    expect(atShow(at, stepAt(at, 1, zero).step, at, zero).stage).toBe('rush');
    const tk: AtMachine = { ...at, at: { ...at.at!, tokka: 2 } };
    expect(atShow(tk, stepAt(tk, 1, zero).step, tk, zero).stage).toBe('ranbu');
  });

  it('継続バトル: 勝ちは白狐の一撃、負けは鬼の一撃で終わる（3〜5 手）', () => {
    for (let seed = 1; seed < 50; seed++) {
      const w = atBattle(true, seeded(seed));
      const l = atBattle(false, seeded(seed));
      expect(w.at(-1)).toEqual({ who: 'byakko', hit: true });
      expect(l.at(-1)).toEqual({ who: 'oni', hit: true });
      expect(w.length).toBeGreaterThanOrEqual(3);
      expect(w.length).toBeLessThanOrEqual(5);
    }
    const at: AtMachine = { ...newAtMachine(), phase: 'at', at: { left: 1, set: 1, rate: 100, tokka: 0, games: 10, added: 0, won: 0 } };
    const r = stepAt(at, 1, top);
    expect(atShow(at, r.step, r.next, top).battle?.at(-1)).toEqual({ who: 'byakko', hit: true });
  });
});

describe('🦊 AT 機の島（サービス）', () => {
  const A = '700000000000000501';
  const B = '700000000000000502';
  let db: Db;
  let close: () => Promise<void>;
  let cfg: GuildConfig;
  const T0 = new Date('2026-10-05T03:00:00Z');
  beforeEach(async () => {
    ({ db, close } = await makeDb());
    cfg = parseGuildConfig({ ...baseCfg, casino: { ...baseCfg.casino, atOpen: true, atBet: 30, atMachines: [1, 1, 'random'] } });
    await addCoins(db, A, 5000, 'admin_grant');
    await addCoins(db, B, 5000, 'admin_grant');
  });
  afterEach(async () => {
    await close();
  });

  it('公開するまでは遊べない。1 ゲームの賭けは島で決まった量', async () => {
    const closed = parseGuildConfig({ ...cfg, casino: { ...cfg.casino, atOpen: false } });
    expect((await playAt(db, closed, A, 1, top, T0)).status).toBe('game_off');
    const r = await playAt(db, cfg, A, 1, top, T0);
    expect(r.status).toBe('ok');
    expect((await walletOf(db, A)).balance).toBe(5000 - 30);
    if (r.status !== 'ok') return;
    const s = r.row.state as AtGameState;
    expect(s).toMatchObject({ machine: 1, role: 'none', during: 'normal', games: 1, phase: 'normal' });
    expect(r.row.bet).toBe(30);
    expect((await playAt(db, cfg, A, 9, top, T0)).status).toBe('bad_bet');
  });

  it('座っている人だけが回せる（3 分回さないと空く・席を立てばすぐ空く）。台の回転数は人が替わっても続く', async () => {
    expect((await playAt(db, cfg, A, 1, top, T0)).status).toBe('ok');
    expect((await playAt(db, cfg, B, 1, top, new Date(T0.getTime() + 60_000))).status).toBe('occupied');
    const r = await playAt(db, cfg, B, 1, top, new Date(T0.getTime() + 4 * 60_000));
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect((r.row.state as AtGameState).games).toBe(2);
    await leaveAt(db, B, 1);
    expect((await playAt(db, cfg, A, 1, top, new Date(T0.getTime() + 4 * 60_000 + 1000))).status).toBe('ok');
  });

  it('AT 中の押し順ベル: 押した順を送るまで待つ。ナビどおりなら 3 倍、ちがえばこぼし', async () => {
    const atState = { ...newAtMachine(), phase: 'at', at: { left: 20, set: 1, rate: 66, tokka: 0, games: 0, added: 0, won: 0 } };
    await db.insert(slotAtMachines).values({ machine: 2, state: atState as unknown as Record<string, unknown> });
    const r = await playAt(db, cfg, A, 2, zero, T0);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.row.status).toBe('playing');
    const s = r.row.state as AtGameState;
    expect(s).toMatchObject({ role: 'oshijun', waiting: true, navi: [0, 1, 2], during: 'at', pre: { left: 20, set: 1, rate: 66 } });
    expect(s.show).toMatchObject({ stage: 'rush', freeze: false });
    // 待っているあいだは次を回せない（同じ 1 回に戻る）
    expect((await playAt(db, cfg, A, 2, zero, T0)).status).toBe('busy');
    const done = await orderAt(db, r.row.id, A, [0, 1, 2], zero, T0);
    expect(done.status).toBe('ok');
    if (done.status !== 'ok') return;
    expect(done.row.payout).toBe(90);
    expect(atLookOf((done.row.state as AtGameState).stops)).toBe('bell');
    expect((done.row.state as AtGameState).from).toEqual(s.stops);
    expect((await walletOf(db, A)).balance).toBe(5000 - 30 + 90);
    // ちがう順はこぼし
    const r2 = await playAt(db, cfg, A, 2, zero, T0);
    if (r2.status !== 'ok') throw new Error(r2.status);
    const miss = await orderAt(db, r2.row.id, A, [2, 1, 0], zero, T0);
    expect(miss.status === 'ok' && miss.row.payout).toBe(0);
    // 台の AT の獲得に入っている
    const [m] = await db.select().from(slotAtMachines);
    expect(((m!.state as unknown as AtMachine).at!.won)).toBe(90);
  });

  it('島のデータ: 台ごとの今日の回転・AT の回数と獲得', async () => {
    await db.insert(slotAtMachines).values({ machine: 1, state: { ...newAtMachine(), phase: 'zenchou', zenchou: 1, nextRate: 50 } as unknown as Record<string, unknown> });
    expect((await playAt(db, cfg, A, 1, top, T0)).status).toBe('ok');
    expect((await playAt(db, cfg, A, 1, top, T0)).status).toBe('ok');
    const d = await atFloorData(db, cfg, T0);
    expect(d.today[0]).toMatchObject({ games: 2, ats: 1 });
    expect(d.today[1]).toMatchObject({ games: 0, ats: 0 });
  });
});

describe('🦊 フォルダに置いた AT 機の絵', () => {
  it('名前が絵の欄と同じものだけ読む。同じ名前なら webp → png → jpg → gif の順', async () => {
    const { pickAtFiles } = await import('../src/web/assets.js');
    expect(pickAtFiles(['bg-normal.png', 'bg-normal.webp', 'byakko.jpg', 'byakko.gif', 'README.md', 'nope.png', 'Oni.png', 'logo-rush.jpeg'])).toEqual({
      'bg-normal': 'bg-normal.webp',
      byakko: 'byakko.jpg',
      'logo-rush': 'logo-rush.jpeg',
    });
  });
});

import { describe, expect, it } from 'vitest';
import type { Rng } from '../src/services/casino/cards.js';
import { scoreWin, type WinInput } from '../src/services/casino/mahjong/score.js';
import { doraOf, EAST, isSanmaCut, kindOf, NORTH, SANMA_TILES } from '../src/services/casino/mahjong/tiles.js';
import { canKita, mahjong, SANMA_START_POINTS, type MjState } from '../src/services/casino/tables/mahjong.js';
import type { Ctx, Effects, Step } from '../src/services/casino/tables/types.js';
import { cfg } from './helpers.js';

const seeded = (seed: number): Rng => {
  let x = seed >>> 0 || 1;
  return (n) => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) % n;
  };
};

const HOST = { id: '700000000000000001', name: 'ほすと' };

const tileCount = (s: MjState) =>
  s.wall.length + s.dead.length + s.hands.flat().length + s.rivers.flat().filter((r) => !r.called).length + s.melds.flat().flatMap((m) => m.tiles).length + (s.nuki ?? []).flat().length + (s.kakan ? 1 : 0);

/** 三人打ちを BOT で最後まで（人は時間切れ → おまかせ） */
function playOut(seed: number, length: 'tonpu' | 'hanchan', entry = 100) {
  let now = 1_000_000;
  const rng = seeded(seed);
  const ctx = (): Ctx => ({ now, rng, cfg });
  const fxs: Effects[] = [];
  const take = (r: Step<MjState> | null) => {
    if (!r) return null;
    if (!r.ok) throw new Error(r.error);
    if (r.fx) fxs.push(r.fx);
    return r.state;
  };
  let s = take(mahjong.create(HOST, { entry: String(entry), length, players: '3' }, ctx()))!;
  s = take(mahjong.act(s, HOST.id, { action: 'start' }, ctx()))!;
  expect(s.seats).toHaveLength(3);
  expect(s.hands.map((h) => h.length).sort()).toEqual([13, 13, 14]);
  const hands: string[] = [];
  let kitas = 0;
  let chiOffered = false;
  let steps = 0;
  while (s.phase !== 'closed' && steps < 20000) {
    steps++;
    if (s.phase === 'playing') {
      // 108 枚のまま・二萬〜八萬はない・王牌は 14 枚
      expect(tileCount(s)).toBe(108);
      expect(s.dead).toHaveLength(14);
      expect([...s.wall, ...s.dead, ...s.hands.flat()].some((t) => isSanmaCut(kindOf(t)))).toBe(false);
      if (s.options.some((o) => o?.some((c) => c.type === 'chi'))) chiOffered = true;
    }
    if (s.phase === 'result' && s.result && hands.at(-1) !== `${s.wind}-${s.kyoku}-${s.honba}`) hands.push(`${s.wind}-${s.kyoku}-${s.honba}`);
    const due = mahjong.due(s);
    if (due === null) break;
    now = Math.max(now, due);
    const before = s.fxN ?? 0;
    const next = take(mahjong.tick(s, ctx()));
    if (next) {
      kitas += (next.fx ?? []).filter((e) => e.n > before && e.k === 'kita').length;
      s = next;
    }
  }
  return { s, fxs, hands, kitas, chiOffered };
}

describe('🀄 三人打ち（BOT で最後まで）', () => {
  it('東風戦が終わり、点数の合計は 35,000 × 3 のまま。参加費は 1 位 60%・2 位 40%', () => {
    let kitas = 0;
    for (const seed of [1, 2, 3, 4]) {
      const r = playOut(seed, 'tonpu');
      expect(r.s.phase).toBe('closed');
      expect(r.chiOffered).toBe(false);
      expect(r.hands.length).toBeGreaterThanOrEqual(3);
      expect(r.s.payouts.map((p) => p.points).reduce((a, b) => a + b, 0)).toBe(SANMA_START_POINTS * 3);
      expect(r.s.payouts.map((p) => p.amount)).toEqual([180, 120, 0]);
      const pts = r.s.payouts.map((p) => p.points);
      expect([...pts].sort((a, b) => b - a)).toEqual(pts);
      const rows = r.fxs.flatMap((f) => f.mahjong ?? []);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ memberId: HOST.id, players: 3 });
      expect(rows[0]!.rank).toBeLessThanOrEqual(3);
      kitas += r.kitas;
    }
    // BOT は北を抜く
    expect(kitas).toBeGreaterThan(0);
  });

  it('半荘戦も終わる', () => {
    const { s, hands } = playOut(9, 'hanchan', 0);
    expect(s.phase).toBe('closed');
    expect(hands.length).toBeGreaterThanOrEqual(6);
  });

  it('4 人打ちの卓は今までどおり（n なし・4 席）', () => {
    const r = mahjong.create(HOST, { entry: '100', length: 'tonpu' }, { now: 1, rng: seeded(1), cfg });
    expect(r.ok && r.state.n).toBeUndefined();
  });
});

describe('🀄 三人打ちの操作', () => {
  function started(seed = 5) {
    let now = 2_000_000;
    const rng = seeded(seed);
    const ctx = (): Ctx => ({ now, rng, cfg });
    const step = (r: Step<MjState> | null) => {
      if (!r || !r.ok) throw new Error(r ? r.error : 'null');
      return r;
    };
    let s = step(mahjong.create(HOST, { entry: '100', length: 'tonpu', players: '3' }, ctx())).state;
    // 3 人で満席
    expect(mahjong.join(s, { id: '700000000000000002', name: 'b' }, {}, ctx()).ok).toBe(true);
    s = step(mahjong.act(s, HOST.id, { action: 'start' }, ctx())).state;
    return { s, ctx, step, h: s.seats.findIndex((x) => x.id === HOST.id) };
  }

  it('始めると BOT 2 人が入り、満席にはもう座れない', () => {
    const { s, ctx } = started();
    expect(s.seats).toHaveLength(3);
    expect(s.seats.every((x) => x.points === SANMA_START_POINTS)).toBe(true);
    const full = { ...s, phase: 'lobby' as const };
    expect(mahjong.join(full, { id: '700000000000000009', name: 'z' }, {}, ctx()).ok).toBe(false);
  });

  it('北抜き: 北を横に抜いて 1 枚補充（手は 14 枚のまま・山が 1 枚減る）', () => {
    const { s: s0, ctx, step, h } = started();
    const s = structuredClone(s0);
    // 親（ツモ番）を自分にして、手に北を入れる
    s.kyoku = h;
    s.turn = h;
    s.step = 'turn';
    const north = SANMA_TILES.find((t) => kindOf(t) === NORTH && !s.hands.flat().includes(t))!;
    s.wall = s.wall.filter((t) => t !== north);
    s.dead = s.dead.map((t) => (t === north ? s.wall.shift()! : t));
    s.hands[h] = [...s.hands[h]!.slice(0, 13), north];
    s.drawn = north;
    s.options = [null, null, null];
    s.responses = [null, null, null];
    expect(canKita(s, h)).toBe(true);
    const wall = s.wall.length;
    const r = step(mahjong.act(s, HOST.id, { action: 'kita' }, ctx())).state;
    expect(r.nuki![h]).toEqual([north]);
    expect(r.hands[h]).toHaveLength(14);
    expect(r.hands[h]).not.toContain(north);
    expect(r.wall.length).toBe(wall - 1);
    expect(r.dead).toHaveLength(14);
    expect(r.turn).toBe(h);
    expect(r.rinshan).toBe(true);
    // 北単騎で待っている人は、抜いた北でロンできる（その北は抜きドラから外れる）
    const w = s.seats.findIndex((x) => x.bot);
    const s2 = structuredClone(s);
    s2.hands[w] = tiles('111m999m111p999p4z').map((x) => (kindOf(x) === NORTH ? north + 1 : x));
    s2.rivers = [[], [], []];
    const ron = step(mahjong.act(s2, HOST.id, { action: 'kita' }, ctx())).state;
    expect(ron.phase).toBe('result');
    expect(ron.result).toMatchObject({ kind: 'ron', winner: w, from: h, winTile: north });
    expect(ron.nuki![h]).toEqual([]);
    // 4 人打ちでは北抜きできない
    expect(canKita({ ...s, n: undefined, options: [null, null, null, null] }, h)).toBe(false);
  });
});

/** "123m" → 牌の番号 */
const tiles = (spec: string): number[] => {
  const used = new Map<number, number>();
  const out: number[] = [];
  for (const m of spec.matchAll(/(\d+)([mpsz])/g)) {
    const base = { m: 0, p: 9, s: 18, z: 27 }[m[2] as 'm' | 'p' | 's' | 'z'];
    for (const ch of m[1]!) {
      const k = base + Number(ch) - 1;
      const copy = used.get(k) ?? (k < 27 && k % 9 === 4 ? 1 : 0);
      used.set(k, copy + 1);
      out.push(k * 4 + copy);
    }
  }
  return out;
};

describe('🀄 三人打ちの点数', () => {
  // 一萬が 3 枚・99 萬の雀頭・筒子と索子の順子（役は自摸と白）
  const base = (o: Partial<WinInput> = {}): WinInput => {
    const hand = tiles('111m99m123p456s555z');
    return { hand, melds: [], winTile: hand[0]!, ron: false, seatWind: EAST + 1, roundWind: EAST, dealer: false, doraIndicators: [], uraIndicators: [], players: 3, ...o };
  };

  it('ツモ損: 子のツモは親と子の 2 人だけが払う', () => {
    const four = scoreWin({ ...base(), players: 4 })!;
    const three = scoreWin(base())!;
    expect(three.tsumoDealer).toBe(four.tsumoDealer);
    expect(three.tsumoOther).toBe(four.tsumoOther);
    expect(three.total).toBe(four.total - four.tsumoOther);
    const dealer = scoreWin(base({ dealer: true, seatWind: EAST }))!;
    expect(dealer.total).toBe(dealer.tsumoOther * 2);
  });

  it('一萬のドラ表示は九萬・抜いた北は 1 枚 1 翻（西が表示なら北もドラ）', () => {
    expect(doraOf(0, true)).toBe(8);
    expect(doraOf(8, true)).toBe(0);
    expect(doraOf(0)).toBe(1);
    const dora = scoreWin(base({ doraIndicators: tiles('1m') }))!;
    expect(dora.yaku.find((y) => y.name === 'ドラ')?.han).toBe(2);
    const nuki = tiles('44z');
    const n = scoreWin(base({ nuki }))!;
    expect(n.yaku.find((y) => y.name === '抜きドラ')?.han).toBe(2);
    const west = scoreWin(base({ nuki, doraIndicators: tiles('3z') }))!;
    expect(west.yaku.find((y) => y.name === 'ドラ')?.han).toBe(2);
    // 役がなければ抜きドラだけでは和了れない
    const noYaku = tiles('111m99m123p456s789s');
    expect(scoreWin(base({ hand: noYaku, winTile: noYaku[0]!, ron: true, nuki }))).toBeNull();
  });
});

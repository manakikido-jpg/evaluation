import { describe, expect, it } from 'vitest';
import type { Rng } from '../src/services/casino/cards.js';
import { mahjong, START_POINTS, type MjState } from '../src/services/casino/tables/mahjong.js';
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

/** 時間を進めて最後まで（人は時間切れ → おまかせ） */
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
  let s = take(mahjong.create(HOST, { entry: String(entry), length }, ctx()))!;
  s = take(mahjong.act(s, HOST.id, { action: 'start' }, ctx()))!;
  expect(s.seats).toHaveLength(4);
  expect(s.hands.map((h) => h.length).sort()).toEqual([13, 13, 13, 14]);
  const hands: string[] = [];
  let steps = 0;
  while (s.phase !== 'closed' && steps < 20000) {
    steps++;
    // 王牌 14 枚・牌の数は 136 枚のまま
    if (s.phase === 'playing') {
      const total = s.wall.length + s.dead.length + s.hands.flat().length + s.rivers.flat().filter((r) => !r.called).length + s.melds.flat().flatMap((m) => m.tiles).length + (s.kakan ? 1 : 0);
      expect(total).toBe(136);
      expect(new Set([...s.wall, ...s.dead, ...s.hands.flat()]).size).toBe(s.wall.length + s.dead.length + s.hands.flat().length);
    }
    if (s.phase === 'result' && s.result && hands.at(-1) !== `${s.wind}-${s.kyoku}-${s.honba}`) hands.push(`${s.wind}-${s.kyoku}-${s.honba}`);
    const due = mahjong.due(s);
    if (due === null) break;
    now = Math.max(now, due);
    const next = take(mahjong.tick(s, ctx()));
    if (next) s = next;
  }
  return { s, fxs, steps, hands };
}

describe('🀄 麻雀の卓（BOT で最後まで）', () => {
  it('東風戦が終わり、点数の合計は変わらず、参加費を順位で配る', () => {
    for (const seed of [1, 2, 3]) {
      const { s, fxs, hands } = playOut(seed, 'tonpu');
      expect(s.phase).toBe('closed');
      expect(hands.length).toBeGreaterThanOrEqual(4);
      expect(s.payouts.map((p) => p.points).reduce((a, b) => a + b, 0)).toBe(START_POINTS * 4);
      const paid = fxs.flatMap((f) => f.credits ?? []).filter((c) => c.reason === 'casino_win').reduce((a, c) => a + c.amount, 0);
      expect(paid).toBe(400);
      expect(s.payouts.map((p) => p.amount)).toEqual([200, 120, 80, 0]);
      // 順位は点数の高い順
      const pts = s.payouts.map((p) => p.points);
      expect([...pts].sort((a, b) => b - a)).toEqual(pts);
    }
  });

  it('半荘戦も終わる', () => {
    const { s, hands } = playOut(9, 'hanchan', 0);
    expect(s.phase).toBe('closed');
    expect(hands.length).toBeGreaterThanOrEqual(8);
  });
});

/** "123m" → 牌の番号（種類ごとに使っていない番号から） */
function maker() {
  const used = new Map<number, number>();
  return (spec: string): number[] => {
    const out: number[] = [];
    for (const m of spec.matchAll(/(\d+)([mpsz])/g)) {
      const base = { m: 0, p: 9, s: 18, z: 27 }[m[2] as 'm' | 'p' | 's' | 'z'];
      for (const ch of m[1]!) {
        const k = base + Number(ch) - 1;
        // 赤 5（copy 0）は使わない
        const copy = used.get(k) ?? (k < 27 && k % 9 === 4 ? 1 : 0);
        used.set(k, copy + 1);
        out.push(k * 4 + copy);
      }
    }
    return out;
  };
}

function started(seed = 5) {
  let now = 2_000_000;
  const rng = seeded(seed);
  const ctx = (): Ctx => ({ now, rng, cfg });
  const step = (r: Step<MjState> | null) => {
    if (!r || !r.ok) throw new Error(r ? r.error : 'null');
    return r;
  };
  let s = step(mahjong.create(HOST, { entry: '100', length: 'tonpu' }, ctx())).state;
  s = step(mahjong.act(s, HOST.id, { action: 'start' }, ctx())).state;
  return { s, ctx, step, h: s.seats.findIndex((x) => x.id === HOST.id), advance: (ms: number) => (now += ms) };
}

describe('🀄 麻雀の卓（操作）', () => {
  it('卓を立てると参加費を預かる。始めると空いた席に BOT（参加費は胴元・上限に数えない）', () => {
    let now = 1;
    const ctx = (): Ctx => ({ now, rng: seeded(1), cfg });
    const c = mahjong.create(HOST, { entry: '100', length: 'hanchan' }, ctx());
    if (!c.ok) throw new Error(c.error);
    expect(c.fx?.debits).toEqual([{ memberId: HOST.id, amount: 100, reason: 'casino_bet', limited: true }]);
    expect(c.state.length).toBe('hanchan');
    const j = mahjong.join(c.state, { id: '700000000000000002', name: 'b' }, {}, ctx());
    if (!j.ok) throw new Error(j.error);
    expect(mahjong.act(j.state, '700000000000000002', { action: 'start' }, ctx()).ok).toBe(false);
    const st = mahjong.act(j.state, HOST.id, { action: 'start' }, ctx());
    if (!st.ok) throw new Error(st.error);
    expect(st.fx?.debits?.map((d) => [d.memberId.startsWith('bot:'), d.limited])).toEqual([
      [true, false],
      [true, false],
    ]);
    expect(st.state.phase).toBe('playing');
    expect(mahjong.seats(st.state).sort()).toEqual([HOST.id, '700000000000000002'].sort());
    // 相手待ちで抜けると返す
    const l = mahjong.leave(j.state, '700000000000000002', ctx());
    expect(l.ok && l.fx?.credits).toEqual([{ memberId: '700000000000000002', amount: 100, reason: 'casino_refund' }]);
    now += 31 * 60_000;
    const closed = mahjong.tick(c.state, ctx());
    expect(closed?.ok && closed.state.phase).toBe('closed');
  });

  it('賭けない卓（立てる人が選ぶ・運営が賭けなしにしている）は参加費 0。終わっても銭は動かない', () => {
    const ctx = (c = cfg): Ctx => ({ now: 1, rng: seeded(2), cfg: c });
    const off = mahjong.create(HOST, { wager: 'off', entry: '500', length: 'tonpu' }, ctx());
    expect(off.ok && [off.state.entry, off.fx]).toEqual([0, undefined]);
    const noBets = mahjong.create(HOST, { wager: 'on', entry: '500' }, ctx({ ...cfg, casino: { ...cfg.casino, mahjongBets: false } }));
    expect(noBets.ok && [noBets.state.entry, noBets.fx]).toEqual([0, undefined]);
    const on = mahjong.create(HOST, { wager: 'on', entry: '100' }, ctx());
    expect(on.ok && on.state.entry).toBe(100);
    const { fxs } = playOut(4, 'tonpu', 0);
    expect(fxs.flatMap((f) => [...(f.debits ?? []), ...(f.credits ?? [])])).toEqual([]);
  });

  it('人の捨て牌で BOT がロンすると、点数が動いて結果になる（本場・供託も）', () => {
    const { s: s0, ctx, step, h } = started();
    const s = structuredClone(s0);
    const t = maker();
    const ronner = (h + 1) % 4;
    s.turn = h;
    s.step = 'turn';
    s.kyoku = (h + 2) % 4;
    s.honba = 1;
    s.sticks = 1;
    const [x] = t('6p');
    s.hands[h] = [...t('19m19p19s1234z56z'), x!];
    s.drawn = x!;
    s.hands[ronner] = t('234m456m78p234s55s');
    for (const j of [(h + 2) % 4, (h + 3) % 4]) s.hands[j] = t('19m19p19s1234567z').slice(0, 13);
    s.rivers = [[], [], [], []];
    s.melds = [[], [], [], []];
    s.riichi = [false, false, false, false];
    s.tempFuriten = [false, false, false, false];
    s.wall = s.wall.slice(0, 40);
    const r = step(mahjong.act(s, HOST.id, { action: 'discard', tile: String(x) }, ctx())).state;
    expect(r.phase).toBe('result');
    expect(r.result?.kind).toBe('ron');
    expect(r.result?.winner).toBe(ronner);
    expect(r.result?.score?.yaku.map((y) => y.name)).toContain('断么九');
    // 出した人が払う。本場 300・供託 1000 は和了った人へ
    const pay = r.result!.score!.ron + 300;
    expect(r.result!.deltas[h]).toBe(-pay);
    expect(r.result!.deltas[ronner]).toBe(pay + 1000);
    expect(r.sticks).toBe(0);
  });

  it('リーチ: テンパイの切り方だけ。通ると 1,000 点と供託 1 本', () => {
    const { s: s0, ctx, step, h } = started();
    const s = structuredClone(s0);
    const t = maker();
    s.turn = h;
    s.step = 'turn';
    const hand = t('123m456p789s11z22z');
    const [x] = t('7z');
    s.hands[h] = [...hand, x!];
    s.drawn = x!;
    for (const j of [1, 2, 3].map((d) => (h + d) % 4)) s.hands[j] = t('1m1m9p9p').concat(t('2s3s4s5s6s7s8s9s9s'));
    s.rivers = [[], [], [], []];
    s.melds = [[], [], [], []];
    s.riichi = [false, false, false, false];
    s.wall = s.wall.slice(0, 40);
    // 1z を切るとテンパイでない
    expect(mahjong.act(s, HOST.id, { action: 'discard', tile: String(hand[9]!), riichi: '1' }, ctx()).ok).toBe(false);
    const r = step(mahjong.act(s, HOST.id, { action: 'discard', tile: String(x), riichi: '1' }, ctx())).state;
    expect(r.riichi[h]).toBe(true);
    expect(r.seats[h]!.points).toBe(24_000);
    expect(r.sticks).toBe(1);
    expect(r.rivers[h]!.at(-1)).toMatchObject({ t: x, riichi: true });
  });

  it('遊んでいる途中で人がみんな抜けたら、いまの点数で終わって配る', () => {
    const { s, ctx, step, h } = started();
    const r = step(mahjong.leave(s, HOST.id, ctx()));
    expect(r.state.phase).toBe('done');
    expect(r.state.payouts.map((p) => p.amount).reduce((a, b) => a + b, 0)).toBe(400);
    expect(r.state.seats[h]!.gone).toBe(true);
  });

  it('便利ボタン: 鳴きなしはポンを聞かない・自動和了はロンする・ツモ切りはすぐ切る', () => {
    const { s: s0, ctx, step, h } = started();
    const t = maker();
    const base = () => {
      const s = structuredClone(s0);
      s.rivers = [[], [], [], []];
      s.melds = [[], [], [], []];
      s.riichi = [false, false, false, false];
      s.tempFuriten = [false, false, false, false];
      s.wall = s.wall.slice(0, 40);
      return s;
    };
    // 鳴きなし: 人がポンできる牌を BOT が切っても、聞かずに次へ
    let s = base();
    const from = (h + 3) % 4;
    const [x] = t('5z');
    s.hands[h] = t('55z123m456p789s1z');
    s.hands[from] = [...t('19m19p19s1234z6z7z'), x!];
    s.turn = from;
    s.step = 'turn';
    s.drawn = x!;
    s = step(mahjong.act(s, HOST.id, { action: 'pref', key: 'noCall', on: '1' }, ctx())).state;
    expect(s.seats[h]!.prefs).toEqual({ noCall: true });
    // 上家（BOT の席）に白を切らせる → 聞かずに次の人のツモへ
    const next = step(mahjong.act(s, s.seats[from]!.id, { action: 'discard', tile: String(x) }, ctx())).state;
    expect(next.step).toBe('turn');
    expect(next.turn).toBe(h);
    expect(next.melds[h]).toEqual([]);
    // 自動和了: ロンできるときは聞かずにロン
    s = base();
    const [y] = t('6p');
    s.hands[h] = t('234m456m78p234s55s');
    s.seats[h]!.prefs = { autoWin: true };
    const disc = (h + 3) % 4;
    s.hands[disc] = [...t('19m19p19s1234z56z'), y!];
    s.turn = disc;
    s.step = 'turn';
    s.drawn = y!;
    const r = step(mahjong.act(s, s.seats[disc]!.id, { action: 'discard', tile: String(y) }, ctx())).state;
    expect(r.phase).toBe('result');
    expect(r.result?.winner).toBe(h);
    // ツモ切り: 自分の番の持ち時間が短くなり、時間で引いた牌を切る（時間切れに数えない）
    s = base();
    s.turn = h;
    s.step = 'turn';
    s.hands[h] = t('19m19p19s1234z56z7z');
    s.drawn = s.hands[h]!.at(-1)!;
    const before = step(mahjong.act(s, HOST.id, { action: 'pref', key: 'tsumogiri', on: '1' }, ctx())).state;
    expect(before.deadline! - 2_000_000).toBeLessThan(2000);
    const after = step(mahjong.tick({ ...before, deadline: 0 }, ctx())).state;
    expect(after.rivers[h]!.at(-1)).toMatchObject({ t: s.drawn, tsumogiri: true });
    expect(after.seats[h]!.timeouts).toBe(0);
  });

  it('時間切れはツモ切り。2 回続くとおまかせ（BOT が打つ）、自分で押すと戻る', () => {
    const { s: s0, ctx, step, h, advance } = started(8);
    let s = s0;
    let timeouts = 0;
    for (let n = 0; n < 400 && timeouts < 2; n++) {
      const humanTurn = s.phase === 'playing' && s.step === 'turn' && s.turn === h;
      advance(Math.max(0, (s.deadline ?? 0) - 2_000_000) + 60_000);
      const before = s.rivers[h]?.length ?? 0;
      const r = mahjong.tick(s, ctx());
      if (!r) continue;
      if (!r.ok) throw new Error(r.error);
      if (humanTurn && r.state.rivers[h]!.length > before) timeouts++;
      s = r.state;
      if (s.phase !== 'playing') break;
    }
    if (s.phase === 'playing') {
      expect(s.seats[h]!.auto).toBe(true);
      const r = step(mahjong.act(s, HOST.id, { action: 'resume' }, ctx())).state;
      expect(r.seats[h]!.auto).toBe(false);
    }
  });
});

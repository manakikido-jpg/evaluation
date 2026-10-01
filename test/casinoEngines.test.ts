import { describe, expect, it } from 'vitest';
import { bacDeal, bacPayout, bacTotal, bankerDraws } from '../src/services/casino/baccarat.js';
import { bjDouble, bjHit, bjPayout, bjStand, bjStart, bjView, handValue, type BjState } from '../src/services/casino/blackjack.js';
import { cardText, cryptoRng, rankOf, shuffledShoe, type Rng } from '../src/services/casino/cards.js';
import { HL_MAX_STEPS, hlCashout, hlGuess, hlNextMult, hlPayout, hlStart, hlWays } from '../src/services/casino/highlow.js';
import { applyMove, countStones, cpuMove, flipsFor, initialBoard, legalMoves, nextTurn, othelloPlay, winnerOf } from '../src/services/casino/othello.js';
import { isRouletteBet, parseStakes, rouletteMultiplier, stakePayout } from '../src/services/casino/roulette.js';
import { slotMultiplier, slotRtp, spinReel } from '../src/services/casino/slots.js';

/** 決めた数を順に返す乱数 */
const seq = (xs: number[]): Rng => {
  let i = 0;
  return (n) => xs[i++ % xs.length]! % n;
};
/** 再現できる乱数 */
const seeded = (seed: number): Rng => {
  let x = seed;
  return (n) => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x % n;
  };
};
/** カード（数字 r・マーク s） */
const C = (r: number, s = 0) => s * 13 + r - 1;

describe('🂠 トランプ', () => {
  it('カードの数字・名前、山札は全部そろう', () => {
    expect(rankOf(C(1))).toBe(1);
    expect(cardText(C(12, 1))).toBe('♥Q');
    const shoe = shuffledShoe(6, cryptoRng);
    expect(shoe).toHaveLength(312);
    expect([...shoe].sort((a, b) => a - b)).toEqual(Array.from({ length: 312 }, (_, i) => i % 52).sort((a, b) => a - b));
  });
});

describe('🃏 ブラックジャック', () => {
  const st = (player: number[], dealer: number[], deck: number[]): BjState => ({ player, dealer, deck, doubled: false, phase: 'player' });

  it('A は 11 か 1', () => {
    expect(handValue([C(1), C(13)])).toEqual({ total: 21, soft: true });
    expect(handValue([C(1), C(9), C(5)])).toEqual({ total: 15, soft: false });
    expect(handValue([C(1), C(1), C(9)])).toEqual({ total: 21, soft: true });
  });

  it('引いて 21 を超えたら負け。止まればディーラーが 17 まで引く', () => {
    expect(bjHit(st([C(10), C(6)], [C(10), C(7)], [C(9)])).result).toBe('bust');
    // ディーラー 16 → 引いて 6 で 22 → 勝ち
    const s = bjStand(st([C(10), C(8)], [C(10), C(6)], [C(6)]));
    expect(s).toMatchObject({ phase: 'done', result: 'win' });
    expect(bjStand(st([C(10), C(7)], [C(10), C(7)], [])).result).toBe('push');
    expect(bjStand(st([C(10), C(6)], [C(10), C(8)], [])).result).toBe('lose');
  });

  it('ダブルダウンは 1 枚だけ引いて終わり。遊んでいる間はディーラーの 2 枚目を見せない', () => {
    const s = st([C(5), C(6)], [C(10), C(7)], [C(10)]);
    expect(bjView(s).dealer).toEqual([C(10)]);
    expect(bjView(s).canDouble).toBe(true);
    const d = bjDouble(s);
    expect(d).toMatchObject({ doubled: true, phase: 'done', result: 'win' });
    expect(d.player).toHaveLength(3);
    expect(bjView(d).dealer).toHaveLength(2);
  });

  it('配当: ブラックジャック 2.5 倍・勝ち 2 倍・引き分けは戻る', () => {
    expect(bjPayout('blackjack', 100)).toBe(250);
    expect(bjPayout('win', 100)).toBe(200);
    expect(bjPayout('push', 100)).toBe(100);
    expect(bjPayout('lose', 100)).toBe(0);
    expect(bjPayout('dealer_blackjack', 100)).toBe(0);
  });

  it('最初の 2 枚でブラックジャックなら、すぐ終わる', () => {
    // 山札の最後から配る: 人 → ディーラー → 人 → ディーラー
    for (let i = 0; i < 50; i++) {
      const s = bjStart(seeded(i));
      if (handValue(s.player).total === 21 || handValue(s.dealer).total === 21) expect(s.phase).toBe('done');
      else expect(s.phase).toBe('player');
    }
  });
});

describe('🔼 ハイ＆ロー', () => {
  it('当たる確率に合わせて倍率が上がる（期待値は 0.95）', () => {
    expect(hlWays(C(1), 'low')).toBe(0);
    expect(hlWays(C(7), 'high')).toBe(6);
    expect(hlNextMult(1000, C(7), 'high')).toBe(Math.floor((1000 * 0.95 * 13) / 6));
    for (let r = 1; r <= 13; r++) {
      for (const g of ['high', 'low'] as const) {
        const w = hlWays(C(r), g);
        if (w) expect(((w / 13) * hlNextMult(1000, C(r), g)) / 1000).toBeLessThanOrEqual(0.95);
      }
    }
  });

  it('当てたら続けられる・降りたら受け取れる。外れたら 0。同じ数字は負け', () => {
    const s = { ...hlStart(seq([0])), current: C(5) };
    const won = hlGuess(s, 'high', seq([C(9)]));
    expect(won).toMatchObject({ steps: 1, phase: 'playing', current: C(9) });
    const out = hlCashout(won);
    expect(hlPayout(out, 100)).toBe(Math.floor((100 * won.mult) / 1000));
    expect(hlGuess(won, 'high', seq([C(9, 2)]))).toMatchObject({ phase: 'done', result: 'lose' });
    expect(hlCashout(s)).toBe(s);
    // 置けない予想は何もしない
    expect(hlGuess({ ...s, current: C(1) }, 'low', seq([0]))).toMatchObject({ current: C(1), steps: 0 });
  });

  it('回数の上限で自動で受け取る', () => {
    let s = { ...hlStart(seq([0])), current: C(1) };
    // A → K → A … と当て続ける
    for (let i = 0; i < HL_MAX_STEPS + 2 && s.phase === 'playing'; i++) s = rankOf(s.current) === 1 ? hlGuess(s, 'high', seq([C(13)])) : hlGuess(s, 'low', seq([C(1)]));
    expect(s.phase).toBe('done');
    expect(s.result).toBe('cashout');
  });
});

describe('🎴 バカラ', () => {
  it('10・絵札は 0。合計は 1 の位', () => {
    expect(bacTotal([C(13), C(9)])).toBe(9);
    expect(bacTotal([C(7), C(8)])).toBe(5);
  });

  it('バンカーの 3 枚目の決まり', () => {
    expect(bankerDraws(5, undefined)).toBe(true);
    expect(bankerDraws(6, undefined)).toBe(false);
    expect(bankerDraws(3, C(8))).toBe(false);
    expect(bankerDraws(3, C(9))).toBe(true);
    expect(bankerDraws(6, C(6))).toBe(true);
    expect(bankerDraws(6, C(5))).toBe(false);
    expect(bankerDraws(7, C(6))).toBe(false);
  });

  it('配当: プレイヤー 2 倍・バンカー 1.95 倍・タイ 9 倍（タイなら戻る）', () => {
    const r = (winner: 'player' | 'banker' | 'tie') => ({ player: [], banker: [], playerTotal: 0, bankerTotal: 0, winner });
    expect(bacPayout('player', r('player'), 100)).toBe(200);
    expect(bacPayout('banker', r('banker'), 100)).toBe(195);
    expect(bacPayout('tie', r('tie'), 100)).toBe(900);
    expect(bacPayout('player', r('tie'), 100)).toBe(100);
    expect(bacPayout('banker', r('player'), 100)).toBe(0);
  });

  it('ナチュラル（8・9）なら引かない', () => {
    const r = bacDeal(seq([C(9), C(13), C(2), C(3)]));
    expect(r.player).toHaveLength(2);
    expect(r.banker).toHaveLength(2);
    expect(r.winner).toBe('player');
  });

  it('たくさん配ると、だいたい決まった割合になる', () => {
    const rng = seeded(7);
    const n = { player: 0, banker: 0, tie: 0 };
    for (let i = 0; i < 20000; i++) n[bacDeal(rng).winner]++;
    expect(n.banker / 20000).toBeGreaterThan(0.43);
    expect(n.player / 20000).toBeGreaterThan(0.42);
    expect(n.tie / 20000).toBeLessThan(0.12);
  });
});

describe('🎰 スロット', () => {
  it('払い戻し率はおよそ 95%', () => {
    expect(slotRtp()).toBeGreaterThan(0.93);
    expect(slotRtp()).toBeLessThan(0.97);
  });

  it('そろった・🌸 の数で倍率', () => {
    expect(slotMultiplier(['sakura', 'sakura', 'sakura'])).toBe(777);
    expect(slotMultiplier(['dango', 'dango', 'dango'])).toBe(6);
    expect(slotMultiplier(['sakura', 'fox', 'sakura'])).toBe(15);
    expect(slotMultiplier(['fox', 'sakura', 'dango'])).toBe(1);
    expect(slotMultiplier(['torii', 'torii', 'dango'])).toBe(3);
    expect(slotMultiplier(['dango', 'chime', 'fox'])).toBe(0);
    expect(spinReel(seq([29]))).toBe('sakura');
    expect(spinReel(seq([0]))).toBe('dango');
  });
});

describe('🎡 ルーレット', () => {
  it('賭け方と倍率（0 は数字だけ）', () => {
    expect(isRouletteBet('red')).toBe(true);
    expect(isRouletteBet('n36')).toBe(true);
    expect(isRouletteBet('n37')).toBe(false);
    expect(isRouletteBet('purple')).toBe(false);
    expect(rouletteMultiplier('n17', 17)).toBe(36);
    expect(rouletteMultiplier('red', 1)).toBe(2);
    expect(rouletteMultiplier('black', 1)).toBe(0);
    expect(rouletteMultiplier('even', 0)).toBe(0);
    expect(rouletteMultiplier('n0', 0)).toBe(36);
    expect(rouletteMultiplier('dozen3', 30)).toBe(3);
    expect(rouletteMultiplier('col1', 34)).toBe(3);
    // どの賭け方も期待値は 36/37
    for (const bet of ['red', 'odd', 'low', 'dozen2', 'col3', 'n5'] as const) {
      let ev = 0;
      for (let n = 0; n <= 36; n++) ev += rouletteMultiplier(bet, n) / 37;
      expect(ev).toBeCloseTo(36 / 37);
    }
  });
});

describe('🎡 ルーレット（いくつもの所）', () => {
  it('「red:100,n7:50」を読む。同じ所はまとめる。おかしい・多すぎるものは断る', () => {
    expect(parseStakes('red:100,n7:50,red:20')).toEqual([
      { on: 'red', amount: 120 },
      { on: 'n7', amount: 50 },
    ]);
    expect(parseStakes('')).toBeNull();
    expect(parseStakes('purple:100')).toBeNull();
    expect(parseStakes('red:-1')).toBeNull();
    expect(parseStakes(Array.from({ length: 11 }, (_, i) => `n${i}:10`).join(','))).toBeNull();
    expect(stakePayout({ on: 'n7', amount: 50 }, 7)).toBe(1800);
    expect(stakePayout({ on: 'red', amount: 100 }, 7)).toBe(200);
  });
});

describe('⚫ オセロ', () => {
  it('はじめは黒が 4 か所に置ける', () => {
    const b = initialBoard();
    expect(countStones(b)).toEqual({ B: 2, W: 2 });
    expect(legalMoves(b, 'B').sort((x, y) => x - y)).toEqual([19, 26, 37, 44]);
    expect(flipsFor(b, 'B', 19)).toEqual([27]);
    expect(flipsFor(b, 'B', 0)).toEqual([]);
    const after = applyMove(b, 'B', 19)!;
    expect(countStones(after)).toEqual({ B: 4, W: 1 });
    expect(nextTurn(after, 'B')).toBe('W');
    expect(applyMove(b, 'B', 0)).toBeUndefined();
  });

  it('CPU は置ける手を選ぶ。最後まで打つと勝ち負けが決まる', () => {
    for (const level of ['easy', 'normal', 'hard'] as const) {
      const rng = seeded(level.length);
      let s = { board: initialBoard(), turn: 'B' as 'B' | 'W' | null, you: 'B' as const, level };
      let guard = 0;
      while (s.turn && guard++ < 70) {
        const moves = legalMoves(s.board, 'B');
        const next = othelloPlay(s, 'B', moves[rng(moves.length)]!, rng);
        expect(next).toBeDefined();
        s = next as typeof s;
      }
      expect(s.turn).toBeNull();
      const c = countStones(s.board);
      expect(winnerOf(s.board)).toBe(c.B > c.W ? 'B' : c.W > c.B ? 'W' : null);
    }
  });

  it('つよい CPU は角を取れるなら取る', () => {
    // 白が (0,0) に置けば角
    const b = ['.', 'B', 'B', 'W', ...Array(60).fill('.')];
    const board = b.join('');
    expect(legalMoves(board, 'W')).toContain(0);
    expect(cpuMove(board, 'W', 'hard', seeded(1))).toBe(0);
  }, 20_000);

  it('ランダムに打つ相手には、つよい CPU がほとんど勝つ', () => {
    let wins = 0;
    for (let g = 0; g < 6; g++) {
      const rng = seeded(100 + g);
      let s = { board: initialBoard(), turn: 'B' as 'B' | 'W' | null, you: 'B' as const, level: 'hard' as const };
      while (s.turn) {
        const moves = legalMoves(s.board, 'B');
        s = othelloPlay(s, 'B', moves[rng(moves.length)]!, rng) as typeof s;
      }
      if (winnerOf(s.board) === 'W') wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(5);
  }, 60_000);
});

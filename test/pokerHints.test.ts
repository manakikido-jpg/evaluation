import { describe, expect, it } from 'vitest';
import { pokerAdvice, startingHand } from '../src/services/casino/tables/pokerHints.js';

/** カード（数字 r: 1 = A … 13 = K、マーク s: 0 ♠ 1 ♥ 2 ♦ 3 ♣） */
const C = (r: number, s = 0) => s * 13 + r - 1;
const o = { toCall: 0, pot: 100, bb: 20 };

describe('♠ 今の役とヒント', () => {
  it('配られた 2 枚の強さ', () => {
    expect(startingHand([C(1), C(1, 1)])).toMatchObject({ tier: 'strong', label: 'A のペア' });
    expect(startingHand([C(13), C(1, 2)])).toMatchObject({ tier: 'strong', label: 'A と K' });
    expect(startingHand([C(9), C(8)])).toMatchObject({ tier: 'play', label: '9 と 8・同じマーク' });
    expect(pokerAdvice([C(6), C(5, 1)], [], o)).toMatchObject({ name: '手札', detail: '6 と 5（弱め）' });
    expect(startingHand([C(2), C(7, 1)]).tier).toBe('weak');
    expect(pokerAdvice([C(2), C(7, 1)], [], { toCall: 100, pot: 30, bb: 20 }).tone).toBe('fold');
  });

  it('今の役（くわしく）', () => {
    expect(pokerAdvice([C(13), C(9, 1)], [C(13, 2), C(4, 3), C(7)], o)).toMatchObject({ name: 'ワンペア', detail: 'K のワンペア', category: 1, tone: 'ok', cards: [C(13), C(13, 2)] });
    expect(pokerAdvice([C(5), C(5, 1)], [C(5, 2), C(12, 3), C(12)], o)).toMatchObject({ detail: '5 と Q のフルハウス', tone: 'go' });
    expect(pokerAdvice([C(1), C(2, 1)], [C(3, 2), C(4, 3), C(5), C(9, 1), C(13, 2)], o).detail).toBe('5 までのストレート');
    expect(pokerAdvice([C(1), C(13)], [C(12), C(11), C(10)], o).detail).toBe('ロイヤルストレートフラッシュ！');
    expect(pokerAdvice([C(2), C(3, 1)], [C(9), C(11, 1), C(13, 2)], o)).toMatchObject({ name: 'ハイカード（役なし）', tone: 'care' });
  });

  it('引き（アウツ）と、コールに見合うか', () => {
    // ♠ が 4 枚: フラッシュまであと 1 枚。フロップなので 9 × 4 = 36%
    const fd = pokerAdvice([C(2), C(7)], [C(9), C(13), C(4, 1)], { toCall: 20, pot: 100, bb: 20 });
    expect(fd.draws[0]).toContain('フラッシュまであと 1 枚');
    expect(fd).toMatchObject({ outs: 9, equity: 36, potOdds: 17, tone: 'ok' });
    // 両側のストレート（5-6-7-8）: 8 枚。ターンなら 16%。高すぎるコールはフォールドをすすめる
    const sd = pokerAdvice([C(5), C(6, 1)], [C(7, 2), C(8, 3), C(13), C(2, 1)], { toCall: 300, pot: 100, bb: 20 });
    expect(sd.draws[0]).toContain('両側');
    expect(sd).toMatchObject({ outs: 8, equity: 16, potOdds: 75, tone: 'fold' });
    // 場だけの役
    expect(pokerAdvice([C(2), C(3, 1)], [C(10), C(10, 1), C(12), C(12, 2), C(1, 3)], o).boardOnly).toBe(true);
  });
});

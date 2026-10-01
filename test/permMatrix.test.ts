import { describe, expect, it } from 'vitest';
import { applies, cellOf, MATRIX_PERMS, nextCell, planCells, templateFits, withCells } from '../src/services/permMatrix.js';

const ROLE = '850000000000000001';

describe('🧮 チャンネル権限のマトリクス', () => {
  it('31 項目・番号とビットが重ならない', () => {
    expect(MATRIX_PERMS).toHaveLength(31);
    expect(new Set(MATRIX_PERMS.map((p) => p.no)).size).toBe(31);
    expect(new Set(MATRIX_PERMS.map((p) => p.bit)).size).toBe(31);
  });

  it('マスの読み方・変え方（ほかのビットはそのまま）', () => {
    const o = { allow: String((1n << 10n) | (1n << 15n)), deny: String(1n << 11n) };
    expect(cellOf(o, 10)).toBe('allow');
    expect(cellOf(o, 11)).toBe('deny');
    expect(cellOf(o, 6)).toBe('neutral');
    expect(cellOf(undefined, 10)).toBe('neutral');
    expect(withCells(o, [{ bit: 11, cell: 'allow' }, { bit: 10, cell: 'neutral' }])).toEqual({ allow: String((1n << 11n) | (1n << 15n)), deny: '0' });
    expect([nextCell('neutral'), nextCell('allow'), nextCell('deny')]).toEqual(['allow', 'deny', 'neutral']);
  });

  it('ボイスの権限はテキストのチャンネルにない。テキストの権限は通話のチャットにもある', () => {
    const connect = MATRIX_PERMS.find((p) => p.key === 'Connect')!;
    const send = MATRIX_PERMS.find((p) => p.key === 'SendMessages')!;
    expect(applies(connect, { type: 0 })).toBe(false);
    expect(applies(connect, { type: 2 })).toBe(true);
    expect(applies(connect, { type: 4 })).toBe(true);
    expect(applies(send, { type: 2 })).toBe(true);
  });

  it('上書きの変え方: 付ける・全部中立なら消す・変わらなければ何もしない', () => {
    const ch = { type: 0, permission_overwrites: [{ id: ROLE, type: 0 as const, allow: String(1n << 10n), deny: '0' }] };
    expect(planCells(ch, ROLE, [{ bit: 11, cell: 'deny' }])).toEqual({ set: { id: ROLE, type: 0, allow: String(1n << 10n), deny: String(1n << 11n) } });
    expect(planCells(ch, ROLE, [{ bit: 10, cell: 'neutral' }])).toEqual({ del: ROLE });
    expect(planCells(ch, ROLE, [{ bit: 10, cell: 'allow' }])).toBeNull();
    // テキストにないボイスの権限だけなら何もしない
    expect(planCells(ch, ROLE, [{ bit: 20, cell: 'deny' }])).toBeNull();
    expect(planCells({ type: 0, permission_overwrites: [] }, ROLE, [{ bit: 10, cell: 'neutral' }])).toBeNull();
  });

  it('テンプレートの種類に合うチャンネル（カテゴリにはいつも当てられる）', () => {
    expect(templateFits({ target: 'text' }, { type: 0 })).toBe(true);
    expect(templateFits({ target: 'text' }, { type: 2 })).toBe(false);
    expect(templateFits({ target: 'voice' }, { type: 4 })).toBe(true);
    expect(templateFits({ target: 'all' }, { type: 2 })).toBe(true);
  });
});

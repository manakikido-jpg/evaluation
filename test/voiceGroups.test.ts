import { describe, expect, it } from 'vitest';
import { groupMembers, planGroup, renumber, type GroupChannel } from '../src/services/voiceGroups.js';

const G = { name: '大きな縁側', min: 3, max: 20 };
const ch = (id: string, name: string, members: number, position = Number(id)): GroupChannel => ({ id, name, position, members });

describe('自動で増える通話', () => {
  it('名前の後ろの番号で仲間を見つける（飾り・全角数字も）。ほかの名前は入れない', () => {
    const list = [ch('1', '🍵｜大きな縁側 1', 0), ch('2', '大きな縁側２', 0), ch('3', '小さな縁側 1', 0), ch('4', '大きな縁側', 0), ch('5', '大きな縁側 10', 0)];
    expect(groupMembers(list, G).map((c) => [c.id, c.num])).toEqual([
      ['1', 1],
      ['2', 2],
      ['5', 10],
    ]);
  });

  it('番号だけ変える（全角は全角のまま）', () => {
    expect(renumber('🍵｜大きな縁側 3', 4)).toBe('🍵｜大きな縁側 4');
    expect(renumber('大きな縁側３', 4)).toBe('大きな縁側４');
    expect(renumber('大きな縁側 9', 10)).toBe('大きな縁側 10');
  });

  it('3 つとも埋まったら 4 を 3 の下に作る。空きがあれば作らない。最大なら作らない', () => {
    const full = [ch('1', '大きな縁側 1', 2), ch('2', '大きな縁側 2', 1), ch('3', '大きな縁側 3', 4)];
    expect(planGroup(full, G)).toEqual({ create: { name: '大きな縁側 4', afterId: '3' }, remove: [] });
    expect(planGroup([...full.slice(0, 2), ch('3', '大きな縁側 3', 0)], G)).toEqual({ remove: [] });
    expect(planGroup(full, { ...G, max: 3 })).toEqual({ remove: [] });
  });

  it('空きが 2 つ以上なら、3 より大きい番号の空きを大きい番号から消す（空きは 1 つ残す・3 つより減らさない）', () => {
    const list = [ch('1', '大きな縁側 1', 1), ch('2', '大きな縁側 2', 1), ch('3', '大きな縁側 3', 0), ch('4', '大きな縁側 4', 0), ch('5', '大きな縁側 5', 0)];
    expect(planGroup(list, G)).toEqual({ remove: ['5', '4'] });
    // 4 に人がいれば、5 だけ
    expect(planGroup([...list.slice(0, 3), ch('4', '大きな縁側 4', 2), list[4]!], G)).toEqual({ remove: ['5'] });
    // 全部空いていても 3 つは残す
    expect(planGroup([ch('1', '大きな縁側 1', 0), ch('2', '大きな縁側 2', 0), ch('3', '大きな縁側 3', 0)], G)).toEqual({ remove: [] });
  });

  it('3 つに足りなければ作る', () => {
    expect(planGroup([ch('1', '大きな縁側 1', 0)], G)).toEqual({ create: { name: '大きな縁側 2', afterId: '1' }, remove: [] });
    expect(planGroup([], G)).toEqual({ remove: [] });
  });
});

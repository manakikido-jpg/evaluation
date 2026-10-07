import { describe, expect, it } from 'vitest';
import { inviteSort, inviteOrder, sortInviteRows } from '../src/services/inviteList.js';
import type { InviteRewardRow } from '../src/services/invites.js';
import { cfg, ROLE } from './helpers.js';
const row = (id: string, patch: Partial<InviteRewardRow> = {}): InviteRewardRow => ({ memberId: id, inviterId: null, roleIds: [], leftAt: null, source: null, createdAt: new Date('2026-10-08'), joinedAt: null, rewardedAt: null, reward: 0, ujikoRewardedAt: null, ujikoReward: 0, legacyReward: false, ...patch });
const names: Record<string, string> = { a: 'あおい', b: 'さくら', c: 'なつ', x: 'いろは', y: 'ほたる' };
const name = (id: string) => names[id] ?? id;
const ids = (rows: InviteRewardRow[]) => rows.map(r => r.memberId);
describe('招待一覧の並び替え', () => {
  it('名前と招待した人を日本語順で並べ、不明な招待元は両方向で最後', () => {
    const rows = [row('c', { inviterId: 'x' }), row('b'), row('a', { inviterId: 'y' })];
    expect(ids(sortInviteRows(rows, 'member', 'asc', cfg, name))).toEqual(['a', 'b', 'c']);
    expect(ids(sortInviteRows(rows, 'member', 'desc', cfg, name))).toEqual(['c', 'b', 'a']);
    expect(ids(sortInviteRows(rows, 'inviter', 'asc', cfg, name))).toEqual(['c', 'a', 'b']);
    expect(ids(sortInviteRows(rows, 'inviter', 'desc', cfg, name))).toEqual(['a', 'c', 'b']);
    expect(ids(rows)).toEqual(['c', 'b', 'a']);
  });
  it('役職と合計支払額を数値で比べる。案内待ちは両方向で最後', () => {
    const rows = [row('c'), row('b', { roleIds: [ROLE.ujiko], reward: 150, ujikoReward: 350 }), row('a', { roleIds: [ROLE.sanpaisha], reward: 150 })];
    expect(ids(sortInviteRows(rows, 'rank', 'asc', cfg, name))).toEqual(['a', 'b', 'c']);
    expect(ids(sortInviteRows(rows, 'rank', 'desc', cfg, name))).toEqual(['b', 'a', 'c']);
    expect(ids(sortInviteRows(rows, 'paid', 'asc', cfg, name))).toEqual(['c', 'a', 'b']);
    expect(ids(sortInviteRows(rows, 'paid', 'desc', cfg, name))).toEqual(['b', 'a', 'c']);
  });
  it('参加日を使い、招待元登録日は使わない。不明は最後、同値はID順。不正指定は既定に戻す', () => {
    const rows = [row('b', { joinedAt: new Date('2026-09-01') }), row('c'), row('a', { joinedAt: new Date('2026-10-01'), createdAt: new Date('2026-01-01') })];
    expect(ids(sortInviteRows(rows, 'joined', 'desc', cfg, name))).toEqual(['a', 'b', 'c']);
    expect(ids(sortInviteRows(rows, 'joined', 'asc', cfg, name))).toEqual(['b', 'a', 'c']);
    expect(ids(sortInviteRows([row('b'), row('a')], 'joined', 'desc', cfg, name))).toEqual(['a', 'b']);
    expect(inviteSort('oops')).toBe('joined');
    expect(inviteOrder('oops')).toBe('desc');
  });
});

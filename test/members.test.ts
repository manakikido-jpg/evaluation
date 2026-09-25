import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import {
  ActivityTracker,
  eventsOf,
  getMember,
  homeStats,
  listMembers,
  recordJoin,
  recordLeave,
  syncAllMembers,
  type MemberSnapshot,
} from '../src/services/members.js';
import { giveShuin } from '../src/services/shuin.js';
import { makeDb, ROLE } from './helpers.js';

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
});
afterEach(async () => {
  await close();
});

const snap = (id: string, name: string, roleIds: string[] = [ROLE.sanpaisha], extra: Partial<MemberSnapshot> = {}): MemberSnapshot => ({
  id,
  username: name.toLowerCase(),
  displayName: name,
  avatarUrl: null,
  roleIds,
  isBot: false,
  joinedAt: new Date('2026-09-01T00:00:00Z'),
  ...extra,
});

const A = '600000000000000001';
const B = '600000000000000002';
const C = '600000000000000003';

describe('参加・退出の記録', () => {
  it('参加 → 退出 → 再参加', async () => {
    expect(await recordJoin(db, snap(A, 'Sakura'))).toBe('join');
    await recordLeave(db, A);
    expect((await getMember(db, A))?.leftAt).toBeInstanceOf(Date);
    expect(await recordJoin(db, snap(A, 'Sakura'))).toBe('rejoin');
    expect((await getMember(db, A))?.leftAt).toBeNull();
    const kinds = (await eventsOf(db, A)).map((e) => e.kind).sort();
    expect(kinds).toEqual(['join', 'leave', 'rejoin']);
  });

  it('退出済みの人をもう一度退出させても記録は増えない', async () => {
    await recordJoin(db, snap(A, 'Sakura'));
    await recordLeave(db, A);
    await recordLeave(db, A);
    expect((await eventsOf(db, A)).filter((e) => e.kind === 'leave')).toHaveLength(1);
  });

  it('起動時の全員同期: 止まっていた間の参加・退出を反映', async () => {
    await recordJoin(db, snap(A, 'Sakura'));
    await recordJoin(db, snap(B, 'Momiji'));
    // BOT 停止中に B が退出し、C が参加、A は名前を変えた
    const r = await syncAllMembers(db, [snap(A, 'Sakura2'), snap(C, 'Kaede')]);
    expect(r).toEqual({ joined: 1, left: 1 });
    expect((await getMember(db, A))?.displayName).toBe('Sakura2');
    expect((await getMember(db, B))?.leftAt).toBeInstanceOf(Date);
    expect((await getMember(db, C))?.leftAt).toBeNull();
  });
});

describe('最後の活動', () => {
  it('5 分に 1 回だけ書き込む', async () => {
    await recordJoin(db, snap(A, 'Sakura'));
    const t = new ActivityTracker(db);
    const base = Date.parse('2026-09-25T12:00:00Z');
    expect(await t.touch(A, base)).toBe(true);
    expect(await t.touch(A, base + 60_000)).toBe(false);
    expect(await t.touch(A, base + 6 * 60_000)).toBe(true);
    expect((await getMember(db, A))?.lastActiveAt?.getTime()).toBe(base + 6 * 60_000);
  });
});

describe('メンバー一覧の検索', () => {
  beforeEach(async () => {
    await recordJoin(db, snap(A, 'Sakura', [ROLE.sewayaku], { joinedAt: new Date('2026-06-01T00:00:00Z') }));
    await recordJoin(db, snap(B, 'Momiji', [ROLE.sanpaisha], { joinedAt: new Date('2026-09-20T00:00:00Z') }));
    await recordJoin(db, snap(C, 'Kaede_100%', [ROLE.ujiko]));
    await recordJoin(db, snap('600000000000000009', 'Bot', [], { isBot: true }));
    await giveShuin(db, { giverId: B, receiverId: A, weight: 3, giverRank: 'sewayaku' });
    await giveShuin(db, { giverId: C, receiverId: A, weight: 2, giverRank: 'ujiko' });
    await giveShuin(db, { giverId: A, receiverId: C, weight: 3, giverRank: 'sewayaku' });
  });

  it('BOT は出さない・ご縁の多い順', async () => {
    const r = await listMembers(db, {});
    expect(r.total).toBe(3);
    expect(r.rows.map((m) => [m.displayName, m.goen])).toEqual([
      ['Sakura', 5],
      ['Kaede_100%', 3],
      ['Momiji', 0],
    ]);
  });

  it('名前・ID で検索（% や _ はそのままの文字として扱う）', async () => {
    expect((await listMembers(db, { q: 'saku' })).rows.map((m) => m.id)).toEqual([A]);
    expect((await listMembers(db, { q: B })).rows.map((m) => m.id)).toEqual([B]);
    expect((await listMembers(db, { q: '100%' })).rows.map((m) => m.id)).toEqual([C]);
    expect((await listMembers(db, { q: '%' })).rows.map((m) => m.id)).toEqual([C]);
  });

  it('役職で絞り込み', async () => {
    expect((await listMembers(db, { roleId: ROLE.sanpaisha })).rows.map((m) => m.id)).toEqual([B]);
  });

  it('しばらく来ていない人', async () => {
    const t = new ActivityTracker(db);
    const now = Date.parse('2026-09-25T00:00:00Z');
    await t.touch(A, now - 1 * 86_400_000);
    await t.touch(B, now - 40 * 86_400_000);
    const r = await listMembers(db, { inactiveDays: 30 }, new Date(now));
    // B（40 日前）と C（記録なし）
    expect(r.rows.map((m) => m.id).sort()).toEqual([B, C].sort());
  });

  it('退出済み・全員', async () => {
    await recordLeave(db, B);
    expect((await listMembers(db, {})).total).toBe(2);
    expect((await listMembers(db, { status: 'left' })).rows.map((m) => m.id)).toEqual([B]);
    expect((await listMembers(db, { status: 'all' })).total).toBe(3);
  });

  it('ページ分け', async () => {
    const r = await listMembers(db, { perPage: 2, page: 2 });
    expect(r).toMatchObject({ total: 3, page: 2, pages: 2 });
    expect(r.rows).toHaveLength(1);
    // 範囲外のページは最後のページに寄せる
    expect((await listMembers(db, { perPage: 2, page: 99 })).page).toBe(2);
  });

  it('参加の新しい順', async () => {
    const r = await listMembers(db, { sort: 'joined' });
    expect(r.rows[0]?.id).toBe(B);
  });

  it('ホームの数字', async () => {
    const s = await homeStats(db, new Date(0));
    expect(s).toMatchObject({ members: 3, joined: 4, left: 0, shuin: 3 });
  });
});

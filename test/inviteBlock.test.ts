import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/db/client.js';
import { InviteLinkApp } from '../src/discord/inviteLinks.js';
import { inviteBlocks, isInviteBlocked, setInviteBlock } from '../src/services/inviteBlock.js';
import { cfg, makeDb } from './helpers.js';

const BAD = '815208713874584412', OK = '815208713874584413';
let db: Db, close: () => Promise<void>;
beforeEach(async () => ({ db, close } = await makeDb()));
afterEach(async () => close());

describe('🚫 招待を作れない人', () => {
  it('登録・外す。二重に登録しない', async () => {
    expect(await setInviteBlock(db, BAD, true, 'admin', 'サブ垢の疑い')).toBe(true);
    expect(await setInviteBlock(db, BAD, true, 'admin')).toBe(false);
    expect(await isInviteBlocked(db, BAD)).toBe(true);
    expect(await isInviteBlocked(db, OK)).toBe(false);
    expect((await inviteBlocks(db))[0]?.note).toBe('サブ垢の疑い');
    expect(await setInviteBlock(db, BAD, false, 'admin')).toBe(true);
    expect(await isInviteBlocked(db, BAD)).toBe(false);
  });

  it('🚨 10 分で 5 人・20 分で 10 人で警戒。警戒の人・見張る人の招待で入った人に案内停止を付ける', async () => {
    const { invites, members } = await import('../src/db/schema.js');
    const { checkInviteBurst, holdsGuide, inviteAlerts, clearInviteAlert } = await import('../src/services/inviteGuard.js');
    const now = new Date('2026-10-25T12:00:00Z');
    const id = (n: number) => `8200000000000000${String(n).padStart(2, '0')}`;
    const add = async (n: number, minutesAgo: number, source = 'link', inviter = OK) => {
      await db.insert(members).values({ id: id(n), username: 'u' + n, displayName: 'u' + n }).onConflictDoNothing();
      await db.insert(invites).values({ memberId: id(n), inviterId: inviter, source, createdAt: new Date(now.getTime() - minutesAgo * 60_000) });
    };
    for (let n = 1; n <= 4; n++) await add(n, n);
    await add(30, 1, 'answer');
    expect(await checkInviteBurst(db, OK, now)).toBeUndefined();
    await add(5, 2);
    const warn = await checkInviteBurst(db, OK, now);
    expect(warn?.level).toBe('warn');
    expect(warn?.invitees).toHaveLength(5);
    expect(await checkInviteBurst(db, OK, now)).toBeUndefined();
    for (let n = 6; n <= 10; n++) await add(n, 15);
    expect((await checkInviteBurst(db, OK, now))?.level).toBe('severe');
    expect((await inviteAlerts(db))[0]?.level).toBe('severe');
    expect(await holdsGuide(db, OK)).toBe('alert');
    expect(await clearInviteAlert(db, OK, 'admin')).toBe(true);
    expect(await holdsGuide(db, OK)).toBeUndefined();
    await setInviteBlock(db, BAD, true, 'admin');
    expect(await holdsGuide(db, BAD)).toBe('blocked');
  });

  it('見張る人の招待で入った人に、案内停止ロールを付ける', async () => {
    await setInviteBlock(db, BAD, true, 'admin');
    const app = new InviteLinkApp(db, () => cfg);
    const role = { id: '830000000000000001', name: '案内停止' };
    const has = new Set<string>();
    const member = { id: '820000000000000099', roles: { cache: { has: (r: string) => has.has(r) }, add: vi.fn(async () => void has.add(role.id)) }, guild: { roles: { cache: { find: () => role } }, members: { fetch: async () => undefined }, channels: { cache: new Map() } } };
    expect(await app.guard(member as never, BAD)).toEqual([member.id]);
    expect(await app.guard(member as never, OK)).toEqual([]);
  });
});

describe('🚨 見張りの見直し', () => {
  it('見張る人に招待されて、まだ案内待ちの人に案内停止を付ける（案内待ちでない人には付けない）', async () => {
    const { invites } = await import('../src/db/schema.js');
    await setInviteBlock(db, BAD, true, 'admin');
    await db.insert(invites).values([
      { memberId: '820000000000000201', inviterId: BAD, source: 'link' },
      { memberId: '820000000000000202', inviterId: BAD, source: 'answer' },
      { memberId: '820000000000000203', inviterId: OK, source: 'link' },
    ]);
    const PENDING = '830000000000000010', HOLD = { id: '830000000000000011', name: '案内停止' };
    const added: string[] = [];
    const mem = (id: string, roles: string[]) => ({ id, user: { bot: false }, roles: { cache: new Set(roles), add: vi.fn(async () => void added.push(id)) } });
    const guild = {
      id: cfg.guildId,
      roles: { cache: Object.assign(new Map([[PENDING, { id: PENDING, name: '案内待ち' }], [HOLD.id, HOLD]]), { find: (f: (r: { name: string }) => boolean) => [HOLD].find(f) }) },
      members: { cache: new Map([['820000000000000201', mem('820000000000000201', [PENDING])], ['820000000000000202', mem('820000000000000202', [])], ['820000000000000203', mem('820000000000000203', [PENDING])]]) },
    };
    const app = new InviteLinkApp(db, () => cfg);
    expect(await app.sweepHolds(guild as never)).toBe(1);
    expect(added).toEqual(['820000000000000201']);
  });
});

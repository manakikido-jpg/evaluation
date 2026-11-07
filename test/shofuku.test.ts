import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { invites, memberEvents, members, omairi, voiceUsage } from '../src/db/schema.js';
import { grantShofukuSince, shofukuGrantTargets, excludeShofuku, markShofukuAchievement, rewardShofuku, saveShofukuConfig, shofukuConfig, shofukuPerks, shofukuRanking, shofukuRows } from '../src/services/shofuku.js';
import { walletOf } from '../src/services/economy.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const MALE = '600000000000000101', FEMALE = '600000000000000102', SHOFUKU = '600000000000000103';
const c2 = { ...cfg, roles: { ...cfg.roles, male: MALE, female: FEMALE } } as typeof cfg;
const INV = '700000000000000501', A = '700000000000000502', B = '700000000000000503', BACK = '700000000000000504', OLD = '700000000000000505';
const JOIN = new Date('2026-11-03T03:00:00Z');
const NOW = new Date('2026-11-09T03:00:00Z');
let db: Db, close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  await saveShofukuConfig(db, { enabled: true, malePoints: 1, femalePoints: 2, targetPoints: 3, roleId: SHOFUKU }, 'staff');
  const m = (id: string, roles: string[], joinedAt = JOIN) => ({ id, username: id, displayName: `人${id.slice(-1)}`, roleIds: roles, joinedAt });
  await db.insert(members).values([m(INV, [ROLE.sanpaisha]), m(A, [MALE, ROLE.sanpaisha]), m(B, [FEMALE, ROLE.sanpaisha]), m(BACK, [FEMALE, ROLE.sanpaisha]), m(OLD, [FEMALE])]);
  await db.insert(invites).values([
    { memberId: A, inviterId: INV, source: 'link', createdAt: JOIN }, { memberId: B, inviterId: INV, source: 'link', createdAt: JOIN },
    { memberId: BACK, inviterId: INV, source: 'link', createdAt: JOIN },
    { memberId: OLD, inviterId: INV, source: 'link', createdAt: new Date('2026-10-30T03:00:00Z') },
  ]);
  await db.insert(memberEvents).values({ memberId: BACK, kind: 'rejoin' });
  // A は 4 時間、B は 3 時間（足りない）
  await db.insert(voiceUsage).values([{ memberId: A, date: '2026-11-03', channelId: '1', minutes: 120 }, { memberId: A, date: '2026-11-04', channelId: '1', minutes: 120 }, { memberId: B, date: '2026-11-03', channelId: '1', minutes: 180 }]);
});
afterEach(async () => close());

describe('🎍 招福詣', () => {
  it('期間中に招待リンクで入った人だけを数え、浮上・滞在・出戻り・性別で判定する', async () => {
    const rows = await shofukuRows(db, c2, await shofukuConfig(db), NOW);
    expect(rows.map(r => r.memberId).sort()).toEqual([A, B, BACK].sort());
    const a = rows.find(r => r.memberId === A)!;
    expect(a).toMatchObject({ qualified: true, points: 1, gender: 'male', minutes: 240 });
    expect(rows.find(r => r.memberId === B)!.missing.join()).toContain('浮上');
    expect(rows.find(r => r.memberId === BACK)!.missing).toContain('出戻り');
    expect((await shofukuRows(db, c2, await shofukuConfig(db), new Date('2026-11-05T03:00:00Z'))).find(r => r.memberId === A)!.missing.join()).toContain('滞在');
    const rank = await shofukuRanking(db, rows);
    expect(rank[0]).toMatchObject({ inviterId: INV, points: 1, qualified: 1, pending: 1 });
  });
  it('お参り期間を1回だけ延ばし、『招福』ロールを付ける人を返す（出戻りはのぞく）', async () => {
    await db.insert(omairi).values({ memberId: A, startedAt: JOIN, endsAt: new Date('2026-11-10T03:00:00Z') });
    const [p1, p2] = await Promise.all([shofukuPerks(db, c2, NOW), shofukuPerks(db, c2, NOW)]);
    expect([...p1.extended, ...p2.extended].sort()).toEqual([A, B].sort());
    expect(p1.roleTargets.sort()).toEqual([A, B].sort());
    expect((await db.select().from(omairi).where(eq(omairi.memberId, A)))[0]!.endsAt.toISOString()).toBe('2026-11-13T03:00:00.000Z');
    expect((await shofukuPerks(db, c2, NOW)).extended).toEqual([]);
  });
  it('銭は条件を満たした人ごとに1回だけ。対象外にした人と、渡したあとの対象外は受けない。達成の印も1回', async () => {
    expect(await rewardShofuku(db, c2, B, 'staff', NOW)).toBe('not_qualified');
    const r = await Promise.all([rewardShofuku(db, c2, A, 'staff', NOW), rewardShofuku(db, c2, A, 'staff', NOW)]);
    expect(r.sort()).toEqual(['done', 'ok']);
    expect((await walletOf(db, INV)).balance).toBe(300);
    expect(await excludeShofuku(db, A, INV, true, 'x', 'staff')).toBe(false);
    await db.insert(voiceUsage).values({ memberId: B, date: '2026-11-05', channelId: '1', minutes: 60 });
    expect(await excludeShofuku(db, B, INV, true, 'サブ垢', 'staff')).toBe(true);
    expect(await rewardShofuku(db, c2, B, 'staff', NOW)).toBe('not_qualified');
    expect(await markShofukuAchievement(db, INV, 3, 'staff')).toBe(true);
    expect(await markShofukuAchievement(db, INV, 3, 'staff')).toBe(false);
  });

  it('指定の日から入った在籍中の人（BOT・もう付いている人・抜けた人・前に入った人のぞく）にまとめて招福ロールを付ける', async () => {
    const LATE = '700000000000000511', HAS = '700000000000000512', LEFT = '700000000000000513', BOT = '700000000000000514', NEWBIE = '700000000000000515';
    const d = (iso: string) => new Date(iso);
    await db.insert(members).values([
      { id: LATE, username: 'late', displayName: 'あ', roleIds: [], joinedAt: d('2026-11-01T00:30:00+09:00') },
      { id: HAS, username: 'has', displayName: 'い', roleIds: [SHOFUKU], joinedAt: d('2026-11-02T03:00:00Z') },
      { id: LEFT, username: 'left', displayName: 'う', roleIds: [], joinedAt: d('2026-11-03T03:00:00Z'), leftAt: d('2026-11-04T03:00:00Z') },
      { id: BOT, username: 'bot', displayName: 'え', roleIds: [], isBot: true, joinedAt: d('2026-11-03T03:00:00Z') },
      { id: NEWBIE, username: 'newbie', displayName: 'お', roleIds: [], joinedAt: d('2026-10-31T23:59:00+09:00') },
    ]);
    // INV・A・B・BACK・OLD は beforeEach で入っている（11/3 入り）。OLD は前に入った。
    const targets = await shofukuGrantTargets(db, '2026-11-01');
    expect(targets!.roleId).toBe(SHOFUKU);
    expect(targets!.ids).toContain(LATE);
    for (const id of [HAS, LEFT, BOT, NEWBIE]) expect(targets!.ids).not.toContain(id);
    expect(await shofukuGrantTargets(db, 'あした')).toBeUndefined();
    const calls: string[] = [];
    const discord = { addRole: async (_g: string, u: string, r: string) => { if (u === A) throw new Error('boom'); calls.push(`${u}:${r}`); } };
    const r = await grantShofukuSince(db, discord, 'g', '2026-11-01', 'staff');
    expect(r).toMatchObject({ status: 'ok', failed: 1, remaining: 0 });
    expect(calls).toContain(`${LATE}:${SHOFUKU}`);
    expect(calls.every((c) => c.endsWith(`:${SHOFUKU}`))).toBe(true);
    expect(calls.some((c) => c.startsWith(HAS) || c.startsWith(LEFT) || c.startsWith(BOT) || c.startsWith(NEWBIE))).toBe(false);
    expect(await grantShofukuSince(db, discord, 'g', 'x', 'staff')).toEqual({ status: 'invalid' });
    await saveShofukuConfig(db, { enabled: true, malePoints: 1, femalePoints: 2, targetPoints: 3, roleId: '' }, 'staff');
    expect(await grantShofukuSince(db, discord, 'g', '2026-11-01', 'staff')).toEqual({ status: 'no_role' });
  });
});


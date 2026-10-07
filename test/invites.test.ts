import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { GuildConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { activityDaily, auditLogs, invites, members } from '../src/db/schema.js';
import { walletOf } from '../src/services/economy.js';
import { STAFF_NO_INVITER, assignUnknownInviter, rewardInviteRanks, inviteRewardRows, inviteActiveTick, inviteCountOf, inviterOf, recordInvite, rewardInviter } from '../src/services/invites.js';
import { recordJoin } from '../src/services/members.js';
import { cfg as baseCfg, makeDb } from './helpers.js';

const INVITER = '870000000000000001';
const NEW = '870000000000000002';
const NEW2 = '870000000000000003';
const T0 = new Date('2026-09-27T03:00:00Z'); // 日本時間 12:00
const DAY = 86_400_000;
const cfg: GuildConfig = { ...baseCfg, economy: { ...baseCfg.economy, inviteReward: 500, inviteSanpaishaReward: 150, inviteUjikoReward: 350, inviteActiveEnabled: true, inviteActiveReward: 20, inviteActiveDays: 30 } };

let db: Db;
let close: () => Promise<void>;
let dms: string[];
let logs: { channel: string; body: any }[];
const ctx = (c = cfg) => ({ db, cfg: c, discord: { sendDm: async (u: string, t: string) => (dms.push(`${u} ${t}`), true), sendMessage: async (channel: string, body: any) => { logs.push({ channel, body }); return { id: 'message' }; } } });
beforeEach(async () => {
  ({ db, close } = await makeDb());
  dms = [];
  logs = [];
  for (const id of [INVITER, NEW, NEW2]) await recordJoin(db, { id, username: id, displayName: id, avatarUrl: null, roleIds: [], isBot: false, joinedAt: T0 });
});
afterEach(async () => {
  await close();
});

describe('招待のお礼', () => {
  it('自分は記録しない。前の記録は変えない', async () => {
    expect(await recordInvite(db, NEW, NEW)).toBe(false);
    expect(await recordInvite(db, NEW, 'abc')).toBe(false);
    expect(await recordInvite(db, NEW, INVITER)).toBe(true);
    expect(await recordInvite(db, NEW, NEW2)).toBe(false);
    expect(await inviterOf(db, NEW)).toBe(INVITER);
  });

  it('参拝者になったら 1 回だけお礼と DM。抜けて入り直しても 2 回目はない', async () => {
    await recordInvite(db, NEW, INVITER);
    expect(await inviteCountOf(db, INVITER)).toEqual({ joined: 0, pending: 1 });
    expect(await rewardInviter(ctx(), NEW, T0)).toEqual({ status: 'rewarded', inviterId: INVITER, amount: 150 });
    expect(await rewardInviter(ctx(), NEW, T0)).toEqual({ status: 'already' });
    expect((await walletOf(db, INVITER)).balance).toBe(150);
    expect(dms[0]).toContain(`<@${NEW}> さんが参拝者になったため、招待報酬150銭`);
    expect(await inviteCountOf(db, INVITER)).toEqual({ joined: 1, pending: 0 });
    expect(await rewardInviter(ctx(), NEW2, T0)).toEqual({ status: 'none' });
  });

  it('招待した人が抜けていたら渡さない。お礼 0 でも参拝者になった日は記録する', async () => {
    await recordInvite(db, NEW, INVITER);
    await db.update(members).set({ leftAt: T0 }).where(eq(members.id, INVITER));
    expect((await rewardInviter(ctx(), NEW, T0)).status).toBe('inviter_gone');
    await db.update(members).set({ leftAt: null }).where(eq(members.id, INVITER));
    const off = { ...cfg, economy: { ...cfg.economy, inviteSanpaishaReward: 0 } };
    expect((await rewardInviter(ctx(off), NEW, T0)).status).toBe('disabled');
    const [row] = await db.select().from(invites).where(eq(invites.memberId, NEW));
    expect(row?.rewardedAt).toEqual(T0);
    expect((await walletOf(db, INVITER)).balance).toBe(0);
  });
});

describe('招待した人の浮上ボーナス', () => {
  beforeEach(async () => {
    await recordInvite(db, NEW, INVITER);
    await rewardInviter(ctx(), NEW, T0);
  });
  const active = (id: string, date: string, v: { messageCount?: number; vcMinutes?: number }) => db.insert(activityDaily).values({ memberId: id, date, ...v });

  it('発言した日・通話 10 分の日に 1 日 1 回。通話 9 分はまだ', async () => {
    await active(NEW, '2026-09-27', { vcMinutes: 9 });
    expect(await inviteActiveTick(db, cfg, T0)).toEqual([]);
    await db.update(activityDaily).set({ messageCount: 1 }).where(eq(activityDaily.memberId, NEW));
    expect(await inviteActiveTick(db, cfg, T0)).toEqual([{ memberId: NEW, inviterId: INVITER }]);
    expect(await inviteActiveTick(db, cfg, T0)).toEqual([]);
    await active(NEW, '2026-09-28', { vcMinutes: 10 });
    expect(await inviteActiveTick(db, cfg, new Date(T0.getTime() + DAY))).toHaveLength(1);
    expect((await walletOf(db, INVITER)).balance).toBe(190);
  });

  it('浮上ボーナスを止めた設定では配らない', async () => {
    await active(NEW, '2026-09-27', { messageCount: 1 });
    expect(await inviteActiveTick(db, { ...cfg, economy: { ...cfg.economy, inviteActiveEnabled: false } }, T0)).toEqual([]);
    expect((await walletOf(db, INVITER)).balance).toBe(150);
  });

  it('参拝者になってから決めた日数を過ぎたら、もう渡さない。招待された人が抜けていても渡さない', async () => {
    await active(NEW, '2026-10-28', { messageCount: 3 });
    expect(await inviteActiveTick(db, cfg, new Date(T0.getTime() + 31 * DAY))).toEqual([]);
    await active(NEW, '2026-10-01', { messageCount: 3 });
    await db.update(members).set({ leftAt: T0 }).where(eq(members.id, NEW));
    expect(await inviteActiveTick(db, cfg, new Date(T0.getTime() + 4 * DAY))).toEqual([]);
  });
});

describe('BOT が作る招待リンク', () => {
  it('使われた回数が増えたリンクが 1 つだけなら、その持ち主。2 つ増えたら分からない。Discord にないリンクは無効に', async () => {
    const { saveLink, matchJoin, activeLinkOf } = await import('../src/services/invites.js');
    await saveLink(db, { code: 'aaa', inviterId: INVITER, channelId: '1', uses: 3 });
    await saveLink(db, { code: 'bbb', inviterId: NEW2, channelId: '1', uses: 0 });
    expect((await activeLinkOf(db, INVITER))?.code).toBe('aaa');
    expect(await matchJoin(db, [{ code: 'aaa', uses: 4 }, { code: 'bbb', uses: 0 }, { code: 'human', uses: 9 }])).toBe(INVITER);
    // 覚え直したので、同じ回数ならだれでもない
    expect(await matchJoin(db, [{ code: 'aaa', uses: 4 }, { code: 'bbb', uses: 0 }])).toBeUndefined();
    expect(await matchJoin(db, [{ code: 'aaa', uses: 5 }, { code: 'bbb', uses: 1 }])).toBeUndefined();
    // bbb が消された
    expect(await matchJoin(db, [{ code: 'aaa', uses: 6 }])).toBe(INVITER);
    expect(await activeLinkOf(db, NEW2)).toBeUndefined();
  });

  it('共通の招待リンク: 名前ごとに 1 つ、消すと一覧から消える、入った人は shared（だれの招待でもない）', async () => {
    const { saveLink, matchJoin, sharedLinks, sharedLinkNamed, revokeSharedLink, inviteCodeOf, SHARED_INVITER } = await import('../src/services/invites.js');
    await saveLink(db, { code: 'sns', inviterId: SHARED_INVITER, channelId: '1', uses: 0, label: 'X 用', createdBy: INVITER });
    await saveLink(db, { code: 'plain', inviterId: SHARED_INVITER, channelId: '1', uses: 0, label: null, createdBy: INVITER });
    expect((await sharedLinkNamed(db, 'X 用'))?.code).toBe('sns');
    expect((await sharedLinkNamed(db, null))?.code).toBe('plain');
    expect(await sharedLinkNamed(db, 'ポスター')).toBeUndefined();
    expect(await matchJoin(db, [{ code: 'sns', uses: 1 }, { code: 'plain', uses: 0 }])).toBe(SHARED_INVITER);
    expect(await revokeSharedLink(db, 'sns')).toBe(true);
    expect(await revokeSharedLink(db, 'sns')).toBe(false);
    expect((await sharedLinks(db)).map((l) => l.code)).toEqual(['plain']);
    expect(inviteCodeOf('https://discord.gg/abcDEF')).toBe('abcDEF');
    expect(inviteCodeOf('discord.com/invite/xyz-1')).toBe('xyz-1');
    expect(inviteCodeOf(' abc ')).toBe('abc');
  });

  it('リンクで入った記録は、あとで申請で選んだ人より優先（上書きしない）', async () => {
    const { inviteOf } = await import('../src/services/invites.js');
    expect(await recordInvite(db, NEW, INVITER, 'link')).toBe(true);
    expect(await recordInvite(db, NEW, NEW2, 'answer')).toBe(false);
    expect(await inviteOf(db, NEW)).toEqual({ inviterId: INVITER, source: 'link' });
  });
});


describe('段階別の招待報酬', () => {
  it('参拝者150・氏子350。同時操作・付け直しで二重払いしない', async () => {
    await recordInvite(db, NEW, INVITER);
    await Promise.all([rewardInviter(ctx(), NEW, T0), rewardInviter(ctx(), NEW, T0)]);
    await Promise.all([rewardInviter(ctx(), NEW, T0, 'ujiko'), rewardInviter(ctx(), NEW, T0, 'ujiko')]);
    expect((await walletOf(db, INVITER)).balance).toBe(500);
    expect(dms).toHaveLength(2); expect(logs).toHaveLength(2);
    expect(dms[1]).toContain('氏子になったため、招待報酬350銭');
    expect(logs[1]?.body).toMatchObject({ content: expect.stringContaining('招待報酬の支払い完了'), allowed_mentions: { parse: [] } });
    expect((await rewardInviter(ctx(), NEW, T0, 'ujiko')).status).toBe('already');
  });
  it('旧制度で500支払済みの人は移行後に追加で払わない', async () => {
    await recordInvite(db, NEW, INVITER);
    await db.update(invites).set({ rewardedAt: T0, reward: 500 }).where(eq(invites.memberId, NEW));
    const { readFileSync } = await import('node:fs');
    const { sql } = await import('drizzle-orm');
    const migration = readFileSync(new URL('../drizzle/0078_peaceful_vermin.sql', import.meta.url), 'utf8');
    for (const statement of migration.split('--> statement-breakpoint').filter((s) => s.includes('UPDATE'))) await db.execute(sql.raw(statement));
    expect((await rewardInviter(ctx(), NEW, T0)).status).toBe('already');
    expect((await rewardInviter(ctx(), NEW, T0, 'ujiko')).status).toBe('already');
    expect(dms).toHaveLength(0); expect(logs).toHaveLength(0);
    const [row] = await db.select().from(invites).where(eq(invites.memberId, NEW));
    expect(row).toMatchObject({ legacyReward: true, ujikoReward: 0, ujikoRewardedAt: T0 });
  });
  it('DM拒否でも支払いと運営通知は完了する', async () => {
    await recordInvite(db, NEW, INVITER);
    const c = ctx(); c.discord.sendDm = async () => { throw new Error('DM disabled'); };
    await rewardInviter(c, NEW, T0);
    expect((await walletOf(db, INVITER)).balance).toBe(150);
    expect(logs[0]?.body.content).toContain('DMは届きませんでした');
  });
  it('役職到達で支払い、招待元不明・BOTには配らない', async () => {
    const { rewardInviteRanks, inviteRewardRows } = await import('../src/services/invites.js');
    const { ROLE } = await import('./helpers.js');
    await rewardInviteRanks(ctx(), NEW, [ROLE.ujiko], T0);
    expect((await walletOf(db, INVITER)).balance).toBe(0);
    await recordInvite(db, NEW, INVITER);
    await rewardInviteRanks(ctx(), NEW, [ROLE.sanpaisha], T0);
    expect((await walletOf(db, INVITER)).balance).toBe(150);
    await rewardInviteRanks(ctx(), NEW, [ROLE.ujiko], T0);
    expect((await walletOf(db, INVITER)).balance).toBe(500);
    await recordInvite(db, NEW2, INVITER);
    await db.update(members).set({ isBot: true }).where(eq(members.id, NEW2));
    await rewardInviteRanks(ctx(), NEW2, [ROLE.ujiko], T0);
    expect((await walletOf(db, INVITER)).balance).toBe(500);
    const rows = await inviteRewardRows(db);
    expect(rows.find((r) => r.memberId === NEW)).toMatchObject({ inviterId: INVITER, reward: 150, ujikoReward: 350 });
    expect(rows.find((r) => r.memberId === INVITER)?.inviterId).toBeNull();
  });
});


describe('一覧から不明な招待元を補う', () => {
  it('氏子の招待元を登録し各段階1回。二重クリックも前の招待元も変更しない', async () => {
    const rank = cfg.ranks.find(r => r.key === 'ujiko')!;
    await db.update(members).set({ roleIds: [rank.roleId] }).where(eq(members.id, NEW));
    const results = await Promise.all([assignUnknownInviter(ctx(), NEW, INVITER, NEW2, T0), assignUnknownInviter(ctx(), NEW, INVITER, NEW2, T0)]);
    expect(results.sort()).toEqual(['assigned', 'known']);
    expect(await inviterOf(db, NEW)).toBe(INVITER);
    expect((await walletOf(db, INVITER)).balance).toBe(500);
    expect(dms).toHaveLength(2);
    expect(logs).toHaveLength(2);
    expect(await assignUnknownInviter(ctx(), NEW, NEW2, NEW2, T0)).toBe('known');
    expect((await walletOf(db, NEW2)).balance).toBe(0);
    const records = await db.select().from(auditLogs).where(eq(auditLogs.action, 'invite.assign'));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ actorId: NEW2, targetId: NEW, detail: { inviterId: INVITER } });
    expect((await db.select().from(invites))[0]!.source).toBe('admin');
  });
  it('自己招待・不正ID・BOT・退出・存在しない人は不可。役職待ちの登録は支払わない', async () => {
    expect(await assignUnknownInviter(ctx(), NEW, NEW, NEW2)).toBe('invalid');
    expect(await assignUnknownInviter(ctx(), NEW, 'bad', NEW2)).toBe('invalid');
    expect(await assignUnknownInviter(ctx(), NEW, '870000000000000999', NEW2)).toBe('invalid');
    await db.update(members).set({ isBot: true }).where(eq(members.id, INVITER));
    expect(await assignUnknownInviter(ctx(), NEW, INVITER, NEW2)).toBe('invalid');
    await db.update(members).set({ isBot: false, leftAt: T0 }).where(eq(members.id, INVITER));
    expect(await assignUnknownInviter(ctx(), NEW, INVITER, NEW2)).toBe('invalid');
    await db.update(members).set({ leftAt: null }).where(eq(members.id, INVITER));
    await db.update(members).set({ leftAt: T0 }).where(eq(members.id, NEW));
    expect(await assignUnknownInviter(ctx(), NEW, INVITER, NEW2)).toBe('invalid');
    await db.update(members).set({ leftAt: null }).where(eq(members.id, NEW));
    expect(await assignUnknownInviter(ctx(), NEW, INVITER, NEW2)).toBe('assigned');
    expect((await walletOf(db, INVITER)).balance).toBe(0);
    expect(dms).toHaveLength(0);
  });
});


it('退出・BOT・メンバー情報のない人は参加者一覧に出さず、再入鯖でも支払記録を保つ', async () => {
  await recordInvite(db, NEW, INVITER);
  await rewardInviter(ctx(), NEW, T0);
  await recordInvite(db, '870000000000000999', INVITER);
  await db.update(members).set({ leftAt: T0 }).where(eq(members.id, NEW));
  await db.update(members).set({ isBot: true }).where(eq(members.id, NEW2));
  expect((await inviteRewardRows(db)).map(r => r.memberId)).toEqual([INVITER]);
  expect(await inviterOf(db, NEW)).toBe(INVITER);
  await db.update(members).set({ leftAt: null }).where(eq(members.id, NEW));
  expect((await inviteRewardRows(db)).find(r => r.memberId === NEW)?.rewardedAt).toEqual(T0);
  expect((await rewardInviter(ctx(), NEW, T0)).status).toBe('already');
  expect((await walletOf(db, INVITER)).balance).toBe(150);
});


it('運営の招待なしは不明と区別し、昇格・再入鯖でも報酬を払わず登録を上書きしない', async () => {
  expect(await assignUnknownInviter(ctx(), NEW, STAFF_NO_INVITER, INVITER)).toBe('invalid');
  const staff = cfg.ranks.find(r => !r.auto)!;
  const ujiko = cfg.ranks.find(r => r.key === 'ujiko')!;
  await db.update(members).set({ roleIds: [staff.roleId, ujiko.roleId] }).where(eq(members.id, NEW));
  const results = await Promise.all([assignUnknownInviter(ctx(), NEW, STAFF_NO_INVITER, INVITER), assignUnknownInviter(ctx(), NEW, STAFF_NO_INVITER, INVITER)]);
  expect(results.sort()).toEqual(['known', 'no_invite']);
  expect(await inviterOf(db, NEW)).toBeUndefined();
  expect((await inviteRewardRows(db)).find(r => r.memberId === NEW)).toMatchObject({ inviterId: null, source: STAFF_NO_INVITER, reward: 0, ujikoReward: 0 });
  for (const stage of ['sanpaisha', 'ujiko'] as const) expect((await rewardInviter(ctx(), NEW, T0, stage)).status).toBe('none');
  await rewardInviteRanks(ctx(), NEW, [staff.roleId, ujiko.roleId]);
  await db.update(members).set({ leftAt: T0 }).where(eq(members.id, NEW));
  await db.update(members).set({ leftAt: null, roleIds: [ujiko.roleId] }).where(eq(members.id, NEW));
  await rewardInviteRanks(ctx(), NEW, [ujiko.roleId]);
  expect(await recordInvite(db, NEW, INVITER)).toBe(false);
  expect(await assignUnknownInviter(ctx(), NEW, INVITER, INVITER)).toBe('known');
  expect(dms).toHaveLength(0);
  expect(logs).toHaveLength(0);
  expect((await walletOf(db, INVITER)).balance).toBe(0);
  await recordInvite(db, NEW2, INVITER);
  await rewardInviter(ctx(), NEW2, T0);
  await db.update(members).set({ roleIds: [staff.roleId] }).where(eq(members.id, NEW2));
  expect(await assignUnknownInviter(ctx(), NEW2, STAFF_NO_INVITER, INVITER)).toBe('known');
  expect(await inviterOf(db, NEW2)).toBe(INVITER);
  expect((await walletOf(db, INVITER)).balance).toBe(150);
});

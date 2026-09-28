import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { GuildConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { activityDaily, invites, members } from '../src/db/schema.js';
import { walletOf } from '../src/services/economy.js';
import { inviteActiveTick, inviteCountOf, inviterOf, recordInvite, rewardInviter } from '../src/services/invites.js';
import { recordJoin } from '../src/services/members.js';
import { cfg as baseCfg, makeDb } from './helpers.js';

const INVITER = '870000000000000001';
const NEW = '870000000000000002';
const NEW2 = '870000000000000003';
const T0 = new Date('2026-09-27T03:00:00Z'); // 日本時間 12:00
const DAY = 86_400_000;
const cfg: GuildConfig = { ...baseCfg, economy: { ...baseCfg.economy, inviteReward: 500, inviteActiveReward: 20, inviteActiveDays: 30 } };

let db: Db;
let close: () => Promise<void>;
let dms: string[];
const ctx = (c = cfg) => ({ db, cfg: c, discord: { sendDm: async (u: string, t: string) => (dms.push(`${u} ${t}`), true) } });
beforeEach(async () => {
  ({ db, close } = await makeDb());
  dms = [];
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
    expect(await rewardInviter(ctx(), NEW, T0)).toEqual({ status: 'rewarded', inviterId: INVITER, amount: 500 });
    expect(await rewardInviter(ctx(), NEW, T0)).toEqual({ status: 'already' });
    expect((await walletOf(db, INVITER)).balance).toBe(500);
    expect(dms[0]).toContain(`<@${NEW}> さんが、咲楽ノ宮に参拝しました`);
    expect(await inviteCountOf(db, INVITER)).toEqual({ joined: 1, pending: 0 });
    expect(await rewardInviter(ctx(), NEW2, T0)).toEqual({ status: 'none' });
  });

  it('招待した人が抜けていたら渡さない。お礼 0 でも参拝者になった日は記録する', async () => {
    await recordInvite(db, NEW, INVITER);
    await db.update(members).set({ leftAt: T0 }).where(eq(members.id, INVITER));
    expect((await rewardInviter(ctx(), NEW, T0)).status).toBe('inviter_gone');
    await db.update(members).set({ leftAt: null }).where(eq(members.id, INVITER));
    const off = { ...cfg, economy: { ...cfg.economy, inviteReward: 0 } };
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
    expect((await walletOf(db, INVITER)).balance).toBe(540);
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

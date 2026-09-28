import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import type { ChannelOverwrite, DiscordActions, GuildChannel, GuildRole } from '../src/lib/discordRest.js';
import { activeGrants, endGrant, endedGrants, expireTick, extendGrant, grantPerm, grantRole, remaining } from '../src/services/tempGrants.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const STAFF = '800000000000000001';
const USER = '800000000000000002';
const BOT = '990000000000000001';
const CH = '910000000000000050';
const T0 = new Date('2026-09-28T12:00:00Z');
const ROLES: GuildRole[] = [
  { id: cfg.guildId, name: '@everyone', position: 0, managed: false, color: 0, permissions: '0' },
  { id: '980000000000000001', name: 'イベント係', position: 2, managed: false, color: 0, permissions: '0' },
  { id: '980000000000000002', name: 'BAN できる', position: 3, managed: false, color: 0, permissions: String(1n << 2n) },
  { id: ROLE.shinshoku, name: '神職', position: 4, managed: false, color: 0, permissions: '0' },
  { id: '980000000000000009', name: 'BOT', position: 10, managed: true, color: 0, permissions: '8', tags: { bot_id: BOT } },
  { id: '980000000000000010', name: 'BOT より上', position: 11, managed: false, color: 0, permissions: '0' },
];
const channels = (ow: ChannelOverwrite[] = []): GuildChannel[] => [{ id: CH, name: 'お知らせ', type: 0, parent_id: null, position: 0, permission_overwrites: ow }];

let db: Db;
let close: () => Promise<void>;
let log: string[];
let fail = false;
const discord = {
  addRole: async (_g: string, u: string, r: string) => void log.push(`addRole ${u} ${r}`),
  removeRole: async (_g: string, u: string, r: string) => {
    if (fail) throw new Error('500 boom');
    log.push(`removeRole ${u} ${r}`);
  },
  setChannelOverwrite: async (c: string, o: ChannelOverwrite) => void log.push(`ow ${c} ${o.id} allow=${o.allow} deny=${o.deny}`),
  deleteChannelOverwrite: async (c: string, t: string) => void log.push(`delow ${c} ${t}`),
  sendMessage: async (c: string, b: { content?: string }) => (log.push(`send ${c} ${b.content}`), { id: '1' }),
  sendDm: async (u: string) => (log.push(`dm ${u}`), true),
} as unknown as DiscordActions;
const ctx = () => ({ db, cfg, discord });
beforeEach(async () => {
  ({ db, close } = await makeDb());
  log = [];
  fail = false;
});
afterEach(async () => {
  await close();
});

describe('⏳ 一時的なロール', () => {
  it('付ける・もう一度で期限を付け直す・期限で外れる。付けた・外れたは #記録 と DM に', async () => {
    const base = { memberId: USER, minutes: 60, reason: 'イベントの手伝い', by: STAFF, byLevel: 'shinshoku' as const, roles: ROLES, botId: BOT, now: T0 };
    const r = await grantRole(ctx(), { ...base, roleId: '980000000000000001' });
    expect(r.status).toBe('granted');
    expect(log).toContain(`addRole ${USER} 980000000000000001`);
    expect(log).toContain(`dm ${USER}`);
    expect(log.some((l) => l.startsWith('send 900000000000000002 ⏳') && l.includes('9/28（月）22:00 まで付けました（イベントの手伝い）'))).toBe(true);
    // もう一度: 期限を付け直す（ロールは付け直さない）
    log = [];
    const again = await grantRole(ctx(), { ...base, roleId: '980000000000000001', minutes: 1440, memberRoleIds: ['980000000000000001'] });
    expect(again.status).toBe('extended');
    expect(log.filter((l) => l.startsWith('addRole'))).toEqual([]);
    expect((await activeGrants(db))[0]!.expiresAt).toEqual(new Date(T0.getTime() + 1440 * 60_000));
    // 期限前は外さない・期限で外す
    expect(await expireTick(ctx(), new Date(T0.getTime() + 60 * 60_000))).toBe(0);
    log = [];
    expect(await expireTick(ctx(), new Date(T0.getTime() + 1440 * 60_000))).toBe(1);
    expect(log[0]).toBe(`removeRole ${USER} 980000000000000001`);
    expect(log.some((l) => l.includes('期限で外れました'))).toBe(true);
    expect((await endedGrants(db))[0]).toMatchObject({ endReason: 'expired', endedBy: 'system' });
  });

  it('付けられないもの: 自分・BOT より上・自動のロール・持っているロール。危ないロールと運営のロールは宮司だけ', async () => {
    const base = { memberId: USER, minutes: 60, reason: '', by: STAFF, byLevel: 'shinshoku' as const, roles: ROLES, botId: BOT, now: T0 };
    expect((await grantRole(ctx(), { ...base, memberId: STAFF, roleId: '980000000000000001' })).status).toBe('self');
    expect((await grantRole(ctx(), { ...base, roleId: '980000000000000010' })).status).toBe('locked');
    expect((await grantRole(ctx(), { ...base, roleId: '980000000000000009' })).status).toBe('locked');
    expect((await grantRole(ctx(), { ...base, roleId: cfg.guildId })).status).toBe('locked');
    expect((await grantRole(ctx(), { ...base, roleId: '980000000000000002' })).status).toBe('guji_only');
    expect((await grantRole(ctx(), { ...base, roleId: ROLE.shinshoku })).status).toBe('guji_only');
    expect((await grantRole(ctx(), { ...base, roleId: '980000000000000001', memberRoleIds: ['980000000000000001'] })).status).toBe('already');
    expect((await grantRole(ctx(), { ...base, byLevel: 'guji', roleId: ROLE.shinshoku })).status).toBe('granted');
    expect(log.filter((l) => l.startsWith('addRole'))).toEqual([`addRole ${USER} ${ROLE.shinshoku}`]);
  });

  it('外せなかったら残して次の 1 分でもう一度。消えていたら外れたことにする', async () => {
    await grantRole(ctx(), { memberId: USER, roleId: '980000000000000001', minutes: 10, reason: '', by: STAFF, byLevel: 'guji', roles: ROLES, botId: BOT, now: T0 });
    fail = true;
    expect(await expireTick(ctx(), new Date(T0.getTime() + 11 * 60_000))).toBe(0);
    expect((await activeGrants(db)).length).toBe(1);
    fail = false;
    expect(await expireTick(ctx(), new Date(T0.getTime() + 12 * 60_000))).toBe(1);
    // 404（ロールが消えていた）は外れたことにする
    await grantRole(ctx(), { memberId: USER, roleId: '980000000000000001', minutes: 10, reason: '', by: STAFF, byLevel: 'guji', roles: ROLES, botId: BOT, now: T0 });
    const g = (await activeGrants(db))[0]!;
    const gone = { ...discord, removeRole: async () => Promise.reject(new Error('Discord API 404: Unknown Role')) } as DiscordActions;
    expect(await endGrant({ db, cfg, discord: gone }, g, STAFF, 'revoked', T0)).toBe('ended');
  });
});

describe('⏳ 一時的なチャンネルの権限', () => {
  it('その人だけの上書きに足し、外すときは前の上書きに戻す（なければ消す）', async () => {
    const prev: ChannelOverwrite = { id: USER, type: 1, allow: String(1n << 6n), deny: String(1n << 11n) };
    const base = { memberId: USER, channelId: CH, minutes: 60, reason: '', by: STAFF, byLevel: 'shinshoku' as const, now: T0 };
    const r = await grantPerm(ctx(), { ...base, preset: 'write', channels: channels([prev]) });
    expect(r.status).toBe('granted');
    const set = log.find((l) => l.startsWith('ow '))!;
    const allow = BigInt(/allow=(\d+)/.exec(set)![1]!);
    const deny = BigInt(/deny=(\d+)/.exec(set)![1]!);
    expect(allow & (1n << 11n)).toBe(1n << 11n);
    expect(allow & (1n << 6n)).toBe(1n << 6n);
    expect(deny & (1n << 11n)).toBe(0n);
    // 同じ権限はのばすだけ
    log = [];
    expect((await grantPerm(ctx(), { ...base, preset: 'write', minutes: 120, channels: channels([prev]) })).status).toBe('extended');
    expect(log.filter((l) => l.startsWith('ow '))).toEqual([]);
    // 違う権限（書き込み禁止）は、前のを戻してから付け直す
    log = [];
    expect((await grantPerm(ctx(), { ...base, preset: 'mute', channels: channels([{ ...prev, allow: String(allow), deny: String(deny) }]) })).status).toBe('granted');
    expect(log.filter((l) => l.startsWith('ow '))[0]).toBe(`ow ${CH} ${USER} allow=${prev.allow} deny=${prev.deny}`);
    const muted = log.filter((l) => l.startsWith('ow '))[1]!;
    expect(BigInt(/deny=(\d+)/.exec(muted)![1]!) & (1n << 11n)).toBe(1n << 11n);
    expect((await activeGrants(db)).map((g) => g.preset)).toEqual(['mute']);
    // 手で外す → 前の上書きに戻る
    log = [];
    expect(await endGrant(ctx(), (await activeGrants(db))[0]!, STAFF, 'revoked', T0)).toBe('ended');
    expect(log[0]).toBe(`ow ${CH} ${USER} allow=${prev.allow} deny=${prev.deny}`);
    // 前の上書きがなければ消す
    log = [];
    await grantPerm(ctx(), { ...base, preset: 'view', channels: channels() });
    await endGrant(ctx(), (await activeGrants(db))[0]!, STAFF, 'revoked', T0);
    expect(log).toContain(`delow ${CH} ${USER}`);
  });

  it('のばす・残り時間の書き方', async () => {
    await grantPerm(ctx(), { memberId: USER, channelId: CH, preset: 'speak', minutes: 60, reason: '', by: STAFF, byLevel: 'shinshoku', channels: channels(), now: T0 });
    const g = (await activeGrants(db))[0]!;
    expect(await extendGrant(ctx(), g.id, 1440, STAFF)).toBe(true);
    expect((await activeGrants(db))[0]!.expiresAt).toEqual(new Date(T0.getTime() + (60 + 1440) * 60_000));
    expect(remaining(new Date(T0.getTime() + 90 * 60_000), T0)).toBe('あと 1 時間 30 分');
    expect(remaining(new Date(T0.getTime() + (1440 + 120) * 60_000), T0)).toBe('あと 1 日 2 時間');
    expect(remaining(new Date(T0.getTime() + 5 * 60_000), T0)).toBe('あと 5 分');
    expect((await grantPerm(ctx(), { memberId: USER, channelId: '1', preset: 'speak', minutes: 60, reason: '', by: STAFF, byLevel: 'shinshoku', channels: channels(), now: T0 })).status).toBe('not_found');
  });
});

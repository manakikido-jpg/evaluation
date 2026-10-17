import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { members } from '../src/db/schema.js';
import { deliverPresenceGift, failPresenceGift, giveToMembers, resolveGiftTargets, revokePresenceGift as revokeGift, pendingPresenceGifts, recentPresenceGifts, requestPresenceGift } from '../src/services/presenceGifts.js';
import { walletOf } from '../src/services/economy.js';
import { ticketsOf } from '../src/services/tickets.js';
import { makeDb } from './helpers.js';

const A = '780000000000000001';
const B = '780000000000000002';
const STAFF = '780000000000000009';
let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
});
afterEach(async () => {
  await close();
});

describe('🎁 浮上している人へのプレゼント', () => {
  it('人を指定して配る: ID・<@ID>・名前で探し、すぐ配る。見つからない人・退出した人は bad', async () => {
    await db.insert(members).values([
      { id: A, username: 'aoi', displayName: 'あおい' },
      { id: B, username: 'beni', displayName: 'べに' },
      { id: '780000000000000003', username: 'gone', displayName: 'さった', leftAt: new Date() },
    ]);
    expect(await resolveGiftTargets(db, `<@${A}>\nべに, aoi`)).toEqual({ ids: [A, B], bad: [] });
    expect((await resolveGiftTargets(db, 'gone\nだれ')).bad).toEqual(['gone', 'だれ']);
    const r = (await giveToMembers(db, { kind: 'coins' }, 50, 'お礼', STAFF, [A, B]))!;
    expect(r.count).toBe(2);
    expect((await walletOf(db, A)).balance).toBe(50);
    expect(await giveToMembers(db, { kind: 'coins' }, 50, 'お礼', STAFF, [])).toBeUndefined();
    expect((await revokeGift(db, r.row.id, STAFF)).status).toBe('ok');
    expect((await walletOf(db, B)).balance).toBe(0);
  });

  it('おかしな受付は断る（量・券の種類・理由）', async () => {
    expect(await requestPresenceGift(db, { kind: 'coins' }, 0, 'お礼', STAFF)).toBeUndefined();
    expect(await requestPresenceGift(db, { kind: 'ticket', ticketKind: 'nai' }, 1, 'お礼', STAFF)).toBeUndefined();
    expect(await requestPresenceGift(db, { kind: 'ticket', ticketKind: 'fuku' }, 11, 'お礼', STAFF)).toBeUndefined();
    expect(await requestPresenceGift(db, { kind: 'coins' }, 100, '', STAFF)).toBeUndefined();
    expect(await pendingPresenceGifts(db)).toEqual([]);
  });

  it('銭: オンラインの人に配る。1 件 1 回だけ（2 回目は何もしない）', async () => {
    const g = (await requestPresenceGift(db, { kind: 'coins' }, 100, 'イベントのお礼', STAFF))!;
    expect((await pendingPresenceGifts(db)).map((x) => x.id)).toEqual([g.id]);
    expect(await deliverPresenceGift(db, g.id, [A, B, A])).toEqual({ status: 'ok', count: 2 });
    expect(await deliverPresenceGift(db, g.id, [A, B])).toEqual({ status: 'done' });
    expect((await walletOf(db, A)).balance).toBe(100);
    expect((await walletOf(db, B)).balance).toBe(100);
    expect((await recentPresenceGifts(db))[0]).toMatchObject({ status: 'done', count: 2 });
    expect(await pendingPresenceGifts(db)).toEqual([]);
  });

  it('↩ 回収: 配った人から取りもどす。使っていたら残っている分だけ。1 回だけ', async () => {
    const { revokePresenceGift } = await import('../src/services/presenceGifts.js');
    const { spendWithin } = await import('../src/services/economy.js');
    const g = (await requestPresenceGift(db, { kind: 'coins' }, 100, 'まちがい', STAFF))!;
    expect(await revokePresenceGift(db, g.id, STAFF)).toEqual({ status: 'not_found' });
    await deliverPresenceGift(db, g.id, [A, B]);
    await spendWithin(db, B, 70, 'shop');
    expect(await revokePresenceGift(db, g.id, STAFF)).toEqual({ status: 'ok', taken: 130, short: 1, people: 2 });
    expect((await walletOf(db, A)).balance).toBe(0);
    expect((await walletOf(db, B)).balance).toBe(0);
    expect(await revokePresenceGift(db, g.id, STAFF)).toEqual({ status: 'not_found' });
    const t = (await requestPresenceGift(db, { kind: 'ticket', ticketKind: 'fuku' }, 2, 'まちがい', STAFF))!;
    await deliverPresenceGift(db, t.id, [A]);
    expect(await revokePresenceGift(db, t.id, STAFF)).toMatchObject({ status: 'ok', taken: 2, short: 0 });
    expect((await ticketsOf(db, A)).fuku).toBe(0);
  });

  it('券も配れる。配れなかったものは配らない', async () => {
    const g = (await requestPresenceGift(db, { kind: 'ticket', ticketKind: 'fuku' }, 2, 'お祭り', STAFF))!;
    expect(await deliverPresenceGift(db, g.id, [A])).toEqual({ status: 'ok', count: 1 });
    expect((await ticketsOf(db, A)).fuku).toBe(2);
    const h = (await requestPresenceGift(db, { kind: 'coins' }, 50, 'テスト', STAFF))!;
    await failPresenceGift(db, h.id, 'presence_off');
    expect(await deliverPresenceGift(db, h.id, [A])).toEqual({ status: 'done' });
    expect((await walletOf(db, A)).balance).toBe(0);
    expect((await recentPresenceGifts(db))[0]).toMatchObject({ status: 'failed', reason: 'presence_off' });
  });
});

describe('🎁 浮上している人', () => {
  const RANK = '780000000000000100';
  const fakeGuild = () => {
    const mk = (id: string, bot = false, rank = true) => ({ id, user: { bot }, roles: { cache: new Map(rank ? [[RANK, {}]] : []) } });
    const all = new Map([
      ['on', mk('on')],
      ['vc', mk('vc')],
      ['afk', mk('afk')],
      ['off', mk('off')],
      ['bot', mk('bot', true)],
      ['norank', mk('norank', false, false)],
    ]);
    return {
      afkChannelId: 'AFK',
      presences: { cache: new Map([['on', { userId: 'on', status: 'online' }], ['off', { userId: 'off', status: 'offline' }], ['bot', { userId: 'bot', status: 'online' }], ['norank', { userId: 'norank', status: 'idle' }]]) },
      voiceStates: { cache: new Map([['vc', { id: 'vc', channelId: 'VC1' }], ['afk', { id: 'afk', channelId: 'AFK' }], ['off', { id: 'off', channelId: null }]]) },
      members: { fetch: async ({ user }: { user: string[] }) => new Map(user.flatMap((u) => (all.has(u) ? [[u, all.get(u)!]] : []))) },
    };
  };
  it('通話にいる人だけ（オンラインかどうかは見ない）。AFK・BOT・役職なしはのぞく', async () => {
    const { onlineMemberIds } = await import('../src/discord/presenceGifts.js');
    expect(await onlineMemberIds(fakeGuild() as never, [RANK])).toEqual(['vc']);
  });
});

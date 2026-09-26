import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GuildConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { tempVoice } from '../src/db/schema.js';
import { roomPanel } from '../src/discord/rooms.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { addInvites, changeRoomKind, hourlyPerPerson, payEntry, planOf, roomOf, roomOverwrites, startRoom, type Overwrite } from '../src/services/rooms.js';
import { applyOverrides, overridesSchema } from '../src/services/settings.js';
import { members } from '../src/db/schema.js';
import { cfg as baseCfg, makeDb } from './helpers.js';

const NEOCHI = '960000000000000001';
const YOIMIYA = '960000000000000002';
const ENGAWA = '960000000000000003';
const OWNER = '830000000000000001';
const FRIEND = '830000000000000002';
const BOT = '830000000000000099';
const ROOM = '961000000000000001';
const MEMBER_ROLE = '100000000000000001';
const STAFF_ROLE = '100000000000000005';
const VIEW = 1n << 10n;
const CONNECT = 1n << 20n;

const cfg: GuildConfig = {
  ...baseCfg,
  tempVoice: {
    hubs: [
      { channelId: NEOCHI, name: '🌙 {name}の宿坊' },
      { channelId: YOIMIYA, name: '🍶 {name}の部屋' },
      { channelId: ENGAWA, name: '🍵 {name}の縁側' },
    ],
  },
  rooms: {
    once: { public: 50, invite: 200, secret: 300, twoshot: 400 },
    hourly: { public: 100, invite: 200, secret: 300, twoshot: 400 },
    boosterDiscountPercent: 100,
  },
};
const T0 = new Date('2026-09-26T12:00:00Z');
const min = (n: number) => new Date(T0.getTime() + n * 60_000);

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
});
afterEach(async () => {
  await close();
});
const open = (hubId: string) => db.insert(tempVoice).values({ channelId: ROOM, ownerId: OWNER, hubId, createdAt: T0 });

describe('部屋の種類と見える範囲', () => {
  it('払い方は名前から（宿坊 → 1 回、🍶 → 1 時間ごと、ほか → なし）。設定があればそれ', () => {
    expect(planOf(cfg, NEOCHI)).toBe('once');
    expect(planOf(cfg, YOIMIYA)).toBe('hourly');
    expect(planOf(cfg, ENGAWA)).toBe('none');
    expect(planOf({ ...cfg, tempVoice: { hubs: [{ channelId: ENGAWA, name: 'x', plan: 'hourly' }] } }, ENGAWA)).toBe('hourly');
  });

  const base: Overwrite[] = [
    { id: baseCfg.guildId, type: 0, allow: 0n, deny: VIEW },
    { id: MEMBER_ROLE, type: 0, allow: VIEW | CONNECT, deny: 0n },
    { id: STAFF_ROLE, type: 0, allow: VIEW | CONNECT, deny: 0n },
    { id: BOT, type: 1, allow: VIEW, deny: 0n },
  ];
  const who = { ownerId: OWNER, botId: BOT, invited: [FRIEND], ownerAllow: 1n << 4n };
  const find = (list: Overwrite[], id: string) => list.find((o) => o.id === id)!;

  it('公開: ロールはそのまま入れる', () => {
    const o = roomOverwrites(base, 'public', who);
    expect(find(o, MEMBER_ROLE).allow & CONNECT).toBe(CONNECT);
  });

  it('招待限定: ロール（運営も）は見えるが入れない。作った人・招待した人・BOT は入れる', () => {
    const o = roomOverwrites(base, 'invite', who);
    for (const r of [MEMBER_ROLE, STAFF_ROLE]) {
      expect(find(o, r).allow & CONNECT).toBe(0n);
      expect(find(o, r).deny & CONNECT).toBe(CONNECT);
      expect(find(o, r).allow & VIEW).toBe(VIEW);
    }
    for (const id of [OWNER, FRIEND, BOT]) expect(find(o, id).allow & (VIEW | CONNECT)).toBe(VIEW | CONNECT);
    expect(find(o, OWNER).allow & (1n << 4n)).toBe(1n << 4n);
  });

  it('シークレット: ロールには見えもしない', () => {
    const o = roomOverwrites(base, 'secret', who);
    expect(find(o, MEMBER_ROLE).deny & VIEW).toBe(VIEW);
    expect(find(o, STAFF_ROLE).allow & VIEW).toBe(0n);
    expect(find(o, FRIEND).allow & VIEW).toBe(VIEW);
  });

  it('部屋の設定のカード: 値段が並ぶ', () => {
    const json = JSON.stringify(roomPanel(cfg, { ownerId: OWNER, hubId: YOIMIYA, kind: 'public' }, 0));
    expect(json).toContain('1 時間 200 枚');
    expect(json).toContain('room:kind');
    expect(json).toContain('room:invite');
  });
});

describe('支払い', () => {
  it('宿坊: ひらくときに公開の分、種類を変えたら差額だけ', async () => {
    await addCoins(db, OWNER, 1000, 'adjust');
    await open(NEOCHI);
    expect(await startRoom(db, cfg, ROOM, T0)).toEqual({ status: 'ok', charged: 50 });
    expect(await changeRoomKind(db, cfg, ROOM, 'secret')).toEqual({ status: 'ok', charged: 250 });
    expect(await changeRoomKind(db, cfg, ROOM, 'invite')).toEqual({ status: 'ok', charged: 0 });
    expect(await changeRoomKind(db, cfg, ROOM, 'twoshot')).toEqual({ status: 'ok', charged: 100 });
    expect((await walletOf(db, OWNER)).balance).toBe(600);
    expect((await roomOf(db, ROOM))?.kind).toBe('twoshot');
  });

  it('足りなければひらけない・変えられない', async () => {
    await addCoins(db, OWNER, 60, 'adjust');
    await open(NEOCHI);
    expect(await startRoom(db, cfg, ROOM, T0)).toEqual({ status: 'ok', charged: 50 });
    expect(await changeRoomKind(db, cfg, ROOM, 'invite')).toEqual({ status: 'insufficient', price: 150 });
    expect((await roomOf(db, ROOM))?.kind).toBe('public');
    await db.delete(tempVoice);
    await open(NEOCHI);
    expect(await startRoom(db, cfg, ROOM, T0)).toEqual({ status: 'insufficient', price: 50 });
  });

  it('宵宮: 入った人それぞれが最初の 1 時間を払う。払ってある間は出入りしても払わない。足りなければ入れない', async () => {
    await addCoins(db, OWNER, 150, 'adjust');
    await addCoins(db, FRIEND, 50, 'adjust');
    await open(YOIMIYA);
    // ひらいたときには払わない（入ったときに払う）
    expect(await startRoom(db, cfg, ROOM, T0)).toEqual({ status: 'ok', charged: 0 });
    expect(await payEntry(db, cfg, ROOM, OWNER, T0)).toEqual({ status: 'ok', charged: 100 });
    expect(await payEntry(db, cfg, ROOM, OWNER, min(30))).toEqual({ status: 'already', charged: 0 });
    expect(await payEntry(db, cfg, ROOM, FRIEND, min(5))).toEqual({ status: 'insufficient', price: 100 });
    expect((await walletOf(db, OWNER)).balance).toBe(50);
    // 宿坊（1 回払い）の部屋では、入った人は払わない
    expect(await payEntry(db, cfg, '961000000000000999', FRIEND, T0)).toEqual({ status: 'free', charged: 0 });
  });

  it('宵宮: 1 時間ごとに、今いる人それぞれが払う。払えない人は注意して 5 分後に抜けてもらう', async () => {
    await addCoins(db, OWNER, 1000, 'adjust');
    await addCoins(db, FRIEND, 100, 'adjust');
    await open(YOIMIYA);
    await payEntry(db, cfg, ROOM, OWNER, T0);
    await payEntry(db, cfg, ROOM, FRIEND, T0);
    const present = [{ channelId: ROOM, memberIds: [OWNER, FRIEND] }];
    expect(await hourlyPerPerson(db, cfg, present, min(59))).toEqual([]);
    expect(await hourlyPerPerson(db, cfg, present, min(60))).toEqual([
      { action: 'paid', channelId: ROOM, memberId: OWNER, charged: 100 },
      { action: 'warned', channelId: ROOM, memberId: FRIEND, price: 100 },
    ]);
    expect(await hourlyPerPerson(db, cfg, present, min(62))).toEqual([]);
    expect(await hourlyPerPerson(db, cfg, present, min(65))).toEqual([{ action: 'kick', channelId: ROOM, memberId: FRIEND }]);
    // 花びらが入れば、また払える
    await addCoins(db, FRIEND, 100, 'adjust');
    expect(await hourlyPerPerson(db, cfg, present, min(66))).toEqual([{ action: 'paid', channelId: ROOM, memberId: FRIEND, charged: 100 }]);
    expect((await walletOf(db, OWNER)).balance).toBe(800);
  });

  it('宵宮: 招待限定などにすると、次の 1 時間からはその値段。作った人は今の 1 時間の差額', async () => {
    await addCoins(db, OWNER, 1000, 'adjust');
    await addCoins(db, FRIEND, 1000, 'adjust');
    await open(YOIMIYA);
    await payEntry(db, cfg, ROOM, OWNER, T0);
    await payEntry(db, cfg, ROOM, FRIEND, T0);
    expect(await changeRoomKind(db, cfg, ROOM, 'secret')).toEqual({ status: 'ok', charged: 200 });
    const actions = await hourlyPerPerson(db, cfg, [{ channelId: ROOM, memberIds: [OWNER, FRIEND] }], min(60));
    expect(actions.map((a) => (a.action === 'paid' ? a.charged : a.action))).toEqual([300, 300]);
  });

  it('無料（0 枚）なら払わない', async () => {
    const free = applyOverrides(cfg, overridesSchema.parse({ rooms: { hourly: { public: 0, invite: 0, secret: 0, twoshot: 0 } } }));
    await open(YOIMIYA);
    expect(await payEntry(db, free, ROOM, OWNER, T0)).toEqual({ status: 'free', charged: 0 });
    expect(await hourlyPerPerson(db, free, [{ channelId: ROOM, memberIds: [OWNER] }], min(60))).toEqual([]);
  });

  it('奉納（ブースト）している人は部屋代が割引（100% なら無料）', async () => {
    await db.insert(members).values({ id: FRIEND, username: 'f', displayName: 'f', boostingSince: T0 });
    await addCoins(db, OWNER, 1000, 'adjust');
    await open(YOIMIYA);
    expect(await payEntry(db, cfg, ROOM, FRIEND, T0)).toEqual({ status: 'free', charged: 0 });
    expect(await payEntry(db, cfg, ROOM, OWNER, T0)).toEqual({ status: 'ok', charged: 100 });
    const half: GuildConfig = { ...cfg, rooms: { ...cfg.rooms, boosterDiscountPercent: 50 } };
    await addCoins(db, FRIEND, 100, 'adjust');
    expect(await hourlyPerPerson(db, half, [{ channelId: ROOM, memberIds: [FRIEND] }], min(1))).toEqual([{ action: 'paid', channelId: ROOM, memberId: FRIEND, charged: 50 }]);
  });

  it('招待した人を覚える（重ならない）', async () => {
    await open(NEOCHI);
    await addInvites(db, ROOM, [FRIEND]);
    expect((await addInvites(db, ROOM, [FRIEND]))?.invited).toEqual([FRIEND]);
  });
});

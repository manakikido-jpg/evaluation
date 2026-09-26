import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GuildConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { tempVoice } from '../src/db/schema.js';
import { roomPanel } from '../src/discord/rooms.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { addInvites, changeRoomKind, hourlyRooms, planOf, roomOf, roomOverwrites, startRoom, type Overwrite } from '../src/services/rooms.js';
import { applyOverrides, overridesSchema } from '../src/services/settings.js';
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

  it('宵宮: 1 時間ごと。払えなければ公開に戻し、公開も払えなければ注意して 5 分後に閉じる', async () => {
    await addCoins(db, OWNER, 500, 'adjust');
    await open(YOIMIYA);
    await startRoom(db, cfg, ROOM, T0); // 100
    await changeRoomKind(db, cfg, ROOM, 'invite'); // 差額 100
    expect(await hourlyRooms(db, cfg, min(59))).toEqual([]);
    expect(await hourlyRooms(db, cfg, min(60))).toEqual([{ action: 'paid', channelId: ROOM, charged: 200 }]);
    expect((await walletOf(db, OWNER)).balance).toBe(100);
    // 次の 1 時間: 招待限定（200）は払えないので、公開（100）に戻す
    expect(await hourlyRooms(db, cfg, min(120))).toEqual([{ action: 'downgraded', channelId: ROOM, charged: 100, from: 'invite' }]);
    expect((await roomOf(db, ROOM))?.kind).toBe('public');
    // その次: 公開も払えない
    expect(await hourlyRooms(db, cfg, min(180))).toEqual([{ action: 'warned', channelId: ROOM }]);
    expect(await hourlyRooms(db, cfg, min(183))).toEqual([]);
    expect(await hourlyRooms(db, cfg, min(185))).toEqual([{ action: 'close', channelId: ROOM }]);
  });

  it('無料（0 枚）なら払わずに続く', async () => {
    const free = applyOverrides(cfg, overridesSchema.parse({ rooms: { hourly: { public: 0, invite: 0, secret: 0, twoshot: 0 } } }));
    await open(YOIMIYA);
    expect(await startRoom(db, free, ROOM, T0)).toEqual({ status: 'ok', charged: 0 });
    expect(await hourlyRooms(db, free, min(60))).toEqual([{ action: 'paid', channelId: ROOM, charged: 0 }]);
  });

  it('招待した人を覚える（重ならない）', async () => {
    await open(NEOCHI);
    await addInvites(db, ROOM, [FRIEND]);
    expect((await addInvites(db, ROOM, [FRIEND]))?.invited).toEqual([FRIEND]);
  });
});

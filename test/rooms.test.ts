import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GuildConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { tempVoice } from '../src/db/schema.js';
import { roomChannelName, roomNotice, roomPanel } from '../src/discord/rooms.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { addInvites, changeRoomKind, hourlyPerPerson, payEntry, planOf, roomOf, roomOverwrites, startRoom, transferRoom, type Overwrite } from '../src/services/rooms.js';
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

  it('部屋の案内: 値段が並び、「⚙ 部屋の設定」ボタンだけ（だれでも見える）', () => {
    const json = JSON.stringify(roomNotice(cfg, { ownerId: OWNER, hubId: YOIMIYA }));
    expect(json).toContain('1 時間 200 枚');
    expect(json).toContain('room:open');
    expect(json).not.toContain('room:kind');
    // 値段のない部屋（縁側など）は値段を出さない
    expect(JSON.stringify(roomNotice(cfg, { ownerId: OWNER, hubId: ENGAWA }))).not.toContain('枚');
  });

  it('部屋の設定（本人だけに見える）: チャンネル名・ステータス・人数制限・入室許可者・閉じる。種類は 1 回だけ', () => {
    const open = JSON.stringify(roomPanel(cfg, { ownerId: OWNER, hubId: YOIMIYA, kind: 'public', kindLocked: false, invited: [] }, { name: '🍶 りくの部屋', userLimit: 0 }));
    for (const id of ['room:name', 'room:status', 'room:limit', 'room:invite', 'room:kind', 'room:close']) expect(open).toContain(id);
    expect(open).toContain('まだ 1 回選べます');
    const locked = JSON.stringify(roomPanel(cfg, { ownerId: OWNER, hubId: YOIMIYA, kind: 'invite', kindLocked: true, invited: [FRIEND] }, { name: 'x', userLimit: 4 }, '人数制限を 4 人にしました'));
    expect(locked).not.toContain('room:kind');
    expect(locked).toContain('決定済み');
    expect(locked).toContain(`<@${FRIEND}>`);
    expect(locked).toContain('✅ 人数制限を 4 人にしました');
    // 縁側などは種類を出さない
    expect(JSON.stringify(roomPanel(cfg, { ownerId: OWNER, hubId: ENGAWA, kind: 'public', kindLocked: false, invited: [] }, { name: 'x', userLimit: 0 }))).not.toContain('room:kind');
  });

  it('運営として開く: 決まっていても種類を変えられる。/部屋の設定 から開くと、ボタンに部屋の ID が付く', () => {
    const ROOM = '930000000000000077';
    const staff = JSON.stringify(
      roomPanel(cfg, { ownerId: OWNER, hubId: YOIMIYA, kind: 'secret', kindLocked: true, invited: [] }, { name: 'x', userLimit: 0 }, undefined, { staff: true, at: ROOM }),
    );
    expect(staff).toContain('運営として開いています');
    expect(staff).toContain(`room:kind|${ROOM}`);
    expect(staff).toContain(`room:name|${ROOM}`);
    expect(staff).toContain('部屋の種類を変える（運営）');
  });
});

describe('支払い', () => {
  it('宿坊: ひらくときに公開の分、種類を選んだら差額だけ。種類は 1 回だけ（あとから切り替えられない）', async () => {
    await addCoins(db, OWNER, 1000, 'adjust');
    await open(NEOCHI);
    expect(await startRoom(db, cfg, ROOM, T0)).toEqual({ status: 'ok', charged: 50 });
    expect((await roomOf(db, ROOM))?.kindLocked).toBe(false);
    expect(await changeRoomKind(db, cfg, ROOM, 'secret')).toEqual({ status: 'ok', charged: 250 });
    expect(await changeRoomKind(db, cfg, ROOM, 'public')).toEqual({ status: 'locked' });
    expect(await changeRoomKind(db, cfg, ROOM, 'twoshot')).toEqual({ status: 'locked' });
    expect((await walletOf(db, OWNER)).balance).toBe(700);
    expect(await roomOf(db, ROOM)).toMatchObject({ kind: 'secret', kindLocked: true });
  });

  it('運営は決まったあとでも種類を変えられる（差額は取らない）', async () => {
    const { staffSetRoomKind } = await import('../src/services/rooms.js');
    await addCoins(db, OWNER, 1000, 'adjust');
    await open(NEOCHI);
    await startRoom(db, cfg, ROOM, T0);
    await changeRoomKind(db, cfg, ROOM, 'public');
    const before = (await walletOf(db, OWNER)).balance;
    expect(await staffSetRoomKind(db, ROOM, 'twoshot')).toMatchObject({ kind: 'twoshot', kindLocked: true });
    expect(await staffSetRoomKind(db, ROOM, 'secret')).toMatchObject({ kind: 'secret' });
    expect((await walletOf(db, OWNER)).balance).toBe(before);
    expect(await staffSetRoomKind(db, '930000000000009999', 'secret')).toBeUndefined();
  });

  it('公開のまま「公開」を選んでも決定になる（あとから非公開にできない）', async () => {
    await addCoins(db, OWNER, 100, 'adjust');
    await open(NEOCHI);
    await startRoom(db, cfg, ROOM, T0);
    expect(await changeRoomKind(db, cfg, ROOM, 'public')).toEqual({ status: 'ok', charged: 0 });
    expect(await changeRoomKind(db, cfg, ROOM, 'invite')).toEqual({ status: 'locked' });
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

describe('部屋主の権限を譲渡', () => {
  it('部屋主だけが譲渡できる。前の部屋主は入室許可者に入る', async () => {
    await open(YOIMIYA);
    expect(await transferRoom(db, ROOM, FRIEND, OWNER, false)).toEqual({ status: 'not_owner' });
    expect(await transferRoom(db, ROOM, OWNER, OWNER, false)).toEqual({ status: 'invalid' });
    const r = await transferRoom(db, ROOM, OWNER, FRIEND, false);
    expect(r.status).toBe('ok');
    expect(await roomOf(db, ROOM)).toMatchObject({ ownerId: FRIEND, payerId: null, invited: [OWNER] });
    expect(await transferRoom(db, ROOM, OWNER, FRIEND, false)).toEqual({ status: 'not_owner' });
  });

  it('宵宮: 譲渡したら、その時間以降の部屋主の分は新しい部屋主が払う', async () => {
    await addCoins(db, OWNER, 1000, 'adjust');
    await addCoins(db, FRIEND, 1000, 'adjust');
    await open(YOIMIYA);
    await payEntry(db, cfg, ROOM, OWNER, T0);
    await payEntry(db, cfg, ROOM, FRIEND, T0);
    await transferRoom(db, ROOM, OWNER, FRIEND, false);
    await hourlyPerPerson(db, cfg, [{ channelId: ROOM, memberIds: [OWNER, FRIEND] }], min(60));
    expect((await walletOf(db, OWNER)).balance).toBe(800);
    expect((await walletOf(db, FRIEND)).balance).toBe(800);
  });

  it('宵宮:「部屋代は自分が持つ」なら、前の部屋主が新しい部屋主の分も払う（抜けたあとも）', async () => {
    await addCoins(db, OWNER, 1000, 'adjust');
    await addCoins(db, FRIEND, 1000, 'adjust');
    await open(YOIMIYA);
    await payEntry(db, cfg, ROOM, OWNER, T0);
    await payEntry(db, cfg, ROOM, FRIEND, T0);
    await transferRoom(db, ROOM, OWNER, FRIEND, true);
    expect(await roomOf(db, ROOM)).toMatchObject({ ownerId: FRIEND, payerId: OWNER });
    // 前の部屋主は抜けた。新しい部屋主の 1 時間分は前の部屋主から
    await hourlyPerPerson(db, cfg, [{ channelId: ROOM, memberIds: [FRIEND] }], min(60));
    expect((await walletOf(db, OWNER)).balance).toBe(800);
    expect((await walletOf(db, FRIEND)).balance).toBe(900);
    // もう一度譲渡して戻しても、持つ人を引きつぐ
    await transferRoom(db, ROOM, FRIEND, OWNER, true);
    expect(await roomOf(db, ROOM)).toMatchObject({ ownerId: OWNER, payerId: null });
  });

  it('宿坊: 譲渡したあとに種類を選ぶと、新しい部屋主が払う（自分が持つなら前の部屋主）', async () => {
    await addCoins(db, OWNER, 1000, 'adjust');
    await addCoins(db, FRIEND, 1000, 'adjust');
    await open(NEOCHI);
    await startRoom(db, cfg, ROOM, T0);
    await transferRoom(db, ROOM, OWNER, FRIEND, true);
    expect(await changeRoomKind(db, cfg, ROOM, 'invite')).toEqual({ status: 'ok', charged: 150 });
    expect((await walletOf(db, OWNER)).balance).toBe(800);
    expect((await walletOf(db, FRIEND)).balance).toBe(1000);
  });
});


describe('部屋名のシクレ表示', () => {
  it('名前を変えても目印が残り、重複せず、公開に戻すと外れる', () => {
    expect(roomChannelName('aisの部屋', 'secret')).toBe('🤫 シクレ｜aisの部屋');
    expect(roomChannelName('🤫 シクレ｜🤫 シクレ｜aisの部屋', 'secret')).toBe('🤫 シクレ｜aisの部屋');
    expect(roomChannelName('新しい名前', 'secret')).toBe('🤫 シクレ｜新しい名前');
    expect(roomChannelName('🤫 シクレ｜aisの部屋', 'public')).toBe('aisの部屋');
    expect(roomChannelName('招待の部屋', 'invite')).toBe('招待の部屋');
    expect(roomChannelName('あ'.repeat(100), 'secret')).toHaveLength(100);
  });
});

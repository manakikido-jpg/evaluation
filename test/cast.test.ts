import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelType, type Guild, type Interaction } from 'discord.js';
import { CastApp } from '../src/discord/cast.js';
import type { DiscordActions } from '../src/lib/discordRest.js';
import type { Db } from '../src/db/client.js';
import {
  acceptSession,
  applyCast,
  addMenuItem,
  addOption,
  removeOption,
  getCast,
  menuOf,
  removeMenuItem,
  CAST_DEFAULTS,
  cancelSession,
  castStats,
  castTick,
  disputeSession,
  extendSession,
  finishSession,
  getSession,
  setSessionPlace,
  minorWindowOk,
  nightEnd,
  parsePrice,
  parseTags,
  rateSession,
  requestSession,
  resolveSession,
  setBlocked,
  setCastStatus,
  setWaiting,
} from '../src/services/cast.js';
import { upsertMember } from '../src/services/members.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { cfg, makeDb } from './helpers.js';

const CAST = '880000000000000001';
const ADULT = '880000000000000002';
const MINOR = '880000000000000003';
const c = CAST_DEFAULTS;
const MIN = 60_000;
/** 日本時間 2026-10-01 20:00 */
const T20 = new Date('2026-10-01T11:00:00Z');
const profile = { bio: 'よろしく', tags: ['寝落ち', '雑談'], price30: 300, price60: 500, priceNight: 2000, minorOk: true };

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  await applyCast(db, c, { id: CAST, adult: true }, profile, T20);
  await setCastStatus(db, CAST, 'active', 'staff', T20);
  await addCoins(db, ADULT, 10_000, 'adjust');
  await addCoins(db, MINOR, 10_000, 'adjust');
});
afterEach(async () => {
  vi.useRealTimers();
  await close();
});

describe('🎀 キャスト', () => {
  it('申し込み: 18 歳以上だけ・値段は範囲の中。読みやすい数とタグ', async () => {
    expect((await applyCast(db, c, { id: MINOR, adult: false }, profile, T20)).status).toBe('not_adult');
    expect((await applyCast(db, c, { id: ADULT, adult: true }, { ...profile, price30: -1 }, T20)).status).toBe('invalid');
    expect((await applyCast(db, c, { id: CAST, adult: true }, profile, T20)).status).toBe('already');
    expect(parsePrice('１，０００枚')).toBe(1000);
    expect(parsePrice('')).toBe(0);
    expect(parsePrice('abc')).toBeNaN();
    expect(parseTags('寝落ち、雑談・ゲーム 雑談')).toEqual(['寝落ち', '雑談', 'ゲーム']);
  });

  it('時刻: 寝落ちは朝 7 時まで。未成年の人の雑談は 6〜22 時に収まるときだけ', () => {
    expect(nightEnd(T20).toISOString()).toBe('2026-09-30T22:00:00.000Z'.replace('09-30', '10-01'));
    expect(minorWindowOk(T20, 60)).toBe(true);
    expect(minorWindowOk(new Date('2026-10-01T12:30:00Z'), 60)).toBe(false);
    expect(minorWindowOk(new Date('2026-09-30T20:00:00Z'), 30)).toBe(false);
  });

  it('今すぐ: 預かる → 受ける → 時間で終わって手数料を引いて渡す → 評価', async () => {
    const r = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: '60' }, T20);
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.session).toMatchObject({ status: 'requested', isPublic: false, price: 500 });
    expect((await walletOf(db, ADULT)).balance).toBe(9500);
    expect((await requestSession(db, c, { castId: CAST, customerId: MINOR, customerAdult: false, plan: '30' }, T20)).status).toBe('busy');
    expect(await acceptSession(db, r.session.id, ADULT, T20)).toBeUndefined();
    const a = await acceptSession(db, r.session.id, CAST, T20);
    expect(a?.status).toBe('active');
    // のばす（30 分・300 枚）
    const ext = await extendSession(db, r.session.id, ADULT, T20);
    expect(ext).toMatchObject({ status: 'ok', session: { price: 800, minutes: 90 } });
    // 5 分前の知らせ → 時間で終わる
    const w = await castTick(db, c, new Date(T20.getTime() + 86 * MIN));
    expect(w.warn).toHaveLength(1);
    const t = await castTick(db, c, new Date(T20.getTime() + 90 * MIN));
    expect(t.finished).toHaveLength(1);
    expect((await walletOf(db, CAST)).balance).toBe(720);
    expect(await rateSession(db, r.session.id, ADULT, 5)).toBeTruthy();
    expect(await rateSession(db, r.session.id, ADULT, 4)).toBeUndefined();
    expect(await castStats(db, new Date(0))).toEqual([{ castId: CAST, count: 1, earned: 720, ratingAvg: 5, ratings: 1 }]);
    // 5 分後に部屋を片付ける
    expect((await castTick(db, c, new Date(T20.getTime() + 95 * MIN))).cleanup).toHaveLength(0);
  });

  it('未成年の人: 公開の雑談だけ（寝落ち・予約・22 時をこえる・60 分をこえる延長はできない）', async () => {
    expect((await requestSession(db, c, { castId: CAST, customerId: MINOR, customerAdult: false, plan: 'night' }, T20)).status).toBe('minor_plan');
    expect((await requestSession(db, c, { castId: CAST, customerId: MINOR, customerAdult: false, plan: '60', startAt: new Date(T20.getTime() + 60 * MIN) }, T20)).status).toBe('minor_reserve');
    expect((await requestSession(db, c, { castId: CAST, customerId: MINOR, customerAdult: false, plan: '60' }, new Date('2026-10-01T12:30:00Z'))).status).toBe('minor_hours');
    const r = await requestSession(db, c, { castId: CAST, customerId: MINOR, customerAdult: false, plan: '60' }, T20);
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.session.isPublic).toBe(true);
    await acceptSession(db, r.session.id, CAST, T20);
    expect((await extendSession(db, r.session.id, MINOR, T20)).status).toBe('minor_limit');
    // 受けないキャストには指名できない
    await finishSession(db, c, r.session.id, MINOR, T20);
    await setCastStatus(db, CAST, 'active', 'staff');
    const { updateProfile } = await import('../src/services/cast.js');
    await updateProfile(db, c, CAST, { ...profile, minorOk: false });
    expect((await requestSession(db, c, { castId: CAST, customerId: MINOR, customerAdult: false, plan: '30' }, T20)).status).toBe('minor_off');
  });

  it('断る・返事がない・取り消し・ブロック: 全額戻す。キャストが途中で終えると話した分だけ', async () => {
    const r = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: '30' }, T20);
    if (r.status !== 'ok') throw new Error(r.status);
    expect(await cancelSession(db, r.session.id, ADULT, 'declined', T20)).toBeUndefined();
    expect((await cancelSession(db, r.session.id, CAST, 'declined', T20))?.status).toBe('declined');
    expect((await walletOf(db, ADULT)).balance).toBe(10_000);
    // 返事がない
    const r2 = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: '30' }, T20);
    if (r2.status !== 'ok') throw new Error(r2.status);
    expect((await castTick(db, c, new Date(T20.getTime() + 11 * MIN))).expired).toHaveLength(1);
    expect((await walletOf(db, ADULT)).balance).toBe(10_000);
    // キャストが半分で終える: 500 の半分 250 から手数料 25 → 225。残り 250 は戻す
    const r3 = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: '60' }, T20);
    if (r3.status !== 'ok') throw new Error(r3.status);
    await acceptSession(db, r3.session.id, CAST, T20);
    await finishSession(db, c, r3.session.id, CAST, new Date(T20.getTime() + 30 * MIN));
    expect((await walletOf(db, CAST)).balance).toBe(225);
    expect((await walletOf(db, ADULT)).balance).toBe(9750);
    // ブロック
    await setBlocked(db, CAST, ADULT, true);
    expect((await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: '30' }, T20)).status).toBe('blocked');
  });

  it('予約: 受けたら時刻に始まる。受けないまま時刻が来たら戻す。通報は運営が決める', async () => {
    const at = new Date(T20.getTime() + 60 * MIN);
    const r = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: '60', startAt: at }, T20);
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.session.status).toBe('reserved');
    expect((await acceptSession(db, r.session.id, CAST, T20))?.status).toBe('accepted');
    const t = await castTick(db, c, at);
    expect(t.started.map((s) => s.status)).toEqual(['active']);
    expect((await disputeSession(db, r.session.id, ADULT))?.status).toBe('disputed');
    // 通報中は時間が来ても渡さない
    expect((await castTick(db, c, new Date(at.getTime() + 61 * MIN))).finished).toEqual([]);
    expect((await resolveSession(db, c, r.session.id, 'refund', 'staff'))?.status).toBe('refunded');
    expect((await walletOf(db, ADULT)).balance).toBe(10_000);
    // 待機は時間で切れる
    await setWaiting(db, CAST, 2, T20);
    expect((await castTick(db, c, new Date(T20.getTime() + 121 * MIN))).waitingOff).toBe(1);
  });
  it('予約時間の重なりを拒み、直後の予約は受ける。拒んだときは課金しない', async () => {
    const at = new Date(T20.getTime() + 60 * MIN);
    const r = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: '60', startAt: at }, T20);
    expect(r.status).toBe('ok');
    const overlap = await requestSession(db, c, { castId: CAST, customerId: MINOR, customerAdult: true, plan: '30', startAt: new Date(at.getTime() + 59 * MIN) }, T20);
    expect(overlap.status).toBe('overlap');
    expect((await walletOf(db, MINOR)).balance).toBe(10_000);
    expect((await requestSession(db, c, { castId: CAST, customerId: MINOR, customerAdult: true, plan: '30', startAt: new Date(at.getTime() + 60 * MIN) }, T20)).status).toBe('ok');
  });

  it('寝落ちの予約・即時指名・返事待ちの時間も重なりに数える', async () => {
    const at = new Date(T20.getTime() + 30 * MIN);
    const r = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: 'night', startAt: at }, T20);
    if (r.status !== 'ok') throw new Error(r.status);
    expect((await requestSession(db, c, { castId: CAST, customerId: MINOR, customerAdult: true, plan: '30' }, T20)).status).toBe('overlap');
    expect((await requestSession(db, c, { castId: CAST, customerId: MINOR, customerAdult: true, plan: '30', startAt: new Date(at.getTime() + 120 * MIN) }, T20)).status).toBe('overlap');
    await cancelSession(db, r.session.id, ADULT, 'canceled', T20);
    const immediate = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: '30' }, T20);
    expect(immediate.status).toBe('ok');
    // 返事が 10 分遅れても次の予約と重ならないようにする
    expect((await requestSession(db, c, { castId: CAST, customerId: MINOR, customerAdult: true, plan: '30', startAt: new Date(T20.getTime() + 35 * MIN) }, T20)).status).toBe('overlap');
  });

  it('次の予約に重なる延長は課金せず、同じ延長ボタンの連打は1回だけ', async () => {
    const r = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: '30' }, T20);
    if (r.status !== 'ok') throw new Error(r.status);
    await acceptSession(db, r.session.id, CAST, T20);
    const at = new Date(T20.getTime() + 60 * MIN);
    expect((await requestSession(db, c, { castId: CAST, customerId: MINOR, customerAdult: true, plan: '30', startAt: at }, T20)).status).toBe('ok');
    const results = await Promise.all([
      extendSession(db, r.session.id, ADULT, T20, 0),
      extendSession(db, r.session.id, ADULT, T20, 0),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['already_extended', 'ok']);
    expect((await walletOf(db, ADULT)).balance).toBe(9400);
    expect(await getSession(db, r.session.id)).toMatchObject({ minutes: 60, price: 600, extensions: 1 });
    expect((await extendSession(db, r.session.id, ADULT, T20, 1)).status).toBe('overlap');
    expect((await walletOf(db, ADULT)).balance).toBe(9400);
    await finishSession(db, c, r.session.id, 'system', at);
    expect((await walletOf(db, CAST)).balance).toBe(540);
  });

  it('予約の部屋を作れなかったら開始せず全額を1回だけ戻す', async () => {
    const at = new Date(T20.getTime() + 60 * MIN);
    const r = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: '60', startAt: at }, T20);
    if (r.status !== 'ok') throw new Error(r.status);
    await acceptSession(db, r.session.id, CAST, T20);
    const create = vi.fn(async () => { throw new Error('missing permission'); });
    const tick = await castTick(db, c, at, create);
    expect(create).toHaveBeenCalledOnce();
    expect(tick.started).toHaveLength(0);
    expect(tick.expired).toHaveLength(1);
    expect(await getSession(db, r.session.id)).toMatchObject({ status: 'declined', startedAt: null, paid: 0 });
    expect((await walletOf(db, ADULT)).balance).toBe(10_000);
    expect((await castTick(db, c, new Date(at.getTime() + 120 * MIN), create)).finished).toHaveLength(0);
    expect(create).toHaveBeenCalledOnce();
    expect((await walletOf(db, ADULT)).balance).toBe(10_000);
    expect((await walletOf(db, CAST)).balance).toBe(0);
  });

  it('予約は部屋ができてから開始し、定刻の終了を守って次の予約と重ならない', async () => {
    const at = new Date(T20.getTime() + 60 * MIN);
    const r = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: '30', startAt: at }, T20);
    if (r.status !== 'ok') throw new Error(r.status);
    await acceptSession(db, r.session.id, CAST, T20);
    const next = await requestSession(db, c, { castId: CAST, customerId: MINOR, customerAdult: true, plan: '30', startAt: new Date(at.getTime() + 30 * MIN) }, T20);
    if (next.status !== 'ok') throw new Error(next.status);
    await acceptSession(db, next.session.id, CAST, T20);
    const tick = await castTick(db, c, new Date(at.getTime() + 5 * MIN), async (s) => {
      expect((await getSession(db, s.id))?.status).toBe('accepted');
      await setSessionPlace(db, s.id, { channelId: '990000000000000001' });
      return true;
    });
    expect(tick.started).toHaveLength(1);
    expect(tick.started[0]?.endsAt).toEqual(new Date(at.getTime() + 30 * MIN));
    expect(tick.expired).toHaveLength(0);
  });

  it('予約の終了時刻を過ぎていたら始めず返金する', async () => {
    const at = new Date(T20.getTime() + 60 * MIN);
    const r = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: '30', startAt: at }, T20);
    if (r.status !== 'ok') throw new Error(r.status);
    await acceptSession(db, r.session.id, CAST, T20);
    const tick = await castTick(db, c, new Date(at.getTime() + 31 * MIN), async (s) => {
      await setSessionPlace(db, s.id, { channelId: '990000000000000001' });
      return true;
    });
    expect(tick.started).toHaveLength(0);
    expect(tick.expired).toHaveLength(1);
    expect(tick.cleanup).toHaveLength(1);
    expect((await walletOf(db, ADULT)).balance).toBe(10_000);
  });

  it('同時の予約は1件だけ。延長した後に古い終了処理が来ても精算しない', async () => {
    const at = new Date(T20.getTime() + 60 * MIN);
    const results = await Promise.all([ADULT, MINOR].map((id) => requestSession(db, c, { castId: CAST, customerId: id, customerAdult: true, plan: '30', startAt: at }, T20)));
    expect(results.map((r) => r.status).sort()).toEqual(['ok', 'overlap']);
    const booked = results.find((r) => r.status === 'ok');
    if (!booked || booked.status !== 'ok') throw new Error('no booking');
    await cancelSession(db, booked.session.id, booked.session.customerId, 'canceled', T20);
    const r = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: '30' }, T20);
    if (r.status !== 'ok') throw new Error(r.status);
    await acceptSession(db, r.session.id, CAST, T20);
    await extendSession(db, r.session.id, ADULT, T20, 0);
    expect(await finishSession(db, c, r.session.id, 'system', new Date(T20.getTime() + 30 * MIN))).toBeUndefined();
    expect((await getSession(db, r.session.id))?.status).toBe('active');
    expect((await walletOf(db, CAST)).balance).toBe(0);
  });

});

describe('🎀 キャストの見た目', () => {
  it('メニュー: 画像と、待機中から並ぶ選ぶメニュー・ボタン。部屋のメッセージ', async () => {
    const { castPanel, sessionMessage, castRoomName, roomEntry } = await import('../src/discord/cast.js');
    const { getCast } = await import('../src/services/cast.js');
    expect(castRoomName('さくら')).toBe('🌸 さくらの間');
    expect(castRoomName('あ'.repeat(200)).length).toBeLessThanOrEqual(100);
    expect(roomEntry(cfg.guildId, CAST)).toMatchObject({ style: 5, label: '部屋へ入る', url: `https://discord.com/channels/${cfg.guildId}/${CAST}` });
    const cast = (await getCast(db, CAST))!;
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const p = castPanel(
      [
        { cast, name: 'さくら', state: 'off' },
        { cast: { ...cast, memberId: ADULT }, name: 'もも', state: 'waiting' },
      ],
      { data: png, contentType: 'image/png' },
    );
    expect(p.embeds![0]!.image).toEqual({ url: 'attachment://cast-menu.png' });
    expect(p.files![0]!.name).toBe('cast-menu.png');
    const menu = JSON.stringify(p.components);
    expect(menu.indexOf('もも')).toBeLessThan(menu.indexOf('さくら'));
    for (const id of ['cast:pick', 'cast:now', 'cast:rank', 'cast:me']) expect(menu).toContain(id);
    expect(menu).not.toContain('cast:apply');
    // キャストがいなければメニューは出さない
    expect(JSON.stringify(castPanel([]).components)).not.toContain('cast:pick');
    const r = await requestSession(db, c, { castId: CAST, customerId: MINOR, customerAdult: false, plan: '30' }, T20);
    if (r.status !== 'ok') throw new Error(r.status);
    expect(JSON.stringify(sessionMessage(r.session, c, '🪙銭'))).toContain(`cast:accept:${r.session.id}`);
    const a = (await acceptSession(db, r.session.id, CAST, T20))!;
    const active = JSON.stringify(sessionMessage(a, c, '🪙銭'));
    expect(active).toContain('公開の部屋です');
    expect(active).toContain(`cast:ext:${r.session.id}:0`);
    expect(active).toContain(`cast:report:${r.session.id}`);
  });
});


describe('🎀 キャストのDiscord操作', () => {
  const roomId = '990000000000000001';
  function fixture(fail = false) {
    const room = { id: roomId, type: ChannelType.GuildVoice, send: vi.fn(async () => ({})), delete: vi.fn(async () => undefined) };
    const cache = new Map<string, unknown>();
    const create = vi.fn(async () => {
      if (fail) throw new Error('missing channel permission');
      cache.set(roomId, room);
      return room;
    });
    const guild = { id: cfg.guildId, channels: { cache, create }, members: { me: null } } as unknown as Guild;
    const discord = { sendDm: vi.fn(async () => true), sendMessage: vi.fn(async () => ({ id: '990000000000000002' })), editMessage: vi.fn(async () => undefined) };
    const tcfg = { ...cfg, roles: { ...cfg.roles, yoimairi: '990000000000000003' } };
    const app = new CastApp(db, () => tcfg, discord as unknown as DiscordActions);
    app.attach(guild);
    const interaction = {
      customId: `cast:go:${CAST}:30`, guildId: cfg.guildId, user: { id: ADULT },
      member: { roles: { cache: new Map([[tcfg.roles.yoimairi, {}]]) } },
      inCachedGuild: () => true, isStringSelectMenu: () => false, isUserSelectMenu: () => false,
      isModalSubmit: () => false, isButton: () => true,
      deferUpdate: vi.fn(async () => undefined), editReply: vi.fn(async () => undefined),
    };
    return { app, room, create, discord, interaction };
  }

  it('即時指名はキャスト名の部屋を作り、利用者に入室ボタンを出す', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(T20);
    await upsertMember(db, { id: CAST, username: 'sakura', displayName: 'さくら', avatarUrl: null, joinedAt: null, roleIds: [], isBot: false });
    const f = fixture();
    await f.app.onInteraction(f.interaction as unknown as Interaction);
    expect(f.create).toHaveBeenCalledWith(expect.objectContaining({ name: '🌸 さくらの間', userLimit: 2 }));
    expect(f.interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ components: [{ type: 1, components: [expect.objectContaining({ label: '部屋へ入る', url: `https://discord.com/channels/${cfg.guildId}/${roomId}` })] }] }));
    expect((await walletOf(db, ADULT)).balance).toBe(9700);
  });

  it('即時指名の部屋作成が失敗したら全額戻す', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(T20);
    const f = fixture(true);
    await f.app.onInteraction(f.interaction as unknown as Interaction);
    expect(f.interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('銭を戻しました') }));
    expect((await walletOf(db, ADULT)).balance).toBe(10_000);
    expect((await walletOf(db, CAST)).balance).toBe(0);
  });

  it('予約開始では部屋を1つ作り、スレッドに入室ボタンを出す', async () => {
    const at = new Date(T20.getTime() + 60 * MIN);
    const r = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: '60', startAt: at }, T20);
    if (r.status !== 'ok') throw new Error(r.status);
    await acceptSession(db, r.session.id, CAST, T20);
    await setSessionPlace(db, r.session.id, { threadId: '990000000000000004' });
    const f = fixture();
    await Promise.all([f.app.tick(at), f.app.tick(at)]);
    expect(f.create).toHaveBeenCalledOnce();
    expect((await getSession(db, r.session.id))?.status).toBe('active');
    expect(f.discord.sendMessage).toHaveBeenCalledWith('990000000000000004', expect.objectContaining({ components: [{ type: 1, components: [expect.objectContaining({ label: '部屋へ入る' })] }] }));
    expect(f.discord.sendDm).toHaveBeenCalledWith(ADULT, expect.stringContaining(`https://discord.com/channels/${cfg.guildId}/${roomId}`));
  });

  it('予約の部屋作成が失敗したら、その後もキャストに払わない', async () => {
    const at = new Date(T20.getTime() + 60 * MIN);
    const r = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: '60', startAt: at }, T20);
    if (r.status !== 'ok') throw new Error(r.status);
    await acceptSession(db, r.session.id, CAST, T20);
    const f = fixture(true);
    await f.app.tick(at);
    await f.app.tick(new Date(at.getTime() + 120 * MIN));
    expect(f.create).toHaveBeenCalledOnce();
    expect((await walletOf(db, ADULT)).balance).toBe(10_000);
    expect((await walletOf(db, CAST)).balance).toBe(0);
    expect((await getSession(db, r.session.id))?.startedAt).toBeNull();
  });
  it('部屋を消せなかったら次の確認で消し直す', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(T20);
    const f = fixture();
    await f.app.onInteraction(f.interaction as unknown as Interaction);
    const session = (await import('../src/services/cast.js')).recentSessions;
    const [r] = await session(db, 1);
    if (!r) throw new Error('no session');
    await cancelSession(db, r.id, ADULT, 'canceled', T20);
    f.room.delete.mockRejectedValueOnce(new Error('temporarily unavailable'));
    await f.app.tick(T20);
    expect((await getSession(db, r.id))?.channelId).toBe(roomId);
    await f.app.tick(T20);
    expect(f.room.delete).toHaveBeenCalledTimes(2);
    expect((await getSession(db, r.id))?.channelId).toBeNull();
  });

});

describe('🎀 キャストごとのメニュー（内容・時間・値段）', () => {
  it('前の値段から作ったメニューを引きつぎ、足したメニューで指名・延長・未成年の決まり', async () => {
    await upsertMember(db, { id: CAST, username: 'c', displayName: 'C', avatarUrl: null, roleIds: [], isBot: false, joinedAt: null });
    await applyCast(db, c, { id: CAST, adult: true }, profile);
    await setCastStatus(db, CAST, 'active', 'staff');
    const cast0 = (await getCast(db, CAST))!;
    expect(menuOf(cast0).map((m) => m.id)).toEqual(['30', '60', 'night']);
    expect(await addMenuItem(db, c, CAST, { name: 'ゲーム', note: '一緒に遊ぶ', minutes: 90, price: 900, night: false })).toBe('ok');
    expect(await addMenuItem(db, c, CAST, { name: 'x', note: '', minutes: 90, price: 0, night: false })).toBe('invalid');
    // 値段は 1 銭からつけられる（はじめの下限は 1）
    expect(c.priceMin).toBe(1);
    expect(await addMenuItem(db, c, CAST, { name: '1 銭', note: '', minutes: 30, price: 1, night: false })).toBe('ok');
    expect(await removeMenuItem(db, CAST, (await getCast(db, CAST))!.menu.at(-1)!.id)).toBe(true);
    const cast = (await getCast(db, CAST))!;
    expect(cast.menu.map((m) => m.name)).toEqual(['30 分', '1 時間', '寝落ち', 'ゲーム']);
    expect(cast.price30).toBe(0);
    const game = cast.menu.find((m) => m.name === 'ゲーム')!;
    await addCoins(db, ADULT, 10000, 'adjust');
    await addCoins(db, MINOR, 10000, 'adjust');
    // 未成年の人は 60 分をこえるメニューを選べない
    expect((await requestSession(db, c, { castId: CAST, customerId: MINOR, customerAdult: false, plan: game.id }, T20)).status).toBe('minor_plan');
    expect((await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: 'nope' }, T20)).status).toBe('no_plan');
    const r = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: game.id }, T20);
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.session).toMatchObject({ plan: game.id, menuName: 'ゲーム', minutes: 90, price: 900 });
    await acceptSession(db, r.session.id, CAST, T20);
    // 30 分のばすと、同じ割合（900 / 90 分 × 30 分 = 300）
    const e = await extendSession(db, r.session.id, ADULT, new Date(T20.getTime() + MIN));
    expect(e).toMatchObject({ status: 'ok', session: { minutes: 120, price: 1200 } });
    expect(await removeMenuItem(db, CAST, game.id)).toBe(true);
    expect(await removeMenuItem(db, CAST, game.id)).toBe(false);
    expect((await getSession(db, r.session.id))?.status).toBe('active');
  });

  it('💬 内容により相談: キャストが出した時間と値段でだけ指名できる（未成年は不可）', async () => {
    await upsertMember(db, { id: CAST, username: 'c', displayName: 'C', avatarUrl: null, roleIds: [], isBot: false, joinedAt: null });
    await applyCast(db, c, { id: CAST, adult: true }, profile);
    await setCastStatus(db, CAST, 'active', 'staff');
    expect(await addMenuItem(db, c, CAST, [{ name: 'おねがい', note: '', minutes: 0, price: 0, night: false, consult: true }])).toBe('ok');
    const item = (await getCast(db, CAST))!.menu.find((m) => m.consult)!;
    expect(item).toMatchObject({ price: 0, minutes: 0, consult: true });
    await addCoins(db, ADULT, 10000, 'adjust');
    // 値段なしでは指名できない・ほかのメニューに値段を付けられない・範囲の外はだめ
    expect((await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: item.id }, T20)).status).toBe('no_plan');
    expect((await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: '30', quote: { minutes: 30, price: 100 } }, T20)).status).toBe('no_plan');
    expect((await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: item.id, quote: { minutes: 30, price: 0 } }, T20)).status).toBe('no_plan');
    expect((await requestSession(db, c, { castId: CAST, customerId: MINOR, customerAdult: false, plan: item.id, quote: { minutes: 30, price: 500 } }, T20)).status).toBe('minor_plan');
    const r = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: item.id, quote: { minutes: 45, price: 700 } }, T20);
    expect(r).toMatchObject({ status: 'ok', session: { menuName: 'おねがい（相談）', minutes: 45, price: 700 } });
    expect(r.status === 'ok' && r.balance).toBe(19300);
  });
});

describe('👨👩 男性・女性のメニューを分ける', () => {
  it('チャンネルが両方あれば分けて出す（決めていない人は両方）。片方だけなら全員を 1 つに', async () => {
    const { refreshCastPanel } = await import('../src/discord/cast.js');
    const { getCast, saveCastConfig, loadCastConfig, setCastGender, castHomeChannel } = await import('../src/services/cast.js');
    for (const [id, name] of [[CAST, 'おとこ'], [ADULT, 'おんな'], [MINOR, 'まだ']] as const) {
      await upsertMember(db, { id, username: id, displayName: name, avatarUrl: null, roleIds: [], isBot: false, joinedAt: null });
      await applyCast(db, c, { id, adult: true }, profile);
      await setCastStatus(db, id, 'active', 'staff');
    }
    await setCastGender(db, CAST, 'male');
    await setCastGender(db, ADULT, 'female');
    const M = '990000000000000101', F = '990000000000000102';
    const send = vi.fn(async (ch: string, _b: unknown) => ({ id: ch === M ? '990000000000000201' : '990000000000000202' }));
    const discord = { sendMessage: send, editMessage: vi.fn(async () => undefined) };
    await saveCastConfig(db, { ...c, channelId: M }, 'staff');
    expect(await refreshCastPanel(db, discord as never)).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    const one = JSON.stringify(send.mock.calls[0]![1]);
    for (const n of ['おとこ', 'おんな', 'まだ']) expect(one).toContain(n);
    await saveCastConfig(db, { ...(await loadCastConfig(db)), femaleChannelId: F }, 'staff');
    send.mockClear();
    expect(await refreshCastPanel(db, discord as never, { repost: true })).toBe(true);
    const byCh = new Map(send.mock.calls.map(([ch, b]) => [ch, JSON.stringify(b)]));
    expect(byCh.get(M)).toContain('おとこ');
    expect(byCh.get(M)).not.toContain('おんな');
    expect(byCh.get(M)).toContain('まだ');
    expect(byCh.get(M)).toContain('cast:now:male');
    expect(byCh.get(F)).toContain('おんな');
    expect(byCh.get(F)).not.toContain('おとこ');
    expect(byCh.get(F)).toContain('cast:rank:female');
    expect(await loadCastConfig(db)).toMatchObject({ panelMessageId: '990000000000000201', femalePanelMessageId: '990000000000000202' });
    // 相談・予約のスレッドは、その人のメニューのチャンネルに
    const conf = await loadCastConfig(db);
    expect(castHomeChannel(conf, (await getCast(db, ADULT))!)).toBe(F);
    expect(castHomeChannel(conf, (await getCast(db, CAST))!)).toBe(M);
  });
});

describe('➕ キャストのオプション', () => {
  it('メニューにオプションを足して払う・知らない番号はだめ・のばす値段にはオプションを入れない', async () => {
    await upsertMember(db, { id: CAST, username: 'c', displayName: 'C', avatarUrl: null, roleIds: [], isBot: false, joinedAt: null });
    await applyCast(db, c, { id: CAST, adult: true }, profile);
    await setCastStatus(db, CAST, 'active', 'staff');
    expect(await addOption(db, c, CAST, { name: 'カメラあり', price: 100 })).toBe('ok');
    expect(await addOption(db, c, CAST, { name: '歌', price: 50 })).toBe('ok');
    expect(await addOption(db, c, CAST, { name: '', price: 50 })).toBe('invalid');
    const cast = (await getCast(db, CAST))!;
    const [cam, song] = cast.options;
    await addCoins(db, ADULT, 10000, 'adjust');
    expect((await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: '60', options: ['nope'] }, T20)).status).toBe('no_plan');
    const r = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: '60', options: [cam!.id, song!.id] }, T20);
    if (r.status !== 'ok') throw new Error(r.status);
    // 1 時間 500 ＋ 100 ＋ 50
    expect(r.session).toMatchObject({ price: 650, optionPrice: 150, optionNames: ['カメラあり', '歌'] });
    await acceptSession(db, r.session.id, CAST, T20);
    // 前のプランの 30 分の値段（300）でのばす。オプションの分は足さない
    const e = await extendSession(db, r.session.id, ADULT, new Date(T20.getTime() + MIN));
    expect(e).toMatchObject({ status: 'ok', session: { price: 950, minutes: 90 } });
    expect(await removeOption(db, CAST, cam!.id)).toBe(true);
    expect((await getCast(db, CAST))!.options.map((o) => o.name)).toEqual(['歌']);
  });
});

describe('⏳ 時間フリーのメニュー（時間 0）', () => {
  it('時間を決めず 1 回の値段・のばせない・キャストが終えても全額・未成年は選べない', async () => {
    const { FREE_MINUTES, menuLabel, finishSession } = await import('../src/services/cast.js');
    await upsertMember(db, { id: CAST, username: 'c', displayName: 'C', avatarUrl: null, roleIds: [], isBot: false, joinedAt: null });
    await applyCast(db, c, { id: CAST, adult: true }, profile);
    await setCastStatus(db, CAST, 'active', 'staff');
    expect(await addMenuItem(db, c, CAST, { name: 'まったり', note: '', minutes: 0, price: 1000, night: false })).toBe('ok');
    const free = (await getCast(db, CAST))!.menu.find((m) => m.name === 'まったり')!;
    expect(menuLabel(free)).toBe('まったり（時間フリー）');
    await addCoins(db, ADULT, 10000, 'adjust');
    await addCoins(db, MINOR, 10000, 'adjust');
    expect((await requestSession(db, c, { castId: CAST, customerId: MINOR, customerAdult: false, plan: free.id }, T20)).status).toBe('minor_plan');
    const r = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: free.id }, T20);
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.session).toMatchObject({ plan: `free:${free.id}`, minutes: FREE_MINUTES, price: 1000 });
    await acceptSession(db, r.session.id, CAST, T20);
    expect((await extendSession(db, r.session.id, ADULT, new Date(T20.getTime() + MIN))).status).toBe('not_active');
    // 10 分でキャストが終えても全額（手数料 10% を引いて 900）
    const done = await finishSession(db, c, r.session.id, CAST, new Date(T20.getTime() + 10 * MIN));
    expect(done?.paid).toBe(900);
  });
});

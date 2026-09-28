import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import {
  acceptSession,
  applyCast,
  CAST_DEFAULTS,
  cancelSession,
  castStats,
  castTick,
  disputeSession,
  extendSession,
  finishSession,
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
import { addCoins, walletOf } from '../src/services/economy.js';
import { makeDb } from './helpers.js';

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
  await close();
});

describe('🎀 キャスト', () => {
  it('申し込み: 18 歳以上だけ・値段は範囲の中。読みやすい数とタグ', async () => {
    expect((await applyCast(db, c, { id: MINOR, adult: false }, profile, T20)).status).toBe('not_adult');
    expect((await applyCast(db, c, { id: ADULT, adult: true }, { ...profile, price30: 50 }, T20)).status).toBe('invalid');
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
});

describe('🎀 キャストの見た目', () => {
  it('メニュー: 画像と、待機中から並ぶ選ぶメニュー・ボタン。部屋のメッセージ', async () => {
    const { castPanel, sessionMessage } = await import('../src/discord/cast.js');
    const { getCast } = await import('../src/services/cast.js');
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
    for (const id of ['cast:pick', 'cast:now', 'cast:rank', 'cast:me', 'cast:apply']) expect(menu).toContain(id);
    // キャストがいなければメニューは出さない
    expect(JSON.stringify(castPanel([]).components)).not.toContain('cast:pick');
    const r = await requestSession(db, c, { castId: CAST, customerId: MINOR, customerAdult: false, plan: '30' }, T20);
    if (r.status !== 'ok') throw new Error(r.status);
    expect(JSON.stringify(sessionMessage(r.session, c, '🪙銭'))).toContain(`cast:accept:${r.session.id}`);
    const a = (await acceptSession(db, r.session.id, CAST, T20))!;
    const active = JSON.stringify(sessionMessage(a, c, '🪙銭'));
    expect(active).toContain('公開の部屋です');
    expect(active).toContain(`cast:report:${r.session.id}`);
  });
});

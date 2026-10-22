import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelType, type Guild, type Interaction } from 'discord.js';
import { CastApp } from '../src/discord/cast.js';
import type { DiscordActions } from '../src/lib/discordRest.js';
import type { Db } from '../src/db/client.js';
import { castSessions } from '../src/db/schema.js';
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
  inSchedule,
  lateCancelShare,
  noShowCounts,
  parseSchedule,
  reportNoShow,
  scheduleText,
  sessionsBetween,
  setSchedule,
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
    // 予約だけになったので、18 歳未満の人も予約できる（公開の部屋・22 時までに終わる 60 分まで）。ここでは 21:00 からの 60 分なので 22 時をこえない
    const minorRsv = await requestSession(db, c, { castId: CAST, customerId: MINOR, customerAdult: false, plan: '60', startAt: new Date(T20.getTime() + 60 * MIN) }, T20);
    expect(minorRsv.status === 'ok' ? minorRsv.session.isPublic : minorRsv.status).toBe(true);
    if (minorRsv.status === 'ok') await cancelSession(db, minorRsv.session.id, MINOR, 'canceled', T20);
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

  it('前の値段がいまの幅の外になっていても、紹介は変えられる（新しく入れた値段は確かめる）', async () => {
    const { updateProfile, getCast } = await import('../src/services/cast.js');
    const narrow = { ...c, priceMin: 1000, priceMax: 5000 };
    expect(await updateProfile(db, narrow, CAST, { ...profile, bio: '新しい紹介', tags: ['ゲーム'] })).toBeDefined();
    expect((await getCast(db, CAST))!).toMatchObject({ bio: '新しい紹介', tags: ['ゲーム'], price30: 300 });
    expect(await updateProfile(db, narrow, CAST, { ...profile, price30: 200 })).toBeUndefined();
    expect(await updateProfile(db, narrow, CAST, { ...profile, bio: 'あ'.repeat(301) })).toBeUndefined();
  });

  it('内容を変えたら、メニュー（パネル）も書きかえる', async () => {
    const { saveCastConfig, loadCastConfig } = await import('../src/services/cast.js');
    const { refreshCastViews } = await import('../src/discord/cast.js');
    await saveCastConfig(db, { ...(await loadCastConfig(db)), channelId: '910000000000000009', panelMessageId: '920000000000000009' }, 'staff');
    const edits: string[] = [];
    const discord = { editMessage: async (ch: string, id: string) => void edits.push(`${ch}/${id}`), sendMessage: async () => ({ id: 'x' }) } as never;
    expect(await refreshCastViews(db, discord, CAST)).toBe(true);
    expect(edits).toContain('910000000000000009/920000000000000009');
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
    // 予約だけなので、受付中は時間で切れない。受付停止なら予約できない
    await setWaiting(db, CAST, 1, T20);
    expect((await castTick(db, c, new Date(T20.getTime() + 121 * MIN))).waitingOff).toBe(0);
    await setWaiting(db, CAST, 0, T20);
    expect((await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: '30', startAt: new Date(T20.getTime() + 180 * MIN) }, T20)).status).toBe('closed');
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

  it('1 人で何件も予約できる（設定の件数まで・はじめは 10 件・自分の予約と時間が重ならないこと）', async () => {
    expect(c.customerOpenMax).toBe(10);
    const five = { ...c, customerOpenMax: 5 };
    const CAST2 = '880000000000000009';
    await applyCast(db, c, { id: CAST2, adult: true }, profile, T20);
    await setCastStatus(db, CAST2, 'active', 'staff', T20);
    const at = (h: number) => new Date(T20.getTime() + h * 60 * MIN);
    expect((await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: '30', startAt: at(1) }, T20)).status).toBe('ok');
    // べつのキャストでも、自分の予約と重なる時間はだめ
    expect((await requestSession(db, c, { castId: CAST2, customerId: ADULT, customerAdult: true, plan: '30', startAt: at(1) }, T20)).status).toBe('self_overlap');
    for (const h of [2, 3, 4, 5]) expect((await requestSession(db, five, { castId: CAST2, customerId: ADULT, customerAdult: true, plan: '30', startAt: at(h) }, T20)).status).toBe('ok');
    expect((await requestSession(db, five, { castId: CAST2, customerId: ADULT, customerAdult: true, plan: '30', startAt: at(6) }, T20)).status).toBe('has_open');
    // はじめの 10 件なら、まだ入る
    expect((await requestSession(db, c, { castId: CAST2, customerId: ADULT, customerAdult: true, plan: '30', startAt: at(6) }, T20)).status).toBe('ok');
  });

  it('⏱ 予約の時間を見やすく: 時間と、始まり〜終わり（延長もふくむ）', async () => {
    const { sessionTime } = await import('../src/services/cast.js');
    const start = new Date('2026-10-20T12:00:00Z'); // 21:00（日本時間）
    expect(sessionTime({ plan: 'm1', minutes: 60, extensions: 0, startAt: start, endsAt: null })).toBe('⏱ 1 時間（21:00〜22:00）');
    expect(sessionTime({ plan: 'm1', minutes: 30, extensions: 1, startAt: start, endsAt: null })).toBe('⏱ 1 時間（21:00〜22:00）');
    expect(sessionTime({ plan: 'm1', minutes: 90, extensions: 0, startAt: null, endsAt: null })).toBe('⏱ 1 時間 30 分');
    expect(sessionTime({ plan: 'night', minutes: 0, extensions: 0, startAt: start, endsAt: null })).toBe('🌙 寝落ち（21:00〜朝 7 時まで）');
    expect(sessionTime({ plan: 'free:x', minutes: 0, extensions: 0, startAt: start, endsAt: null })).toBe('⏱ 時間フリー（21:00〜）');
    expect(sessionTime({ plan: 'dlv:x', minutes: 0, extensions: 0, startAt: null, endsAt: null })).toBe('📦 納品');
  });

  it('別の日時の提案: お客が受けると、その時刻で受けた予約になる', async () => {
    const { rescheduleSession } = await import('../src/services/cast.js');
    const at = new Date(T20.getTime() + 60 * MIN);
    const r = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: '60', startAt: at }, T20);
    if (r.status !== 'ok') throw new Error(r.status);
    const other = await requestSession(db, c, { castId: CAST, customerId: MINOR, customerAdult: true, plan: '60', startAt: new Date(at.getTime() + 180 * MIN) }, T20);
    expect(other.status).toBe('ok');
    const next = new Date(at.getTime() + 120 * MIN);
    expect((await rescheduleSession(db, r.session.id, MINOR, next, T20)).status).toBe('not_customer');
    expect((await rescheduleSession(db, r.session.id, ADULT, new Date(at.getTime() + 150 * MIN), T20)).status).toBe('overlap');
    expect((await rescheduleSession(db, r.session.id, ADULT, T20, T20)).status).toBe('bad_time');
    const ok = await rescheduleSession(db, r.session.id, ADULT, next, T20);
    expect(ok.status === 'ok' ? [ok.session.status, ok.session.startAt?.getTime()] : ok.status).toEqual(['accepted', next.getTime()]);
  });

  it('📦 納品・🎰 ガチャ: 預かる → 納品 → お客の受け取りで渡す。期限が過ぎたら戻す。受け取らなければ 3 日で渡す', async () => {
    const { deliverSession, receiveSession } = await import('../src/services/cast.js');
    expect(await addMenuItem(db, c, CAST, { name: 'ボイス', note: '', minutes: 0, price: 1000, night: false, delivery: true })).toBe('ok');
    expect(await addMenuItem(db, c, CAST, { name: 'ボイスガチャ', note: '', minutes: 0, price: 300, night: false, delivery: true, gacha: ['おはよう', 'おやすみ'] })).toBe('ok');
    const [voice, gacha] = menuOf((await getCast(db, CAST))!).slice(-2);
    expect(voice).toMatchObject({ delivery: true, minutes: 0 });
    expect((await requestSession(db, c, { castId: CAST, customerId: MINOR, customerAdult: false, plan: voice!.id }, T20)).status).toBe('minor_plan');
    const r = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: voice!.id }, T20);
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.session).toMatchObject({ status: 'ordered', plan: `dlv:${voice!.id}` });
    // スレッドのある納品の注文は、BOT が起きたときにスレッドのボタン（納品した）を新しくする
    {
      const { openReservationsWithThread } = await import('../src/services/cast.js');
      const { castSessions } = await import('../src/db/schema.js');
      const { eq } = await import('drizzle-orm');
      expect((await openReservationsWithThread(db, T20)).map((x) => x.id)).not.toContain(r.session.id);
      await db.update(castSessions).set({ threadId: '990000000000000301' }).where(eq(castSessions.id, r.session.id));
      expect((await openReservationsWithThread(db, T20)).map((x) => x.id)).toContain(r.session.id);
    }
    // 通話の予約とは重ならない・お客からは取り消せない
    const call = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: '30', startAt: new Date(T20.getTime() + 60 * MIN) }, T20);
    if (call.status !== 'ok') throw new Error(call.status);
    await cancelSession(db, call.session.id, ADULT, 'canceled', T20);
    expect(await cancelSession(db, r.session.id, ADULT, 'canceled', T20)).toBeUndefined();
    expect(await deliverSession(db, r.session.id, ADULT, T20)).toBeUndefined();
    expect((await deliverSession(db, r.session.id, CAST, T20))?.status).toBe('delivered');
    expect(await receiveSession(db, c, r.session.id, CAST, T20)).toBeUndefined();
    expect((await receiveSession(db, c, r.session.id, ADULT, T20))?.paid).toBe(900);
    expect((await walletOf(db, CAST)).balance).toBe(900);
    // ガチャ: 中身のどれかが出る
    const g = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: gacha!.id }, T20, () => 0.99);
    expect(g.status === 'ok' ? [g.drawn, g.session.menuName] : g.status).toEqual(['おやすみ', 'ボイスガチャ：おやすみ']);
    // 24 時間で納品がなければ戻す
    const before = (await walletOf(db, ADULT)).balance;
    expect((await castTick(db, c, new Date(T20.getTime() + 24 * 60 * MIN))).expired.map((s) => s.status)).toContain('declined');
    expect((await walletOf(db, ADULT)).balance).toBe(before + 300);
    // 納品して受け取らないまま 72 時間 → 自動で渡す
    const r2 = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: voice!.id }, T20);
    if (r2.status !== 'ok') throw new Error(r2.status);
    await deliverSession(db, r2.session.id, CAST, T20);
    expect((await castTick(db, c, new Date(T20.getTime() + 71 * 60 * MIN))).finished).toHaveLength(0);
    expect((await castTick(db, c, new Date(T20.getTime() + 72 * 60 * MIN))).finished.map((s) => s.id)).toContain(r2.session.id);
  });

  it('⏰ 予約の前の知らせ: 1 時間前と 10 分前に 1 回ずつ', async () => {
    const at = new Date(T20.getTime() + 120 * MIN);
    const r = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: '30', startAt: at }, T20);
    if (r.status !== 'ok') throw new Error(r.status);
    expect((await castTick(db, c, T20)).remind).toEqual([]);
    await acceptSession(db, r.session.id, CAST, T20);
    expect((await castTick(db, c, new Date(at.getTime() - 61 * MIN))).remind).toEqual([]);
    expect((await castTick(db, c, new Date(at.getTime() - 60 * MIN))).remind.map((x) => x.stage)).toEqual(['hour']);
    expect((await castTick(db, c, new Date(at.getTime() - 30 * MIN))).remind).toEqual([]);
    expect((await castTick(db, c, new Date(at.getTime() - 10 * MIN))).remind.map((x) => x.stage)).toEqual(['soon']);
    expect((await castTick(db, c, new Date(at.getTime() - 5 * MIN))).remind).toEqual([]);
  });

  it('💰 売上の明細: その月に精算した本人の分だけ。合計は受け取った額', async () => {
    const { castStatement, monthRange } = await import('../src/services/cast.js');
    const r = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: '60', startAt: new Date(T20.getTime() + 60 * MIN) }, T20);
    if (r.status !== 'ok') throw new Error(r.status);
    await acceptSession(db, r.session.id, CAST, T20);
    const started = new Date(T20.getTime() + 60 * MIN);
    await castTick(db, c, started);
    await castTick(db, c, new Date(started.getTime() + 60 * MIN));
    const range = monthRange(0, T20);
    expect(range.label).toBe('2026年10月');
    const st = await castStatement(db, CAST, range.from, range.to);
    expect(st).toMatchObject({ count: 1, total: 450 });
    expect(st.rows[0]).toMatchObject({ price: 500, paid: 450, delivery: false });
    const prev = monthRange(1, T20);
    expect(prev.label).toBe('2026年9月');
    expect((await castStatement(db, CAST, prev.from, prev.to)).count).toBe(0);
    expect((await castStatement(db, ADULT, range.from, range.to)).count).toBe(0);
  });

  it('当日の部屋: 受けた予約で、キャストかお客が、日本時間の同じ日だけ立てられる', async () => {
    const { earlyRoomOk } = await import('../src/services/cast.js');
    const at = new Date(T20.getTime() + 60 * MIN); // 21:00
    const r = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: '60', startAt: at }, T20);
    if (r.status !== 'ok') throw new Error(r.status);
    expect(earlyRoomOk(r.session, ADULT, T20)).toBe('not_accepted');
    const a = (await acceptSession(db, r.session.id, CAST, T20))!;
    expect(earlyRoomOk(a, MINOR, T20)).toBe('not_member');
    expect(earlyRoomOk(a, ADULT, T20)).toBe('ok');
    expect(earlyRoomOk(a, CAST, T20)).toBe('ok');
    // 前の日（日本時間 9/30 23:00）はまだ
    expect(earlyRoomOk(a, CAST, new Date('2026-09-30T14:00:00Z'))).toBe('not_today');
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
    // 予約・注文は 1 人ずつの紹介パネルから。一覧はランキングとキャストの方だけ
    for (const id of ['cast:rank', 'cast:me']) expect(menu).toContain(id);
    expect(menu).not.toContain('cast:pick');
    expect(p.embeds![0]!.description).toContain('予約受付中 **1** 人');
    // 予約だけなので「今すぐ話せる人」は出さない
    expect(menu).not.toContain('cast:now');
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
    // ⭐ 終わったら: DM で評価をお願いできたときは、部屋には評価のボタンを出さない
    const done = (await finishSession(db, c, r.session.id, CAST, new Date(T20.getTime() + 31 * 60_000)))!;
    expect(JSON.stringify(sessionMessage(done, c, '🪙銭'))).toContain(`cast:rate:${r.session.id}:5`);
    const viaDm = JSON.stringify(sessionMessage(done, c, '🪙銭', { rateInRoom: false }));
    expect(viaDm).not.toContain('cast:rate:');
    expect(viaDm).toContain('評価のお願いを DM で送りました');
    // DM の評価ボタン: 押すとボタンを外してお礼に書きかえる（1 回だけ）
    const app = new CastApp(db, () => cfg, {} as never);
    const press = (stars: number) => ({ customId: `cast:rate:${r.session.id}:${stars}`, guildId: null, user: { id: MINOR }, isButton: () => true, isModalSubmit: () => false, update: vi.fn(async () => undefined), reply: vi.fn(async () => undefined) });
    const first = press(4);
    await app.onInteraction(first as never);
    expect(first.update).toHaveBeenCalledWith({ content: '⭐⭐⭐⭐ ありがとうございました。', embeds: [], components: [] });
    const again = press(5);
    await app.onInteraction(again as never);
    expect(JSON.stringify(again.reply.mock.calls)).toContain('1 回だけ');
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

  it('延長の料金確認では課金せず、確定ボタンの再処理も1回だけ課金する', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });vi.setSystemTime(T20);
    const f = fixture();
    const r = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: '60' }, T20);
    if(r.status !== 'ok') throw Error(r.status);
    await acceptSession(db, r.session.id, CAST, T20);
    const reply = vi.fn(async () => undefined), followUp = vi.fn(async () => undefined);
    const preview = { ...f.interaction, customId: `cast:ext:${r.session.id}:0`, reply, followUp, message: { id: '990000000000000010' } };
    const before = (await walletOf(db, ADULT)).balance;
    await f.app.onInteraction(preview as unknown as Interaction);
    expect(JSON.stringify(reply.mock.calls)).toContain('300');
    expect(JSON.stringify(reply.mock.calls)).toContain(`cast:extconfirm:${r.session.id}:0`);
    expect((await walletOf(db, ADULT)).balance).toBe(before);
    const confirm = { ...preview, customId: `cast:extconfirm:${r.session.id}:0` };
    await f.app.onInteraction(confirm as unknown as Interaction);
    expect((await walletOf(db, ADULT)).balance).toBe(before - 300);
    await f.app.onInteraction(confirm as unknown as Interaction);
    expect((await walletOf(db, ADULT)).balance).toBe(before - 300);
  });

  it('「指名する」のボタンは、日時を入れる予約の入力欄を出す（予約だけ）', async () => {
    const f = fixture();
    const showModal = vi.fn(async () => undefined);
    await f.app.onInteraction({ ...f.interaction, showModal, message: { flags: { has: () => true } }, update: vi.fn() } as unknown as Interaction);
    expect(JSON.stringify(showModal.mock.calls[0])).toContain(`cast:rmodal:${CAST}:30`);
  });

  it('専用窓口へ予約を作り、本人向けに移動ボタンを返す', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });vi.setSystemTime(T20);
    const f = fixture(), HUB = '990000000000000777', THREAD = '990000000000000778';
    const { saveCastConfig } = await import('../src/services/cast.js');
    await saveCastConfig(db, { ...c, reservationChannelId: HUB }, 'staff');
    const create = vi.fn(async () => ({ id: THREAD, members: { add: vi.fn(async () => undefined) }, send: vi.fn(async () => ({})) }));
    f.app.attach({ channels: { cache: new Map([[HUB, { type: ChannelType.GuildText, threads: { create } }]]) } } as unknown as Guild);
    await f.app.onInteraction({ ...f.interaction, customId: `cast:rmodal:${CAST}:30`, isModalSubmit: () => true, isFromMessage: () => true, fields: { getTextInputValue: () => '21:00' } } as unknown as Interaction);
    expect(create).toHaveBeenCalledOnce();
    expect(JSON.stringify(f.interaction.editReply.mock.calls)).toContain('予約のお部屋はこちら');
    expect(JSON.stringify(f.interaction.editReply.mock.calls)).toContain(`https://discord.com/channels/${cfg.guildId}/${THREAD}`);
    expect((await walletOf(db, ADULT)).balance).toBe(9700);
  });

  it('非公開スレッドの作成に失敗した予約は公開せず全額返す', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });vi.setSystemTime(T20);
    const f = fixture();const CH = '990000000000000777';
    const { saveCastConfig, getSession } = await import('../src/services/cast.js');
    await saveCastConfig(db, { ...c, channelId: CH, reservationChannelId: CH }, 'staff');
    const create = vi.fn(async () => { throw Error('Missing Permissions'); });
    f.app.attach({ channels: { cache: new Map([[CH, { type: ChannelType.GuildText, threads: { create } }]]) } } as unknown as Guild);
    await f.app.onInteraction({ ...f.interaction, customId: `cast:rmodal:${CAST}:30`, isModalSubmit: () => true, isFromMessage: () => true, fields: { getTextInputValue: () => '21:00' } } as unknown as Interaction);
    expect(create).toHaveBeenCalledOnce();expect(create).toHaveBeenCalledWith(expect.objectContaining({ type: ChannelType.PrivateThread }));
    expect((await walletOf(db, ADULT)).balance).toBe(10000);
    const sessions = await db.select().from(castSessions);
    expect(sessions).toHaveLength(1);expect(await getSession(db,sessions[0]!.id)).toMatchObject({ status: 'declined', threadId: null });
    expect(JSON.stringify(f.interaction.editReply.mock.calls)).toContain('銭を戻しました');
  });

  it('📦 納品のファイル: 中身が見えるときはキャストのファイルかリンクが要る。見えないときはキャストの書き込みがあればよい', async () => {
    const created = new Date('2026-10-01T00:00:00Z');
    const msg = (author: string, extra: { files?: number; content?: string } = {}) => ({ author: { id: author }, createdAt: new Date(created.getTime() + 1000), attachments: { size: extra.files ?? 0 }, content: extra.content ?? '' });
    const make = (list: unknown[], content: boolean) => {
      const app = new CastApp(db, () => cfg, {} as DiscordActions, undefined, content);
      app.attach({ channels: { fetch: async () => ({ isTextBased: () => true, messages: { fetch: async () => new Map(list.map((m, k) => [String(k), m])) } }) } } as unknown as Guild);
      return (s: unknown) => (app as unknown as { deliveryPosted: (s: unknown) => Promise<boolean> }).deliveryPosted(s);
    };
    const s = { castId: CAST, threadId: '990000000000000555', createdAt: created };
    expect(await make([msg(ADULT, { files: 1 })], true)(s)).toBe(false);
    expect(await make([msg(CAST, { content: 'できた' })], true)(s)).toBe(false);
    expect(await make([msg(CAST, { files: 1 })], true)(s)).toBe(true);
    expect(await make([msg(CAST, { content: 'https://example.com/voice.mp3' })], true)(s)).toBe(true);
    expect(await make([msg(CAST)], false)(s)).toBe(true);
    expect(await make([], false)(s)).toBe(false);
  });

  it('社務所からの DM で、キャストが予約を受けると DM を書き換え、スレッドにお客向けを出す', async () => {
    const f = fixture();
    const r = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: '60', startAt: new Date(Date.now() + 60 * MIN) });
    if (r.status !== 'ok') throw new Error(r.status);
    await setSessionPlace(db, r.session.id, { threadId: '990000000000000077' });
    const update = vi.fn(async () => undefined);
    const dm = { customId: `cast:accept:${r.session.id}`, guildId: null, user: { id: CAST }, isModalSubmit: () => false, isButton: () => true, update };
    // DM で押せないもの（受け取りなど）は何もしない
    await f.app.onInteraction({ ...dm, customId: `cast:rcv:${r.session.id}` } as unknown as Interaction);
    expect(update).not.toHaveBeenCalled();
    await f.app.onInteraction(dm as unknown as Interaction);
    expect((await getSession(db, r.session.id))?.status).toBe('accepted');
    expect(JSON.stringify(update.mock.calls[0])).toContain('受けました');
    expect(f.discord.sendMessage).toHaveBeenCalledWith('990000000000000077', expect.objectContaining({ embeds: [expect.objectContaining({ title: '📅 予約を受けました' })] }));
  });

  it('部屋を作る（中の仕組み）: キャスト名の部屋を作り、利用者に入室ボタンを出す', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(T20);
    await upsertMember(db, { id: CAST, username: 'sakura', displayName: 'さくら', avatarUrl: null, joinedAt: null, roleIds: [], isBot: false });
    const f = fixture();
    await (f.app as unknown as { go: (i: unknown, c: string, p: string) => Promise<void> }).go(f.interaction, CAST, '30');
    expect(f.create).toHaveBeenCalledWith(expect.objectContaining({ name: '🌸 さくらの間', userLimit: 2 }));
    expect(f.interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ components: [{ type: 1, components: [expect.objectContaining({ label: '部屋へ入る', url: `https://discord.com/channels/${cfg.guildId}/${roomId}` })] }] }));
    expect((await walletOf(db, ADULT)).balance).toBe(9700);
  });

  it('部屋を作る（中の仕組み）: 部屋作成が失敗したら全額戻す', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(T20);
    const f = fixture(true);
    await (f.app as unknown as { go: (i: unknown, c: string, p: string) => Promise<void> }).go(f.interaction, CAST, '30');
    expect(f.interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('銭を戻しました') }));
    expect((await walletOf(db, ADULT)).balance).toBe(10_000);
    expect((await walletOf(db, CAST)).balance).toBe(0);
  });

  it('🏆 毎月 1 日に先月の上位を発表し、1 位に称号のロールと銭をわたす（前の 1 位から外す）', async () => {
    const { saveCastConfig, loadCastConfig } = await import('../src/services/cast.js');
    const { settings } = await import('../src/db/schema.js');
    await saveCastConfig(db, { ...(await loadCastConfig(db)), rankChannelId: '990000000000000010', rankRoleId: '990000000000000011', rankBonus: 800 }, 'staff');
    await db.insert(settings).values({ key: 'cast.rank:2026-08', value: { winnerId: ADULT }, updatedBy: 'system' });
    const at = new Date('2026-09-15T03:00:00Z');
    await db.insert(castSessions).values({ castId: CAST, customerId: ADULT, plan: '30', minutes: 30, price: 300, paid: 270, status: 'done', createdAt: at, closedAt: at });
    const f = fixture();
    const roles: string[] = [];
    Object.assign(f.discord, { addRole: vi.fn(async (_g: string, u: string, r: string) => void roles.push(`+${u}/${r}`)), removeRole: vi.fn(async (_g: string, u: string, r: string) => void roles.push(`-${u}/${r}`)) });
    const day1 = new Date('2026-09-30T15:30:00Z');
    await f.app.tick(day1);
    await f.app.tick(day1);
    const posts = f.discord.sendMessage.mock.calls.filter((x) => (x as unknown[])[0] === '990000000000000010');
    expect(posts).toHaveLength(1);
    expect(String((posts[0] as unknown as [string, { content: string }])[1].content)).toContain('2026 年 9 月のキャストランキング');
    expect(roles).toEqual([`-${ADULT}/990000000000000011`, `+${CAST}/990000000000000011`]);
    expect((await walletOf(db, CAST)).balance).toBe(800);
  });

  it('💬 相談: 通話を選ぶと時間の選択、時間を選ぶとお願いの欄（種類・時間つき）。納品は時間なしでお願いの欄', async () => {
    const f = fixture();
    const base = { guildId: cfg.guildId, user: { id: ADULT }, member: { roles: { cache: new Map() } }, inCachedGuild: () => true, isUserSelectMenu: () => false, isModalSubmit: () => false };
    const update = vi.fn(async () => undefined);
    const showModal = vi.fn(async () => undefined);
    await f.app.onInteraction({ ...base, customId: `cast:ckind:${CAST}:m1:call`, isStringSelectMenu: () => false, isButton: () => true, update, showModal } as unknown as Interaction);
    const sel = (update.mock.calls[0] as unknown as [{ components: { components: { custom_id: string; options: { value: string }[] }[] }[] }])[0].components[0]!.components[0]!;
    expect(sel.custom_id).toBe(`cast:cmin:${CAST}:m1`);
    expect(sel.options.map((o) => o.value)).toEqual(['30', '60', '90', '120', '180', '240']);
    await f.app.onInteraction({ ...base, customId: `cast:cmin:${CAST}:m1`, values: ['90'], isStringSelectMenu: () => true, isButton: () => false, showModal } as unknown as Interaction);
    expect((showModal.mock.calls[0] as unknown as [{ data: { custom_id: string } }])[0].data.custom_id).toBe(`cast:cmodal:${CAST}:m1:call:90`);
    await f.app.onInteraction({ ...base, customId: `cast:ckind:${CAST}:m1:dlv`, isStringSelectMenu: () => false, isButton: () => true, update, showModal } as unknown as Interaction);
    expect((showModal.mock.calls[1] as unknown as [{ data: { custom_id: string } }])[0].data.custom_id).toBe(`cast:cmodal:${CAST}:m1:dlv:0`);
  });

  it('起動して 1 回だけ、進行中の予約のスレッドのメッセージを新しい形（日時変更の提案ボタンつき）に書き換える', async () => {
    const at = new Date(T20.getTime() + 24 * 60 * MIN);
    const r = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: '60', startAt: at }, T20);
    if (r.status !== 'ok') throw new Error(r.status);
    await acceptSession(db, r.session.id, CAST, T20);
    const TH = '990000000000000777';
    await setSessionPlace(db, r.session.id, { threadId: TH });
    const f = fixture();
    const edit = vi.fn(async () => undefined);
    const old = { author: { id: 'bot' }, components: [{ components: [{ customId: `cast:cancel:${r.session.id}` }] }], edit };
    const thread = { isTextBased: () => true, client: { user: { id: 'bot' } }, messages: { fetch: vi.fn(async () => ({ find: (fn: (m: unknown) => boolean) => [old].find(fn) })) } };
    (f.app as unknown as { guild: { channels: { cache: Map<string, unknown> } } }).guild.channels.cache.set(TH, thread);
    await f.app.tick(T20);
    await f.app.tick(T20);
    expect(edit).toHaveBeenCalledOnce();
    const body = JSON.stringify((edit.mock.calls[0] as unknown[])[0]);
    expect(body).toContain(`cast:propose:${r.session.id}`);
    expect(body).toContain('日時変更を提案');
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
    await (f.app as unknown as { go: (i: unknown, c: string, p: string) => Promise<void> }).go(f.interaction, CAST, '30');
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

  it('💰 メニュー・オプション・相談の値段に上限はない（1 億枚までは入る。前に保存した上限は使わない）', async () => {
    const { saveCastConfig, loadCastConfig, PRICE_HARD_MAX, validQuote } = await import('../src/services/cast.js');
    await saveCastConfig(db, { ...(await loadCastConfig(db)), priceMax: 30_000 }, 'staff');
    const conf = await loadCastConfig(db);
    expect(conf.priceMax).toBe(PRICE_HARD_MAX);
    await upsertMember(db, { id: CAST, username: 'c', displayName: 'C', avatarUrl: null, roleIds: [], isBot: false, joinedAt: null });
    await applyCast(db, conf, { id: CAST, adult: true }, profile);
    await setCastStatus(db, CAST, 'active', 'staff');
    expect(await addMenuItem(db, conf, CAST, [{ name: 'とくべつ', note: '', minutes: 60, price: 1_000_000, night: false }])).toBe('ok');
    expect(await addMenuItem(db, conf, CAST, [{ name: 'おおきすぎ', note: '', minutes: 60, price: PRICE_HARD_MAX + 1, night: false }])).toBe('invalid');
    expect(validQuote(conf, 60, 5_000_000)).toBe(true);
  });

  it('✏️ メニューの種類を書きかえで変えられる（通話→納品→ガチャ→相談→寝落ち→通話）。ガチャは中身が要る', async () => {
    const { updateMenuItem, menuKindOf } = await import('../src/services/cast.js');
    await upsertMember(db, { id: CAST, username: 'c', displayName: 'C', avatarUrl: null, roleIds: [], isBot: false, joinedAt: null });
    await applyCast(db, c, { id: CAST, adult: true }, profile);
    await setCastStatus(db, CAST, 'active', 'staff');
    expect(await addMenuItem(db, c, CAST, [{ name: 'ボイス', note: '', minutes: 30, price: 300, night: false }])).toBe('ok');
    const id = (await getCast(db, CAST))!.menu.find((m) => m.name === 'ボイス')!.id;
    const item = async () => (await getCast(db, CAST))!.menu.find((m) => m.id === id)!;
    const edit = (kind: 'call' | 'night' | 'consult' | 'delivery' | 'gacha', patch: Partial<{ minutes: number; price: number; gacha: string[] }> = {}) =>
      updateMenuItem(db, c, CAST, id, { name: 'ボイス', note: '', minutes: 30, price: 500, night: false, kind, ...patch });
    expect(await edit('delivery')).toBe('ok');
    expect(await item()).toMatchObject({ delivery: true, minutes: 0, price: 500 });
    expect(menuKindOf(await item())).toBe('delivery');
    // ガチャは中身がないとだめ
    expect(await edit('gacha', { gacha: [] })).toBe('invalid');
    expect(await edit('gacha', { gacha: ['おはよう', 'おやすみ'] })).toBe('ok');
    expect(await item()).toMatchObject({ delivery: true, gacha: ['おはよう', 'おやすみ'] });
    expect(menuKindOf(await item())).toBe('gacha');
    expect(await edit('consult')).toBe('ok');
    expect(await item()).toMatchObject({ consult: true, price: 0, minutes: 0 });
    expect((await item()).delivery).toBeFalsy();
    expect(await edit('night', { price: 2000 })).toBe('ok');
    expect(menuKindOf(await item())).toBe('night');
    expect(await edit('call', { minutes: 60, price: 700 })).toBe('ok');
    expect(await item()).toMatchObject({ minutes: 60, price: 700, night: false });
    expect(menuKindOf(await item())).toBe('call');
    // 種類を入れなければ前のまま（前の画面から保存しても）
    expect(await updateMenuItem(db, c, CAST, id, { name: 'ボイス2', note: '', minutes: 90, price: 900, night: false })).toBe('ok');
    expect(await item()).toMatchObject({ name: 'ボイス2', minutes: 90 });
    expect(menuKindOf(await item())).toBe('call');
  });

  it('💬📦 納品の相談: キャストが出した値段で、納品の注文になる（同じスレッドで 2 回は注文しない）', async () => {
    await upsertMember(db, { id: CAST, username: 'c', displayName: 'C', avatarUrl: null, roleIds: [], isBot: false, joinedAt: null });
    await applyCast(db, c, { id: CAST, adult: true }, profile);
    await setCastStatus(db, CAST, 'active', 'staff');
    expect(await addMenuItem(db, c, CAST, [{ name: 'おねがい', note: '', minutes: 0, price: 0, night: false, consult: true }])).toBe('ok');
    const item = (await getCast(db, CAST))!.menu.find((m) => m.consult)!;
    await addCoins(db, ADULT, 10000, 'adjust');
    const THREAD = '990000000000000123';
    // 時間つき・範囲の外・相談でないメニューはだめ
    expect((await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: item.id, quote: { minutes: 30, price: 800, delivery: true } }, T20)).status).toBe('no_plan');
    expect((await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: item.id, quote: { minutes: 0, price: 0, delivery: true } }, T20)).status).toBe('no_plan');
    expect((await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: '30', quote: { minutes: 0, price: 800, delivery: true } }, T20)).status).toBe('no_plan');
    expect((await requestSession(db, c, { castId: CAST, customerId: MINOR, customerAdult: false, plan: item.id, quote: { minutes: 0, price: 800, delivery: true } }, T20)).status).toBe('minor_plan');
    const [a, b] = await Promise.all([0, 1].map(() => requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: item.id, quote: { minutes: 0, price: 800, delivery: true }, threadId: THREAD }, T20)));
    const ok = [a, b].find((x) => x!.status === 'ok')!;
    expect([a, b].map((x) => x!.status).sort()).toEqual(['already_ordered', 'ok']);
    expect(ok).toMatchObject({ status: 'ok', session: { menuName: 'おねがい（相談）', minutes: 0, price: 800, status: 'ordered', threadId: THREAD } });
    expect(ok.status === 'ok' && ok.session.plan).toBe(`dlv:${item.id}`);
    expect((await walletOf(db, ADULT)).balance).toBe(19200);
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
    expect(one).toContain('在籍 3 人');
    await saveCastConfig(db, { ...(await loadCastConfig(db)), femaleChannelId: F }, 'staff');
    send.mockClear();
    expect(await refreshCastPanel(db, discord as never, { repost: true })).toBe(true);
    const byCh = new Map(send.mock.calls.map(([ch, b]) => [ch, JSON.stringify(b)]));
    // 男性 + まだ決めていない人 / 女性 + まだ決めていない人
    expect(byCh.get(M)).toContain('在籍 2 人');
    expect(byCh.get(M)).toContain('cast:rank:male');
    expect(byCh.get(F)).toContain('在籍 2 人');
    expect(byCh.get(F)).toContain('cast:rank:female');
    expect(await loadCastConfig(db)).toMatchObject({ panelMessageId: '990000000000000201', femalePanelMessageId: '990000000000000202' });
    // 相談・予約のスレッドは、その人のメニューのチャンネルに
    const conf = await loadCastConfig(db);
    expect(castHomeChannel(conf, (await getCast(db, ADULT))!)).toBe(F);
    expect(castHomeChannel(conf, (await getCast(db, CAST))!)).toBe(M);
  });
});

describe('📋 /パネル キャスト一覧', () => {
  it('このチャンネルに出し直す。前の場所のパネルは消す。女性のチャンネルなら女性の分', async () => {
    const { placeCastPanel } = await import('../src/discord/cast.js');
    const { saveCastConfig, loadCastConfig } = await import('../src/services/cast.js');
    const OLD = '990000000000000111', HERE = '990000000000000112', F = '990000000000000113';
    await saveCastConfig(db, { ...c, channelId: OLD, panelMessageId: '990000000000000211', femaleChannelId: F }, 'staff');
    const send = vi.fn(async (ch: string, _b: unknown) => ({ id: ch === HERE ? '990000000000000212' : '990000000000000213' }));
    const del = vi.fn(async () => undefined);
    const discord = { sendMessage: send, editMessage: vi.fn(async () => undefined), deleteMessage: del };
    expect(await placeCastPanel(db, discord as never, HERE, undefined, 'staff')).toBe('male');
    expect(del).toHaveBeenCalledWith(OLD, '990000000000000211');
    expect(send.mock.calls.map(([ch]) => ch)).toContain(HERE);
    expect(await loadCastConfig(db)).toMatchObject({ channelId: HERE, panelMessageId: '990000000000000212' });
    expect(await placeCastPanel(db, discord as never, F, undefined, 'staff')).toBe('female');
    expect((await loadCastConfig(db)).femalePanelMessageId).toBe('990000000000000213');
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

describe('本人のオプション編集・予約時の料金', () => {
  it('編集・受付停止・並べ替え・削除で予約済みの内容は変わらない', async () => {
    const { updateOption, moveOption, activeOptions } = await import('../src/services/cast.js');
    await addOption(db, c, CAST, { name: '歌', price: 100 });
    await addOption(db, c, CAST, { name: 'カメラ', price: 200 });
    const [a, b] = (await getCast(db, CAST))!.options;
    const r = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: '30', options: [a!.id], startAt: new Date(T20.getTime() + 120 * MIN) }, T20);
    expect(r.status).toBe('ok');if(r.status !== 'ok') throw Error(r.status);
    expect(await updateOption(db, c, CAST, a!.id, { name: '新しい歌', note: '説明', price: 900, enabled: false })).toBe(true);
    expect(await moveOption(db, CAST, b!.id, 'up')).toBe(true);
    expect((await getCast(db, CAST))!.options.map(o => o.id)).toEqual([b!.id,a!.id]);
    expect(activeOptions((await getCast(db, CAST))!).map(o => o.id)).toEqual([b!.id]);
    expect((await requestSession(db, c, { castId: CAST, customerId: MINOR, customerAdult: true, plan: '30', options: [a!.id] }, T20)).status).toBe('no_plan');
    expect(await removeOption(db, CAST, a!.id)).toBe(true);
    expect(await getSession(db, r.session.id)).toMatchObject({ price: 400, optionNames: ['歌'], optionPrice: 100 });
    expect(await updateOption(db, c, CAST, b!.id, { name: 'カメラ', price: -1 })).toBe(false);
  });
  it('予約後の料金変更と複数回の延長でも、予約時の30分料金を維持する', async () => {
    const { updateProfile } = await import('../src/services/cast.js');
    const r = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan: '60' }, T20);
    if(r.status !== 'ok') throw Error(r.status);
    await updateProfile(db, c, CAST, { ...profile, price30: 999 });
    await acceptSession(db, r.session.id, CAST, T20);
    expect(await extendSession(db, r.session.id, ADULT, T20, 0)).toMatchObject({ status: 'ok', session: { price: 800, extensionPrice: 300 } });
    expect(await extendSession(db, r.session.id, ADULT, T20, 1)).toMatchObject({ status: 'ok', session: { price: 1100, extensions: 2, minutes: 120 } });
    expect(await extendSession(db, r.session.id, ADULT, T20, 1)).toMatchObject({ status: 'already_extended' });
  });
});

describe('🎀 予約をもっと: 出勤予定・直前の取り消し・来なかった・カレンダー', () => {
  /** T20 の曜日（日本時間） */
  const DAY = '日月火水木金土'[new Date(T20.getTime() + 9 * 3_600_000).getUTCDay()]!;
  const NEXT = '日月火水木金土'[(new Date(T20.getTime() + 9 * 3_600_000).getUTCDay() + 1) % 7]!;
  const accept = async (startAt: Date, plan = '60') => {
    const r = await requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan, startAt }, T20);
    if (r.status !== 'ok') throw new Error(r.status);
    await acceptSession(db, r.session.id, CAST, T20);
    return r.session;
  };

  it('出勤予定を読む・書く', () => {
    expect(parseSchedule('')).toEqual([]);
    expect(parseSchedule('月水 21:00-24:00\n土 20:00〜26:00')).toEqual([
      { day: 1, start: 1260, end: 1440 },
      { day: 3, start: 1260, end: 1440 },
      { day: 6, start: 1200, end: 1560 },
    ]);
    expect(parseSchedule('毎日 9-10')?.length).toBe(7);
    expect(parseSchedule('月 21:00-21:10')).toBeUndefined(); // 30 分より短い
    expect(parseSchedule('月 21:00-31:00')).toBeUndefined(); // 30:00 をこえる
    expect(parseSchedule('きょう 21:00-23:00')).toBeUndefined();
    expect(scheduleText([])).toBe('いつでも');
    expect(scheduleText(parseSchedule('土 20:00-26:00')!)).toBe('土 20:00〜26:00');
  });

  it('出勤予定の外は予約できない（日をまたぐ予定・寝落ちは始まりだけ見る）', async () => {
    await setWaiting(db, CAST, 1, T20);
    // その日の 21:00〜26:00（次の日の 2 時）
    await setSchedule(db, CAST, parseSchedule(`${DAY} 21:00-26:00`)!);
    const at = (h: number) => new Date(T20.getTime() + (h - 20) * 60 * MIN);
    const req = (startAt: Date, plan = '60') => requestSession(db, c, { castId: CAST, customerId: ADULT, customerAdult: true, plan, startAt }, T20);
    expect((await req(at(20.5))).status).toBe('off_hours');
    expect((await req(at(25.5))).status).toBe('off_hours'); // 26 時をこえて終わる
    expect(inSchedule((await getCast(db, CAST))!.schedule, at(25), at(26))).toBe(true);
    expect((await req(at(25))).status).toBe('ok');
    // 寝落ちは始まりだけ見る（朝までかかっても、始まりが出勤の中ならよい）
    const sch = (await getCast(db, CAST))!.schedule;
    expect(inSchedule(sch, at(23), at(31), true)).toBe(true);
    expect(inSchedule(sch, at(26.5), at(31), true)).toBe(false);
    // 次の日の昼は予定がない
    expect(inSchedule(parseSchedule(`${NEXT} 21:00-23:00`)!, at(36), at(37))).toBe(false);
    // 予定を空にすると、いつでも
    await setSchedule(db, CAST, []);
    expect((await req(at(22.5), '30')).status).toBe('ok');
  });

  it('直前の取り消しは決めた % をキャストへ。それより前・キャストの断りは全額戻す', async () => {
    await setWaiting(db, CAST, 1, T20);
    const at = new Date(T20.getTime() + 120 * MIN);
    const s1 = await accept(at);
    // 2 時間前: 全額
    expect(lateCancelShare(c, { ...s1, status: 'accepted' }, T20)).toBe(0);
    // 30 分前: 50%（手数料 10% を引いてキャストへ）
    const late = new Date(at.getTime() - 30 * MIN);
    expect(lateCancelShare(c, { ...s1, status: 'accepted' }, late)).toBe(250);
    const done = await cancelSession(db, s1.id, ADULT, 'canceled', late, c);
    expect(done?.paid).toBe(225);
    expect((await walletOf(db, ADULT)).balance).toBe(10_000 - 250);
    expect((await walletOf(db, CAST)).balance).toBe(225);
    // キャストが断る（直前でも）: 全額
    const s2 = await accept(new Date(T20.getTime() + 300 * MIN));
    expect((await cancelSession(db, s2.id, CAST, 'declined', new Date(T20.getTime() + 290 * MIN), c))?.paid).toBe(0);
    expect((await walletOf(db, ADULT)).balance).toBe(10_000 - 250);
  });

  it('来なかった: 始まって決めた分のあと。キャストが来ない→全額、お客が来ない→決めた % をキャストへ。回数が残る', async () => {
    await setWaiting(db, CAST, 1, T20);
    const at = new Date(T20.getTime() + 60 * MIN);
    const s1 = await accept(at);
    await castTick(db, c, at);
    expect((await reportNoShow(db, c, s1.id, ADULT, new Date(at.getTime() + 5 * MIN))).status).toBe('too_early');
    expect((await reportNoShow(db, c, s1.id, MINOR, new Date(at.getTime() + 20 * MIN))).status).toBe('not_member');
    const r1 = await reportNoShow(db, c, s1.id, ADULT, new Date(at.getTime() + 20 * MIN));
    expect(r1).toMatchObject({ status: 'ok', pay: 0, refund: 500 });
    expect((await walletOf(db, ADULT)).balance).toBe(10_000);
    // 2 回目は押せない
    expect((await reportNoShow(db, c, s1.id, ADULT, new Date(at.getTime() + 21 * MIN))).status).toBe('not_found');

    const at2 = new Date(T20.getTime() + 180 * MIN);
    const s2 = await accept(at2);
    await castTick(db, c, at2);
    const r2 = await reportNoShow(db, c, s2.id, CAST, new Date(at2.getTime() + 15 * MIN));
    expect(r2).toMatchObject({ status: 'ok', pay: 225, refund: 250 });
    expect((await walletOf(db, CAST)).balance).toBe(225);
    expect((await getSession(db, s2.id))?.status).toBe('noshow_customer');
    // 来なかった回は、時間が来ても二重に渡さない
    expect((await castTick(db, c, new Date(at2.getTime() + 120 * MIN))).finished).toEqual([]);
    const n = await noShowCounts(db, T20);
    expect(n.cast.get(CAST)).toBe(1);
    expect(n.customer.get(ADULT)).toBe(1);
    // カレンダー: 始まる時刻の順
    const cal = await sessionsBetween(db, T20, new Date(T20.getTime() + 86_400_000));
    expect(cal.map((x) => x.id)).toEqual([s1.id, s2.id]);
  });
});

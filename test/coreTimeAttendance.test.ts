import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CoreTimeConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { coreTimeMembers, coreTimeRegulars, coreTimeSessions, payCoreTimeBonus, processCoreTimeBonus, recordCoreTime } from '../src/services/coreTimeAttendance.js';
import { walletOf } from '../src/services/economy.js';
import { cfg, makeDb } from './helpers.js';

const A = '880000000000000301';
const B = '880000000000000302';
// 金曜・土曜の 21:00〜23:00（日本時間）
const ct: CoreTimeConfig = { slots: [{ day: 5, start: '21:00', end: '23:00' }, { day: 6, start: '21:00', end: '23:00' }], noticeDayBefore: '', noticeMinutesBefore: 0, bonusCoins: 0, bonusMinMinutes: 30 };
// 2026-10-16 は金曜。21:00 JST = 12:00Z
const FRI = (h: number, m: number) => new Date(Date.UTC(2026, 9, 16, h - 9, m));
const SAT = (h: number, m: number) => new Date(Date.UTC(2026, 9, 17, h - 9, m));

describe('⏰ コアタイムに上がった人の記録', () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await makeDb());
  });
  afterEach(async () => {
    await close();
  });

  it('コアタイムの間だけ、1 分ずつ足す。来た時刻と最後にいた時刻も残す', async () => {
    expect(await recordCoreTime(db, ct, [A], FRI(20, 59))).toBeUndefined();
    expect(await recordCoreTime(db, ct, [A, B], FRI(21, 0))).toEqual({ day: '2026-10-16', slot: '21:00' });
    await recordCoreTime(db, ct, [A, A], FRI(21, 1));
    await recordCoreTime(db, ct, [A], FRI(22, 59));
    expect(await recordCoreTime(db, ct, [A], FRI(23, 0))).toBeUndefined();
    const rows = await coreTimeMembers(db, '2026-10-16', '21:00');
    expect(rows.map((r) => [r.memberId, r.minutes])).toEqual([[A, 3], [B, 1]]);
    expect(rows[0]!.firstAt).toEqual(FRI(21, 0));
    expect(rows[0]!.lastAt).toEqual(FRI(22, 59));
    expect(await recordCoreTime(db, ct, [], FRI(21, 30))).toBeUndefined();
  });

  it('コアタイムごとの人数と、よく来る人（回数の多い順）', async () => {
    await recordCoreTime(db, ct, [A, B], FRI(21, 0));
    await recordCoreTime(db, ct, [A], FRI(21, 1));
    await recordCoreTime(db, ct, [A], SAT(21, 0));
    expect(await coreTimeSessions(db, '2026-10-01')).toEqual([
      { day: '2026-10-17', slot: '21:00', people: 1, minutes: 1 },
      { day: '2026-10-16', slot: '21:00', people: 2, minutes: 3 },
    ]);
    expect(await coreTimeRegulars(db, '2026-10-01')).toEqual([
      { memberId: A, times: 2, minutes: 3, lastDay: '2026-10-17' },
      { memberId: B, times: 1, minutes: 1, lastDay: '2026-10-16' },
    ]);
    expect(await coreTimeSessions(db, '2026-10-17')).toHaveLength(1);
  });

  const stay = async (id: string, minutes: number) => {
    for (let m = 0; m < minutes; m++) await recordCoreTime(db, ct, [id], FRI(21, m));
  };

  it('🎁 終わったら、決めた分以上いた人にだけ 1 回わたす（終わる前・0 銭・6 時間より後はわたさない）', async () => {
    await stay(A, 30);
    await stay(B, 29);
    const on = { ...ct, bonusCoins: 300, bonusMinMinutes: 30 };
    expect(await payCoreTimeBonus(db, { ...ct, bonusCoins: 0 }, FRI(23, 5))).toEqual([]);
    expect(await payCoreTimeBonus(db, on, FRI(22, 59))).toEqual([]);
    expect(await payCoreTimeBonus(db, on, FRI(23, 0))).toEqual([{ day: '2026-10-16', slot: '21:00', amount: 300, memberIds: [A] }]);
    expect(await payCoreTimeBonus(db, on, FRI(23, 1))).toEqual([]);
    expect((await walletOf(db, A)).balance).toBe(300);
    expect((await walletOf(db, B)).balance).toBe(0);
    expect((await coreTimeMembers(db, '2026-10-16', '21:00')).find((r) => r.memberId === A)).toMatchObject({ bonus: 300 });
    // 終わってから 6 時間より後（設定をあとで入れたとき）は、昔の分をわたさない
    expect(await payCoreTimeBonus(db, { ...on, bonusMinMinutes: 1 }, new Date(FRI(23, 0).getTime() + 7 * 3_600_000))).toEqual([]);
  });

  it('🎁 同時に呼ばれても二重にわたさない。#境内 に（通知なしで）知らせる', async () => {
    await stay(A, 30);
    const on = { ...ct, bonusCoins: 100, bonusMinMinutes: 10 };
    const sent: { ch: string; body: { content?: string; allowed_mentions?: unknown } }[] = [];
    const discord = { sendMessage: async (ch: string, body: never) => (sent.push({ ch, body }), { id: 'm' }) } as never;
    const ctx = { db, cfg: { ...cfg, coreTime: on, channels: { ...cfg.channels, keidai: '910000000000000077' } }, discord };
    const n = await Promise.all([processCoreTimeBonus(ctx, FRI(23, 0)), processCoreTimeBonus(ctx, FRI(23, 0))]);
    expect(n[0]! + n[1]!).toBe(1);
    expect((await walletOf(db, A)).balance).toBe(100);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.ch).toBe('910000000000000077');
    expect(sent[0]!.body.content).toContain('コアタイム、おつかれさまでした');
    expect(sent[0]!.body.content).toContain(`<@${A}>`);
    expect(sent[0]!.body.allowed_mentions).toEqual({ parse: [] });
  });
});

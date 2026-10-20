import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CoreTimeConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { coreTimeMembers, coreTimeRegulars, coreTimeSessions, recordCoreTime } from '../src/services/coreTimeAttendance.js';
import { makeDb } from './helpers.js';

const A = '880000000000000301';
const B = '880000000000000302';
// 金曜・土曜の 21:00〜23:00（日本時間）
const ct: CoreTimeConfig = { slots: [{ day: 5, start: '21:00', end: '23:00' }, { day: 6, start: '21:00', end: '23:00' }], noticeDayBefore: '', noticeMinutesBefore: 0 };
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
});

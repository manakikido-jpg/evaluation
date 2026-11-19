import { afterEach, beforeEach, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { activityHourly, engawaPairs, voiceUsage } from '../src/db/schema.js';
import { recordPresence } from '../src/services/voiceUsage.js';
import { addHourlyActivity } from '../src/services/activity.js';
import { makeDb } from './helpers.js';

const A = '8a0000000000000001', B = '8a0000000000000002', C = '8a0000000000000003', D = '8a0000000000000004';
const ENG = '9a0000000000000001', HAI = '9a0000000000000002';
const now = new Date('2026-11-18T03:00:00Z');
let db: Db, close: () => Promise<void>;
beforeEach(async () => { ({ db, close } = await makeDb()); });
afterEach(async () => close());

it('縁側で非ミュートの人だけ、engawa_unmute_minutes と engawa_pairs に記録する', async () => {
  // 縁側: A,B,C 在室。非ミュートは A,B（C はミュート）。拝殿は縁側でない
  const ch = [
    { id: ENG, name: '🌸 縁側', categoryId: 'c', categoryName: '境内', memberIds: [A, B, C], sanpaishaMemberIds: [A], evaluationEligibleMemberIds: [A, B] },
    { id: HAI, name: '拝殿', categoryId: 'c', categoryName: '境内', memberIds: [A, D], sanpaishaMemberIds: [], evaluationEligibleMemberIds: [A, D] },
  ];
  await recordPresence(db, ch, now);
  await recordPresence(db, ch, new Date(now.getTime() + 60_000)); // 2分
  const vu = async (id: string, channelId: string) => (await db.select({ m: voiceUsage.engawaUnmuteMinutes }).from(voiceUsage).where(and(eq(voiceUsage.memberId, id), eq(voiceUsage.channelId, channelId))))[0]?.m ?? 0;
  expect(await vu(A, ENG)).toBe(2); // 縁側・非ミュート
  expect(await vu(B, ENG)).toBe(2);
  expect(await vu(C, ENG)).toBe(0); // ミュート
  expect(await vu(A, HAI)).toBe(0); // 縁側でない
  // engawa_pairs は (A,B) だけ（両方非ミュート・縁側）
  const pairs = await db.select().from(engawaPairs);
  expect(pairs).toHaveLength(1);
  const [a, b] = A < B ? [A, B] : [B, A];
  expect(pairs[0]).toMatchObject({ memberA: a, memberB: b, minutes: 2 });
});

it('ミュート判定がない縁側（evaluationEligibleMemberIds 未指定）では記録しない', async () => {
  await recordPresence(db, [{ id: ENG, name: '縁側', categoryId: 'c', categoryName: '境内', memberIds: [A, B] }], now);
  expect((await db.select().from(engawaPairs))).toHaveLength(0);
  expect((await db.select({ m: voiceUsage.engawaUnmuteMinutes }).from(voiceUsage))[0]?.m).toBe(0);
});

it('時間帯の記録に、縁側にいた分（engawa_minutes）を足す', async () => {
  await addHourlyActivity(db, new Map(), [A, B, C], now, [A, B]); // A,B は縁側、C は縁側でないVC
  const rows = await db.select().from(activityHourly);
  const byId = new Map(rows.map((r) => [r.memberId, r]));
  expect(byId.get(A)).toMatchObject({ vcMinutes: 1, engawaMinutes: 1 });
  expect(byId.get(C)).toMatchObject({ vcMinutes: 1, engawaMinutes: 0 });
});

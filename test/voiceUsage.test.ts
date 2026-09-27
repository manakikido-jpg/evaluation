import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { coinTx, tempVoice } from '../src/db/schema.js';
import { channelsOf, fmtMinutes, partnersOf, recordPresence, roomHistory, sinceDate, topPairs, usageByCategory, usageByMember } from '../src/services/voiceUsage.js';
import { makeDb } from './helpers.js';

const A = '890000000000000001';
const B = '890000000000000002';
const C = '890000000000000003';
const YOI = '990000000000000001';
const HAIDEN = '990000000000000002';
const ROOM = '990000000000000003';
const T0 = new Date('2026-09-27T03:00:00Z');
const min = (n: number) => new Date(T0.getTime() + n * 60_000);

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
});
afterEach(async () => {
  await close();
});

const tick = (at: Date, ch: { yoi?: string[]; haiden?: string[]; room?: string[] }) =>
  recordPresence(
    db,
    [
      { id: YOI, name: '宵宮', categoryId: 'c-yoi', categoryName: '🔞 宵宮', memberIds: ch.yoi ?? [] },
      { id: HAIDEN, name: '拝殿', categoryId: 'c-kei', categoryName: '🌳 境内', memberIds: ch.haiden ?? [] },
      { id: ROOM, name: '🌙 Aの宿坊', categoryId: 'c-neo', categoryName: '🌙 宿坊', memberIds: ch.room ?? [] },
    ],
    at,
  );

describe('通話の記録', () => {
  it('人ごと・カテゴリごとの分と、その人の中の割合が分かる', async () => {
    for (let i = 0; i < 3; i++) await tick(min(i), { yoi: [A, B], haiden: [C] });
    await tick(min(3), { haiden: [A] });
    const since = sinceDate(T0, 30);
    const members = await usageByMember(db, since);
    expect(members.find((m) => m.memberId === A)).toMatchObject({
      total: 4,
      byCategory: [
        { categoryName: '🔞 宵宮', minutes: 3 },
        { categoryName: '🌳 境内', minutes: 1 },
      ],
    });
    expect(await usageByCategory(db, since)).toEqual([
      { categoryId: 'c-yoi', categoryName: '🔞 宵宮', minutes: 6 },
      { categoryId: 'c-kei', categoryName: '🌳 境内', minutes: 4 },
    ]);
    expect((await channelsOf(db, A, since)).map((c) => [c.name, c.minutes])).toEqual([
      ['宵宮', 3],
      ['拝殿', 1],
    ]);
  });

  it('だれとだれが何分いっしょにいたか', async () => {
    for (let i = 0; i < 5; i++) await tick(min(i), { yoi: [A, B, C] });
    await tick(min(5), { yoi: [A, B] });
    const since = sinceDate(T0, 30);
    expect(await partnersOf(db, A, since)).toEqual([
      { memberId: B, minutes: 6 },
      { memberId: C, minutes: 5 },
    ]);
    expect((await topPairs(db, since))[0]).toEqual({ memberA: A, memberB: B, minutes: 6 });
  });

  it('自分の通話部屋: 作った人・種類・人数・のべ時間・払われた部屋代（部屋が消えたあとも）', async () => {
    await db.insert(tempVoice).values({ channelId: ROOM, ownerId: A, hubId: 'hub-neo', kind: 'invite' });
    await tick(min(0), { room: [A, B] });
    await tick(min(30), { room: [A] });
    await db.insert(coinTx).values({ memberId: A, amount: -200, reason: 'room', detail: { channelId: ROOM } });
    await db.delete(tempVoice);
    const [r] = await roomHistory(db, T0);
    expect(r).toMatchObject({ name: '🌙 Aの宿坊', ownerId: A, hubId: 'hub-neo', kind: 'invite', people: 2, personMinutes: 3, paid: 200 });
    expect(r!.lastSeen.getTime() - r!.firstSeen.getTime()).toBe(30 * 60_000);
  });

  it('時間の書き方', () => {
    expect(fmtMinutes(5)).toBe('5分');
    expect(fmtMinutes(120)).toBe('2時間');
    expect(fmtMinutes(754)).toBe('12時間34分');
  });
});

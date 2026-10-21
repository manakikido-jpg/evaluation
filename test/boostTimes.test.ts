import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { boostCovers, boostMembers, createBoost, recordBoostTime } from '../src/services/boostTimes.js';
import { makeDb } from './helpers.js';

const A = '880000000000000601';
const B = '880000000000000602';
const VC1 = '990000000000000601', VC2 = '990000000000000602', CAT = '990000000000000610';
const T = new Date('2026-10-22T03:00:00Z');

describe('⏱ 浮上の記録: 数える場所', () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await makeDb());
  });
  afterEach(async () => {
    await close();
  });

  it('何も選ばなければ全部。チャンネル・カテゴリを選ぶと、そこにいる人だけ', () => {
    expect(boostCovers({ channelIds: [], categoryIds: [] }, { channelId: VC1, parentId: null })).toBe(true);
    expect(boostCovers({ channelIds: [VC1], categoryIds: [] }, { channelId: VC2, parentId: null })).toBe(false);
    expect(boostCovers({ channelIds: [], categoryIds: [CAT] }, { channelId: VC2, parentId: CAT })).toBe(true);
    expect(boostCovers({ channelIds: [], categoryIds: [CAT] }, { channelId: VC1, parentId: null })).toBe(false);
  });

  it('選んだカテゴリの通話にいる人だけ記録する', async () => {
    const b = (await createBoost(db, { title: 'お昼', startAt: T, endAt: new Date(T.getTime() + 3_600_000), minMinutes: 10, categoryIds: [CAT] }, 'staff'))!;
    expect(b.categoryIds).toEqual([CAT]);
    const rooms = [
      { channelId: VC1, parentId: null, memberIds: [A] },
      { channelId: VC2, parentId: CAT, memberIds: [B] },
    ];
    expect(await recordBoostTime(db, rooms, new Date(T.getTime() + 60_000))).toBe(1);
    expect((await boostMembers(db, b.id)).map((m) => m.memberId)).toEqual([B]);
  });
});

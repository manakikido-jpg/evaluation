import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { activityDaily, members, shuin } from '../src/db/schema.js';
import { memberTrend, trendBuckets } from '../src/services/stats.js';
import { niceTicks } from '../src/web/views/charts.js';
import { makeDb } from './helpers.js';

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
});
afterEach(async () => {
  await close();
});

// 2026-09-26（土）21:00 JST
const NOW = new Date('2026-09-26T12:00:00Z');
const at = (jst: string) => new Date(`${jst}+09:00`);

describe('区切り', () => {
  it('30 日は 1 日ごと・3 か月は月曜はじまりの 13 週・1 年は 12 か月。最後は今日まで', () => {
    const d = trendBuckets('30d', NOW);
    expect(d.length).toBe(30);
    expect(d[0]).toMatchObject({ from: '2026-08-28', to: '2026-08-28', label: '8/28' });
    expect(d.at(-1)).toMatchObject({ from: '2026-09-26', to: '2026-09-26' });

    const w = trendBuckets('90d', NOW);
    expect(w.length).toBe(13);
    expect(w.at(-1)).toMatchObject({ from: '2026-09-21', to: '2026-09-26', title: '9/21〜9/26' });
    expect(w.at(-2)).toMatchObject({ from: '2026-09-14', to: '2026-09-20' });

    const m = trendBuckets('1y', NOW);
    expect(m.length).toBe(12);
    expect(m[0]).toMatchObject({ from: '2025-10-01', to: '2025-10-31', label: '10月' });
    expect(m.at(-1)).toMatchObject({ from: '2026-09-01', to: '2026-09-26' });
  });

  it('日本時間の 0 時で日付が変わる', () => {
    // 2026-09-26 15:30 UTC = 9/27 0:30 JST
    expect(trendBuckets('30d', new Date('2026-09-26T15:30:00Z')).at(-1)!.to).toBe('2026-09-27');
  });
});

describe('推移', () => {
  it('人数・入った・抜けた・朱印・発言・通話を数える（BOT は数えない）', async () => {
    const m = (id: string, joined: string, left: string | null = null, isBot = false) => ({
      id,
      username: id,
      displayName: id,
      isBot,
      joinedAt: at(joined),
      leftAt: left ? at(left) : null,
    });
    await db.insert(members).values([
      m('a', '2026-01-01T12:00:00'),
      m('b', '2026-09-25T23:59:00'),
      m('c', '2026-09-20T10:00:00', '2026-09-26T01:00:00'),
      m('bot', '2026-09-26T10:00:00', null, true),
    ]);
    await db.insert(shuin).values([
      { giverId: 'a', receiverId: 'b', weight: 1, giverRank: 'ujiko', createdAt: at('2026-09-26T08:00:00') },
      { giverId: 'b', receiverId: 'a', weight: 1, giverRank: 'ujiko', createdAt: at('2026-09-26T09:00:00'), revokedAt: at('2026-09-26T09:05:00') },
    ]);
    await db.insert(activityDaily).values([
      { memberId: 'a', date: '2026-09-26', messageCount: 5, vcMinutes: 90 },
      { memberId: 'b', date: '2026-09-26', messageCount: 2, vcMinutes: 30 },
      { memberId: 'a', date: '2026-01-01', messageCount: 99, vcMinutes: 99 },
    ]);
    const t = await memberTrend(db, '30d', NOW);
    const day = (d: string) => t.find((x) => x.from === d)!;
    expect(day('2026-09-19').members).toBe(1);
    expect(day('2026-09-20')).toMatchObject({ members: 2, joined: 1, left: 0 });
    expect(day('2026-09-25')).toMatchObject({ members: 3, joined: 1 });
    expect(day('2026-09-26')).toMatchObject({ members: 2, joined: 0, left: 1, shuin: 1, messages: 7, vcMinutes: 120 });

    const y = await memberTrend(db, '1y', NOW);
    expect(y.at(-1)).toMatchObject({ members: 2, joined: 2, left: 1 });
    expect(y.find((x) => x.from === '2026-01-01')).toMatchObject({ joined: 1, messages: 99 });
  });
});

describe('目盛り', () => {
  it('きりのよい数で、最大値を含む', () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(3)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(87)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(1234).at(-1)).toBeGreaterThanOrEqual(1234);
  });
});

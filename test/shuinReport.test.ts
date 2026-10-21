import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { activityDaily, memberEvents, members, shuin, specialGoen, voiceUsage } from '../src/db/schema.js';
import { buildShuinReport, histogram, quantile } from '../src/services/shuinReport.js';
import { ROLE, cfg, makeDb } from './helpers.js';

const A = '880000000000000401'; // 参拝者・発言だけ
const B = '880000000000000402'; // 氏子・発言と通話（重ねない）
const C = '880000000000000403'; // 世話役・通話だけ
const BOT = '880000000000000404';
const GONE = '880000000000000405';
const NOW = new Date('2026-10-21T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('📊 御朱印の昇格条件の集計（読むだけ）', () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await makeDb());
  });
  afterEach(async () => {
    await close();
  });

  it('中央値・分布', () => {
    expect(quantile([5, 1, 3], 0.5)).toBe(3);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([], 0.5)).toBeUndefined();
    expect(histogram([0, 3, 15, 120])).toContain('0: 1  1〜4: 1');
    expect(histogram([0, 3, 15, 120])).toContain('100〜: 1');
  });

  it('BOT・退出者を除き、役職ごとの人数・浮上・ご縁・届く人数を出す。名前と ID は出さない', async () => {
    const base = { username: 'u', displayName: 'ひみつの名前', avatarUrl: null };
    await db.insert(members).values([
      { ...base, id: A, roleIds: [ROLE.sanpaisha], joinedAt: daysAgo(40) },
      { ...base, id: B, roleIds: [ROLE.ujiko], joinedAt: daysAgo(20) },
      { ...base, id: C, roleIds: [ROLE.sewayaku], joinedAt: daysAgo(60) },
      { ...base, id: BOT, roleIds: [ROLE.sanpaisha], isBot: true },
      { ...base, id: GONE, roleIds: [ROLE.ujiko], leftAt: daysAgo(1) },
    ]);
    await db.insert(memberEvents).values([
      { memberId: B, kind: 'join', at: daysAgo(20) },
      { memberId: B, kind: 'promote', detail: { from: 'sanpaisha', to: 'ujiko', goen: 20 }, at: daysAgo(10) },
    ]);
    await db.insert(activityDaily).values([
      { memberId: A, date: '2026-10-20', messageCount: 3 },
      { memberId: B, date: '2026-10-21', messageCount: 1 },
      { memberId: C, date: '2026-10-01', messageCount: 0, vcMinutes: 0 },
    ]);
    await db.insert(voiceUsage).values([
      { memberId: B, date: '2026-10-21', channelId: 'v', minutes: 10 },
      { memberId: C, date: '2026-10-05', channelId: 'v', minutes: 30 },
    ]);
    await db.insert(shuin).values([
      { giverId: A, receiverId: B, weight: 1, giverRank: 'sanpaisha', createdAt: daysAgo(5) },
      { giverId: C, receiverId: B, weight: 3, giverRank: 'sewayaku', createdAt: daysAgo(5) },
      { giverId: B, receiverId: C, weight: 2, giverRank: 'ujiko', createdAt: daysAgo(50), revokedAt: daysAgo(40) },
    ]);
    await db.insert(specialGoen).values({ memberId: B, amount: 20, reason: 'r', grantedBy: 'g', nonce: 'n1' });

    const text = await buildShuinReport(db, cfg, { now: NOW, proposal: { sanpaisha: 0, ujiko: 15, sewayaku: 50 } });
    expect(text).toContain('- 氏子（ujiko）: 押す朱印 2 点 ・ 自動昇格 ご縁 20');
    expect(text).toContain('- ぜんぶ: 3 人');
    // 7 日: A は発言だけ・B は両方（1 人）・C は浮上なし。30 日なら C は通話だけ
    expect(text).toMatch(/### 直近 7 日[\s\S]*- 氏子（1 人）: 浮上 1 人（100.0%）＝ 発言だけ 0・通話だけ 0・両方 1/);
    expect(text).toMatch(/### 直近 7 日[\s\S]*- 世話役（1 人）: 浮上 0 人/);
    expect(text).toMatch(/### 直近 30 日[\s\S]*- 世話役（1 人）: 浮上 1 人（100.0%）＝ 発言だけ 0・通話だけ 1・両方 0/);
    // 取り消した朱印は数えない。特別ご縁は分ける
    expect(text).toMatch(/### 氏子（1 人）\n- 朱印をくれた人数: 中央値 2/);
    expect(text).toContain('- 朱印のご縁: 中央値 4');
    expect(text).toContain('- 特別ご縁: もらった人 1 人・中央値 20');
    expect(text).toContain('- 合計のご縁: 中央値 24');
    // 昇格までの日数（B は 10 日で氏子）
    expect(text).toMatch(/### 氏子\n- 届いた: 1 人 ・ 日数 中央値 10/);
    // 条件ごとに届く人数: いまは氏子 20 に 1 人、暫定案の世話役 50 には 0 人
    expect(text).toMatch(/### いまの条件[\s\S]*- 氏子（ご縁 20）以上: 1 人/);
    expect(text).toMatch(/### 暫定案[\s\S]*- 氏子（ご縁 15）以上: 1 人[\s\S]*- 世話役（ご縁 50）以上: 0 人/);
    for (const secret of [A, B, C, 'ひみつの名前']) expect(text).not.toContain(secret);
  });
});

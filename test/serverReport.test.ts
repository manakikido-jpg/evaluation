import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { activityDaily, activityHourly, casinoGames, coinTx, memberEvents, members, messageArchive, shuin, voiceChannels, voiceUsage, wallets } from '../src/db/schema.js';
import { buildServerReport } from '../src/services/serverReport.js';
import { ROLE, cfg, makeDb } from './helpers.js';

const A = '880000000000000501';
const B = '880000000000000502';
const BOT = '880000000000000503';
const GONE = '880000000000000504';
// 日本時間 2026-11-14（土）21:00
const NOW = new Date('2026-11-14T12:00:00Z');
const at = (date: string) => new Date(`${date}T12:00:00+09:00`);

describe('📊 サーバーのようすの集計（読むだけ）', () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await makeDb());
  });
  afterEach(async () => {
    await close();
  });

  it('人数・浮上・時間帯・通話・発言・朱印・銭・カジノ・週ごとを出す。BOT は数えず、名前と ID は出さない', async () => {
    const base = { username: 'u', displayName: 'ひみつの名前', avatarUrl: null };
    await db.insert(members).values([
      { ...base, id: A, roleIds: [ROLE.sanpaisha], joinedAt: at('2026-11-10'), ageGroup: 'adult' },
      { ...base, id: B, roleIds: [ROLE.ujiko], joinedAt: at('2026-10-01') },
      { ...base, id: BOT, roleIds: [], isBot: true },
      { ...base, id: GONE, roleIds: [], leftAt: at('2026-11-12') },
    ]);
    await db.insert(memberEvents).values([
      { memberId: A, kind: 'join', at: at('2026-11-10') },
      { memberId: GONE, kind: 'join', at: at('2026-11-11') },
      { memberId: GONE, kind: 'leave', at: at('2026-11-12') },
      { memberId: BOT, kind: 'join', at: at('2026-11-11') },
    ]);
    await db.insert(activityDaily).values([
      { memberId: A, date: '2026-11-13', messageCount: 5 },
      { memberId: B, date: '2026-11-14', messageCount: 20 },
      { memberId: BOT, date: '2026-11-14', messageCount: 999 },
    ]);
    await db.insert(activityHourly).values([
      { memberId: A, date: '2026-11-13', hour: 22, messages: 5, vcMinutes: 0 },
      { memberId: B, date: '2026-11-14', hour: 22, messages: 20, vcMinutes: 30 },
    ]);
    await db.insert(voiceChannels).values([
      { channelId: 'en', name: '大きな縁側', categoryName: '境内' },
      { channelId: 'v', name: '雑談' },
    ]);
    await db.insert(voiceUsage).values([
      { memberId: B, date: '2026-11-14', channelId: 'en', minutes: 120 },
      { memberId: A, date: '2026-11-13', channelId: 'v', minutes: 30 },
    ]);
    await db.insert(messageArchive).values([
      { messageId: 'm1', channelId: 'c1', channelName: '雑談', authorId: A, authorName: 'ひみつの名前', content: 'こんにちは', createdAt: at('2026-11-13') },
      { messageId: 'm2', channelId: 'c1', channelName: '雑談', authorId: BOT, authorName: 'bot', content: 'x', createdAt: at('2026-11-13') },
    ]);
    await db.insert(shuin).values({ giverId: A, receiverId: B, weight: 1, giverRank: 'sanpaisha', createdAt: at('2026-11-13') });
    await db.insert(coinTx).values([
      { memberId: A, amount: 500, reason: 'voice', at: at('2026-11-13') },
      { memberId: A, amount: -100, reason: 'casino_bet', detail: { game: 'slots' }, at: at('2026-11-13') },
    ]);
    await db.insert(wallets).values([{ memberId: A, balance: 400 }, { memberId: B, balance: 1000 }]);
    await db.insert(casinoGames).values({ memberId: A, game: 'slots', bet: 100, payout: 250, state: {}, status: 'done', createdAt: at('2026-11-13') });

    const text = await buildServerReport(db, cfg, { now: NOW, days: 7, weeks: 2 });
    expect(text).toContain('期間: 2026-11-08〜2026-11-14（7 日）');
    expect(text).toContain('- 在籍: 2 人');
    expect(text).toContain('18 歳以上 1・18 歳未満 0・不明 1');
    expect(text).toContain('参拝者 1・氏子 1');
    expect(text).toContain('- 入った: のべ 2 回・2 人');
    expect(text).toContain('- 抜けた: 1 回');
    expect(text).toContain('- 入った人のうち、今もいる: 1 人（50.0%）');
    // BOT の発言は数えない
    expect(text).toContain('- 期間に浮上した人: 2 人');
    expect(text).toContain('- 合計: 25 件');
    expect(text).toContain('| 22 時 | 1 | 0.5 | 1 |');
    expect(text).toContain('- いちばん多い時間: 22 時（1 人） ／');
    expect(text).toContain('曜日ごとの浮上（1 日の平均）: 月 0・火 0・水 0・木 0・金 1・土 1・日 0');
    expect(text).toContain('- 合計: 2.5 時間');
    expect(text).toContain('- 縁側: 2.0 時間・1 人');
    expect(text).toContain('  - 境内 / 大きな縁側: 2.0 時間・1 人');
    expect(text).toContain('  - #雑談: 1 件・1 人');
    expect(text).toContain('- 押された朱印: 1');
    expect(text).toMatch(/通話: \+500・1 人/);
    expect(text).toContain('| slots | 1 | 1 | 100 | 250 | -150 | 250.0% |');
    expect(text).toMatch(/## 11\. 週ごとの推移[\s\S]*\| 11-02〜11-08 \| 0 \|[\s\S]*\| 11-09〜11-15 \| 2 \| 2 \| 2 \| 2\.5 時間 \| 2\.0 時間 \| 25 \| 1 \| 2 \| 1 \|/);
    for (const secret of [A, B, 'ひみつの名前', 'こんにちは']) expect(text).not.toContain(secret);
  });

  it('記録がなくても出せる', async () => {
    const text = await buildServerReport(db, cfg, { now: NOW });
    expect(text).toContain('- 在籍: 0 人');
    expect(text).toContain('時間帯の記録（activity_hourly）がまだありません');
    expect(text).toContain('- 遊んだ回はありません。');
  });
});

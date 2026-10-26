import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/db/client.js';
import { makeDb } from './helpers.js';
import { bookSlot, closeThread, guideThreadConfig, openSlots, openThreads, parseTimes, recordThread, saveGuideThreadConfig, slotDate, takeDueReminders, threadById, validSlot, guideThreadConfigSchema } from '../src/services/guideThreads.js';
import { GuideThreadApp, guideThreadMessage } from '../src/discord/guideThreads.js';

let db: Db, close: () => Promise<void>;
beforeEach(async () => { ({ db, close } = await makeDb()); });
afterEach(async () => { await close(); });
const M = '880000000000000001';
// 日本時間 10月27日 20:30
const now = new Date('2026-10-27T11:30:00Z');

describe('案内スレッドの時間', () => {
  it('時刻を読む（24 時は次の日の 0 時）', () => {
    expect(parseTimes('21:00 22:00、9:30,24:00')).toEqual(['09:30', '21:00', '22:00', '24:00']);
    expect(parseTimes('なし')).toEqual([]);
    expect(parseTimes('25時')).toBeUndefined();
    expect(slotDate('2026-10-27', '24:00').toISOString()).toBe('2026-10-27T15:00:00.000Z');
  });
  it('はじめは使わない。今日のまだの時間、日ごとの時間、なければ明日', async () => {
    const c = await guideThreadConfig(db);
    expect(c.enabled).toBe(false);
    expect(openSlots(c, now).map(s => s.time)).toEqual(['21:00', '22:00', '23:00', '24:00']);
    const c2 = guideThreadConfigSchema.parse({ days: { '2026-10-27': ['20:00'], '2026-10-28': ['19:00'] } });
    expect(openSlots(c2, now)).toEqual([{ date: '2026-10-28', time: '19:00', label: '10月28日 19:00', tomorrow: true }]);
    expect(validSlot(c2, '2026-10-28', '19:00', now)).toBe(true);
    expect(validSlot(c2, '2026-10-27', '20:00', now)).toBe(false);
    const msg = JSON.stringify(guideThreadMessage(c2, M, now));
    expect(msg).toContain('gth:slot:2026-10-28:19:00'); expect(msg).toContain('明日 19:00'); expect(msg).toContain('gth:now'); expect(msg).toContain('gth:other');
  });
  it('保存すると過ぎた日を消す', async () => {
    const v = await saveGuideThreadConfig(db, guideThreadConfigSchema.parse({ enabled: true, channelId: '880000000000000009', days: { '2026-10-20': ['21:00'], '2026-10-27': [] } }), 'admin', now);
    expect(v.days).toEqual({ '2026-10-27': [] });
    expect((await guideThreadConfig(db)).enabled).toBe(true);
  });
  it('予約・10 分前のお知らせは 1 回だけ・閉じる', async () => {
    await recordThread(db, M, 't1', false, now);
    await bookSlot(db, M, '2026-10-27', '21:00');
    expect((await threadById(db, 't1'))!.slotLabel).toBe('10月27日 21:00');
    expect(await takeDueReminders(db, now)).toHaveLength(0);
    const at = new Date('2026-10-27T11:51:00Z');
    expect(await takeDueReminders(db, at)).toHaveLength(1);
    expect(await takeDueReminders(db, at)).toHaveLength(0);
    await closeThread(db, M, at);
    expect(await openThreads(db)).toHaveLength(0);
  });
});

describe('Discord の案内スレッド', () => {
  it('本人だけが押せて、時間を押すと案内人に知らせる', async () => {
    await saveGuideThreadConfig(db, guideThreadConfigSchema.parse({ enabled: true, channelId: '880000000000000009' }), 'admin', now);
    await recordThread(db, M, 'thr', false, now);
    vi.useFakeTimers(); vi.setSystemTime(now);
    try {
      const sent: unknown[] = [];
      const thread = { id: 'thr', isThread: () => true, guild: { roles: { cache: new Map([['r1', { id: 'r1', name: '案内人' }]]) }, channels: { cache: new Map() } }, send: async (b: unknown) => { sent.push(b); }, toString: () => '<#thr>' };
      const app = new GuideThreadApp(db, () => ({ guildId: 'g', channels: {} }) as never);
      const replies: unknown[] = [];
      const base = { isButton: () => true, isModalSubmit: () => false, inCachedGuild: () => true, guildId: 'g', channel: thread, deferred: false, reply: async (b: unknown) => { replies.push(b); }, deferReply: async function (this: { deferred: boolean }) { this.deferred = true; }, editReply: async (b: unknown) => { replies.push(b); } };
      await app.onInteraction({ ...base, customId: 'gth:slot:2026-10-27:22:00', user: { id: 'someone' } } as never);
      expect(JSON.stringify(replies)).toContain('本人だけ');
      expect(sent).toHaveLength(0);
      await app.onInteraction({ ...base, customId: 'gth:slot:2026-10-27:22:00', user: { id: M } } as never);
      expect(JSON.stringify(sent)).toContain('<@&r1>');
      expect(JSON.stringify(sent)).toContain('10月27日 22:00');
      expect((await threadById(db, 'thr'))!.slotLabel).toBe('10月27日 22:00');
      await app.onInteraction({ ...base, customId: 'gth:slot:2026-10-27:20:00', user: { id: M } } as never);
      expect(JSON.stringify(replies.at(-1))).toContain('もう選べません');
    } finally { vi.useRealTimers(); }
  });
});

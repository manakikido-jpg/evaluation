import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/db/client.js';
import { makeDb } from './helpers.js';
import { threadOf, bookSlot, closeThread, guideThreadConfig, openSlots, openThreads, parseTimes, recordThread, saveGuideThreadConfig, slotDate, takeDueReminders, threadById, validSlot, guideThreadConfigSchema } from '../src/services/guideThreads.js';
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
    expect(msg).not.toContain('<@&');
    const withRole = guideThreadMessage(c2, M, now, '880000000000000077');
    expect(withRole.content).toContain('<@&880000000000000077>'); expect(withRole.allowedMentions.roles).toEqual(['880000000000000077']);
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

describe('時間外の希望を #案内希望日程 へ', () => {
  it('名前と希望の日時を出し、出し直しは書きかえ、閉じたら消す。要注意の人は出さない', async () => {
    await recordThread(db, M, 'thr', false, now);
    const posts: { id: string; content: string }[] = [], deleted: string[] = [];
    const sched = { id: 's1', type: 0, name: '案内希望日程', send: async (b: { content: string }) => { const m = { id: 'm' + (posts.length + 1), content: b.content, edit: async (x: { content: string }) => { m.content = x.content; } }; posts.push(m); return m; }, messages: { fetch: async (id: string) => posts.find(p => p.id === id), delete: async (id: string) => { deleted.push(id); } } };
    const guild = { id: 'g', roles: { cache: new Map([['r1', { id: 'r1', name: '案内人' }], ['p1', { id: 'p1', name: '案内待ち' }]]) }, channels: { cache: new Map([['s1', sched]]), fetch: async () => null }, members: { cache: new Map([[M, { displayName: 'さくら', roles: { cache: new Map() } }]]), fetch: async () => { throw Object.assign(new Error('x'), { code: 10007 }); } } };
    const sent: unknown[] = [];
    const thread = { id: 'thr', isThread: () => true, guild, send: async (b: unknown) => { sent.push(b); }, toString: () => '<#thr>' };
    const app = new GuideThreadApp(db, () => ({ guildId: 'g', channels: {}, roles: { guidePending: 'p1' } }) as never);
    const modal = (when: string) => ({ isButton: () => false, isModalSubmit: () => true, inCachedGuild: () => true, guildId: 'g', channel: thread, customId: 'gth:otherform', user: { id: M }, fields: { getTextInputValue: () => when }, deferred: false, deferReply: async function (this: { deferred: boolean }) { this.deferred = true; }, editReply: async () => undefined, reply: async () => undefined });
    await app.onInteraction(modal('10月28日 20時ごろ') as never);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.content).toContain('さくら'); expect(posts[0]!.content).toContain('10月28日 20時ごろ'); expect(posts[0]!.content).toContain('<#thr>');
    expect((await threadById(db, 'thr'))!.scheduleMessageId).toBe('m1');
    await app.onInteraction(modal('10月29日 21時') as never);
    expect(posts).toHaveLength(1); expect(posts[0]!.content).toContain('10月29日 21時');
    // 抜けたら閉じて、日程の書き込みを消す
    guild.members.cache.delete(M);
    await app.tick(guild as never, now);
    expect(deleted).toEqual(['m1']);
    expect(await openThreads(db)).toHaveLength(0);
    // 要注意の人は出さない
    await recordThread(db, '880000000000000002', 'thr2', true, now);
    const t2 = { ...thread, id: 'thr2' };
    await app.onInteraction({ ...modal('いつでも'), channel: t2, user: { id: '880000000000000002' } } as never);
    expect(posts).toHaveLength(1);
  });
});

describe('入ったときにスレッドを作る', () => {
  it('入りなおした人は前のスレッドを閉じて新しく作る。オンボーディングのロールがあっても作り、承認ずみの人には作らない', async () => {
    await saveGuideThreadConfig(db, guideThreadConfigSchema.parse({ enabled: true, channelId: '880000000000000050' }), 'admin', now);
    let n = 0; const edits: string[] = [];
    const parent = { type: 0, threads: { create: async () => ({ id: 'new' + ++n, members: { add: async () => undefined }, send: async () => undefined }) } };
    const guild = { id: 'g', roles: { cache: new Map([['r1', { id: 'r1', name: '案内人' }]]) }, channels: { cache: new Map([['880000000000000050', parent]]), fetch: async (id: string) => ({ isThread: () => true, edit: async () => { edits.push(id); } }) }, members: { cache: new Map() } };
    const member = (roles: string[]) => ({ id: M, displayName: 'さくら', user: { bot: false }, guild, roles: { cache: new Map(roles.map(r => [r, { id: r }])) } });
    const app = new GuideThreadApp(db, () => ({ guildId: 'g', channels: {}, roles: {}, ranks: [{ roleId: 'rank1' }] }) as never);
    await recordThread(db, M, 'old', false, now);
    await app.onMemberAdd(member(['onboard']) as never);
    expect(edits).toEqual(['old']);
    expect((await threadOf(db, M))!.threadId).toBe('new1');
    await app.onMemberAdd(member(['rank1']) as never);
    expect((await threadOf(db, M))!.threadId).toBe('new1');
  });
});

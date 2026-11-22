import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuideThreadApp } from '../src/discord/guideThreads.js';
import { bookSlot, closeThread, guideThreadConfigSchema, saveGuideThreadConfig, recordThread, threadOf } from '../src/services/guideThreads.js';
import type { Db } from '../src/db/client.js';
import { makeDb } from './helpers.js';

let db: Db, close: () => Promise<void>;
beforeEach(async () => { ({ db, close } = await makeDb()); });
afterEach(async () => { await close(); });
const M = '880000000000000001', N = '880000000000000002';
const now = new Date('2026-11-22T01:00:00Z');
const config = () => ({ guildId: 'g', roles: {}, channels: {} }) as never;
function fixture() {
  const member = (pending = false) => ({ roles: { cache: new Map(pending ? [['p', {}]] : []) } });
  const thread = { isThread: () => true, archived: false, locked: false, edit: vi.fn().mockResolvedValue(undefined) };
  const active = new Map([['thr', thread], ['unrelated', thread]]);
  const guild = {
    id: 'g', roles: { cache: new Map([['p', { id: 'p', name: '案内待ち' }]]) },
    members: { cache: new Map([[M, member()]]), fetch: vi.fn().mockResolvedValue(member()) },
    channels: { cache: new Map(), fetch: vi.fn().mockResolvedValue(thread), fetchActiveThreads: vi.fn().mockResolvedValue({ threads: active }) },
  };
  return { member, thread, guild, active, app: new GuideThreadApp(db, config) };
}

describe('完了した案内スレッドの整理', () => {
  it('Discordの終了失敗ではDBを閉じず、再起動後に再試行する', async () => {
    await recordThread(db, M, 'thr', false, now);
    const { guild, thread, app } = fixture();
    thread.edit.mockRejectedValueOnce(new Error('network timeout'));
    await app.tick(guild as never, now);
    expect((await threadOf(db, M))!.closedAt).toBeNull();
    await new GuideThreadApp(db, config).tick(guild as never, new Date(+now + 60_000));
    expect(thread.edit).toHaveBeenCalledTimes(2);
    expect((await threadOf(db, M))!.closedAt).not.toBeNull();
  });
  it('DBだけ終了した過去の分を回収する。無関係なスレッドには触らず、全件照合は5分ごと', async () => {
    await recordThread(db, M, 'thr', false, now);
    await closeThread(db, M, now);
    const { guild, thread, app } = fixture();
    await app.tick(guild as never, now);
    expect(guild.channels.fetch).toHaveBeenCalledExactlyOnceWith('thr');
    expect(thread.edit).toHaveBeenCalledWith(expect.objectContaining({ archived: true, locked: true }));
    await app.tick(guild as never, new Date(+now + 60_000));
    expect(guild.channels.fetchActiveThreads).toHaveBeenCalledTimes(1);
    expect(thread.edit).toHaveBeenCalledTimes(1);
    await app.tick(guild as never, new Date(+now + 300_000));
    expect(guild.channels.fetchActiveThreads).toHaveBeenCalledTimes(2);
  });
  it('すでに終了済みの分の閉鎖失敗も、次の照合で再試行する', async () => {
    await recordThread(db, M, 'thr', false, now); await closeThread(db, M, now);
    const { guild, thread, app } = fixture(); thread.edit.mockRejectedValueOnce(new Error('Missing Permissions'));
    await app.tick(guild as never, now);
    await app.tick(guild as never, new Date(+now + 300_000));
    expect(thread.edit).toHaveBeenCalledTimes(2);
  });
  it.each([true, false])('キャッシュにいない人も取得後の案内待ち=%sを判定する', async pending => {
    await recordThread(db, M, 'thr', false, now); await bookSlot(db, M, '2026-11-23', '21:00');
    const { guild, member, thread, app } = fixture(); guild.members.cache.clear(); guild.members.fetch.mockResolvedValue(member(pending));
    await app.tick(guild as never, now);
    expect(thread.edit).toHaveBeenCalledTimes(pending ? 0 : 1);
    expect((await threadOf(db, M))!.closedAt === null).toBe(pending);
  });
  it('メンバー取得の通信失敗では閉じず、退会確認10007なら閉じる', async () => {
    await recordThread(db, M, 'thr', false, now);
    const { guild, thread, app } = fixture(); guild.members.cache.clear();
    guild.members.fetch.mockRejectedValueOnce(new Error('timeout'));
    await app.tick(guild as never, now); expect(thread.edit).not.toHaveBeenCalled();
    guild.members.fetch.mockRejectedValueOnce(Object.assign(new Error('Unknown Member'), { code: 10007 }));
    await app.tick(guild as never, new Date(+now + 60_000)); expect(thread.edit).toHaveBeenCalledTimes(1);
  });
  it('アーカイブ済み・未ロックは開いて施錠し、両方済みなら編集しない', async () => {
    await recordThread(db, M, 'thr', false, now);
    const { guild, thread, app } = fixture(); thread.archived = true;
    await app.tick(guild as never, now);
    expect(thread.edit.mock.calls.map(c => c[0])).toEqual([
      expect.objectContaining({ archived: false }), expect.objectContaining({ archived: true, locked: true }),
    ]);
    await recordThread(db, M, 'thr', false, now); thread.locked = true; thread.edit.mockClear();
    await app.tick(guild as never, new Date(+now + 60_000));
    expect(thread.edit).not.toHaveBeenCalled(); expect((await threadOf(db, M))!.closedAt).not.toBeNull();
  });
  it('チャンネル取得の権限エラーでは未処理を保ち、削除済み10003のみ完了にする', async () => {
    await recordThread(db, M, 'thr', false, now);
    const { guild, app } = fixture();
    guild.channels.fetch.mockRejectedValueOnce(Object.assign(new Error('Missing Access'), { code: 50001 }));
    await app.tick(guild as never, now); expect((await threadOf(db, M))!.closedAt).toBeNull();
    guild.channels.fetch.mockRejectedValueOnce(Object.assign(new Error('Unknown Channel'), { code: 10003 }));
    await app.tick(guild as never, new Date(+now + 60_000)); expect((await threadOf(db, M))!.closedAt).not.toBeNull();
  });
  it('全件照合が失敗しても通常の整理を続け、1件の失敗で他の人を止めない', async () => {
    await recordThread(db, M, 'thr', false, now); await recordThread(db, N, 'thr2', false, now);
    const { guild, member, thread, app } = fixture(); guild.members.cache.set(N, member());
    guild.channels.fetchActiveThreads.mockRejectedValueOnce(new Error('timeout'));
    guild.channels.fetch.mockRejectedValueOnce(new Error('timeout'));
    await app.tick(guild as never, now);
    expect((await threadOf(db, M))!.closedAt).toBeNull();
    expect((await threadOf(db, N))!.closedAt).not.toBeNull(); expect(thread.edit).toHaveBeenCalledTimes(1);
  });
  it('案内待ちロールが特定できなければ未完了の人を閉じない', async () => {
    await recordThread(db, M, 'thr', false, now);
    const { guild, thread, app } = fixture(); guild.roles.cache.clear();
    await app.tick(guild as never, now); expect(thread.edit).not.toHaveBeenCalled();
  });
  it('入りなおしの整理失敗では古い記録を上書きせず、次回は新しい案内を作れる', async () => {
    await recordThread(db, M, 'thr', false, now);
    await saveGuideThreadConfig(db, guideThreadConfigSchema.parse({ enabled: true, channelId: '880000000000000050' }), 'admin', now);
    const { guild, thread, member } = fixture();
    const create = vi.fn().mockResolvedValue({ id: 'new', members: { add: vi.fn() }, send: vi.fn() });
    (guild.channels.cache as Map<string, unknown>).set('880000000000000050', { type: 0, threads: { create } });
    const app = new GuideThreadApp(db, () => ({ guildId: 'g', ranks: [], roles: {}, channels: {} }) as never);
    const newcomer = { ...member(), id: M, user: { bot: false }, displayName: 'さくら', guild };
    thread.edit.mockRejectedValueOnce(new Error('Missing Permissions'));
    await expect(app.onMemberAdd(newcomer as never)).rejects.toThrow('Missing Permissions');
    expect(create).not.toHaveBeenCalled(); expect((await threadOf(db, M))!.threadId).toBe('thr');
    await app.onMemberAdd(newcomer as never);
    expect(create).toHaveBeenCalledTimes(1); expect((await threadOf(db, M))!.threadId).toBe('new');
  });
  it('古い処理が新しいスレッドのDBを閉じない', async () => {
    await recordThread(db, M, 'old', false, now); await recordThread(db, M, 'new', false, now);
    await closeThread(db, M, now, 'old');
    expect((await threadOf(db, M))!.closedAt).toBeNull();
  });
});

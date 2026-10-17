import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { Interaction, VoiceState } from 'discord.js';
import { RecordingApp } from '../src/discord/recording.js';
import { RecordingStore } from '../src/services/recording/store.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const calls = vi.hoisted(() => ({ join: vi.fn(), ready: vi.fn() }));
vi.mock('@discordjs/voice', () => ({
  EndBehaviorType: { Manual: 'manual' }, VoiceConnectionStatus: { Ready: 'ready', Disconnected: 'disconnected', Destroyed: 'destroyed' },
  joinVoiceChannel: (...args: unknown[]) => calls.join(...args), entersState: (...args: unknown[]) => calls.ready(...args),
}));
let close: () => Promise<void>, root: string, app: RecordingApp, store: RecordingStore;
let conn: EventEmitter & { state: { status: string }; destroy: ReturnType<typeof vi.fn>; receiver: { subscribe: ReturnType<typeof vi.fn> } };
let channel: ReturnType<typeof fakeChannel>;
let message: { id: string; edit: ReturnType<typeof vi.fn> };
function fakeChannel() {
  return { id: '910000000000000004', name: '確認の通話', type: 2,
    guild: { id: cfg.guildId, voiceAdapterCreator: {}, afkChannelId: null },
    members: new Map(['alice', 'bob'].map(id => [id, { id, user: { bot: false } }])),
    send: vi.fn(async (_payload: unknown) => message),
  };
}
function interaction(user: string, action?: string): Interaction {
  return {
    commandName: 'recording', customId: action, message,
    isChatInputCommand: () => !action, isButton: () => Boolean(action), inCachedGuild: () => true,
    guildId: cfg.guildId, guild: channel.guild, user: { id: user },
    member: { roles: { cache: new Map([[ROLE.shinshoku, {}]]) }, voice: { channel, channelId: channel.id } },
    reply: vi.fn(async () => undefined), deferReply: vi.fn(async () => undefined), editReply: vi.fn(async () => undefined),
  } as unknown as Interaction;
}
function button(action: string) {
  const result = message.edit.mock.calls.find(c => c[0]?.components?.length)?.[0] ?? channel.send.mock.calls[0]?.[0];
  return result.components[0].components.find((b: { data: { custom_id: string } }) => b.data.custom_id.endsWith(`:${action}`)).data.custom_id as string;
}
beforeEach(async () => {
  calls.join.mockReset(); calls.ready.mockReset();
  const setup = await makeDb(); close = setup.close;
  root = await mkdtemp(path.join(tmpdir(), 'recording-discord-'));
  store = new RecordingStore(setup.db, root);
  app = new RecordingApp(setup.db, () => ({ ...cfg, recording: { ...cfg.recording, enabled: true, voiceChannelIds: ['910000000000000004'] } }), store);
  message = { id: 'consent-card', edit: vi.fn(async () => undefined) };
  channel = fakeChannel();
  conn = Object.assign(new EventEmitter(), { state: { status: 'ready' }, destroy: vi.fn(), receiver: { subscribe: vi.fn(() => new PassThrough()) } });
  conn.destroy.mockImplementation(() => { conn.state.status = 'destroyed'; conn.emit('stateChange', {}, { status: 'destroyed' }); });
  calls.join.mockReturnValue(conn); calls.ready.mockResolvedValue(conn);
});
afterEach(async () => { await app.stop(); await close(); await rm(root, { recursive: true, force: true }); });

describe('Discord録音の開始と停止', () => {
  it('全員が同意するまで音声に接続せず、停止で接続と受付を閉じる', async () => {
    await app.onInteraction(interaction('alice'));
    expect(calls.join).not.toHaveBeenCalled();
    await app.onInteraction(interaction('alice', button('agree')));
    await app.onInteraction(interaction('alice', button('start')));
    expect(calls.join).not.toHaveBeenCalled();
    await app.onInteraction(interaction('bob', button('agree')));
    await app.onInteraction(interaction('alice', button('start')));
    expect(calls.join).toHaveBeenCalledOnce();
    expect(conn.receiver.subscribe.mock.calls.map(c => c[0])).toEqual(['alice', 'bob']);
    await app.onInteraction(interaction('bob', button('stop')));
    expect(conn.destroy).toHaveBeenCalledOnce();
    // 空の音声は保存一覧に残さない。
    expect(await store.list('alice', false)).toEqual([]);
  });
  it('接続のエラーでもBOTを落とさず録音を停止する', async () => {
    await app.onInteraction(interaction('alice'));
    await app.onInteraction(interaction('alice', button('agree')));
    await app.onInteraction(interaction('bob', button('agree')));
    await app.onInteraction(interaction('alice', button('start')));
    expect(() => conn.emit('error', new Error('voice transport failure'))).not.toThrow();
    await app.stop();
    expect(conn.destroy).toHaveBeenCalledOnce();
    expect(await store.list('alice', false)).toEqual([]);
  });
  it('同意待ちに人が入れ替わると、その受付では開始できない', async () => {
    await app.onInteraction(interaction('alice'));
    const start = button('start');
    app.onVoiceStateUpdate({ channelId: null } as VoiceState, { channelId: channel.id, member: { user: { bot: false } } } as VoiceState);
    await app.stop();
    await app.onInteraction(interaction('alice', start));
    expect(calls.join).not.toHaveBeenCalled();
  });
  it('接続の準備中に停止しても、後から録音を始めない', async () => {
    await app.onInteraction(interaction('alice'));
    await app.onInteraction(interaction('alice', button('agree')));
    await app.onInteraction(interaction('bob', button('agree')));
    let release!: () => void;
    calls.ready.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const starting = app.onInteraction(interaction('alice', button('start')));
    // 全部のテストを同時に流すと遅くなるので、長めに待つ
    await vi.waitFor(() => expect(calls.ready).toHaveBeenCalledOnce(), { timeout: 15000 });
    const stopped = app.stop();
    release();
    await Promise.all([starting, stopped]);
    expect(conn.receiver.subscribe).not.toHaveBeenCalled();
    expect(conn.destroy).toHaveBeenCalledOnce();
    expect(await store.list('alice', false)).toEqual([]);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { ChannelType } from 'discord.js';
import type { ChatInputCommandInteraction, Message, VoiceState } from 'discord.js';
import { loadReadAloudEnv } from '../src/config.js';
import { spokenText } from '../src/readAloud/text.js';
import { synthesize, wavPcm } from '../src/readAloud/engine.js';
import { SpeechPool, type SpeechWorker } from '../src/readAloud/pool.js';
import { ReadAloudApp, readAloudCommand } from '../src/readAloud/app.js';

const guildId = '100000000000000001';
const cfg = () => loadReadAloudEnv({ READ_ALOUD_GUILD_ID: guildId });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function worker(): SpeechWorker {
  return { ready: vi.fn(() => true), connect: vi.fn(async () => {}), speak: vi.fn(async () => {}), stop: vi.fn(), disconnect: vi.fn() };
}
function wav(rate = 48000, channels = 2, bits = 16) {
  const b = Buffer.alloc(52); b.write('RIFF', 0); b.writeUInt32LE(44, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(channels, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(192000, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(bits, 34); b.write('data', 36); b.writeUInt32LE(8, 40); return b;
}

describe('読み上げ設定と文章', () => {
  it('初期状態は停止。専用BOTと辞書を読み、設定エラーに秘密の入力を含めない', () => {
    expect(cfg()).toMatchObject({ READ_ALOUD_ENABLED: 'off', tokens: [], READ_ALOUD_MAX_CHARS: 120 });
    expect(loadReadAloudEnv({ READ_ALOUD_ENABLED: 'on', READ_ALOUD_GUILD_ID: guildId, READ_ALOUD_BOT_TOKENS: 'dummy-a,dummy-b' }).tokens).toHaveLength(2);
    for (const env of [{ READ_ALOUD_ENABLED: 'on' }, { READ_ALOUD_BOT_TOKENS: 'dummy-a,dummy-a' }, { READ_ALOUD_DICTIONARY: '[]' }, { READ_ALOUD_DICTIONARY: '{"x":123}' }, { READ_ALOUD_ENGINE_URL: 'http://name:dummy-secret@example.test' }]) {
      expect(() => loadReadAloudEnv(env)).toThrow('読み上げの環境設定を確認してください（値は表示しません）。');
    }
  });
  it('URL・コード・ネタバレ・メンションを省略し、辞書と長文の上限を適用する', () => {
    const text = spokenText('咲楽ノ宮 https://example.test/private ```hidden-code``` ||hidden-spoiler|| <@123> @everyone <:sakura:123>', cfg().dictionary, 120);
    expect(text).toContain('さくらのみや'); expect(text).not.toContain('example.test'); expect(text).not.toContain('hidden'); expect(text).not.toContain('123');
    expect(spokenText('あ'.repeat(200), {}, 20)).toBe('あああ');
    expect([...spokenText('あいうえお'.repeat(50), {}, 20)]).toHaveLength(25);
    expect(spokenText('咲楽ノ宮', { '咲楽': 'さくら', '咲楽ノ宮': 'さくらのみや' }, 120)).toBe('さくらのみや');
  });
});

describe('VOICEVOXとPCM', () => {
  it('ローカル合成へ正しい形式を指定し、PCMに変換する', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response('{}', { headers: { 'Content-Type': 'application/json' } })).mockResolvedValueOnce(new Response(wav()));
    const pcm = await synthesize('http://voicevox:50021', 3, 'こんにちは', new AbortController().signal, request);
    expect(pcm).toHaveLength(8);
    expect(new URL(request.mock.calls[0]![0]).searchParams.get('text')).toBe('こんにちは');
    expect(JSON.parse(request.mock.calls[1]![1].body)).toMatchObject({ outputSamplingRate: 48000, outputStereo: true });
  });
  it('不正・途中で切れた音声と、想定外のサンプリング形式を断る', () => {
    for (const b of [Buffer.alloc(0), wav(24000), wav(48000, 1), wav(48000, 2, 8), wav().subarray(0, 46)]) expect(() => wavPcm(b)).toThrow();
  });
  it('合成エラーに本文やURLを含めない。中断のsignalも渡す', async () => {
    const abort = new AbortController(); abort.abort();
    const request = vi.fn(async (_url: unknown, _options?: RequestInit) => { throw new Error('private text and url'); });
    await expect(synthesize('http://voicevox:50021', 3, 'private text', abort.signal, request)).rejects.toThrow(/^音声を作れませんでした。$/);
    expect(request.mock.calls[0]?.[1]).toMatchObject({ signal: abort.signal });
  });
});

describe('複数VCの割り当てとキュー', () => {
  it('同時開始でも同じBOTを重複割り当てしない。空きがなければ断る', async () => {
    const a = worker(), b = worker(), pool = new SpeechPool([a, b], 2);
    expect(await Promise.all([pool.start('a'), pool.start('b'), pool.start('c'), pool.start('a')])).toEqual(['started', 'started', 'busy', 'already']);
    expect(a.connect).toHaveBeenCalledTimes(1); expect(b.connect).toHaveBeenCalledTimes(1);
    pool.stop('a'); expect(await pool.start('c')).toBe('started'); pool.close();
  });
  it('接続失敗・停止中の接続で予約を残さない', async () => {
    const w = worker(), pool = new SpeechPool([w], 2);
    vi.mocked(w.connect).mockRejectedValueOnce(Error()); expect(await pool.start('a')).toBe('failed'); expect(pool.channels()).toEqual([]);
    let done!: () => void;
    vi.mocked(w.connect).mockImplementationOnce(() => new Promise<void>((resolve) => { done = resolve; }));
    const pending = pool.start('a'); pool.stop('a'); done(); expect(await pending).toBe('failed'); expect(pool.active('a')).toBe(false);
    expect(await pool.start('b')).toBe('started'); pool.close();
  });
  it('同じ部屋の順番を守り、別の部屋は同時に読める。連投と待ちすぎを制限する', async () => {
    const a = worker(), b = worker(), pool = new SpeechPool([a, b], 1);
    let finish!: () => void;
    vi.mocked(a.speak).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    await pool.start('a'); await pool.start('b');
    expect(pool.enqueue('a', 'u', 'a1', 0)).toBe('queued');
    expect(pool.enqueue('a', 'u', 'spam', 1)).toBe('limited');
    expect(pool.enqueue('a', 'v', 'a2', 1)).toBe('queued');
    expect(pool.enqueue('a', 'w', 'a3', 2)).toBe('limited');
    pool.enqueue('b', 'u', 'b1', 0); await flush();
    expect(b.speak).toHaveBeenCalledWith('b1', expect.any(AbortSignal)); expect(a.speak).toHaveBeenCalledTimes(1);
    finish(); await flush(); expect(vi.mocked(a.speak).mock.calls.map((c) => c[0])).toEqual(['a1', 'a2']); pool.close();
  });
  it('スキップは次へ進み、停止では合成とキューを消して別室へ持ち越さない', async () => {
    const w = worker(), pool = new SpeechPool([w], 3);
    vi.mocked(w.speak).mockImplementationOnce((_text, signal) => new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve())));
    await pool.start('a'); pool.enqueue('a', 'u', 'skip'); pool.enqueue('a', 'v', 'next'); pool.skip('a'); await flush();
    expect(vi.mocked(w.speak).mock.calls.map((c) => c[0])).toEqual(['skip', 'next']);
    vi.mocked(w.speak).mockImplementationOnce((_text, signal) => new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve())));
    pool.enqueue('a', 'w', 'stop'); pool.enqueue('a', 'x', 'do not carry'); pool.stop('a');
    await pool.start('b'); pool.enqueue('b', 'u', 'new room'); await flush();
    expect(vi.mocked(w.speak).mock.calls.map((c) => c[0])).toEqual(['skip', 'next', 'stop', 'new room']); pool.close();
  });
});

function message(overrides: Record<string, unknown> = {}): Message {
  return { guildId, channelId: 'vc', channel: { type: ChannelType.GuildVoice }, author: { id: 'member', bot: false }, member: { voice: { channelId: 'vc' }, displayName: '参拝者' }, content: '咲楽ノ宮', system: false, ...overrides } as unknown as Message;
}
describe('Discordの読み上げ対象と操作', () => {
  it('同じVCにいる人の同じVCの投稿だけ読む。BOT・別室・テキストCH・添付だけは読まない', async () => {
    const w = worker(), pool = new SpeechPool([w], 20), app = new ReadAloudApp(cfg(), pool); await pool.start('vc');
    for (const data of [{ author: { id: 'bot', bot: true } }, { webhookId: 'webhook' }, { system: true }, { guildId: 'other' }, { channel: { type: ChannelType.GuildText } }, { member: { voice: { channelId: 'other' } } }, { content: '', attachments: [{ url: 'private' }] }]) app.message(message(data));
    expect(w.speak).not.toHaveBeenCalled(); app.message(message()); await flush();
    expect(w.speak).toHaveBeenCalledWith('参拝者さん、さくらのみや', expect.any(AbortSignal)); pool.close();
  });
  it('無人になった部屋だけ退出する', async () => {
    const a = worker(), b = worker(), pool = new SpeechPool([a, b], 20), app = new ReadAloudApp(cfg(), pool); await pool.start('vc'); await pool.start('other');
    const guild = { id: guildId, channels: { cache: new Map([['vc', { isVoiceBased: () => true, members: { some: () => false } }], ['other', { isVoiceBased: () => true, members: { some: () => true } }]]) } };
    app.voice({ guild } as unknown as VoiceState, { guild } as unknown as VoiceState); expect(pool.channels()).toEqual(['other']); expect(a.disconnect).toHaveBeenCalledTimes(1); pool.close();
  });
  it('別のVCの読み上げは操作できない。コマンドは開始・停止・スキップ・状態', async () => {
    expect(readAloudCommand.toJSON().options?.map((o) => o.name)).toEqual(['開始', '停止', 'スキップ', '状態']);
    const w = worker(), pool = new SpeechPool([w], 20), app = new ReadAloudApp(cfg(), pool); await pool.start('private');
    const reply = vi.fn(async () => {});
    const i = { commandName: '読み上げ', guildId, inCachedGuild: () => true, guild: { afkChannelId: null }, member: { voice: { channel: { id: 'other', type: ChannelType.GuildVoice } } }, options: { getSubcommand: () => '停止' }, reply };
    await app.interaction(i as unknown as ChatInputCommandInteraction); expect(pool.active('private')).toBe(true);
    i.member.voice.channel = null as never; await app.interaction(i as unknown as ChatInputCommandInteraction); expect(reply.mock.calls).toHaveLength(2); pool.close();
  });
});

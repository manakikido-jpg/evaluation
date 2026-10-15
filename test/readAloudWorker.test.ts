import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChannelType, type Client } from 'discord.js';
import { loadReadAloudEnv } from '../src/config.js';
const mock = vi.hoisted(() => ({ join: vi.fn(), createPlayer: vi.fn(), enter: vi.fn(), synth: vi.fn(), resource: vi.fn() }));
vi.mock('@discordjs/voice', () => ({
  AudioPlayerStatus: { Idle: 'idle' }, NoSubscriberBehavior: { Stop: 'stop' }, StreamType: { Raw: 'raw' }, VoiceConnectionStatus: { Ready: 'ready', Destroyed: 'destroyed', Disconnected: 'disconnected' },
  joinVoiceChannel: mock.join, createAudioPlayer: mock.createPlayer, entersState: mock.enter, createAudioResource: mock.resource,
}));
vi.mock('../src/readAloud/engine.js', () => ({ synthesize: mock.synth }));
import { DiscordSpeechWorker } from '../src/readAloud/discordWorker.js';
const cfg = loadReadAloudEnv({ READ_ALOUD_GUILD_ID: '100000000000000001' });
class Player extends EventEmitter { play = vi.fn(); stop = vi.fn(() => { this.emit('idle'); }); }
class Connection extends EventEmitter { state = { status: 'ready' }; subscribe = vi.fn(); destroy = vi.fn(() => { this.state.status = 'destroyed'; }); }
let player: Player, connection: Connection;
const send = vi.fn(async () => {}), allowed = vi.fn(() => true), lost = vi.fn();
function worker() {
  const channel = { type: ChannelType.GuildVoice, permissionsFor: () => ({ has: allowed }), send };
  const guild = { id: cfg.READ_ALOUD_GUILD_ID, channels: { fetch: vi.fn(async () => channel) }, members: { me: {} }, voiceAdapterCreator: 'adapter' };
  return new DiscordSpeechWorker({ isReady: () => true, user: { id: 'worker-id' }, guilds: { cache: new Map([[guild.id, guild]]) } } as unknown as Client, cfg, lost);
}
beforeEach(() => {
  vi.clearAllMocks(); player = new Player(); connection = new Connection();
  mock.join.mockReturnValue(connection); mock.createPlayer.mockReturnValue(player); mock.enter.mockResolvedValue(connection); mock.synth.mockResolvedValue(Buffer.alloc(8)); mock.resource.mockReturnValue('resource'); allowed.mockReturnValue(true); send.mockResolvedValue();
});
afterEach(() => { vi.useRealTimers(); });
it('BOTごとに別の接続グループを使い、録音せず開始の案内とクレジットを送る', async () => {
  const w = worker(); await w.connect('vc', new AbortController().signal);
  expect(mock.join).toHaveBeenCalledWith(expect.objectContaining({ channelId: 'vc', group: 'worker-id', selfDeaf: true, selfMute: false }));
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('VOICEVOX:ずんだもん'), allowedMentions: { parse: [] } }));
  connection.emit('stateChange', {}, { status: 'disconnected' }); expect(lost).toHaveBeenCalledWith('vc'); w.disconnect(); expect(connection.destroy).toHaveBeenCalledTimes(1);
});
it('権限不足と開始案内の投稿失敗では接続を残さない', async () => {
  allowed.mockReturnValue(false); const w = worker(); await expect(w.connect('vc', new AbortController().signal)).rejects.toThrow(); expect(mock.join).not.toHaveBeenCalled();
  allowed.mockReturnValue(true); send.mockRejectedValueOnce(Error()); await expect(w.connect('vc', new AbortController().signal)).rejects.toThrow(); expect(connection.destroy).toHaveBeenCalledTimes(1);
});
it('合成中に停止した古い音声を、新しく接続した部屋で再生しない', async () => {
  let ready!: (b: Buffer) => void; mock.synth.mockImplementationOnce(() => new Promise<Buffer>((resolve) => { ready = resolve; }));
  const w = worker(); await w.connect('a', new AbortController().signal);
  const abort = new AbortController(); const old = w.speak('old', abort.signal); abort.abort(); w.disconnect();
  const nextPlayer = new Player(), nextConnection = new Connection(); mock.createPlayer.mockReturnValue(nextPlayer); mock.join.mockReturnValue(nextConnection); mock.enter.mockResolvedValue(nextConnection);
  await w.connect('b', new AbortController().signal); ready(Buffer.alloc(8)); await old;
  expect(player.play).not.toHaveBeenCalled(); expect(nextPlayer.play).not.toHaveBeenCalled(); w.disconnect();
});
it('再生の終了・中断でイベントを片付ける', async () => {
  const w = worker(); await w.connect('vc', new AbortController().signal);
  const controller = new AbortController(); const pending = w.speak('hello', controller.signal);
  await Promise.resolve(); await Promise.resolve(); expect(player.play).toHaveBeenCalledWith('resource'); controller.abort(); await pending;
  expect(player.listenerCount('idle')).toBe(0); expect(player.listenerCount('error')).toBe(1); w.disconnect();
});

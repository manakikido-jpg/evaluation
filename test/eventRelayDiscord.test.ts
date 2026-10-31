import { EventEmitter } from 'node:events';
import { PassThrough, type Readable } from 'node:stream';
import OpusScript from 'opusscript';
import { ChannelType, Collection, Events, type Client } from 'discord.js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ join: vi.fn(), player: vi.fn(), enter: vi.fn(), resource: vi.fn() }));
vi.mock('@discordjs/voice', () => ({
  joinVoiceChannel: mock.join, createAudioPlayer: mock.player, entersState: mock.enter, createAudioResource: mock.resource,
  NoSubscriberBehavior: { Stop: 'stop' }, StreamType: { Opus: 'opus' }, EndBehaviorType: { Manual: 'manual' },
  VoiceConnectionStatus: { Ready: 'ready', Destroyed: 'destroyed', Disconnected: 'disconnected' },
}));
import { DiscordEventRelay } from '../src/readAloud/discordRelay.js';
import { RELAY_FRAME_BYTES } from '../src/readAloud/relayAudio.js';
class Connection extends EventEmitter {
  state = { status: 'ready' };
  inputs = new Map<string, PassThrough>();
  receiver = { subscribe: vi.fn((id: string) => { const s = new PassThrough({ objectMode: true }); this.inputs.set(id, s); return s; }) };
  subscribe = vi.fn();
  destroy = vi.fn(() => { this.state.status = 'destroyed'; });
}
function member(id: string, options = {}) {
  return { id, user: { bot: false }, voice: { channelId: 'stage', suppress: false, selfMute: false, serverMute: false }, ...options };
}
function setup(count = 1) {
  const ids = ['stage', ...Array.from({ length: count }, (_, n) => `vc${n + 1}`)];
  const people = new Collection([['speaker', member('speaker')], ['second', member('second')],
    ['audience', member('audience', { voice: { channelId: 'stage', suppress: true } })], ['bot', member('bot', { user: { bot: true } })]]);
  const channels = ids.map((id, index) => ({ id, type: index ? ChannelType.GuildVoice : ChannelType.GuildStageVoice,
    stageInstance: {} as object | null, members: people, allowed: true, permissionsFor() { return { has: () => this.allowed }; },
    message: { edit: vi.fn(async () => {}) }, send: vi.fn(async function (this: { message: object }) { return this.message; }) }));
  const clients = ids.map((_, n) => {
    const me = { voice: { channelId: null as string | null, serverDeaf: false, serverMute: false } };
    const guild = { id: 'guild', afkChannelId: 'afk', voiceAdapterCreator: `adapter${n}`, members: { me, fetchMe: vi.fn(async () => me) },
      channels: { cache: new Map(channels.map(c => [c.id, c])), fetch: vi.fn(async (id: string) => channels.find(c => c.id === id)) } };
    return Object.assign(new EventEmitter(), { user: { id: `bot${n}` }, guild, guilds: { cache: new Map([['guild', guild]]) } });
  });
  const connections: Connection[] = [];
  mock.join.mockImplementation((options: { group: string; channelId: string }) => {
    clients.find(c => c.user.id === options.group)!.guild.members.me.voice.channelId = options.channelId;
    const c = new Connection(); connections.push(c); return c;
  });
  mock.enter.mockImplementation(async c => c);
  const player = Object.assign(new EventEmitter(), { play: vi.fn(), stop: vi.fn() }); mock.player.mockReturnValue(player);
  let output: Readable; mock.resource.mockImplementation(stream => { output = stream; return { stream }; });
  const abort = new AbortController(), fault = vi.fn(() => abort.abort());
  const relay = new DiscordEventRelay(clients as unknown as Client[], 'guild', { source: 'stage', targets: ids.slice(1), actor: 'operator' }, fault);
  return { relay, fault, abort, clients, channels, people, connections, player, output: () => output! };
}
const opened: ReturnType<typeof setup>[] = [];
function fixture(n = 1) { const s = setup(n); opened.push(s); return s; }
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance'] }); });
afterEach(async () => { for (const s of opened.splice(0)) await s.relay.close('test end'); vi.useRealTimers(); });

it('受信1＋配信6は別のBOT接続で、配信先は同じプレイヤーを購読する', async () => {
  const s = fixture(6); await s.relay.start(s.abort.signal);
  expect(mock.join).toHaveBeenCalledTimes(7);
  expect(mock.join.mock.calls[0]![0]).toMatchObject({ group: 'bot0', channelId: 'stage', selfDeaf: false, selfMute: true });
  for (let n = 1; n <= 6; n++) {
    expect(mock.join.mock.calls[n]![0]).toMatchObject({ group: `bot${n}`, channelId: `vc${n}`, selfDeaf: true, selfMute: false });
    expect(s.connections[n]!.subscribe).toHaveBeenCalledWith(s.player);
    expect(s.connections[n]!.receiver.subscribe).not.toHaveBeenCalled();
  }
  expect(s.connections[0]!.receiver.subscribe.mock.calls.map(c => c[0])).toEqual(['speaker', 'second']);
  for (const channel of s.channels) expect(channel.send).toHaveBeenCalledWith(expect.objectContaining({ allowedMentions: { parse: [] } }));
  expect(s.channels[0]!.send.mock.invocationCallOrder[0]).toBeLessThan(s.connections[0]!.receiver.subscribe.mock.invocationCallOrder[0]!);
  await s.relay.close('運営が停止'); await s.relay.close('再停止');
  for (const c of s.connections) expect(c.destroy).toHaveBeenCalledTimes(1);
  expect(s.clients[0]!.listenerCount(Events.VoiceStateUpdate)).toBe(0);
  expect(s.clients[0]!.listenerCount(Events.StageInstanceDelete)).toBe(0);
  for (const c of s.channels) expect(c.message.edit).toHaveBeenCalledTimes(1);
});
it('実際のOpus音声を混ぜて配信し、客席に戻った人の音声は捨てる', async () => {
  const s = fixture(); await s.relay.start(s.abort.signal);
  const codec = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
  try {
    const pcm = Buffer.alloc(RELAY_FRAME_BYTES);
    for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(Math.round(Math.sin(i / 10) * 9000), i);
    const stream = s.connections[0]!.inputs.get('speaker')!;
    stream.emit('data', codec.encode(pcm, 960));
    expect(s.relay.metrics().packets).toBe(1);
    vi.advanceTimersByTime(20);
    const packet = s.output().read() as Buffer;
    expect(codec.decode(packet).some(byte => byte !== 0)).toBe(true);
    s.people.get('speaker')!.voice.suppress = true;
    s.clients[0]!.emit(Events.VoiceStateUpdate);
    expect(stream.destroyed).toBe(true);
    stream.emit('data', codec.encode(pcm, 960)); expect(s.relay.metrics().packets).toBe(1);
    s.people.get('audience')!.voice.suppress = false;
    s.clients[0]!.emit(Events.VoiceStateUpdate);
    expect(s.connections[0]!.inputs.has('audience')).toBe(true);
  } finally { codec.delete(); }
});
it.each(['permission', 'inactive', 'occupied', 'afk'])('準備失敗：%sは接続も通知もしない', async kind => {
  const s = fixture();
  if (kind === 'permission') s.channels[1]!.allowed = false;
  if (kind === 'inactive') s.channels[0]!.stageInstance = null;
  if (kind === 'occupied') s.clients[1]!.guild.members.me.voice.channelId = 'other';
  if (kind === 'afk') s.clients[1]!.guild.afkChannelId = 'vc1';
  await expect(s.relay.start(s.abort.signal)).rejects.toThrow();
  expect(mock.join).not.toHaveBeenCalled(); expect(s.channels[0]!.send).not.toHaveBeenCalled();
});
it('開始案内の送信失敗では受信を始めず、既に作った接続を閉じる', async () => {
  const s = fixture(); s.channels[1]!.send.mockRejectedValueOnce(Error('send failed'));
  await expect(s.relay.start(s.abort.signal)).rejects.toThrow(); await s.relay.close('失敗');
  expect(s.connections[0]!.receiver.subscribe).not.toHaveBeenCalled();
  for (const c of s.connections) expect(c.destroy).toHaveBeenCalledOnce();
  expect(s.channels[0]!.message.edit).toHaveBeenCalledOnce();
});
it('接続待ちで停止したら、そのあと接続が完了しても配信しない', async () => {
  const s = fixture(); let finish!: () => void;
  mock.enter.mockImplementationOnce(() => new Promise<void>(r => { finish = r; }));
  const pending = s.relay.start(s.abort.signal); const rejected = expect(pending).rejects.toThrow();
  for (let n = 0; n < 20 && !finish; n++) await Promise.resolve();
  expect(finish).toBeTypeOf('function'); s.abort.abort(); finish(); await rejected;
  expect(mock.join).toHaveBeenCalledTimes(1); expect(s.connections[0]!.destroy).toHaveBeenCalledOnce(); expect(s.player.play).not.toHaveBeenCalled();
});
it.each(['stageEnd', 'disconnect', 'permission', 'move', 'deaf', 'backpressure'])('運用中の%sで全室への配信を止める', async kind => {
  const s = fixture(); await s.relay.start(s.abort.signal);
  if (kind === 'stageEnd') s.clients[0]!.emit(Events.StageInstanceDelete, { channelId: 'stage' });
  if (kind === 'disconnect') s.connections[1]!.emit('stateChange', {}, { status: 'disconnected' });
  if (kind === 'permission') s.channels[1]!.allowed = false;
  if (kind === 'move') s.clients[1]!.guild.members.me.voice.channelId = 'other';
  if (kind === 'deaf') s.clients[0]!.guild.members.me.voice.serverDeaf = true;
  if (['permission', 'move', 'deaf'].includes(kind)) {
    for (let n = 0; n < 50; n++) { vi.advanceTimersByTime(20); s.output().read(); }
  }
  if (kind === 'backpressure') vi.advanceTimersByTime(220);
  expect(s.fault).toHaveBeenCalledOnce(); expect(s.abort.signal.aborted).toBe(true);
  for (const c of s.connections) expect(c.destroy).toHaveBeenCalledOnce();
  expect(s.output().destroyed).toBe(true);
});
it('音声の購読に失敗しても確保したコーデックを解放する', async () => {
  const s = fixture();
  mock.enter.mockImplementationOnce(async (c: Connection) => { c.receiver.subscribe.mockImplementationOnce(() => { throw Error('receive failed'); }); return c; });
  const deleted = vi.spyOn(OpusScript.prototype, 'delete');
  try {
    await expect(s.relay.start(s.abort.signal)).rejects.toThrow();
    expect(s.fault).toHaveBeenCalledOnce(); expect(deleted).toHaveBeenCalledTimes(2);
    for (const c of s.connections) expect(c.destroy).toHaveBeenCalledOnce();
  } finally { deleted.mockRestore(); }
});

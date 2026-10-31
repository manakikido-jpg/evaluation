import { Readable } from 'node:stream';
import OpusScript from 'opusscript';
import { ChannelType, Events, PermissionFlagsBits, type Client, type GuildMember, type Message, type StageChannel, type VoiceChannel } from 'discord.js';
import { createAudioPlayer, createAudioResource, entersState, EndBehaviorType, NoSubscriberBehavior, StreamType, VoiceConnectionStatus, type VoiceConnection, joinVoiceChannel } from '@discordjs/voice';
import { RelayMixer } from './relayAudio.js';
import { RelayError, type RelayMetrics, type RelayPlan, type RelayTransport } from './relay.js';

type Decoder = { codec: OpusScript; stream: ReturnType<VoiceConnection['receiver']['subscribe']> };
const receivePerms = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.SendMessages];
const sendPerms = [...receivePerms, PermissionFlagsBits.Speak];
const permissionNames = new Map([[PermissionFlagsBits.ViewChannel, 'チャンネルを見る'], [PermissionFlagsBits.Connect, '接続'],
  [PermissionFlagsBits.SendMessages, 'メッセージを送信'], [PermissionFlagsBits.Speak, '発言']]);
/** 音声は短いメモリバッファだけ。自分/BOT/客席/配信先の音は取り込まない。 */
export class DiscordEventRelay implements RelayTransport {
  readonly botIds: string[];
  private source?: StageChannel;
  private outputs: VoiceChannel[] = [];
  private connections: VoiceConnection[] = [];
  private decoders = new Map<string, Decoder>();
  private mixer = new RelayMixer();
  private encoder?: OpusScript;
  private stream?: Readable;
  private player?: ReturnType<typeof createAudioPlayer>;
  private notices: Message[] = [];
  private cleanups: (() => void)[] = [];
  private interval?: ReturnType<typeof setInterval>;
  private timeout?: ReturnType<typeof setTimeout>;
  private signal?: AbortSignal;
  private running = false;
  private closed = false;
  private received = 0;
  private receivedAt: number | null = null;
  constructor(private clients: Client[], private guildId: string, private plan: RelayPlan, private fault: (reason: string) => void) {
    this.botIds = clients.map(c => c.user!.id);
  }
  metrics(): RelayMetrics { return { packets: this.received, lastPacketAt: this.receivedAt }; }
  private check(): void { if (this.closed || this.signal?.aborted) throw new RelayError('中継の準備を中止しました。'); }
  async start(signal: AbortSignal): Promise<void> {
    this.signal = signal; this.check();
    const abort = () => { void this.close(signal.reason instanceof RelayError ? signal.reason.message : '中継を停止しました。'); };
    signal.addEventListener('abort', abort, { once: true }); this.cleanups.push(() => signal.removeEventListener('abort', abort));
    const deadline = setTimeout(() => this.fault('接続準備が90秒以内に終わらなかったため停止しました。'), 90_000);
    try {
      const ids = [this.plan.source, ...this.plan.targets];
      // 権限を全員分確認してから接続する。受信BOTはSpeak権限を必要としない。
      for (const [index, client] of this.clients.entries()) {
        const guild = client.guilds.cache.get(this.guildId);
        const channel = await guild?.channels.fetch(ids[index]!); this.check();
        const me = await guild?.members.fetchMe(); this.check();
        if (!guild || !channel || !me || (index === 0 ? channel.type !== ChannelType.GuildStageVoice : channel.type !== ChannelType.GuildVoice)
          || channel.id === guild.afkChannelId) throw new RelayError('ステージと通常VCを選んでください。AFKは対象外です。');
        const permissions = channel.permissionsFor(me);
        const missing = (index === 0 ? receivePerms : sendPerms).filter(permission => !permissions?.has(permission));
        const label = index === 0 ? '受信専用の拾' : '配信用BOT';
        if (missing.length) throw new RelayError(`${label} <@${client.user!.id}> の <#${channel.id}> で「${missing.map(p => permissionNames.get(p)).join('・')}」が不足しています。チャンネルの権限を確認してください。`);
        if (me.voice.channelId) throw new RelayError(`${label} <@${client.user!.id}> が別の通話にいます。先に退出させてください。`);
        if (index === 0) {
          this.source = channel as StageChannel;
          if (!this.source.stageInstance) throw new RelayError('先にステージのイベントを開始してください。');
        } else this.outputs.push(channel as VoiceChannel);
      }
      for (const [index, client] of this.clients.entries()) {
        this.check();
        const guild = client.guilds.cache.get(this.guildId)!;
        const connection = joinVoiceChannel({ guildId: guild.id, channelId: ids[index]!, adapterCreator: guild.voiceAdapterCreator,
          group: client.user!.id, selfDeaf: index !== 0, selfMute: index === 0 });
        this.connections.push(connection);
        connection.on('error', () => { if (!this.closed) this.fault('音声接続でエラーが起きたため停止しました。'); });
        connection.on('stateChange', (_before, after) => {
          if (!this.closed && after.status === VoiceConnectionStatus.Disconnected) this.fault('音声接続が切れたため停止しました。');
        });
        await entersState(connection, VoiceConnectionStatus.Ready, AbortSignal.any([signal, AbortSignal.timeout(15_000)])); this.check();
      }
      const channels = [this.source!, ...this.outputs];
      for (const channel of channels) {
        const message = await channel.send({ content: channel.id === this.plan.source
          ? `📡 イベントの音声中継を開始します。登壇者の声を ${this.plan.targets.map(id => `<#${id}>`).join('・')} へ流します。録音・保存はしません。停止は運営の「/イベント中継 停止」です。`
          : `📡 <#${this.plan.source}> の登壇者の声を中継します。この部屋の会話は送信せず、録音・保存もしません。音量はこのBOTのユーザー音量で調整できます。`, allowedMentions: { parse: [] } });
        this.notices.push(message); this.check();
      }
      this.encoder = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
      // 1回だけ符号化し、同じプレイヤーを配信先すべてが購読する。
      this.stream = new Readable({ objectMode: true, highWaterMark: 10, read() {} });
      this.stream.on('error', () => { if (!this.closed) this.fault('音声の処理に失敗したため停止しました。'); });
      this.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Stop } });
      this.player.on('error', () => { if (!this.closed) this.fault('音声の配信に失敗したため停止しました。'); });
      for (const connection of this.connections.slice(1)) connection.subscribe(this.player);
      this.player.play(createAudioResource(this.stream, { inputType: StreamType.Opus }));
      const client = this.clients[0]!;
      const update = () => { if (this.running) this.syncSpeakers(); };
      const deleted = (stage: { channelId: string }) => { if (stage.channelId === this.plan.source) this.fault('ステージが終了したため停止しました。'); };
      client.on(Events.VoiceStateUpdate, update); client.on(Events.StageInstanceDelete, deleted);
      this.cleanups.push(() => client.off(Events.VoiceStateUpdate, update), () => client.off(Events.StageInstanceDelete, deleted));
      this.running = true; this.syncSpeakers(); this.check();
      let lastTick = performance.now(), checks = 0;
      this.interval = setInterval(() => {
        if (this.closed || signal.aborted) return;
        const now = performance.now();
        if (now - lastTick > 500 || this.stream!.readableLength >= 10) { this.fault('音声の配信が追いつかないため停止しました。'); return; }
        lastTick = now;
        try {
          if (++checks % 50 === 0) this.checkChannels();
          if (!this.closed && !signal.aborted) this.stream!.push(this.encoder!.encode(this.mixer.take(), 960));
        } catch { this.fault('音声を処理できなかったため停止しました。'); }
      }, 20);
      this.timeout = setTimeout(() => this.fault('中継が6時間に達したため停止しました。'), 6 * 3600_000);
    } finally { clearTimeout(deadline); }
  }
  private eligible(member: GuildMember): boolean {
    return !member.user.bot && member.voice.channelId === this.plan.source && member.voice.suppress === false
      && !member.voice.serverMute && !member.voice.selfMute;
  }
  private removeDecoder(id: string): void {
    const decoder = this.decoders.get(id); if (!decoder) return;
    this.decoders.delete(id); this.mixer.remove(id);
    try { decoder.stream.removeAllListeners('data'); decoder.stream.destroy(); }
    finally { decoder.codec.delete(); }
  }
  private syncSpeakers(): void {
    if (this.closed || this.signal?.aborted || !this.source) return;
    try {
      const members = this.source.members.filter(m => this.eligible(m));
      for (const id of this.decoders.keys()) if (!members.has(id)) this.removeDecoder(id);
      for (const [id] of members) {
        if (this.decoders.has(id)) continue;
        this.mixer.add(id);
        const codec = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
        let stream: Decoder['stream'];
        try { stream = this.connections[0]!.receiver.subscribe(id, { end: { behavior: EndBehaviorType.Manual } }); }
        catch (error) { codec.delete(); this.mixer.remove(id); throw error; }
        this.decoders.set(id, { codec, stream });
        stream.on('error', () => { if (!this.closed && this.decoders.get(id)?.stream === stream) this.fault('登壇者の音声を受信できなくなったため停止しました。'); });
        stream.on('end', () => { if (!this.closed && this.decoders.get(id)?.stream === stream) this.fault('登壇者の音声接続が終了したため停止しました。'); });
        stream.on('data', (packet: Buffer) => {
          const member = this.source?.members.get(id);
          if (this.closed || this.signal?.aborted || !member || !this.eligible(member)) { this.removeDecoder(id); return; }
          if (!packet.length || packet.length > 8192) return;
          try { this.mixer.push(id, codec.decode(packet)); this.received++; this.receivedAt = Date.now(); }
          catch { this.fault('受信音声を変換できないため停止しました。'); }
        });
      }
    } catch { this.fault('登壇者の変更に対応できませんでした。登壇者は20人までです。'); }
  }
  private checkChannels(): void {
    if (!this.source?.stageInstance) { this.fault('ステージが終了したため停止しました。'); return; }
    const channels = [this.source, ...this.outputs];
    for (const [index, channel] of channels.entries()) {
      const guild = this.clients[index]!.guilds.cache.get(this.guildId), me = guild?.members.me;
      const current = guild?.channels.cache.get(channel.id);
      if (!me || !current || !('permissionsFor' in current) || me.voice.channelId !== channel.id
        || (index === 0 ? me.voice.serverDeaf : me.voice.serverMute)
        || !current.permissionsFor(me)?.has(index === 0 ? receivePerms : sendPerms)) {
        this.fault('中継BOTの場所か権限が変わったため停止しました。'); return;
      }
    }
    this.syncSpeakers();
  }
  async close(reason: string): Promise<void> {
    this.closed = true; this.running = false;
    clearInterval(this.interval); clearTimeout(this.timeout);
    // 1つの片付けが失敗しても、ほかの音声や接続を残さない。
    const safely = (action: () => void) => { try { action(); } catch { /* 残りも片付ける */ } };
    for (const cleanup of this.cleanups.splice(0)) safely(cleanup);
    for (const id of this.decoders.keys()) safely(() => this.removeDecoder(id));
    this.mixer.clear(); safely(() => { this.player?.stop(true); }); safely(() => { this.stream?.destroy(); });
    safely(() => { this.encoder?.delete(); }); this.encoder = undefined;
    for (const connection of this.connections.splice(0)) safely(() => { if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy(); });
    await Promise.allSettled(this.notices.splice(0).map(message => message.edit({ content: `■ 音声中継は停止しました。${reason}`, allowedMentions: { parse: [] } })));
  }
}

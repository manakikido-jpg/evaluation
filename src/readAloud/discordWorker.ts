import { Readable } from 'node:stream';
import { ChannelType, PermissionFlagsBits, type Client } from 'discord.js';
import { AudioPlayerStatus, NoSubscriberBehavior, StreamType, VoiceConnectionStatus, createAudioPlayer, createAudioResource, entersState, joinVoiceChannel, type AudioPlayer, type VoiceConnection } from '@discordjs/voice';
import type { ReadAloudConfig } from '../config.js';
import { synthesize } from './engine.js';
import type { SpeechWorker } from './pool.js';
import { logger } from '../lib/logger.js';

const NEED = { ViewChannel: PermissionFlagsBits.ViewChannel, Connect: PermissionFlagsBits.Connect, Speak: PermissionFlagsBits.Speak, SendMessages: PermissionFlagsBits.SendMessages } as const;
/** どこで接続に失敗したかをログに出す（本文・トークンは出さない） */
const fail = (bot: string | undefined, stage: string, extra: Record<string, unknown> = {}) => logger.warn({ bot, stage, ...extra }, 'read aloud connect failed');

export class DiscordSpeechWorker implements SpeechWorker {
  private connection?: VoiceConnection;
  private player?: AudioPlayer;
  constructor(readonly client: Client, private cfg: ReadAloudConfig, private lost: (channelId: string) => void) {}
  ready(): boolean { return this.client.isReady(); }
  async connect(channelId: string, signal: AbortSignal): Promise<void> {
    const guild = this.client.guilds.cache.get(this.cfg.READ_ALOUD_GUILD_ID);
    const channel = await guild?.channels.fetch(channelId);
    const me = guild?.members.me;
    const bot = this.client.user?.username;
    if (!guild || channel?.type !== ChannelType.GuildVoice || !me) { fail(bot, 'channel'); throw Error('接続できません。'); }
    const perms = channel.permissionsFor(me);
    const missing = Object.entries(NEED).filter(([, f]) => !perms.has(f)).map(([k]) => k);
    if (missing.length) { fail(bot, 'permission', { missing }); throw Error('接続できません。'); }
    if (signal.aborted) throw Error('接続できません。');
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Stop } });
    player.on('error', () => {}); // 待機していないときのエラーでも本文を出力しない。
    const connection = joinVoiceChannel({ guildId: guild.id, channelId, adapterCreator: guild.voiceAdapterCreator, group: this.client.user!.id, selfDeaf: true, selfMute: false });
    this.player = player; this.connection = connection;
    let lastStatus: string = connection.state.status;
    connection.on('error', (err) => { fail(bot, 'voice_error', { code: (err as { code?: unknown }).code ?? err.name }); if (this.connection === connection) this.lost(channelId); });
    connection.on('stateChange', (_before, after) => {
      lastStatus = after.status;
      if (after.status === VoiceConnectionStatus.Disconnected && this.connection === connection) this.lost(channelId);
    });
    connection.subscribe(player);
    try {
      try { await entersState(connection, VoiceConnectionStatus.Ready, AbortSignal.any([signal, AbortSignal.timeout(15_000)])); }
      catch (err) { if (!signal.aborted) fail(bot, 'voice_timeout', { lastStatus }); throw err; }
      if (signal.aborted || this.connection !== connection) throw Error();
      await channel.send({ content: `🔊 読み上げを開始しました。このVCに参加している人の、このVCのチャットを読みます。\n停止・スキップは「/読み上げ」から。録音はしません。音声：${this.cfg.READ_ALOUD_VOICE_CREDIT}`, allowedMentions: { parse: [] } });
      if (signal.aborted) throw Error();
    } catch {
      if (this.connection === connection) this.disconnect();
      throw new Error('接続できません。');
    }
  }
  async speak(text: string, signal: AbortSignal): Promise<void> {
    const player = this.player, connection = this.connection;
    if (!player || connection?.state.status !== VoiceConnectionStatus.Ready || signal.aborted) return;
    const pcm = await synthesize(this.cfg.READ_ALOUD_ENGINE_URL, this.cfg.READ_ALOUD_SPEAKER, text, AbortSignal.any([signal, AbortSignal.timeout(15_000)]));
    if (signal.aborted || this.player !== player || this.connection !== connection) return;
    const resource = createAudioResource(Readable.from([pcm]), { inputType: StreamType.Raw });
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { player.off(AudioPlayerStatus.Idle, done); player.off('error', error); signal.removeEventListener('abort', abort); };
      const done = () => { cleanup(); resolve(); };
      const error = () => { cleanup(); reject(new Error('音声を再生できませんでした。')); };
      const abort = () => { cleanup(); player.stop(true); resolve(); };
      player.once(AudioPlayerStatus.Idle, done); player.once('error', error); signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) { abort(); return; }
      try { player.play(resource); } catch { error(); }
    });
  }
  stop(): void { this.player?.stop(true); }
  disconnect(): void {
    const connection = this.connection, player = this.player;
    this.connection = undefined; this.player = undefined;
    player?.stop(true);
    if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
  }
}

import { randomUUID } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags, type Interaction, type Message, type VoiceState, type VoiceChannel } from 'discord.js';
import { EndBehaviorType, entersState, joinVoiceChannel, VoiceConnectionStatus, type VoiceConnection } from '@discordjs/voice';
import OpusScript from 'opusscript';
import type { Db } from '../db/client.js';
import { adminLevelOf, type GuildConfig } from '../config.js';
import { RecordingStore } from '../services/recording/store.js';
import { RecordingConsent, VoiceMixer, wavHeader } from '../services/recording/voice.js';
import { logger } from '../lib/logger.js';
import { audit } from '../services/audit.js';
const ephemeral = { flags: MessageFlags.Ephemeral } as const;
const humanIds = (c: VoiceChannel) => [...c.members.values()].filter(m => !m.user.bot).map(m => m.id);
type Session = {
  nonce: string; ownerId: string; channel: VoiceChannel; consent: RecordingConsent; message?: Message;
  phase: 'consent' | 'starting' | 'recording' | 'stopping'; id?: string; connection?: VoiceConnection;
  timeout?: NodeJS.Timeout; interval?: NodeJS.Timeout; starting?: Promise<void>; flushing?: Promise<void>;
  mixer?: VoiceMixer; since?: number; seq: number; decoders: OpusScript[]; cleanup: (() => void)[];
};
/** メインBOTで1部屋。読み上げ専用BOTの接続には触れない。 */
export class RecordingApp {
  private session?: Session;
  private stopping?: Promise<void>;
  constructor(private readonly db: Db, private readonly cfg: () => GuildConfig, private readonly store = new RecordingStore(db)) {}
  async onInteraction(i: Interaction) {
    if (!(i.isChatInputCommand() && i.commandName === 'recording') && !(i.isButton() && i.customId.startsWith('rec:'))) return;
    if (!i.inCachedGuild() || i.guildId !== this.cfg().guildId) return;
    try {
      if (i.isChatInputCommand()) {
        if (!adminLevelOf(this.cfg(), [...i.member.roles.cache.keys()])) return void await i.reply({ content: '神職・宮司だけが準備できます。', ...ephemeral });
        const cfg = this.cfg().recording;
        const channel = i.member.voice.channel;
        if (!cfg.enabled || !channel || channel.type !== ChannelType.GuildVoice || !cfg.voiceChannelIds.includes(channel.id) || channel.id === i.guild.afkChannelId) return void await i.reply({ content: '録音が有効で、許可された通話に入っているときだけ使えます。', ...ephemeral });
        if (this.session) return void await i.reply({ content: 'いま準備中・録音中の部屋があります。先に止めてください。', ...ephemeral });
        const ids = humanIds(channel);
        if (!ids.includes(i.user.id) || ids.length > 20) return void await i.reply({ content: '参加者は20人までです。', ...ephemeral });
        const s: Session = { nonce: randomUUID(), ownerId: i.user.id, channel, consent: new RecordingConsent(ids), phase: 'consent', seq: 0, decoders: [], cleanup: [] };
        this.session = s;
        await i.deferReply(ephemeral);
        s.message = await channel.send({ content: this.text(s), components: this.buttons(s), allowedMentions: { parse: [] } });
        s.timeout = setTimeout(() => void this.stop('同意の待ち時間が過ぎました。'), 10 * 60000);
        await i.editReply('通話のチャットに同意ボタンを出しました。全員の同意後、始めた人が「開始」を押してください。');
        return;
      }
      if (!i.isButton()) return;
      const [, nonce, action] = i.customId.split(':');
      const s = this.session;
      if (!s || nonce !== s.nonce || i.message.id !== s.message?.id) return void await i.reply({ content: 'この録音の受付は終わっています。', ...ephemeral });
      if (!s.consent.memberIds.includes(i.user.id)) return void await i.reply({ content: '最初から通話にいた人だけが使えます。', ...ephemeral });
      await i.deferReply(ephemeral);
      if (action === 'stop') {
        await this.stop('参加者が停止しました。');
        await i.editReply('止めました。');
      } else if (action === 'agree' && s.phase === 'consent') {
        if (i.member.voice.channelId !== s.channel.id) return void await i.editReply('元の通話に入ってから押してください。');
        s.consent.agree(i.user.id);
        await s.message?.edit({ content: this.text(s), components: this.buttons(s), allowedMentions: { parse: [] } });
        await i.editReply('この録音への同意を受け付けました。いつでも「同意を取り消す・停止」で止められます。');
      } else if (action === 'start' && i.user.id === s.ownerId && s.phase === 'consent') {
        if (!s.consent.ready || !s.consent.matches(humanIds(s.channel))) return void await i.editReply('参加者全員の同意が必要です。人が入れ替わった場合は準備し直してください。');
        if (!adminLevelOf(this.cfg(), [...i.member.roles.cache.keys()])) return void await i.editReply('神職・宮司だけが開始できます。');
        s.phase = 'starting';
        s.starting = this.start(s);
        await s.starting;
        if (s.consent.stopped) await this.stop('開始できなかったため停止しました。');
        await i.editReply(!s.consent.stopped ? '録音を始めました。' : '録音を停止しました。');
      } else await i.editReply('開始は準備した人が、全員の同意後に押してください。');
    } catch (err) {
      logger.warn({ err }, 'recording interaction failed');
      await this.stop('エラーのため止めました。').catch(() => undefined);
      const message = '録音できませんでした。権限や保存先を確認してください。';
      if (i.deferred || i.replied) await i.editReply(message).catch(() => undefined);
      else await i.reply({ content: message, ...ephemeral }).catch(() => undefined);
    }
  }
  private text(s: Session) {
    const cfg = this.cfg().recording;
    return `🎙 VC録音 ${s.phase === 'consent' ? '同意を確認中' : s.phase === 'recording' ? '● 録音中' : '準備・終了処理中'}\nこの通話の声を保存します。再生できるのは開始した人と宮司。${cfg.retentionDays}日後に消えます。最大${cfg.maxMinutes}分。\n同意 ${s.consent.agreed.size}/${s.consent.memberIds.length}人。全員の同意後、準備した人が開始します。人が入れ替わると停止します。途中でも下の停止ボタンで止められます。`;
  }
  private buttons(s: Session) {
    return [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`rec:${s.nonce}:agree`).setLabel('この録音に同意する').setStyle(ButtonStyle.Primary).setDisabled(s.phase !== 'consent'),
      new ButtonBuilder().setCustomId(`rec:${s.nonce}:start`).setLabel('開始').setStyle(ButtonStyle.Success).setDisabled(s.phase !== 'consent' || !s.consent.ready),
      new ButtonBuilder().setCustomId(`rec:${s.nonce}:stop`).setLabel('同意を取り消す・停止').setStyle(ButtonStyle.Danger),
    )];
  }
  private async start(s: Session) {
    try {
      clearTimeout(s.timeout);
      const cfg = this.cfg().recording;
      if (!cfg.enabled || !cfg.voiceChannelIds.includes(s.channel.id)) throw new Error('recording disabled');
      await this.store.cleanup();
      const row = await this.store.create(cfg, { ownerId: s.ownerId, title: `${s.channel.name}の録音`, kind: 'voice', mime: 'audio/wav', channelId: s.channel.id, participantIds: [...s.consent.memberIds] });
      s.id = row.id;
      await this.store.append(row.id, s.seq++, wavHeader(0));
      if (s.consent.stopped) return;
      // 音を受ける前に、通話のチャットへ開始を知らせる。
      await s.channel.send({ content: '🔴 全員の同意を確認しました。これからVCの音声を録音します。人の出入り・停止ボタンで終了します。', allowedMentions: { parse: [] } });
      if (s.consent.stopped || !s.consent.matches(humanIds(s.channel))) { s.consent.stop(); return; }
      const conn = joinVoiceChannel({ channelId: s.channel.id, guildId: s.channel.guild.id, adapterCreator: s.channel.guild.voiceAdapterCreator, selfDeaf: false, selfMute: true, group: 'sakuranomiya-recording' });
      s.connection = conn;
      conn.on('error', () => { s.consent.stop(); void this.stop('音声の接続でエラーが起きました。'); });
      await entersState(conn, VoiceConnectionStatus.Ready, 20000);
      if (s.consent.stopped || !s.consent.matches(humanIds(s.channel))) { s.consent.stop(); return; }
      s.phase = 'recording'; s.since = performance.now();
      s.mixer = new VoiceMixer(new Set(s.consent.memberIds));
      for (const userId of s.consent.memberIds) {
        const decoder = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
        s.decoders.push(decoder);
        const source = conn.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.Manual } });
        s.cleanup.push(() => source.destroy());
        source.on('data', (packet: Buffer) => {
          if (s.consent.stopped || s.phase !== 'recording') return;
          try { s.mixer!.push(userId, decoder.decode(packet), performance.now() - s.since!); }
          catch { void this.stop('音声の受信でエラーが起きました。'); }
        });
        source.on('error', () => void this.stop('音声の受信が止まりました。'));
      }
      conn.on('stateChange', (_old, state) => { if (state.status === VoiceConnectionStatus.Disconnected || state.status === VoiceConnectionStatus.Destroyed) void this.stop('音声の接続が切れました。'); });
      s.interval = setInterval(() => {
        if (!this.cfg().recording.enabled || !this.cfg().recording.voiceChannelIds.includes(s.channel.id)) return void this.stop('設定が無効になりました。');
        if (s.flushing || s.consent.stopped) return;
        const data = s.mixer!.drain(performance.now() - s.since! - 200);
        if (!data.length) return;
        s.flushing = this.store.append(s.id!, s.seq++, data).catch(() => { s.consent.stop(); setImmediate(() => void this.stop('容量の上限、または保存エラーのため止めました。')); }).finally(() => { s.flushing = undefined; });
      }, 100);
      s.timeout = setTimeout(() => void this.stop('録音時間の上限になりました。'), cfg.maxMinutes * 60000);
      if (!s.consent.stopped) await s.message?.edit({ content: this.text(s), components: this.buttons(s), allowedMentions: { parse: [] } });
      await audit(this.db, { actorId: s.ownerId, action: 'recording.voice_start', detail: { id: s.id, channelId: s.channel.id, participants: s.consent.memberIds }, via: 'discord' });
    } catch (err) { s.consent.stop(); logger.warn({ err }, 'voice recording start failed'); }
  }
  onVoiceStateUpdate(before: VoiceState, after: VoiceState) {
    const s = this.session;
    if (!s || before.channelId === after.channelId || after.member?.user.bot) return;
    if (before.channelId === s.channel.id || after.channelId === s.channel.id) {
      s.consent.stop(); // 音声の受け付けは、その場で止める。
      void this.stop('参加者が入れ替わったため止めました。');
    }
  }
  async tick() { await this.store.cleanup(); }
  stop(reason = 'BOTの終了のため止めました。'): Promise<void> {
    const s = this.session;
    if (this.stopping) return this.stopping;
    if (!s || s.phase === 'stopping') return Promise.resolve();
    this.stopping = this.stopSession(s, reason).finally(() => { this.stopping = undefined; });
    return this.stopping;
  }
  private async stopSession(s: Session, reason: string) {
    const elapsed = s.since === undefined ? undefined : performance.now() - s.since;
    s.consent.stop();
    clearTimeout(s.timeout); clearInterval(s.interval);
    const starting = s.starting;
    s.phase = 'stopping';
    try {
      if (s.connection && s.connection.state.status !== VoiceConnectionStatus.Destroyed) s.connection.destroy();
      await starting;
      // 開始を待つ間に作られた接続も閉じる。
      if (s.connection && s.connection.state.status !== VoiceConnectionStatus.Destroyed) s.connection.destroy();
      for (const cleanup of s.cleanup) cleanup();
      for (const decoder of s.decoders) decoder.delete();
      await s.flushing;
      if (s.id && s.mixer && elapsed !== undefined) {
        const tail = s.mixer.drain(elapsed);
        if (tail.length) await this.store.append(s.id, s.seq++, tail).catch(() => undefined);
      }
      if (s.id) {
        const r = await this.store.get(s.id);
        // だれの声も届いていない（無音だけの）録音は残さない
        if (r && r.bytes > 44 && s.mixer?.heard) await this.store.finish(s.id);
        else await this.store.remove(s.id);
        await audit(this.db, { actorId: s.ownerId, action: 'recording.voice_stop', detail: { id: s.id, reason }, via: 'discord' });
      }
      await s.message?.edit({ content: `■ 録音の受付を終了しました。${reason}\n音声を保存した場合は、始めた人と宮司が社務所の「録音・録画」から確認できます。`, components: [], allowedMentions: { parse: [] } }).catch(() => undefined);
    } catch (err) { logger.warn({ err }, 'recording stop failed'); }
    finally { if (this.session === s) this.session = undefined; }
  }
}

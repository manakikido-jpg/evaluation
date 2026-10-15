import { ChannelType, MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction, type Message, type VoiceState } from 'discord.js';
import type { ReadAloudConfig } from '../config.js';
import { SpeechPool } from './pool.js';
import { spokenText } from './text.js';

export const readAloudCommand = new SlashCommandBuilder().setName('読み上げ').setDescription('同じVCのチャットを読み上げる')
  .addSubcommand((s) => s.setName('開始').setDescription('いまいるVCで読み上げを始める'))
  .addSubcommand((s) => s.setName('停止').setDescription('いまいるVCの読み上げを止める'))
  .addSubcommand((s) => s.setName('スキップ').setDescription('いま読んでいる文章を飛ばす'))
  .addSubcommand((s) => s.setName('状態').setDescription('いまいるVCの読み上げの状態を見る'));

export class ReadAloudApp {
  constructor(private cfg: ReadAloudConfig, readonly pool: SpeechPool) {}
  async interaction(i: ChatInputCommandInteraction): Promise<void> {
    if (i.commandName !== '読み上げ' || i.guildId !== this.cfg.READ_ALOUD_GUILD_ID || !i.inCachedGuild()) return;
    const channel = i.member.voice.channel;
    const reply = (content: string) => i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    if (!channel || channel.type !== ChannelType.GuildVoice || channel.id === i.guild.afkChannelId) { await reply('読み上げたい通話に入ってから使ってください（ステージ・AFKは対象外です）。'); return; }
    const action = i.options.getSubcommand();
    if (action === '開始') {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const status = await this.pool.start(channel.id);
      const messages = { started: `🔊 読み上げを始めました。音声：${this.cfg.READ_ALOUD_VOICE_CREDIT}`, already: 'この通話では、読み上げを開始済みか接続中です。', busy: '読み上げBOTがすべて使用中か、接続できていません。空くまでお待ちください。', failed: '接続できませんでした。BOTの権限・音声接続・VOICEVOXの設定を運営に確認してください。' };
      await i.editReply({ content: messages[status], allowedMentions: { parse: [] } }); return;
    }
    if (action === '停止') { this.pool.stop(channel.id); await reply('この通話の読み上げを停止し、待っていた文章も消しました。'); return; }
    if (action === 'スキップ') { this.pool.skip(channel.id); await reply('いま読んでいる文章をスキップしました。'); return; }
    await reply(this.pool.active(channel.id) ? '🔊 この通話は読み上げ中です。' : 'この通話では読み上げていません。');
  }
  message(m: Message): void {
    if (m.guildId !== this.cfg.READ_ALOUD_GUILD_ID || m.author.bot || m.webhookId || m.system || m.channel.type !== ChannelType.GuildVoice || m.member?.voice.channelId !== m.channelId || !this.pool.active(m.channelId)) return;
    const text = spokenText(m.content, this.cfg.dictionary, this.cfg.READ_ALOUD_MAX_CHARS);
    if (!text) return;
    // 名前も本文と同じ処理に通す。添付・埋め込み・過去ログは読まない。
    const name = spokenText(m.member.displayName, {}, 16);
    this.pool.enqueue(m.channelId, m.author.id, `${name}さん、${text}`);
  }
  voice(before: VoiceState, after: VoiceState): void {
    if (before.guild.id !== this.cfg.READ_ALOUD_GUILD_ID) return;
    for (const id of this.pool.channels()) {
      const ch = after.guild.channels.cache.get(id);
      if (!ch?.isVoiceBased() || !ch.members.some((m) => !m.user.bot)) this.pool.stop(id);
    }
  }
}

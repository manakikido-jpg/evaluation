import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { logger } from '../lib/logger.js';
import { EventRelay, RelayError } from './relay.js';

export const eventRelayCommand = new SlashCommandBuilder().setName('イベント中継').setDescription('ステージの声をほかのVCへ中継する（運営用）')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).setDMPermission(false)
  .addSubcommand(s => {
    s.setName('開始').setDescription('まず1部屋で確認し、最大6部屋へ中継する')
      .addChannelOption(o => o.setName('ステージ').setDescription('開催中のステージ').addChannelTypes(ChannelType.GuildStageVoice).setRequired(true));
    for (let n = 1; n <= 6; n++) s.addChannelOption(o => o.setName(`配信先${n}`).setDescription(`${n}部屋目の通常VC`).addChannelTypes(ChannelType.GuildVoice).setRequired(n === 1));
    return s;
  })
  .addSubcommand(s => s.setName('停止').setDescription('中継を止めて、使っていたBOTを返す'))
  .addSubcommand(s => s.setName('状態').setDescription('中継先と音声の受信状況を確認する'));

export class EventRelayApp {
  constructor(private guildId: string, private relay: EventRelay) {}
  async interaction(i: ChatInputCommandInteraction): Promise<void> {
    if (i.commandName !== 'イベント中継' || i.guildId !== this.guildId || !i.inCachedGuild()) return;
    const reply = (content: string) => i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) { await reply('サーバー管理権限のある運営だけが操作できます。'); return; }
    const action = i.options.getSubcommand();
    if (action === '状態') {
      const s = this.relay.status();
      if (!s) { await reply(`中継は停止中です。${this.relay.lastStop ?? ''}`); return; }
      const age = s.lastPacketAt === null ? 'まだ受信していません。登壇者が声を出して確認してください。' : `最後の受信は${Math.max(0, Math.floor((Date.now() - s.lastPacketAt) / 1000))}秒前です。`;
      await reply(`${s.phase === 'active' ? '📡 中継中' : s.phase === 'starting' ? '中継を準備中' : '停止処理中'}：<#${s.source}> → ${s.targets.map(id => `<#${id}>`).join('・')}\n使用BOT：${s.targets.length + 1}体／受信パケット：${s.packets}件\n${age}\n受信数だけで各部屋に聞こえることまでは確認できません。配信先でも音を確認してください。`); return;
    }
    if (action !== '開始' && action !== '停止') return;
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    if (action === '停止') {
      await this.relay.stop(); logger.info({ actor: i.user.id }, 'event relay stopped by operator');
      await i.editReply({ content: '中継を停止しました。必要な部屋では「/読み上げ 開始」を使えます。', allowedMentions: { parse: [] } }); return;
    }
    try {
      const sourceId = i.options.getChannel('ステージ', true).id;
      const targets = Array.from({ length: 6 }, (_, n) => i.options.getChannel(`配信先${n + 1}`)?.id).filter((id): id is string => !!id);
      if (!targets.length || new Set([sourceId, ...targets]).size !== targets.length + 1) throw new RelayError('配信先は重複しない1〜6部屋を選んでください。');
      const ids = [sourceId, ...targets];
      for (const [index, id] of ids.entries()) {
        const channel = await i.guild.channels.fetch(id);
        if (!channel || channel.id === i.guild.afkChannelId || channel.type !== (index === 0 ? ChannelType.GuildStageVoice : ChannelType.GuildVoice))
          throw new RelayError('開催中のステージと通常VCを選んでください。AFKは対象外です。');
        if (!channel.permissionsFor(i.member)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]))
          throw new RelayError('運営本人が閲覧・接続できる部屋だけを指定してください。');
      }
      await this.relay.start({ source: sourceId, targets, actor: i.user.id });
      logger.info({ actor: i.user.id, source: sourceId, targets }, 'event relay started');
      await i.editReply({ content: `📡 ${targets.length}部屋への中継を開始しました。「/イベント中継 状態」で受信を確認し、配信先でも声が聞こえるか試してください。録音・保存はしません。`, allowedMentions: { parse: [] } });
    } catch (error) {
      logger.warn('event relay start failed');
      await i.editReply({ content: error instanceof RelayError ? error.message : '中継を開始できませんでした。BOTの権限・音声接続を確認してください。', allowedMentions: { parse: [] } });
    }
  }
}

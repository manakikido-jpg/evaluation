import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Interaction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { adminLevelOf, type GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { Bell } from '../db/schema.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { audit } from '../services/audit.js';
import { bellCardText, doneBell, ringBell, setBellCard, takeBell } from '../services/bells.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

/** 運営に出すカードのボタン */
export function bellButtons(b: Pick<Bell, 'id' | 'status'>) {
  if (b.status === 'done') return [];
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...(b.status === 'open' ? [new ButtonBuilder().setCustomId(`bell:take:${b.id}`).setLabel('対応する').setEmoji('🏃').setStyle(ButtonStyle.Primary)] : []),
      new ButtonBuilder().setCustomId(`bell:done:${b.id}`).setLabel('対応済み').setEmoji('✅').setStyle(ButtonStyle.Success),
    ),
  ];
}

/** 🔔 呼び鈴: メンバーが運営を呼ぶ（/呼び鈴 か、パネルのボタン） */
export class BellApp {
  constructor(
    private readonly client: Client,
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
    private readonly discord: DiscordActions,
  ) {}

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    try {
      if (interaction.isChatInputCommand() && interaction.commandName === 'bell') return await this.ring(interaction, interaction.options.getString('reason') ?? '');
      if (interaction.isButton() && interaction.customId === 'bell:ring') return await this.modal(interaction);
      if (interaction.isModalSubmit() && interaction.customId === 'bell:modal') return await this.ring(interaction, interaction.fields.getTextInputValue('reason'));
      if (interaction.isButton() && interaction.customId.startsWith('bell:')) {
        const [, action, id] = interaction.customId.split(':');
        if ((action === 'take' || action === 'done') && id) return await this.staff(interaction, action, Number(id));
      }
    } catch (err) {
      logger.warn({ err }, 'bell failed');
      const msg = { content: '呼び鈴を鳴らせませんでした。時間をおいてもう一度お試しください（急ぎのときは、神職に直接声をかけてください）。', ...EPHEMERAL };
      if (interaction.isRepliable()) await (interaction.deferred || interaction.replied ? interaction.followUp(msg) : interaction.reply(msg)).catch(() => undefined);
    }
  }

  private async modal(i: ButtonInteraction<'cached'>): Promise<void> {
    const input = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('どうしましたか？（なくても大丈夫）')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(500)
      .setPlaceholder('例: 通話で困っている人がいます / ○○の使い方が分かりません');
    await i.showModal(new ModalBuilder().setCustomId('bell:modal').setTitle('🔔 運営を呼ぶ').addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input)));
  }

  private async ring(i: ChatInputCommandInteraction<'cached'> | ModalSubmitInteraction<'cached'>, reason: string): Promise<void> {
    const cfg = this.cfg();
    const target = cfg.bell.channelId ?? cfg.channels.log;
    if (!target) return void (await i.reply({ content: '呼び鈴の知らせ先がまだ決まっていません。神職に直接声をかけてください。', ...EPHEMERAL }));
    await i.deferReply(EPHEMERAL);
    const r = await ringBell(this.db, cfg, { memberId: i.user.id, channelId: i.channelId, voiceChannelId: i.member.voice.channelId, reason });
    if (r.status === 'waiting') return void (await i.editReply(`🔔 もう運営を呼んでいます（#${r.bell.id}）。${r.bell.status === 'taken' ? `<@${r.bell.takenBy}> さんが対応しています。` : 'もう少し待ってください。'}`));
    if (r.status === 'cooldown') return void (await i.editReply(`続けて呼び鈴は鳴らせません。あと ${r.minutes} 分ほど待ってください。`));
    const staffRoles = cfg.ranks.filter((x) => !x.auto).map((x) => x.roleId);
    const ch = await this.client.channels.fetch(target);
    if (!ch?.isSendable()) return void (await i.editReply('呼び鈴の知らせ先に書き込めませんでした。神職に直接声をかけてください。'));
    const msg = await ch.send({
      content: cfg.bell.mentionStaff ? staffRoles.map((id) => `<@&${id}>`).join(' ') : '',
      embeds: [{ description: bellCardText(r.bell), color: 0xd7003a }],
      components: bellButtons(r.bell),
      allowedMentions: { roles: cfg.bell.mentionStaff ? staffRoles : [], users: [] },
    });
    await setBellCard(this.db, r.bell.id, ch.id, msg.id);
    await i.editReply('🔔 運営を呼びました。神職が気づいたら、BOT から DM でお知らせします。少し待ってください。');
  }

  private async staff(i: ButtonInteraction<'cached'>, action: 'take' | 'done', id: number): Promise<void> {
    if (!adminLevelOf(this.cfg(), [...i.member.roles.cache.keys()])) return void (await i.reply({ content: '神職・宮司のみ使えます。', ...EPHEMERAL }));
    const b = action === 'take' ? await takeBell(this.db, id, i.user.id) : await doneBell(this.db, id, i.user.id);
    if (!b) return void (await i.reply({ content: 'この呼び鈴は、もうほかの人が対応しています。', ...EPHEMERAL }));
    await i.update({ embeds: [{ description: bellCardText(b), color: b.status === 'done' ? 0x3cb371 : 0xd7003a }], components: bellButtons(b) });
    await audit(this.db, { actorId: i.user.id, targetId: b.memberId, action: action === 'take' ? 'bell.take' : 'bell.done', detail: { id }, via: 'discord' });
    if (action === 'take') {
      await this.discord.sendDm(b.memberId, `🔔 呼び鈴 #${b.id} を受け付けました。神職の <@${i.user.id}> さんが対応します。`);
    }
  }
}

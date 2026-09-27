import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  StringSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type Interaction,
  type Message,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { adminLevelOf, type GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { bells, type Bell } from '../db/schema.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { audit } from '../services/audit.js';
import { bellCardText, bellRoles, doneBell, ringBell, setBellCard, takeBell } from '../services/bells.js';

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

/** チャンネルのいちばん下に置く、小さい「🔔 呼び鈴」 */
export function bellStickyMessage() {
  return {
    embeds: [{ description: '🔔 **困ったときは運営を呼べます**\n-# 下のボタンから、呼ぶ人（ロール）を選んで知らせます', color: 0xd7003a }],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('bell:ring').setLabel('呼び鈴').setEmoji('🔔').setStyle(ButtonStyle.Primary))],
    allowedMentions: { parse: [] as const },
  };
}

/** 🔔 呼び鈴: メンバーが運営を呼ぶ（/呼び鈴 か、ボタン）。呼ぶロールを選んでから、内容を書く */
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
      if (interaction.isChatInputCommand() && interaction.commandName === 'bell') return await this.start(interaction);
      if (interaction.isButton() && interaction.customId === 'bell:ring') return await this.start(interaction);
      if (interaction.isStringSelectMenu() && interaction.customId === 'bell:pick') {
        const roleId = interaction.values[0];
        if (!roleId || !bellRoles(this.cfg()).includes(roleId)) return void (await interaction.reply({ content: 'そのロールは今は呼べません。', ...EPHEMERAL }));
        return await this.modal(interaction, roleId);
      }
      if (interaction.isModalSubmit() && interaction.customId.startsWith('bell:modal')) {
        const roleId = interaction.customId.split(':')[2] ?? bellRoles(this.cfg())[0];
        return await this.ring(interaction, interaction.fields.getTextInputValue('reason'), roleId);
      }
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

  /** 呼ぶロールが 1 つならすぐ内容を書くフォーム、いくつかあれば選ぶメニュー（本人にだけ） */
  private async start(i: ButtonInteraction<'cached'> | ChatInputCommandInteraction<'cached'>): Promise<void> {
    const roles = bellRoles(this.cfg());
    if (!roles.length) return void (await i.reply({ content: '呼べるロールがまだ決まっていません。神職に直接声をかけてください。', ...EPHEMERAL }));
    if (roles.length === 1) return await this.modal(i, roles[0]!);
    const name = (id: string) => i.guild.roles.cache.get(id)?.name ?? '（ロール）';
    await i.reply({
      content: '🔔 だれを呼びますか？',
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('bell:pick')
            .setPlaceholder('呼ぶ人（ロール）を選ぶ')
            .addOptions(roles.map((id) => ({ label: name(id).slice(0, 100), value: id }))),
        ),
      ],
      ...EPHEMERAL,
    });
  }

  private async modal(i: ButtonInteraction<'cached'> | ChatInputCommandInteraction<'cached'> | StringSelectMenuInteraction<'cached'>, roleId: string): Promise<void> {
    const input = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('どうしましたか？（なくても大丈夫）')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(500)
      .setPlaceholder('例: 通話で困っている人がいます / ○○の使い方が分かりません');
    const name = i.guild.roles.cache.get(roleId)?.name ?? '運営';
    await i.showModal(
      new ModalBuilder()
        .setCustomId(`bell:modal:${roleId}`)
        .setTitle(`🔔 ${name}を呼ぶ`.slice(0, 45))
        .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input)),
    );
  }

  private async ring(i: ModalSubmitInteraction<'cached'>, reason: string, roleId: string | undefined): Promise<void> {
    const cfg = this.cfg();
    const target = cfg.bell.channelId ?? cfg.channels.log;
    if (!target) return void (await i.reply({ content: '呼び鈴の知らせ先がまだ決まっていません。神職に直接声をかけてください。', ...EPHEMERAL }));
    const role = roleId && bellRoles(cfg).includes(roleId) ? roleId : undefined;
    await i.deferReply(EPHEMERAL);
    const r = await ringBell(this.db, cfg, { memberId: i.user.id, channelId: i.channelId, voiceChannelId: i.member.voice.channelId, reason, roleId: role ?? null });
    if (r.status === 'waiting') return void (await i.editReply(`🔔 もう呼んでいます（#${r.bell.id}）。${r.bell.status === 'taken' ? `<@${r.bell.takenBy}> さんが対応しています。` : 'もう少し待ってください。'}`));
    if (r.status === 'cooldown') return void (await i.editReply(`続けて呼び鈴は鳴らせません。あと ${r.minutes} 分ほど待ってください。`));
    const mention = cfg.bell.mentionStaff && role ? [role] : [];
    const ch = await this.client.channels.fetch(target);
    if (!ch?.isSendable()) return void (await i.editReply('呼び鈴の知らせ先に書き込めませんでした。神職に直接声をかけてください。'));
    const msg = await ch.send({
      content: mention.map((id) => `<@&${id}>`).join(' '),
      embeds: [{ description: bellCardText(r.bell), color: 0xd7003a }],
      components: bellButtons(r.bell),
      allowedMentions: { roles: mention, users: [] },
    });
    await setBellCard(this.db, r.bell.id, ch.id, msg.id);
    await i.editReply('🔔 呼びました。気づいたら、BOT から DM でお知らせします。少し待ってください。');
  }

  private async staff(i: ButtonInteraction<'cached'>, action: 'take' | 'done', id: number): Promise<void> {
    const roleIds = [...i.member.roles.cache.keys()];
    const [bell] = await this.db.select().from(bells).where(eq(bells.id, id));
    // 運営か、呼ばれたロールの人が対応できる
    if (!adminLevelOf(this.cfg(), roleIds) && !(bell?.roleId && roleIds.includes(bell.roleId))) {
      return void (await i.reply({ content: '呼ばれたロールの人と、神職・宮司だけが使えます。', ...EPHEMERAL }));
    }
    const b = action === 'take' ? await takeBell(this.db, id, i.user.id) : await doneBell(this.db, id, i.user.id);
    if (!b) return void (await i.reply({ content: 'この呼び鈴は、もうほかの人が対応しています。', ...EPHEMERAL }));
    await i.update({ embeds: [{ description: bellCardText(b), color: b.status === 'done' ? 0x3cb371 : 0xd7003a }], components: bellButtons(b) });
    await audit(this.db, { actorId: i.user.id, targetId: b.memberId, action: action === 'take' ? 'bell.take' : 'bell.done', detail: { id }, via: 'discord' });
    if (action === 'take') {
      await this.discord.sendDm(b.memberId, `🔔 呼び鈴 #${b.id} を受け付けました。<@${i.user.id}> さんが対応します。`);
    }
  }
}

/** 決めたチャンネルのいちばん下に、いつも「🔔 呼び鈴」のボタンを置く（話が落ち着いてから置き直す） */
export class BellStickyApp {
  private guild?: Guild;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly queue = new Map<string, Promise<void>>();

  constructor(
    private readonly cfg: () => GuildConfig,
    private readonly restickMs = 60_000,
  ) {}

  attach(guild: Guild): void {
    this.guild = guild;
    this.checkAll();
  }

  /** 10 分ごと（設定で足したチャンネルにも置く） */
  checkAll(): void {
    for (const id of this.cfg().bell.channelIds) this.enqueue(id);
  }

  onMessage(msg: Message): void {
    if (!msg.inGuild() || msg.guildId !== this.cfg().guildId || !this.cfg().bell.channelIds.includes(msg.channelId)) return;
    if (msg.author.id === msg.client.user?.id && isBellSticky(msg)) return;
    clearTimeout(this.timers.get(msg.channelId));
    this.timers.set(
      msg.channelId,
      setTimeout(() => {
        this.timers.delete(msg.channelId);
        this.enqueue(msg.channelId);
      }, this.restickMs),
    );
  }

  private enqueue(channelId: string): void {
    const prev = this.queue.get(channelId) ?? Promise.resolve();
    const next = prev.then(() => this.restick(channelId)).catch((err: unknown) => logger.warn({ err, channelId }, 'bell sticky failed'));
    this.queue.set(channelId, next);
  }

  private async restick(channelId: string): Promise<void> {
    const ch = this.guild?.channels.cache.get(channelId);
    if (!ch?.isTextBased() || !ch.isSendable()) return;
    const me = ch.client.user.id;
    const recent = await ch.messages.fetch({ limit: 20 }).catch(() => undefined);
    const mine = (m: Message) => m.author.id === me && isBellSticky(m);
    const last = recent?.first();
    if (last && mine(last)) return;
    await ch.send(bellStickyMessage());
    for (const m of recent?.values() ?? []) if (mine(m)) await m.delete().catch(() => undefined);
  }
}

const isBellSticky = (m: Pick<Message, 'components'>) =>
  m.components.some((r) => 'components' in r && r.components.some((c) => 'customId' in c && c.customId === 'bell:ring'));

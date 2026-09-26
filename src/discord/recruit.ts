import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Guild,
  type Interaction,
  type Message,
  type ModalSubmitInteraction,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { decideRecruit, RecruitCooldown, recruitCard, recruitPanelMessage, type RecruitDecision } from '../services/recruit.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const STATE_KEY = 'recruit_panels';
/** 会話が続いている間は置き直さず、落ち着いてから一番下へ */
const RESTICK_AFTER_MS = 60_000;

const DENIED: Record<Exclude<RecruitDecision['status'], 'ok' | 'cooldown'>, string> = {
  unknown: 'このチャンネルでは募集できません。',
  adult_only: 'この募集は、宵参り（18 歳以上）の方だけができます。',
};

/** 「募集する」ボタン（#宿帳・#縁日・#手水舎・#御神酒処 のいちばん下） */
export class RecruitApp {
  private guild?: Guild;
  private readonly cooldown = new RecruitCooldown();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  /** チャンネルごとに置き直しを 1 つずつ行う */
  private readonly queue = new Map<string, Promise<void>>();

  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
  ) {}

  /** 起動したとき: ボタンがなければ置く（あれば一番下か確かめる） */
  async attach(guild: Guild): Promise<void> {
    this.guild = guild;
    for (const p of this.cfg().recruit.panels) await this.restick(p.channelId);
  }

  onMessage(msg: Message): void {
    if (!msg.inGuild() || msg.author.id === msg.client.user.id) return;
    if (!this.cfg().recruit.panels.some((p) => p.channelId === msg.channelId)) return;
    clearTimeout(this.timers.get(msg.channelId));
    this.timers.set(
      msg.channelId,
      setTimeout(() => void this.restick(msg.channelId), RESTICK_AFTER_MS),
    );
  }

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    try {
      if (interaction.isButton() && interaction.customId === 'recruit:open') return await this.open(interaction);
      if (interaction.isModalSubmit() && interaction.customId === 'recruit:submit') return await this.submit(interaction);
    } catch (err) {
      logger.error({ err }, 'recruit failed');
      const content = '募集できませんでした。時間をおいてもう一度お試しください。';
      if (interaction.isRepliable()) {
        await (interaction.deferred ? interaction.editReply({ content }) : interaction.replied ? interaction.followUp({ content, ...EPHEMERAL }) : interaction.reply({ content, ...EPHEMERAL })).catch(
          () => undefined,
        );
      }
    }
  }

  private decide(i: ButtonInteraction<'cached'> | ModalSubmitInteraction<'cached'>): RecruitDecision {
    return decideRecruit(this.cfg(), i.channelId ?? '', [...i.member.roles.cache.keys()], this.cooldown.lastAt(i.user.id), Date.now());
  }

  private async deny(i: ButtonInteraction<'cached'> | ModalSubmitInteraction<'cached'>, d: Exclude<RecruitDecision, { status: 'ok' }>): Promise<void> {
    const content = d.status === 'cooldown' ? `続けて募集できません。あと ${d.minutes} 分ほど待ってください。` : DENIED[d.status];
    await i.reply({ content, ...EPHEMERAL });
  }

  private async open(i: ButtonInteraction<'cached'>): Promise<void> {
    const d = this.decide(i);
    if (d.status !== 'ok') return this.deny(i, d);
    const input = new TextInputBuilder()
      .setCustomId('message')
      .setLabel('一言（なくても大丈夫）')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(100)
      .setPlaceholder(d.panel.label === 'ゲーム' ? '例: APEX あと 2 人 / 21 時から' : '例: 23 時から / だれか話そう');
    await i.showModal(
      new ModalBuilder()
        .setCustomId('recruit:submit')
        .setTitle(`${d.panel.label}の募集`)
        .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input)),
    );
  }

  private async submit(i: ModalSubmitInteraction<'cached'>): Promise<void> {
    const d = this.decide(i);
    if (d.status !== 'ok') return this.deny(i, d);
    const channel = i.channel;
    if (!channel?.isSendable()) return void (await i.reply({ content: DENIED.unknown, ...EPHEMERAL }));
    // 投稿が混んで 3 秒を超えても失敗にならないよう、先に受け付ける
    await i.deferReply(EPHEMERAL);
    await channel.send(
      recruitCard({
        guildId: i.guildId,
        panel: d.panel,
        userId: i.user.id,
        name: i.member.displayName,
        message: i.fields.getTextInputValue('message'),
        voiceChannelId: i.member.voice.channelId,
      }),
    );
    // 投稿できてから「続けて募集できない」時間を数え始める
    this.cooldown.mark(i.user.id, Date.now());
    await i.editReply({ content: `募集しました。${d.panel.label}のお守りを持っている人に通知が届きます。` });
    clearTimeout(this.timers.get(channel.id));
    await this.restick(channel.id);
  }

  /** ボタンをチャンネルのいちばん下に置き直す（すでに一番下なら何もしない） */
  restick(channelId: string): Promise<void> {
    const prev = this.queue.get(channelId) ?? Promise.resolve();
    const next = prev.then(() => this.doRestick(channelId)).catch((err) => logger.warn({ err, channelId }, 'recruit panel restick failed'));
    this.queue.set(channelId, next);
    return next;
  }

  private async doRestick(channelId: string): Promise<void> {
    const panel = this.cfg().recruit.panels.find((p) => p.channelId === channelId);
    const channel = this.guild?.channels.cache.get(channelId);
    if (!panel || !channel?.isTextBased() || !channel.isSendable()) return;
    const old = await this.loadPanelId(channelId);
    if (old && channel.lastMessageId === old) return;
    if (old) await channel.messages.delete(old).catch(() => undefined);
    const sent = await channel.send(recruitPanelMessage(panel));
    await this.savePanelId(channelId, sent.id);
  }

  /** チャンネルごとに別の行に覚える（同時に置き直しても、ほかのチャンネルの記録を上書きしない） */
  private async loadPanelId(channelId: string): Promise<string | undefined> {
    const [row] = await this.db.select().from(settings).where(eq(settings.key, `${STATE_KEY}:${channelId}`));
    if (row) return (row.value as { messageId?: string }).messageId;
    // 前の版は全チャンネルを 1 行にまとめていた
    const [legacy] = await this.db.select().from(settings).where(eq(settings.key, STATE_KEY));
    return (legacy?.value as Record<string, string> | undefined)?.[channelId];
  }

  private async savePanelId(channelId: string, messageId: string): Promise<void> {
    const key = `${STATE_KEY}:${channelId}`;
    const value = { messageId };
    await this.db
      .insert(settings)
      .values({ key, value, updatedBy: 'system' })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: 'system', updatedAt: new Date() } });
  }
}

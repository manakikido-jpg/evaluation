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
import {
  decideRecruit,
  lastRecruits,
  recordRecruit,
  recruitCard,
  recruitMentionRoleIds,
  recruitPanelMessage,
  RecruitSpamCounter,
  waitText,
  type RecruitDecision,
} from '../services/recruit.js';
import type { DiscordActions } from '../lib/discordRest.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const STATE_KEY = 'recruit_panels';
/** 会話が続いている間は置き直さず、落ち着いてから一番下へ */
const RESTICK_AFTER_MS = 60_000;

const DENIED: Record<Exclude<RecruitDecision['status'], 'ok' | 'cooldown' | 'channel_cooldown' | 'too_new'>, string> = {
  unknown: 'このチャンネルでは募集できません。',
  adult_only: 'この募集は、宵参り（18 歳以上）の方だけができます。',
  not_member: '募集は、入鯖が承認された方（🔰参拝者 以上）だけができます。',
  yakudoshi: '👹 厄年の間は募集できません。',
};

/** 断るときの文 */
export function deniedText(d: Exclude<RecruitDecision, { status: 'ok' }>): string {
  if (d.status === 'cooldown') return `続けて募集できません。あと ${waitText(d.seconds)}ほど待ってください。`;
  if (d.status === 'channel_cooldown') return `このチャンネルでは少し前に募集がありました。通知が続かないよう、あと ${waitText(d.seconds)}ほど待ってください（上の募集に参加するのもおすすめです）。`;
  if (d.status === 'too_new') return `入ったばかりの方は、あと ${d.days} 日ほどで募集できるようになります。`;
  return DENIED[d.status];
}

/** 「募集する」ボタン（#宿帳・#縁日・#手水舎・#御神酒処 のいちばん下） */
export class RecruitApp {
  private guild?: Guild;
  private readonly spam = new RecruitSpamCounter();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  /** チャンネルごとに置き直しを 1 つずつ行う */
  private readonly queue = new Map<string, Promise<void>>();

  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
    private readonly discord?: DiscordActions,
  ) {}

  /** 起動したとき: ボタンがなければ置く（あれば一番下か確かめる）。置いてあるボタンの文も今の文にする */
  async attach(guild: Guild): Promise<void> {
    this.guild = guild;
    for (const p of this.cfg().recruit.panels) {
      await this.restick(p.channelId);
      await this.refreshText(p.channelId);
    }
  }

  /** 置いてあるボタンの文が前の版（お守りの人に通知、など）なら書き換える */
  private async refreshText(channelId: string): Promise<void> {
    const panel = this.cfg().recruit.panels.find((p) => p.channelId === channelId);
    const channel = this.guild?.channels.cache.get(channelId);
    const id = await this.loadPanelId(channelId);
    if (!panel || !id || !channel?.isTextBased()) return;
    const next = recruitPanelMessage(panel);
    const msg = await channel.messages.fetch(id).catch(() => undefined);
    if (!msg || msg.embeds[0]?.description === next.embeds[0]!.description) return;
    await msg.edit(next).catch((err: unknown) => logger.warn({ err, channelId }, 'recruit panel text refresh failed'));
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

  private async decide(i: ButtonInteraction<'cached'> | ModalSubmitInteraction<'cached'>): Promise<RecruitDecision> {
    const now = Date.now();
    const channelId = i.channelId ?? '';
    const last = await lastRecruits(this.db, i.user.id, channelId, now);
    return decideRecruit(this.cfg(), channelId, { roleIds: [...i.member.roles.cache.keys()], joinedAt: i.member.joinedTimestamp ?? undefined, ...last }, now);
  }

  private async deny(i: ButtonInteraction<'cached'> | ModalSubmitInteraction<'cached'>, d: Exclude<RecruitDecision, { status: 'ok' }>): Promise<void> {
    await i.reply({ content: deniedText(d), ...EPHEMERAL });
    // 待ち時間中に何度も押す人は、運営に知らせる（1 回だけ）
    if (d.status === 'cooldown' || d.status === 'channel_cooldown') {
      const cfg = this.cfg();
      if (this.spam.hit(i.user.id, Date.now(), d.seconds / 60, cfg.recruit.spamAlertCount) && cfg.channels.log) {
        const ch = await i.client.channels.fetch(cfg.channels.log).catch(() => null);
        if (ch?.isSendable()) {
          await ch
            .send({
              content: `⚠ <@${i.user.id}> さんが、待ち時間中に募集ボタンを ${cfg.recruit.spamAlertCount} 回以上押しています（<#${i.channelId}>）。連投・荒らしでないか確かめてください。`,
              allowedMentions: { parse: [] },
            })
            .catch(() => undefined);
        }
      }
    }
  }

  private async open(i: ButtonInteraction<'cached'>): Promise<void> {
    const d = await this.decide(i);
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
    const d = await this.decide(i);
    if (d.status !== 'ok') return this.deny(i, d);
    const channel = i.channel;
    if (!channel?.isSendable()) return void (await i.reply({ content: DENIED.unknown, ...EPHEMERAL }));
    // 投稿が混んで 3 秒を超えても失敗にならないよう、先に受け付ける
    await i.deferReply(EPHEMERAL);
    await channel.send(
      recruitCard({
        guildId: i.guildId,
        panel: d.panel,
        mention: recruitMentionRoleIds(this.cfg()),
        userId: i.user.id,
        name: i.member.displayName,
        message: i.fields.getTextInputValue('message'),
        voiceChannelId: i.member.voice.channelId,
        avatarUrl: i.member.displayAvatarURL({ size: 256 }),
      }),
    );
    // 投稿できてから「続けて募集できない」時間を数え始める（DB に残すので、BOT を起動し直しても忘れない）
    await recordRecruit(this.db, i.user.id, channel.id);
    await i.editReply({ content: `募集しました。役職のある人みんなに通知が届きます。` });
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

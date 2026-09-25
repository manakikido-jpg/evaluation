import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Interaction,
  type MessageActionRowComponentBuilder,
  type ModalSubmitInteraction,
} from 'discord.js';
import { adminLevelOf, type GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { setApplicationCard } from '../services/applications.js';
import {
  checkOmairi,
  closeSoudan,
  decide,
  decideOmairi,
  replySoudan,
  submitJoin,
  submitYoimairi,
  type AgeGroup,
  type OmairiAction,
} from '../services/admission.js';
import { getMember } from '../services/members.js';
import type { Actor, ModCtx } from '../services/moderation.js';
import { appendFromSender, createSoudan, setSoudanCard } from '../services/soudan.js';
import { goshuinchoOf } from '../services/shuin.js';
import { SHU } from './views.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const NO_MENTIONS = { parse: [] as const };
const mention = (id: string) => `<@${id}>`;
const ts = (d: Date, style = 'R') => `<t:${Math.floor(d.getTime() / 1000)}:${style}>`;
const AGE_LABEL: Record<AgeGroup, string> = { minor: '13〜17 歳', adult: '18 歳以上' };

type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;
const row = (...b: ButtonBuilder[]): Row => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(b);
const btn = (id: string, label: string, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);

function textInput(id: string, label: string, style: TextInputStyle, opts: { required?: boolean; max?: number; placeholder?: string } = {}) {
  const t = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style)
    .setRequired(opts.required ?? true)
    .setMaxLength(opts.max ?? 200);
  if (opts.placeholder) t.setPlaceholder(opts.placeholder);
  return new ActionRowBuilder<TextInputBuilder>().addComponents(t);
}

/**
 * 入鯖申請・宵参り申請・匿名相談・お参り期間の判定（Discord 側）。
 * 判定の中身は services/admission.ts（管理画面と共通）。
 */
export class AdmissionApp {
  constructor(
    private readonly client: Client,
    private readonly db: Db,
    private readonly getCfg: () => GuildConfig,
    private readonly discord: DiscordActions,
  ) {}

  private get cfg(): GuildConfig {
    return this.getCfg();
  }

  private get ctx(): ModCtx {
    return { db: this.db, cfg: this.cfg, discord: this.discord };
  }

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg.guildId) return;
    try {
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'panel') return await this.panel(interaction);
        if (interaction.commandName === 'soudan') return await this.soudanStart(interaction);
      } else if (interaction.isButton()) {
        const [ns, action, arg] = interaction.customId.split(':');
        if (ns === 'apply' && action === 'start') return await this.applyStart(interaction);
        if (ns === 'apply' && action === 'age' && (arg === 'minor' || arg === 'adult')) return await this.applyModal(interaction, arg);
        if (ns === 'yoimairi' && action === 'start') return await this.yoimairiStart(interaction);
        if (ns === 'app' && (action === 'approve' || action === 'reject') && arg) return await this.decideApp(interaction, Number(arg), action === 'approve');
        if (ns === 'soudan' && action === 'reply' && arg) return await this.soudanReplyModal(interaction, Number(arg));
        if (ns === 'soudan' && action === 'done' && arg) return await this.soudanDone(interaction, Number(arg));
        if (ns === 'omairi' && action === 'remove' && arg) return await this.omairiConfirmRemove(interaction, arg);
        if (ns === 'omairi' && (action === 'extend' || action === 'promote') && arg) return await this.omairiDecide(interaction, arg, action);
        if (ns === 'omairi' && action === 'removeok' && arg) return await this.omairiDecide(interaction, arg, 'remove');
      } else if (interaction.isModalSubmit()) {
        const [ns, action, arg] = interaction.customId.split(':');
        if (ns === 'apply' && action === 'modal' && (arg === 'minor' || arg === 'adult')) return await this.applySubmit(interaction, arg);
        if (ns === 'soudan' && action === 'modal') return await this.soudanSubmit(interaction, arg === 'new' ? undefined : Number(arg));
        if (ns === 'soudan' && action === 'replymodal' && arg) return await this.soudanReply(interaction, Number(arg));
      }
    } catch (err) {
      logger.error({ err }, 'admission interaction failed');
      if (interaction.isRepliable()) {
        const msg = { content: '申し訳ありません、うまく処理できませんでした。', ...EPHEMERAL };
        await (interaction.deferred || interaction.replied ? interaction.followUp(msg) : interaction.reply(msg)).catch(() => undefined);
      }
    }
  }

  private staffOf(i: ChatInputCommandInteraction<'cached'> | ButtonInteraction<'cached'> | ModalSubmitInteraction<'cached'>): Actor | undefined {
    const level = adminLevelOf(this.cfg, [...i.member.roles.cache.keys()]);
    return level ? { id: i.user.id, level, via: 'discord' } : undefined;
  }

  // ───────── パネル（神職が #社務所 などに置く） ─────────

  private async panel(i: ChatInputCommandInteraction<'cached'>): Promise<void> {
    if (!this.staffOf(i)) return void (await i.reply({ content: '神職・宮司のみ使えます。', ...EPHEMERAL }));
    const kind = i.options.getSubcommand();
    const channel = i.channel;
    if (!channel?.isSendable()) return void (await i.reply({ content: 'このチャンネルには置けません。', ...EPHEMERAL }));
    if (kind === 'apply') {
      const embed = new EmbedBuilder()
        .setColor(SHU)
        .setTitle('⛩ 社務所 ― 入鯖申請')
        .setDescription(
          [
            '咲楽ノ宮へようこそ。下のボタンから入鯖を申請してください。',
            '',
            '・13 歳以上の方が参加できます',
            '・申請の内容は神職だけが見ます',
            '・承認されると 🔰参拝者 になり、お参り期間が始まります',
          ].join('\n'),
        );
      await channel.send({ embeds: [embed.toJSON()], components: [row(btn('apply:start', '入鯖を申請する', ButtonStyle.Primary))] });
    } else {
      const embed = new EmbedBuilder()
        .setColor(SHU)
        .setTitle('🔞 宵参りの申請（18 歳以上）')
        .setDescription('宵宮（18 歳以上だけのエリア）に入るための申請です。入鯖のときに「18 歳以上」と申告した方だけ申請できます。');
      await channel.send({ embeds: [embed.toJSON()], components: [row(btn('yoimairi:start', '宵参りを申請する', ButtonStyle.Primary))] });
    }
    await i.reply({ content: '置きました。', ...EPHEMERAL });
  }

  // ───────── 入鯖申請 ─────────

  private async applyStart(i: ButtonInteraction<'cached'>): Promise<void> {
    await i.reply({
      content: 'まず年齢区分を選んでください（生年月日は聞きません）。\n13 歳未満の方は Discord の規約により参加できません。',
      components: [row(btn('apply:age:minor', '13〜17 歳'), btn('apply:age:adult', '18 歳以上'))],
      ...EPHEMERAL,
    });
  }

  private async applyModal(i: ButtonInteraction<'cached'>, age: AgeGroup): Promise<void> {
    const modal = new ModalBuilder()
      .setCustomId(`apply:modal:${age}`)
      .setTitle(`入鯖申請（${AGE_LABEL[age]}）`)
      .addComponents(
        textInput('name', '呼び名', TextInputStyle.Short, { max: 32 }),
        textInput('purpose', '主にやりたいこと', TextInputStyle.Short, { max: 100, placeholder: 'ゲーム・雑談・寝落ち など' }),
        textInput('message', 'ひとこと', TextInputStyle.Paragraph, { required: false, max: 500 }),
      );
    await i.showModal(modal);
  }

  private async applySubmit(i: ModalSubmitInteraction<'cached'>, age: AgeGroup): Promise<void> {
    await i.deferReply(EPHEMERAL);
    const answers = {
      name: i.fields.getTextInputValue('name').trim(),
      age,
      purpose: i.fields.getTextInputValue('purpose').trim(),
      message: i.fields.getTextInputValue('message').trim(),
    };
    const r = await submitJoin(this.ctx, { id: i.user.id, roleIds: [...i.member.roles.cache.keys()], accountCreatedAt: i.user.createdAt }, answers);
    if (r.status === 'already_member') return void (await i.editReply('すでに参拝者以上になっています。申請は不要です。'));
    if (r.status === 'duplicate') return void (await i.editReply('申請はすでに受け付けています。神職の確認をお待ちください。'));
    if (r.status === 'auto_approved') return void (await i.editReply('⛩ 申請を承認しました。ようこそ、咲楽ノ宮へ！'));

    await this.postApplicationCard(r.id, i.user.id, [
      `**入鯖申請 #${r.id}** ${mention(i.user.id)}`,
      `呼び名: ${answers.name}`,
      `年齢区分: ${AGE_LABEL[age]}`,
      `やりたいこと: ${answers.purpose}`,
      answers.message ? `ひとこと: ${answers.message}` : '',
      `Discord アカウント作成: ${ts(i.user.createdAt)} ・ 参加: ${i.member.joinedAt ? ts(i.member.joinedAt) : '—'}`,
    ]);
    await i.editReply('申請を受け付けました。神職が確認するまで少しお待ちください。結果は BOT から DM でお知らせします。');
  }

  private async postApplicationCard(id: number, memberId: string, lines: string[]): Promise<void> {
    const channelId = this.cfg.channels.applications;
    if (!channelId) return;
    try {
      const ch = await this.client.channels.fetch(channelId);
      if (!ch?.isSendable()) return;
      const embed = new EmbedBuilder().setColor(SHU).setDescription(lines.filter(Boolean).join('\n'));
      const msg = await ch.send({
        embeds: [embed.toJSON()],
        components: [row(btn(`app:approve:${id}`, '承認', ButtonStyle.Success), btn(`app:reject:${id}`, '却下', ButtonStyle.Danger))],
        allowedMentions: NO_MENTIONS,
      });
      await setApplicationCard(this.db, id, ch.id, msg.id);
    } catch (err) {
      logger.warn({ err, memberId }, 'application card failed');
    }
  }

  private async yoimairiStart(i: ButtonInteraction<'cached'>): Promise<void> {
    await i.deferReply(EPHEMERAL);
    const r = await submitYoimairi(this.ctx, i.user.id, [...i.member.roles.cache.keys()]);
    const text = {
      disabled: '宵参りの申請は受け付けていません。',
      already: 'すでに宵参りになっています。',
      not_adult: '入鯖のときに「18 歳以上」と申告した方だけ申請できます。',
      duplicate: '申請はすでに受け付けています。',
      pending: '宵参りの申請を受け付けました。結果は BOT から DM でお知らせします。',
    }[r.status];
    if (r.status === 'pending') await this.postApplicationCard(r.id, i.user.id, [`**🔞 宵参り申請 #${r.id}** ${mention(i.user.id)}`, '年齢区分: 18 歳以上（入鯖時の申告）']);
    await i.editReply(text);
  }

  private async decideApp(i: ButtonInteraction<'cached'>, id: number, approve: boolean): Promise<void> {
    const actor = this.staffOf(i);
    if (!actor) return void (await i.reply({ content: '神職・宮司のみ使えます。', ...EPHEMERAL }));
    await i.deferReply(EPHEMERAL);
    const r = await decide(this.ctx, actor, id, approve);
    const text =
      r.status === 'approved'
        ? `承認しました。${r.dmSent ? '' : '（DM は届きませんでした）'}`
        : r.status === 'rejected'
          ? `却下しました。${r.dmSent ? '' : '（DM は届きませんでした）'}`
          : r.status === 'not_adult'
            ? 'この方は 18 歳以上と申告していないため、宵参りを承認できません。'
            : 'この申請はすでに判定済みです。';
    await i.editReply(text);
  }

  // ───────── 匿名相談 ─────────

  private async soudanStart(i: ChatInputCommandInteraction<'cached'>): Promise<void> {
    const num = i.options.getInteger('number');
    const modal = new ModalBuilder()
      .setCustomId(`soudan:modal:${num ?? 'new'}`)
      .setTitle(num ? `相談 #${num} の続き` : '神職への相談（匿名）')
      .addComponents(
        textInput('body', '相談したいこと', TextInputStyle.Paragraph, {
          max: 1500,
          placeholder: '神職にはあなたの名前は表示されません。返信は BOT から DM で届きます。',
        }),
      );
    await i.showModal(modal);
  }

  private async soudanSubmit(i: ModalSubmitInteraction<'cached'>, num: number | undefined): Promise<void> {
    await i.deferReply(EPHEMERAL);
    const body = i.fields.getTextInputValue('body').trim();
    let id: number;
    if (num) {
      if ((await appendFromSender(this.db, num, i.user.id, body)) !== 'ok') {
        return void (await i.editReply(`相談 #${num} が見つかりません（ご自身の相談の番号だけ使えます）。`));
      }
      id = num;
    } else {
      id = await createSoudan(this.db, i.user.id, body);
    }
    await this.postSoudanCard(id, body, Boolean(num));
    await i.editReply(
      `📮 相談 #${id} を受け付けました。神職にはあなたの名前は表示されません。\n返信は BOT から DM で届きます（サーバーのメンバーからの DM を受け取る設定にしておいてください）。`,
    );
  }

  private async postSoudanCard(id: number, body: string, isFollowUp: boolean): Promise<void> {
    const channelId = this.cfg.channels.soudan;
    if (!channelId) return;
    try {
      const ch = await this.client.channels.fetch(channelId);
      if (!ch?.isSendable()) return;
      const embed = new EmbedBuilder()
        .setColor(SHU)
        .setTitle(isFollowUp ? `📮 相談 #${id} に続きが届きました（匿名）` : `📮 相談 #${id}（匿名）`)
        .setDescription(body.slice(0, 4000));
      const msg = await ch.send({
        embeds: [embed.toJSON()],
        components: [row(btn(`soudan:reply:${id}`, '返信する', ButtonStyle.Primary), btn(`soudan:done:${id}`, '完了にする'))],
      });
      await setSoudanCard(this.db, id, ch.id, msg.id);
    } catch (err) {
      logger.warn({ err }, 'soudan card failed');
    }
  }

  private async soudanReplyModal(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    if (!this.staffOf(i)) return void (await i.reply({ content: '神職・宮司のみ使えます。', ...EPHEMERAL }));
    await i.showModal(
      new ModalBuilder()
        .setCustomId(`soudan:replymodal:${id}`)
        .setTitle(`相談 #${id} への返信`)
        .addComponents(textInput('body', '返信（BOT から DM で届く。あなたの名前は出ません）', TextInputStyle.Paragraph, { max: 1500 })),
    );
  }

  private async soudanReply(i: ModalSubmitInteraction<'cached'>, id: number): Promise<void> {
    const actor = this.staffOf(i);
    if (!actor) return void (await i.reply({ content: '神職・宮司のみ使えます。', ...EPHEMERAL }));
    await i.deferReply(EPHEMERAL);
    const r = await replySoudan(this.ctx, actor, id, i.fields.getTextInputValue('body').trim());
    await i.editReply(r.status === 'not_found' ? '相談が見つかりません。' : r.dmSent ? '返信を送りました。' : '⚠️ 返信を記録しましたが、DM が届きませんでした（相手が DM を受け取らない設定の可能性）。');
  }

  private async soudanDone(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const actor = this.staffOf(i);
    if (!actor) return void (await i.reply({ content: '神職・宮司のみ使えます。', ...EPHEMERAL }));
    await i.deferReply(EPHEMERAL);
    await i.editReply((await closeSoudan(this.ctx, actor, id)) === 'ok' ? '完了にしました。' : '相談が見つかりません。');
  }

  // ───────── お参り期間 ─────────

  /** 定期的に呼ぶ: 期間が終わった人を判定し、神職の判定が必要な人を #お参り判定 に出す */
  async checkOmairi(now = new Date()): Promise<void> {
    const r = await checkOmairi(this.ctx, now);
    const channelId = this.cfg.channels.omairi;
    if (!r.review.length || !channelId) return;
    const ch = await this.client.channels.fetch(channelId).catch(() => null);
    if (!ch?.isSendable()) return;
    const first = this.cfg.ranks.filter((x) => x.auto).sort((a, b) => a.requiredGoen - b.requiredGoen)[1];
    for (const memberId of r.review) {
      const [m, card] = await Promise.all([getMember(this.db, memberId), goshuinchoOf(this.db, memberId)]);
      const embed = new EmbedBuilder()
        .setColor(SHU)
        .setTitle('お参り期間の判定')
        .setDescription(
          [
            `${mention(memberId)}（${m?.displayName ?? memberId}）`,
            `ご縁 ${card.goen}${first ? ` / ${first.requiredGoen}` : ''} ・ 朱印をくれた人 ${card.receivedCount} 人`,
            m?.lastActiveAt ? `最後の活動 ${ts(m.lastActiveAt)}` : '最後の活動 記録なし',
          ].join('\n'),
        );
      await ch
        .send({
          embeds: [embed.toJSON()],
          components: [
            row(
              btn(`omairi:extend:${memberId}`, '延長する'),
              btn(`omairi:promote:${memberId}`, `${first?.name ?? '次の役職'}にする`, ButtonStyle.Success),
              btn(`omairi:remove:${memberId}`, '退出にする', ButtonStyle.Danger),
            ),
          ],
          allowedMentions: NO_MENTIONS,
        })
        .catch((err) => logger.warn({ err }, 'omairi card failed'));
    }
  }

  /** 退出（キック）は確認してから */
  private async omairiConfirmRemove(i: ButtonInteraction<'cached'>, memberId: string): Promise<void> {
    if (!this.staffOf(i)) return void (await i.reply({ content: '神職・宮司のみ使えます。', ...EPHEMERAL }));
    await i.reply({
      content: `${mention(memberId)} さまを退出（キック）させますか？本人には DM で知らせます。`,
      components: [row(btn(`omairi:removeok:${memberId}`, '退出にする', ButtonStyle.Danger))],
      allowedMentions: NO_MENTIONS,
      ...EPHEMERAL,
    });
  }

  private async omairiDecide(i: ButtonInteraction<'cached'>, memberId: string, action: OmairiAction): Promise<void> {
    const actor = this.staffOf(i);
    if (!actor) return void (await i.reply({ content: '神職・宮司のみ使えます。', ...EPHEMERAL }));
    await i.deferUpdate();
    const r = await decideOmairi(this.ctx, actor, memberId, action);
    const label = { extend: '⏳ 延長しました', promote: '⬆️ 昇格させました', remove: '🚪 退出にしました' }[action];
    const text = r === 'ok' ? `${label}（${mention(actor.id)}）` : r === 'denied' ? 'この方には操作できません。' : 'すでに判定済みです。';
    await i.editReply({ content: text, components: [], allowedMentions: NO_MENTIONS });
  }
}

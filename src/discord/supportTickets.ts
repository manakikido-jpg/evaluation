import {
  ActionRowBuilder,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  OverwriteType,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Guild,
  type GuildMember,
  type Interaction,
  type Message,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type TextChannel,
} from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { SupportTicket } from '../db/schema.js';
import type { DiscordActions, MessageBody } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { audit } from '../services/audit.js';
import {
  addTicketMember,
  claimTicket,
  closeTicket,
  deliverTicket,
  dropTicket,
  getTicket,
  isTicketStaff,
  loadTicketConfig,
  markHired,
  openTicket,
  payQuote,
  rateTicket,
  saveTicketConfig,
  setQuote,
  setTicketChannel,
  ticketByChannel,
  ticketChannelName,
  ticketTick,
  ticketTypeOf,
  touchTicket,
  transcriptText,
  type TicketConfig,
  type TicketType,
} from '../services/supportTickets.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const COLOR = 0xc8553d;
const fmt = (n: number) => n.toLocaleString('ja-JP');
type Btn = { type: 2; style: 1 | 2 | 3 | 4; label: string; custom_id: string; emoji?: { name: string } };
const button = (custom_id: string, label: string, style: Btn['style'] = 2, emoji?: string): Btn => ({ type: 2, style, label, custom_id, ...(emoji ? { emoji: { name: emoji } } : {}) });
const row = (...b: Btn[]) => ({ type: 1 as const, components: b });

/** 運営（神職・宮司）のロール。種類のロールとあわせて、チケットが見える */
export const adminRoleIdsOf = (cfg: GuildConfig) => [...(cfg.admin?.shinshokuRoleIds ?? []), ...(cfg.admin?.gujiRoleIds ?? [])];

/** パネル: 種類を選ぶ欄 */
export function ticketPanel(c: TicketConfig): MessageBody {
  const types = c.types.filter((t) => t.enabled);
  return {
    embeds: [
      {
        title: '🎫 チケット',
        description: [
          'お問い合わせ・相談・役職の希望・依頼などは、下の欄から種類を選んでください。',
          'あなたと、その係の運営だけが見えるチャンネルができます。',
          '',
          ...types.map((t) => `${t.emoji} **${t.label}** … ${t.description}`),
          '',
          '-# 同じ種類のチケットは、1 人 1 つまで開けます',
        ].join('\n'),
        color: COLOR,
      },
    ],
    components: types.length
      ? [{ type: 1, components: [{ type: 3, custom_id: 'tk:open', placeholder: '🎫 チケットの種類を選ぶ', options: types.slice(0, 25).map((t) => ({ label: t.label.slice(0, 100), value: t.key, description: t.description.slice(0, 100) || undefined, ...(t.emoji ? { emoji: { name: t.emoji } } : {}) })) }] }]
      : [],
  };
}

/** パネルを出す・書き換える。出せたら true */
export async function refreshTicketPanel(db: Db, discord: Pick<DiscordActions, 'sendMessage' | 'editMessage'>, opts: { repost?: boolean; by?: string } = {}): Promise<boolean> {
  const c = await loadTicketConfig(db);
  if (!c.panelChannelId) return false;
  const body = ticketPanel(c);
  if (c.panelMessageId && !opts.repost) {
    try {
      await discord.editMessage(c.panelChannelId, c.panelMessageId, body);
      return true;
    } catch (err) {
      logger.warn({ err }, 'ticket panel edit failed, posting again');
    }
  }
  const { id } = await discord.sendMessage(c.panelChannelId, body);
  await saveTicketConfig(db, { ...(await loadTicketConfig(db)), panelMessageId: id }, opts.by ?? 'system');
  return true;
}

/** チャンネルの最初のメッセージ（あいさつ・答え・操作のボタン） */
export function ticketIntro(t: SupportTicket, type: TicketType, coin: string): MessageBody {
  const extra: Btn[] = [];
  if (type.kind === 'role') extra.push(button(`tk:hire:${t.id}`, '採用する（運営）', 3, '✅'));
  if (type.kind === 'request') extra.push(button(`tk:quote:${t.id}`, '値段と期限を出す（運営）', 1, '💰'));
  return {
    content: `<@${t.openerId}>${type.roleIds.length ? ' ' + type.roleIds.map((r) => `<@&${r}>`).join(' ') : ''}`,
    allowed_mentions: { users: [t.openerId], roles: type.roleIds },
    embeds: [
      {
        title: `${type.emoji} ${type.label} #${t.id}`,
        description: [
          type.greeting,
          ...(t.roleId ? ['', `🎐 希望する役職: <@&${t.roleId}>`] : []),
          ...t.answers.flatMap((x) => ['', `**${x.q}**`, x.a || '（なし）']),
          '',
          `-# 運営は「担当する」で受け持ちます。終わったら「閉じる」（やりとりは記録に残ります）${type.kind === 'request' ? `。依頼の代金（${coin}）は社務所が預かり、できあがったら担当に渡します` : ''}`,
        ].join('\n').slice(0, 4000),
        color: COLOR,
      },
    ],
    components: [row(button(`tk:claim:${t.id}`, '担当する（運営）', 1, '🙋'), button(`tk:add:${t.id}`, '人を足す', 2, '➕'), button(`tk:close:${t.id}`, '閉じる', 4, '🔒'), ...extra)],
  };
}

export class TicketApp {
  private guild?: Guild;
  private ticking = false;

  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
    private readonly discord: DiscordActions,
  ) {}

  attach(guild: Guild): void {
    this.guild = guild;
  }

  private coin(): string {
    const e = this.cfg().economy;
    return `${e.currencyEmoji}${e.currencyName}`;
  }

  private isStaff(type: TicketType | undefined, member: GuildMember | null | undefined): boolean {
    return !!member && isTicketStaff(type, [...member.roles.cache.keys()], adminRoleIdsOf(this.cfg()));
  }

  private async logChannel(c: TicketConfig): Promise<string | undefined> {
    return c.logChannelId ?? this.cfg().channels.log;
  }

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!('customId' in interaction) || !interaction.customId.startsWith('tk:')) return;
    const [, action, a, b] = interaction.customId.split(':');
    try {
      // 評価は DM のボタン（サーバーの外）
      if (action === 'rate' && interaction.isButton()) return await this.rate(interaction, Number(a), Number(b));
      if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
      if (interaction.isStringSelectMenu()) {
        if (action === 'open') return await this.choose(interaction, interaction.values[0] ?? '');
        if (action === 'role') return await this.ask(interaction, a ?? '', interaction.values[0]);
        return;
      }
      if (interaction.isUserSelectMenu()) {
        if (action === 'addsel') {
          const t = await getTicket(this.db, Number(a));
          const c = await loadTicketConfig(this.db);
          if (!t || t.status !== 'open' || !t.channelId) return void (await interaction.update({ content: 'このチケットは閉じています。', components: [] }));
          if (!this.isStaff(ticketTypeOf(c, t.typeKey), interaction.member) && interaction.user.id !== t.openerId) return void (await interaction.update({ content: '人を足せるのは、開いた人と運営だけです。', components: [] }));
          const ch = this.guild?.channels.cache.get(t.channelId);
          for (const id of interaction.values) {
            if (ch && 'permissionOverwrites' in ch) await ch.permissionOverwrites.edit(id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true }, { reason: `チケット #${t.id} に足した` }).catch((err: unknown) => logger.warn({ err }, 'ticket add member failed'));
            await addTicketMember(this.db, t.id, id);
          }
          await interaction.update({ content: `➕ ${interaction.values.map((id) => `<@${id}>`).join(' ')} さんを足しました。`, components: [] });
          if (ch?.isSendable()) await ch.send({ content: `➕ <@${interaction.user.id}> さんが ${interaction.values.map((id) => `<@${id}>`).join(' ')} さんを足しました。`, allowedMentions: { users: interaction.values } }).catch(() => undefined);
          return;
        }
        return;
      }
      if (interaction.isModalSubmit()) {
        if (action === 'modal') return await this.submit(interaction, a ?? '', b || undefined);
        if (action === 'quotemodal') return await this.quoteSubmit(interaction, Number(a));
        return;
      }
      if (!interaction.isButton()) return;
      const id = Number(a);
      if (!Number.isSafeInteger(id)) return;
      if (action === 'claim') return await this.claim(interaction, id);
      if (action === 'add') return await this.addPicker(interaction, id);
      if (action === 'close') return await this.closeButton(interaction, id);
      if (action === 'hire') return await this.hire(interaction, id);
      if (action === 'quote') return await this.quoteModal(interaction, id);
      if (action === 'pay') return await this.pay(interaction, id, Number(b));
      if (action === 'deliver') return await this.deliver(interaction, id);
    } catch (err) {
      logger.warn({ err, id: interaction.customId }, 'ticket failed');
      if (interaction.isRepliable()) {
        const content = 'うまくいきませんでした。時間をおいてもう一度お試しください。';
        await (interaction.deferred || interaction.replied ? interaction.followUp({ content, ...EPHEMERAL }) : interaction.reply({ content, ...EPHEMERAL })).catch(() => undefined);
      }
    }
  }

  // ───────── 開く ─────────

  /** 種類を選んだ: 役職の希望ならロールを選ぶ → 質問 → 開く */
  private async choose(i: StringSelectMenuInteraction<'cached'>, key: string): Promise<void> {
    const c = await loadTicketConfig(this.db);
    const t = ticketTypeOf(c, key);
    if (!t || !t.enabled) return void (await i.reply({ content: 'その種類は、いまは使えません。', ...EPHEMERAL }));
    if (t.kind === 'role') {
      const roles = t.roleChoices.map((id) => this.guild?.roles.cache.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
      if (!roles.length) return void (await i.reply({ content: '希望できる役職が、まだ決まっていません。運営に知らせてください。', ...EPHEMERAL }));
      return void (await i.reply({
        content: '🎐 希望する役職を選んでください。',
        components: [{ type: 1, components: [{ type: 3, custom_id: `tk:role:${key}`, placeholder: '希望する役職', options: roles.slice(0, 25).map((r) => ({ label: r.name.slice(0, 100), value: r.id })) }] }],
        ...EPHEMERAL,
      } as never));
    }
    await this.ask(i, key);
  }

  /** 質問の入力欄を出す（質問がなければ、すぐ開く） */
  private async ask(i: StringSelectMenuInteraction<'cached'>, key: string, roleId?: string): Promise<void> {
    const c = await loadTicketConfig(this.db);
    const t = ticketTypeOf(c, key);
    if (!t) return void (await i.reply({ content: 'その種類は、いまは使えません。', ...EPHEMERAL }));
    if (!t.questions.length) {
      await i.deferReply(EPHEMERAL);
      return void (await i.editReply(await this.create(i.member, c, t, [], roleId)));
    }
    await i.showModal(
      new ModalBuilder()
        .setCustomId(`tk:modal:${key}:${roleId ?? ''}`)
        .setTitle(`${t.emoji} ${t.label}`.slice(0, 45))
        .addComponents(
          ...t.questions.map((q, n) =>
            new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(`q${n}`).setLabel(q.label.slice(0, 45)).setStyle(q.long ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(q.required).setMaxLength(q.long ? 1000 : 200)),
          ),
        ),
    );
  }

  private async submit(i: ModalSubmitInteraction<'cached'>, key: string, roleId?: string): Promise<void> {
    await i.deferReply(EPHEMERAL);
    const c = await loadTicketConfig(this.db);
    const t = ticketTypeOf(c, key);
    if (!t) return void (await i.editReply('その種類は、いまは使えません。'));
    const answers = t.questions.map((q, n) => ({ q: q.label, a: i.fields.getTextInputValue(`q${n}`).trim() }));
    await i.editReply(await this.create(i.member, c, t, answers, roleId));
  }

  /** チケットとチャンネルを作る。返事の文 */
  private async create(member: GuildMember, c: TicketConfig, type: TicketType, answers: { q: string; a: string }[], roleId?: string): Promise<string> {
    const r = await openTicket(this.db, c, { typeKey: type.key, openerId: member.id, answers, ...(roleId ? { roleId } : {}) });
    if (r.status === 'already') return `もう開いている ${type.label} のチケットがあります: ${r.ticket.channelId ? `<#${r.ticket.channelId}>` : `#${r.ticket.id}`}`;
    if (r.status !== 'ok') return r.status === 'bad_role' ? 'その役職は希望できません。' : r.status === 'missing' ? '必要なところを入れてください。' : 'その種類は、いまは使えません。';
    const g = this.guild ?? member.guild;
    const me = g.members.me;
    const SEE = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.ReadMessageHistory | PermissionFlagsBits.AttachFiles | PermissionFlagsBits.EmbedLinks;
    const staff = [...new Set([...type.roleIds, ...adminRoleIdsOf(this.cfg())])].filter((id) => g.roles.cache.has(id));
    const parentId = type.categoryId ?? c.categoryId;
    try {
      const ch = await g.channels.create({
        name: ticketChannelName(type, r.ticket.id),
        type: ChannelType.GuildText,
        ...(parentId && g.channels.cache.get(parentId)?.type === ChannelType.GuildCategory ? { parent: parentId } : {}),
        permissionOverwrites: [
          { id: g.roles.everyone.id, type: OverwriteType.Role, deny: PermissionFlagsBits.ViewChannel },
          { id: member.id, type: OverwriteType.Member, allow: SEE },
          ...staff.map((id) => ({ id, type: OverwriteType.Role, allow: SEE })),
          ...(me ? [{ id: me.id, type: OverwriteType.Member, allow: SEE | PermissionFlagsBits.ManageChannels | PermissionFlagsBits.ManageMessages }] : []),
        ],
        reason: `チケット #${r.ticket.id}（${type.label}）`,
      });
      await setTicketChannel(this.db, r.ticket.id, ch.id);
      const intro = ticketIntro(r.ticket, type, this.coin());
      await this.discord.sendMessage(ch.id, intro);
      await audit(this.db, { actorId: member.id, action: 'ticket.open', detail: { ticketId: r.ticket.id, type: type.key }, via: 'discord' });
      return `🎫 チケットを開きました: <#${ch.id}>`;
    } catch (err) {
      logger.warn({ err }, 'ticket channel create failed');
      await dropTicket(this.db, r.ticket.id);
      return 'チャンネルを作れませんでした（BOT の「チャンネルの管理」の権限）。運営に知らせてください。';
    }
  }

  // ───────── 中の操作 ─────────

  private async ctx(i: ButtonInteraction<'cached'>, id: number) {
    const t = await getTicket(this.db, id);
    const c = await loadTicketConfig(this.db);
    const type = t ? ticketTypeOf(c, t.typeKey) : undefined;
    return { t, c, type, staff: this.isStaff(type, i.member) };
  }

  private async claim(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const { t, staff } = await this.ctx(i, id);
    if (!t || t.status !== 'open') return void (await i.reply({ content: 'このチケットは閉じています。', ...EPHEMERAL }));
    if (!staff) return void (await i.reply({ content: '担当できるのは運営だけです。', ...EPHEMERAL }));
    await claimTicket(this.db, id, i.user.id);
    await i.reply({ content: `🙋 <@${i.user.id}> さんが担当します${t.assigneeId && t.assigneeId !== i.user.id ? `（<@${t.assigneeId}> さんから引きつぎ）` : ''}。`, allowedMentions: { parse: [] } });
    await audit(this.db, { actorId: i.user.id, action: 'ticket.claim', detail: { ticketId: id }, via: 'discord' });
  }

  private async addPicker(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const { t, staff } = await this.ctx(i, id);
    if (!t || t.status !== 'open') return void (await i.reply({ content: 'このチケットは閉じています。', ...EPHEMERAL }));
    if (!staff && i.user.id !== t.openerId) return void (await i.reply({ content: '人を足せるのは、開いた人と運営だけです。', ...EPHEMERAL }));
    await i.reply({ content: '➕ 足す人を選んでください。', components: [{ type: 1, components: [{ type: 5, custom_id: `tk:addsel:${id}`, placeholder: '足す人', min_values: 1, max_values: 5 }] }], ...EPHEMERAL } as never);
  }

  private async closeButton(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const { t, staff } = await this.ctx(i, id);
    if (!t || t.status !== 'open') return void (await i.reply({ content: 'このチケットはもう閉じています。', ...EPHEMERAL }));
    if (!staff && i.user.id !== t.openerId) return void (await i.reply({ content: '閉じられるのは、開いた人と運営だけです。', ...EPHEMERAL }));
    await i.reply({ content: '🔒 閉じます。やりとりは記録に残ります。', allowedMentions: { parse: [] } });
    await this.close(t, i.user.id, staff ? 'staff' : 'opener');
  }

  /** 閉じる: やりとりを文字にして残し、チャンネルを消して、開いた人に評価を聞く */
  async close(t: SupportTicket, by: string, reason: string): Promise<boolean> {
    const c = await loadTicketConfig(this.db);
    const type = ticketTypeOf(c, t.typeKey);
    const ch = t.channelId ? this.guild?.channels.cache.get(t.channelId) : undefined;
    const lines: { at: Date; author: string; content: string; attachments: string[] }[] = [];
    if (ch?.type === ChannelType.GuildText) {
      let before: string | undefined;
      for (let page = 0; page < 10; page++) {
        const batch = await (ch as TextChannel).messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => undefined);
        if (!batch?.size) break;
        for (const m of batch.values()) lines.push({ at: m.createdAt, author: `${m.member?.displayName ?? m.author.username}（${m.author.id}）`, content: m.content || (m.embeds[0]?.description ?? ''), attachments: [...m.attachments.values()].map((x) => x.url) });
        before = batch.last()?.id;
        if (batch.size < 100) break;
      }
    }
    lines.sort((x, y) => x.at.getTime() - y.at.getTime());
    const text = transcriptText(t, type?.label ?? t.typeKey, lines);
    const done = await closeTicket(this.db, t.id, by, reason, text);
    if (!done) return false;
    const log = await this.logChannel(c);
    if (log) {
      await this.discord
        .sendMessage(log, {
          content: `🎫 チケット #${t.id}（${type?.label ?? t.typeKey}）を閉じました。開いた人: <@${t.openerId}> ・ 閉じた人: ${by === 'system' ? '自動（返事がない）' : `<@${by}>`}${t.assigneeId ? ` ・ 担当: <@${t.assigneeId}>` : ''}${done.refunded ? ` ・ 預かっていた ${fmt(done.refunded)} 枚を戻しました` : ''}`,
          allowed_mentions: { parse: [] },
          files: [{ name: `ticket-${t.id}.txt`, contentType: 'text/plain; charset=utf-8', data: new TextEncoder().encode(text) }],
        })
        .catch((err: unknown) => logger.warn({ err }, 'ticket transcript post failed'));
    }
    await audit(this.db, { actorId: by, targetId: t.openerId, action: 'ticket.close', detail: { ticketId: t.id, reason, refunded: done.refunded }, via: 'discord' });
    if (ch) setTimeout(() => void ch.delete(`チケット #${t.id} を閉じた`).catch((err: unknown) => logger.warn({ err }, 'ticket channel delete failed')), 5_000);
    // 開いた人に評価を聞く（DM が閉じていれば聞かない）
    await this.guild?.client.users
      .fetch(t.openerId)
      .then((u) =>
        u.send({
          content: `🎫 チケット #${t.id}（${type?.label ?? ''}）を閉じました。${done.refunded ? `預かっていた ${fmt(done.refunded)} 枚はお戻ししました。` : ''}\n対応はいかがでしたか？（⭐ を押してください）`,
          components: [row(...[1, 2, 3, 4, 5].map((n) => button(`tk:rate:${t.id}:${n}`, '⭐'.repeat(n))))],
        }),
      )
      .catch(() => undefined);
    return true;
  }

  private async rate(i: ButtonInteraction, id: number, stars: number): Promise<void> {
    const ok = await rateTicket(this.db, id, i.user.id, stars);
    await i.update({ content: ok ? `${'⭐'.repeat(stars)} ありがとうございました。` : 'もう評価しています。', components: [] }).catch(() => undefined);
  }

  // ───────── 役職の希望: 採用 ─────────

  private async hire(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const { t, staff } = await this.ctx(i, id);
    if (!t || t.status !== 'open' || !t.roleId) return void (await i.reply({ content: 'このチケットでは採用できません。', ...EPHEMERAL }));
    if (!staff) return void (await i.reply({ content: '採用できるのは運営だけです。', ...EPHEMERAL }));
    await i.deferReply();
    try {
      await this.discord.addRole(this.cfg().guildId, t.openerId, t.roleId, `チケット #${id} で採用（${i.user.username}）`);
    } catch (err) {
      logger.warn({ err }, 'ticket hire role failed');
      return void (await i.editReply('ロールを付けられませんでした（BOT のロールの位置と「ロールの管理」の権限を確かめてください）。'));
    }
    await markHired(this.db, id, i.user.id);
    await audit(this.db, { actorId: i.user.id, targetId: t.openerId, action: 'ticket.hire', detail: { ticketId: id, roleId: t.roleId }, via: 'discord' });
    await i.editReply({ content: `✅ <@${t.openerId}> さんを採用しました（<@&${t.roleId}> を付けました）。おめでとうございます！`, allowedMentions: { users: [t.openerId] } });
  }

  // ───────── 依頼: 見積もり・払う・納品 ─────────

  private async quoteModal(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const { t, staff } = await this.ctx(i, id);
    if (!t || t.status !== 'open') return void (await i.reply({ content: 'このチケットは閉じています。', ...EPHEMERAL }));
    if (!staff) return void (await i.reply({ content: '値段を出せるのは運営だけです。', ...EPHEMERAL }));
    if (t.escrow > 0 || t.paidTo) return void (await i.reply({ content: 'もう払ってもらったので、値段は変えられません。', ...EPHEMERAL }));
    await i.showModal(
      new ModalBuilder()
        .setCustomId(`tk:quotemodal:${id}`)
        .setTitle('💰 値段と期限を出す')
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('price').setLabel('値段（銭）').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(9).setPlaceholder('1000')),
          new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('deadline').setLabel('期限（例: 10/20 まで・1 週間）').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(40)),
        ),
    );
  }

  private async quoteSubmit(i: ModalSubmitInteraction<'cached'>, id: number): Promise<void> {
    const t = await getTicket(this.db, id);
    const c = await loadTicketConfig(this.db);
    if (!t || !this.isStaff(ticketTypeOf(c, t.typeKey), i.member)) return void (await i.reply({ content: '値段を出せるのは運営だけです。', ...EPHEMERAL }));
    const raw = i.fields.getTextInputValue('price').replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).replace(/[,，\s枚銭]/g, '');
    const price = /^\d+$/.test(raw) ? Number(raw) : NaN;
    const deadline = i.fields.getTextInputValue('deadline').trim();
    const row1 = await setQuote(this.db, id, i.user.id, price, deadline);
    if (!row1) return void (await i.reply({ content: '値段は 1 以上の数で入れてください（もう払ってもらっていれば変えられません）。', ...EPHEMERAL }));
    await audit(this.db, { actorId: i.user.id, targetId: t.openerId, action: 'ticket.quote', detail: { ticketId: id, price, deadline }, via: 'discord' });
    await i.reply({
      content: `💰 <@${t.openerId}> さん、**${this.coin()} ${fmt(price)} 枚**・期限 **${deadline}** でお受けできます。よければ「払う」を押してください（社務所が預かり、できあがったら担当に渡します。できあがる前に閉じたら全額戻ります）。`,
      components: [row(button(`tk:pay:${id}:${price}`, `${fmt(price)} 枚を払う（開いた人）`, 3, '💰'))],
      allowedMentions: { users: [t.openerId] },
    });
  }

  private async pay(i: ButtonInteraction<'cached'>, id: number, price: number): Promise<void> {
    await i.deferReply(EPHEMERAL);
    const r = await payQuote(this.db, id, i.user.id, price);
    if (r.status === 'not_opener') return void (await i.editReply('払えるのは、チケットを開いた人だけです。'));
    if (r.status === 'paid') return void (await i.editReply('もう払っています。'));
    if (r.status === 'no_quote') return void (await i.editReply('この値段は古くなりました。新しい値段のボタンを押してください。'));
    if (r.status === 'insufficient') return void (await i.editReply(`銭が足りません（${fmt(r.price)} 枚・いま ${fmt(r.balance)} 枚）。`));
    if (r.status !== 'ok') return;
    await audit(this.db, { actorId: i.user.id, action: 'ticket.pay', detail: { ticketId: id, price }, via: 'discord' });
    await i.editReply(`💰 ${fmt(price)} 枚を払いました（残り ${fmt(r.balance)} 枚）。できあがるまで社務所が預かります。`);
    const ch = i.channel;
    if (ch?.isSendable()) await ch.send({ content: `💰 <@${i.user.id}> さんが ${fmt(price)} 枚を払いました（社務所が預かり中）。できあがったら、運営が「納品した」を押してください。`, components: [row(button(`tk:deliver:${id}`, '納品した（運営）', 3, '📦'))], allowedMentions: { parse: [] } } as never);
  }

  private async deliver(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const { staff } = await this.ctx(i, id);
    if (!staff) return void (await i.reply({ content: '納品にできるのは運営だけです。', ...EPHEMERAL }));
    const r = await deliverTicket(this.db, id);
    if (!r) return void (await i.reply({ content: 'もう渡したか、預かっている銭がありません（担当を決めてから押してください）。', ...EPHEMERAL }));
    await audit(this.db, { actorId: i.user.id, targetId: r.to, action: 'ticket.deliver', detail: { ticketId: id, amount: r.amount }, via: 'discord' });
    await i.reply({ content: `📦 納品しました。預かっていた ${fmt(r.amount)} 枚を <@${r.to}> さんに渡しました。`, allowedMentions: { parse: [] } });
  }

  // ───────── 話した時刻・1 分ごと ─────────

  /** チケットのチャンネルで話したら、運営か開いた人かを記録（放置の知らせ・自動で閉じるため） */
  async onMessage(m: Message): Promise<void> {
    if (m.author.bot || !m.inGuild() || m.guildId !== this.cfg().guildId) return;
    const t = await ticketByChannel(this.db, m.channelId);
    if (!t) return;
    const c = await loadTicketConfig(this.db);
    await touchTicket(this.db, t.id, this.isStaff(ticketTypeOf(c, t.typeKey), m.member) && m.author.id !== t.openerId ? 'staff' : 'user');
  }

  async tick(now = new Date()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const c = await loadTicketConfig(this.db);
      const r = await ticketTick(this.db, c, now);
      const log = await this.logChannel(c);
      for (const t of r.stale) {
        const type = ticketTypeOf(c, t.typeKey);
        if (log) await this.discord.sendMessage(log, { content: `⏰ チケット #${t.id}（${type?.label ?? t.typeKey}）に、${c.staleHours} 時間返事がありません: <#${t.channelId}>${t.assigneeId ? ` ・ 担当: <@${t.assigneeId}>` : ' ・ 担当なし'}`, allowed_mentions: { parse: [] } }).catch(() => undefined);
      }
      for (const t of r.idleWarn) {
        if (t.channelId) await this.discord.sendMessage(t.channelId, { content: `<@${t.openerId}> さん、まだご用はありますか？ 24 時間お返事がなければ、このチケットは自動で閉じます。`, allowed_mentions: { users: [t.openerId] } }).catch(() => undefined);
      }
      for (const t of r.idleClose) await this.close(t, 'system', 'idle').catch((err: unknown) => logger.warn({ err }, 'ticket auto close failed'));
    } finally {
      this.ticking = false;
    }
  }
}

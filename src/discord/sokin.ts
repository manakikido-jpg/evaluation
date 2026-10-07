import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type ModalSubmitInteraction,
  type UserSelectMenuInteraction,
} from 'discord.js';
import type { EconomyConfig, GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { giftBlockedRank } from '../domain/ranks.js';
import { logger } from '../lib/logger.js';
import { audit } from '../services/audit.js';
import { walletOf } from '../services/economy.js';
import { giftDailyLimitOf, giftSentToday, giveGift, type GiftResult } from '../services/shop.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
/** パネルを開いたままにできる時間（さわるたびに延びる） */
const PENDING_MS = 10 * 60_000;
const COLOR = 0x3ba55d;
const fmt = (n: number) => n.toLocaleString('ja-JP');
const btn = (custom_id: string, label: string, style: 1 | 2 | 3 | 4 = 2, disabled = false) => ({ type: 2 as const, style, label, custom_id, disabled });
const row = (...components: unknown[]) => ({ type: 1 as const, components });

/** 送る中身（パネルの今の選び） */
export type SokinDraft = { toId?: string; toName?: string; amount?: number; note: string };
type Pending = SokinDraft & { by: string; at: number };

/** すぐ選べる枚数（1 回の下限〜上限の中だけ） */
export const SOKIN_PRESETS = [10, 50, 100, 500, 1000];

/** 「1,000」「１０００枚」なども数にする（読めなければ NaN） */
export function parseAmount(s: string): number {
  const t = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[,，\s枚]/g, '');
  return /^\d+$/.test(t) ? Number(t) : NaN;
}

/** 送れないわけ（なければ undefined）。パネルの「送る」を押せるかどうか */
export function sokinBlocker(e: EconomyConfig, d: SokinDraft, info: { balance: number; left: number }): string | undefined {
  if (!d.toId) return '相手を選んでください';
  if (!d.amount) return '枚数を選んでください';
  if (d.amount < e.giftMin || d.amount > e.giftMax) return `${fmt(e.giftMin)}〜${fmt(e.giftMax)} 枚の間で選んでください`;
  if (d.amount > info.left) return `今日送れるのは、あと ${fmt(info.left)} 枚までです`;
  if (d.amount > info.balance) return `${e.currencyName}が足りません（いま ${fmt(info.balance)} 枚）`;
  return undefined;
}

/** 💸 送金のパネル（本人にだけ）。相手・枚数・ひとことを選んで「送る」 */
export function sokinPanel(e: EconomyConfig, d: SokinDraft, info: { balance: number; left: number }, nonce: string, note = '') {
  const coin = `${e.currencyEmoji}${e.currencyName}`;
  const blocker = sokinBlocker(e, d, info);
  const presets = SOKIN_PRESETS.filter((n) => n >= e.giftMin && n <= e.giftMax);
  const can = Math.min(info.balance, info.left);
  return {
    content: note,
    embeds: [
      {
        title: '💸 送金',
        description: [
          `相手: ${d.toName ? `**${d.toName}** さん` : '（下で選ぶ）'}`,
          `枚数: ${d.amount ? `${coin} **${fmt(d.amount)} 枚**` : '（下で選ぶ）'}`,
          `ひとこと: ${d.note ? d.note.replace(/\n/g, ' ') : 'なし'}`,
          '',
          ...(d.toId && d.amount && blocker ? [`⚠ ${blocker}`, ''] : []),
          `-# いま ${fmt(info.balance)} 枚・今日あと ${fmt(info.left)} 枚送れます（1 回 ${fmt(e.giftMin)}〜${fmt(e.giftMax)} 枚）`,
          '-# 送ったら取り消せません。相手には DM で知らせます',
        ].join('\n'),
        color: COLOR,
      },
    ],
    components: [
      row({ type: 5, custom_id: `sokin:to:${nonce}`, placeholder: '送る相手を選ぶ', ...(d.toId ? { default_values: [{ id: d.toId, type: 'user' }] } : {}) }),
      ...(presets.length ? [row(...presets.map((n) => btn(`sokin:amt:${nonce}:${n}`, `${fmt(n)} 枚`, d.amount === n ? 1 : 2, n > can)))] : []),
      row(btn(`sokin:amtm:${nonce}`, '✏ 枚数を入れる'), btn(`sokin:notem:${nonce}`, d.note ? '💬 ひとことを直す' : '💬 ひとことを添える')),
      row(
        btn(`sokin:send:${nonce}`, blocker ? '💸 送る' : `💸 ${d.toName} さんに ${fmt(d.amount!)} 枚送る`.slice(0, 80), 3, Boolean(blocker)),
        btn(`sokin:cancel:${nonce}`, 'やめる'),
      ),
    ],
  };
}

/** 送ったあとの文（本人にだけ） */
export function sokinResultText(e: EconomyConfig, r: GiftResult, toId: string, amount: number): string {
  switch (r.status) {
    case 'ok':
      return `💸 <@${toId}> さんに ${e.currencyEmoji}${e.currencyName} ${fmt(amount)} 枚を送りました。残り ${fmt(r.balance)} 枚。`;
    case 'self':
      return '自分には送れません。';
    case 'rank_too_low':
      return `送金は「${r.rankName}」以上になるとできます。`;
    case 'bad_amount':
      return `${fmt(r.min)}〜${fmt(r.max)} 枚の間で送ってください。`;
    case 'daily_limit':
      return `今日送れるのは、あと ${fmt(r.left)} 枚までです（日本時間の 0 時に戻ります。授与所の「🎁 贈り物」と合わせて数えます）。`;
    case 'insufficient':
      return `${e.currencyName}が足りません（いま ${fmt(r.balance)} 枚）。`;
  }
}

/** 送ったあとの画面（「続けて送る」で新しいパネル） */
export function sokinDone(text: string) {
  return { content: text, embeds: [], components: [row(btn('sokin:new', '💸 続けて送る', 1))] };
}

/** 相手に届く DM */
export function sokinDm(e: EconomyConfig, fromName: string, amount: number, note: string): string {
  return [`💸 **${fromName}** さんから ${e.currencyEmoji}${e.currencyName} **${fmt(amount)} 枚**が届きました（咲楽ノ宮）。`, ...(note ? [`> ${note.replace(/\n/g, ' ')}`] : []), '-# 残りは `/残高` で見られます'].join('\n');
}

const EXPIRED = { content: '時間が経ったので、もう一度 `/送金` から開いてください。', embeds: [], components: [] };

/**
 * 💸 /送金: 本人にだけ出るパネルで、相手・枚数・ひとことを選んで銭を送る（/送金 相手 枚数 で、はじめから入れておける）。
 * 決まりは授与所の「🎁 贈り物」と同じ（giveGift。役職・1 回の枚数・1 日の合計の上限）。
 * 「送る」は 1 回しか効かない（同時に押しても 1 回だけ送る）。相手には DM で知らせる
 */
export class SokinApp {
  private readonly pending = new Map<string, Pending>();
  /** 送り終わったパネル（あとから届いた二度押しで、結果の画面を消さないように） */
  private readonly used = new Map<string, number>();

  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
  ) {}

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    try {
      if (interaction.isChatInputCommand() && interaction.commandName === 'sokin') return await this.open(interaction);
      const id = 'customId' in interaction ? interaction.customId : '';
      if (!id.startsWith('sokin:')) return;
      const [, action, nonce, arg] = id.split(':');
      if (interaction.isButton() && action === 'new') return await this.open(interaction);
      const p = nonce ? this.pending.get(nonce) : undefined;
      if (action === 'cancel' && interaction.isButton()) {
        if (p?.by === interaction.user.id) this.pending.delete(nonce!);
        return void (await interaction.update({ content: 'やめました。', embeds: [], components: [] }));
      }
      if (!p && nonce && this.used.has(nonce)) {
        if (interaction.isButton() || interaction.isUserSelectMenu()) await interaction.deferUpdate();
        return;
      }
      if (!p || Date.now() - p.at > PENDING_MS || p.by !== interaction.user.id) {
        if (nonce) this.pending.delete(nonce);
        if (interaction.isButton() || interaction.isUserSelectMenu()) return void (await interaction.update(EXPIRED));
        if (interaction.isModalSubmit() && interaction.isFromMessage()) return void (await interaction.update(EXPIRED));
        return;
      }
      p.at = Date.now();
      if (interaction.isUserSelectMenu() && action === 'to') return await this.pickTo(interaction, nonce!, p);
      if (interaction.isButton() && action === 'amt') {
        p.amount = Number(arg);
        return await this.show(interaction, nonce!, p);
      }
      if (interaction.isButton() && action === 'amtm') return await this.amountModal(interaction, nonce!, p);
      if (interaction.isButton() && action === 'notem') return await this.noteModal(interaction, nonce!, p);
      if (interaction.isModalSubmit() && action === 'amtm') {
        const n = parseAmount(interaction.fields.getTextInputValue('amount'));
        if (Number.isInteger(n) && n > 0) p.amount = n;
        return await this.show(interaction, nonce!, p, Number.isInteger(n) && n > 0 ? '' : '枚数は数字で入れてください。');
      }
      if (interaction.isModalSubmit() && action === 'notem') {
        p.note = interaction.fields.getTextInputValue('note').trim().slice(0, 200);
        return await this.show(interaction, nonce!, p);
      }
      if (interaction.isButton() && action === 'send') return await this.send(interaction, nonce!, p);
    } catch (err) {
      logger.error({ err }, 'sokin failed');
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'うまくいきませんでした。時間をおいてもう一度お試しください。', ...EPHEMERAL }).catch(() => undefined);
      }
    }
  }

  private async info(userId: string, roleIds: readonly string[]) {
    const cfg = this.cfg();
    const [w, sent] = await Promise.all([walletOf(this.db, userId), giftSentToday(this.db, userId)]);
    return { balance: w.balance, left: Math.max(0, giftDailyLimitOf(cfg, roleIds) - sent) };
  }

  /** パネルを開く（/送金・「続けて送る」） */
  private async open(i: ChatInputCommandInteraction<'cached'> | ButtonInteraction<'cached'>): Promise<void> {
    const cfg = this.cfg();
    const need = giftBlockedRank(cfg.ranks, [...i.member.roles.cache.keys()]);
    if (need) {
      const body = { content: `送金は「${need.name}」以上になるとできます。`, embeds: [], components: [] };
      return void (await (i.isButton() ? i.update(body) : i.reply({ ...body, ...EPHEMERAL })));
    }
    const d: Pending = { note: '', by: i.user.id, at: Date.now() };
    let note = '';
    if (i.isChatInputCommand()) {
      const toUser = i.options.getUser('user');
      const to = i.options.getMember('user');
      if (toUser) {
        const bad = this.badTarget(i.user.id, toUser.id, Boolean(to), toUser.bot);
        if (bad) note = bad;
        else Object.assign(d, { toId: toUser.id, toName: to!.displayName });
      }
      const amount = i.options.getInteger('amount');
      if (amount) d.amount = amount;
      d.note = (i.options.getString('message') ?? '').trim().slice(0, 200);
    }
    const nonce = randomUUID();
    for (const [k, p] of this.pending) if (Date.now() - p.at > PENDING_MS) this.pending.delete(k);
    this.pending.set(nonce, d);
    const view = sokinPanel(cfg.economy, d, await this.info(i.user.id, [...i.member.roles.cache.keys()]), nonce, note);
    if (i.isButton()) await i.update({ ...view, allowedMentions: { parse: [] } } as never);
    else await i.reply({ ...view, allowedMentions: { parse: [] }, ...EPHEMERAL } as never);
  }

  private badTarget(byId: string, toId: string, member: boolean, bot: boolean): string | undefined {
    if (toId === byId) return '自分には送れません。';
    if (!member || bot) return '送れるのは、この鯖にいる人だけです（BOT には送れません）。';
    return undefined;
  }

  private async show(i: ButtonInteraction<'cached'> | UserSelectMenuInteraction<'cached'> | ModalSubmitInteraction<'cached'>, nonce: string, d: Pending, note = ''): Promise<void> {
    const view = { ...sokinPanel(this.cfg().economy, d, await this.info(i.user.id, [...i.member.roles.cache.keys()]), nonce, note), allowedMentions: { parse: [] } } as never;
    if (i.isModalSubmit()) {
      if (i.isFromMessage()) await i.update(view);
      return;
    }
    await i.update(view);
  }

  private async pickTo(i: UserSelectMenuInteraction<'cached'>, nonce: string, d: Pending): Promise<void> {
    const toId = i.values[0] ?? '';
    const to = i.members.get(toId);
    const bad = this.badTarget(i.user.id, toId, Boolean(to), Boolean(i.users.get(toId)?.bot));
    if (bad) {
      delete d.toId;
      delete d.toName;
      return await this.show(i, nonce, d, bad);
    }
    d.toId = toId;
    d.toName = to!.displayName;
    await this.show(i, nonce, d);
  }

  private async amountModal(i: ButtonInteraction<'cached'>, nonce: string, d: Pending): Promise<void> {
    const e = this.cfg().economy;
    const input = new TextInputBuilder()
      .setCustomId('amount')
      .setLabel(`枚数（${fmt(e.giftMin)}〜${fmt(e.giftMax)}）`)
      .setPlaceholder('例: 300')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(10);
    if (d.amount) input.setValue(String(d.amount));
    await i.showModal(new ModalBuilder().setCustomId(`sokin:amtm:${nonce}`).setTitle('💸 何枚送る？').addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input)));
  }

  private async noteModal(i: ButtonInteraction<'cached'>, nonce: string, d: Pending): Promise<void> {
    const input = new TextInputBuilder()
      .setCustomId('note')
      .setLabel('相手への DM に添える（空にすると、なし）')
      .setPlaceholder('例: この前のお礼です')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(200);
    if (d.note) input.setValue(d.note);
    await i.showModal(new ModalBuilder().setCustomId(`sokin:notem:${nonce}`).setTitle('💬 ひとこと').addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input)));
  }

  private async send(i: ButtonInteraction<'cached'>, nonce: string, d: Pending): Promise<void> {
    if (!d.toId || !d.amount) return await this.show(i, nonce, d);
    // 先に消す（二度押し・同時押しでも 1 回だけ送る）
    this.pending.delete(nonce);
    for (const [k, at] of this.used) if (Date.now() - at > PENDING_MS) this.used.delete(k);
    this.used.set(nonce, Date.now());
    const cfg = this.cfg();
    const { toId, amount, note } = d;
    const r = await giveGift(this.db, cfg, { id: i.user.id, roleIds: [...i.member.roles.cache.keys()] }, toId, amount);
    let text = sokinResultText(cfg.economy, r, toId, amount);
    if (r.status !== 'ok') {
      // 送れなかったら、パネルに戻して選び直せるように
      this.used.delete(nonce);
      this.pending.set(nonce, { ...d, at: Date.now() });
      return await this.show(i, nonce, d, text);
    }
    await audit(this.db, { actorId: i.user.id, targetId: toId, action: 'coins.send', detail: { amount, note: note || undefined }, via: 'discord' });
    const dm = await i.client.users
      .send(toId, sokinDm(cfg.economy, i.member.displayName, amount, note))
      .then(() => true)
      .catch(() => false);
    if (!dm) text += '\n-# 相手が DM を受け取らない設定のため、知らせは届いていません';
    await i.update({ ...sokinDone(text), allowedMentions: { parse: [] } } as never);
  }
}

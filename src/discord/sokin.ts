import { controlAccess, parseControlId } from './controlPanel.js';
import { ActionRowBuilder, UserSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, type Interaction } from 'discord.js';
import type { EconomyConfig, GuildConfig } from '../config.js';
import type { DirectTransfer } from '../db/schema.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { prepareTransfer, confirmTransfer, cancelTransfer, ownedTransfer, TransferError } from '../services/directTransfers.js';
import type { Db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { giftCost, giftFee, type GiftResult } from '../services/shop.js';

/** 旧20％パネルの互換表示用。新規送金では使わない。
 * 送れる量（staff: 運営は手数料・1 回の最高・1 日の上限なし） */
export type SokinInfo = { balance: number; left: number; staff?: boolean };

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const COLOR = 0x3ba55d;
const fmt = (n: number) => n.toLocaleString('ja-JP');
const btn = (custom_id: string, label: string, style: 1 | 2 | 3 | 4 = 2, disabled = false) => ({ type: 2 as const, style, label, custom_id, disabled });
const row = (...components: unknown[]) => ({ type: 1 as const, components });

/** 送る中身（パネルの今の選び） */
export type SokinDraft = { toId?: string; toName?: string; amount?: number; note: string };

/** すぐ選べる枚数（1 回の下限〜上限の中だけ） */
export const SOKIN_PRESETS = [10, 50, 100, 500, 1000];

/** 「1,000」「１０００枚」なども数にする（読めなければ NaN） */
export function parseAmount(s: string): number {
  const t = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[,，\s枚]/g, '');
  return /^\d+$/.test(t) ? Number(t) : NaN;
}

/** 送れないわけ（なければ undefined）。パネルの「送る」を押せるかどうか */
export function sokinBlocker(e: EconomyConfig, d: SokinDraft, info: SokinInfo): string | undefined {
  if (!d.toId) return '相手を選んでください';
  if (!d.amount) return '枚数を選んでください';
  if (d.amount < e.giftMin || (!info.staff && d.amount > e.giftMax)) return `${fmt(e.giftMin)}〜${fmt(e.giftMax)} 枚の間で選んでください`;
  if (!info.staff && d.amount > info.left) return `今日送れるのは、あと ${fmt(info.left)} 枚までです`;
  if (giftCost(d.amount, info.staff) > info.balance) return `${e.currencyName}が足りません（いま ${fmt(info.balance)} 枚）`;
  return undefined;
}

/** 💸 送金のパネル（本人にだけ）。相手・枚数・ひとことを選んで「送る」 */
export function sokinPanel(e: EconomyConfig, d: SokinDraft, info: SokinInfo, nonce: string, note = '') {
  const coin = `${e.currencyEmoji}${e.currencyName}`;
  const blocker = sokinBlocker(e, d, info);
  const presets = SOKIN_PRESETS.filter((n) => n >= e.giftMin && (info.staff || n <= e.giftMax));
  const can = info.staff ? Infinity : info.left;
  return {
    content: note,
    embeds: [
      {
        title: '💸 送金',
        description: [
          `相手: ${d.toName ? `**${d.toName}** さん` : '（下で選ぶ）'}`,
          `枚数: ${d.amount ? `${coin} **${fmt(d.amount)} 枚**` : '（下で選ぶ）'}`,
          ...(info.staff
            ? ['運営なので、手数料はかかりません']
            : d.amount
              ? [`手数料（20%）: ${fmt(giftFee(d.amount))} 枚・合計支払い: **${fmt(giftCost(d.amount))} 枚**`]
              : ['手数料20%は送る人が追加で払います']),
          `ひとこと: ${d.note ? d.note.replace(/\n/g, ' ') : 'なし'}`,
          '',
          ...(d.toId && d.amount && blocker ? [`⚠ ${blocker}`, ''] : []),
          info.staff
            ? `-# いま ${fmt(info.balance)} 枚（運営は 1 回・1 日の上限なし）`
            : `-# いま ${fmt(info.balance)} 枚・今日あと ${fmt(info.left)} 枚送れます（1 回 ${fmt(e.giftMin)}〜${fmt(e.giftMax)} 枚）`,
          '-# 送ったら取り消せません。相手には DM で知らせます',
        ].join('\n'),
        color: COLOR,
      },
    ],
    components: [
      row({ type: 5, custom_id: `sokin:to:${nonce}`, placeholder: '送る相手を選ぶ', ...(d.toId ? { default_values: [{ id: d.toId, type: 'user' }] } : {}) }),
      ...(presets.length ? [row(...presets.map((n) => btn(`sokin:amt:${nonce}:${n}`, `${fmt(n)} 枚`, d.amount === n ? 1 : 2, n > can || giftCost(n, info.staff) > info.balance)))] : []),
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
      return `💸 <@${toId}> さんに ${e.currencyEmoji}${e.currencyName} ${fmt(amount)} 枚を送りました。手数料 ${fmt(r.fee)} 枚（合計 ${fmt(amount + r.fee)} 枚）。残り ${fmt(r.balance)} 枚。`;
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

/** 直接送金の確認。手数料は相手に入る額とは別に上乗せする。 */
export function directTransferConfirm(e: EconomyConfig, t: DirectTransfer) {
  return { content: '', embeds: [{ title: '💸 送金の確認', color: COLOR,
    description: [`相手：<@${t.toId}>`, `相手の受取額：**${fmt(t.amount)} ${e.currencyName}**`, t.fee === 0 ? '手数料：**なし**（運営のため免除）' : `手数料（50％）：**${fmt(t.fee)} ${e.currencyName}**`, `あなたの支払総額：**${fmt(t.total)} ${e.currencyName}**`,
      ...(t.note ? [`ひとこと：${t.note}`] : []), '', '手数料は運営回収です。相手には受取額だけが入ります。', '確認は10分間有効です。送った後は取り消せません。'].join('\n') }],
    components: [row(btn(`sokin:confirm:${t.id}`, `合計${fmt(t.total)}銭を払って送る`, 3), btn(`sokin:cancel:${t.id}`, 'やめる'))], allowedMentions: { parse: [] as string[] } };
}

/** /送金の確認・確定。古い20％のボタンからは送金しない。 */
export class SokinApp {
  constructor(private readonly db: Db, private readonly cfg: () => GuildConfig, private readonly discord?: Pick<DiscordActions, 'sendDm'>) {}
  async onInteraction(i: Interaction): Promise<void> {
    if (!i.inCachedGuild() || i.guildId !== this.cfg().guildId) return;
    const command = i.isChatInputCommand() && i.commandName === 'sokin';
    const control = !command && i.isButton() ? parseControlId(i.customId) : undefined;
    const panel = ('customId' in i && i.customId.startsWith('sokin:')) || control?.action === 'send';
    if ((!command && !panel) || !i.isRepliable()) return;
    let committed: { transfer: DirectTransfer; balance: number } | undefined;
    try {
      if (control?.action === 'send' && i.isButton()) {
        const blocked = controlAccess(i, control);
        if (blocked) return void await i.reply({ content: blocked, ...EPHEMERAL });
        return void await i.reply({ content: '💰 送金する相手を選んでください。金額を入力した後、手数料込みの確認画面が出ます。',
          components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(new UserSelectMenuBuilder()
            .setCustomId(`sokin:recipient:${i.user.id}`).setPlaceholder('送金する相手').setMinValues(1).setMaxValues(1))],
          allowedMentions: { parse: [] }, ...EPHEMERAL });
      }
      if ('customId' in i && i.customId.startsWith('sokin:recipient:') && i.isUserSelectMenu()) {
        if (i.customId !== `sokin:recipient:${i.user.id}`) return void await i.reply({ content: 'この操作は、開いた本人だけが使えます。', ...EPHEMERAL });
        const target = i.values[0];
        if (!target || !/^\d{17,20}$/.test(target) || target === i.user.id) return void await i.reply({ content: '自分以外の相手を選んでください。', ...EPHEMERAL });
        return void await i.showModal(new ModalBuilder().setCustomId(`sokin:draft:${i.user.id}:${target}`).setTitle('送金する金額')
          .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('amount')
            .setLabel('相手が受け取る金額（銭）').setPlaceholder('例：1000').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20)),
          new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('note').setLabel('ひとこと（任意）')
            .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(200))));
      }
      if ('customId' in i && i.customId.startsWith('sokin:draft:') && i.isModalSubmit()) {
        const parts = i.customId.split(':');
        const targetId = parts[3];
        if (parts.length !== 4 || parts[2] !== i.user.id || !/^\d{17,20}$/.test(targetId ?? '')) return void await i.reply({ content: 'パネルを開き直してください。', ...EPHEMERAL });
        await i.deferReply(EPHEMERAL);
        const [sender, target] = await Promise.all([i.guild.members.fetch({ user: i.user.id, force: true }), i.guild.members.fetch({ user: targetId!, force: true })]);
        const t = await prepareTransfer(this.db, this.cfg(), { id: i.id,
          from: { id: sender.id, roleIds: [...sender.roles.cache.keys()], bot: sender.user.bot },
          to: { id: target.id, roleIds: [...target.roles.cache.keys()], bot: target.user.bot },
          amount: parseAmount(i.fields.getTextInputValue('amount')), note: i.fields.getTextInputValue('note') });
        if (t.status !== 'pending') return void await i.editReply({ content: 'この確認は終了しています。パネルを開き直してください。', components: [] });
        return void await i.editReply(directTransferConfirm(this.cfg().economy, t) as never);
      }
      if (command && i.isChatInputCommand()) {
        await i.deferReply(EPHEMERAL);
        const user = i.options.getUser('user');
        const amount = i.options.getInteger('amount');
        if (!user || amount === null) return void await i.editReply('相手と金額を指定して、/送金を開き直してください。');
        const [sender, target] = await Promise.all([i.guild.members.fetch({ user: i.user.id, force: true }), i.guild.members.fetch({ user: user.id, force: true })]);
        const t = await prepareTransfer(this.db, this.cfg(), { id: i.id,
          from: { id: sender.id, roleIds: [...sender.roles.cache.keys()], bot: sender.user.bot },
          to: { id: target.id, roleIds: [...target.roles.cache.keys()], bot: target.user.bot }, amount, note: i.options.getString('note') ?? '' });
        if (t.status !== 'pending') return void await i.editReply({ content: 'この送金の確認はすでに終了しています。新しく送る場合は/送金を使ってください。', components: [] });
        return void await i.editReply(directTransferConfirm(this.cfg().economy, t) as never);
      }
      if (!i.isButton()) return void await i.reply({ content: '送金の方法が変わりました。相手と金額を指定して、/送金を開き直してください。', ...EPHEMERAL });
      const [, action, id] = i.customId.split(':');
      if (!id || !['confirm', 'cancel'].includes(action ?? '')) return void await i.reply({ content: '送金の方法が変わりました。/送金で相手と金額を指定してください（手数料50％）。', ...EPHEMERAL });
      const t = await ownedTransfer(this.db, id, i.user.id);
      if (!t) return void await i.reply({ content: 'この確認を操作できるのは、送る本人だけです。', ...EPHEMERAL });
      await i.deferUpdate();
      if (action === 'cancel') {
        await cancelTransfer(this.db, id, i.user.id);
        return void await i.editReply({ content: '送金をやめました。銭は引いていません。', embeds: [], components: [] });
      }
      const sender = await i.guild.members.fetch({ user: i.user.id, force: true });
      const target = t.status === 'sent' ? undefined : await i.guild.members.fetch({ user: t.toId, force: true });
      const r = await confirmTransfer(this.db, this.cfg(), id,
        { id: sender.id, roleIds: [...sender.roles.cache.keys()], bot: sender.user.bot },
        { id: t.toId, roleIds: target ? [...target.roles.cache.keys()] : [], bot: target?.user.bot });
      committed = r;
      let notice = '';
      if (!r.repeated && this.discord) {
        try { if (!await this.discord.sendDm(t.toId, sokinDm(this.cfg().economy, sender.displayName, t.amount, t.note))) notice = '\n相手へのDMは届きませんでした。送金は完了しています。'; }
        catch { notice = '\n相手へのDMは届きませんでした。送金は完了しています。'; }
      }
      await i.editReply({ content: `${r.repeated ? 'この確認の送金はすでに完了しています。追加の支払いはありません。\n' : ''}<@${t.toId}> さんへ${fmt(t.amount)}銭を送りました。手数料${fmt(t.fee)}銭、支払総額${fmt(t.total)}銭。現在の残高${fmt(r.balance)}銭。${notice}`, embeds: [], components: [], allowedMentions: { parse: [] } });
    } catch (err) {
      if (!(err instanceof TransferError)) logger.warn({ err }, 'direct transfer failed');
      const content = committed
        ? `送金は確定しています。<@${committed.transfer.toId}> さんの受取額${fmt(committed.transfer.amount)}銭・手数料${fmt(committed.transfer.fee)}銭・支払総額${fmt(committed.transfer.total)}銭です。追加の支払いはありません。`
        : err instanceof TransferError ? err.message
        : command ? '確認画面を作れませんでした。相手と金額を確認して、/送金をやり直してください。この段階では銭を引いていません。'
        : '送金の結果を確認できませんでした。同じ確認からもう一度お試しください。二重の支払いは防いでいます。';
      if (i.deferred || i.replied) await i.editReply({ content, allowedMentions: { parse: [] } }).catch(() => undefined);
      else await i.reply({ content, ...EPHEMERAL }).catch(() => undefined);
    }
  }
}

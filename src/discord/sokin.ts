import { MessageFlags, type Interaction } from 'discord.js';
import type { EconomyConfig, GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { giftCost, giftFee, type GiftResult } from '../services/shop.js';

/** 送れる量（staff: 運営は手数料・1 回の最高・1 日の上限なし） */
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

/** 旧 /送金 の互換入口。新しい送金は小判へ案内する。上の旧表示ヘルパーは履歴確認用。 */
export class SokinApp {
  constructor(_db: Db, private readonly cfg: () => GuildConfig) {}

  /** /送金 と旧パネルは、小判への案内だけにする。古い確定ボタンでも銭は動かさない。 */
  async onInteraction(i: Interaction): Promise<void> {
    if (!i.inCachedGuild() || i.guildId !== this.cfg().guildId) return;
    const command = i.isChatInputCommand() && i.commandName === 'sokin';
    const oldPanel = 'customId' in i && i.customId.startsWith('sokin:');
    if ((!command && !oldPanel) || !i.isRepliable()) return;
    await i.reply({ content: '銭を人に贈る方法は小判になりました。SHOPで買った小判を贈ると、相手に額面分の銭が入ります。券や品物のプレゼントはこれまでどおり使えます。',
      components: [row(btn('koban:shop', '🪙 小判を買う', 1), btn('koban:inventory', '🪙 持っている小判を贈る'))] as never,
      ...EPHEMERAL }).catch(err => logger.warn({ err }, 'koban redirect failed'));
  }
}

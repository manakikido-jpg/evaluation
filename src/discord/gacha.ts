import { drawCost, drawableStyles, drawStyles, stylesOf, styleChances, styleItem } from '../services/casino/styles.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type Interaction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from 'discord.js';
import { GACHA_TIERS, type CasinoConfig, type GachaConfig, type GuildConfig, type TicketKind } from '../config.js';
import type { Db } from '../db/client.js';
import { shopItems, type CustomTicket, type GachaPrizeRow, type ShopItem } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { walletOf } from '../services/economy.js';
import {
  drawGacha,
  gachaUnitPrice,
  effectiveRates,
  ensureGachaPrizes,
  inPeriod,
  firstFreeLeft,
  gachaStateOf,
  listPrizes,
  prizeChances,
  prizeLabel,
  collectionOf,
  shareFortune,
  TIER_LABEL,
  ZODIAC,
  zodiacLine,
  untilPity,
  type GachaPull,
} from '../services/gacha.js';
import {
  buffsOf,
  cancelNameDeco,
  decoratedNick,
  dueNameDecos,
  endNameDeco,
  giftGacha,
  nameDecoOf,
  startNameDeco,
  useFuku,
  useLuck,
  validDecoEmoji,
  type Buffs,
} from '../services/buffs.js';
import { customHoldingsOf, customName, listCustomTickets, useCustom } from '../services/customTickets.js';
import { drawOmikuji, omikujiToday } from '../services/omikuji.js';
import { boostCasino, useCasinoBoost, type BoostUse } from '../services/casino/boost.js';
import { addTickets, MANUAL_TICKETS, TICKET_LABEL, ticketLine, ticketsOf, useTicket } from '../services/tickets.js';
import { announceSpecial, omikujiVoiceBlock, revealOmikuji } from './omikuji.js';
import { panelMessage } from './panels.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

const fmt = (n: number) => n.toLocaleString('ja-JP');

/** 1 つの運勢に並べる中身の数（多いときは「ほか N 種」） */
const MAX_LIST = 8;

type Names = { role: (id: string) => string | undefined; shop: (id: number) => ShopItem | undefined; coin?: string; custom?: (id: number) => CustomTicket | undefined };

/**
 * 「📜 中身と排出率」: 運勢ごとに、出る中身を全部と、それぞれの出る確率（本人にだけ）。
 * 長いときは運勢ごとに分けて、いくつかのカードにする。
 */
export function gachaRatesView(g: GachaConfig, prizes: GachaPrizeRow[], names: Names, coin: string, now = new Date(), requestedPage = 0) {
  const rates = effectiveRates(g, prizes, now);
  const chances = prizeChances(g, prizes, now);
  const md = (d: Date) => {
    const j = new Date(d.getTime() + 9 * 3_600_000);
    return `${j.getUTCMonth() + 1}/${j.getUTCDate()}`;
  };
  const cards: { title: string; description: string; color: number }[] = [];
  for (const t of GACHA_TIERS.filter((t) => rates[t] > 0)) {
    const on = prizes.filter((p) => p.tier === t && p.enabled && p.weight > 0 && inPeriod(p, now) && (p.kind !== 'special' || p.stock === null || p.stock > 0));
    const lines = on.map((p) => {
      const c = chances.get(p.id) ?? 0;
      const notes = [
        p.endsAt ? `🎍 ${md(new Date(p.endsAt.getTime() - 1))} まで` : '',
        p.kind === 'special' && p.stock !== null ? `残り ${p.stock}` : '',
        p.kind === 'role' || (p.kind === 'shop' && !names.shop(p.shopItemId ?? 0)?.durationDays) ? '持っていたら出ない' : '',
      ].filter(Boolean);
      return [`**${prizeLabel(p, names)}**`, c > 0 ? `出る確率 **${c}%**` : '🔁 代わりの中身（ほかを全部持っているとき）', ...(notes.length ? [`-# ${notes.join(' ／ ')}`] : [])].join('\n');
    });
    // 商品の途中で切らず、Discord のカードの上限に収まるように分ける。
    let description = '';
    let part = 0;
    const flush = () => {
      if (!description) return;
      cards.push({ title: `${TIER_LABEL[t].emoji} ${TIER_LABEL[t].name}　${rates[t]}%${part ? '（つづき）' : ''}`, description, color: TIER_LABEL[t].color });
      description = '';
      part++;
    };
    for (const line of lines) {
      if (description && description.length + line.length + 2 > 3800) flush();
      description += (description ? '\n\n' : '') + line;
    }
    flush();
  }
  // 1 メッセージのカードは合計 6,000 文字まで。余裕を持ってページを分ける。
  const pages: typeof cards[] = [[]];
  let size = 0;
  for (const card of cards) {
    let current = pages[pages.length - 1]!;
    const length = card.title.length + card.description.length;
    if (current.length && (size + length > 5500 || current.length >= 10)) {
      pages.push([]);
      current = pages[pages.length - 1]!;
      size = 0;
    }
    current.push(card);
    size += length;
  }
  const page = Math.min(pages.length - 1, Math.max(0, Number.isSafeInteger(requestedPage) ? requestedPage : 0));
  const left = g.pity > 0 && rates.daikichi > 0 ? `🎯 天井: 大吉が出ないまま ${g.pity} 回目は必ず大吉` : '🎯 天井はありません';
  return {
    content: [
      `📜 **物御籤の中身と排出率**${pages.length > 1 ? ` ─ ${page + 1} / ${pages.length} ページ` : ''}`,
      `1 回 ${fmt(g.price)} 枚 ／ 10 連 ${fmt(g.price * 10)} 枚（${coin}）`,
      left,
      '',
      ...(cards.length ? [] : ['今出る中身はありません。']),
      '-# カードの % はその運勢、商品の % は1 回でその商品が出る確率です（何も持っていない人・天井や運気アップがないとき）。持っているロールは出ないので、そのぶんほかの中身が出ます。',
    ].join('\n'),
    embeds: pages[page]!,
    components: pages.length > 1 ? [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`gacha:rates:page:${Math.max(0, page - 1)}`).setLabel('前のページ').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId(`gacha:rates:page:${Math.min(pages.length - 1, page + 1)}`).setLabel('次のページ').setStyle(ButtonStyle.Secondary).setDisabled(page === pages.length - 1),
    )] : [],
  };
}

/** 運勢ごとの中身の説明（出る中身と確率。止めている中身は出さない） */
export function tierPrizeText(g: Pick<GachaConfig, 'rates'>, prizes: GachaPrizeRow[], tier: GachaPrizeRow['tier'], names: Names): string {
  const chances = prizeChances(g, prizes);
  const on = prizes.filter((p) => p.tier === tier && p.enabled && p.weight > 0);
  const main = on.filter((p) => (chances.get(p.id) ?? 0) > 0);
  const backup = on.filter((p) => !main.includes(p));
  const items = main.map((p) => `${prizeLabel(p, names)} ${chances.get(p.id)}%`);
  const shown = items.slice(0, MAX_LIST).join('・') + (items.length > MAX_LIST ? ` ほか ${items.length - MAX_LIST} 種` : '');
  const fb = backup.length ? `（出せないときは ${backup.map((p) => prizeLabel(p, names)).join('・')}）` : '';
  return (shown || 'なし') + fb;
}

/** 目玉に並べる数 */
const MAX_FEATURED = 5;

/**
 * ✨ 今の目玉: 超大当たりの中身と、期間限定の中身を、物御籤の画面のいちばん上に大きく出す。
 * どちらもなければ出さない（今出せるものだけ。残りのない賞品・期間の外のものは出さない）。
 */
export function gachaFeatured(g: GachaConfig, prizes: GachaPrizeRow[], names: Names, now = new Date()): { title: string; description: string; color: number } | undefined {
  const rates = effectiveRates(g, prizes, now);
  const chances = prizeChances(g, prizes, now);
  const live = (p: GachaPrizeRow) =>
    p.enabled && p.weight > 0 && inPeriod(p, now) && (p.kind !== 'special' || p.stock === null || p.stock > 0) && (chances.get(p.id) ?? 0) > 0 && rates[p.tier] > 0;
  const md = (d: Date) => {
    const j = new Date(d.getTime() - 1 + 9 * 3_600_000);
    return `${j.getUTCMonth() + 1}/${j.getUTCDate()}`;
  };
  const supers = prizes.filter((p) => p.tier === 'super' && live(p));
  const limited = prizes.filter((p) => p.tier !== 'super' && p.endsAt && live(p));
  if (!supers.length && !limited.length) return undefined;
  const lines: string[] = [];
  if (supers.length) {
    lines.push(`🎊 **超大当たり**（どれかが出る確率 ${rates.super}%）`);
    for (const p of supers.slice(0, MAX_FEATURED)) {
      const notes = [`${chances.get(p.id)}%`, p.kind === 'special' && p.stock !== null ? `🔥 残り ${p.stock}` : '', p.endsAt ? `🎍 ${md(p.endsAt)} まで` : ''].filter(Boolean);
      lines.push(`### 🌟 ${prizeLabel(p, names)}`, `-# ${notes.join('・')}`);
    }
    if (supers.length > MAX_FEATURED) lines.push(`-# ほか ${supers.length - MAX_FEATURED} 種`);
  }
  if (limited.length) {
    if (lines.length) lines.push('');
    lines.push('🎍 **期間限定**');
    for (const p of limited.slice(0, MAX_FEATURED)) {
      lines.push(`- ${TIER_LABEL[p.tier].emoji} ${prizeLabel(p, names)} … **${md(p.endsAt!)} まで**（${TIER_LABEL[p.tier].name}の ${chances.get(p.id)}%）`);
    }
    if (limited.length > MAX_FEATURED) lines.push(`-# ほか ${limited.length - MAX_FEATURED} 種`);
  }
  return { title: '✨ 今の目玉', description: lines.join('\n').slice(0, 4000), color: supers.length ? TIER_LABEL.super.color : TIER_LABEL.daikichi.color };
}

/** /物御籤 と「物御籤売り場へ入る」: 値段・割合・中身・天井と、引くボタン（本人にだけ） */
export function gachaMenu(
  g: GachaConfig,
  prizes: GachaPrizeRow[],
  names: Names,
  s: {
    balance: number;
    sinceTop: number;
    tickets: Record<TicketKind, number>;
    buffs?: Buffs;
    custom?: CustomHolding[];
    zodiac?: string[];
    /** 期間限定の物御籤セール（g.price はもう引いた値段） */
    sale?: { percent: number; original: number };
    /** はじめての 1 回（無料）がまだ使える */
    firstFree?: boolean;
  },
  coin: string,
) {
  const rates = effectiveRates(g, prizes);
  const left = untilPity(g, s.sinceTop);
  const buffs = s.buffs;
  const featured = gachaFeatured(g, prizes, names);
  // 運勢ごとの中身は長くなるので出さない（割合だけ 1 行。中身は「📜 中身と排出率」、目玉は上のカード）
  const lines = [
    ...(s.firstFree ? ['🎉 **はじめての 1 回は無料！** 「はじめての 1 回（無料）」で引けます', ''] : []),
    ...(s.sale ? [`🎉 **期間限定セール中！** ${s.sale.percent}% 引き（ふだんは 1 回 ${fmt(s.sale.original)} 枚）`] : []),
    `1 回 **${fmt(g.price)}** 枚 ／ 10 連 **${fmt(g.price * 10)}** 枚（${coin}。本物のお金は使いません）`,
    '',
    '**🌸 運勢ごとの確率**',
    GACHA_TIERS.filter((t) => rates[t] > 0)
      .map((t) => `${TIER_LABEL[t].emoji} ${TIER_LABEL[t].name} ${rates[t]}%`)
      .join('\n'),
    '-# 出る中身は「📜 中身と排出率」で見られます',
    '',
    '**🎯 大吉までの道のり**',
    left !== undefined && rates.daikichi > 0 ? `🎯 天井: 大吉が出ないまま ${g.pity} 回目は必ず大吉（あと **${left}** 回）` : '🎯 天井はありません',
    '-# 持っているロールは出ません（出せる中身がなくなったら、その分は払い戻します）',
    '',
    '**👛 あなたの持ち物**',
    `${coin} いま **${fmt(s.balance)}** 枚`,
    `🎟 持っている券: ${allTicketsLine(s.tickets, s.custom) ?? 'なし'}`,
    ...(buffs?.fukuUntil ? [`🧧 福の札: <t:${Math.floor(buffs.fukuUntil.getTime() / 1000)}:f> まで、通話の${coin}が 2 倍`] : []),
    ...(buffs && buffs.luck > 0 ? [`🍀 運気アップ: あと **${buffs.luck}** 回、大吉が出やすい`] : []),
    ...(buffs?.casinoUntil ? [`🎰 大勝負の札: <t:${Math.floor(buffs.casinoUntil.getTime() / 1000)}:t> まで、カジノの上限が上がっている`] : []),
    ...(s.zodiac?.length ? [`🐉 十二支: ${zodiacLine(s.zodiac)}（${s.zodiac.length}/12）`] : []),
    ...(buffs?.deco ? [`🏷 名前の飾り ${buffs.deco.emoji}: <t:${Math.floor(buffs.deco.until.getTime() / 1000)}:d> まで`] : []),
    '-# 部屋代・授与所の券は使う場面で。札は「🎟 券を使う」から',
  ];
  const usable = MANUAL_TICKETS.some((k) => s.tickets[k] > 0) || (s.custom ?? []).some((c) => c.count > 0);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('gacha:draw:1')
      .setLabel(`1 回引く（${fmt(g.price)} 枚）`)
      .setEmoji('🎁')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(s.balance < g.price),
    new ButtonBuilder()
      .setCustomId('gacha:draw:10')
      .setLabel(`10 連（${fmt(g.price * 10)} 枚）`)
      .setEmoji('🎊')
      .setStyle(ButtonStyle.Success)
      .setDisabled(s.balance < g.price * 10),
    ...(s.tickets.gacha_free > 0
      ? [new ButtonBuilder().setCustomId('gacha:draw:free').setLabel(`無料券で引く（${s.tickets.gacha_free} 枚）`).setEmoji('🎫').setStyle(ButtonStyle.Success)]
      : []),
    ...(usable ? [new ButtonBuilder().setCustomId('gacha:use').setLabel('券を使う').setEmoji('🎟').setStyle(ButtonStyle.Secondary)] : []),
    new ButtonBuilder().setCustomId('gacha:rates').setLabel('中身と排出率').setEmoji('📜').setStyle(ButtonStyle.Secondary),
  );
  // 🎉 はじめての 1 回・🌟 金の10連券（1 行目はボタンがいっぱいなので 2 行目に）
  const extra = [
    ...(s.firstFree ? [new ButtonBuilder().setCustomId('gacha:draw:first').setLabel('はじめての 1 回（無料）').setEmoji('🎉').setStyle(ButtonStyle.Success)] : []),
    ...(s.tickets.gacha_gold10 > 0
      ? [new ButtonBuilder().setCustomId('gacha:draw:gold').setLabel(`金の10連券で引く（${s.tickets.gacha_gold10} 枚）`).setEmoji('🌟').setStyle(ButtonStyle.Success)]
      : []),
  ];
  const gold = extra.length ? [new ActionRowBuilder<ButtonBuilder>().addComponents(...extra)] : [];
  return {
    embeds: [...(featured ? [featured] : []), { title: '🎁 物御籤', description: lines.join('\n').slice(0, 4000), color: 0xd7003a }],
    components: [row, ...gold],
  };
}

type CustomHolding = { ticket: CustomTicket; count: number };

/** 券の一行（ふつうの券と自由な券） */
export function allTicketsLine(tickets: Record<TicketKind, number>, custom: CustomHolding[] = []): string | undefined {
  const parts = [ticketLine(tickets), ...custom.filter((c) => c.count > 0).map((c) => `${customName(c.ticket)} ×${c.count}`)].filter(Boolean);
  return parts.length ? parts.join('　') : undefined;
}

/** 「🎟 券を使う」: 持っている札・自由な券を選ぶ */
export function useTicketMenu(tickets: Record<TicketKind, number>, custom: CustomHolding[] = []) {
  const owned = MANUAL_TICKETS.filter((k) => tickets[k] > 0);
  const customOwned = custom.filter((c) => c.count > 0).slice(0, 25 - owned.length);
  return {
    content: owned.length || customOwned.length ? '🎟 どの券を使いますか？' : '使える券がありません。',
    components:
      owned.length || customOwned.length
        ? [
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('gacha:usepick')
              .setPlaceholder('使う券を選ぶ')
              .addOptions(
                ...owned.map((k) => ({
                  label: `${TICKET_LABEL[k].name}（${tickets[k]} 枚）`.slice(0, 100),
                  value: k,
                  description: TICKET_LABEL[k].note.slice(0, 100),
                  emoji: { name: TICKET_LABEL[k].emoji },
                })),
                ...customOwned.map((c) => ({
                  label: `${c.ticket.name}（${c.count} 枚）`.slice(0, 100),
                  value: `custom:${c.ticket.id}`,
                  description: (c.ticket.note || '使うと運営に知らせます').slice(0, 100),
                  emoji: { name: c.ticket.emoji || '🎟' },
                })),
              ),
          ),
        ]
      : [],
  };
}

/** 1 回分の結果の一行 */
export function pullLine(p: GachaPull, roleName: (id: string) => string, coinName = '銭'): string {
  const t = TIER_LABEL[p.tier];
  let got: string;
  if (p.special) got = `🎊 ${p.special.label}（運営からお渡しします）`;
  else if (p.custom) got = `${p.custom.name} ×${p.custom.count}`;
  else if (p.zodiac) got = `${p.zodiac.emoji}${p.zodiac.name}のお守り（${p.zodiac.count}/12）${p.zodiac.complete ? ' 🎉 十二支がそろいました！' : ''}`;
  else if (p.shopItemId) got = `${p.shopName ?? 'ショップの品'}${p.expiresAt ? `（${p.expiresAt.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })} まで）` : ''}`;
  else if (p.roleId) got = `「${roleName(p.roleId)}」`;
  else if (p.ticket) got = `${TICKET_LABEL[p.ticket].emoji}${TICKET_LABEL[p.ticket].name} ×${p.count}`;
  else if (p.coins > 0) got = `${coinName} ${fmt(p.coins)} 枚`;
  else got = 'なし';
  return `${t.emoji} **${t.name}**${p.pity ? '（天井）' : ''} … ${got}`;
}

/** 🎰 大勝負の札を使ったときの文（上がったあとの上限つき） */
export function casinoBoostText(c: CasinoConfig, coin: string, r: BoostUse): string {
  if (r.status === 'no_ticket') return '🎰 大勝負の札がありません。';
  const b = boostCasino(c);
  const at = `<t:${Math.floor(r.until.getTime() / 1000)}:t>`;
  const limits = `1 回 **${fmt(b.maxBet)}** 枚まで${b.dailyBetLimit > 0 ? `・1 日の合計 **${fmt(b.dailyBetLimit)}** 枚まで` : ''}`;
  if (r.status === 'active') return `🎰 今日はもう大勝負の札が効いています（${at} まで・${limits}）。札は減っていません。`;
  return [`🎰 大勝負の札を使いました。今日（${at} まで）、カジノで${coin}を ${limits} 賭けられます（ふだんは 1 回 ${fmt(c.maxBet)} 枚${c.dailyBetLimit > 0 ? `・1 日 ${fmt(c.dailyBetLimit)} 枚` : ''}）。`, '-# みんなで払う卓の参加費・ブラインドは、ふだんの上限のままです'].join('\n');
}

/** 物御籤を引く・券を使う */
export class GachaApp {
  private guild?: Guild;

  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
  ) {}

  attach(guild: Guild): void {
    this.guild = guild;
  }

  /**
   * 置いてある「物御籤」のボタンの案内を、今の文に書き換える（ボタンの名前を変えたとき用。同じなら何もしない）。
   * 見るのは #おみくじ・#授与所・祈願所・ガチャ の最近の BOT の書き込みだけ
   */
  async refreshPanels(guild: Guild): Promise<number> {
    const cfg = this.cfg();
    const next = panelMessage('gacha', { coinName: cfg.economy.currencyName });
    let edited = 0;
    const places = guild.channels.cache.filter((c) => c.type === ChannelType.GuildText && (c.id === cfg.channels.omikuji || ['おみくじ', '授与所', '祈願所', 'ガチャ'].some((name) => c.name.normalize('NFKC').includes(name))));
    for (const ch of places.values()) {
      if (ch.type !== ChannelType.GuildText) continue;
      const msgs = await ch.messages.fetch({ limit: 50 }).catch(() => undefined);
      for (const m of msgs?.values() ?? []) {
        if (m.author.id !== guild.client.user.id) continue;
        const rows = m.components.map((row) => row.toJSON()) as { type?: number; items?: { media?: { url?: string } }[]; components?: { custom_id?: string; label?: string }[] }[];
        const open = rows.flatMap((row) => row.components ?? []).find((b) => b.custom_id === 'gacha:open');
        if (!open) continue;
        // 写真と2つのボタンを上下に並べた入口なら、そのまま。
        const same = rows.length === next.components.length && rows.every((row, index) => {
          const expected = next.components[index]!;
          if (row.type !== expected.type) return false;
          if (expected.type === 12) return row.items?.length === 1 && row.items[0]?.media?.url?.includes(next.files[index === 0 ? 0 : 1]!.name);
          return row.components?.length === expected.components.length && row.components.every((button, n) => button.custom_id === expected.components[n]?.custom_id && button.label === expected.components[n]?.label);
        });
        if (same && m.flags?.has(MessageFlags.IsComponentsV2)) continue;
        await m.edit({ ...next, content: null, embeds: [], attachments: [], allowedMentions: { parse: [] } }).then(() => edited++).catch((err: unknown) => logger.warn({ err, channelId: ch.id }, 'gacha panel refresh failed'));
      }
    }
    return edited;
  }

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    const id = 'customId' in interaction ? interaction.customId : '';
    try {
      if (interaction.isButton() && /^(?:casino-gacha:(?:open|rates)|casino-gacha:draw:(?:1|10))$/.test(id)) return await this.casinoMenu(interaction);
      if (interaction.isChatInputCommand() && interaction.commandName === 'gacha') return await this.menu(interaction);
      if (interaction.isButton() && id === 'gacha:open') return await this.menu(interaction);
      if (interaction.isButton() && id === 'gacha:draw:free') return await this.draw(interaction, 1, 'free');
      if (interaction.isButton() && id === 'gacha:draw:gold') return await this.draw(interaction, 10, 'gold');
      if (interaction.isButton() && id === 'gacha:draw:first') return await this.draw(interaction, 1, 'first');
      if (interaction.isButton() && id.startsWith('gacha:draw:')) return await this.draw(interaction, Number(id.split(':')[2]));
      if (interaction.isButton() && id === 'gacha:use') return await this.useMenu(interaction);
      if (interaction.isButton() && id === 'gacha:rates') return await this.ratesView(interaction);
      if (interaction.isButton() && /^gacha:rates:page:\d+$/.test(id)) return await this.ratesView(interaction, Number(id.split(':')[3]));
      // 🎒 /持ち物 の「使う」ボタン（中身は「券を使う」と同じ）
      if ((interaction.isStringSelectMenu() && id === 'gacha:usepick') || (interaction.isButton() && id.startsWith('gacha:use1:'))) {
        const v = interaction.isButton() ? id.slice('gacha:use1:'.length) : (interaction.values[0] ?? '');
        if (!v.startsWith('custom:') && !(MANUAL_TICKETS as readonly string[]).includes(v)) return void (await interaction.reply({ content: 'その券は、使う場面で自動で使われます。', ...EPHEMERAL }));
        if (v.startsWith('custom:')) return await this.useCustomTicket(interaction, Number(v.slice(7)));
        return await this.use(interaction, v as TicketKind);
      }
      if (interaction.isUserSelectMenu() && id === 'gacha:giftto') return await this.gift(interaction);
      if (interaction.isModalSubmit() && id === 'gacha:deco') return await this.deco(interaction);
    } catch (err) {
      logger.error({ err, id }, 'gacha failed');
      const msg = { content: '物御籤を引けませんでした。時間をおいてもう一度お試しください。', ...EPHEMERAL };
      if (interaction.isRepliable()) await (interaction.deferred || interaction.replied ? interaction.followUp(msg) : interaction.reply(msg)).catch(() => undefined);
    }
  }

  private async casinoMenu(i: ButtonInteraction<'cached'>): Promise<void> {
    const cfg = this.cfg();
    const roles = i.member.roles.cache;
    const allowed = cfg.casino.accessRoleId ? roles.has(cfg.casino.accessRoleId) : !cfg.casino.requireRank || cfg.ranks.some((r) => roles.has(r.roleId));
    if (!allowed) return void await i.reply({ content: 'カジノに入れるロールがある人だけ使えます。', ...EPHEMERAL, allowedMentions: { parse: [] } });
    await i.deferReply(EPHEMERAL);
    let results: string[] | undefined;
    let message = '';
    if (i.customId.startsWith('casino-gacha:draw:')) {
      if (!cfg.casino.enabled) return void await i.editReply({ content: 'カジノは今お休み中です。', allowedMentions: { parse: [] } });
      const r = await drawStyles(this.db, cfg.casinoGacha, i.user.id, `discord:${i.message.id}`, Number(i.customId.split(':')[2]), 'discord');
      if (r.status === 'ok') { results = r.results; if (r.replay) message = '同じボタンの結果です。追加の支払いはありません。'; }
      else message = r.status === 'funds' ? '銭が足りません。' : r.status === 'off' ? '今はお休み中です。' : 'もう一度開いてください。';
    }
    const state = await stylesOf(this.db, i.user.id);
    const w = await walletOf(this.db, i.user.id);
    const chances = styleChances(cfg.casinoGacha, state.owned);
    const ratesOnly = i.customId === 'casino-gacha:rates';
    // 今は出さない品（社務所Web で外した品）は、持っていなければ一覧に出さない
    const lines = chances
      .filter((item) => item.chance > 0 || (item.slot && state.owned.includes(item.key)))
      .map((item) => `${item.emoji} **${item.name}** · ${item.chance.toLocaleString('ja-JP', { maximumFractionDigits: 3 })}％ · ${item.slot ? state.owned.includes(item.key) ? '所持済み' : '期限なし' : '券'}`);
    const allOwned = drawableStyles(cfg.casinoGacha, state.owned).length === 0;
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(...[1, 10].map((n) => new ButtonBuilder().setCustomId(`casino-gacha:draw:${n}`).setLabel(`${n === 1 ? '1回' : '10連'}（${fmt(drawCost(cfg.casinoGacha, n))}${cfg.economy.currencyName}）`).setStyle(ButtonStyle.Primary).setDisabled(!cfg.casino.enabled || !cfg.casinoGacha.enabled || w.balance < drawCost(cfg.casinoGacha, n))));
    await i.editReply({
      content: [message, results ? '**今回の景品**\n' + results.map((key) => { const item = styleItem(key)!; return `${item.emoji} ${item.name}`; }).join('\n') : ''].filter(Boolean).join('\n') || null,
      embeds: [{ title: ratesOnly ? '📜 勝負の御籤 · 中身と排出率' : '🎰 勝負の御籤 · 売り場', color: 0xb99553, description: [!cfg.casino.enabled || !cfg.casinoGacha.enabled ? '今はお休み中です。' : '', `所持：${fmt(w.balance)}${cfg.economy.currencyName} · お試し券${state.tickets}枚`, allOwned ? '見た目の品は全部そろいました！その分はお試し券になります。' : `あと${Math.max(1, cfg.casinoGacha.pity - state.pity)}回以内に未所持の見た目の品を保証。`, '', ...(ratesOnly ? lines : [`1回 ${fmt(drawCost(cfg.casinoGacha, 1))}${cfg.economy.currencyName}・10連 ${fmt(drawCost(cfg.casinoGacha, 10))}${cfg.economy.currencyName}`, '景品は背景・卓の飾り・称号・お試し券・大勝負の札など。中身と確率は下のボタンから確認できます。']), '', '見た目の品は重複しません。天井では未所持の品の中から、出やすさに合わせて選びます。物御籤の券・天井とは別です。', '背景・卓のふち・席の飾り・称号などは、カジノWebの「🪭 着せ替え」で装備できます。入口は `/カジノ`。', '見た目は勝つ割合を変えません。大勝負の札は `/持ち物` から使います。'].filter(Boolean).join('\n') }],
      components: ratesOnly ? [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('casino-gacha:open').setLabel('売り場へ入る').setStyle(ButtonStyle.Primary))] : [row, new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('casino-gacha:rates').setLabel('中身と排出率').setStyle(ButtonStyle.Secondary))], allowedMentions: { parse: [] },
    });
  }

  private coin(): string {
    const e = this.cfg().economy;
    return `${e.currencyEmoji}${e.currencyName}`;
  }

  /** 中身と、名前の引き方 */
  private async prizes(i: { guild: Guild }): Promise<{ prizes: GachaPrizeRow[]; names: Names }> {
    await ensureGachaPrizes(this.db, this.cfg().gacha);
    const [prizes, items, customs] = await Promise.all([listPrizes(this.db), this.db.select().from(shopItems), listCustomTickets(this.db)]);
    const shop = new Map(items.map((x) => [x.id, x]));
    const custom = new Map(customs.map((x) => [x.id, x]));
    return { prizes, names: { role: (id) => i.guild.roles.cache.get(id)?.name, shop: (id) => shop.get(id), coin: this.coin(), custom: (id) => custom.get(id) } };
  }

  /** 見せる値段（物御籤セール中は % 引きの値段） */
  private shown(): GachaConfig {
    const cfg = this.cfg();
    return { ...cfg.gacha, price: gachaUnitPrice(cfg.gacha, cfg.economy.gachaSalePercent) };
  }

  private sale(): { percent: number; original: number } | undefined {
    const cfg = this.cfg();
    return cfg.economy.gachaSalePercent > 0 ? { percent: cfg.economy.gachaSalePercent, original: cfg.gacha.price } : undefined;
  }

  private async menu(i: ChatInputCommandInteraction<'cached'> | ButtonInteraction<'cached'>): Promise<void> {
    const g = this.shown();
    if (!g.enabled) return void (await i.reply({ content: '物御籤は今お休みしています。', ...EPHEMERAL }));
    const [w, st, tickets, buffs, p, custom, firstFree] = await Promise.all([
      walletOf(this.db, i.user.id),
      gachaStateOf(this.db, i.user.id),
      ticketsOf(this.db, i.user.id),
      buffsOf(this.db, i.user.id),
      this.prizes(i),
      customHoldingsOf(this.db, i.user.id),
      firstFreeLeft(this.db, i.user.id),
    ]);
    const zodiac = await collectionOf(this.db, i.user.id);
    await i.reply({
      ...gachaMenu(g, p.prizes, p.names, { balance: w.balance, sinceTop: st.sinceTop, tickets, buffs, custom, zodiac, sale: this.sale(), firstFree }, this.coin()),
      ...EPHEMERAL,
    });
  }

  private async draw(i: ButtonInteraction<'cached'>, times: number, ticket?: 'free' | 'gold' | 'first'): Promise<void> {
    const free = ticket === 'free';
    const gold = ticket === 'gold';
    const first = ticket === 'first';
    if (times !== 1 && times !== 10) return;
    const cfg = this.cfg();
    const g = cfg.gacha;
    if (!g.enabled) return void (await i.reply({ content: '物御籤は今お休みしています。', ...EPHEMERAL }));
    await i.deferReply(EPHEMERAL);
    const r = await drawGacha(this.db, g, i.user.id, times, [...i.member.roles.cache.keys()], Math.random, new Date(), { free, gold, first, salePercent: cfg.economy.gachaSalePercent });
    if (r.status === 'disabled') return void (await i.editReply('物御籤は今お休みしています。'));
    if (r.status === 'no_ticket')
      return void (await i.editReply(first ? '🎉 はじめての 1 回は、もう使っています。' : gold ? '🌟 金の10連券がありません。' : '🎫 物御籤の無料券がありません。'));
    if (r.status === 'empty') return void (await i.editReply(`いま出せる中身がありません（持っていないものが残っていません）。${cfg.economy.currencyName}は減っていません。`));
    if (r.status === 'insufficient') return void (await i.editReply(`${cfg.economy.currencyName}が足りません（${fmt(r.price)} 枚必要・いま ${fmt(r.balance)} 枚）。`));

    // 当たったロールを付ける（ショップの色の買い替えなら前の色を外す）。付けられなければ、神職に知らせてもらう
    const failed: string[] = [];
    for (const p of r.pulls) {
      if (p.roleId) {
        await i.member.roles.add(p.roleId, '物御籤').catch((err: unknown) => {
          logger.warn({ err, roleId: p.roleId }, 'gacha role add failed');
          failed.push(p.roleId!);
        });
      }
      for (const old of p.removeRoleIds ?? []) await i.member.roles.remove(old, '物御籤（色の入れ替え）').catch(() => undefined);
    }
    const roleName = (id: string) => i.guild.roles.cache.get(id)?.name ?? '（ロール）';
    const best = GACHA_TIERS.find((t) => r.pulls.some((p) => p.tier === t)) ?? 'kichi';
    const left = untilPity(g, r.sinceTop);
    const lucky = r.pulls.filter((p) => p.lucky).length;
    const lines = [
      ...r.pulls.map((p) => pullLine(p, roleName, cfg.economy.currencyName)),
      '',
      ...(free ? ['-# 🎫 物御籤の無料券を 1 枚使いました'] : []),
      ...(first ? ['-# 🎉 はじめての 1 回（無料）で引きました'] : []),
      ...(gold ? [`-# 🌟 金の10連券を 1 枚使いました${r.pulls.some((x) => x.guaranteed) ? '（最後の 1 回は大吉以上が確定）' : ''}`] : []),
      ...(lucky ? [`-# 🍀 運気アップの札が ${lucky} 回効きました`] : []),
      ...(r.refunded > 0 ? [`↩️ 出せる中身がなくなったので、${r.refunded} 回分を払い戻しました。`, ''] : []),
      ...(failed.length
        ? [`⚠️ ${[...new Set(failed)].map((id) => `「${roleName(id)}」`).join('')}を付けられませんでした。神職に知らせてください（記録は残っています）。`, '']
        : []),
      `${this.coin()} 残り **${fmt(r.balance)}** 枚${left !== undefined ? ` ／ 天井まであと ${left} 回` : ''}`,
    ];
    const [p, buffs, custom, zodiac] = await Promise.all([
      this.prizes(i),
      buffsOf(this.db, i.user.id),
      customHoldingsOf(this.db, i.user.id),
      collectionOf(this.db, i.user.id),
    ]);
    // 🍶 おすそ分け: 大吉・超大当たりの数だけ、同じ通話にいる人に
    const bigWins = r.pulls.filter((x) => x.tier === 'super' || x.tier === 'daikichi').length;
    const vc = i.member.voice.channel;
    if (bigWins && g.share > 0 && vc) {
      const shared = await shareFortune(this.db, i.user.id, [...vc.members.values()].filter((m) => !m.user.bot).map((m) => m.id), g.share * bigWins);
      if (shared.length) {
        lines.push(`🍶 同じ通話の ${shared.length} 人に、${cfg.economy.currencyName} ${fmt(g.share * bigWins)} 枚ずつおすそ分けしました`);
        if (vc.isSendable())
          await vc
            .send({
              content: `🍶 **${i.member.displayName}** さんの物御籤の${r.pulls.some((x) => x.tier === 'super') ? '超大当たり' : '大吉'}のおすそ分け！ この通話のみなさんに ${cfg.economy.currencyEmoji}${cfg.economy.currencyName} ${fmt(g.share * bigWins)} 枚ずつ`,
              allowedMentions: { parse: [] },
            })
            .catch(() => undefined);
      }
    }
    lines.push(`🎟 ${allTicketsLine(r.tickets, custom) ?? '券はありません'}`);
    await i.editReply({
      embeds: [{ title: `🎁 物御籤${times > 1 ? ` ${times} 連` : ''} ― ${TIER_LABEL[best].name}`, description: lines.join('\n'), color: TIER_LABEL[best].color }],
      components: gachaMenu(this.shown(), p.prizes, p.names, { balance: r.balance, sinceTop: r.sinceTop, tickets: r.tickets, buffs, custom, zodiac }, this.coin()).components,
    });

    // 🐉 十二支がそろったら #慶事 でお祝い
    if (r.pulls.some((x) => x.zodiac?.complete)) {
      const keiji = cfg.channels.keiji ? i.guild.channels.cache.get(cfg.channels.keiji) : undefined;
      if (keiji?.isSendable())
        await keiji
          .send({
            embeds: [{ title: '🐉 十二支がそろいました！', description: `**${i.member.displayName}** さんが、物御籤で十二支のお守りを全部集めました。\n${zodiacLine(ZODIAC.map((z) => z.key))}`, color: 0xd4a017 }],
            allowedMentions: { parse: [] },
          })
          .catch(() => undefined);
    }

    // 運営が渡す特別な賞品: 運営に知らせて、当たった人に DM
    for (const x of r.pulls) if (x.special) await this.notifySpecial(i, x.special);

    // 超大当たり・大吉は #おみくじ でお祝い
    const channel = this.omikujiChannel(i.guild);
    for (const tier of ['super', 'daikichi'] as const) {
      const tops = r.pulls.filter((x) => x.tier === tier);
      if (!tops.length || !channel) continue;
      const got = tops.map((x) => pullLine(x, roleName, cfg.economy.currencyName).replace(/^.*? … /, '')).join('、');
      const t = TIER_LABEL[tier];
      await channel
        .send({
          embeds: [
            {
              title: tier === 'super' ? '🎊🎊 物御籤で超大当たり！！ 🎊🎊' : '🌸 物御籤で大吉！',
              description: `**${i.member.displayName}** さんが物御籤で **${t.name}** を引きました！\n授かったもの: ${got}`,
              color: t.color,
            },
          ],
          allowedMentions: { parse: [] },
        })
        .catch((err: unknown) => logger.warn({ err }, 'gacha announce failed'));
    }
  }

  /** 運営が渡す特別な賞品が当たったとき: 運営のチャンネル（呼び鈴の知らせ先か #記録）と、当たった人に DM */
  private async notifySpecial(i: ButtonInteraction<'cached'>, special: { label: string; claimId: number }): Promise<void> {
    const cfg = this.cfg();
    const target = cfg.bell.channelId ?? cfg.channels.log;
    const ch = target ? i.guild.channels.cache.get(target) : undefined;
    if (ch?.isSendable()) {
      await ch
        .send({
          embeds: [
            {
              title: '🎊 物御籤の超大当たり（運営から渡す賞品）',
              description: [
                `<@${i.user.id}> さんが **${special.label}** を当てました（当たり #${special.claimId}）。`,
                '渡したら、社務所Web の「🎁 物御籤」→「🎊 運営が渡す賞品」で「渡した」を押してください。',
              ].join('\n'),
              color: TIER_LABEL.super.color,
            },
          ],
          allowedMentions: { parse: [] },
        })
        .catch((err: unknown) => logger.warn({ err }, 'gacha special notify failed'));
    }
    await i.user
      .send(`🎊 物御籤の超大当たり、おめでとうございます！（咲楽ノ宮）\n**${special.label}** は、運営からお渡しします。連絡をお待ちください。`)
      .catch(() => undefined);
  }

  /** #おみくじ（設定になければ「おみくじ」という名前のチャンネル） */
  private omikujiChannel(guild: Guild) {
    const home = this.cfg().channels.omikuji ?? guild.channels.cache.find((c) => c.isTextBased() && c.name === 'おみくじ')?.id;
    const channel = home ? guild.channels.cache.get(home) : undefined;
    return channel?.isSendable() ? channel : undefined;
  }

  /** 📜 中身と排出率（本人にだけ） */
  private async ratesView(i: ButtonInteraction<'cached'>, page?: number): Promise<void> {
    const g = this.shown();
    if (!g.enabled) return void (await i.reply({ content: '物御籤は今お休みしています。', ...EPHEMERAL }));
    if (page === undefined) await i.deferReply(EPHEMERAL);
    else await i.deferUpdate();
    const p = await this.prizes(i);
    await i.editReply({ ...gachaRatesView(g, p.prizes, p.names, this.coin(), new Date(), page), allowedMentions: { parse: [] } });
  }

  // ───────── 券を使う ─────────

  private async useMenu(i: ButtonInteraction<'cached'>): Promise<void> {
    const [tickets, custom] = await Promise.all([ticketsOf(this.db, i.user.id), customHoldingsOf(this.db, i.user.id)]);
    await i.reply({ ...useTicketMenu(tickets, custom), ...EPHEMERAL });
  }

  private async use(i: StringSelectMenuInteraction<'cached'> | ButtonInteraction<'cached'>, kind: TicketKind): Promise<void> {
    const cfg = this.cfg();
    const coin = cfg.economy.currencyName;
    switch (kind) {
      case 'fuku': {
        const r = await useFuku(this.db, i.user.id);
        return void (await i.update({
          content: r.status === 'ok' ? `🧧 福の札を使いました。<t:${Math.floor(r.until.getTime() / 1000)}:f> まで、通話でもらえる${coin}が 2 倍です。` : '🧧 福の札がありません。',
          components: [],
        }));
      }
      case 'luck': {
        const r = await useLuck(this.db, i.user.id);
        return void (await i.update({
          content: r.status === 'ok' ? `🍀 運気アップの札を使いました。次の **${r.remaining}** 回は、物御籤の大吉が出やすくなります。` : '🍀 運気アップの札がありません。',
          components: [],
        }));
      }
      case 'omikuji_extra':
        return void (await i.update({ content: await this.omikujiExtra(i), components: [] }));
      case 'casino_boost': {
        const r = await useCasinoBoost(this.db, i.user.id);
        return void (await i.update({ content: casinoBoostText(cfg.casino, coin, r), components: [] }));
      }
      case 'gacha_free':
        return void (await i.update({ content: '🎫 下の「無料券で引く」から引けます（/物御籤 をひらき直してください）。', components: [] }));
      case 'gacha_gold10':
        return void (await i.update({ content: '🌟 /物御籤 をひらき直して、「金の10連券で引く」から引けます。', components: [] }));
      case 'gacha_gift':
        return void (await i.update({
          content: '💝 物御籤の無料券を贈る相手を選んでください。',
          components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(new UserSelectMenuBuilder().setCustomId('gacha:giftto').setPlaceholder('贈る相手'))],
        }));
      case 'name_deco': {
        const input = new TextInputBuilder()
          .setCustomId('emoji')
          .setLabel('名前の前に付ける絵文字（1 つ）')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(16)
          .setPlaceholder('例: 🌸');
        return void (await i.showModal(
          new ModalBuilder().setCustomId('gacha:deco').setTitle('🏷 名前の飾り（7 日間）').addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input)),
        ));
      }
      default:
        return void (await i.update({ content: 'その券は、使う場面で自動で使います。', components: [] }));
    }
  }

  /** 自由な券を使う: 運営に知らせて、運営が対応する */
  private async useCustomTicket(i: StringSelectMenuInteraction<'cached'> | ButtonInteraction<'cached'>, ticketId: number): Promise<void> {
    const r = await useCustom(this.db, i.user.id, ticketId);
    if (r.status === 'no_ticket') return void (await i.update({ content: 'その券を持っていません。', components: [] }));
    const cfg = this.cfg();
    const target = cfg.bell.channelId ?? cfg.channels.log;
    const ch = target ? i.guild.channels.cache.get(target) : undefined;
    if (ch?.isSendable()) {
      await ch
        .send({
          embeds: [
            {
              title: '🎟 自由な券が使われました',
              description: [
                `<@${i.user.id}> さんが **${customName(r.ticket)}** を使いました（#${r.claim.id}）。`,
                r.ticket.note ? `-# ${r.ticket.note}` : '',
                '対応したら、社務所Web の「🎁 物御籤」→「🎊 運営が対応するもの」で「渡した」を押してください。',
              ]
                .filter(Boolean)
                .join('\n'),
              color: 0xd7003a,
            },
          ],
          allowedMentions: { parse: [] },
        })
        .catch((err: unknown) => logger.warn({ err }, 'custom ticket notify failed'));
    }
    await i.update({ content: `${customName(r.ticket)} を使いました。運営に知らせたので、連絡をお待ちください。`, components: [] });
  }

  /** 🎴 おみくじもう 1 回券（その日のおみくじをもう 1 回。結果は #おみくじ に） */
  private async omikujiExtra(i: StringSelectMenuInteraction<'cached'> | ButtonInteraction<'cached'>): Promise<string> {
    const cfg = this.cfg();
    const now = new Date();
    const today = await omikujiToday(this.db, i.user.id, now);
    if (!today.drawn) return '先に今日のおみくじを引いてください（券は使っていません）。';
    if (today.extraUsed) return '今日の「もう 1 回」はもう使いました（券は使っていません）。また明日どうぞ。';
    const blocked = omikujiVoiceBlock(cfg.economy, i.member);
    if (blocked) return `${blocked}（券は使っていません）`;
    if (!(await useTicket(this.db, i.user.id, 'omikuji_extra'))) return '🎴 おみくじもう 1 回券がありません。';
    const d = await drawOmikuji(this.db, cfg.economy, i.user.id, now, Math.random, { extra: true, special: cfg.omikujiSpecial, texts: cfg.omikujiTexts });
    if (d.status !== 'drawn') {
      await addTickets(this.db, i.user.id, 'omikuji_extra', 1);
      return '今日の「もう 1 回」はもう使いました（券は戻しました）。';
    }
    const channel = this.omikujiChannel(i.guild);
    // 演出は待たずに先へ（券を使った人への返事を遅らせない）。#慶事 は演出のあとで
    if (channel)
      void revealOmikuji(this.db, cfg, d, i.member.displayName, (p) => channel.send(p), { memberId: i.user.id, suffix: '（もう 1 回）' })
        .catch(() => undefined)
        .then(() => announceSpecial(this.db, i.guild, cfg, i.user.id, d.fortune));
    else await announceSpecial(this.db, i.guild, cfg, i.user.id, d.fortune);
    return `🎴 もう 1 回引きました: **${d.fortune.name}**${channel ? `（<#${channel.id}> に出しました）` : ''}`;
  }

  /** 💝 贈り券: 相手に物御籤の無料券 */
  private async gift(i: UserSelectMenuInteraction<'cached'>): Promise<void> {
    const toId = i.values[0];
    if (!toId || i.users.get(toId)?.bot || !i.members.get(toId)) return void (await i.update({ content: 'その方には贈れません（BOT や、サーバーにいない方）。', components: [] }));
    const r = await giftGacha(this.db, i.user.id, toId);
    if (r === 'self') return void (await i.update({ content: '自分には贈れません。', components: [] }));
    if (r === 'no_ticket') return void (await i.update({ content: '💝 物御籤の贈り券がありません。', components: [] }));
    await i.client.users
      .send(toId, `💝 ${i.member.displayName} さんから、物御籤の無料券が届きました（咲楽ノ宮）。\n\`/物御籤\` の「🎫 無料券で引く」から、タダで 1 回引けます。`)
      .catch(() => undefined);
    await i.update({ content: `💝 <@${toId}> さんに、物御籤の無料券を贈りました。`, components: [], allowedMentions: { parse: [] } });
  }

  /** 🏷 名前の飾り（7 日間、名前の前に絵文字） */
  private async deco(i: ModalSubmitInteraction<'cached'>): Promise<void> {
    const emoji = i.fields.getTextInputValue('emoji').trim();
    if (!validDecoEmoji(emoji)) return void (await i.reply({ content: '絵文字を 1 つだけ入れてください（例: 🌸）。券は使っていません。', ...EPHEMERAL }));
    if (!i.member.manageable) return void (await i.reply({ content: 'あなたの名前は BOT から変えられません（サーバーの持ち主・BOT より上の役職）。券は使っていません。', ...EPHEMERAL }));
    const previous = await nameDecoOf(this.db, i.user.id);
    const active = previous && previous.until > new Date();
    // 飾っている最中なら、覚えている元の名前を使う
    const current = i.member.nickname;
    const r = await startNameDeco(this.db, i.user.id, emoji, current);
    if (r.status === 'no_ticket') return void (await i.reply({ content: '🏷 名前の飾り札がありません。', ...EPHEMERAL }));
    const base = active ? (previous.baseNick ?? i.member.user.displayName) : (current ?? i.member.user.displayName);
    try {
      await i.member.setNickname(decoratedNick(emoji, base), '名前の飾り札');
    } catch (err) {
      logger.warn({ err }, 'name deco failed');
      await cancelNameDeco(this.db, i.user.id, previous);
      return void (await i.reply({ content: '名前を変えられませんでした（券は戻しました）。神職に知らせてください（BOT の「ニックネームの管理」権限）。', ...EPHEMERAL }));
    }
    await i.reply({ content: `🏷 名前を「${decoratedNick(emoji, base)}」にしました。<t:${Math.floor(r.until.getTime() / 1000)}:f> に元に戻ります。`, ...EPHEMERAL });
  }

  /** 10 分ごと: 期限が来た名前の飾りを外して、元の名前に戻す */
  async tick(now = new Date()): Promise<void> {
    const guild = this.guild;
    if (!guild) return;
    for (const d of await dueNameDecos(this.db, now)) {
      const m = await guild.members.fetch(d.memberId).catch(() => undefined);
      // 飾った名前のままなら戻す（運営が変えていたらそのまま）
      if (m?.nickname?.startsWith(d.emoji)) await m.setNickname(d.baseNick, '名前の飾りの期限').catch((err: unknown) => logger.warn({ err }, 'name deco restore failed'));
      await endNameDeco(this.db, d.memberId);
    }
  }
}

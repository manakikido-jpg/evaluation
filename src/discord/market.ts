import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  FileUploadBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Attachment,
  type ButtonInteraction,
  type Guild,
  type GuildMember,
  type Interaction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { adminLevelOf, type GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { MarketListing, MarketOrder, MarketRequest } from '../db/schema.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { audit } from '../services/audit.js';
import {
  acceptBid,
  acceptOffer,
  activeOrders,
  autoReleaseOrders,
  bidCount,
  bidRequest,
  buyListing,
  CALL_KINDS,
  closeListing,
  closeRequest,
  createListing,
  createRequest,
  declineOffer,
  disputeOrder,
  expireOffers,
  expireStandby,
  getBid,
  getListing,
  getOffer,
  getOrder,
  getRequest,
  isCallKind,
  isMarketCategory,
  isStandby,
  kindLabel,
  makeOffer,
  MARKET_CAPACITY_MAX,
  MARKET_CATEGORIES,
  MARKET_PRICE_MAX,
  NOSHOW_MINUTES,
  OFFER_DAYS,
  openListingsOf,
  orderInfo,
  parseJstTime,
  pendingOffers,
  rateOrder,
  releaseOrder,
  reportNoShow,
  requestBids,
  REQUESTS_PER_MEMBER,
  scheduleOrder,
  sellerRating,
  setImage,
  setListingMessage,
  setOrderThread,
  setRequestMessage,
  setStandby,
  standbyListings,
  STANDBY_MINUTES,
  type AcceptResult,
  type CallKind,
  type MarketCategory,
  type OrderInfo,
} from '../services/market.js';
import { getMember } from '../services/members.js';
import { panelMessage } from './panels.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const SHU = 0xd7003a;
const MOEGI = 0x2f7d6d;
const GREY = 0x888888;
/** 上げられる画像の大きさ */
const IMAGE_MAX = 10 * 1024 * 1024;
const btn = (id: string, label: string, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label.slice(0, 80)).setStyle(style);
const row = (...b: ButtonBuilder[]) => new ActionRowBuilder<ButtonBuilder>().addComponents(b);
const fmt = (n: number) => n.toLocaleString('ja-JP');
const unix = (d: Date) => Math.floor(d.getTime() / 1000);
export const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));
const CATS = Object.entries(MARKET_CATEGORIES) as [MarketCategory, (typeof MARKET_CATEGORIES)[MarketCategory]][];
const KINDS = Object.entries(CALL_KINDS) as [CallKind, (typeof CALL_KINDS)[CallKind]][];

/** 「1,000」「１０００枚」などを数に（空なら undefined） */
export function toAmount(raw: string): number | undefined {
  const t = raw
    .trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,，\s枚銭円]/g, '');
  return t ? Number(t) : undefined;
}

export type CardExtras = { rating?: { avg: number; count: number }; active?: number; now?: Date };

/** #市場 に出す出品のカード */
export function listingCard(l: MarketListing, cfg: GuildConfig, extras: CardExtras = {}) {
  const c = MARKET_CATEGORIES[l.category as MarketCategory] ?? MARKET_CATEGORIES.other;
  const open = l.status === 'open';
  const e = cfg.economy;
  const now = extras.now ?? new Date();
  const standby = open && l.category === 'call' && isStandby(l, now);
  const kind = l.category === 'call' && isCallKind(l.subcategory) ? CALL_KINDS[l.subcategory] : undefined;
  const offer = l.pricing === 'offer';
  const active = extras.active ?? 0;
  const full = l.capacity > 0 && active >= l.capacity;
  const rating = extras.rating;
  return {
    embeds: [
      {
        title: `${standby ? '🟢 ' : ''}${c.emoji} ${l.title}${open ? '' : '（受付終了）'}`.slice(0, 256),
        description: [
          standby ? `🟢 **今すぐ通話できます**（<t:${unix(l.standbyUntil!)}:R> まで）` : null,
          `出品: <@${l.sellerId}> ・ ${kindLabel(l.category, l.subcategory)}${c.adultOnly ? '（18 歳以上どうし）' : ''}`,
          rating?.count ? `評価: ⭐ **${rating.avg.toFixed(1)}**（${fmt(rating.count)} 件）` : null,
          offer ? `値段: 💬 **${e.currencyEmoji} ${fmt(l.price)} 枚から**（値段の提案を受けます）` : `値段: **${e.currencyEmoji} ${fmt(l.price)} 枚**`,
          l.capacity > 0 ? `受付: ${fmt(active)} / ${fmt(l.capacity)} 件${full ? '（いまいっぱいです）' : ''}` : null,
          kind?.note ? `-# ${kind.emoji} ${kind.note}` : null,
          '',
          l.description,
        ]
          .filter((x) => x !== null)
          .join('\n')
          .trim(),
        color: !open ? GREY : standby ? 0x2ecc71 : SHU,
        ...(l.imageUrl ? { image: { url: l.imageUrl } } : {}),
        footer: { text: `出品 #${l.id}` },
      },
    ],
    components: open
      ? [
          row(
            offer ? btn(`market:offer:${l.id}`, '💬 値段を提案する', ButtonStyle.Primary) : btn(`market:buy:${l.id}`, '買う', ButtonStyle.Primary),
            ...(offer ? [btn(`market:offers:${l.id}`, '📬 届いた提案（出品者）')] : []),
            ...(l.category === 'call' ? [btn(`market:sb:${l.id}`, standby ? '待機をやめる（出品者）' : '🟢 待機中にする（出品者）', standby ? ButtonStyle.Secondary : ButtonStyle.Success)] : []),
            btn(`market:close:${l.id}`, '受付を終える'),
          ),
        ]
      : [],
    allowedMentions: { parse: [] as const },
  };
}

/** #市場 に出す依頼のカード */
export function requestCard(r: MarketRequest, cfg: GuildConfig, bids = 0) {
  const c = MARKET_CATEGORIES[r.category as MarketCategory] ?? MARKET_CATEGORIES.other;
  const open = r.status === 'open';
  const e = cfg.economy;
  const kind = r.category === 'call' && isCallKind(r.subcategory) ? CALL_KINDS[r.subcategory] : undefined;
  return {
    embeds: [
      {
        title: `📝 依頼: ${r.title}${open ? '' : r.status === 'matched' ? '（決まりました）' : '（締め切り）'}`.slice(0, 256),
        description: [
          `依頼: <@${r.requesterId}> ・ ${kindLabel(r.category, r.subcategory)}${c.adultOnly ? '（18 歳以上どうし）' : ''}`,
          `予算: **${e.currencyEmoji} ${fmt(r.budget)} 枚**（目安）`,
          open ? `✋ 手を挙げた人: ${fmt(bids)} 人` : null,
          kind?.note ? `-# ${kind.emoji} ${kind.note}` : null,
          '',
          r.description || null,
          ...(open ? ['', `-# 開業権利を持つ方は「引き受ける」から値段と一言を出せます。依頼した人が選ぶと取引になります（${e.currencyName}は社務所が預かります）`] : []),
        ]
          .filter((x) => x !== null)
          .join('\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim(),
        color: open ? MOEGI : GREY,
        ...(r.imageUrl ? { image: { url: r.imageUrl } } : {}),
        footer: { text: `依頼 #${r.id}` },
      },
    ],
    components: open
      ? [row(btn(`market:bid:${r.id}`, '✋ 引き受ける', ButtonStyle.Primary), btn(`market:bids:${r.id}`, '👀 手を挙げた人（依頼した人）'), btn(`market:rclose:${r.id}`, '締め切る'))]
      : [],
    allowedMentions: { parse: [] as const },
  };
}

/** 取引のスレッドに出すメッセージ */
export function orderMessage(o: MarketOrder, info: OrderInfo, cfg: GuildConfig) {
  const e = cfg.economy;
  const call = info.category === 'call';
  const status = {
    paid: '📦 預かり中',
    completed: '✅ 取引完了',
    disputed: o.disputeKind === 'noshow' ? '🚫 来なかった（運営が確認します）' : '⚠️ 問題あり（運営が確認します）',
    refunded: '↩️ 返金しました',
  }[o.status];
  const paid = o.status === 'paid';
  return {
    content: `<@${o.buyerId}> <@${o.sellerId}>`,
    embeds: [
      {
        title: `取引 #${o.id}: ${info.title}`.slice(0, 256),
        description: [
          `${kindLabel(info.category, info.subcategory)}${o.requestId ? `（依頼 #${o.requestId} から）` : ''}`,
          `買った人: <@${o.buyerId}> ・ 売った人: <@${o.sellerId}>`,
          `値段: ${e.currencyEmoji} ${fmt(o.price)} 枚（売った人には手数料 ${fmt(o.fee)} 枚を引いた ${fmt(o.price - o.fee)} 枚）`,
          `状態: **${status}**`,
          call && o.scheduledAt ? `📅 予定: <t:${unix(o.scheduledAt)}:F>（<t:${unix(o.scheduledAt)}:R>）` : call && paid ? '📅 予定: まだ決まっていません（「予定を決める」から）' : '',
          o.rating ? `⭐ 評価: ${stars(o.rating)}${o.review ? `「${o.review}」` : ''}` : '',
          '',
          paid
            ? `${e.currencyName}は社務所が預かっています。受け取ったら「受け取った」を押してください。<t:${unix(o.autoReleaseAt)}:R> までに押されなければ、売った人に渡します。困ったときは「問題あり」を。`
            : '',
          paid && call ? `-# 予定の時刻から ${NOSHOW_MINUTES} 分たっても通話が始まらないときは「来なかった」を押してください。運営が確かめて返金します` : '',
          o.status === 'completed' && o.rating === null ? '-# よければ「評価する」から ⭐ を付けてください（売った人のカードに平均が出ます）' : '',
          '-# 本物のお金のやり取り・性的なものの売り買いは禁止です（しきたり）',
        ]
          .filter(Boolean)
          .join('\n'),
        color: SHU,
      },
    ],
    components: paid
      ? [
          row(
            btn(`market:done:${o.id}`, '受け取った', ButtonStyle.Success),
            btn(`market:problem:${o.id}`, '問題あり', ButtonStyle.Danger),
            ...(call ? [btn(`market:sched:${o.id}`, '📅 予定を決める'), btn(`market:noshow:${o.id}`, '🚫 来なかった', ButtonStyle.Danger)] : []),
          ),
        ]
      : o.status === 'completed' && o.rating === null
        ? [row(btn(`market:rate:${o.id}`, '⭐ 評価する', ButtonStyle.Primary))]
        : [],
  };
}

/** 入力の値（古い画面から送られて欄がないときは空） */
const textOf = (i: ModalSubmitInteraction, id: string) => {
  try {
    return i.fields.getTextInputValue(id);
  } catch {
    return '';
  }
};

const imageName = (base: string, a: Attachment) => {
  const ext = /\.(png|jpe?g|gif|webp)$/i.exec(a.name)?.[1]?.toLowerCase() ?? 'png';
  return `${base}.${ext}`;
};

export class MarketApp {
  private guild?: Guild;

  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
    private readonly discord: DiscordActions,
  ) {}

  attach(guild: Guild): void {
    this.guild = guild;
  }

  /** 置いてある市場のパネルを、今のボタン（依頼の募集・今すぐ通話）に書き換える。同じなら何もしない */
  async refreshPanels(guild: Guild): Promise<number> {
    const cfg = this.cfg();
    const next = panelMessage('market', { coinName: cfg.economy.currencyName });
    const want = next.components.flatMap((r) => r.components.map((b) => b.custom_id)).join(',');
    let edited = 0;
    const places = guild.channels.cache.filter((c) => c.type === ChannelType.GuildText && (c.id === cfg.channels.market || c.name.includes('市場')));
    for (const ch of places.values()) {
      if (ch.type !== ChannelType.GuildText) continue;
      const msgs = await ch.messages.fetch({ limit: 50 }).catch(() => undefined);
      for (const m of msgs?.values() ?? []) {
        if (m.author.id !== guild.client.user.id) continue;
        const rows = m.components.map((r) => r.toJSON()) as { components?: { custom_id?: string }[] }[];
        const ids = rows.flatMap((r) => r.components ?? []).map((b) => b.custom_id);
        if (!ids.includes('market:new')) continue;
        if (ids.join(',') === want && m.embeds[0]?.description === next.embeds[0]?.description) continue;
        await m.edit(next).then(() => edited++).catch((err: unknown) => logger.warn({ err, channelId: ch.id }, 'market panel refresh failed'));
      }
    }
    return edited;
  }

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    if (!(interaction.isButton() || interaction.isModalSubmit()) || !interaction.customId.startsWith('market:')) return;
    const [, action, a, b, c] = interaction.customId.split(':');
    try {
      if (interaction.isButton()) {
        const i = interaction;
        // 出品の流れ: 種類 → （通話の種類）→ 値段の決め方 → 入力
        if (action === 'new') return await this.pickCategory(i, 'listing');
        if (action === 'req') return await this.pickCategory(i, 'request');
        if (action === 'standby') return await this.standbyList(i);
        if (action === 'cat' && isMarketCategory(a)) return await this.afterCategory(i, 'listing', a);
        if (action === 'rcat' && isMarketCategory(a)) return await this.afterCategory(i, 'request', a);
        if (action === 'kind' && isCallKind(a)) return await this.pickPricing(i, 'call', a);
        if (action === 'rkind' && isCallKind(a)) return await this.requestModal(i, 'call', a);
        if (action === 'form' && isMarketCategory(a) && (c === 'fixed' || c === 'offer')) return await this.listingModal(i, a, isCallKind(b) ? b : null, c);
        const id = Number(a);
        if (!Number.isSafeInteger(id)) return;
        if (action === 'buy') return await this.confirmBuy(i, id);
        if (action === 'buyok') return await this.buy(i, id);
        if (action === 'close') return await this.close(i, id);
        if (action === 'offer') return await this.offerModal(i, id);
        if (action === 'offers') return await this.showOffers(i, id);
        if (action === 'oaccept') return await this.acceptOffer(i, id);
        if (action === 'odecline') return await this.declineOffer(i, id);
        if (action === 'sb') return await this.toggleStandby(i, id);
        if (action === 'done') return await this.done(i, id);
        if (action === 'problem') return await this.problem(i, id);
        if (action === 'sched') return await this.scheduleModal(i, id);
        if (action === 'noshow') return await this.noShow(i, id);
        if (action === 'rate') return await this.rateModal(i, id);
        if (action === 'bid') return await this.bidModal(i, id);
        if (action === 'bids') return await this.showBids(i, id);
        if (action === 'baccept') return await this.acceptBid(i, id);
        if (action === 'rclose') return await this.closeRequest(i, id);
      } else {
        const i = interaction;
        if (action === 'modal' && isMarketCategory(a)) return await this.submitListing(i, a, isCallKind(b) ? b : null, c === 'offer' ? 'offer' : 'fixed');
        if (action === 'rmodal' && isMarketCategory(a)) return await this.submitRequest(i, a, isCallKind(b) ? b : null);
        const id = Number(a);
        if (!Number.isSafeInteger(id)) return;
        if (action === 'offermodal') return await this.submitOffer(i, id);
        if (action === 'schedmodal') return await this.submitSchedule(i, id);
        if (action === 'ratemodal') return await this.submitRating(i, id);
        if (action === 'bidmodal') return await this.submitBid(i, id);
      }
    } catch (err) {
      logger.warn({ err }, 'market failed');
      const content = 'うまくいきませんでした。時間をおいてもう一度お試しください。';
      await (interaction.deferred || interaction.replied ? interaction.followUp({ content, ...EPHEMERAL }) : interaction.reply({ content, ...EPHEMERAL })).catch(() => undefined);
    }
  }

  private isStaff(m: GuildMember): boolean {
    return Boolean(adminLevelOf(this.cfg(), [...m.roles.cache.keys()]));
  }

  private isMerchant(m: GuildMember): boolean {
    const merchant = this.cfg().roles.merchant;
    return Boolean(merchant && m.roles.cache.has(merchant));
  }

  private get coin() {
    return this.cfg().economy.currencyName;
  }

  private marketChannel() {
    const id = this.cfg().channels.market;
    const ch = id ? this.guild?.channels.cache.get(id) : undefined;
    return ch?.isSendable() && ch.isTextBased() ? ch : undefined;
  }

  /** カードに出す評価・受付の数も合わせて */
  private async card(l: MarketListing) {
    const [rating, active] = await Promise.all([sellerRating(this.db, l.sellerId), activeOrders(this.db, l.id)]);
    return listingCard(l, this.cfg(), { rating, active });
  }

  /** #市場 のカードを直す（なくても構わない） */
  private async refreshListing(l: MarketListing | undefined): Promise<void> {
    if (!l?.channelId || !l.messageId) return;
    const ch = this.guild?.channels.cache.get(l.channelId);
    if (!ch?.isTextBased()) return;
    await ch.messages.edit(l.messageId, await this.card(l)).catch((err) => logger.debug({ err }, 'market card edit failed'));
  }

  private async refreshRequest(r: MarketRequest | undefined): Promise<void> {
    if (!r?.channelId || !r.messageId) return;
    const ch = this.guild?.channels.cache.get(r.channelId);
    if (!ch?.isTextBased()) return;
    await ch.messages.edit(r.messageId, requestCard(r, this.cfg(), await bidCount(this.db, r.id))).catch((err) => logger.debug({ err }, 'market request edit failed'));
  }

  /** モーダルで上げた画像（なし: undefined、画像でない・大きすぎる: 'bad'） */
  private uploaded(i: ModalSubmitInteraction<'cached'>, id: string): Attachment | 'bad' | undefined {
    let a: Attachment | undefined;
    try {
      a = i.fields.getUploadedFiles(id, false)?.first();
    } catch {
      return undefined;
    }
    if (!a) return undefined;
    if (!a.contentType?.startsWith('image/') || a.size > IMAGE_MAX) return 'bad';
    return a;
  }

  // ───────── 出品・依頼の種類 ─────────

  private async pickCategory(i: ButtonInteraction<'cached'>, mode: 'listing' | 'request'): Promise<void> {
    if (mode === 'listing' && !this.isMerchant(i.member)) {
      return void (await i.reply({ content: '🏪 出品するには「開業権利」が要ります（#授与所 の授与品から受けられます）。', ...EPHEMERAL }));
    }
    await i.reply({
      content:
        mode === 'listing'
          ? '何を出品しますか？（性的なもの・本物のお金のやり取りは出品できません）'
          : `📝 どんな依頼を出しますか？ 開業権利を持つ方が手を挙げ、あなたが選ぶと取引になります（1 人 ${REQUESTS_PER_MEMBER} 件まで）。`,
      components: [row(...CATS.map(([k, c]) => btn(`market:${mode === 'listing' ? 'cat' : 'rcat'}:${k}`, `${c.emoji} ${c.label}`)))],
      ...EPHEMERAL,
    });
  }

  private async afterCategory(i: ButtonInteraction<'cached'>, mode: 'listing' | 'request', cat: MarketCategory): Promise<void> {
    if (cat === 'call') {
      if ((await getMember(this.db, i.user.id))?.ageGroup !== 'adult') return void (await i.update({ content: '📞 通話は 18 歳以上の方だけです。', components: [] }));
      return void (await i.update({
        content: ['📞 どんな通話ですか？', `-# ${CALL_KINDS.care.emoji} ${CALL_KINDS.care.label}は${CALL_KINDS.care.note}`].join('\n'),
        components: [row(...KINDS.map(([k, c]) => btn(`market:${mode === 'listing' ? 'kind' : 'rkind'}:${k}`, `${c.emoji} ${c.label}`)))],
      }));
    }
    if (mode === 'request') return this.requestModal(i, cat, null);
    return this.pickPricing(i, cat, null);
  }

  private async pickPricing(i: ButtonInteraction<'cached'>, cat: MarketCategory, sub: CallKind | null): Promise<void> {
    const key = `${cat}:${sub ?? '-'}`;
    await i.update({
      content: [
        `${kindLabel(cat, sub)} ・ 値段の決め方を選んでください。`,
        '・**値段を決める**: その値段で、押した人がすぐ買えます',
        '・**値段の提案を受ける**: 「○○枚から」と最低額だけ決め、買いたい人が「△△枚でお願いしたい」と出します。あなたが「受ける」を押すと取引になります',
      ].join('\n'),
      components: [row(btn(`market:form:${key}:fixed`, '値段を決める', ButtonStyle.Primary), btn(`market:form:${key}:offer`, '💬 値段の提案を受ける', ButtonStyle.Primary))],
    });
  }

  private async listingModal(i: ButtonInteraction<'cached'>, cat: MarketCategory, sub: CallKind | null, mode: 'fixed' | 'offer'): Promise<void> {
    const text = (id: string, style: TextInputStyle, max: number, required: boolean, placeholder = '') =>
      new TextInputBuilder().setCustomId(id).setStyle(style).setMaxLength(max).setRequired(required).setPlaceholder(placeholder);
    const label = (l: string, d?: string) => {
      const b = new LabelBuilder().setLabel(l);
      return d ? b.setDescription(d) : b;
    };
    await i.showModal(
      new ModalBuilder()
        .setCustomId(`market:modal:${cat}:${sub ?? '-'}:${mode}`)
        .setTitle(`出品（${sub ? CALL_KINDS[sub].label : MARKET_CATEGORIES[cat].label}）`.slice(0, 45))
        .addLabelComponents(
          label('品名').setTextInputComponent(text('title', TextInputStyle.Short, 60, true, cat === 'call' ? '例: 夜のおしゃべり 30 分' : '例: アイコンを描きます')),
          label('説明（内容・納期・注意など）').setTextInputComponent(text('description', TextInputStyle.Paragraph, 1000, false)),
          label(mode === 'offer' ? `最低額（${this.coin}・この値段から提案を受けます）` : `値段（${this.coin}）`, `1〜${fmt(MARKET_PRICE_MAX)}`).setTextInputComponent(
            text('price', TextInputStyle.Short, 9, true, '例: 1000'),
          ),
          label('受付の上限（同時に受ける数）', `空ならいくつでも。1〜${MARKET_CAPACITY_MAX}`).setTextInputComponent(text('capacity', TextInputStyle.Short, 2, false, '例: 3')),
          label('画像（なくても大丈夫）', '見本・サンプルの画像を 1 枚').setFileUploadComponent(new FileUploadBuilder().setCustomId('image').setRequired(false).setMaxValues(1)),
        ),
    );
  }

  private async submitListing(i: ModalSubmitInteraction<'cached'>, cat: MarketCategory, sub: CallKind | null, mode: 'fixed' | 'offer'): Promise<void> {
    await i.deferReply(EPHEMERAL);
    const cfg = this.cfg();
    const image = this.uploaded(i, 'image');
    if (image === 'bad') return void (await i.editReply('画像は 10MB までの画像ファイル（png・jpg・gif・webp）にしてください。'));
    const name = image ? imageName('card', image) : undefined;
    const r = await createListing(this.db, cfg, { id: i.user.id, roleIds: [...i.member.roles.cache.keys()] }, {
      category: cat,
      subcategory: sub,
      title: i.fields.getTextInputValue('title'),
      description: textOf(i, 'description'),
      price: toAmount(i.fields.getTextInputValue('price')) ?? NaN,
      pricing: mode,
      capacity: toAmount(textOf(i, 'capacity')) ?? 0,
      imageUrl: name ? `attachment://${name}` : null,
    });
    if (r.status !== 'ok') {
      const text = {
        disabled: '市場はまだ準備中です。',
        no_license: '🏪 出品するには「開業権利」が要ります。',
        adult_only: '通話の出品は 18 歳以上の方だけです。',
        invalid: `入力を確かめてください（品名は 60 文字まで、値段は 1〜${fmt(MARKET_PRICE_MAX)}、受付の上限は 0〜${MARKET_CAPACITY_MAX}）。`,
      }[r.status];
      return void (await i.editReply(text));
    }
    const channel = this.marketChannel();
    if (!channel) return void (await i.editReply('#市場 が見つかりません。神職に知らせてください。'));
    let listing = r.listing;
    let msg;
    try {
      msg = await channel.send({ ...(await this.card(listing)), ...(image && name ? { files: [{ attachment: image.url, name }] } : {}) });
    } catch (err) {
      // 画像が上げられなかったときは、画像なしで出す
      if (!image) throw err;
      logger.warn({ err }, 'market image failed');
      await setImage(this.db, 'listing', listing.id, null);
      listing = { ...listing, imageUrl: null };
      msg = await channel.send(await this.card(listing));
    }
    await setListingMessage(this.db, listing.id, channel.id, msg.id);
    await audit(this.db, { actorId: i.user.id, action: 'market.list', detail: { listingId: listing.id, category: cat, sub, pricing: mode, price: listing.price }, via: 'discord' });
    await i.editReply(
      [
        `出品しました（出品 #${listing.id}）: ${msg.url}`,
        mode === 'offer' ? '値段の提案が届くと DM でお知らせします。カードの「📬 届いた提案」から受けるか断るかを選んでください。' : '売れると、やり取りのスレッドができて知らせが届きます。',
        cat === 'call' ? `📞 いま通話できるときは、カードの「🟢 待機中にする」を押すと ${STANDBY_MINUTES} 分のあいだ目立つように出ます。` : '',
        `手数料は ${cfg.market.feePercent}% です。`,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  private async close(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const l = await getListing(this.db, id);
    if (!l) return;
    const staff = this.isStaff(i.member);
    if (l.sellerId !== i.user.id && !staff) return void (await i.reply({ content: '受付を終えられるのは、出品した人と運営だけです。', ...EPHEMERAL }));
    const closed = await closeListing(this.db, id, l.sellerId === i.user.id ? 'seller' : 'staff');
    if (!closed) return void (await i.reply({ content: 'もう受付を終えています。', ...EPHEMERAL }));
    await i.update(await this.card(closed));
    await audit(this.db, { actorId: i.user.id, targetId: l.sellerId, action: 'market.close', detail: { listingId: id, by: closed.status }, via: 'discord' });
  }

  // ───────── 買う ─────────

  private async confirmBuy(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const l = await getListing(this.db, id);
    if (!l || l.status !== 'open') return void (await i.reply({ content: 'この出品は受付を終えています。', ...EPHEMERAL }));
    if (l.sellerId === i.user.id) return void (await i.reply({ content: '自分の出品は買えません。', ...EPHEMERAL }));
    if (l.pricing === 'offer') return this.offerModal(i, id);
    const e = this.cfg().economy;
    await i.reply({
      content: [
        `「${l.title}」を ${e.currencyEmoji} **${fmt(l.price)} 枚** で買いますか？`,
        `-# ${e.currencyName}は社務所が預かり、「受け取った」を押すか ${this.cfg().market.autoReleaseDays} 日たつと売った人に渡します。困ったときは「問題あり」で運営が確認します。`,
      ].join('\n'),
      components: [row(btn(`market:buyok:${id}`, `${fmt(l.price)} 枚で買う`, ButtonStyle.Success))],
      ...EPHEMERAL,
    });
  }

  private async buy(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    await i.deferUpdate();
    const cfg = this.cfg();
    const r = await buyListing(this.db, cfg, id, i.user.id);
    if (r.status !== 'ok') {
      const text = {
        not_open: 'この出品は受付を終えています。',
        self: '自分の出品は買えません。',
        adult_only: '通話の売り買いは、18 歳以上どうしだけです。',
        full: 'いまは受付の上限に達しています。ほかの取引が終わるまで少し待ってください。',
        offer_only: 'この出品は値段の提案から買います。カードの「💬 値段を提案する」を押してください。',
        insufficient: r.status === 'insufficient' ? `${this.coin}が足りません（${fmt(r.price)} 枚必要・いま ${fmt(r.balance)} 枚）。` : '',
      }[r.status];
      return void (await i.editReply({ content: text, components: [] }));
    }
    const l = await getListing(this.db, id);
    const thread = await this.openThread(r.order);
    await audit(this.db, { actorId: i.user.id, targetId: r.order.sellerId, action: 'market.buy', detail: { orderId: r.order.id, listingId: id, price: r.order.price }, via: 'discord' });
    await i.editReply({
      content: `買いました（取引 #${r.order.id}）。${thread ? `やり取りは <#${thread}> で。` : '売った人と DM でやり取りしてください。'} 残り ${fmt(r.balance)} 枚。`,
      components: [],
    });
    await this.discord.sendDm(r.order.sellerId, `🏪 「${l?.title ?? ''}」が売れました（取引 #${r.order.id}・<@${r.order.buyerId}> さん）。${thread ? `<#${thread}> でやり取りしてください。` : ''}`);
    await this.refreshListing(l);
  }

  /** 取引のやり取りの場（#市場 の中の非公開スレッド。運営も見られる） */
  private async openThread(o: MarketOrder): Promise<string | undefined> {
    const cfg = this.cfg();
    const channel = cfg.channels.market ? this.guild?.channels.cache.get(cfg.channels.market) : undefined;
    if (!channel || channel.type !== ChannelType.GuildText) return undefined;
    try {
      const info = await orderInfo(this.db, o);
      const thread = await channel.threads.create({
        name: `取引 #${o.id} ${info.title}`.slice(0, 90),
        type: ChannelType.PrivateThread,
        invitable: false,
        reason: '市場の取引',
      });
      await thread.members.add(o.buyerId);
      await thread.members.add(o.sellerId);
      await thread.send({ ...orderMessage(o, info, cfg), allowedMentions: { users: [o.buyerId, o.sellerId] } });
      await setOrderThread(this.db, o.id, thread.id);
      return thread.id;
    } catch (err) {
      logger.warn({ err }, 'market thread failed');
      return undefined;
    }
  }

  /** 取引のスレッドに、いまの状態を出し直す（期限で渡したときなど） */
  private async postOrder(o: MarketOrder): Promise<void> {
    if (!o.threadId) return;
    const thread = await this.guild?.channels.fetch(o.threadId).catch(() => null);
    if (!thread?.isSendable()) return;
    await thread.send({ ...orderMessage(o, await orderInfo(this.db, o), this.cfg()), allowedMentions: { parse: [] } }).catch(() => undefined);
  }

  // ───────── 💬 値段の提案 ─────────

  private async offerModal(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const l = await getListing(this.db, id);
    if (!l || l.status !== 'open') return void (await i.reply({ content: 'この出品は受付を終えています。', ...EPHEMERAL }));
    if (l.sellerId === i.user.id) return void (await i.reply({ content: '自分の出品には提案できません。', ...EPHEMERAL }));
    if (l.pricing !== 'offer') return this.confirmBuy(i, id);
    await i.showModal(
      new ModalBuilder()
        .setCustomId(`market:offermodal:${id}`)
        .setTitle('💬 値段を提案する')
        .addLabelComponents(
          new LabelBuilder()
            .setLabel(`いくらでお願いしたいですか（${this.coin}）`)
            .setDescription(`${fmt(l.price)} 枚から。受けてもらえたら、この値段で${this.coin}を預かります`)
            .setTextInputComponent(new TextInputBuilder().setCustomId('amount').setStyle(TextInputStyle.Short).setMaxLength(9).setRequired(true).setPlaceholder(`${l.price} 以上`)),
          new LabelBuilder()
            .setLabel('ひとこと（なくても大丈夫）')
            .setTextInputComponent(
              new TextInputBuilder().setCustomId('note').setStyle(TextInputStyle.Paragraph).setMaxLength(300).setRequired(false).setPlaceholder('例: 30 分くらい、明日の夜にお願いしたいです'),
            ),
        ),
    );
  }

  private async submitOffer(i: ModalSubmitInteraction<'cached'>, id: number): Promise<void> {
    await i.deferReply(EPHEMERAL);
    const amount = toAmount(i.fields.getTextInputValue('amount')) ?? NaN;
    const r = await makeOffer(this.db, id, i.user.id, amount, textOf(i, 'note'));
    const l = await getListing(this.db, id);
    if (r.status !== 'ok') {
      const text = {
        not_open: 'この出品は受付を終えています。',
        not_offer: 'この出品は値段が決まっています。「買う」から買ってください。',
        self: '自分の出品には提案できません。',
        adult_only: '通話の売り買いは、18 歳以上どうしだけです。',
        too_low: `${fmt(l?.price ?? 0)} 枚から提案できます。`,
        invalid: `値段は 1〜${fmt(MARKET_PRICE_MAX)}、ひとことは 300 文字までです。`,
        insufficient: r.status === 'insufficient' ? `${this.coin}が足りません（いま ${fmt(r.balance)} 枚）。提案する分の${this.coin}が要ります。` : '',
      }[r.status];
      return void (await i.editReply(text));
    }
    await i.editReply(
      `💬 「${l?.title ?? ''}」に ${this.cfg().economy.currencyEmoji} ${fmt(r.offer.amount)} 枚で提案しました。受けてもらえたら、${this.coin}を預かって取引のスレッドができます（${OFFER_DAYS} 日たっても返事がなければ取り下げます）。`,
    );
    await this.discord.sendDm(
      r.offer.sellerId,
      `💬 「${l?.title ?? ''}」に <@${r.offer.buyerId}> さんから ${fmt(r.offer.amount)} 枚の提案が届きました。#市場 のカードの「📬 届いた提案」から受けるか断るかを選んでください。${r.offer.note ? `\n> ${r.offer.note.replace(/\n/g, '\n> ')}` : ''}`,
    );
  }

  private async offersView(l: MarketListing) {
    const list = await pendingOffers(this.db, l.id);
    const e = this.cfg().economy;
    const shown = list.slice(0, 5);
    return {
      content: list.length
        ? [
            `📬 「${l.title}」に届いた提案（${fmt(list.length)} 件・高い順）`,
            ...shown.map((o, n) => `${n + 1}. <@${o.buyerId}> ・ ${e.currencyEmoji} **${fmt(o.amount)} 枚**${o.note ? ` ・「${o.note.replace(/\n/g, ' ').slice(0, 120)}」` : ''}`),
            list.length > shown.length ? `-# ほか ${fmt(list.length - shown.length)} 件（上の提案に返事をすると出てきます）` : '',
            '-# 「受ける」を押すと、その値段で買いたい人の銭を預かり、取引のスレッドができます',
          ]
            .filter(Boolean)
            .join('\n')
        : `📬 「${l.title}」に届いている提案はありません。`,
      components: shown.map((o, n) =>
        row(btn(`market:oaccept:${o.id}`, `${n + 1}. ${fmt(o.amount)} 枚で受ける`, ButtonStyle.Success), btn(`market:odecline:${o.id}`, `${n + 1}. 断る`)),
      ),
      allowedMentions: { parse: [] as const },
    };
  }

  private async showOffers(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const l = await getListing(this.db, id);
    if (!l) return;
    if (l.sellerId !== i.user.id) return void (await i.reply({ content: '届いた提案を見られるのは、出品した人だけです。提案するときは「💬 値段を提案する」を押してください。', ...EPHEMERAL }));
    await i.reply({ ...(await this.offersView(l)), ...EPHEMERAL });
  }

  private async acceptOffer(i: ButtonInteraction<'cached'>, offerId: number): Promise<void> {
    await i.deferUpdate();
    const offer = await getOffer(this.db, offerId);
    const r = await acceptOffer(this.db, this.cfg(), offerId, i.user.id);
    const l = offer ? await getListing(this.db, offer.listingId) : undefined;
    const view = l ? await this.offersView(l) : { content: '', components: [] };
    if (r.status !== 'ok') {
      if (r.status === 'insufficient' && offer) {
        await this.discord.sendDm(offer.buyerId, `💬 「${l?.title ?? ''}」への ${fmt(offer.amount)} 枚の提案は、受けてもらえましたが${this.coin}が足りなかったので取り消しになりました。`);
      }
      return void (await i.editReply({ ...view, content: `${acceptText(r, this.coin)}\n\n${view.content}` }));
    }
    const thread = await this.openThread(r.order);
    await audit(this.db, { actorId: i.user.id, targetId: r.order.buyerId, action: 'market.offer_accept', detail: { orderId: r.order.id, offerId, listingId: r.order.listingId, price: r.order.price }, via: 'discord' });
    await i.editReply({ ...view, content: `✅ ${fmt(r.order.price)} 枚の提案を受けました（取引 #${r.order.id}）。${thread ? `やり取りは <#${thread}> で。` : ''}\n\n${view.content}` });
    await this.discord.sendDm(
      r.order.buyerId,
      `💬 「${l?.title ?? ''}」への ${fmt(r.order.price)} 枚の提案を受けてもらえました（取引 #${r.order.id}）。${this.coin}は社務所が預かっています。${thread ? `<#${thread}> でやり取りしてください。` : ''}`,
    );
    await this.refreshListing(l);
  }

  private async declineOffer(i: ButtonInteraction<'cached'>, offerId: number): Promise<void> {
    const offer = await getOffer(this.db, offerId);
    if (!offer || offer.sellerId !== i.user.id) return void (await i.reply({ content: '断れるのは、出品した人だけです。', ...EPHEMERAL }));
    const done = await declineOffer(this.db, offerId, i.user.id);
    const l = await getListing(this.db, offer.listingId);
    const view = l ? await this.offersView(l) : { content: '', components: [] };
    await i.update({ ...view, content: `${done ? '断りました。' : 'この提案はもう返事が済んでいます。'}\n\n${view.content}` });
    if (done) await this.discord.sendDm(offer.buyerId, `💬 「${l?.title ?? ''}」への ${fmt(offer.amount)} 枚の提案は、今回は見送りになりました。`);
  }

  // ───────── 📞 今すぐ通話 OK ─────────

  private async toggleStandby(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const l = await getListing(this.db, id);
    if (!l || l.status !== 'open') return void (await i.reply({ content: 'この出品は受付を終えています。', ...EPHEMERAL }));
    if (l.sellerId !== i.user.id) return void (await i.reply({ content: '待機中にできるのは、出品した人だけです。', ...EPHEMERAL }));
    if (isStandby(l)) {
      const off = await setStandby(this.db, id, i.user.id, false);
      return void (await i.update(await this.card(off ?? l)));
    }
    await i.deferReply(EPHEMERAL);
    const on = await setStandby(this.db, id, i.user.id, true);
    if (!on) return void (await i.editReply('待機中にできませんでした。'));
    const url = await this.repost(on);
    await i.editReply(`🟢 ${STANDBY_MINUTES} 分のあいだ「今すぐ通話できます」にしました${url ? `（${url}）` : ''}。#市場 のいちばん下と「📞 今すぐ通話できる人」に出ます。やめるときはカードの「待機をやめる」を。`);
  }

  /** カードを #市場 のいちばん下に出し直す（画像も上げ直す） */
  private async repost(l: MarketListing): Promise<string | undefined> {
    const ch = this.marketChannel();
    if (!ch) return undefined;
    const old = l.messageId && l.channelId === ch.id ? await ch.messages.fetch(l.messageId).catch(() => undefined) : undefined;
    const a = l.imageUrl ? old?.attachments.first() : undefined;
    const body = await this.card(a ? l : { ...l, imageUrl: null });
    const msg = await ch.send({ ...body, ...(a ? { files: [{ attachment: a.url, name: a.name }] } : {}) });
    await setListingMessage(this.db, l.id, ch.id, msg.id);
    if (!a && l.imageUrl) await setImage(this.db, 'listing', l.id, null);
    await old?.delete().catch(() => undefined);
    return msg.url;
  }

  private async standbyList(i: ButtonInteraction<'cached'>): Promise<void> {
    const list = await standbyListings(this.db);
    const e = this.cfg().economy;
    const link = (l: MarketListing) => (l.channelId && l.messageId ? `https://discord.com/channels/${i.guildId}/${l.channelId}/${l.messageId}` : undefined);
    const lines = list.map((l) => {
      const url = link(l);
      const price = l.pricing === 'offer' ? `${fmt(l.price)} 枚から` : `${fmt(l.price)} 枚`;
      return `🟢 ${url ? `[${l.title}](${url})` : l.title} ・ <@${l.sellerId}> ・ ${kindLabel(l.category, l.subcategory)} ・ ${e.currencyEmoji} ${price} ・ <t:${unix(l.standbyUntil!)}:R> まで`;
    });
    await i.reply({
      content: list.length ? ['📞 **今すぐ通話できる人**', ...lines, '', '-# 通話は 18 歳以上どうしだけです'].join('\n').slice(0, 1990) : '📞 いま待機中の人はいません。',
      allowedMentions: { parse: [] },
      ...EPHEMERAL,
    });
  }

  // ───────── 受け取った・問題あり・予定・来なかった・評価 ─────────

  private async done(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const o = await getOrder(this.db, id);
    if (!o) return;
    if (o.buyerId !== i.user.id) return void (await i.reply({ content: '「受け取った」は、買った人だけが押せます。', ...EPHEMERAL }));
    const done = await releaseOrder(this.db, id, i.user.id);
    if (!done) return void (await i.reply({ content: 'この取引はもう終わっています。', ...EPHEMERAL }));
    await i.update(orderMessage(done, await orderInfo(this.db, done), this.cfg()));
    await this.discord.sendDm(done.sellerId, `🏪 取引 #${id} が完了しました。${this.cfg().economy.currencyEmoji} ${fmt(done.price - done.fee)} 枚をお渡ししました。`);
    await audit(this.db, { actorId: i.user.id, targetId: done.sellerId, action: 'market.release', detail: { orderId: id }, via: 'discord' });
    if (done.listingId) await this.refreshListing(await getListing(this.db, done.listingId));
  }

  private async problem(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const o = await getOrder(this.db, id);
    if (!o) return;
    if (o.buyerId !== i.user.id) return void (await i.reply({ content: '「問題あり」は、買った人だけが押せます。', ...EPHEMERAL }));
    const d = await disputeOrder(this.db, id);
    if (!d) return void (await i.reply({ content: 'この取引はもう終わっています。', ...EPHEMERAL }));
    await i.update(orderMessage(d, await orderInfo(this.db, d), this.cfg()));
    await audit(this.db, { actorId: i.user.id, targetId: d.sellerId, action: 'market.dispute', detail: { orderId: id }, via: 'discord' });
    await this.staffLog(`⚠️ 市場の取引 #${id} に「問題あり」が出ました。社務所Web の「市場」で確かめてください。`);
  }

  private async staffLog(content: string): Promise<void> {
    const log = this.cfg().channels.log;
    if (log) await this.discord.sendMessage(log, { content }).catch(() => undefined);
  }

  private async scheduleModal(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const o = await getOrder(this.db, id);
    if (!o || (o.buyerId !== i.user.id && o.sellerId !== i.user.id)) return void (await i.reply({ content: '予定を決められるのは、取引の 2 人だけです。', ...EPHEMERAL }));
    if (o.status !== 'paid') return void (await i.reply({ content: 'この取引はもう終わっています。', ...EPHEMERAL }));
    await i.showModal(
      new ModalBuilder()
        .setCustomId(`market:schedmodal:${id}`)
        .setTitle('📅 通話の予定')
        .addLabelComponents(
          new LabelBuilder()
            .setLabel('日時（日本時間）')
            .setDescription('「10/5 21:00」か「21:00」（今日・過ぎていれば明日）')
            .setTextInputComponent(new TextInputBuilder().setCustomId('at').setStyle(TextInputStyle.Short).setMaxLength(20).setRequired(true).setPlaceholder('例: 10/5 21:00')),
        ),
    );
  }

  private async submitSchedule(i: ModalSubmitInteraction<'cached'>, id: number): Promise<void> {
    const at = parseJstTime(i.fields.getTextInputValue('at'));
    if (!at) return void (await i.reply({ content: '日時は「10/5 21:00」か「21:00」の形で入れてください。', ...EPHEMERAL }));
    const o = await scheduleOrder(this.db, id, i.user.id, at);
    if (!o) return void (await i.reply({ content: '予定を決められませんでした（取引が終わっているかもしれません）。', ...EPHEMERAL }));
    const body = orderMessage(o, await orderInfo(this.db, o), this.cfg());
    if (i.isFromMessage()) await i.update(body);
    else await i.reply({ content: '予定を決めました。', ...EPHEMERAL });
    const other = o.buyerId === i.user.id ? o.sellerId : o.buyerId;
    await i.followUp({ content: `📅 <@${i.user.id}> さんが通話の予定を <t:${unix(at)}:F>（<t:${unix(at)}:R>）にしました。<@${other}>`, allowedMentions: { users: [other] } });
  }

  private async noShow(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const r = await reportNoShow(this.db, id, i.user.id);
    if (r.status !== 'ok') {
      const text = {
        forbidden: '「来なかった」は、買った人だけが押せます。',
        not_call: '「来なかった」は通話の取引だけです。困ったときは「問題あり」を。',
        not_paid: 'この取引はもう終わっています。',
        too_early: r.status === 'too_early' ? `予定の時刻から ${NOSHOW_MINUTES} 分たってから押せます（<t:${unix(r.at)}:R>）。` : '',
      }[r.status];
      return void (await i.reply({ content: text, ...EPHEMERAL }));
    }
    await i.update(orderMessage(r.order, await orderInfo(this.db, r.order), this.cfg()));
    await audit(this.db, { actorId: i.user.id, targetId: r.order.sellerId, action: 'market.noshow', detail: { orderId: id }, via: 'discord' });
    await this.staffLog(`🚫 市場の取引 #${id}（通話）で「来なかった」が出ました。スレッド${r.order.threadId ? ` <#${r.order.threadId}>` : ''}を見て、社務所Web の「市場」で返金か渡すかを決めてください。`);
    await this.discord.sendDm(r.order.sellerId, `🚫 取引 #${id} で、買った人から「来なかった」が出ました。運営が確かめます。事情があればスレッドに書いてください。`);
  }

  private async rateModal(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const o = await getOrder(this.db, id);
    if (!o || o.buyerId !== i.user.id) return void (await i.reply({ content: '評価できるのは、買った人だけです。', ...EPHEMERAL }));
    if (o.rating !== null) return void (await i.reply({ content: 'もう評価しています。ありがとうございました。', ...EPHEMERAL }));
    await i.showModal(
      new ModalBuilder()
        .setCustomId(`market:ratemodal:${id}`)
        .setTitle('⭐ 評価する')
        .addLabelComponents(
          new LabelBuilder().setLabel('評価').setStringSelectMenuComponent(
            new StringSelectMenuBuilder()
              .setCustomId('stars')
              .setRequired(true)
              .addOptions([5, 4, 3, 2, 1].map((n) => ({ label: `${stars(n)}（${n}）`, value: String(n), default: n === 5 }))),
          ),
          new LabelBuilder()
            .setLabel('ひとこと（なくても大丈夫）')
            .setDescription('売った人のカードには平均だけが出ます')
            .setTextInputComponent(new TextInputBuilder().setCustomId('review').setStyle(TextInputStyle.Paragraph).setMaxLength(200).setRequired(false)),
        ),
    );
  }

  private async submitRating(i: ModalSubmitInteraction<'cached'>, id: number): Promise<void> {
    const rating = Number(i.fields.getStringSelectValues('stars')[0]);
    const r = await rateOrder(this.db, id, i.user.id, rating, textOf(i, 'review'));
    if (r.status !== 'ok') {
      const text = { forbidden: '評価できるのは、買った人だけです。', not_done: '取引が終わってから評価できます。', already: 'もう評価しています。', invalid: '評価は ★1〜5 で、ひとことは 200 文字までです。' }[r.status];
      return void (await i.reply({ content: text, ...EPHEMERAL }));
    }
    const body = orderMessage(r.order, await orderInfo(this.db, r.order), this.cfg());
    if (i.isFromMessage()) await i.update(body);
    else await i.reply({ content: 'ありがとうございました。', ...EPHEMERAL });
    await audit(this.db, { actorId: i.user.id, targetId: r.order.sellerId, action: 'market.rate', detail: { orderId: id, rating }, via: 'discord' });
    await this.discord.sendDm(r.order.sellerId, `⭐ 取引 #${id} に評価が付きました: ${stars(rating)}${r.order.review ? `「${r.order.review}」` : ''}`);
    for (const l of await openListingsOf(this.db, r.order.sellerId)) await this.refreshListing(l);
  }

  // ───────── 📝 依頼の募集 ─────────

  private async requestModal(i: ButtonInteraction<'cached'>, cat: MarketCategory, sub: CallKind | null): Promise<void> {
    await i.showModal(
      new ModalBuilder()
        .setCustomId(`market:rmodal:${cat}:${sub ?? '-'}`)
        .setTitle(`依頼（${sub ? CALL_KINDS[sub].label : MARKET_CATEGORIES[cat].label}）`.slice(0, 45))
        .addLabelComponents(
          new LabelBuilder()
            .setLabel('どんな依頼ですか')
            .setTextInputComponent(new TextInputBuilder().setCustomId('title').setStyle(TextInputStyle.Short).setMaxLength(60).setRequired(true).setPlaceholder(cat === 'call' ? '例: 寝る前に 30 分お話ししたい' : '例: 立ち絵を描いてほしい')),
          new LabelBuilder()
            .setLabel('くわしく（イメージ・希望の日時・納期など）')
            .setTextInputComponent(new TextInputBuilder().setCustomId('description').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(false)),
          new LabelBuilder()
            .setLabel(`予算（${this.coin}・目安）`)
            .setDescription('手を挙げた人は、それぞれ値段を出します')
            .setTextInputComponent(new TextInputBuilder().setCustomId('budget').setStyle(TextInputStyle.Short).setMaxLength(9).setRequired(true).setPlaceholder('例: 1500')),
          new LabelBuilder()
            .setLabel('参考の画像（なくても大丈夫）')
            .setFileUploadComponent(new FileUploadBuilder().setCustomId('image').setRequired(false).setMaxValues(1)),
        ),
    );
  }

  private async submitRequest(i: ModalSubmitInteraction<'cached'>, cat: MarketCategory, sub: CallKind | null): Promise<void> {
    await i.deferReply(EPHEMERAL);
    const image = this.uploaded(i, 'image');
    if (image === 'bad') return void (await i.editReply('画像は 10MB までの画像ファイル（png・jpg・gif・webp）にしてください。'));
    const name = image ? imageName('ref', image) : undefined;
    const r = await createRequest(this.db, i.user.id, {
      category: cat,
      subcategory: sub,
      title: i.fields.getTextInputValue('title'),
      description: textOf(i, 'description'),
      budget: toAmount(i.fields.getTextInputValue('budget')) ?? NaN,
      imageUrl: name ? `attachment://${name}` : null,
    });
    if (r.status !== 'ok') {
      const text = {
        invalid: `入力を確かめてください（内容は 60 文字まで、予算は 1〜${fmt(MARKET_PRICE_MAX)}）。`,
        adult_only: '通話の依頼は 18 歳以上の方だけです。',
        too_many: `募集中の依頼は 1 人 ${REQUESTS_PER_MEMBER} 件までです。決まったか締め切った依頼があれば、カードの「締め切る」を押してください。`,
      }[r.status];
      return void (await i.editReply(text));
    }
    const channel = this.marketChannel();
    if (!channel) return void (await i.editReply('#市場 が見つかりません。神職に知らせてください。'));
    let req = r.request;
    let msg;
    try {
      msg = await channel.send({ ...requestCard(req, this.cfg()), ...(image && name ? { files: [{ attachment: image.url, name }] } : {}) });
    } catch (err) {
      if (!image) throw err;
      logger.warn({ err }, 'market request image failed');
      await setImage(this.db, 'request', req.id, null);
      req = { ...req, imageUrl: null };
      msg = await channel.send(requestCard(req, this.cfg()));
    }
    await setRequestMessage(this.db, req.id, channel.id, msg.id);
    await audit(this.db, { actorId: i.user.id, action: 'market.request', detail: { requestId: req.id, category: cat, sub, budget: req.budget }, via: 'discord' });
    await i.editReply(`📝 依頼を出しました（依頼 #${req.id}）: ${msg.url}\n手を挙げた人がいると DM でお知らせします。カードの「👀 手を挙げた人」から選んでください。選ぶと、その値段で${this.coin}を預かって取引になります。`);
  }

  private async bidModal(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const r = await getRequest(this.db, id);
    if (!r || r.status !== 'open') return void (await i.reply({ content: 'この依頼はもう決まったか、締め切られています。', ...EPHEMERAL }));
    if (r.requesterId === i.user.id) return void (await i.reply({ content: '自分の依頼は引き受けられません。', ...EPHEMERAL }));
    if (!this.isMerchant(i.member)) return void (await i.reply({ content: '🏪 引き受けるには「開業権利」が要ります（#授与所 の授与品から受けられます）。', ...EPHEMERAL }));
    await i.showModal(
      new ModalBuilder()
        .setCustomId(`market:bidmodal:${id}`)
        .setTitle('✋ 引き受ける')
        .addLabelComponents(
          new LabelBuilder()
            .setLabel(`いくらで引き受けますか（${this.coin}）`)
            .setDescription(`予算の目安は ${fmt(r.budget)} 枚です`)
            .setTextInputComponent(new TextInputBuilder().setCustomId('amount').setStyle(TextInputStyle.Short).setMaxLength(9).setRequired(true).setPlaceholder(String(r.budget))),
          new LabelBuilder()
            .setLabel('ひとこと（なくても大丈夫）')
            .setTextInputComponent(new TextInputBuilder().setCustomId('note').setStyle(TextInputStyle.Paragraph).setMaxLength(300).setRequired(false).setPlaceholder('例: 3 日ほどで描けます。過去の作品は #作品 に')),
        ),
    );
  }

  private async submitBid(i: ModalSubmitInteraction<'cached'>, id: number): Promise<void> {
    await i.deferReply(EPHEMERAL);
    const amount = toAmount(i.fields.getTextInputValue('amount')) ?? NaN;
    const r = await bidRequest(this.db, this.cfg(), id, { id: i.user.id, roleIds: [...i.member.roles.cache.keys()] }, amount, textOf(i, 'note'));
    if (r.status !== 'ok') {
      const text = {
        not_open: 'この依頼はもう決まったか、締め切られています。',
        self: '自分の依頼は引き受けられません。',
        no_license: '🏪 引き受けるには「開業権利」が要ります。',
        adult_only: '通話の売り買いは、18 歳以上どうしだけです。',
        invalid: `値段は 1〜${fmt(MARKET_PRICE_MAX)}、ひとことは 300 文字までです。`,
      }[r.status];
      return void (await i.editReply(text));
    }
    const req = await getRequest(this.db, id);
    await i.editReply(`✋ ${fmt(r.bid.amount)} 枚で手を挙げました${r.again ? '（出し直し）' : ''}。依頼した人が選ぶと、取引のスレッドができてお知らせが届きます。`);
    if (req) {
      await this.discord.sendDm(
        req.requesterId,
        `✋ 依頼「${req.title}」に <@${r.bid.sellerId}> さんが ${fmt(r.bid.amount)} 枚で手を挙げました。#市場 の依頼のカードの「👀 手を挙げた人」から選べます。${r.bid.note ? `\n> ${r.bid.note.replace(/\n/g, '\n> ')}` : ''}`,
      );
      await this.refreshRequest(req);
    }
  }

  private async bidsView(r: MarketRequest) {
    const list = await requestBids(this.db, r.id);
    const e = this.cfg().economy;
    const shown = list.slice(0, 5);
    const ratings = await Promise.all(shown.map((b) => sellerRating(this.db, b.sellerId)));
    return {
      content: list.length
        ? [
            `👀 「${r.title}」に手を挙げた人（${fmt(list.length)} 人・安い順）`,
            ...shown.map(
              (b, n) =>
                `${n + 1}. <@${b.sellerId}> ・ ${e.currencyEmoji} **${fmt(b.amount)} 枚**${ratings[n]!.count ? ` ・ ⭐ ${ratings[n]!.avg.toFixed(1)}（${ratings[n]!.count} 件）` : ''}${b.note ? ` ・「${b.note.replace(/\n/g, ' ').slice(0, 120)}」` : ''}`,
            ),
            list.length > shown.length ? `-# ほか ${fmt(list.length - shown.length)} 人` : '',
            `-# 「お願いする」を押すと、その値段で${e.currencyName}を預かって取引のスレッドができます（ほかの人には見送りをお知らせします）`,
          ]
            .filter(Boolean)
            .join('\n')
        : `👀 「${r.title}」にはまだ誰も手を挙げていません。`,
      components: shown.map((b, n) => row(btn(`market:baccept:${b.id}`, `${n + 1}. ${fmt(b.amount)} 枚でお願いする`, ButtonStyle.Success))),
      allowedMentions: { parse: [] as const },
    };
  }

  private async showBids(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const r = await getRequest(this.db, id);
    if (!r) return;
    if (r.requesterId !== i.user.id && !this.isStaff(i.member)) return void (await i.reply({ content: '手を挙げた人を見られるのは、依頼した人だけです。引き受けるときは「✋ 引き受ける」を。', ...EPHEMERAL }));
    const view = await this.bidsView(r);
    // 運営は見るだけ
    await i.reply({ ...view, components: r.requesterId === i.user.id ? view.components : [], ...EPHEMERAL });
  }

  private async acceptBid(i: ButtonInteraction<'cached'>, bidId: number): Promise<void> {
    await i.deferUpdate();
    const bid = await getBid(this.db, bidId);
    const others = bid ? (await requestBids(this.db, bid.requestId)).filter((b) => b.id !== bidId) : [];
    const res = await acceptBid(this.db, this.cfg(), bidId, i.user.id);
    const req = bid ? await getRequest(this.db, bid.requestId) : undefined;
    if (res.status !== 'ok') {
      const text =
        res.status === 'insufficient' ? `${this.coin}が足りません（${fmt(bid?.amount ?? 0)} 枚必要）。` : res.status === 'forbidden' ? '選べるのは依頼した人だけです。' : 'この依頼はもう決まったか、締め切られています。';
      const view = req && req.status === 'open' ? await this.bidsView(req) : { content: '', components: [] };
      return void (await i.editReply({ ...view, content: `${text}${view.content ? `\n\n${view.content}` : ''}` }));
    }
    const thread = await this.openThread(res.order);
    await audit(this.db, { actorId: i.user.id, targetId: res.order.sellerId, action: 'market.bid_accept', detail: { orderId: res.order.id, bidId, requestId: res.order.requestId, price: res.order.price }, via: 'discord' });
    await i.editReply({ content: `✅ <@${res.order.sellerId}> さんにお願いしました（取引 #${res.order.id}・${fmt(res.order.price)} 枚を預かりました）。${thread ? `やり取りは <#${thread}> で。` : ''}`, components: [], allowedMentions: { parse: [] } });
    await this.discord.sendDm(res.order.sellerId, `✋ 依頼「${req?.title ?? ''}」をお願いされました（取引 #${res.order.id}・${fmt(res.order.price)} 枚）。${thread ? `<#${thread}> でやり取りしてください。` : ''}`);
    for (const b of others) await this.discord.sendDm(b.sellerId, `📝 依頼「${req?.title ?? ''}」は、ほかの方に決まりました。手を挙げてくださってありがとうございました。`);
    await this.refreshRequest(req);
  }

  private async closeRequest(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const r = await getRequest(this.db, id);
    if (!r) return;
    if (r.requesterId !== i.user.id && !this.isStaff(i.member)) return void (await i.reply({ content: '締め切れるのは、依頼した人と運営だけです。', ...EPHEMERAL }));
    const others = await requestBids(this.db, id);
    const closed = await closeRequest(this.db, id);
    if (!closed) return void (await i.reply({ content: 'もう締め切っています。', ...EPHEMERAL }));
    await i.update(requestCard(closed, this.cfg()));
    await audit(this.db, { actorId: i.user.id, targetId: r.requesterId, action: 'market.request_close', detail: { requestId: id }, via: 'discord' });
    for (const b of others) await this.discord.sendDm(b.sellerId, `📝 依頼「${r.title}」は締め切られました。手を挙げてくださってありがとうございました。`);
  }

  /** 毎分: 期限が来た取引を渡す・返事のない提案を取り下げる・待機の時間が切れたカードを直す */
  async tick(now = new Date()): Promise<void> {
    for (const o of await autoReleaseOrders(this.db, now)) {
      await this.discord.sendDm(o.sellerId, `🏪 取引 #${o.id} は期限が来たので完了にしました。${this.cfg().economy.currencyEmoji} ${fmt(o.price - o.fee)} 枚をお渡ししました。`);
      await this.postOrder(o);
      if (o.listingId) await this.refreshListing(await getListing(this.db, o.listingId));
    }
    for (const o of await expireOffers(this.db, now)) {
      const l = await getListing(this.db, o.listingId);
      await this.discord.sendDm(
        o.buyerId,
        l?.status === 'open'
          ? `💬 「${l.title}」への ${fmt(o.amount)} 枚の提案は、${OFFER_DAYS} 日のあいだ返事がなかったので取り下げました。`
          : `💬 「${l?.title ?? ''}」は受付を終えたので、${fmt(o.amount)} 枚の提案は取り下げました。`,
      );
    }
    for (const l of await expireStandby(this.db, now)) await this.refreshListing(l);
  }
}

function acceptText(r: Exclude<AcceptResult, { status: 'ok' }>, coin: string): string {
  return {
    gone: 'この提案はもう返事が済んでいます（取り下げ・期限切れなど）。',
    not_open: 'この出品は受付を終えています。',
    full: '受付の上限に達しています。いまの取引が終わってから受けてください。',
    forbidden: '提案を受けられるのは、出品した人だけです。',
    insufficient: `相手の${coin}が足りなかったので、この提案は取り消しました。`,
  }[r.status];
}

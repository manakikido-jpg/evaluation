import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Guild,
  type Interaction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { adminLevelOf, type GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { MarketListing, MarketOrder } from '../db/schema.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { audit } from '../services/audit.js';
import {
  autoReleaseOrders,
  buyListing,
  closeListing,
  createListing,
  disputeOrder,
  getListing,
  getOrder,
  isMarketCategory,
  MARKET_CATEGORIES,
  MARKET_PRICE_MAX,
  releaseOrder,
  setListingMessage,
  setOrderThread,
  type MarketCategory,
} from '../services/market.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const SHU = 0xd7003a;
const btn = (id: string, label: string, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const row = (...b: ButtonBuilder[]) => new ActionRowBuilder<ButtonBuilder>().addComponents(b);
const fmt = (n: number) => n.toLocaleString('ja-JP');

/** #市場 に出す出品のカード */
export function listingCard(l: MarketListing, cfg: GuildConfig) {
  const c = MARKET_CATEGORIES[l.category as MarketCategory] ?? MARKET_CATEGORIES.other;
  const open = l.status === 'open';
  const e = cfg.economy;
  return {
    embeds: [
      {
        title: `${c.emoji} ${l.title}${open ? '' : '（受付終了）'}`,
        description: [
          `出品: <@${l.sellerId}> ・ ${c.label}${c.adultOnly ? '（18 歳以上どうし）' : ''}`,
          `値段: **${e.currencyEmoji} ${fmt(l.price)} 枚**`,
          '',
          l.description,
        ].join('\n'),
        color: open ? SHU : 0x888888,
        footer: { text: `出品 #${l.id}` },
      },
    ],
    components: open ? [row(btn(`market:buy:${l.id}`, '買う', ButtonStyle.Primary), btn(`market:close:${l.id}`, '受付を終える'))] : [],
    allowedMentions: { parse: [] as const },
  };
}

/** 取引のスレッドに出すメッセージ */
function orderMessage(o: MarketOrder, l: MarketListing | undefined, cfg: GuildConfig) {
  const e = cfg.economy;
  const status = { paid: '📦 預かり中', completed: '✅ 取引完了', disputed: '⚠️ 問題あり（運営が確認します）', refunded: '↩️ 返金しました' }[o.status];
  return {
    content: `<@${o.buyerId}> <@${o.sellerId}>`,
    embeds: [
      {
        title: `取引 #${o.id}: ${l?.title ?? `出品 #${o.listingId}`}`,
        description: [
          `買った人: <@${o.buyerId}> ・ 売った人: <@${o.sellerId}>`,
          `値段: ${e.currencyEmoji} ${fmt(o.price)} 枚（売った人には手数料 ${fmt(o.fee)} 枚を引いた ${fmt(o.price - o.fee)} 枚）`,
          `状態: **${status}**`,
          '',
          o.status === 'paid'
            ? `${e.currencyName}は社務所が預かっています。受け取ったら「受け取った」を押してください。<t:${Math.floor(o.autoReleaseAt.getTime() / 1000)}:R> までに押されなければ、売った人に渡します。困ったときは「問題あり」を。`
            : '',
          '-# 本物のお金のやり取り・性的なものの売り買いは禁止です（しきたり）',
        ]
          .filter(Boolean)
          .join('\n'),
        color: SHU,
      },
    ],
    components: o.status === 'paid' ? [row(btn(`market:done:${o.id}`, '受け取った', ButtonStyle.Success), btn(`market:problem:${o.id}`, '問題あり', ButtonStyle.Danger))] : [],
  };
}

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

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    if (!(interaction.isButton() || interaction.isModalSubmit()) || !interaction.customId.startsWith('market:')) return;
    const [, action, arg] = interaction.customId.split(':');
    try {
      if (interaction.isButton()) {
        if (action === 'new') return await this.pickCategory(interaction);
        if (action === 'cat' && isMarketCategory(arg)) return await this.listingModal(interaction, arg);
        const id = Number(arg);
        if (!Number.isSafeInteger(id)) return;
        if (action === 'buy') return await this.confirmBuy(interaction, id);
        if (action === 'buyok') return await this.buy(interaction, id);
        if (action === 'close') return await this.close(interaction, id);
        if (action === 'done') return await this.done(interaction, id);
        if (action === 'problem') return await this.problem(interaction, id);
      } else if (action === 'modal' && isMarketCategory(arg)) {
        return await this.submit(interaction, arg);
      }
    } catch (err) {
      logger.warn({ err }, 'market failed');
      const content = 'うまくいきませんでした。時間をおいてもう一度お試しください。';
      await (interaction.deferred || interaction.replied ? interaction.followUp({ content, ...EPHEMERAL }) : interaction.reply({ content, ...EPHEMERAL })).catch(() => undefined);
    }
  }

  private isStaff(i: ButtonInteraction<'cached'>): boolean {
    return Boolean(adminLevelOf(this.cfg(), [...i.member.roles.cache.keys()]));
  }

  // ───────── 出品 ─────────

  private async pickCategory(i: ButtonInteraction<'cached'>): Promise<void> {
    const merchant = this.cfg().roles.merchant;
    if (!merchant || !i.member.roles.cache.has(merchant)) {
      return void (await i.reply({ content: '🏪 出品するには「開業権利」が要ります（#授与所 の授与品から受けられます）。', ...EPHEMERAL }));
    }
    const cats = Object.entries(MARKET_CATEGORIES) as [MarketCategory, (typeof MARKET_CATEGORIES)[MarketCategory]][];
    await i.reply({
      content: '何を出品しますか？（性的なもの・本物のお金のやり取りは出品できません）',
      components: [row(...cats.map(([k, c]) => btn(`market:cat:${k}`, `${c.emoji} ${c.label}`.slice(0, 80))))],
      ...EPHEMERAL,
    });
  }

  private async listingModal(i: ButtonInteraction<'cached'>, cat: MarketCategory): Promise<void> {
    const input = (id: string, label: string, style: TextInputStyle, max: number, required = true, placeholder = '') =>
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setMaxLength(max).setRequired(required).setPlaceholder(placeholder),
      );
    await i.showModal(
      new ModalBuilder()
        .setCustomId(`market:modal:${cat}`)
        .setTitle(`出品（${MARKET_CATEGORIES[cat].label}）`.slice(0, 45))
        .addComponents(
          input('title', '品名', TextInputStyle.Short, 60, true, '例: アイコンを描きます'),
          input('description', '説明（内容・納期・注意など）', TextInputStyle.Paragraph, 1000, false),
          input('price', `値段（${this.cfg().economy.currencyName}・1〜${fmt(MARKET_PRICE_MAX)}）`, TextInputStyle.Short, 7, true, '例: 1000'),
        ),
    );
  }

  private async submit(i: ModalSubmitInteraction<'cached'>, cat: MarketCategory): Promise<void> {
    await i.deferReply(EPHEMERAL);
    const cfg = this.cfg();
    const price = Number(i.fields.getTextInputValue('price').replace(/[,，\s枚]/g, '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
    const r = await createListing(this.db, cfg, { id: i.user.id, roleIds: [...i.member.roles.cache.keys()] }, {
      category: cat,
      title: i.fields.getTextInputValue('title'),
      description: i.fields.getTextInputValue('description'),
      price,
    });
    if (r.status !== 'ok') {
      const text = {
        disabled: '市場はまだ準備中です。',
        no_license: '🏪 出品するには「開業権利」が要ります。',
        adult_only: '通話の出品は 18 歳以上の方だけです。',
        invalid: `入力を確かめてください（品名は 60 文字まで、値段は 1〜${fmt(MARKET_PRICE_MAX)}）。`,
      }[r.status];
      return void (await i.editReply(text));
    }
    const channel = cfg.channels.market ? this.guild?.channels.cache.get(cfg.channels.market) : undefined;
    if (!channel?.isSendable()) return void (await i.editReply('#市場 が見つかりません。神職に知らせてください。'));
    const msg = await channel.send(listingCard(r.listing, cfg));
    await setListingMessage(this.db, r.listing.id, channel.id, msg.id);
    await i.editReply(`出品しました（出品 #${r.listing.id}）: ${msg.url}\n売れると、やり取りのスレッドができて知らせが届きます。手数料は ${cfg.market.feePercent}% です。`);
  }

  private async close(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const l = await getListing(this.db, id);
    if (!l) return;
    const staff = this.isStaff(i);
    if (l.sellerId !== i.user.id && !staff) return void (await i.reply({ content: '受付を終えられるのは、出品した人と運営だけです。', ...EPHEMERAL }));
    const closed = await closeListing(this.db, id, l.sellerId === i.user.id ? 'seller' : 'staff');
    if (!closed) return void (await i.reply({ content: 'もう受付を終えています。', ...EPHEMERAL }));
    await i.update(listingCard(closed, this.cfg()));
    await audit(this.db, { actorId: i.user.id, targetId: l.sellerId, action: 'market.close', detail: { listingId: id, by: closed.status }, via: 'discord' });
  }

  // ───────── 買う ─────────

  private async confirmBuy(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const l = await getListing(this.db, id);
    if (!l || l.status !== 'open') return void (await i.reply({ content: 'この出品は受付を終えています。', ...EPHEMERAL }));
    if (l.sellerId === i.user.id) return void (await i.reply({ content: '自分の出品は買えません。', ...EPHEMERAL }));
    const e = this.cfg().economy;
    await i.reply({
      content: [
        `「${l.title}」を ${e.currencyEmoji} **${fmt(l.price)} 枚** で買いますか？`,
        `-# ${this.cfg().economy.currencyName}は社務所が預かり、「受け取った」を押すか ${this.cfg().market.autoReleaseDays} 日たつと売った人に渡します。困ったときは「問題あり」で運営が確認します。`,
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
        insufficient: r.status === 'insufficient' ? `${this.cfg().economy.currencyName}が足りません（${fmt(r.price)} 枚必要・いま ${fmt(r.balance)} 枚）。` : '',
      }[r.status];
      return void (await i.editReply({ content: text, components: [] }));
    }
    const l = await getListing(this.db, id);
    const thread = await this.openThread(r.order, l);
    await audit(this.db, { actorId: i.user.id, targetId: r.order.sellerId, action: 'market.buy', detail: { orderId: r.order.id, listingId: id, price: r.order.price }, via: 'discord' });
    await i.editReply({
      content: `買いました（取引 #${r.order.id}）。${thread ? `やり取りは <#${thread}> で。` : '売った人と DM でやり取りしてください。'} 残り ${fmt(r.balance)} 枚。`,
      components: [],
    });
    await this.discord.sendDm(r.order.sellerId, `🏪 「${l?.title ?? ''}」が売れました（取引 #${r.order.id}・<@${r.order.buyerId}> さん）。${thread ? `<#${thread}> でやり取りしてください。` : ''}`);
  }

  /** 取引のやり取りの場（#市場 の中の非公開スレッド。運営も見られる） */
  private async openThread(o: MarketOrder, l: MarketListing | undefined): Promise<string | undefined> {
    const cfg = this.cfg();
    const channel = cfg.channels.market ? this.guild?.channels.cache.get(cfg.channels.market) : undefined;
    if (!channel || channel.type !== ChannelType.GuildText) return undefined;
    try {
      const thread = await channel.threads.create({
        name: `取引 #${o.id} ${l?.title ?? ''}`.slice(0, 90),
        type: ChannelType.PrivateThread,
        invitable: false,
        reason: '市場の取引',
      });
      await thread.members.add(o.buyerId);
      await thread.members.add(o.sellerId);
      await thread.send({ ...orderMessage(o, l, cfg), allowedMentions: { users: [o.buyerId, o.sellerId] } });
      await setOrderThread(this.db, o.id, thread.id);
      return thread.id;
    } catch (err) {
      logger.warn({ err }, 'market thread failed');
      return undefined;
    }
  }

  // ───────── 受け取った・問題あり ─────────

  private async done(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const o = await getOrder(this.db, id);
    if (!o) return;
    if (o.buyerId !== i.user.id) return void (await i.reply({ content: '「受け取った」は、買った人だけが押せます。', ...EPHEMERAL }));
    const done = await releaseOrder(this.db, id, i.user.id);
    if (!done) return void (await i.reply({ content: 'この取引はもう終わっています。', ...EPHEMERAL }));
    await i.update(orderMessage(done, await getListing(this.db, done.listingId), this.cfg()));
    await this.discord.sendDm(done.sellerId, `🏪 取引 #${id} が完了しました。${this.cfg().economy.currencyEmoji} ${fmt(done.price - done.fee)} 枚をお渡ししました。`);
    await audit(this.db, { actorId: i.user.id, targetId: done.sellerId, action: 'market.release', detail: { orderId: id }, via: 'discord' });
  }

  private async problem(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const o = await getOrder(this.db, id);
    if (!o) return;
    if (o.buyerId !== i.user.id) return void (await i.reply({ content: '「問題あり」は、買った人だけが押せます。', ...EPHEMERAL }));
    const d = await disputeOrder(this.db, id);
    if (!d) return void (await i.reply({ content: 'この取引はもう終わっています。', ...EPHEMERAL }));
    await i.update(orderMessage(d, await getListing(this.db, d.listingId), this.cfg()));
    await audit(this.db, { actorId: i.user.id, targetId: d.sellerId, action: 'market.dispute', detail: { orderId: id }, via: 'discord' });
    const log = this.cfg().channels.log;
    if (log) await this.discord.sendMessage(log, { content: `⚠️ 市場の取引 #${id} に「問題あり」が出ました。社務所Web の「市場」で確かめてください。` }).catch(() => undefined);
  }

  /** 10 分ごと: 期限が来た取引を売った人に渡す */
  async tick(): Promise<void> {
    for (const o of await autoReleaseOrders(this.db)) {
      await this.discord.sendDm(o.sellerId, `🏪 取引 #${o.id} は期限が来たので完了にしました。${this.cfg().economy.currencyEmoji} ${fmt(o.price - o.fee)} 枚をお渡ししました。`);
    }
  }
}

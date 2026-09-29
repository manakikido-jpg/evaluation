import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type Guild,
  type Interaction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
  type Message,
} from 'discord.js';
import { emaChannelIds, type GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { ShopItem } from '../db/schema.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { walletOf } from '../services/economy.js';
import { purchaseMenzaifu } from '../services/moderation.js';
import { drawOmikuji, omikujiToday } from '../services/omikuji.js';
import { ticketsOf } from '../services/tickets.js';
import { canBuyVip } from '../services/vip.js';
import { bagMessage, OTOSHIDAMA, parseCount, putBag, setBagMessage, undoBag } from '../services/otoshidama.js';
import {
  activeMyColor,
  activeRolePurchases,
  buyMyColor,
  parseHexColor,
  setPurchaseRole,
  undoMyColor,
  buyRole,
  buyPresent,
  buySimple,
  DISCOUNT_TICKETS,
  duePurchases,
  endPurchase,
  getItem,
  giveGift,
  listItems,
  presentable,
  priceOf,
  refund,
  seedDefaultItems,
  type BuyResult,
  type DiscountTicket,
} from '../services/shop.js';

/** サーバーブースト（奉納）している人 */
const isBooster = (i: { member: { premiumSince: Date | null } }) => i.member.premiumSince !== null;
import { omikujiEmbed } from './omikuji.js';
import { hanafubukiMessage, myColorConfirm, myColorPicker, otoshidamaPickChannel, presentConfirm, presentPickTarget, shopConfirm, shopList, shopPickTarget } from './shopViews.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const done = (content: string) => ({ content, embeds: [], components: [] });
const fmtDate = (d: Date) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' }).format(d);

type Buyable = ButtonInteraction<'cached'> | ModalSubmitInteraction<'cached'>;

/** #授与所 のショップ（授与品） */
export class ShopApp {
  private guild?: Guild;

  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
    private readonly discord: DiscordActions,
  ) {}

  /** 起動したとき: 最初の品物を並べる（あれば何もしない） */
  async attach(guild: Guild): Promise<void> {
    this.guild = guild;
    const n = await seedDefaultItems(this.db, this.cfg().shop);
    if (n) logger.info({ created: n }, 'shop items seeded');
  }

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    const id = 'customId' in interaction ? interaction.customId : '';
    if (!id.startsWith('shop:')) return;
    try {
      if (interaction.isButton()) {
        if (id === 'shop:open') return await this.open(interaction);
        if (id === 'shop:cancel') return void (await interaction.update(done('やめました。')));
        if (id.startsWith('shop:buy:')) {
          const [, , itemId, ticket] = id.split(':');
          const discount = DISCOUNT_TICKETS.find((t) => t === ticket);
          return await this.buy(interaction, Number(itemId), discount);
        }
        // 🎨 自分だけの色: 色コードの入力欄・選び直す・買う
        if (id.startsWith('shop:mycolor:')) {
          const [, , step, itemId, color] = id.split(':');
          if (step === 'hex') return await this.myColorHexModal(interaction, Number(itemId));
          if (step === 'again') return await this.myColorPick(interaction, Number(itemId));
          if (step === 'buy') return await this.myColorBuy(interaction, Number(itemId), Number(color));
        }
        // 🎁 プレゼント: 相手を選ぶ・贈る
        if (id.startsWith('shop:present:')) return await this.presentPick(interaction, Number(id.split(':')[2]));
        if (id.startsWith('shop:presentok:')) {
          const [, , itemId, targetId] = id.split(':');
          return await this.presentBuy(interaction, Number(itemId), targetId ?? '');
        }
        // 🧧 お年玉袋: いつもの場所に置く
        if (id.startsWith('shop:otoshi:here:')) {
          const [, , , itemId, channelId] = id.split(':');
          return await this.otoshidamaModal(interaction, Number(itemId), channelId ?? '');
        }
      }
      if (interaction.isStringSelectMenu() && (id === 'shop:pick' || id.startsWith('shop:pick:'))) return await this.pick(interaction);
      if (interaction.isStringSelectMenu() && id.startsWith('shop:mycolor:pick:')) return await this.myColorChosen(interaction, Number(id.split(':')[3]), Number(interaction.values[0]));
      if (interaction.isChannelSelectMenu() && id.startsWith('shop:otoshi:ch:')) return await this.otoshidamaModal(interaction, Number(id.split(':')[3]), interaction.values[0] ?? '');
      if (interaction.isUserSelectMenu() && id.startsWith('shop:presentto:')) return await this.presentTarget(interaction, Number(id.split(':')[2]));
      if (interaction.isUserSelectMenu() && id.startsWith('shop:target:')) return await this.target(interaction, Number(id.split(':')[2]));
      if (interaction.isModalSubmit()) {
        const [, kind, itemId, targetId] = id.split(':');
        if (kind === 'hana' || kind === 'gift') return await this.submitWithTarget(interaction, kind, Number(itemId), targetId ?? '');
        if (kind === 'mycolorhex') return await this.myColorHexSubmit(interaction, Number(itemId));
        if (kind === 'otoshi') return await this.otoshidamaSubmit(interaction, Number(itemId), targetId ?? '');
      }
    } catch (err) {
      logger.error({ err, id }, 'shop failed');
      if (interaction.isRepliable()) {
        const content = 'うまくいきませんでした。時間をおいてもう一度お試しください。';
        await (interaction.deferred || interaction.replied ? interaction.editReply(done(content)) : interaction.reply({ content, ...EPHEMERAL })).catch(() => undefined);
      }
    }
  }

  /** 通貨の名前（銭） */
  private get coinName(): string {
    return this.cfg().economy.currencyName;
  }

  /** 払う値段（奉納している人は割引） */
  private price(i: Buyable, item: ShopItem): number {
    return priceOf(item, this.cfg().economy, isBooster(i));
  }

  private async balance(userId: string): Promise<number> {
    return (await walletOf(this.db, userId)).balance;
  }

  private async open(i: ButtonInteraction<'cached'>): Promise<void> {
    const [items, purchases, mine] = await Promise.all([listItems(this.db, { enabledOnly: true }), activeRolePurchases(this.db, i.user.id), activeMyColor(this.db, i.user.id)]);
    // 受けている授与品（ロールをまだ持っているものだけ）
    const owned = new Map<number, Date | null>();
    for (const p of purchases) {
      const item = items.find((x) => x.id === p.itemId);
      if (item?.roleId && i.member.roles.cache.has(item.roleId)) owned.set(p.itemId, p.expiresAt ?? null);
    }
    if (mine?.roleId && i.member.roles.cache.has(mine.roleId)) owned.set(mine.itemId, mine.expiresAt ?? null);
    await i.reply({ ...shopList(items, this.cfg().economy, await this.balance(i.user.id), isBooster(i), owned), ...EPHEMERAL });
  }

  private async pick(i: StringSelectMenuInteraction<'cached'>): Promise<void> {
    const item = await getItem(this.db, Number(i.values[0]));
    if (!item?.enabled) return void (await i.update(done('この授与品は、今は受けられません。')));
    const balance = await this.balance(i.user.id);
    const e = this.cfg().economy;
    if (item.kind === 'gift' || item.kind === 'hanafubuki') return void (await i.update(shopPickTarget(item, e, balance, isBooster(i))));
    if (item.kind === 'mycolor') return this.myColorPick(i, item.id);
    if (item.kind === 'otoshidama') {
      const cfg = this.cfg();
      const home = cfg.channels.keidai ?? i.guild.channels.cache.find((c) => c.isTextBased() && c.name === '境内')?.id;
      const homeName = home ? i.guild.channels.cache.get(home)?.name : undefined;
      return void (await i.update(otoshidamaPickChannel(item, e, balance, home, homeName)));
    }
    let note: string | undefined;
    if (item.kind === 'role' && item.roleGroup === 'color') note = '-# ほかの色守りを持っていたら、その色は外れます。同じ色なら期間が延びます';
    if (item.kind === 'role' && item.roleGroup === 'vip') {
      note = canBuyVip(this.cfg(), [...i.member.roles.cache.keys()])
        ? '-# 遊郭の「➕ 💎 極の部屋をひらく」が見えるようになり、VIP だけの部屋をひらける・入れる（部屋代なし）。もう一度受けると期間が延びます'
        : '-# 💎 極の VIP は、宵参り（18 歳以上）の方だけが受けられます';
    }
    if (item.kind === 'ema_pin') {
      note = '-# 自己紹介のチャンネル（#絵馬-男性・#絵馬-女性 など）に書いた、いちばん新しい自分のメッセージをピン留めします';
      const t = (await ticketsOf(this.db, i.user.id)).ema_pin;
      if (t > 0 && priceOf(item, this.cfg().economy, isBooster(i)) > 0) note = `📌 **絵馬のピン留め券を 1 枚使うので、${this.coinName}は減りません**（いま ${t} 枚）\n${note}`;
    }
    const t = await ticketsOf(this.db, i.user.id);
    await i.update(shopConfirm(item, e, balance, note, isBooster(i), DISCOUNT_TICKETS.map((d) => ({ ticket: d, count: t[d] }))));
  }

  private async buy(i: ButtonInteraction<'cached'>, itemId: number, discount?: DiscountTicket): Promise<void> {
    await i.deferUpdate();
    const item = await getItem(this.db, itemId);
    if (!item?.enabled) return void (await i.editReply(done('この授与品は、今は受けられません。')));
    const text = await this.execute(i, item, {}, discount);
    await i.editReply(done(text));
  }

  /** 花吹雪・贈り物: 相手を選んだら、一言・量の入力欄を出す */
  private async target(i: UserSelectMenuInteraction<'cached'>, itemId: number): Promise<void> {
    const item = await getItem(this.db, itemId);
    const targetId = i.values[0];
    if (!item?.enabled || !targetId) return void (await i.update(done('この授与品は、今は受けられません。')));
    const target = i.members.get(targetId);
    if (targetId === i.user.id) return void (await i.update(done('自分には贈れません。')));
    if (!target || i.users.get(targetId)?.bot) return void (await i.update(done('その方には贈れません（BOT や、サーバーにいない方）。')));
    const e = this.cfg().economy;
    const input =
      item.kind === 'gift'
        ? new TextInputBuilder()
            .setCustomId('amount')
            .setLabel(`贈る${e.currencyName}の量（${e.giftMin}〜${e.giftMax}）`)
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(7)
        : new TextInputBuilder().setCustomId('message').setLabel('一言（なくても大丈夫）').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(60);
    await i.showModal(
      new ModalBuilder()
        .setCustomId(`shop:${item.kind === 'gift' ? 'gift' : 'hana'}:${item.id}:${targetId}`)
        .setTitle(`${item.name}（${target.displayName.slice(0, 20)} さんへ）`.slice(0, 45))
        .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input)),
    );
  }

  private async submitWithTarget(i: ModalSubmitInteraction<'cached'>, kind: 'hana' | 'gift', itemId: number, targetId: string): Promise<void> {
    if (i.isFromMessage()) await i.deferUpdate();
    else await i.deferReply(EPHEMERAL);
    const item = await getItem(this.db, itemId);
    if (!item?.enabled || !/^\d{17,20}$/.test(targetId)) return void (await i.editReply(done('この授与品は、今は受けられません。')));
    const text = kind === 'gift' ? await this.gift(i, targetId) : await this.execute(i, item, { targetId, message: i.fields.getTextInputValue('message') });
    await i.editReply(done(text));
  }

  // ───────── 🎁 プレゼント ─────────

  private async presentPick(i: ButtonInteraction<'cached'>, itemId: number): Promise<void> {
    const item = await getItem(this.db, itemId);
    if (!item?.enabled || !presentable(item)) return void (await i.update(done('この授与品は、プレゼントにできません。')));
    await i.update(presentPickTarget(item, this.cfg().economy, await this.balance(i.user.id), isBooster(i)));
  }

  private async presentTarget(i: UserSelectMenuInteraction<'cached'>, itemId: number): Promise<void> {
    const item = await getItem(this.db, itemId);
    const targetId = i.values[0];
    if (!item?.enabled || !presentable(item) || !targetId) return void (await i.update(done('この授与品は、プレゼントにできません。')));
    const target = i.members.get(targetId);
    if (targetId === i.user.id) return void (await i.update(done('自分には贈れません（自分のぶんは「受ける」から）。')));
    if (!target || i.users.get(targetId)?.bot) return void (await i.update(done('その方には贈れません（BOT や、サーバーにいない方）。')));
    const note =
      item.roleId && target.roles.cache.has(item.roleId)
        ? item.durationDays
          ? `-# ${target.displayName} さんはもう持っているので、期間が ${item.durationDays} 日延びます`
          : undefined
        : item.roleGroup === 'color'
          ? '-# 相手がほかの色守りを持っていたら、その色は外れます'
          : undefined;
    await i.update(presentConfirm(item, this.cfg().economy, await this.balance(i.user.id), { id: targetId, name: target.displayName }, isBooster(i), note));
  }

  private async presentBuy(i: ButtonInteraction<'cached'>, itemId: number, targetId: string): Promise<void> {
    await i.deferUpdate();
    const item = await getItem(this.db, itemId);
    if (!item?.enabled || !/^\d{17,20}$/.test(targetId)) return void (await i.editReply(done('この授与品は、今は受けられません。')));
    const target = await i.guild.members.fetch(targetId).catch(() => undefined);
    if (!target) return void (await i.editReply(done('その方は、サーバーにいません。')));
    const r = await buyPresent(
      this.db,
      this.cfg(),
      item,
      { id: i.user.id, roleIds: [...i.member.roles.cache.keys()] },
      { id: target.id, roleIds: [...target.roles.cache.keys()], bot: target.user.bot },
      this.price(i, item),
    );
    if (r.status === 'self' || r.status === 'not_member') return void (await i.editReply(done(r.status === 'self' ? '自分には贈れません。' : 'その方には贈れません（BOT や、まだ役職のない方）。')));
    if (r.status === 'rank_too_low') return void (await i.editReply(done(`プレゼントを贈れるのは「${r.rankName}」になってからです（作ったばかりのアカウントから贈れないようにしています）。`)));
    if (r.status === 'owned') return void (await i.editReply(done(`${target.displayName} さんはもう持っています（${this.coinName}は減っていません）。`)));
    if (r.status !== 'ok') return void (await i.editReply(done(this.insufficientText(r) ?? 'この授与品は、今は受けられません。')));
    try {
      await target.roles.add(item.roleId!, `授与品のプレゼント: ${item.name}（${i.member.displayName} さんから）`);
    } catch (err) {
      logger.warn({ err, roleId: item.roleId }, 'shop present role add failed');
      await refund(this.db, r.purchase);
      return void (await i.editReply(done(`ロールを付けられなかったので、${this.coinName}を戻しました。神職に知らせてください（BOT のロールの位置か権限）。`)));
    }
    for (const old of r.removeRoleIds) await target.roles.remove(old, '色守りの買い替え（プレゼント）').catch(() => undefined);
    const until = r.purchase.expiresAt ? `${fmtDate(r.purchase.expiresAt)} まで` : 'ずっと';
    const dm = await this.discord
      .sendDm(target.id, `🎁 **${i.member.displayName}** さんから、授与品「${item.emoji} ${item.name}」のプレゼントが届きました（${until}・咲楽ノ宮）。`)
      .then((ok) => ok !== false)
      .catch(() => false);
    await i.editReply(
      done(`🎁 ${target.displayName} さんに ${item.emoji} ${item.name}を贈りました（${until}）。残り ${r.balance} 枚。${dm ? '' : '\n-# 相手が DM を受け取らない設定のため、知らせは届いていません'}`),
    );
  }

  // ───────── それぞれの授与品 ─────────

  private async execute(i: Buyable, item: ShopItem, extra: { targetId?: string; message?: string } = {}, discount?: DiscountTicket): Promise<string> {
    const cfg = this.cfg();
    const userId = i.user.id;
    if (item.boosterOnly && !isBooster(i)) return '🏮 この授与品は、奉納（サーバーブースト）している方だけが受けられます。';
    switch (item.kind) {
      case 'role':
        // 💎 極の VIP: 宵参り（18 歳以上）の方だけ
        if (item.roleGroup === 'vip' && !canBuyVip(cfg, [...i.member.roles.cache.keys()])) return '💎 極の VIP は、宵参り（18 歳以上）の方だけが受けられます。';
        return this.role(i, item, discount);
      case 'menzaifu': {
        const r = await purchaseMenzaifu({ db: this.db, cfg, discord: this.discord }, userId);
        if (r.status === 'ok') return `🧾 厄を 1 つ祓いました。${r.remaining ? `残りの厄: ${r.remaining}` : '厄年は外れました。'}`;
        if (r.status === 'no_yaku') return `祓う厄がありません（${this.coinName}は減っていません）。`;
        if (r.status === 'used_up') return `免罪符は 1 人 ${r.max} 回までです。`;
        return `${this.coinName}が足りません（${r.price} 枚必要・いま ${r.balance} 枚）。`;
      }
      case 'omikuji_extra':
        return this.omikujiExtra(i, item, discount);
      case 'ema_pin':
        return this.emaPin(i, item, discount);
      case 'hanafubuki':
        return this.hanafubuki(i, item, extra.targetId ?? '', extra.message ?? '');
      default:
        return 'この授与品は、今は受けられません。';
    }
  }

  private insufficientText(r: BuyResult): string | undefined {
    if (r.status === 'insufficient') return `${this.coinName}が足りません（${r.price} 枚必要・いま ${r.balance} 枚）。`;
    if (r.status === 'disabled') return 'この授与品は、今は受けられません。';
    if (r.status === 'owned') return `もう持っています（${this.coinName}は減っていません）。`;
    if (r.status === 'no_ticket') return `割引券がありません（${this.coinName}は減っていません）。`;
    return undefined;
  }

  /** 割引券を使ったときの一言 */
  private discountNote(r: BuyResult): string {
    return r.status === 'ok' && r.discount ? `（🏷 ${r.discount}% 割引券を使いました）` : '';
  }

  private async role(i: Buyable, item: ShopItem, discount?: DiscountTicket): Promise<string> {
    const r = await buyRole(this.db, item, i.user.id, new Date(), this.price(i, item), discount);
    if (r.status !== 'ok') return this.insufficientText(r)!;
    try {
      await i.member.roles.add(item.roleId!, `授与品: ${item.name}`);
    } catch (err) {
      logger.warn({ err, roleId: item.roleId }, 'shop role add failed');
      await refund(this.db, r.purchase);
      return `ロールを付けられなかったので、${this.coinName}を戻しました。神職に知らせてください（BOT のロールの位置か権限）。`;
    }
    for (const old of r.removeRoleIds) await i.member.roles.remove(old, '色守りの買い替え').catch(() => undefined);
    const until = r.purchase.expiresAt ? `${fmtDate(r.purchase.expiresAt)} まで` : 'ずっと';
    return `${item.emoji} ${item.name}を授かりました（${until}）${this.discountNote(r)}。残り ${r.balance} 枚。`;
  }

  private async omikujiExtra(i: Buyable, item: ShopItem, discount?: DiscountTicket): Promise<string> {
    const cfg = this.cfg();
    const today = await omikujiToday(this.db, i.user.id, new Date());
    if (!today.drawn) return `先に今日のおみくじを引いてください（${this.coinName}は減っていません）。`;
    if (today.extraUsed) return '今日の「もう 1 回」は使いました。また明日どうぞ。';
    const r = await buySimple(this.db, item, i.user.id, {}, new Date(), this.price(i, item), discount);
    if (r.status !== 'ok') return this.insufficientText(r)!;
    const d = await drawOmikuji(this.db, cfg.economy, i.user.id, new Date(), Math.random, { extra: true });
    if (d.status !== 'drawn') {
      await refund(this.db, r.purchase);
      return `今日の「もう 1 回」は使いました（${this.coinName}は戻しました）。`;
    }
    const embed = omikujiEmbed(d, i.member.displayName, cfg.economy);
    const home = cfg.channels.omikuji ?? i.guild.channels.cache.find((c) => c.isTextBased() && c.name === 'おみくじ')?.id;
    const channel = home ? i.guild.channels.cache.get(home) : undefined;
    if (channel?.isSendable()) {
      await channel.send({ embeds: [{ ...embed, title: `${embed.title}（もう 1 回）` }], allowedMentions: { parse: [] } }).catch(() => undefined);
    }
    return `🎟 もう 1 回引きました: **${d.fortune.name}**${home ? `（<#${home}> に出しました）` : ''}${this.discountNote(r)}`;
  }

  private async emaPin(i: Buyable, item: ShopItem, discount?: DiscountTicket): Promise<string> {
    // 自己紹介のチャンネル（絵馬-男性・絵馬-女性・運営紹介）のうち、いちばん新しい自分の投稿
    const channels = emaChannelIds(this.cfg()).map((id) => i.guild.channels.cache.get(id));
    const channel = channels.find((c) => c?.isTextBased());
    if (!channel?.isTextBased()) return '自己紹介のチャンネルが見つかりません。神職に知らせてください。';
    let mine: Message | undefined;
    for (const c of channels) {
      if (!c?.isTextBased()) continue;
      const found = (await c.messages.fetch({ limit: 100 })).filter((m) => m.author.id === i.user.id).first();
      if (found && (!mine || found.createdTimestamp > mine.createdTimestamp)) mine = found;
    }
    if (!mine) return `先に <#${channel.id}> などの自己紹介のチャンネルに書いてください（${this.coinName}は減っていません）。`;
    if (mine.pinned) return `もうピン留めされています（${this.coinName}は減っていません）。`;
    const r = await buySimple(this.db, item, i.user.id, { channelId: mine.channelId, messageId: mine.id }, new Date(), this.price(i, item), discount);
    if (r.status !== 'ok') return this.insufficientText(r)!;
    try {
      await mine.pin(`授与品: ${item.name}`);
    } catch (err) {
      logger.warn({ err }, 'ema pin failed');
      // 払った銭も、使った券も戻る
      await refund(this.db, r.purchase);
      return `ピン留めできなかったので、${r.ticket ? '券' : this.coinName}を戻しました。神職に知らせてください（BOT の「メッセージの管理」権限）。`;
    }
    if (r.ticket) return `📌 絵馬のピン留め券を 1 枚使って、自己紹介を ${fmtDate(r.purchase.expiresAt!)} までピン留めしました（${this.coinName}は減っていません）。`;
    return `📌 自己紹介を ${fmtDate(r.purchase.expiresAt!)} までピン留めしました${this.discountNote(r)}。残り ${r.balance} 枚。`;
  }

  private async hanafubuki(i: Buyable, item: ShopItem, targetId: string, message: string): Promise<string> {
    const cfg = this.cfg();
    const home = cfg.channels.keidai ?? i.guild.channels.cache.find((c) => c.isTextBased() && c.name === '境内')?.id;
    const channel = home ? i.guild.channels.cache.get(home) : undefined;
    if (!channel?.isSendable()) return '#境内 が見つかりません。神職に知らせてください。';
    const r = await buySimple(this.db, item, i.user.id, { targetId }, new Date(), this.price(i, item));
    if (r.status !== 'ok') return this.insufficientText(r)!;
    try {
      await channel.send(hanafubukiMessage(i.user.id, targetId, message));
    } catch (err) {
      logger.warn({ err }, 'hanafubuki post failed');
      await refund(this.db, r.purchase);
      return `花吹雪を出せなかったので、${this.coinName}を戻しました。`;
    }
    return `🌸 <#${channel.id}> に花吹雪を出しました。残り ${r.balance} 枚。`;
  }

  private async gift(i: ModalSubmitInteraction<'cached'>, targetId: string): Promise<string> {
    const cfg = this.cfg();
    const e = cfg.economy;
    const amount = Number(i.fields.getTextInputValue('amount').replace(/[,，\s枚]/g, '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
    const r = await giveGift(this.db, cfg, { id: i.user.id, roleIds: [...i.member.roles.cache.keys()] }, targetId, amount);
    switch (r.status) {
      case 'ok':
        await this.discord.sendDm(targetId, `🎁 ${i.member.displayName} さんから ${e.currencyEmoji}${e.currencyName} ${amount} 枚の贈り物が届きました（咲楽ノ宮）。`).catch(() => false);
        return `🎁 <@${targetId}> さんに ${amount} 枚贈りました。残り ${r.balance} 枚。`;
      case 'self':
        return '自分には贈れません。';
      case 'rank_too_low':
        return `贈り物は ${r.rankName} 以上になるとできます。`;
      case 'bad_amount':
        return `${r.min}〜${r.max} 枚の間で入れてください。`;
      case 'daily_limit':
        return `今日贈れるのは、あと ${r.left} 枚までです（日本時間の 0 時に戻ります）。`;
      case 'insufficient':
        return `${this.coinName}が足りません（いま ${r.balance} 枚）。`;
    }
  }

  // ───────── 🎨 自分だけの色 ─────────

  /** 色を選ぶ画面（持っていれば今の色も） */
  private async myColorPick(i: StringSelectMenuInteraction<'cached'> | ButtonInteraction<'cached'>, itemId: number): Promise<void> {
    const item = await getItem(this.db, itemId);
    if (!item?.enabled || item.kind !== 'mycolor') return void (await i.update(done('この授与品は、今は受けられません。')));
    const mine = await activeMyColor(this.db, i.user.id);
    const role = mine?.roleId ? i.guild.roles.cache.get(mine.roleId) : undefined;
    const current = role ? { color: role.colors.primaryColor || role.color, expiresAt: mine!.expiresAt } : undefined;
    await i.update(myColorPicker(item, this.cfg().economy, await this.balance(i.user.id), isBooster(i), current));
  }

  private async myColorChosen(i: StringSelectMenuInteraction<'cached'> | ModalSubmitInteraction<'cached'>, itemId: number, color: number): Promise<void> {
    const item = await getItem(this.db, itemId);
    if (!item?.enabled || item.kind !== 'mycolor' || !Number.isInteger(color) || color < 1 || color > 0xffffff) return void (await i.editReply(done('この授与品は、今は受けられません。')).catch(() => undefined));
    const view = myColorConfirm(item, this.cfg().economy, await this.balance(i.user.id), color, isBooster(i), Boolean(await activeMyColor(this.db, i.user.id)));
    if (i.isStringSelectMenu()) await i.update(view);
    else await i.editReply(view);
  }

  private async myColorHexModal(i: ButtonInteraction<'cached'>, itemId: number): Promise<void> {
    await i.showModal(
      new ModalBuilder()
        .setCustomId(`shop:mycolorhex:${itemId}`)
        .setTitle('🎨 色コードで決める')
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder().setCustomId('hex').setLabel('色コード（例: #ff88aa）').setPlaceholder('#ff88aa').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(3).setMaxLength(7),
          ),
        ),
    );
  }

  private async myColorHexSubmit(i: ModalSubmitInteraction<'cached'>, itemId: number): Promise<void> {
    if (i.isFromMessage()) await i.deferUpdate();
    else await i.deferReply(EPHEMERAL);
    const color = parseHexColor(i.fields.getTextInputValue('hex'));
    if (color === undefined) {
      await i.followUp({ content: '色コードが読めませんでした。#ff88aa のように、# と 6 けたの 0〜9・a〜f で入れてください。', ...EPHEMERAL });
      return;
    }
    await this.myColorChosen(i, itemId, color);
  }

  private async myColorBuy(i: ButtonInteraction<'cached'>, itemId: number, color: number): Promise<void> {
    await i.deferUpdate();
    const item = await getItem(this.db, itemId);
    if (!item?.enabled || item.kind !== 'mycolor' || !Number.isInteger(color) || color < 1 || color > 0xffffff) return void (await i.editReply(done('この授与品は、今は受けられません。')));
    if (item.boosterOnly && !isBooster(i)) return void (await i.editReply(done('🏮 この授与品は、奉納（サーバーブースト）している方だけが受けられます。')));
    const price = this.price(i, item);
    const r = await buyMyColor(this.db, item, i.user.id, color, new Date(), price);
    if (r.status === 'insufficient') return void (await i.editReply(done(`${this.coinName}が足りません（${r.price} 枚必要・いま ${r.balance} 枚）。`)));
    if (r.status !== 'ok') return void (await i.editReply(done('この授与品は、今は受けられません。')));
    const name = `🎨 ${i.member.displayName}`.slice(0, 100);
    try {
      const existing = r.purchase.roleId ? (i.guild.roles.cache.get(r.purchase.roleId) ?? (await i.guild.roles.fetch(r.purchase.roleId).catch(() => null))) : null;
      if (existing) {
        await existing.edit({ colors: { primaryColor: color }, name, reason: `授与品: ${item.name}（色を変えた）` });
        if (!i.member.roles.cache.has(existing.id)) await i.member.roles.add(existing, `授与品: ${item.name}`);
      } else {
        const role = await i.guild.roles.create({ name, colors: { primaryColor: color }, permissions: [], hoist: false, mentionable: false, reason: `授与品: ${item.name}` });
        await setPurchaseRole(this.db, r.purchase.id, role.id);
        // 名前がこの色になるよう、その人の色つきのロールより上に（BOT のロールより下）
        const top = i.guild.members.me?.roles.highest.position ?? 0;
        const colored = [...i.member.roles.cache.values()].filter((x) => (x.colors.primaryColor || x.color) !== 0 && x.id !== role.id);
        const want = Math.min(top - 1, Math.max(0, ...colored.map((x) => x.position)) + 1);
        if (want > role.position) await role.setPosition(want).catch((err: unknown) => logger.warn({ err }, 'mycolor position failed'));
        await i.member.roles.add(role, `授与品: ${item.name}`);
      }
    } catch (err) {
      logger.warn({ err }, 'mycolor role failed');
      await undoMyColor(this.db, r, price);
      return void (await i.editReply(done(`色のロールを作れなかったので、${this.coinName}を戻しました。神職に知らせてください（BOT の「ロールの管理」の権限）。`)));
    }
    const until = r.purchase.expiresAt ? `${fmtDate(r.purchase.expiresAt)} まで` : 'ずっと';
    await i.editReply({
      content: '',
      embeds: [{ title: `🎨 ${r.extended ? '色を変えました' : '自分だけの色を授かりました'}`, description: `${until}。残り ${r.balance} 枚。\n-# 名前の色が変わらないときは、Discord を開き直してください`, color }],
      components: [],
    });
  }

  // ───────── 🧧 お年玉袋 ─────────

  /** 置くチャンネルを選んだら、量・人数・一言の入力欄 */
  private async otoshidamaModal(i: ChannelSelectMenuInteraction<'cached'> | ButtonInteraction<'cached'>, itemId: number, channelId: string): Promise<void> {
    const item = await getItem(this.db, itemId);
    if (!item?.enabled || item.kind !== 'otoshidama') return void (await i.update(done('この授与品は、今は受けられません。')));
    const ch = i.guild.channels.cache.get(channelId);
    const me = i.guild.members.me;
    if (!ch?.isTextBased() || !ch.permissionsFor(i.member).has(['ViewChannel', 'SendMessages']) || !me || !ch.permissionsFor(me).has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
      return void (await i.update(done('そのチャンネルには置けません（あなたか BOT が書き込めないチャンネル）。もう一度「授与品を見る」から選んでください。')));
    }
    const o = OTOSHIDAMA;
    const row = (input: TextInputBuilder) => new ActionRowBuilder<TextInputBuilder>().addComponents(input);
    await i.showModal(
      new ModalBuilder()
        .setCustomId(`shop:otoshi:${item.id}:${ch.id}`)
        .setTitle(`🧧 お年玉袋（#${ch.name}）`.slice(0, 45))
        .addComponents(
          row(new TextInputBuilder().setCustomId('total').setLabel(`入れる${this.coinName}（${o.minTotal}〜${o.maxTotal.toLocaleString('ja-JP')} 枚）`).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(7).setPlaceholder('1000')),
          row(new TextInputBuilder().setCustomId('count').setLabel(`何人で分ける？（${o.minCount}〜${o.maxCount} 人）`).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3).setPlaceholder('5')),
          row(new TextInputBuilder().setCustomId('note').setLabel('一言（なくても大丈夫）').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(60)),
        ),
    );
  }

  private async otoshidamaSubmit(i: ModalSubmitInteraction<'cached'>, itemId: number, channelId: string): Promise<void> {
    if (i.isFromMessage()) await i.deferUpdate();
    else await i.deferReply(EPHEMERAL);
    const cfg = this.cfg();
    const e = cfg.economy;
    const item = await getItem(this.db, itemId);
    const ch = i.guild.channels.cache.get(channelId);
    if (!item?.enabled || item.kind !== 'otoshidama' || !ch?.isSendable() || !ch.permissionsFor(i.member)?.has(['ViewChannel', 'SendMessages'])) {
      return void (await i.editReply(done('この授与品は、今は受けられません。')));
    }
    const total = parseCount(i.fields.getTextInputValue('total'));
    const count = parseCount(i.fields.getTextInputValue('count'));
    const o = OTOSHIDAMA;
    const r = await putBag(this.db, cfg, {
      ownerId: i.user.id,
      roleIds: [...i.member.roles.cache.keys()],
      channelId: ch.id,
      total,
      count,
      note: i.fields.getTextInputValue('note') ?? '',
      fee: this.price(i, item),
      itemId: item.id,
      itemName: item.name,
    });
    if (r.status === 'rank_too_low') return void (await i.editReply(done(`お年玉袋は ${r.rankName} 以上になると置けます。`)));
    if (r.status === 'bad_amount')
      return void (await i.editReply(done(`入れる量は ${o.minTotal}〜${o.maxTotal.toLocaleString('ja-JP')} 枚、人数は ${o.minCount}〜${o.maxCount} 人にしてください（量は人数以上）。`)));
    if (r.status === 'insufficient') return void (await i.editReply(done(`${this.coinName}が足りません（${r.need.toLocaleString('ja-JP')} 枚必要・いま ${r.balance.toLocaleString('ja-JP')} 枚）。`)));
    try {
      const msg = await ch.send({ ...bagMessage(r.bag, [], { name: e.currencyName, emoji: e.currencyEmoji }), allowedMentions: { parse: [] } } as Parameters<typeof ch.send>[0]);
      await setBagMessage(this.db, r.bag.id, msg.id);
    } catch (err) {
      logger.warn({ err }, 'otoshidama post failed');
      await undoBag(this.db, r.bag, this.price(i, item));
      return void (await i.editReply(done(`袋を置けなかったので、${this.coinName}を戻しました。`)));
    }
    await i.editReply(done(`🧧 <#${ch.id}> にお年玉袋を置きました（${r.bag.total.toLocaleString('ja-JP')} 枚・${r.bag.count} 人分）。残り ${r.balance.toLocaleString('ja-JP')} 枚。`));
  }

  // ───────── 期限 ─────────

  /** 10 分ごと: 期限が来た色守りのロールを外し、絵馬のピン留めを外す */
  async expire(now = new Date()): Promise<void> {
    const guild = this.guild;
    if (!guild) return;
    for (const p of await duePurchases(this.db, now)) {
      try {
        if (p.kind === 'mycolor' && p.roleId) {
          // 自分だけの色: ロールごと消す
          await guild.roles.delete(p.roleId, '授与品の期限（自分だけの色）').catch((err) => logger.warn({ err }, 'mycolor expire failed'));
        } else if (p.kind === 'role' && p.roleId) {
          const m = await guild.members.fetch(p.memberId).catch(() => undefined);
          if (m) await m.roles.remove(p.roleId, '授与品の期限').catch((err) => logger.warn({ err }, 'shop role expire failed'));
        } else if (p.kind === 'ema_pin' && p.channelId && p.messageId) {
          const ch = guild.channels.cache.get(p.channelId);
          if (ch?.isTextBased()) await ch.messages.unpin(p.messageId, '授与品の期限').catch(() => undefined);
        }
      } finally {
        await endPurchase(this.db, p.id, now);
      }
    }
  }
}

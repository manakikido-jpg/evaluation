import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Guild,
  type Interaction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { ShopItem } from '../db/schema.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { walletOf } from '../services/economy.js';
import { purchaseMenzaifu } from '../services/moderation.js';
import { drawOmikuji, omikujiToday } from '../services/omikuji.js';
import { buyRole, buySimple, duePurchases, endPurchase, getItem, giveGift, listItems, refund, seedDefaultItems, type BuyResult } from '../services/shop.js';
import { omikujiEmbed } from './omikuji.js';
import { hanafubukiMessage, shopConfirm, shopList, shopPickTarget } from './shopViews.js';

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
        if (id.startsWith('shop:buy:')) return await this.buy(interaction, Number(id.split(':')[2]));
      }
      if (interaction.isStringSelectMenu() && id === 'shop:pick') return await this.pick(interaction);
      if (interaction.isUserSelectMenu() && id.startsWith('shop:target:')) return await this.target(interaction, Number(id.split(':')[2]));
      if (interaction.isModalSubmit()) {
        const [, kind, itemId, targetId] = id.split(':');
        if (kind === 'hana' || kind === 'gift') return await this.submitWithTarget(interaction, kind, Number(itemId), targetId ?? '');
      }
    } catch (err) {
      logger.error({ err, id }, 'shop failed');
      if (interaction.isRepliable()) {
        const content = 'うまくいきませんでした。時間をおいてもう一度お試しください。';
        await (interaction.deferred || interaction.replied ? interaction.editReply(done(content)) : interaction.reply({ content, ...EPHEMERAL })).catch(() => undefined);
      }
    }
  }

  private async balance(userId: string): Promise<number> {
    return (await walletOf(this.db, userId)).balance;
  }

  private async open(i: ButtonInteraction<'cached'>): Promise<void> {
    const items = await listItems(this.db, { enabledOnly: true });
    await i.reply({ ...shopList(items, this.cfg().economy, await this.balance(i.user.id)), ...EPHEMERAL });
  }

  private async pick(i: StringSelectMenuInteraction<'cached'>): Promise<void> {
    const item = await getItem(this.db, Number(i.values[0]));
    if (!item?.enabled) return void (await i.update(done('この授与品は、今は受けられません。')));
    const balance = await this.balance(i.user.id);
    const e = this.cfg().economy;
    if (item.kind === 'gift' || item.kind === 'hanafubuki') return void (await i.update(shopPickTarget(item, e, balance)));
    let note: string | undefined;
    if (item.kind === 'role' && item.roleGroup === 'color') note = '-# ほかの色守りを持っていたら、その色は外れます。同じ色なら期間が延びます';
    if (item.kind === 'ema_pin') note = '-# #絵馬 に書いた、いちばん新しい自分のメッセージをピン留めします';
    await i.update(shopConfirm(item, e, balance, note));
  }

  private async buy(i: ButtonInteraction<'cached'>, itemId: number): Promise<void> {
    await i.deferUpdate();
    const item = await getItem(this.db, itemId);
    if (!item?.enabled) return void (await i.editReply(done('この授与品は、今は受けられません。')));
    const text = await this.execute(i, item);
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

  // ───────── それぞれの授与品 ─────────

  private async execute(i: Buyable, item: ShopItem, extra: { targetId?: string; message?: string } = {}): Promise<string> {
    const cfg = this.cfg();
    const userId = i.user.id;
    switch (item.kind) {
      case 'role':
        return this.role(i, item);
      case 'menzaifu': {
        const r = await purchaseMenzaifu({ db: this.db, cfg, discord: this.discord }, userId);
        if (r.status === 'ok') return `🧾 厄を 1 つ祓いました。${r.remaining ? `残りの厄: ${r.remaining}` : '厄年は外れました。'}`;
        if (r.status === 'no_yaku') return '祓う厄がありません（花びらは減っていません）。';
        if (r.status === 'used_up') return `免罪符は 1 人 ${r.max} 回までです。`;
        return `花びらが足りません（${r.price} 枚必要・いま ${r.balance} 枚）。`;
      }
      case 'omikuji_extra':
        return this.omikujiExtra(i, item);
      case 'ema_pin':
        return this.emaPin(i, item);
      case 'hanafubuki':
        return this.hanafubuki(i, item, extra.targetId ?? '', extra.message ?? '');
      default:
        return 'この授与品は、今は受けられません。';
    }
  }

  private insufficientText(r: BuyResult): string | undefined {
    if (r.status === 'insufficient') return `花びらが足りません（${r.price} 枚必要・いま ${r.balance} 枚）。`;
    if (r.status === 'disabled') return 'この授与品は、今は受けられません。';
    if (r.status === 'owned') return 'もう持っています（花びらは減っていません）。';
    return undefined;
  }

  private async role(i: Buyable, item: ShopItem): Promise<string> {
    const r = await buyRole(this.db, item, i.user.id);
    if (r.status !== 'ok') return this.insufficientText(r)!;
    try {
      await i.member.roles.add(item.roleId!, `授与品: ${item.name}`);
    } catch (err) {
      logger.warn({ err, roleId: item.roleId }, 'shop role add failed');
      await refund(this.db, r.purchase);
      return 'ロールを付けられなかったので、花びらを戻しました。神職に知らせてください（BOT のロールの位置か権限）。';
    }
    for (const old of r.removeRoleIds) await i.member.roles.remove(old, '色守りの買い替え').catch(() => undefined);
    const until = r.purchase.expiresAt ? `${fmtDate(r.purchase.expiresAt)} まで` : 'ずっと';
    return `${item.emoji} ${item.name}を授かりました（${until}）。残り ${r.balance} 枚。`;
  }

  private async omikujiExtra(i: Buyable, item: ShopItem): Promise<string> {
    const cfg = this.cfg();
    const today = await omikujiToday(this.db, i.user.id, new Date());
    if (!today.drawn) return '先に今日のおみくじを引いてください（花びらは減っていません）。';
    if (today.extraUsed) return '今日の「もう 1 回」は使いました。また明日どうぞ。';
    const r = await buySimple(this.db, item, i.user.id);
    if (r.status !== 'ok') return this.insufficientText(r)!;
    const d = await drawOmikuji(this.db, cfg.economy, i.user.id, new Date(), Math.random, { extra: true });
    if (d.status !== 'drawn') {
      await refund(this.db, r.purchase);
      return '今日の「もう 1 回」は使いました（花びらは戻しました）。';
    }
    const embed = omikujiEmbed(d, i.member.displayName, cfg.economy);
    const home = cfg.channels.omikuji ?? i.guild.channels.cache.find((c) => c.isTextBased() && c.name === 'おみくじ')?.id;
    const channel = home ? i.guild.channels.cache.get(home) : undefined;
    if (channel?.isSendable()) {
      await channel.send({ embeds: [{ ...embed, title: `${embed.title}（もう 1 回）` }], allowedMentions: { parse: [] } }).catch(() => undefined);
    }
    return `🎟 もう 1 回引きました: **${d.fortune.name}**${home ? `（<#${home}> に出しました）` : ''}`;
  }

  private async emaPin(i: Buyable, item: ShopItem): Promise<string> {
    const emaId = this.cfg().channels.ema;
    const channel = emaId ? i.guild.channels.cache.get(emaId) : undefined;
    if (!channel?.isTextBased()) return '#絵馬 が見つかりません。神職に知らせてください。';
    const recent = await channel.messages.fetch({ limit: 100 });
    const mine = recent.filter((m) => m.author.id === i.user.id).first();
    if (!mine) return `先に <#${channel.id}> に自己紹介を書いてください（花びらは減っていません）。`;
    if (mine.pinned) return 'もうピン留めされています（花びらは減っていません）。';
    const r = await buySimple(this.db, item, i.user.id, { channelId: channel.id, messageId: mine.id });
    if (r.status !== 'ok') return this.insufficientText(r)!;
    try {
      await mine.pin(`授与品: ${item.name}`);
    } catch (err) {
      logger.warn({ err }, 'ema pin failed');
      await refund(this.db, r.purchase);
      return 'ピン留めできなかったので、花びらを戻しました。神職に知らせてください（BOT の「メッセージの管理」権限）。';
    }
    return `📌 自己紹介を ${fmtDate(r.purchase.expiresAt!)} までピン留めしました。残り ${r.balance} 枚。`;
  }

  private async hanafubuki(i: Buyable, item: ShopItem, targetId: string, message: string): Promise<string> {
    const cfg = this.cfg();
    const home = cfg.channels.keidai ?? i.guild.channels.cache.find((c) => c.isTextBased() && c.name === '境内')?.id;
    const channel = home ? i.guild.channels.cache.get(home) : undefined;
    if (!channel?.isSendable()) return '#境内 が見つかりません。神職に知らせてください。';
    const r = await buySimple(this.db, item, i.user.id, { targetId });
    if (r.status !== 'ok') return this.insufficientText(r)!;
    try {
      await channel.send(hanafubukiMessage(i.user.id, targetId, message));
    } catch (err) {
      logger.warn({ err }, 'hanafubuki post failed');
      await refund(this.db, r.purchase);
      return '花吹雪を出せなかったので、花びらを戻しました。';
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
        return `花びらが足りません（いま ${r.balance} 枚）。`;
    }
  }

  // ───────── 期限 ─────────

  /** 10 分ごと: 期限が来た色守りのロールを外し、絵馬のピン留めを外す */
  async expire(now = new Date()): Promise<void> {
    const guild = this.guild;
    if (!guild) return;
    for (const p of await duePurchases(this.db, now)) {
      try {
        if (p.kind === 'role' && p.roleId) {
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

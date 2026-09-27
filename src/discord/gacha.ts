import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
import { GACHA_TIERS, type GachaConfig, type GuildConfig, type TicketKind } from '../config.js';
import type { Db } from '../db/client.js';
import { shopItems, type GachaPrizeRow, type ShopItem } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { walletOf } from '../services/economy.js';
import {
  drawGacha,
  effectiveRates,
  ensureGachaPrizes,
  gachaStateOf,
  listPrizes,
  prizeChances,
  prizeLabel,
  TIER_LABEL,
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
import { drawOmikuji, omikujiToday } from '../services/omikuji.js';
import { addTickets, MANUAL_TICKETS, TICKET_LABEL, ticketLine, ticketsOf, useTicket } from '../services/tickets.js';
import { omikujiEmbed } from './omikuji.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

const fmt = (n: number) => n.toLocaleString('ja-JP');

/** 1 つの運勢に並べる中身の数（多いときは「ほか N 種」） */
const MAX_LIST = 8;

type Names = { role: (id: string) => string | undefined; shop: (id: number) => ShopItem | undefined; coin?: string };

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

/** /物御籤 と「物御籤を引く」: 値段・割合・中身・天井と、引くボタン（本人にだけ） */
export function gachaMenu(
  g: GachaConfig,
  prizes: GachaPrizeRow[],
  names: Names,
  s: { balance: number; sinceTop: number; tickets: Record<TicketKind, number>; buffs?: Buffs },
  coin: string,
) {
  const rates = effectiveRates(g, prizes);
  const left = untilPity(g, s.sinceTop);
  const buffs = s.buffs;
  const lines = [
    `1 回 **${fmt(g.price)}** 枚 ／ 10 連 **${fmt(g.price * 10)}** 枚（${coin}。本物のお金は使いません）`,
    '',
    ...GACHA_TIERS.filter((t) => rates[t] > 0).map((t) => `${TIER_LABEL[t].emoji} **${TIER_LABEL[t].name}** ${rates[t]}%\n-# ${tierPrizeText(g, prizes, t, names)}`),
    '',
    left !== undefined && rates.daikichi > 0 ? `🎯 天井: 大吉が出ないまま ${g.pity} 回目は必ず大吉（あと **${left}** 回）` : '🎯 天井はありません',
    '-# 持っているロールは出ません（出せる中身がなくなったら、その分は払い戻します）',
    `${coin} いま **${fmt(s.balance)}** 枚`,
    `🎟 持っている券: ${ticketLine(s.tickets) ?? 'なし'}`,
    ...(buffs?.fukuUntil ? [`🧧 福の札: <t:${Math.floor(buffs.fukuUntil.getTime() / 1000)}:f> まで、通話の${coin}が 2 倍`] : []),
    ...(buffs && buffs.luck > 0 ? [`🍀 運気アップ: あと **${buffs.luck}** 回、大吉が出やすい`] : []),
    ...(buffs?.deco ? [`🏷 名前の飾り ${buffs.deco.emoji}: <t:${Math.floor(buffs.deco.until.getTime() / 1000)}:d> まで`] : []),
    '-# 部屋代・授与所の券は使う場面で。札は「🎟 券を使う」から',
  ];
  const usable = MANUAL_TICKETS.some((k) => s.tickets[k] > 0);
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
  );
  return {
    embeds: [{ title: '🎁 物御籤', description: lines.join('\n').slice(0, 4000), color: 0xd7003a }],
    components: [row],
  };
}

/** 「🎟 券を使う」: 持っている札を選ぶ */
export function useTicketMenu(tickets: Record<TicketKind, number>) {
  const owned = MANUAL_TICKETS.filter((k) => tickets[k] > 0);
  return {
    content: owned.length ? '🎟 どの券を使いますか？' : '使える券がありません。',
    components: owned.length
      ? [
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('gacha:usepick')
              .setPlaceholder('使う券を選ぶ')
              .addOptions(
                owned.map((k) => ({
                  label: `${TICKET_LABEL[k].name}（${tickets[k]} 枚）`.slice(0, 100),
                  value: k,
                  description: TICKET_LABEL[k].note.slice(0, 100),
                  emoji: { name: TICKET_LABEL[k].emoji },
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
  if (p.shopItemId) got = `${p.shopName ?? 'ショップの品'}${p.expiresAt ? `（${p.expiresAt.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })} まで）` : ''}`;
  else if (p.roleId) got = `「${roleName(p.roleId)}」`;
  else if (p.ticket) got = `${TICKET_LABEL[p.ticket].emoji}${TICKET_LABEL[p.ticket].name} ×${p.count}`;
  else if (p.coins > 0) got = `${coinName} ${fmt(p.coins)} 枚`;
  else got = 'なし';
  return `${t.emoji} **${t.name}**${p.pity ? '（天井）' : ''} … ${got}`;
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

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    const id = 'customId' in interaction ? interaction.customId : '';
    try {
      if (interaction.isChatInputCommand() && interaction.commandName === 'gacha') return await this.menu(interaction);
      if (interaction.isButton() && id === 'gacha:open') return await this.menu(interaction);
      if (interaction.isButton() && id === 'gacha:draw:free') return await this.draw(interaction, 1, true);
      if (interaction.isButton() && id.startsWith('gacha:draw:')) return await this.draw(interaction, Number(id.split(':')[2]));
      if (interaction.isButton() && id === 'gacha:use') return await this.useMenu(interaction);
      if (interaction.isStringSelectMenu() && id === 'gacha:usepick') return await this.use(interaction, interaction.values[0] as TicketKind);
      if (interaction.isUserSelectMenu() && id === 'gacha:giftto') return await this.gift(interaction);
      if (interaction.isModalSubmit() && id === 'gacha:deco') return await this.deco(interaction);
    } catch (err) {
      logger.error({ err, id }, 'gacha failed');
      const msg = { content: '物御籤を引けませんでした。時間をおいてもう一度お試しください。', ...EPHEMERAL };
      if (interaction.isRepliable()) await (interaction.deferred || interaction.replied ? interaction.followUp(msg) : interaction.reply(msg)).catch(() => undefined);
    }
  }

  private coin(): string {
    const e = this.cfg().economy;
    return `${e.currencyEmoji}${e.currencyName}`;
  }

  /** 中身と、名前の引き方 */
  private async prizes(i: { guild: Guild }): Promise<{ prizes: GachaPrizeRow[]; names: Names }> {
    await ensureGachaPrizes(this.db, this.cfg().gacha);
    const [prizes, items] = await Promise.all([listPrizes(this.db), this.db.select().from(shopItems)]);
    const shop = new Map(items.map((x) => [x.id, x]));
    return { prizes, names: { role: (id) => i.guild.roles.cache.get(id)?.name, shop: (id) => shop.get(id), coin: this.coin() } };
  }

  private async menu(i: ChatInputCommandInteraction<'cached'> | ButtonInteraction<'cached'>): Promise<void> {
    const g = this.cfg().gacha;
    if (!g.enabled) return void (await i.reply({ content: '物御籤は今お休みしています。', ...EPHEMERAL }));
    const [w, st, tickets, buffs, p] = await Promise.all([
      walletOf(this.db, i.user.id),
      gachaStateOf(this.db, i.user.id),
      ticketsOf(this.db, i.user.id),
      buffsOf(this.db, i.user.id),
      this.prizes(i),
    ]);
    await i.reply({ ...gachaMenu(g, p.prizes, p.names, { balance: w.balance, sinceTop: st.sinceTop, tickets, buffs }, this.coin()), ...EPHEMERAL });
  }

  private async draw(i: ButtonInteraction<'cached'>, times: number, free = false): Promise<void> {
    if (times !== 1 && times !== 10) return;
    const cfg = this.cfg();
    const g = cfg.gacha;
    if (!g.enabled) return void (await i.reply({ content: '物御籤は今お休みしています。', ...EPHEMERAL }));
    await i.deferReply(EPHEMERAL);
    const r = await drawGacha(this.db, g, i.user.id, times, [...i.member.roles.cache.keys()], Math.random, new Date(), { free });
    if (r.status === 'disabled') return void (await i.editReply('物御籤は今お休みしています。'));
    if (r.status === 'no_ticket') return void (await i.editReply('🎫 物御籤の無料券がありません。'));
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
      ...(lucky ? [`-# 🍀 運気アップの札が ${lucky} 回効きました`] : []),
      ...(r.refunded > 0 ? [`↩️ 出せる中身がなくなったので、${r.refunded} 回分を払い戻しました。`, ''] : []),
      ...(failed.length
        ? [`⚠️ ${[...new Set(failed)].map((id) => `「${roleName(id)}」`).join('')}を付けられませんでした。神職に知らせてください（記録は残っています）。`, '']
        : []),
      `${this.coin()} 残り **${fmt(r.balance)}** 枚${left !== undefined ? ` ／ 天井まであと ${left} 回` : ''}`,
      `🎟 ${ticketLine(r.tickets) ?? '券はありません'}`,
    ];
    const [p, buffs] = await Promise.all([this.prizes(i), buffsOf(this.db, i.user.id)]);
    await i.editReply({
      embeds: [{ title: `🎁 物御籤${times > 1 ? ` ${times} 連` : ''} ― ${TIER_LABEL[best].name}`, description: lines.join('\n'), color: TIER_LABEL[best].color }],
      components: gachaMenu(g, p.prizes, p.names, { balance: r.balance, sinceTop: r.sinceTop, tickets: r.tickets, buffs }, this.coin()).components,
    });

    // 大吉は #おみくじ でお祝い
    const tops = r.pulls.filter((x) => x.tier === 'daikichi');
    if (!tops.length) return;
    const channel = this.omikujiChannel(i.guild);
    if (!channel) return;
    const got = tops.map((x) => pullLine(x, roleName, cfg.economy.currencyName).replace(/^.*? … /, '')).join('、');
    await channel
      .send({
        embeds: [
          {
            title: '🌸 物御籤で大吉！',
            description: `**${i.member.displayName}** さんが物御籤で **大吉** を引きました！\n授かったもの: ${got}`,
            color: TIER_LABEL.daikichi.color,
          },
        ],
        allowedMentions: { parse: [] },
      })
      .catch((err: unknown) => logger.warn({ err }, 'gacha announce failed'));
  }

  /** #おみくじ（設定になければ「おみくじ」という名前のチャンネル） */
  private omikujiChannel(guild: Guild) {
    const home = this.cfg().channels.omikuji ?? guild.channels.cache.find((c) => c.isTextBased() && c.name === 'おみくじ')?.id;
    const channel = home ? guild.channels.cache.get(home) : undefined;
    return channel?.isSendable() ? channel : undefined;
  }

  // ───────── 券を使う ─────────

  private async useMenu(i: ButtonInteraction<'cached'>): Promise<void> {
    await i.reply({ ...useTicketMenu(await ticketsOf(this.db, i.user.id)), ...EPHEMERAL });
  }

  private async use(i: StringSelectMenuInteraction<'cached'>, kind: TicketKind): Promise<void> {
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
      case 'gacha_free':
        return void (await i.update({ content: '🎫 下の「無料券で引く」から引けます（/物御籤 をひらき直してください）。', components: [] }));
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

  /** 🎴 おみくじもう 1 回券（その日のおみくじをもう 1 回。結果は #おみくじ に） */
  private async omikujiExtra(i: StringSelectMenuInteraction<'cached'>): Promise<string> {
    const cfg = this.cfg();
    const now = new Date();
    const today = await omikujiToday(this.db, i.user.id, now);
    if (!today.drawn) return '先に今日のおみくじを引いてください（券は使っていません）。';
    if (today.extraUsed) return '今日の「もう 1 回」はもう使いました（券は使っていません）。また明日どうぞ。';
    if (!(await useTicket(this.db, i.user.id, 'omikuji_extra'))) return '🎴 おみくじもう 1 回券がありません。';
    const d = await drawOmikuji(this.db, cfg.economy, i.user.id, now, Math.random, { extra: true });
    if (d.status !== 'drawn') {
      await addTickets(this.db, i.user.id, 'omikuji_extra', 1);
      return '今日の「もう 1 回」はもう使いました（券は戻しました）。';
    }
    const embed = omikujiEmbed(d, i.member.displayName, cfg.economy);
    const channel = this.omikujiChannel(i.guild);
    if (channel) await channel.send({ embeds: [{ ...embed, title: `${embed.title}（もう 1 回）` }], allowedMentions: { parse: [] } }).catch(() => undefined);
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

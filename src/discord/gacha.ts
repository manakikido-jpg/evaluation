import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, type ButtonInteraction, type ChatInputCommandInteraction, type Interaction } from 'discord.js';
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
import { TICKET_LABEL, ticketLine, ticketsOf } from '../services/tickets.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

const fmt = (n: number) => n.toLocaleString('ja-JP');

/** 1 つの運勢に並べる中身の数（多いときは「ほか N 種」） */
const MAX_LIST = 8;

type Names = { role: (id: string) => string | undefined; shop: (id: number) => ShopItem | undefined };

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
  s: { balance: number; sinceTop: number; tickets: Record<TicketKind, number> },
  coin: string,
) {
  const rates = effectiveRates(g, prizes);
  const left = untilPity(g, s.sinceTop);
  const lines = [
    `1 回 **${fmt(g.price)}** 枚 ／ 10 連 **${fmt(g.price * 10)}** 枚（${coin}。本物のお金は使いません）`,
    '',
    ...GACHA_TIERS.filter((t) => rates[t] > 0).map((t) => `${TIER_LABEL[t].emoji} **${TIER_LABEL[t].name}** ${rates[t]}%\n-# ${tierPrizeText(g, prizes, t, names)}`),
    '',
    left !== undefined && rates.daikichi > 0 ? `🎯 天井: 大吉が出ないまま ${g.pity} 回目は必ず大吉（あと **${left}** 回）` : '🎯 天井はありません',
    '-# 持っているロールは出ません（出せる中身がなくなったら、その分は払い戻します）',
    `${coin} いま **${fmt(s.balance)}** 枚`,
    `🎟 持っている券: ${ticketLine(s.tickets) ?? 'なし'}`,
    '-# 券は使う場面で自動で使います（部屋代・絵馬の奉納・市場で売れたとき）',
  ];
  return {
    embeds: [{ title: '🎁 物御籤', description: lines.join('\n').slice(0, 4000), color: 0xd7003a }],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
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
      ),
    ],
  };
}

/** 1 回分の結果の一行 */
export function pullLine(p: GachaPull, roleName: (id: string) => string): string {
  const t = TIER_LABEL[p.tier];
  let got: string;
  if (p.shopItemId) got = `${p.shopName ?? 'ショップの品'}${p.expiresAt ? `（${p.expiresAt.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })} まで）` : ''}`;
  else if (p.roleId) got = `「${roleName(p.roleId)}」`;
  else if (p.ticket) got = `${TICKET_LABEL[p.ticket].emoji}${TICKET_LABEL[p.ticket].name} ×${p.count}`;
  else if (p.coins > 0) got = `花びら ${fmt(p.coins)} 枚`;
  else got = 'なし';
  return `${t.emoji} **${t.name}**${p.pity ? '（天井）' : ''} … ${got}`;
}

/** 物御籤を引く */
export class GachaApp {
  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
  ) {}

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    try {
      if (interaction.isChatInputCommand() && interaction.commandName === 'gacha') return await this.menu(interaction);
      if (interaction.isButton() && interaction.customId === 'gacha:open') return await this.menu(interaction);
      if (interaction.isButton() && interaction.customId.startsWith('gacha:draw:')) return await this.draw(interaction, Number(interaction.customId.split(':')[2]));
    } catch (err) {
      logger.error({ err }, 'gacha failed');
      const msg = { content: '物御籤を引けませんでした。時間をおいてもう一度お試しください。', ...EPHEMERAL };
      if (interaction.isRepliable()) await (interaction.deferred || interaction.replied ? interaction.followUp(msg) : interaction.reply(msg)).catch(() => undefined);
    }
  }

  private coin(): string {
    const e = this.cfg().economy;
    return `${e.currencyEmoji}${e.currencyName}`;
  }

  /** 中身と、名前の引き方 */
  private async prizes(i: ButtonInteraction<'cached'> | ChatInputCommandInteraction<'cached'>): Promise<{ prizes: GachaPrizeRow[]; names: Names }> {
    await ensureGachaPrizes(this.db, this.cfg().gacha);
    const [prizes, items] = await Promise.all([listPrizes(this.db), this.db.select().from(shopItems)]);
    const shop = new Map(items.map((x) => [x.id, x]));
    return { prizes, names: { role: (id) => i.guild.roles.cache.get(id)?.name, shop: (id) => shop.get(id) } };
  }

  private async menu(i: ChatInputCommandInteraction<'cached'> | ButtonInteraction<'cached'>): Promise<void> {
    const g = this.cfg().gacha;
    if (!g.enabled) return void (await i.reply({ content: '物御籤は今お休みしています。', ...EPHEMERAL }));
    const [w, st, tickets, p] = await Promise.all([walletOf(this.db, i.user.id), gachaStateOf(this.db, i.user.id), ticketsOf(this.db, i.user.id), this.prizes(i)]);
    await i.reply({ ...gachaMenu(g, p.prizes, p.names, { balance: w.balance, sinceTop: st.sinceTop, tickets }, this.coin()), ...EPHEMERAL });
  }

  private async draw(i: ButtonInteraction<'cached'>, times: number): Promise<void> {
    if (times !== 1 && times !== 10) return;
    const cfg = this.cfg();
    const g = cfg.gacha;
    if (!g.enabled) return void (await i.reply({ content: '物御籤は今お休みしています。', ...EPHEMERAL }));
    await i.deferReply(EPHEMERAL);
    const r = await drawGacha(this.db, g, i.user.id, times, [...i.member.roles.cache.keys()]);
    if (r.status === 'disabled') return void (await i.editReply('物御籤は今お休みしています。'));
    if (r.status === 'empty') return void (await i.editReply('いま出せる中身がありません（持っていないものが残っていません）。花びらは減っていません。'));
    if (r.status === 'insufficient') return void (await i.editReply(`花びらが足りません（${fmt(r.price)} 枚必要・いま ${fmt(r.balance)} 枚）。`));

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
    const lines = [
      ...r.pulls.map((p) => pullLine(p, roleName)),
      '',
      ...(r.refunded > 0 ? [`↩️ 出せる中身がなくなったので、${r.refunded} 回分（${fmt(r.refunded * g.price)} 枚）を払い戻しました。`, ''] : []),
      ...(failed.length
        ? [`⚠️ ${[...new Set(failed)].map((id) => `「${roleName(id)}」`).join('')}を付けられませんでした。神職に知らせてください（記録は残っています）。`, '']
        : []),
      `${this.coin()} 残り **${fmt(r.balance)}** 枚${left !== undefined ? ` ／ 天井まであと ${left} 回` : ''}`,
      `🎟 ${ticketLine(r.tickets) ?? '券はありません'}`,
    ];
    const p = await this.prizes(i);
    await i.editReply({
      embeds: [{ title: `🎁 物御籤${times > 1 ? ` ${times} 連` : ''} ― ${TIER_LABEL[best].name}`, description: lines.join('\n'), color: TIER_LABEL[best].color }],
      components: gachaMenu(g, p.prizes, p.names, { balance: r.balance, sinceTop: r.sinceTop, tickets: r.tickets }, this.coin()).components,
    });

    // 大吉は #おみくじ でお祝い
    const tops = r.pulls.filter((x) => x.tier === 'daikichi');
    if (!tops.length) return;
    const home = cfg.channels.omikuji ?? i.guild.channels.cache.find((c) => c.isTextBased() && c.name === 'おみくじ')?.id;
    const channel = home ? i.guild.channels.cache.get(home) : undefined;
    if (!channel?.isSendable()) return;
    const got = tops.map((x) => pullLine(x, roleName).replace(/^.*? … /, '')).join('、');
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
}

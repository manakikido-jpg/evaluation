import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, type ButtonInteraction, type ChatInputCommandInteraction, type Interaction } from 'discord.js';
import { GACHA_TIERS, type GachaConfig, type GachaPrize, type GuildConfig, type TicketKind } from '../config.js';
import type { Db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { walletOf } from '../services/economy.js';
import { drawGacha, gachaRates, gachaStateOf, TIER_LABEL, untilPity, type GachaPull } from '../services/gacha.js';
import { TICKET_LABEL, ticketLine, ticketsOf } from '../services/tickets.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

const fmt = (n: number) => n.toLocaleString('ja-JP');

/** 運勢ごとの中身の説明 */
export function prizeText(p: GachaPrize, limitedRoles: number): string {
  const ticket = p.ticket !== 'none' && p.count > 0 ? `${TICKET_LABEL[p.ticket].emoji}${TICKET_LABEL[p.ticket].name} ×${p.count}` : '';
  const parts: string[] = [];
  if (p.role && limitedRoles > 0) parts.push(`物御籤限定の色守り・称号（まだ持っていないものから 1 つ）${ticket ? `。全部持っていたら ${ticket}` : ''}`);
  else if (ticket) parts.push(ticket);
  if (p.coins > 0) parts.push(`花びら ${fmt(p.coins)} 枚`);
  return parts.join(' ＋ ') || 'なし';
}

/** /物御籤 と「物御籤を引く」: 値段・割合・中身・天井と、引くボタン（本人にだけ） */
export function gachaMenu(g: GachaConfig, s: { balance: number; sinceTop: number; tickets: Record<TicketKind, number> }, coin: string) {
  const rates = gachaRates(g);
  const left = untilPity(g, s.sinceTop);
  const lines = [
    `1 回 **${fmt(g.price)}** 枚 ／ 10 連 **${fmt(g.price * 10)}** 枚（${coin}。本物のお金は使いません）`,
    '',
    ...GACHA_TIERS.map((t) => `${TIER_LABEL[t].emoji} **${TIER_LABEL[t].name}** ${rates[t]}% … ${prizeText(g.prizes[t], g.roleIds.length)}`),
    '',
    left !== undefined ? `🎯 天井: 大吉が出ないまま ${g.pity} 回目は必ず大吉（あと **${left}** 回）` : '🎯 天井はありません',
    `${coin} いま **${fmt(s.balance)}** 枚`,
    `🎟 持っている券: ${ticketLine(s.tickets) ?? 'なし'}`,
    '-# 券は使う場面で自動で使います（部屋代・絵馬の奉納・市場で売れたとき）',
  ];
  return {
    embeds: [{ title: '🎁 物御籤', description: lines.join('\n'), color: 0xd7003a }],
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
  const got: string[] = [];
  if (p.roleId) got.push(`「${roleName(p.roleId)}」`);
  if (p.ticket) got.push(`${TICKET_LABEL[p.ticket].emoji}${TICKET_LABEL[p.ticket].name} ×${p.count}`);
  if (p.coins > 0) got.push(`花びら ${fmt(p.coins)} 枚`);
  return `${t.emoji} **${t.name}**${p.pity ? '（天井）' : ''} … ${got.join(' ＋ ') || 'なし'}`;
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

  private async menu(i: ChatInputCommandInteraction<'cached'> | ButtonInteraction<'cached'>): Promise<void> {
    const g = this.cfg().gacha;
    if (!g.enabled) return void (await i.reply({ content: '物御籤は今お休みしています。', ...EPHEMERAL }));
    const [w, st, tickets] = await Promise.all([walletOf(this.db, i.user.id), gachaStateOf(this.db, i.user.id), ticketsOf(this.db, i.user.id)]);
    await i.reply({ ...gachaMenu(g, { balance: w.balance, sinceTop: st.sinceTop, tickets }, this.coin()), ...EPHEMERAL });
  }

  private async draw(i: ButtonInteraction<'cached'>, times: number): Promise<void> {
    if (times !== 1 && times !== 10) return;
    const cfg = this.cfg();
    const g = cfg.gacha;
    if (!g.enabled) return void (await i.reply({ content: '物御籤は今お休みしています。', ...EPHEMERAL }));
    await i.deferReply(EPHEMERAL);
    const r = await drawGacha(this.db, g, i.user.id, times, [...i.member.roles.cache.keys()]);
    if (r.status === 'disabled') return void (await i.editReply('物御籤は今お休みしています。'));
    if (r.status === 'insufficient') return void (await i.editReply(`花びらが足りません（${fmt(r.price)} 枚必要・いま ${fmt(r.balance)} 枚）。`));

    // 当たったロールを付ける（付けられなければ、神職に知らせてもらう）
    const failed: string[] = [];
    for (const p of r.pulls) {
      if (!p.roleId) continue;
      await i.member.roles.add(p.roleId, '物御籤').catch((err: unknown) => {
        logger.warn({ err, roleId: p.roleId }, 'gacha role add failed');
        failed.push(p.roleId!);
      });
    }
    const roleName = (id: string) => i.guild.roles.cache.get(id)?.name ?? '（ロール）';
    const best = GACHA_TIERS.find((t) => r.pulls.some((p) => p.tier === t)) ?? 'kichi';
    const left = untilPity(g, r.sinceTop);
    const lines = [
      ...r.pulls.map((p) => pullLine(p, roleName)),
      '',
      ...(failed.length ? [`⚠️ ${failed.map((id) => `「${roleName(id)}」`).join('')}を付けられませんでした。神職に知らせてください（記録は残っています）。`, ''] : []),
      `${this.coin()} 残り **${fmt(r.balance)}** 枚${left !== undefined ? ` ／ 天井まであと ${left} 回` : ''}`,
      `🎟 ${ticketLine(r.tickets) ?? '券はありません'}`,
    ];
    await i.editReply({
      embeds: [{ title: `🎁 物御籤${times > 1 ? ` ${times} 連` : ''} ― ${TIER_LABEL[best].name}`, description: lines.join('\n'), color: TIER_LABEL[best].color }],
      components: gachaMenu(g, { balance: r.balance, sinceTop: r.sinceTop, tickets: r.tickets }, this.coin()).components,
    });

    // 大吉は #おみくじ でお祝い
    const tops = r.pulls.filter((p) => p.tier === 'daikichi');
    if (!tops.length) return;
    const home = cfg.channels.omikuji ?? i.guild.channels.cache.find((c) => c.isTextBased() && c.name === 'おみくじ')?.id;
    const channel = home ? i.guild.channels.cache.get(home) : undefined;
    if (!channel?.isSendable()) return;
    const got = tops.map((p) => pullLine(p, roleName).replace(/^.*? … /, '')).join('、');
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

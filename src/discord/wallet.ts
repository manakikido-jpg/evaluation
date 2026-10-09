import { MessageFlags, type ChatInputCommandInteraction, type Interaction } from 'discord.js';
import { and, eq, sql } from 'drizzle-orm';
import type { EconomyConfig, GuildConfig, TicketKind } from '../config.js';
import type { Db } from '../db/client.js';
import { activityDaily, voiceUsage, type CoinTx } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { voiceCapPercentOf, voicePercentOf } from '../domain/ranks.js';
import { jstDate } from '../services/activity.js';
import { buffsOf, type Buffs } from '../services/buffs.js';
import { customHoldingsOf } from '../services/customTickets.js';
import { COIN_REASON_LABEL, recentCoinTx, walletOf } from '../services/economy.js';
import { TICKET_LABEL, ticketsOf } from '../services/tickets.js';
import type { CustomTicket } from '../db/schema.js';


const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const fmt = (n: number) => n.toLocaleString('ja-JP');
export const walletDuration = (minutes: number) => `${Math.floor(Math.max(0, minutes) / 60)}時間${Math.floor(Math.max(0, minutes) % 60)}分`;
const unix = (d: Date) => Math.floor(d.getTime() / 1000);

/**
 * 次に通話の銭が入るまで（「あと 6 分で +5 枚」）。通話の銭は、数えられた時間が 10 分たまるごとに入る。
 * 今日の上限に届いていればそう書く。通常の報酬が0なら、その案内を出す
 */
export function nextVoiceLine(e: Pick<EconomyConfig, 'voicePer10Min'>, today: { vcCoins: number; vcMinutes: number }, cap: number, voicePercent = 100): string[] {
  if (cap <= 0 || Math.round((e.voicePer10Min * voicePercent) / 100) <= 0) return ['今の役職では通常の通話報酬はありません。'];
  if (today.vcCoins >= cap) return ['-# 今日の上限に届きました（日本時間の 0 時からまた）'];
  const per10 = Math.round((e.voicePer10Min * voicePercent) / 100);
  const amount = Math.min(per10, cap - today.vcCoins);
  if (amount <= 0) return [];
  const left = 10 - (today.vcMinutes % 10);
  return [`-# あと **${left} 分**で +${fmt(amount)} 枚（2 人以上の通話で、スピーカーミュートしていない時間だけ数えます）`];
}

/** /残高 の中身（本人にだけ） */
export function walletView(
  e: EconomyConfig,
  d: {
    balance: number;
    lifetimeEarned: number;
    today: { vcCoins: number; vcMinutes: number; presenceMinutes?: number };
    recent: Pick<CoinTx, 'amount' | 'reason' | 'at'>[];
    tickets: Record<TicketKind, number>;
    custom: { ticket: CustomTicket; count: number }[];
    buffs: Buffs;
    /** 役職の倍率（%）。10 分ごとの量と 1 日の上限 */
    voicePercent?: number;
    voiceCapPercent?: number;
  },
) {
  const coin = `${e.currencyEmoji}${e.currencyName}`;
  const cap = Math.round((e.voiceDailyCap * (d.voiceCapPercent ?? 100)) / 100);
  const tickets = [
    ...Object.entries(d.tickets).filter(([, n]) => n > 0).map(([kind, n]) => { const t = TICKET_LABEL[kind as TicketKind]; return `${t.emoji} ${t.name} **×${fmt(n)}**`; }),
    ...d.custom.filter(c => c.count > 0).map(c => `${c.ticket.emoji} ${c.ticket.name.slice(0, 40)} **×${fmt(c.count)}**`),
  ];
  const buffs = [
    ...(d.buffs.fukuUntil ? [`🧧 福の札：<t:${unix(d.buffs.fukuUntil)}:f>まで、通話の${e.currencyName}が2倍`] : []),
    ...(d.buffs.casinoUntil ? [`🎰 大勝負の札：<t:${unix(d.buffs.casinoUntil)}:t>まで、カジノの上限アップ`] : []),
    ...(d.buffs.luck > 0 ? [`🍀 運気アップ：物御籤あと${d.buffs.luck}回`] : []),
  ];
  const voice = [
    cap > 0 && (d.voicePercent ?? 100) > 0 ? `今日の受取 **${fmt(d.today.vcCoins)} / ${fmt(cap)} 枚**` : `今日の受取 **${fmt(d.today.vcCoins)} 枚**`,
    `報酬対象の時間：${walletDuration(d.today.vcMinutes)}`,
    ...nextVoiceLine(e, d.today, cap, d.voicePercent ?? 100).map(x => x.replace(/^-# /, '')),
    ...(cap > 0 && (d.voicePercent ?? 100) > 0 ? [`10分ごと ${fmt(Math.round(e.voicePer10Min * (d.voicePercent ?? 100) / 100))}枚・1日${fmt(cap)}枚まで`] : []),
  ];
  return { embeds: [{
    title: '💰 残高',
    description: `# ${coin} **${fmt(d.balance)}** 枚\n累計の受取：${fmt(d.lifetimeEarned)}枚`,
    color: 0xd4a017,
    fields: [
      { name: '🕒 今日の浮上', value: `**${walletDuration(d.today.presenceMinutes ?? d.today.vcMinutes)}**\nAFKを除くVC参加時間（日本時間）`, inline: false },
      { name: '📞 通話報酬', value: voice.join('\n'), inline: false },
      ...(buffs.length ? [{ name: '✨ 効いている効果', value: buffs.join('\n'), inline: false }] : []),
      { name: '🎟 持っている券', value: tickets.length ? [...tickets.slice(0, 12), ...(tickets.length > 12 ? [`ほか${tickets.length - 12}種類（/物御籤で確認）`] : [])].join('\n').slice(0, 1000) : '持っている券はありません', inline: false },
      { name: '📒 最近の出入り', value: d.recent.length ? d.recent.slice(0, 8).map(t => `**${t.amount > 0 ? '＋' : '－'}${fmt(Math.abs(t.amount))}枚**　${COIN_REASON_LABEL[t.reason] ?? t.reason}\n<t:${unix(t.at)}:R>`).join('\n').slice(0, 1000) : 'まだありません', inline: false },
    ],
    footer: { text: '使いみち：授与所・市場・/物御籤・/免罪符' },
  }] };

}

/** /残高: 自分の銭・券・最近の出入り */
export class WalletApp {
  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
  ) {}

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'zandaka') return;
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    try {
      await this.show(interaction);
    } catch (err) {
      logger.error({ err }, 'wallet failed');
      const msg = { content: '残高を出せませんでした。時間をおいてもう一度お試しください。', ...EPHEMERAL };
      await (interaction.replied || interaction.deferred ? interaction.followUp(msg) : interaction.reply(msg)).catch(() => undefined);
    }
  }

  private async show(i: ChatInputCommandInteraction<'cached'>): Promise<void> {
    await i.deferReply(EPHEMERAL);
    const id = i.user.id;
    const now = new Date();
    const [w, recent, tickets, custom, buffs, [today], [presence]] = await Promise.all([
      walletOf(this.db, id),
      recentCoinTx(this.db, id, 8),
      ticketsOf(this.db, id),
      customHoldingsOf(this.db, id),
      buffsOf(this.db, id, now),
      this.db
        .select({ vcCoins: activityDaily.vcCoins, vcMinutes: activityDaily.vcMinutes })
        .from(activityDaily)
        .where(and(eq(activityDaily.memberId, id), eq(activityDaily.date, jstDate(now)))),
      this.db.select({ minutes: sql<number>`coalesce(sum(${voiceUsage.minutes}), 0)::int` }).from(voiceUsage)
        .where(and(eq(voiceUsage.memberId, id), eq(voiceUsage.date, jstDate(now)))),
    ]);
    await i.editReply({
      ...walletView(this.cfg().economy, {
        ...w,
        today: { vcCoins: today?.vcCoins ?? 0, vcMinutes: today?.vcMinutes ?? 0, presenceMinutes: Math.max(presence?.minutes ?? 0, today?.vcMinutes ?? 0) },
        recent,
        tickets,
        custom,
        buffs,
        voicePercent: voicePercentOf(this.cfg().ranks, i.member.roles.cache.keys()),
        voiceCapPercent: voiceCapPercentOf(this.cfg().ranks, i.member.roles.cache.keys()),
      }),
      allowedMentions: { parse: [] },
    });
  }
}

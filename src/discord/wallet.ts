import { MessageFlags, type ChatInputCommandInteraction, type Interaction } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import type { EconomyConfig, GuildConfig, TicketKind } from '../config.js';
import type { Db } from '../db/client.js';
import { activityDaily, type CoinTx } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { voiceCapPercentOf, voicePercentOf } from '../domain/ranks.js';
import { jstDate } from '../services/activity.js';
import { buffsOf, type Buffs } from '../services/buffs.js';
import { customHoldingsOf } from '../services/customTickets.js';
import { COIN_REASON_LABEL, recentCoinTx, walletOf } from '../services/economy.js';
import { ticketsOf } from '../services/tickets.js';
import type { CustomTicket } from '../db/schema.js';
import { allTicketsLine } from './gacha.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const fmt = (n: number) => n.toLocaleString('ja-JP');
const unix = (d: Date) => Math.floor(d.getTime() / 1000);

/**
 * 次に通話の銭が入るまで（「あと 6 分で +5 枚」）。通話の銭は、数えられた時間が 10 分たまるごとに入る。
 * 今日の上限に届いていればそう書く。10 分ごとの量が 0（役職の倍率）なら出さない
 */
export function nextVoiceLine(e: Pick<EconomyConfig, 'voicePer10Min'>, today: { vcCoins: number; vcMinutes: number }, cap: number, voicePercent = 100): string[] {
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
    today: { vcCoins: number; vcMinutes: number };
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
  const lines = [
    `# ${coin} **${fmt(d.balance)}** 枚`,
    `-# これまでにもらった合計 ${fmt(d.lifetimeEarned)} 枚`,
    '',
    `📞 今日の通話で ${fmt(d.today.vcCoins)} / ${fmt(cap)} 枚（${fmt(d.today.vcMinutes)} 分）`,
    ...nextVoiceLine(e, d.today, cap, d.voicePercent ?? 100),
    ...((d.voicePercent ?? 100) !== 100 || (d.voiceCapPercent ?? 100) !== 100
      ? [`-# 役職の倍率: 10 分ごと ${fmt(Math.round((e.voicePer10Min * (d.voicePercent ?? 100)) / 100))} 枚（${d.voicePercent ?? 100}%）・1 日の上限 ${d.voiceCapPercent ?? 100}%`]
      : []),
    ...(d.buffs.fukuUntil ? [`🧧 福の札: <t:${unix(d.buffs.fukuUntil)}:f> まで、通話の${e.currencyName}が 2 倍`] : []),
    ...(d.buffs.casinoUntil ? [`🎰 大勝負の札: <t:${unix(d.buffs.casinoUntil)}:t> まで、カジノの上限が上がっている`] : []),
    ...(d.buffs.luck > 0 ? [`🍀 運気アップ: 物御籤あと ${d.buffs.luck} 回`] : []),
    `🎟 券: ${allTicketsLine(d.tickets, d.custom) ?? 'なし'}`,
    '',
    '**最近の出入り**',
    ...(d.recent.length
      ? d.recent.map((t) => `${t.amount > 0 ? '＋' : '－'}${fmt(Math.abs(t.amount))} ${COIN_REASON_LABEL[t.reason] ?? t.reason} <t:${unix(t.at)}:R>`)
      : ['-# まだありません']),
    '',
    `-# ${e.currencyName}は、通話・朱印・おみくじでもらえます。使いみちは #授与所・#市場・/物御籤・/免罪符`,
  ];
  return { embeds: [{ title: '💰 残高', description: lines.join('\n'), color: 0xd4a017 }] };
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
    const id = i.user.id;
    const now = new Date();
    const [w, recent, tickets, custom, buffs, [today]] = await Promise.all([
      walletOf(this.db, id),
      recentCoinTx(this.db, id, 8),
      ticketsOf(this.db, id),
      customHoldingsOf(this.db, id),
      buffsOf(this.db, id, now),
      this.db
        .select({ vcCoins: activityDaily.vcCoins, vcMinutes: activityDaily.vcMinutes })
        .from(activityDaily)
        .where(and(eq(activityDaily.memberId, id), eq(activityDaily.date, jstDate(now)))),
    ]);
    await i.reply({
      ...walletView(this.cfg().economy, {
        ...w,
        today: today ?? { vcCoins: 0, vcMinutes: 0 },
        recent,
        tickets,
        custom,
        buffs,
        voicePercent: voicePercentOf(this.cfg().ranks, i.member.roles.cache.keys()),
        voiceCapPercent: voiceCapPercentOf(this.cfg().ranks, i.member.roles.cache.keys()),
      }),
      ...EPHEMERAL,
    });
  }
}

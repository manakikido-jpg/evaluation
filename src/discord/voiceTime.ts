import { MessageFlags, type Interaction } from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { UJIKO_MINUTES } from '../domain/ujikoEvaluation.js';
import { logger } from '../lib/logger.js';
import { memberVoiceSummary, type VoiceSummaryPeriod } from '../services/ujikoEvaluation.js';
import { walletDuration } from './wallet.js';

/** ⏱ /浮上 の中身: 今日・7 日・30 日・全期間の浮上時間（全体と縁側）と、氏子の条件に数える縁側の時間 */
export function voiceTimeView(name: string, s: Awaited<ReturnType<typeof memberVoiceSummary>>) {
  const line = (label: string, p: VoiceSummaryPeriod) => `**${label}**　全体 **${walletDuration(p.total)}**　🏮 縁側 **${walletDuration(p.engawa)}**`;
  const left = Math.max(0, UJIKO_MINUTES - s.evaluation);
  return {
    embeds: [{
      title: `⏱ ${name} さんの浮上時間`,
      description: [
        line('今日', s.today),
        line('この 7 日', s.week),
        line('この 30 日', s.month),
        line('全期間', s.all),
        '',
        `🏮 **氏子の条件に数える縁側の時間**: ${walletDuration(s.evaluation)} / ${walletDuration(UJIKO_MINUTES)}${left > 0 ? `（あと ${walletDuration(left)}）` : '（達成）'}`,
        '-# 浮上時間は通話にいた時間（AFK はのぞく・ミュート中もふくむ）。日付は日本時間。🌙 宵縁側は縁側に入りません。',
        '-# 氏子の条件の時間は、ミュート中を数えず、過去分をふくみます（社務所Web の評価と同じ数え方）。',
      ].join('\n'),
      color: 0xd4a017,
    }],
  };
}

/** ⏱ /浮上: 自分の浮上時間（省略すると自分だけに表示。公開: はい でチャンネルへ） */
export class VoiceTimeApp {
  constructor(private readonly db: Db, private readonly cfg: () => GuildConfig) {}

  async onInteraction(i: Interaction): Promise<void> {
    if (typeof i.isChatInputCommand !== 'function' || !i.isChatInputCommand() || i.commandName !== 'fujo') return;
    if (!i.inCachedGuild() || i.guildId !== this.cfg().guildId) return;
    const isPublic = i.options.getBoolean('public') ?? false;
    try {
      await i.deferReply(isPublic ? {} : { flags: MessageFlags.Ephemeral });
      const summary = await memberVoiceSummary(this.db, i.user.id);
      await i.editReply({ ...voiceTimeView(i.member.displayName, summary), allowedMentions: { parse: [] } });
    } catch (err) {
      logger.warn({ err }, 'voice time failed');
      const msg = { content: '浮上時間を出せませんでした。時間をおいてもう一度お試しください。' };
      await (i.deferred || i.replied ? i.editReply(msg) : i.reply({ ...msg, flags: MessageFlags.Ephemeral })).catch(() => undefined);
    }
  }
}

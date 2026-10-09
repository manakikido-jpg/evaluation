import { and, count, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { longVoiceBonuses, members, voiceUsage } from '../db/schema.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { jstDate } from './activity.js';
import { addCoins } from './economy.js';

export function activityWeek(now: Date): string {
  const day = new Date(`${jstDate(now)}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
}

/** 今日の合計7時間で、1日1回・月曜始まりの週に2回まで追加する。 */
export async function awardLongVoiceBonuses(db: Db, cfg: GuildConfig, now = new Date()): Promise<void> {
  const amount = cfg.economy.longVoiceBonusAmount;
  if (amount <= 0) return;
  const date = jstDate(now), week = activityWeek(now);
  const candidates = await db.select({ memberId: voiceUsage.memberId })
    .from(voiceUsage).innerJoin(members, eq(members.id, voiceUsage.memberId))
    .where(and(eq(voiceUsage.date, date), isNull(members.leftAt), eq(members.isBot, false)))
    .groupBy(voiceUsage.memberId).having(sql`sum(${voiceUsage.minutes}) >= 420`);
  for (const { memberId } of candidates) {
    try {
      await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`long-voice:${memberId}:${week}`}))`);
        const [paid] = await tx.select().from(longVoiceBonuses).where(and(eq(longVoiceBonuses.memberId, memberId), eq(longVoiceBonuses.date, date)));
        if (paid) return;
        const [total] = await tx.select({ n: count() }).from(longVoiceBonuses).where(and(eq(longVoiceBonuses.memberId, memberId), eq(longVoiceBonuses.week, week)));
        if ((total?.n ?? 0) >= 2) return;
        await tx.insert(longVoiceBonuses).values({ memberId, date, week, weekSlot: (total?.n ?? 0) + 1, amount, createdAt: now });
        await addCoins(tx, memberId, amount, 'long_voice_bonus', { date, week, minutes: 420 });
      });
    } catch (err) { logger.warn({ err, memberId }, 'long voice bonus failed'); }
  }
}

/** 通知の失敗は次回やり直す。入金を繰り返さず、通知処理の同時実行も避ける。 */
export async function notifyLongVoiceBonuses(db: Db, cfg: GuildConfig, discord: Pick<DiscordActions, 'sendMessage'>, now = new Date()): Promise<void> {
  const expired = new Date(now.getTime() - 5 * 60_000);
  const available = and(isNull(longVoiceBonuses.notifiedAt), or(isNull(longVoiceBonuses.notifyClaimedAt), lt(longVoiceBonuses.notifyClaimedAt, expired)));
  const pending = await db.select().from(longVoiceBonuses).where(available).limit(100);
  for (const row of pending) {
    const key = and(eq(longVoiceBonuses.memberId, row.memberId), eq(longVoiceBonuses.date, row.date));
    const [claimed] = await db.update(longVoiceBonuses).set({ notifyClaimedAt: now }).where(and(key, available)).returning();
    if (!claimed) continue;
    try {
      await discord.sendMessage(cfg.economy.longVoiceBonusChannelId ?? cfg.channels.keiji, {
        content: `🎉 **7時間の浮上ボーナス！**\n<@${row.memberId}> さん、${row.date}のVC参加が合計7時間に達しました。\n${cfg.economy.currencyEmoji}${row.amount.toLocaleString('ja-JP')}${cfg.economy.currencyName}を追加で受け取りました！\n今週のボーナス：${row.weekSlot}/2回`,
        allowed_mentions: { parse: [], users: [row.memberId] },
      });
      await db.update(longVoiceBonuses).set({ notifiedAt: now, notifyClaimedAt: null }).where(and(key, eq(longVoiceBonuses.notifyClaimedAt, now)));
    } catch (err) {
      await db.update(longVoiceBonuses).set({ notifyClaimedAt: null }).where(and(key, eq(longVoiceBonuses.notifyClaimedAt, now)));
      logger.warn({ err, memberId: row.memberId }, 'long voice bonus notice failed');
    }
  }
}

import { eq } from 'drizzle-orm';
import type { CoreTimeConfig, EconomyConfig, GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';
import type { DiscordActions, MessageBody } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { guildChannelsCached } from './notices.js';

/**
 * コアタイム: みんなが集まる時間（日本時間）。
 * - この間の通話は、花びらが coreTimePercent % に増える（増えた分は 1 日の上限に数えない）
 * - #境内 に、前日の決まった時刻と、始まる少し前に予告する
 */

const DAY_MS = 86_400_000;
const JST_MS = 9 * 3_600_000;
export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;
/** BOT が止まっていても、この分数までなら遅れて予告する */
const LATE_OK_MIN = 30;

type Slot = CoreTimeConfig['slots'][number];

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** 日本時間の日付・曜日・0 時からの分 */
export function jstParts(now: Date): { date: string; day: number; minutes: number } {
  const j = new Date(now.getTime() + JST_MS);
  return { date: j.toISOString().slice(0, 10), day: j.getUTCDay(), minutes: j.getUTCHours() * 60 + j.getUTCMinutes() };
}

/** 今コアタイムなら、その枠 */
export function activeCoreTime(ct: CoreTimeConfig, now: Date): Slot | undefined {
  const { day, minutes } = jstParts(now);
  return ct.slots.find((s) => s.day === day && minutes >= toMin(s.start) && minutes < toMin(s.end));
}

/** 「金曜 21:00〜23:00・土曜 21:00〜23:00」 */
export function describeCoreTime(ct: CoreTimeConfig): string {
  if (!ct.slots.length) return 'なし';
  return [...ct.slots]
    .sort((a, b) => a.day - b.day || a.start.localeCompare(b.start))
    .map((s) => `${WEEKDAYS[s.day]}曜 ${s.start}〜${s.end}`)
    .join('・');
}

/** 「1.5」 */
export const coreTimeRate = (e: EconomyConfig) => String(e.coreTimePercent / 100);

/** コアタイム中に 10 分ごとに増える分（端数は四捨五入） */
export const coreTimeBonus = (e: EconomyConfig) => Math.max(0, Math.round((e.voicePer10Min * e.coreTimePercent) / 100) - e.voicePer10Min);

// ───────── 予告 ─────────

export type CoreTimeNotice = { key: string; at: Date; kind: 'day_before' | 'soon'; slot: Slot; date: string };

/** 日本時間の日付 + 分 → Date */
const jstAt = (date: string, minutes: number) => new Date(Date.parse(`${date}T00:00:00Z`) - JST_MS + minutes * 60_000);
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const dayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** 今出すべき予告（予告の時刻から 30 分以内のもの） */
export function dueCoreTimeNotices(ct: CoreTimeConfig, now: Date): CoreTimeNotice[] {
  const today = jstParts(now).date;
  const out: CoreTimeNotice[] = [];
  // 今日・明日・あさって始まる枠（前日の予告は前の日に出すため）
  for (const date of [today, addDays(today, 1), addDays(today, 2)]) {
    for (const slot of ct.slots.filter((s) => s.day === dayOf(date))) {
      const start = toMin(slot.start);
      if (ct.noticeDayBefore) {
        out.push({ key: `${date} ${slot.start} day_before`, at: jstAt(addDays(date, -1), toMin(ct.noticeDayBefore)), kind: 'day_before', slot, date });
      }
      if (ct.noticeMinutesBefore > 0) {
        out.push({ key: `${date} ${slot.start} soon`, at: jstAt(date, start - ct.noticeMinutesBefore), kind: 'soon', slot, date });
      }
    }
  }
  const t = now.getTime();
  return out.filter((n) => n.at.getTime() <= t && t - n.at.getTime() < LATE_OK_MIN * 60_000);
}

export function coreTimeNoticeMessage(n: CoreTimeNotice, cfg: GuildConfig): MessageBody {
  const e = cfg.economy;
  const when = `${WEEKDAYS[n.slot.day]}曜 ${n.slot.start}〜${n.slot.end}`;
  const head = n.kind === 'day_before' ? `🏮 **明日はコアタイム**（${when}）` : `🏮 **このあと ${n.slot.start} からコアタイム**（〜${n.slot.end}）`;
  return {
    content: '',
    embeds: [
      {
        description: [
          head,
          `この時間の通話は、${e.currencyEmoji}${e.currencyName}が **${coreTimeRate(e)} 倍**（増えた分は 1 日の上限に数えません）。`,
          'みんなで通話しましょう！',
        ].join('\n'),
        color: 0xd7003a,
      },
    ],
  };
}

type NoticeState = { keys: string[] };
const STATE_KEY = 'coretime_notices';

/** 1 分ごとに呼ぶ: 予告の時刻になったら #境内 に出す（同じ予告は 1 回だけ） */
export async function processCoreTimeNotices(ctx: { db: Db; cfg: GuildConfig; discord: DiscordActions }, now = new Date()): Promise<number> {
  const due = dueCoreTimeNotices(ctx.cfg.coreTime, now);
  if (!due.length) return 0;
  const [row] = await ctx.db.select().from(settings).where(eq(settings.key, STATE_KEY));
  const done = new Set((row?.value as NoticeState | undefined)?.keys ?? []);
  const todo = due.filter((n) => !done.has(n.key));
  if (!todo.length) return 0;
  const channelId = ctx.cfg.channels.keidai ?? (await guildChannelsCached(ctx.discord, ctx.cfg.guildId)).find((c) => c.type === 0 && c.name === '境内')?.id;
  if (!channelId) {
    logger.warn('コアタイムの予告: #境内 が見つかりません');
    return 0;
  }
  let sent = 0;
  for (const n of todo) {
    // 先に「出した」と記録する（出せなくても何度も出し直さない）
    done.add(n.key);
    const value = { keys: [...done].slice(-40) };
    await ctx.db
      .insert(settings)
      .values({ key: STATE_KEY, value, updatedBy: 'system' })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: 'system', updatedAt: new Date() } });
    try {
      await ctx.discord.sendMessage(channelId, coreTimeNoticeMessage(n, ctx.cfg));
      sent++;
    } catch (err) {
      logger.warn({ err }, 'core time notice failed');
    }
  }
  return sent;
}

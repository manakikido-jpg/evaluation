import { and, count, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { ema, invites, memberAlts, members, omairi, settings, voiceUsage } from '../db/schema.js';
import { highestRank } from '../domain/ranks.js';
import { addDays, jstPeriodStart, ujikoRequirementFrom } from '../domain/ema.js';
import { engawaChannelIds } from './ujikoEvaluation.js';
import { staffAlts } from './staffAlts.js';

/**
 * 🎐 参拝者→氏子の条件（絵馬での昇格が ON のとき）。
 * - 必要数は2週間ごとにきまる（2026-11-27〜）：その2週間のはじめの月曜（日本時間）の前の 7 日間に、縁側に ujikoActiveMinutes 分以上いた
 *   「氏子以上」の人数 × ujikoPercent%（切り上げ・最低 ujikoMin）。
 * - 一人ひとりの必要数は「お参り期間が始まった週」の数で固定（週の人数は、はじめて数えたときに settings に残す）。
 * - 数えるのは、お参り期間中にもらった氏子の票（取り消しを除く）＋招待の補い
 *   （招待した人が通話に4時間いたら 1 つ・inviteSubstituteMax まで。お参り期間中に4時間に届いた招待だけ）。
 * - お参り期間がない参拝者（お参り期間の仕組みより前からいる人など）は、直近 14 日と今週の数で数える。
 */

const DAY = 86_400_000;
const ROLLING_DAYS = 14;
const WEEK_KEY = 'ema_ujiko_week:';

/** その週の前の 7 日間に、縁側に minutes 分以上いた氏子以上の人数（いま在籍している人・BOT とサブを除く） */
export async function activeUjikoPlusCount(db: Db, cfg: GuildConfig, week: string, minutes: number): Promise<number> {
  const from = addDays(week, -7);
  const to = addDays(week, -1);
  const [people, alts, altRows, ids] = await Promise.all([
    db.select({ id: members.id, roleIds: members.roleIds }).from(members).where(and(eq(members.isBot, false), isNull(members.leftAt))),
    staffAlts(db),
    db.select({ id: memberAlts.altId }).from(memberAlts).where(eq(memberAlts.status, 'approved')),
    engawaChannelIds(db, to),
  ]);
  if (!ids.length) return 0;
  const ujikoWeight = cfg.ranks.find((r) => r.key === 'ujiko')?.weight;
  if (ujikoWeight === undefined) return 0;
  const skip = new Set([...alts.map((a) => a.id), ...altRows.map((a) => a.id)]);
  const plus = new Set(
    people.filter((p) => !skip.has(p.id) && (highestRank(cfg.ranks, p.roleIds)?.weight ?? -1) >= ujikoWeight).map((p) => p.id),
  );
  if (!plus.size) return 0;
  const rows = await db
    .select({ id: voiceUsage.memberId, min: sql<number>`sum(${voiceUsage.minutes})::int` })
    .from(voiceUsage)
    .where(and(inArray(voiceUsage.channelId, ids), gte(voiceUsage.date, from), lte(voiceUsage.date, to)))
    .groupBy(voiceUsage.memberId);
  return rows.filter((r) => plus.has(r.id) && Number(r.min) >= minutes).length;
}

/** その週の「縁側にいた氏子以上の人数」。はじめて数えたときに残し、あとは同じ数を使う（分の基準を変えたら数え直す） */
export async function ujikoWeekActive(db: Db, cfg: GuildConfig, week: string): Promise<number> {
  const minutes = cfg.emaThresholds.ujikoActiveMinutes;
  const key = `${WEEK_KEY}${week}`;
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  const saved = row?.value as { active?: number; minutes?: number } | undefined;
  if (typeof saved?.active === 'number' && saved.minutes === minutes) return saved.active;
  const active = await activeUjikoPlusCount(db, cfg, week, minutes);
  const value = { active, minutes };
  if (row) {
    await db.update(settings).set({ value, updatedBy: 'system', updatedAt: new Date() }).where(eq(settings.key, key));
    return active;
  }
  // 同時に数えたときは、先に残したほうを使う
  await db.insert(settings).values({ key, value, updatedBy: 'system' }).onConflictDoNothing();
  const [won] = await db.select().from(settings).where(eq(settings.key, key));
  const v = won?.value as { active?: number } | undefined;
  return typeof v?.active === 'number' ? v.active : active;
}

/** その週の必要数 */
export async function ujikoWeekRequirement(db: Db, cfg: GuildConfig, week: string): Promise<{ week: string; active: number; required: number }> {
  const active = await ujikoWeekActive(db, cfg, week);
  return { week, active, required: ujikoRequirementFrom(active, cfg.emaThresholds) };
}

export type UjikoProgress = {
  /** 必要数を決めた週（月曜日） */
  week: string;
  /** その週の前の 7 日間に縁側にいた氏子以上の人数 */
  active: number;
  /** 必要数 */
  required: number;
  /** お参り期間中にもらった氏子の票 */
  votes: number;
  /** お参り期間中に通話4時間に届いた招待の数（補いに使うのは inviteUsed まで） */
  invites: number;
  inviteUsed: number;
  /** 数えた合計（votes + inviteUsed） */
  total: number;
  /** 数える期間 */
  since: Date;
  until: Date;
  /** お参り期間で数えたか（false＝お参り期間がないので直近 14 日で数えた） */
  inOmairi: boolean;
  /** お参り期間の終わり（お参り期間で数えたときだけ） */
  endsAt?: Date;
  met: boolean;
};

/** 参拝者→氏子の進み具合（お参り期間中の票＋招待の補い と、必要数） */
export async function ujikoProgress(db: Db, cfg: GuildConfig, memberId: string, now = new Date()): Promise<UjikoProgress> {
  const [o] = await db.select().from(omairi).where(eq(omairi.memberId, memberId));
  const inOmairi = Boolean(o && (o.status === 'ongoing' || o.status === 'review'));
  const since = inOmairi ? o!.startedAt : new Date(now.getTime() - ROLLING_DAYS * DAY);
  const until = inOmairi && o!.endsAt < now ? o!.endsAt : now;
  const { week, active, required } = await ujikoWeekRequirement(db, cfg, jstPeriodStart(inOmairi ? o!.startedAt : now));
  const [[v], [i]] = await Promise.all([
    db.select({ n: count() }).from(ema).where(and(eq(ema.receiverId, memberId), eq(ema.tier, 'ujiko'), isNull(ema.revokedAt), gte(ema.createdAt, since), lte(ema.createdAt, until))),
    // 招待の補い：招待された人が通話に4時間いて「1人」と数えた招待（2026-11-27〜）
    db.select({ n: count() }).from(invites).where(and(eq(invites.inviterId, memberId), isNotNull(invites.qualifiedAt), gte(invites.qualifiedAt, since), lte(invites.qualifiedAt, until))),
  ]);
  const votes = Number(v?.n ?? 0);
  const inviteCount = Number(i?.n ?? 0);
  const inviteUsed = Math.min(inviteCount, cfg.emaThresholds.inviteSubstituteMax);
  const total = votes + inviteUsed;
  return { week, active, required, votes, invites: inviteCount, inviteUsed, total, since, until, inOmairi, ...(inOmairi ? { endsAt: o!.endsAt } : {}), met: total >= required };
}

import { and, gte, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { activityDaily, members, shuin } from '../db/schema.js';
import { jstDate } from './activity.js';

/**
 * 推移（管理画面のグラフ）: 人数・入った／抜けた・朱印・発言・通話を、日・週・月ごとにまとめる。
 * 日付はすべて日本時間。
 */

export type TrendRange = '30d' | '90d' | '1y';

export const TREND_RANGES: Record<TrendRange, { label: string; unit: 'day' | 'week' | 'month' }> = {
  '30d': { label: '30 日（1 日ごと）', unit: 'day' },
  '90d': { label: '3 か月（1 週ごと）', unit: 'week' },
  '1y': { label: '1 年（1 か月ごと）', unit: 'month' },
};

export const isTrendRange = (v: unknown): v is TrendRange => typeof v === 'string' && Object.hasOwn(TREND_RANGES, v);

export type TrendBucket = {
  /** グラフの目盛りに出す短い名前 */
  label: string;
  /** 表・ツールチップに出す名前 */
  title: string;
  /** この区切りの最初と最後の日（YYYY-MM-DD、両端を含む） */
  from: string;
  to: string;
  /** 最後の日の終わりにサーバーにいた人数（BOT を除く） */
  members: number;
  joined: number;
  left: number;
  shuin: number;
  messages: number;
  vcMinutes: number;
};

/** YYYY-MM-DD に日数を足す */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/** 区切り（古い順）。最後の区切りは今日を含む */
export function trendBuckets(range: TrendRange, now: Date): Pick<TrendBucket, 'label' | 'title' | 'from' | 'to'>[] {
  const today = jstDate(now);
  const unit = TREND_RANGES[range].unit;
  const out: Pick<TrendBucket, 'label' | 'title' | 'from' | 'to'>[] = [];
  if (unit === 'day') {
    for (let i = 29; i >= 0; i--) {
      const d = addDays(today, -i);
      out.push({ label: md(d), title: md(d), from: d, to: d });
    }
  } else if (unit === 'week') {
    // 月曜はじまり。13 週
    const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
    const thisMonday = addDays(today, -dow);
    for (let i = 12; i >= 0; i--) {
      const from = addDays(thisMonday, -7 * i);
      const to = i === 0 ? today : addDays(from, 6);
      out.push({ label: md(from), title: `${md(from)}〜${md(to)}`, from, to });
    }
  } else {
    const y = Number(today.slice(0, 4));
    const m = Number(today.slice(5, 7));
    for (let i = 11; i >= 0; i--) {
      const first = new Date(Date.UTC(y, m - 1 - i, 1));
      const from = first.toISOString().slice(0, 10);
      const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
      const month = first.getUTCMonth() + 1;
      out.push({ label: `${month}月`, title: `${first.getUTCFullYear()}年${month}月`, from, to: i === 0 ? today : last });
    }
  }
  return out;
}

/** 期間: 決まった期間（30 日など）か、日付で選んだ期間（両端を含む） */
export type TrendSpan = TrendRange | { from: string; to: string };
export type TrendUnit = 'day' | 'week' | 'month';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (d: string) => DATE_RE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
/** 2 つの日付のあいだの日数（両端を含む） */
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
/** 日付で選んだ期間の上限（3 年） */
export const SPAN_MAX_DAYS = 3 * 366;

/** 日付で選んだ期間を確かめる（おかしければ undefined）。未来は今日まで */
export function parseSpan(from: unknown, to: unknown, now: Date): { from: string; to: string } | undefined {
  if (typeof from !== 'string' || typeof to !== 'string' || !validDate(from) || !validDate(to)) return undefined;
  const today = jstDate(now);
  const end = to > today ? today : to;
  if (from > end || daysBetween(from, end) > SPAN_MAX_DAYS) return undefined;
  return { from, to: end };
}

/** 選んだ期間の区切り方（45 日まで 1 日ごと・200 日まで 1 週ごと・それより長いと 1 か月ごと） */
export const unitOf = (span: TrendSpan): TrendUnit => (typeof span === 'string' ? TREND_RANGES[span].unit : daysBetween(span.from, span.to) <= 45 ? 'day' : daysBetween(span.from, span.to) <= 200 ? 'week' : 'month');

/** 日付で選んだ期間の区切り（古い順。週は月曜はじまり・月は 1 日はじまりで、両端は期間で切る） */
export function customBuckets(from: string, to: string): Pick<TrendBucket, 'label' | 'title' | 'from' | 'to'>[] {
  const unit = unitOf({ from, to });
  const out: Pick<TrendBucket, 'label' | 'title' | 'from' | 'to'>[] = [];
  if (unit === 'day') {
    for (let d = from; d <= to; d = addDays(d, 1)) out.push({ label: md(d), title: md(d), from: d, to: d });
  } else if (unit === 'week') {
    let start = from;
    while (start <= to) {
      const dow = (new Date(`${start}T00:00:00Z`).getUTCDay() + 6) % 7;
      const sunday = addDays(start, 6 - dow);
      const end = sunday > to ? to : sunday;
      out.push({ label: md(start), title: `${md(start)}〜${md(end)}`, from: start, to: end });
      start = addDays(end, 1);
    }
  } else {
    let start = from;
    while (start <= to) {
      const y = Number(start.slice(0, 4));
      const m = Number(start.slice(5, 7));
      const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      const end = last > to ? to : last;
      out.push({ label: `${m}月`, title: `${y}年${m}月${start.slice(8) !== '01' || end !== last ? `（${md(start)}〜${md(end)}）` : ''}`, from: start, to: end });
      start = addDays(end, 1);
    }
  }
  return out;
}

/** 期間の区切り */
export const spanBuckets = (span: TrendSpan, now: Date) => (typeof span === 'string' ? trendBuckets(span, now) : customBuckets(span.from, span.to));

/** すぐ前の、同じ長さの期間（くらべる用） */
export function previousSpan(buckets: readonly Pick<TrendBucket, 'from' | 'to'>[]): { from: string; to: string } {
  const from = buckets[0]!.from;
  const to = buckets.at(-1)!.to;
  const n = daysBetween(from, to);
  return { from: addDays(from, -n), to: addDays(from, -1) };
}

/** JST の日付の始まり（UTC の Date） */
const startOfJstDate = (date: string) => new Date(`${date}T00:00:00+09:00`);

export async function memberTrend(db: Db, range: TrendSpan, now: Date): Promise<TrendBucket[]> {
  const buckets = spanBuckets(range, now);
  const first = buckets[0]!.from;
  const since = startOfJstDate(first);

  // 人数は、入った日・抜けた日から数え直す（入り直した人は最後に入った日で数える）
  const people = (await db
    .select({ joinedAt: members.joinedAt, leftAt: members.leftAt })
    .from(members)
    .where(sql`${members.isBot} = false`)).map((m) => ({
    joined: m.joinedAt ? jstDate(m.joinedAt) : '0000-00-00',
    left: m.leftAt ? jstDate(m.leftAt) : null,
  }));

  const stamps = await db
    .select({ at: shuin.createdAt })
    .from(shuin)
    .where(and(gte(shuin.createdAt, since), isNull(shuin.revokedAt)));
  const shuinDays = stamps.map((s) => jstDate(s.at));

  const activity = await db
    .select({ date: activityDaily.date, messages: sql<number>`sum(${activityDaily.messageCount})::int`, vc: sql<number>`sum(${activityDaily.vcMinutes})::int` })
    .from(activityDaily)
    .where(gte(activityDaily.date, first))
    .groupBy(activityDaily.date);

  const inside = (d: string, b: { from: string; to: string }) => d >= b.from && d <= b.to;
  return buckets.map((b) => ({
    ...b,
    members: people.filter((p) => p.joined <= b.to && (p.left === null || p.left > b.to)).length,
    joined: people.filter((p) => inside(p.joined, b)).length,
    left: people.filter((p) => p.left !== null && inside(p.left, b)).length,
    shuin: shuinDays.filter((d) => inside(d, b)).length,
    messages: activity.filter((a) => inside(a.date, b)).reduce((n, a) => n + (a.messages ?? 0), 0),
    vcMinutes: activity.filter((a) => inside(a.date, b)).reduce((n, a) => n + (a.vc ?? 0), 0),
  }));
}

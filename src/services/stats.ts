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

/** JST の日付の始まり（UTC の Date） */
const startOfJstDate = (date: string) => new Date(`${date}T00:00:00+09:00`);

export async function memberTrend(db: Db, range: TrendRange, now: Date): Promise<TrendBucket[]> {
  const buckets = trendBuckets(range, now);
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

import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { activityDaily, activityHourly, applications, members } from '../db/schema.js';
import { highestRank } from '../domain/ranks.js';
import { jstDate } from './activity.js';
import { trendBuckets, type TrendRange } from './stats.js';

/**
 * 👫 男女の割合（推移のページ）。性別は、男性・女性のロール → なければ入鯖申請の答え → どちらもなければ「不明」。
 * 抜けた人は、抜けたときのロールで数える。日付はすべて日本時間
 */

export type Sex = 'male' | 'female' | 'unknown';
export const SEXES: Sex[] = ['male', 'female', 'unknown'];
export type SexCount = Record<Sex, number>;
const zero = (): SexCount => ({ male: 0, female: 0, unknown: 0 });
export const totalOf = (c: SexCount) => c.male + c.female + c.unknown;
/** 女性の割合（%・性別の分かる人のうち。分かる人がいなければ null） */
export const femaleShare = (c: SexCount): number | null => (c.male + c.female ? (c.female / (c.male + c.female)) * 100 : null);

type Person = { id: string; sex: Sex; joined: string; left: string | null; roleIds: string[]; ageGroup: string; lastActiveAt: Date | null; joinedAt: Date | null };

async function people(db: Db, cfg: Pick<GuildConfig, 'roles'>): Promise<Person[]> {
  const rows = await db
    .select({ id: members.id, roleIds: members.roleIds, joinedAt: members.joinedAt, leftAt: members.leftAt, ageGroup: members.ageGroup, lastActiveAt: members.lastActiveAt })
    .from(members)
    .where(eq(members.isBot, false));
  // 入鯖申請の答え（新しいものを優先）
  const apps = await db
    .select({ memberId: applications.memberId, gender: sql<string | null>`${applications.answers}->>'gender'` })
    .from(applications)
    .where(eq(applications.kind, 'join'))
    .orderBy(desc(applications.createdAt));
  const answered = new Map<string, Sex>();
  for (const a of apps) if (!answered.has(a.memberId) && (a.gender === 'male' || a.gender === 'female')) answered.set(a.memberId, a.gender);
  const { male, female } = cfg.roles;
  return rows.map((m) => ({
    id: m.id,
    sex: female && m.roleIds.includes(female) ? 'female' : male && m.roleIds.includes(male) ? 'male' : (answered.get(m.id) ?? 'unknown'),
    joined: m.joinedAt ? jstDate(m.joinedAt) : '0000-00-00',
    left: m.leftAt ? jstDate(m.leftAt) : null,
    roleIds: m.roleIds,
    ageGroup: m.ageGroup,
    lastActiveAt: m.lastActiveAt,
    joinedAt: m.joinedAt,
  }));
}

const count = (list: Person[]): SexCount => {
  const c = zero();
  for (const p of list) c[p.sex]++;
  return c;
};

export type GenderBucket = { label: string; title: string; from: string; to: string; members: SexCount; joined: SexCount; left: SexCount };

/** 区切りごとの、いる人・入った人・抜けた人の男女 */
export async function genderTrend(db: Db, cfg: Pick<GuildConfig, 'roles'>, range: TrendRange, now: Date): Promise<GenderBucket[]> {
  const list = await people(db, cfg);
  const inside = (d: string, b: { from: string; to: string }) => d >= b.from && d <= b.to;
  return trendBuckets(range, now).map((b) => ({
    ...b,
    members: count(list.filter((p) => p.joined <= b.to && (p.left === null || p.left > b.to))),
    joined: count(list.filter((p) => inside(p.joined, b))),
    left: count(list.filter((p) => p.left !== null && inside(p.left, b))),
  }));
}

export type GenderNow = {
  /** 今いる人 */
  all: SexCount;
  /** 最近 7 日に発言・通話した人 */
  active7: SexCount;
  /** 位ごと（いちばん格の高い位。位のない人は「位なし」） */
  byRank: { name: string; count: SexCount }[];
  /** 年齢区分ごと */
  byAge: { name: string; count: SexCount }[];
  /** 定着: 最近 30 日・90 日に入った人のうち、今もいる人 */
  stay: { days: number; joined: SexCount; stayed: SexCount }[];
};

const AGE_NAME: Record<string, string> = { adult: '18 歳以上', minor: '13〜17 歳', unknown: '年齢不明' };

export async function genderNow(db: Db, cfg: Pick<GuildConfig, 'roles' | 'ranks'>, now: Date): Promise<GenderNow> {
  const list = await people(db, cfg);
  const here = list.filter((p) => p.left === null);
  const weekAgo = now.getTime() - 7 * 86_400_000;
  const ranks = [...cfg.ranks].sort((a, b) => b.weight - a.weight);
  const rankOf = (p: Person) => highestRank(cfg.ranks, p.roleIds)?.key ?? '';
  const byRank = [...ranks.map((r) => ({ key: r.key, name: `${r.emoji} ${r.name}`.trim() })), { key: '', name: '位なし' }]
    .map((r) => ({ name: r.name, count: count(here.filter((p) => rankOf(p) === r.key)) }))
    .filter((r) => totalOf(r.count) > 0);
  const byAge = ['adult', 'minor', 'unknown'].map((a) => ({ name: AGE_NAME[a]!, count: count(here.filter((p) => (AGE_NAME[p.ageGroup] ? p.ageGroup : 'unknown') === a)) })).filter((r) => totalOf(r.count) > 0);
  const stay = [30, 90].map((days) => {
    const since = now.getTime() - days * 86_400_000;
    const joined = list.filter((p) => p.joinedAt && p.joinedAt.getTime() >= since);
    return { days, joined: count(joined), stayed: count(joined.filter((p) => p.left === null)) };
  });
  return {
    all: count(here),
    active7: count(here.filter((p) => p.lastActiveAt && p.lastActiveAt.getTime() >= weekAgo)),
    byRank,
    byAge,
    stay,
  };
}

// ───────── 🌙 浮上（発言・通話）の男女と時間帯 ─────────

export type ActiveBucket = { label: string; title: string; from: string; to: string; people: SexCount; vcMinutes: SexCount; messages: SexCount };
export type HourRow = { hour: number; people: SexCount; vcMinutes: SexCount };
export type ActivityStats = {
  buckets: ActiveBucket[];
  /** 時間帯（0〜23 時）: 1 日あたりの平均の浮上人数・通話の分（記録のある日で割る） */
  hours: HourRow[];
  /** 曜日（月=0）× 時: 1 日あたりの平均の浮上人数（男女合わせて） */
  week: number[][];
  /** 時間帯の記録がある日数 */
  days: number;
};

export async function activityStats(db: Db, cfg: Pick<GuildConfig, 'roles'>, range: TrendRange, now: Date): Promise<ActivityStats> {
  const sexOf = new Map((await people(db, cfg)).map((p) => [p.id, p.sex] as const));
  const sex = (id: string): Sex => sexOf.get(id) ?? 'unknown';
  const bs = trendBuckets(range, now);
  const from = bs[0]!.from;
  const to = bs.at(-1)!.to;
  const daily = await db
    .select({ memberId: activityDaily.memberId, date: activityDaily.date, messages: activityDaily.messageCount, vc: activityDaily.vcMinutes })
    .from(activityDaily)
    .where(and(gte(activityDaily.date, from), lte(activityDaily.date, to)));
  const buckets = bs.map((b) => {
    const rows = daily.filter((r) => r.date >= b.from && r.date <= b.to && (r.messages > 0 || r.vc > 0) && sexOf.has(r.memberId));
    const peopleSet = new Map<string, Sex>();
    const vc = zero();
    const msg = zero();
    for (const r of rows) {
      peopleSet.set(r.memberId, sex(r.memberId));
      vc[sex(r.memberId)] += r.vc;
      msg[sex(r.memberId)] += r.messages;
    }
    const ppl = zero();
    for (const s of peopleSet.values()) ppl[s]++;
    return { ...b, people: ppl, vcMinutes: vc, messages: msg };
  });
  const hourly = await db
    .select({ memberId: activityHourly.memberId, date: activityHourly.date, hour: activityHourly.hour, vc: activityHourly.vcMinutes })
    .from(activityHourly)
    .where(and(gte(activityHourly.date, from), lte(activityHourly.date, to)));
  const dates = new Set(hourly.map((r) => r.date));
  const days = dates.size;
  const hours: HourRow[] = Array.from({ length: 24 }, (_, hour) => ({ hour, people: zero(), vcMinutes: zero() }));
  const weekSum = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const dow = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
  const daysOfWeek = Array<number>(7).fill(0);
  for (const d of dates) daysOfWeek[dow(d)]!++;
  for (const r of hourly) {
    if (!sexOf.has(r.memberId) || r.hour < 0 || r.hour > 23) continue;
    hours[r.hour]!.people[sex(r.memberId)]++;
    hours[r.hour]!.vcMinutes[sex(r.memberId)] += r.vc;
    weekSum[dow(r.date)]![r.hour]!++;
  }
  // 1 日あたりの平均に（小数 1 桁）
  const avg = (n: number, d: number) => (d ? Math.round((n / d) * 10) / 10 : 0);
  for (const h of hours) {
    for (const k of SEXES) {
      h.people[k] = avg(h.people[k], days);
      h.vcMinutes[k] = avg(h.vcMinutes[k], days);
    }
  }
  const week = weekSum.map((row, i) => row.map((n) => avg(n, daysOfWeek[i]!)));
  return { buckets, hours, week, days };
}

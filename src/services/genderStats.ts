import { desc, eq, sql } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { applications, members } from '../db/schema.js';
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

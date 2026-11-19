import { and, countDistinct, eq, gte, inArray, or, sql } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { activityHourly, memberAlts, members, omairi, voicePairs, voiceUsage } from '../db/schema.js';
import { highestRank } from '../domain/ranks.js';
import { staffAlts } from './staffAlts.js';
import { engawaChannelIds } from './ujikoEvaluation.js';
import { jstDate } from './activity.js';

/**
 * 📐 新制度の数字を実データで検証するための集計（社務所Web・読むだけ）。
 * docs/new-system-design.md の数字（絵馬の必要数・条件・昇格/維持・お守り）を決めるための肌感。
 *
 * ⚠️ 今あるデータの限界（ラベルで明示する）:
 * - 縁側の浮上時間は、参拝者＝非ミュート（evaluationEligibleMinutes）、氏子以上＝全時間（minutes）。
 * - 2人の同席（ペア）は voice_pairs。全VC・ミュート込み（縁側だけ・ミュート除外にはできない）。
 * - 時間帯の絞りは activity_hourly。全VC（縁側だけにできない）。
 * これから正確化するデータ収集は別途（Push C）。
 */

export type RankSplit = { sanpaisha: number; ujikoPlus: number };
export type Bucket = { label: string; count: number };
const DAY = 86_400_000;

export type NewSystemStatsOptions = {
  now?: Date;
  /** 期間（直近◯日。はじめ30・365まで） */
  days?: number;
  /** 縁側アクティブ人数の「◯分以上」 */
  activeMin?: number;
  /** 時間帯の絞り（JST 0〜23）。hourTo は「その時」を含まない（0〜24）。コアタイム22〜0時なら from=22,to=24 */
  hourFrom?: number;
  hourTo?: number;
};

export type NewSystemStats = {
  now: Date;
  days: number;
  from: string;
  today: string;
  activeMin: number;
  hourFrom: number;
  hourTo: number;
  /** 在籍（参拝者・氏子以上） */
  baseCount: RankSplit;
  /** 縁側に activeMin 分以上いた人数（週ごと・月ごと） */
  engawaWeekly: { bucket: string; active: RankSplit }[];
  engawaMonthly: { bucket: string; active: RankSplit }[];
  /** 時間帯（全VC）に activeMin 分以上いた人数（期間計・ラベル: 全VC） */
  hourActive: RankSplit;
  /** 絵馬条件: 合計◯分以上いっしょの「組」と「人」。違う日3日以上も満たす組も出す（全VC・ミュート込み） */
  pairByMins: { mins: number; pairs: number; pairsWith3days: number; people: number }[];
  /** 違う日◯日以上いっしょの組（合計180分以上のもの） */
  pairByDays: { days: number; pairs: number }[];
  /** 縁側浮上率（週ごと）: 縁側に出た人数 ÷ 在籍 */
  surfaceWeekly: { bucket: string; active: number; rate: number }[];
  /** 縁側の浮上時間ランキング（期間計・上位20） */
  surfaceTop: { memberId: string; name: string; minutes: number }[];
  /** ◯時間以上、縁側にいた人数（期間計） */
  surfaceHours: { hours: number; people: number }[];
  /** 昇格の現実性：参拝者化後14日以内に顔を合わせた氏子以上（全VC・ミュート込み） */
  promoteReality: { sample: number; avgPartners: number; metPartners: Bucket[]; pairMinutes: Bucket[]; pairDays: Bucket[] };
  /** 維持の現実性：氏子1人あたりが同席した参拝者（期間・全VC・ミュート込み） */
  keepReality: { sample: number; avgPartners: number; metSanpaisha: Bucket[]; pairMinutes: Bucket[] };
  /** 評価期間の延長の上限：参拝者→氏子までの日数（omairi） */
  promoteDays: { sample: number; median: number; p90: number; max: number; buckets: Bucket[] };
};

const MIN_THRESHOLDS = [60, 120, 180, 240, 300];
const DAY_THRESHOLDS = [1, 2, 3, 5];
const HOUR_THRESHOLDS = [1, 3, 5, 10, 20];

function weekStart(date: string): string {
  const d = new Date(date + 'T00:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7; // 月曜=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}
const monthStart = (date: string): string => date.slice(0, 7) + '-01';
const avg1 = (xs: number[]): number => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0);

function partnerHistogram(counts: number[]): Bucket[] {
  const labels = ['0人', '1人', '2人', '3人', '4人', '5人', '6〜9人', '10人以上'];
  const idx = (c: number) => (c <= 5 ? c : c <= 9 ? 6 : 7);
  const out = labels.map((label) => ({ label, count: 0 }));
  for (const c of counts) out[idx(c)]!.count++;
  return out;
}
function minutesHistogram(mins: number[]): Bucket[] {
  const defs: [string, (m: number) => boolean][] = [['30分未満', (m) => m < 30], ['30〜60分', (m) => m >= 30 && m < 60], ['1〜2時間', (m) => m >= 60 && m < 120], ['2〜3時間', (m) => m >= 120 && m < 180], ['3〜5時間', (m) => m >= 180 && m < 300], ['5時間以上', (m) => m >= 300]];
  return defs.map(([label, f]) => ({ label, count: mins.filter(f).length }));
}
function daysHistogram(days: number[]): Bucket[] {
  const labels = ['1日', '2日', '3日', '4日', '5日以上'];
  const out = labels.map((label) => ({ label, count: 0 }));
  for (const d of days) if (d >= 1) out[d >= 5 ? 4 : d - 1]!.count++;
  return out;
}
function daysToUjikoHistogram(days: number[]): Bucket[] {
  const defs: [string, (d: number) => boolean][] = [['0〜7日', (d) => d <= 7], ['8〜14日', (d) => d > 7 && d <= 14], ['15〜21日', (d) => d > 14 && d <= 21], ['22〜30日', (d) => d > 21 && d <= 30], ['31〜60日', (d) => d > 30 && d <= 60], ['61日以上', (d) => d > 60]];
  return defs.map(([label, f]) => ({ label, count: days.filter(f).length }));
}

export async function newSystemStats(db: Db, cfg: GuildConfig, opts: NewSystemStatsOptions = {}): Promise<NewSystemStats> {
  const now = opts.now ?? new Date();
  const days = Math.min(365, Math.max(1, Math.floor(opts.days ?? 30)));
  const activeMin = Math.min(1440, Math.max(1, Math.floor(opts.activeMin ?? 30)));
  const hourFrom = Math.min(23, Math.max(0, Math.floor(opts.hourFrom ?? 0)));
  const hourTo = Math.min(24, Math.max(1, Math.floor(opts.hourTo ?? 24)));
  const today = jstDate(now);
  const from = jstDate(new Date(now.getTime() - (days - 1) * DAY));

  // ── 在籍と役職（現在の役職で分ける・近似）
  const [people, alts, altRows, engawaIds] = await Promise.all([
    db.select({ id: members.id, name: members.displayName, roleIds: members.roleIds, isBot: members.isBot, leftAt: members.leftAt }).from(members),
    staffAlts(db),
    db.select({ id: memberAlts.altId }).from(memberAlts).where(eq(memberAlts.status, 'approved')),
    engawaChannelIds(db, today),
  ]);
  const hidden = new Set([...alts.map((a) => a.id), ...altRows.map((a) => a.id)]);
  const ujikoWeight = cfg.ranks.find((r) => r.key === 'ujiko')?.weight ?? 2;
  const visible = people.filter((p) => !p.isBot && !p.leftAt && !hidden.has(p.id));
  const kindOf = new Map<string, 'sanpaisha' | 'ujikoPlus'>();
  const keyOf = new Map<string, string>(); // 正確な役職キー（維持の対象=氏子ちょうど を分けるため）
  const nameOf = new Map<string, string>();
  const baseCount: RankSplit = { sanpaisha: 0, ujikoPlus: 0 };
  for (const p of visible) {
    nameOf.set(p.id, p.name);
    const r = highestRank(cfg.ranks, p.roleIds);
    if (!r) continue;
    const k = r.key === 'sanpaisha' ? 'sanpaisha' : r.weight >= ujikoWeight ? 'ujikoPlus' : null;
    if (!k) continue;
    kindOf.set(p.id, k);
    keyOf.set(p.id, r.key);
    baseCount[k]++;
  }
  const visibleIds = new Set(kindOf.keys());
  const emptyStats = (): NewSystemStats => ({
    now, days, from, today, activeMin, hourFrom, hourTo, baseCount,
    engawaWeekly: [], engawaMonthly: [], hourActive: { sanpaisha: 0, ujikoPlus: 0 },
    pairByMins: MIN_THRESHOLDS.map((mins) => ({ mins, pairs: 0, pairsWith3days: 0, people: 0 })),
    pairByDays: DAY_THRESHOLDS.map((d) => ({ days: d, pairs: 0 })),
    surfaceWeekly: [], surfaceTop: [], surfaceHours: HOUR_THRESHOLDS.map((hours) => ({ hours, people: 0 })),
    promoteReality: { sample: 0, avgPartners: 0, metPartners: partnerHistogram([]), pairMinutes: minutesHistogram([]), pairDays: daysHistogram([]) },
    keepReality: { sample: 0, avgPartners: 0, metSanpaisha: partnerHistogram([]), pairMinutes: minutesHistogram([]) },
    promoteDays: { sample: 0, median: 0, p90: 0, max: 0, buckets: daysToUjikoHistogram([]) },
  });
  if (!engawaIds.length) return emptyStats();

  // ── 縁側の浮上（日ごと・人ごと。参拝者=非ミュート、氏子以上=全時間）
  const vcRows = await db
    .select({
      id: voiceUsage.memberId,
      date: voiceUsage.date,
      raw: sql<number>`sum(${voiceUsage.minutes})::int`,
      elig: sql<number>`sum(${voiceUsage.evaluationEligibleMinutes})::int`,
    })
    .from(voiceUsage)
    .where(and(inArray(voiceUsage.channelId, engawaIds), gte(voiceUsage.date, from)))
    .groupBy(voiceUsage.memberId, voiceUsage.date);
  const minuteOf = (id: string, raw: number, elig: number): number => (kindOf.get(id) === 'sanpaisha' ? elig : raw);

  // 週・月・期間計の、人ごとの縁側分
  const byBucket = (pick: (date: string) => string) => {
    const map = new Map<string, Map<string, number>>(); // bucket -> (member -> minutes)
    for (const r of vcRows) {
      if (!visibleIds.has(r.id)) continue;
      const b = pick(r.date);
      const m = map.get(b) ?? new Map<string, number>();
      m.set(r.id, (m.get(r.id) ?? 0) + minuteOf(r.id, r.raw, r.elig));
      map.set(b, m);
    }
    return map;
  };
  const activeSplit = (memberMins: Map<string, number>, minMinutes: number): RankSplit => {
    const s: RankSplit = { sanpaisha: 0, ujikoPlus: 0 };
    for (const [id, min] of memberMins) if (min >= minMinutes) s[kindOf.get(id)!]++;
    return s;
  };
  const weeks = byBucket(weekStart);
  const monthsM = byBucket(monthStart);
  const engawaWeekly = [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([bucket, m]) => ({ bucket, active: activeSplit(m, activeMin) }));
  const engawaMonthly = [...monthsM.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([bucket, m]) => ({ bucket, active: activeSplit(m, activeMin) }));

  // 期間計の縁側分（ランキング・◯時間以上）
  const totalMin = new Map<string, number>();
  for (const r of vcRows) {
    if (!visibleIds.has(r.id)) continue;
    totalMin.set(r.id, (totalMin.get(r.id) ?? 0) + minuteOf(r.id, r.raw, r.elig));
  }
  const surfaceTop = [...totalMin.entries()]
    .filter(([, min]) => min > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([id, minutes]) => ({ memberId: id, name: nameOf.get(id) ?? id, minutes }));
  const surfaceHours = HOUR_THRESHOLDS.map((hours) => ({ hours, people: [...totalMin.values()].filter((m) => m >= hours * 60).length }));
  const surfaceWeekly = engawaWeekly.map((w) => {
    const active = (weeks.get(w.bucket) ?? new Map()).size === 0 ? 0 : [...(weeks.get(w.bucket) ?? new Map()).values()].filter((m) => (m as number) > 0).length;
    const baseTotal = baseCount.sanpaisha + baseCount.ujikoPlus;
    return { bucket: w.bucket, active, rate: baseTotal ? Math.round((active / baseTotal) * 1000) / 10 : 0 };
  });

  // ── 時間帯（全VC・activity_hourly）に activeMin 分以上いた人（期間計）
  const hourCond = hourFrom <= hourTo % 24 || hourTo === 24
    ? and(gte(activityHourly.hour, hourFrom), sql`${activityHourly.hour} < ${hourTo}`)
    : sql`(${activityHourly.hour} >= ${hourFrom} or ${activityHourly.hour} < ${hourTo})`;
  const hourRows = await db
    .select({ id: activityHourly.memberId, min: sql<number>`sum(${activityHourly.vcMinutes})::int` })
    .from(activityHourly)
    .where(and(gte(activityHourly.date, from), hourCond))
    .groupBy(activityHourly.memberId);
  const hourActive: RankSplit = { sanpaisha: 0, ujikoPlus: 0 };
  for (const r of hourRows) {
    const k = kindOf.get(r.id);
    if (k && r.min >= activeMin) hourActive[k]++;
  }

  // ── 絵馬条件: 2人の同席（全VC・ミュート込み）
  const pairRows = await db
    .select({ a: voicePairs.memberA, b: voicePairs.memberB, mins: sql<number>`sum(${voicePairs.minutes})::int`, days: countDistinct(voicePairs.date) })
    .from(voicePairs)
    .where(gte(voicePairs.date, from))
    .groupBy(voicePairs.memberA, voicePairs.memberB);
  const pairs = pairRows.filter((p) => visibleIds.has(p.a) && visibleIds.has(p.b));
  const pairByMins = MIN_THRESHOLDS.map((mins) => {
    const meet = pairs.filter((p) => p.mins >= mins);
    const with3 = meet.filter((p) => Number(p.days) >= 3);
    const ppl = new Set<string>();
    for (const p of meet) { ppl.add(p.a); ppl.add(p.b); }
    return { mins, pairs: meet.length, pairsWith3days: with3.length, people: ppl.size };
  });
  const pairByDays = DAY_THRESHOLDS.map((d) => ({ days: d, pairs: pairs.filter((p) => Number(p.days) >= d && p.mins >= 180).length }));

  // ── 維持の現実性: 氏子ちょうど1人あたりが、期間に同席した参拝者（全VC・ミュート込み）
  const keepMap = new Map<string, Set<string>>(); // 氏子 -> 参拝者の集合
  const keepPairMins: number[] = [];
  for (const p of pairs) {
    const ka = keyOf.get(p.a), kb = keyOf.get(p.b);
    const uj = ka === 'ujiko' && kb === 'sanpaisha' ? p.a : kb === 'ujiko' && ka === 'sanpaisha' ? p.b : undefined;
    const sp = uj === p.a ? p.b : uj === p.b ? p.a : undefined;
    if (!uj || !sp) continue;
    (keepMap.get(uj) ?? keepMap.set(uj, new Set()).get(uj)!).add(sp);
    keepPairMins.push(p.mins);
  }
  const ujikoIds = [...keyOf].filter(([, k]) => k === 'ujiko').map(([id]) => id);
  const keepCounts = ujikoIds.map((id) => keepMap.get(id)?.size ?? 0);
  const keepReality = { sample: ujikoIds.length, avgPartners: avg1(keepCounts), metSanpaisha: partnerHistogram(keepCounts), pairMinutes: minutesHistogram(keepPairMins) };

  // ── 昇格の現実性: 参拝者化後14日以内に顔を合わせた氏子以上（全VC・ミュート込み）
  const omairiRows = await db.select({ id: omairi.memberId, startedAt: omairi.startedAt, status: omairi.status, decidedAt: omairi.decidedAt }).from(omairi);
  const startedMap = new Map(omairiRows.map((o) => [o.id, o.startedAt]));
  const participants = visible.filter((p) => kindOf.get(p.id) === 'sanpaisha' && startedMap.has(p.id) && jstDate(startedMap.get(p.id)!) >= from);
  const windowOf = new Map<string, { s: string; e: string }>();
  for (const p of participants) {
    const s = startedMap.get(p.id)!;
    const end = jstDate(new Date(s.getTime() + 14 * DAY));
    windowOf.set(p.id, { s: jstDate(s), e: end < today ? end : today });
  }
  const targetIds = participants.map((p) => p.id);
  const promoRaw = targetIds.length
    ? await db.select({ a: voicePairs.memberA, b: voicePairs.memberB, date: voicePairs.date, minutes: voicePairs.minutes }).from(voicePairs)
        .where(and(gte(voicePairs.date, from), or(inArray(voicePairs.memberA, targetIds), inArray(voicePairs.memberB, targetIds))))
    : [];
  const promoPartners = new Map<string, Map<string, { mins: number; days: Set<string> }>>();
  const addPromo = (pid: string, partner: string, date: string, minutes: number) => {
    const w = windowOf.get(pid);
    if (!w || date < w.s || date > w.e || kindOf.get(partner) !== 'ujikoPlus') return;
    const m = promoPartners.get(pid) ?? promoPartners.set(pid, new Map()).get(pid)!;
    const st = m.get(partner) ?? { mins: 0, days: new Set<string>() };
    st.mins += minutes; st.days.add(date); m.set(partner, st);
  };
  for (const r of promoRaw) {
    if (windowOf.has(r.a)) addPromo(r.a, r.b, r.date, r.minutes);
    if (windowOf.has(r.b)) addPromo(r.b, r.a, r.date, r.minutes);
  }
  const promoCounts: number[] = [], promoPairMins: number[] = [], promoPairDays: number[] = [];
  for (const p of participants) {
    const m = promoPartners.get(p.id);
    promoCounts.push(m?.size ?? 0);
    if (m) for (const st of m.values()) { promoPairMins.push(st.mins); promoPairDays.push(st.days.size); }
  }
  const promoteReality = { sample: participants.length, avgPartners: avg1(promoCounts), metPartners: partnerHistogram(promoCounts), pairMinutes: minutesHistogram(promoPairMins), pairDays: daysHistogram(promoPairDays) };

  // ── 評価期間の延長の上限: 参拝者→氏子までの日数（omairi の startedAt→decidedAt・promoted）
  const promotedDays = omairiRows
    .filter((o) => o.status === 'promoted' && o.decidedAt)
    .map((o) => Math.round((o.decidedAt!.getTime() - o.startedAt.getTime()) / DAY))
    .filter((d) => d >= 0)
    .sort((a, b) => a - b);
  const pick = (q: number) => (promotedDays.length ? promotedDays[Math.min(promotedDays.length - 1, Math.floor(q * (promotedDays.length - 1)))]! : 0);
  const promoteDays = { sample: promotedDays.length, median: pick(0.5), p90: pick(0.9), max: promotedDays.at(-1) ?? 0, buckets: daysToUjikoHistogram(promotedDays) };

  return {
    now, days, from, today, activeMin, hourFrom, hourTo, baseCount,
    engawaWeekly, engawaMonthly, hourActive, pairByMins, pairByDays, surfaceWeekly, surfaceTop, surfaceHours,
    promoteReality, keepReality, promoteDays,
  };
}

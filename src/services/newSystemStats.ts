import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { activityHourly, engawaPairs, memberAlts, members, omairi, voicePairs, voiceUsage } from '../db/schema.js';
import { highestRank } from '../domain/ranks.js';
import { staffAlts } from './staffAlts.js';
import { engawaChannelIds } from './ujikoEvaluation.js';
import { jstDate } from './activity.js';

/**
 * 📐 新制度の数字を実データで検証する集計（社務所Web・読むだけ）。docs/new-system-design.md。
 *
 * ⚠️ 今あるデータの限界（ラベルで明示）:
 * - 縁側の浮上は、参拝者＝非ミュート（evaluationEligibleMinutes）、氏子以上＝全時間（minutes）。
 * - 2人の同席は、全VC・ミュート込み（voice_pairs。今すぐ見られる）か、縁側だけ・ミュート除外（engawa_pairs。2026-11-19〜・これからたまる）。
 * - 時間帯×縁側×ミュート除外は activity_hourly.engawaUnmuteMinutes（2026-11-19〜）。
 */

export type RankSplit = { sanpaisha: number; ujikoPlus: number };
export type Bucket = { label: string; count: number };
const DAY = 86_400_000;

export type NewSystemStatsOptions = {
  now?: Date;
  days?: number;
  activeMin?: number;
  hourFrom?: number;
  hourTo?: number;
  /** 同席のデータ源: 'vc'=全VC・ミュート込み（今すぐ） / 'engawa'=縁側・ミュート除外（2026-11-19〜） */
  src?: 'vc' | 'engawa';
};
export type PairSrc = 'vc' | 'engawa';

/** 絵馬の条件の表: 1日に◯分以上いた日が、◯日以上ある組の数 */
export const EMA_MIN_THRESHOLDS = [30, 60, 120, 180];
export const EMA_DAY_THRESHOLDS = [2, 3, 4, 5];
const HOUR_THRESHOLDS = [1, 3, 5, 10, 20];

export type Ranked = { memberId: string; name: string; minutes: number };
export type NewSystemStats = {
  now: Date; days: number; from: string; today: string; activeMin: number; hourFrom: number; hourTo: number;
  /** 同席（絵馬の条件・昇格・維持）に使ったデータ源 */
  src: PairSrc;
  baseCount: RankSplit;
  /** 縁側アクティブ人数（週・月／◯分以上）。参拝者=ミュート除外・氏子以上=全時間 */
  engawaWeekly: { bucket: string; active: RankSplit }[];
  engawaMonthly: { bucket: string; active: RankSplit }[];
  /** 時間帯×縁側×ミュート除外に◯分以上いた人（2026-11-19〜・たまり中） */
  hourActive: RankSplit;
  /** 絵馬の条件: 氏子以上×参拝者の組ごと、1日◯分以上いた日が◯日以上ある組の数。[分][日数] */
  emaGrid: number[][];
  /** 昇格の現実性（期間内に参拝者化し14日経過した人の、14日以内に会った氏子以上） */
  promoteReality: { sample: number; avgPartners: number; metPartners: Bucket[]; pairMinutes: Bucket[]; pairDays: Bucket[] };
  /** 維持の現実性（月ごと・氏子1人あたりが同席した参拝者） */
  keepMonthly: { month: string; sample: number; avgPartners: number; metSanpaisha: Bucket[] }[];
  keepPairMinutes: Bucket[];
  keepPairDays: Bucket[];
  /** 評価期間（期間内に氏子になった人の、参拝者→氏子までの日数） */
  promoteDays: { sample: number; median: number; p90: number; max: number; buckets: Bucket[] };
  /** お守り: 週ごと（月〜日）に何日縁側へ来たか＋その週の浮上時間ランキング（上位10） */
  surfaceWeekly: { bucket: string; came: number; avgDays: number; top: Ranked[] }[];
  surfaceDaysCame: Bucket[];
  surfaceHours: { hours: number; people: number }[];
};

const avg1 = (xs: number[]): number => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0);
function weekStart(date: string): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const monthStart = (date: string): string => date.slice(0, 7) + '-01';
function monthsBetween(from: string, today: string): string[] {
  const out: string[] = [];
  let y = +from.slice(0, 4), m = +from.slice(5, 7);
  const end = today.slice(0, 7);
  for (let i = 0; i < 24; i++) {
    const s = `${y}-${String(m).padStart(2, '0')}`;
    out.push(s);
    if (s >= end) break;
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}
function partnerHistogram(counts: number[]): Bucket[] {
  const labels = ['0人', '1人', '2人', '3人', '4人', '5人', '6〜9人', '10人以上'];
  const out = labels.map((label) => ({ label, count: 0 }));
  for (const c of counts) out[c <= 5 ? c : c <= 9 ? 6 : 7]!.count++;
  return out;
}
function minutesHistogram(mins: number[]): Bucket[] {
  const defs: [string, (m: number) => boolean][] = [['30分未満', (m) => m < 30], ['30〜60分', (m) => m >= 30 && m < 60], ['1〜2時間', (m) => m >= 60 && m < 120], ['2〜3時間', (m) => m >= 120 && m < 180], ['3〜5時間', (m) => m >= 180 && m < 300], ['5時間以上', (m) => m >= 300]];
  return defs.map(([label, f]) => ({ label, count: mins.filter(f).length }));
}
function daysHistogram(days: number[]): Bucket[] {
  const labels = ['1日', '2日', '3日', '4日', '5〜6日', '7日'];
  const out = labels.map((label) => ({ label, count: 0 }));
  for (const d of days) if (d >= 1) out[d >= 7 ? 5 : d >= 5 ? 4 : d - 1]!.count++;
  return out;
}
function daysToUjikoHistogram(days: number[]): Bucket[] {
  const defs: [string, (d: number) => boolean][] = [['0〜7日', (d) => d <= 7], ['8〜14日', (d) => d > 7 && d <= 14], ['15〜21日', (d) => d > 14 && d <= 21], ['22〜30日', (d) => d > 21 && d <= 30], ['31〜60日', (d) => d > 30 && d <= 60], ['61日以上', (d) => d > 60]];
  return defs.map(([label, f]) => ({ label, count: days.filter(f).length }));
}

/** 氏子以上×参拝者の組ごとに、1日◯分以上いた日が◯日以上ある組の数の表 */
function emaGrid(raw: { a: string; b: string; minutes: number }[], kindOf: Map<string, 'sanpaisha' | 'ujikoPlus'>): number[][] {
  const perPair = new Map<string, number[]>();
  for (const r of raw) {
    const ka = kindOf.get(r.a), kb = kindOf.get(r.b);
    if (!((ka === 'ujikoPlus' && kb === 'sanpaisha') || (kb === 'ujikoPlus' && ka === 'sanpaisha'))) continue;
    const key = `${r.a}|${r.b}`;
    (perPair.get(key) ?? perPair.set(key, []).get(key)!).push(r.minutes);
  }
  return EMA_MIN_THRESHOLDS.map((min) => EMA_DAY_THRESHOLDS.map((dayT) => {
    let c = 0;
    for (const mins of perPair.values()) if (mins.filter((m) => m >= min).length >= dayT) c++;
    return c;
  }));
}

export async function newSystemStats(db: Db, cfg: GuildConfig, opts: NewSystemStatsOptions = {}): Promise<NewSystemStats> {
  const now = opts.now ?? new Date();
  const days = Math.min(365, Math.max(1, Math.floor(opts.days ?? 30)));
  const activeMin = Math.min(1440, Math.max(1, Math.floor(opts.activeMin ?? 30)));
  const hourFrom = Math.min(23, Math.max(0, Math.floor(opts.hourFrom ?? 0)));
  const hourTo = Math.min(24, Math.max(1, Math.floor(opts.hourTo ?? 24)));
  const src: PairSrc = opts.src === 'engawa' ? 'engawa' : 'vc';
  const today = jstDate(now);
  const from = jstDate(new Date(now.getTime() - (days - 1) * DAY));
  const cutoff14 = jstDate(new Date(now.getTime() - 14 * DAY));

  const [people, alts, altRows, engawaIds, omairiRows] = await Promise.all([
    db.select({ id: members.id, name: members.displayName, roleIds: members.roleIds, isBot: members.isBot, leftAt: members.leftAt }).from(members),
    staffAlts(db),
    db.select({ id: memberAlts.altId }).from(memberAlts).where(eq(memberAlts.status, 'approved')),
    engawaChannelIds(db, today),
    db.select({ id: omairi.memberId, startedAt: omairi.startedAt, status: omairi.status, decidedAt: omairi.decidedAt }).from(omairi),
  ]);
  const hidden = new Set([...alts.map((a) => a.id), ...altRows.map((a) => a.id)]);
  const ujikoWeight = cfg.ranks.find((r) => r.key === 'ujiko')?.weight ?? 2;
  const visible = people.filter((p) => !p.isBot && !p.leftAt && !hidden.has(p.id));
  const kindOf = new Map<string, 'sanpaisha' | 'ujikoPlus'>();
  const keyOf = new Map<string, string>();
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
  const ujikoIds = [...keyOf].filter(([, k]) => k === 'ujiko').map(([id]) => id);

  // ── 縁側の浮上（日ごと・人ごと。参拝者=非ミュート、氏子以上=全時間）
  const vcRows = engawaIds.length
    ? await db.select({ id: voiceUsage.memberId, date: voiceUsage.date, raw: sql<number>`sum(${voiceUsage.minutes})::int`, elig: sql<number>`sum(${voiceUsage.evaluationEligibleMinutes})::int` })
        .from(voiceUsage).where(and(inArray(voiceUsage.channelId, engawaIds), gte(voiceUsage.date, from))).groupBy(voiceUsage.memberId, voiceUsage.date)
    : [];
  const minuteOf = (id: string, raw: number, elig: number): number => (kindOf.get(id) === 'sanpaisha' ? elig : raw);

  const byBucket = (pick: (date: string) => string) => {
    const map = new Map<string, Map<string, number>>();
    for (const r of vcRows) {
      if (!visibleIds.has(r.id)) continue;
      const b = pick(r.date);
      const m = map.get(b) ?? map.set(b, new Map()).get(b)!;
      m.set(r.id, (m.get(r.id) ?? 0) + minuteOf(r.id, r.raw, r.elig));
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

  // ── お守り: 週ごとに何日来たか（縁側）
  const weekDays = new Map<string, Map<string, Set<string>>>(); // week -> member -> dates
  const totalMin = new Map<string, number>();
  for (const r of vcRows) {
    if (!visibleIds.has(r.id)) continue;
    const min = minuteOf(r.id, r.raw, r.elig);
    totalMin.set(r.id, (totalMin.get(r.id) ?? 0) + min);
    if (min > 0) {
      const wk = weekStart(r.date);
      const m = weekDays.get(wk) ?? weekDays.set(wk, new Map()).get(wk)!;
      (m.get(r.id) ?? m.set(r.id, new Set()).get(r.id)!).add(r.date);
    }
  }
  const topOf = (m: Map<string, number>): Ranked[] => [...m.entries()].filter(([, min]) => min > 0).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, minutes]) => ({ memberId: id, name: nameOf.get(id) ?? id, minutes }));
  const surfaceWeekly = [...weekDays.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([bucket, m]) => {
    const dayCounts = [...m.values()].map((s) => s.size);
    return { bucket, came: dayCounts.length, avgDays: avg1(dayCounts), top: topOf(weeks.get(bucket) ?? new Map()) };
  });
  const surfaceDaysCame = daysHistogram([...weekDays.values()].flatMap((m) => [...m.values()].map((s) => s.size)));
  const surfaceHours = HOUR_THRESHOLDS.map((hours) => ({ hours, people: [...totalMin.values()].filter((m) => m >= hours * 60).length }));

  // ── 時間帯×縁側×ミュート除外（2026-11-19〜）
  const hourCond = hourFrom <= hourTo % 24 || hourTo === 24
    ? and(gte(activityHourly.hour, hourFrom), sql`${activityHourly.hour} < ${hourTo}`)
    : sql`(${activityHourly.hour} >= ${hourFrom} or ${activityHourly.hour} < ${hourTo})`;
  const hourRows = await db.select({ id: activityHourly.memberId, min: sql<number>`sum(${activityHourly.engawaUnmuteMinutes})::int` })
    .from(activityHourly).where(and(gte(activityHourly.date, from), hourCond)).groupBy(activityHourly.memberId);
  const hourActive: RankSplit = { sanpaisha: 0, ujikoPlus: 0 };
  for (const r of hourRows) { const k = kindOf.get(r.id); if (k && r.min >= activeMin) hourActive[k]++; }

  // ── 2人の同席（全VC・ミュート込み / 縁側・ミュート除外）
  const [rawVc, rawEngawa] = await Promise.all([
    db.select({ a: voicePairs.memberA, b: voicePairs.memberB, date: voicePairs.date, minutes: voicePairs.minutes }).from(voicePairs).where(gte(voicePairs.date, from)),
    db.select({ a: engawaPairs.memberA, b: engawaPairs.memberB, date: engawaPairs.date, minutes: engawaPairs.minutes }).from(engawaPairs).where(gte(engawaPairs.date, from)),
  ]);
  const vcPairs = rawVc.filter((p) => visibleIds.has(p.a) && visibleIds.has(p.b));
  const engPairs = rawEngawa.filter((p) => visibleIds.has(p.a) && visibleIds.has(p.b));
  const pairs = src === 'engawa' ? engPairs : vcPairs;
  const emaGridOut = emaGrid(pairs, kindOf);

  // ── 維持の現実性（月ごと・氏子×参拝者。データ源は src）
  const byMonth = new Map<string, Map<string, Set<string>>>();
  const keepPairTotals = new Map<string, { mins: number; days: Set<string> }>();
  for (const r of pairs) {
    const ka = keyOf.get(r.a), kb = keyOf.get(r.b);
    const uj = ka === 'ujiko' && kb === 'sanpaisha' ? r.a : kb === 'ujiko' && ka === 'sanpaisha' ? r.b : undefined;
    const sp = uj === r.a ? r.b : uj === r.b ? r.a : undefined;
    if (!uj || !sp) continue;
    const mo = r.date.slice(0, 7);
    const mm = byMonth.get(mo) ?? byMonth.set(mo, new Map()).get(mo)!;
    (mm.get(uj) ?? mm.set(uj, new Set()).get(uj)!).add(sp);
    const t = keepPairTotals.get(`${uj}|${sp}`) ?? keepPairTotals.set(`${uj}|${sp}`, { mins: 0, days: new Set() }).get(`${uj}|${sp}`)!;
    t.mins += r.minutes; t.days.add(r.date);
  }
  const keepMonthly = monthsBetween(from, today).map((month) => {
    const mm = byMonth.get(month) ?? new Map<string, Set<string>>();
    const counts = ujikoIds.map((id) => mm.get(id)?.size ?? 0);
    return { month, sample: ujikoIds.length, avgPartners: avg1(counts), metSanpaisha: partnerHistogram(counts) };
  });
  const keepPairMinutes = minutesHistogram([...keepPairTotals.values()].map((t) => t.mins));
  const keepPairDays = daysHistogram([...keepPairTotals.values()].map((t) => t.days.size));

  // ── 昇格の現実性（期間内に参拝者化し14日経過。14日以内に会った氏子以上。データ源は src）
  const startedMap = new Map(omairiRows.map((o) => [o.id, o.startedAt]));
  const participants = visible.filter((p) => {
    if (kindOf.get(p.id) !== 'sanpaisha' || !startedMap.has(p.id)) return false;
    const s = jstDate(startedMap.get(p.id)!);
    return s >= from && s <= cutoff14;
  });
  const windowOf = new Map<string, { s: string; e: string }>();
  for (const p of participants) {
    const s = startedMap.get(p.id)!;
    windowOf.set(p.id, { s: jstDate(s), e: jstDate(new Date(s.getTime() + 14 * DAY)) });
  }
  const targetSet = new Set(participants.map((p) => p.id));
  const promoRaw = (src === 'engawa' ? rawEngawa : rawVc).filter((r) => targetSet.has(r.a) || targetSet.has(r.b));
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

  // ── 評価期間（期間内に氏子になった人の、参拝者→氏子までの日数）
  const promotedDays = omairiRows
    .filter((o) => o.status === 'promoted' && o.decidedAt && jstDate(o.decidedAt) >= from)
    .map((o) => Math.round((o.decidedAt!.getTime() - o.startedAt.getTime()) / DAY))
    .filter((d) => d >= 0)
    .sort((a, b) => a - b);
  const pick = (q: number) => (promotedDays.length ? promotedDays[Math.min(promotedDays.length - 1, Math.floor(q * (promotedDays.length - 1)))]! : 0);
  const promoteDays = { sample: promotedDays.length, median: pick(0.5), p90: pick(0.9), max: promotedDays.at(-1) ?? 0, buckets: daysToUjikoHistogram(promotedDays) };

  return {
    now, days, from, today, activeMin, hourFrom, hourTo, src, baseCount,
    engawaWeekly, engawaMonthly, hourActive, emaGrid: emaGridOut,
    promoteReality, keepMonthly, keepPairMinutes, keepPairDays, promoteDays,
    surfaceWeekly, surfaceDaysCame, surfaceHours,
  };
}

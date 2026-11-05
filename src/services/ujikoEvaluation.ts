import { EVALUATION_START_DATE, UJIKO_SHUIN, UJIKO_MINUTES } from '../domain/ujikoEvaluation.js';
import { and, count, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { members, shuin, voiceChannels, voiceUsage } from '../db/schema.js';
import { highestRank } from '../domain/ranks.js';
import { jstDate } from './activity.js';
import { staffAlts } from './staffAlts.js';
import { isEngawaName } from './voiceUsage.js';

export class EvaluationSelectionError extends Error {}
export type EvaluationChannel = { id: string; name: string; renamed: boolean };
export type EvaluationRow = {
  rank: number; memberId: string; name: string; username: string;
  shuinCount: number; minutes: number; referenceMinutes: number;
  remainingShuin: number; remainingMinutes: number; achieved: boolean;
};
export type EvaluationFilter = { q: string; status: 'all' | 'met' | 'unmet'; channelIds?: string[] };
export type EvaluationData = {
  channels: EvaluationChannel[]; selectedIds: string[]; rows: EvaluationRow[];
  total: number; achieved: number;
};

/** 当時の参拝者・縁側を確認できた分だけを条件に使う。既存の役職不明分は参考値。 */
export async function ujikoEvaluation(db: Db, cfg: GuildConfig, filter: EvaluationFilter, now = new Date()): Promise<EvaluationData> {
  const today = jstDate(now);
  const [people, alts, channelRows, previouslyEngawa] = await Promise.all([
    db.select({ id: members.id, name: members.displayName, username: members.username, roleIds: members.roleIds })
      .from(members).where(and(eq(members.isBot, false), isNull(members.leftAt))),
    staffAlts(db),
    db.select({ id: voiceChannels.channelId, name: voiceChannels.name }).from(voiceChannels),
    db.selectDistinct({ id: voiceUsage.channelId }).from(voiceUsage)
      .where(and(sql`${voiceUsage.sanpaishaMinutes} > 0`, lte(voiceUsage.date, today))),
  ]);
  const oldEngawa = new Set(previouslyEngawa.map(c => c.id));
  const channels = channelRows.filter(c => isEngawaName(c.name) || oldEngawa.has(c.id))
    .map(c => ({ ...c, renamed: !isEngawaName(c.name) })).sort((a, b) => a.name.localeCompare(b.name, 'ja') || a.id.localeCompare(b.id));
  const available = new Set(channels.map(c => c.id));
  if (filter.channelIds?.some(id => !available.has(id))) throw new EvaluationSelectionError('対象の縁側が見つかりません。画面を開き直してください。');
  const selectedIds = [...new Set(filter.channelIds ?? channels.map(c => c.id))];
  const hidden = new Set(alts.map(a => a.id));
  const candidates = people.filter(p => !hidden.has(p.id) && highestRank(cfg.ranks, p.roleIds)?.key === 'sanpaisha');
  const ids = candidates.map(p => p.id);
  const [stamps, usage] = await Promise.all([
    ids.length ? db.select({ id: shuin.receiverId, n: count() }).from(shuin)
      .where(and(inArray(shuin.receiverId, ids), isNull(shuin.revokedAt))).groupBy(shuin.receiverId) : [],
    ids.length && selectedIds.length ? db.select({
      id: voiceUsage.memberId,
      minutes: sql<number>`sum(case when ${voiceUsage.date} >= ${EVALUATION_START_DATE} then ${voiceUsage.sanpaishaMinutes} else 0 end)::int`,
      reference: sql<number>`sum(case when ${voiceUsage.date} < ${EVALUATION_START_DATE} then ${voiceUsage.minutes} else ${voiceUsage.minutes} - ${voiceUsage.rankRecordedMinutes} end)::int`,
    }).from(voiceUsage).where(and(inArray(voiceUsage.memberId, ids), inArray(voiceUsage.channelId, selectedIds), lte(voiceUsage.date, today)))
      .groupBy(voiceUsage.memberId) : [],
  ]);
  const stampMap = new Map(stamps.map(s => [s.id, s.n]));
  const usageMap = new Map(usage.map(u => [u.id, u]));
  const all: EvaluationRow[] = candidates.map(p => {
    const shuinCount = stampMap.get(p.id) ?? 0, u = usageMap.get(p.id), minutes = u?.minutes ?? 0;
    return { rank: 0, memberId: p.id, name: p.name, username: p.username, shuinCount, minutes,
      referenceMinutes: u?.reference ?? 0, remainingShuin: Math.max(0, UJIKO_SHUIN - shuinCount),
      remainingMinutes: Math.max(0, UJIKO_MINUTES - minutes), achieved: shuinCount >= UJIKO_SHUIN && minutes >= UJIKO_MINUTES };
  }).sort((a, b) => Number(b.achieved) - Number(a.achieved) || b.shuinCount - a.shuinCount || b.minutes - a.minutes || a.memberId.localeCompare(b.memberId));
  all.forEach((row, i) => {
    const prev = all[i - 1];
    row.rank = prev && prev.achieved === row.achieved && prev.shuinCount === row.shuinCount && prev.minutes === row.minutes ? prev.rank : i + 1;
  });
  const q = filter.q.normalize('NFKC').toLocaleLowerCase('ja');
  return { channels, selectedIds, total: all.length, achieved: all.filter(r => r.achieved).length,
    rows: all.filter(r => (filter.status === 'all' || r.achieved === (filter.status === 'met')) &&
      (!q || [r.name, r.username, r.memberId].some(s => s.normalize('NFKC').toLocaleLowerCase('ja').includes(q)))) };
}

/** 表計算で名前を数式として実行させない。 */
const csvCell = (value: string | number): string => {
  let s = String(value);
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
};
export function evaluationCsv(data: EvaluationData): string {
  const rows: (string | number)[][] = [['順位', '名前', 'Discord ID', '御朱印の個数', '参拝者の縁側時間（分）', '不足する御朱印', '不足する縁側時間（分）', '達成状況', '開始前・役職不明の参考時間（分・条件に含めない）', '縁側集計開始（日本時間）'],
    ...data.rows.map(r => [r.rank, r.name, "'" + r.memberId, r.shuinCount, r.minutes, r.remainingShuin, r.remainingMinutes, r.achieved ? '両条件達成' : '未達成', r.referenceMinutes, EVALUATION_START_DATE + ' 00:00'])];
  return '\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

import { EVALUATION_START_DATE, UJIKO_SHUIN, UJIKO_MINUTES } from '../domain/ujikoEvaluation.js';
import { and, count, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { evaluationTimeDeductions, members, shuin, voiceChannels, voiceUsage } from '../db/schema.js';
import { highestRank } from '../domain/ranks.js';
import { jstDate } from './activity.js';
import { staffAlts } from './staffAlts.js';
import { isEngawaName } from './voiceUsage.js';
import { coreName } from '../lib/names.js';

export class EvaluationSelectionError extends Error {}
export type EvaluationChannel = { id: string; ids: string[]; name: string; categoryName: string; renamed: boolean };
export type EvaluationRow = {
  rank: number; memberId: string; name: string; username: string;
  shuinCount: number; minutes: number; confirmedMinutes: number; pastMinutes: number; deductedMinutes: number; excludedMinutes: number;
  remainingShuin: number; remainingMinutes: number; achieved: boolean;
};
export type EvaluationFilter = { q: string; status: 'all' | 'met' | 'unmet'; channelIds?: string[] };
export type EvaluationData = {
  channels: EvaluationChannel[]; selectedIds: string[]; rows: EvaluationRow[];
  total: number; achieved: number;
};

/** 人数表示と飾りを除く。部屋番号は残し、別カテゴリは別の対象にする。 */
function roomName(name: string): string {
  return name.normalize('NFKC').replace(/^[^\p{L}\p{N}]*\d+\s*人\s*[|:/・]\s*/u, '')
    .replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, '').trim();
}

/** 過去の部屋IDを表示上だけ束ねる。元の記録やIDは変更しない。 */
function groupChannels(rows: { id: string; name: string; categoryId: string | null; categoryName: string | null; lastSeen: Date }[]): EvaluationChannel[] {
  const grouped = new Map<string, EvaluationChannel>();
  for (const c of [...rows].sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime() || a.id.localeCompare(b.id))) {
    const name = roomName(c.name) || c.name, key = JSON.stringify([c.categoryId, coreName(name) || c.id]);
    const group = grouped.get(key);
    if (group) group.ids.push(c.id);
    else grouped.set(key, { id: c.id, ids: [c.id], name, categoryName: c.categoryName ?? 'カテゴリなし', renamed: !isEngawaName(c.name) });
  }
  for (const group of grouped.values()) { group.ids.sort(); group.id = group.ids[0]!; }
  return [...grouped.values()].sort((a, b) => a.categoryName.localeCompare(b.categoryName, 'ja') || a.name.localeCompare(b.name, 'ja', { numeric: true }) || a.id.localeCompare(b.id));
}

/** 新しい非ミュート判定前の対象時間。役職だけ確認済みの旧記録も含む。 */
export const legacyEvaluationMinutesSql = sql<number>`case when ${voiceUsage.date} < ${EVALUATION_START_DATE} then ${voiceUsage.minutes} else ${voiceUsage.minutes} - ${voiceUsage.rankRecordedMinutes} + ${voiceUsage.sanpaishaMinutes} - ${voiceUsage.evaluationRecordedMinutes} end`;

/** 確認済み時間＋過去取込。過去分の当時役職が未確認であることは内訳へ残す。 */
export async function ujikoEvaluation(db: Db, cfg: GuildConfig, filter: EvaluationFilter, now = new Date()): Promise<EvaluationData> {
  const today = jstDate(now);
  const [people, alts, channelRows, previouslyEngawa] = await Promise.all([
    db.select({ id: members.id, name: members.displayName, username: members.username, roleIds: members.roleIds })
      .from(members).where(and(eq(members.isBot, false), isNull(members.leftAt))),
    staffAlts(db),
    db.select({ id: voiceChannels.channelId, name: voiceChannels.name, categoryId: voiceChannels.categoryId,
      categoryName: voiceChannels.categoryName, lastSeen: voiceChannels.lastSeen }).from(voiceChannels),
    db.selectDistinct({ id: voiceUsage.channelId }).from(voiceUsage)
      .where(and(sql`${voiceUsage.sanpaishaMinutes} > 0`, lte(voiceUsage.date, today))),
  ]);
  const oldEngawa = new Set(previouslyEngawa.map(c => c.id));
  const channels = groupChannels(channelRows.filter(c => isEngawaName(c.name) || oldEngawa.has(c.id)));
  const available = new Set(channels.flatMap(c => c.ids));
  if (filter.channelIds?.some(id => !available.has(id))) throw new EvaluationSelectionError('対象の縁側が見つかりません。画面を開き直してください。');
  // 旧URLの過去IDも受け付け、同じ縁側の履歴をひとまとまりとして選ぶ。
  const requested = filter.channelIds === undefined ? undefined : new Set(filter.channelIds);
  const selected = channels.filter(c => requested === undefined || c.ids.some(id => requested.has(id)));
  const selectedIds = selected.map(c => c.id);
  const selectedChannelIds = [...new Set(selected.flatMap(c => c.ids))];
  const hidden = new Set(alts.map(a => a.id));
  const candidates = people.filter(p => !hidden.has(p.id) && highestRank(cfg.ranks, p.roleIds)?.key === 'sanpaisha');
  const ids = candidates.map(p => p.id);
  const [stamps, usage] = await Promise.all([
    ids.length ? db.select({ id: shuin.receiverId, n: count() }).from(shuin)
      .where(and(inArray(shuin.receiverId, ids), isNull(shuin.revokedAt))).groupBy(shuin.receiverId) : [],
    ids.length && selectedChannelIds.length ? db.select({
      id: voiceUsage.memberId,
      confirmed: sql<number>`sum(case when ${voiceUsage.date} >= ${EVALUATION_START_DATE} then ${voiceUsage.evaluationEligibleMinutes} else 0 end)::int`,
      past: sql<number>`sum(${legacyEvaluationMinutesSql})::int`,
      deducted: sql<number>`sum(least(${legacyEvaluationMinutesSql}, coalesce(${evaluationTimeDeductions.minutes}, 0)))::int`,
      excluded: sql<number>`sum(case when ${voiceUsage.date} >= ${EVALUATION_START_DATE} then ${voiceUsage.evaluationRecordedMinutes} - ${voiceUsage.evaluationEligibleMinutes} else 0 end)::int`,
    }).from(voiceUsage).leftJoin(evaluationTimeDeductions, and(eq(evaluationTimeDeductions.memberId, voiceUsage.memberId), eq(evaluationTimeDeductions.date, voiceUsage.date), eq(evaluationTimeDeductions.channelId, voiceUsage.channelId))).where(and(inArray(voiceUsage.memberId, ids), inArray(voiceUsage.channelId, selectedChannelIds), lte(voiceUsage.date, today)))
      .groupBy(voiceUsage.memberId) : [],
  ]);
  const stampMap = new Map(stamps.map(s => [s.id, s.n]));
  const usageMap = new Map(usage.map(u => [u.id, u]));
  const all: EvaluationRow[] = candidates.map(p => {
    const shuinCount = stampMap.get(p.id) ?? 0, u = usageMap.get(p.id), confirmedMinutes = u?.confirmed ?? 0, deductedMinutes = u?.deducted ?? 0, excludedMinutes = u?.excluded ?? 0, pastMinutes = (u?.past ?? 0) - deductedMinutes;
    const minutes = confirmedMinutes + pastMinutes;
    return { rank: 0, memberId: p.id, name: p.name, username: p.username, shuinCount, minutes,
      confirmedMinutes, pastMinutes, deductedMinutes, excludedMinutes, remainingShuin: Math.max(0, UJIKO_SHUIN - shuinCount),
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
  const target = data.channels.filter(c => data.selectedIds.includes(c.id)).map(c => `${c.categoryName} / ${c.name}`).join('・');
  const rows: (string | number)[][] = [['順位', '名前', 'Discord ID', '御朱印の個数', '縁側の合計時間（分・過去分を含む）', '不足する御朱印', '不足する縁側時間（分）', '達成状況', 'うち過去取込（分・控除後・役職またはミュート未確認）', 'うち参拝者・非ミュート確認済み（分）', '今後のミュート等除外（分）', '過去の控除（分）', '参拝者計測の開始（日本時間）', '非ミュート計測の範囲', '対象の縁側'],
    ...data.rows.map(r => [r.rank, r.name, "'" + r.memberId, r.shuinCount, r.minutes, r.remainingShuin, r.remainingMinutes, r.achieved ? '両条件達成' : '未達成', r.pastMinutes, r.confirmedMinutes, r.excludedMinutes, r.deductedMinutes, EVALUATION_START_DATE + ' 00:00', 'ミュート除外に対応した反映後の確認分', target])];
  return '\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

import { and, count, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { memberAlts, memberEvents, members, omairi, sewayakuElections, sewayakuVotes, voiceUsage, type SewayakuElection } from '../db/schema.js';
import { highestRank } from '../domain/ranks.js';
import { addMonths, sewayakuElectionWindow, sewayakuVotePasses } from '../domain/ema.js';
import { jstDate } from './activity.js';
import { engawaChannelIds } from './ujikoEvaluation.js';
import { newSystemStartedAt } from './shuin.js';
import { staffAlts } from './staffAlts.js';

/**
 * 🗳 氏子→世話役の選挙（候補ごと・2026-11-26 本人の決定）。「絵馬での昇格」が ON のときだけ使う。
 * - 被選挙権：氏子を sewayakuCandidateMonths か月つづけていて、氏子になってから縁側に sewayakuCandidateMinutes 分以上いた氏子。
 *   氏子になった日は、昇格の記録（member_events）かお参り期間の「氏子になった」日。新制度（④ご縁のリセット）より前に
 *   氏子だった人は、新制度が始まった日から数える。落ちた人は、その選挙が終わってから縁側に sewayakuRetryMinutes 分いたらまた候補。
 * - 選挙期間：条件を満たした週の金・土・日（日本時間。金曜0時より後に満たしたら次の週）。
 * - 選挙権：直近30日の縁側の浮上が sewayakuVoterMinutes 分を超えている氏子・世話役・総代（金曜0時に固める。候補本人は除く）。
 * - 「お世話役になってほしい」に匿名で投票（取り消せる）。月曜0時に締めて、票が投票できる人の sewayakuVotePercent% を超えたら世話役
 *   （投票できる人が sewayakuMinVoters 人未満なら不成立）。
 */

const DAY = 86_400_000;
/** 投票できる役職（いちばん上の役職で見る） */
export const SEWAYAKU_VOTER_KEYS: readonly string[] = ['ujiko', 'sewayaku', 'sodai'];

type Person = { id: string; roleIds: string[]; isBot: boolean; leftAt: Date | null };

async function personOf(db: Db, id: string): Promise<Person | undefined> {
  const [m] = await db.select({ id: members.id, roleIds: members.roleIds, isBot: members.isBot, leftAt: members.leftAt }).from(members).where(eq(members.id, id));
  return m;
}

/** 運営のサブ・承認ずみのサブの ID */
async function altIds(db: Db): Promise<Set<string>> {
  const [alts, rows] = await Promise.all([staffAlts(db), db.select({ id: memberAlts.altId }).from(memberAlts).where(eq(memberAlts.status, 'approved'))]);
  return new Set([...alts.map((a) => a.id), ...rows.map((r) => r.id)]);
}

/** 縁側の浮上（分）。from から to まで（YYYY-MM-DD・両方を含む） */
export async function engawaMinutesBetween(db: Db, memberId: string, from: string, to: string): Promise<number> {
  const ids = await engawaChannelIds(db, to);
  if (!ids.length) return 0;
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${voiceUsage.minutes}), 0)::int` })
    .from(voiceUsage)
    .where(and(eq(voiceUsage.memberId, memberId), inArray(voiceUsage.channelId, ids), gte(voiceUsage.date, from), lte(voiceUsage.date, to)));
  return Number(row?.n ?? 0);
}

/** 縁側の時間を数えはじめる日（氏子になった日。新制度より前の氏子は新制度が始まった日）。新制度がまだなら undefined */
export async function ujikoCountFrom(db: Db, memberId: string): Promise<Date | undefined> {
  const started = await newSystemStartedAt(db);
  if (!started) return undefined;
  const [ev] = await db
    .select({ at: memberEvents.at })
    .from(memberEvents)
    .where(and(eq(memberEvents.memberId, memberId), eq(memberEvents.kind, 'promote'), sql`${memberEvents.detail}->>'to' = 'ujiko'`))
    .orderBy(desc(memberEvents.at))
    .limit(1);
  const [o] = await db.select({ at: omairi.decidedAt }).from(omairi).where(and(eq(omairi.memberId, memberId), eq(omairi.status, 'promoted')));
  const became = [ev?.at, o?.at ?? undefined].filter((d): d is Date => d instanceof Date).sort((a, b) => b.getTime() - a.getTime())[0];
  return became && became > started ? became : started;
}

export type VoterStatus = { ok: boolean; reason?: 'not_member' | 'rank' | 'time'; minutes: number; need: number };

/** いま投票できる人か（直近30日＝今日をふくむ30日） */
export async function voterStatus(db: Db, cfg: GuildConfig, voterId: string, now = new Date()): Promise<VoterStatus> {
  const need = cfg.emaThresholds.sewayakuVoterMinutes;
  const p = await personOf(db, voterId);
  if (!p || p.isBot || p.leftAt || (await altIds(db)).has(voterId)) return { ok: false, reason: 'not_member', minutes: 0, need };
  if (!SEWAYAKU_VOTER_KEYS.includes(highestRank(cfg.ranks, p.roleIds)?.key ?? '')) return { ok: false, reason: 'rank', minutes: 0, need };
  const minutes = await engawaMinutesBetween(db, voterId, jstDate(new Date(now.getTime() - 29 * DAY)), jstDate(now));
  return minutes > need ? { ok: true, minutes, need } : { ok: false, reason: 'time', minutes, need };
}

/** その時点で投票できる人を全員（直近30日＝その日の前日までの30日。BOT・抜けた人・サブ・除く人は入れない） */
export async function eligibleVoters(db: Db, cfg: GuildConfig, at: Date, exclude: readonly string[] = []): Promise<string[]> {
  const to = jstDate(new Date(at.getTime() - 1));
  const from = jstDate(new Date(at.getTime() - 30 * DAY));
  const [people, alts, ids] = await Promise.all([
    db.select({ id: members.id, roleIds: members.roleIds }).from(members).where(and(eq(members.isBot, false), isNull(members.leftAt))),
    altIds(db),
    engawaChannelIds(db, to),
  ]);
  if (!ids.length) return [];
  const skip = new Set([...alts, ...exclude]);
  const voters = new Set(people.filter((p) => !skip.has(p.id) && SEWAYAKU_VOTER_KEYS.includes(highestRank(cfg.ranks, p.roleIds)?.key ?? '')).map((p) => p.id));
  if (!voters.size) return [];
  const rows = await db
    .select({ id: voiceUsage.memberId, n: sql<number>`sum(${voiceUsage.minutes})::int` })
    .from(voiceUsage)
    .where(and(inArray(voiceUsage.channelId, ids), gte(voiceUsage.date, from), lte(voiceUsage.date, to)))
    .groupBy(voiceUsage.memberId);
  return rows.filter((r) => voters.has(r.id) && Number(r.n) > cfg.emaThresholds.sewayakuVoterMinutes).map((r) => r.id).sort();
}

export type CandidateStatus = {
  ok: boolean;
  reason?: 'not_member' | 'rank' | 'time' | 'months' | 'not_started' | 'retry';
  /** 氏子になってからの縁側（分） */
  minutes: number;
  need: number;
  from?: Date;
  /** 氏子を必要な月数つづけた日 */
  keptAt?: Date;
  /** 落ちたあと：前の選挙が終わってからの縁側（分）と、要る分 */
  retry?: { minutes: number; need: number; since: Date };
};

/** 候補になれるか（被選挙権） */
export async function candidateStatus(db: Db, cfg: GuildConfig, candidateId: string, now = new Date()): Promise<CandidateStatus> {
  const th = cfg.emaThresholds;
  const need = th.sewayakuCandidateMinutes;
  const p = await personOf(db, candidateId);
  if (!p || p.isBot || p.leftAt || (await altIds(db)).has(candidateId)) return { ok: false, reason: 'not_member', minutes: 0, need };
  if (highestRank(cfg.ranks, p.roleIds)?.key !== 'ujiko') return { ok: false, reason: 'rank', minutes: 0, need };
  const from = await ujikoCountFrom(db, candidateId);
  if (!from) return { ok: false, reason: 'not_started', minutes: 0, need };
  const minutes = await engawaMinutesBetween(db, candidateId, jstDate(from), jstDate(now));
  const keptAt = addMonths(from, th.sewayakuCandidateMonths);
  if (keptAt > now) return { ok: false, reason: 'months', minutes, need, from, keptAt };
  if (minutes < need) return { ok: false, reason: 'time', minutes, need, from, keptAt };
  // 前の選挙で落ちていたら、その選挙が終わってからの縁側で、もう一度候補になれる
  const [lastFailed] = await db
    .select({ endsAt: sewayakuElections.endsAt })
    .from(sewayakuElections)
    .where(and(eq(sewayakuElections.candidateId, candidateId), eq(sewayakuElections.status, 'failed')))
    .orderBy(desc(sewayakuElections.endsAt))
    .limit(1);
  if (lastFailed) {
    const r = await engawaMinutesBetween(db, candidateId, jstDate(lastFailed.endsAt), jstDate(now));
    const retry = { minutes: r, need: th.sewayakuRetryMinutes, since: lastFailed.endsAt };
    if (r < th.sewayakuRetryMinutes) return { ok: false, reason: 'retry', minutes, need, from, keptAt, retry };
    return { ok: true, minutes, need, from, keptAt, retry };
  }
  return { ok: true, minutes, need, from, keptAt };
}

/** その人のいまの選挙（決まった・投票中） */
export async function currentElectionOf(db: Db, candidateId: string): Promise<SewayakuElection | undefined> {
  const [row] = await db
    .select()
    .from(sewayakuElections)
    .where(and(eq(sewayakuElections.candidateId, candidateId), inArray(sewayakuElections.status, ['scheduled', 'open', 'closing'])))
    .orderBy(desc(sewayakuElections.startsAt))
    .limit(1);
  return row;
}

/** 条件を満たした氏子の選挙を決める（見回りで呼ぶ）。決めた選挙を返す */
export async function scheduleSewayakuElections(db: Db, cfg: GuildConfig, now = new Date()): Promise<SewayakuElection[]> {
  const people = await db.select({ id: members.id, roleIds: members.roleIds }).from(members).where(and(eq(members.isBot, false), isNull(members.leftAt)));
  const out: SewayakuElection[] = [];
  for (const m of people) {
    if (highestRank(cfg.ranks, m.roleIds)?.key !== 'ujiko') continue;
    if (await currentElectionOf(db, m.id)) continue;
    if (!(await candidateStatus(db, cfg, m.id, now)).ok) continue;
    const w = sewayakuElectionWindow(now);
    const [row] = await db.insert(sewayakuElections).values({ candidateId: m.id, qualifiedAt: now, startsAt: w.startsAt, endsAt: w.endsAt }).returning();
    if (row) out.push(row);
  }
  return out;
}

/** 金曜0時をすぎた選挙をはじめる（投票できる人を固める）。候補でなくなった人の選挙はやめる。はじめた選挙を返す */
export async function openSewayakuElections(db: Db, cfg: GuildConfig, now = new Date()): Promise<SewayakuElection[]> {
  const due = await db.select().from(sewayakuElections).where(and(eq(sewayakuElections.status, 'scheduled'), lte(sewayakuElections.startsAt, now)));
  const out: SewayakuElection[] = [];
  for (const e of due) {
    const p = await personOf(db, e.candidateId);
    if (!p || p.isBot || p.leftAt || highestRank(cfg.ranks, p.roleIds)?.key !== 'ujiko') {
      await db.update(sewayakuElections).set({ status: 'cancelled', closedAt: now }).where(and(eq(sewayakuElections.id, e.id), eq(sewayakuElections.status, 'scheduled')));
      continue;
    }
    const voterIds = await eligibleVoters(db, cfg, e.startsAt, [e.candidateId]);
    const [row] = await db.update(sewayakuElections).set({ status: 'open', voterIds }).where(and(eq(sewayakuElections.id, e.id), eq(sewayakuElections.status, 'scheduled'))).returning();
    if (row) out.push(row);
  }
  return out;
}

export type VoteResult =
  | { ok: true; voted: boolean; endsAt: Date }
  | { ok: false; reason: 'self' | 'no_election' | 'voter'; scheduled?: SewayakuElection; voter?: VoterStatus };

/** 投票する（もう投票していれば取り消す）。いま投票中の選挙だけ・投票できる人だけ */
export async function toggleSewayakuVote(db: Db, cfg: GuildConfig, voterId: string, candidateId: string, now = new Date()): Promise<VoteResult> {
  if (voterId === candidateId) return { ok: false, reason: 'self' };
  const e = await currentElectionOf(db, candidateId);
  if (!e || e.status !== 'open' || now < e.startsAt || now >= e.endsAt) return { ok: false, reason: 'no_election', ...(e?.status === 'scheduled' ? { scheduled: e } : {}) };
  const [already] = await db.select().from(sewayakuVotes).where(and(eq(sewayakuVotes.electionId, e.id), eq(sewayakuVotes.voterId, voterId)));
  if (already) {
    await db.delete(sewayakuVotes).where(and(eq(sewayakuVotes.electionId, e.id), eq(sewayakuVotes.voterId, voterId)));
    return { ok: true, voted: false, endsAt: e.endsAt };
  }
  if (!(e.voterIds ?? []).includes(voterId)) return { ok: false, reason: 'voter', voter: await voterStatus(db, cfg, voterId, e.startsAt) };
  await db.insert(sewayakuVotes).values({ electionId: e.id, voterId, createdAt: now }).onConflictDoNothing();
  return { ok: true, voted: true, endsAt: e.endsAt };
}

/** その選挙に、その人が投票しているか */
export async function hasSewayakuVote(db: Db, electionId: number, voterId: string): Promise<boolean> {
  const [row] = await db.select({ n: count() }).from(sewayakuVotes).where(and(eq(sewayakuVotes.electionId, electionId), eq(sewayakuVotes.voterId, voterId)));
  return Number(row?.n ?? 0) > 0;
}

/** その選挙の票の数 */
export async function sewayakuVoteCount(db: Db, electionId: number): Promise<number> {
  const [row] = await db.select({ n: count() }).from(sewayakuVotes).where(eq(sewayakuVotes.electionId, electionId));
  return Number(row?.n ?? 0);
}

export type ClosingElection = { election: SewayakuElection; votes: number; voters: number; passes: boolean };

/** 月曜0時をすぎた選挙を締める（同時に呼ばれても1回だけ）。昇格させるかどうかを返す。昇格の後で finishSewayakuElection を呼ぶ */
export async function closeDueSewayakuElections(db: Db, cfg: GuildConfig, now = new Date()): Promise<ClosingElection[]> {
  const due = await db.select().from(sewayakuElections).where(and(eq(sewayakuElections.status, 'open'), lte(sewayakuElections.endsAt, now)));
  const out: ClosingElection[] = [];
  for (const e of due) {
    const votes = await sewayakuVoteCount(db, e.id);
    const [row] = await db.update(sewayakuElections).set({ status: 'closing', votes }).where(and(eq(sewayakuElections.id, e.id), eq(sewayakuElections.status, 'open'))).returning();
    if (!row) continue;
    const voters = row.voterIds?.length ?? 0;
    out.push({ election: row, votes, voters, passes: sewayakuVotePasses(votes, voters, cfg.emaThresholds) });
  }
  return out;
}

/** 締めた選挙の結果を残す（passed＝世話役になった / failed＝届かなかった・昇格できなかった） */
export async function finishSewayakuElection(db: Db, electionId: number, status: 'passed' | 'failed', now = new Date()): Promise<void> {
  await db.update(sewayakuElections).set({ status, closedAt: now }).where(eq(sewayakuElections.id, electionId));
}

/** 選挙の一覧（社務所Web・/世話役の投票） */
export async function listSewayakuElections(db: Db, statuses: readonly string[], limit = 50): Promise<SewayakuElection[]> {
  return db.select().from(sewayakuElections).where(inArray(sewayakuElections.status, [...statuses])).orderBy(desc(sewayakuElections.startsAt), desc(sewayakuElections.id)).limit(limit);
}

/** #世話役選挙 に出した投稿を覚える（締めたら書きかえる） */
export async function setSewayakuElectionMessage(db: Db, electionId: number, channelId: string, messageId: string): Promise<void> {
  await db.update(sewayakuElections).set({ channelId, messageId }).where(eq(sewayakuElections.id, electionId));
}

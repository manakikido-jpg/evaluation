import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { applications, members, omairi, type Application, type Omairi } from '../db/schema.js';

// ───────── 申請 ─────────

export type ApplicationKind = 'join' | 'yoimairi';

/** 申請を出す。同じ種類の待ちがすでにあれば duplicate */
export async function submitApplication(
  db: Db,
  input: { memberId: string; kind: ApplicationKind; answers: Record<string, string> },
): Promise<{ status: 'created'; id: number } | { status: 'duplicate' }> {
  const [row] = await db.insert(applications).values(input).onConflictDoNothing().returning({ id: applications.id });
  return row ? { status: 'created', id: row.id } : { status: 'duplicate' };
}

export async function setApplicationCard(db: Db, id: number, channelId: string, messageId: string): Promise<void> {
  await db.update(applications).set({ channelId, messageId }).where(eq(applications.id, id));
}

/** 承認・却下。待ちのものだけ（2 人の神職が同時に押しても 1 回だけ） */
export async function decideApplication(
  db: Db,
  id: number,
  input: { approve: boolean; by: string; note?: string },
): Promise<Application | undefined> {
  const [row] = await db
    .update(applications)
    .set({ status: input.approve ? 'approved' : 'rejected', reviewedBy: input.by, reviewedAt: sql`now()`, note: input.note ?? null })
    .where(and(eq(applications.id, id), eq(applications.status, 'pending')))
    .returning();
  return row;
}

export async function getApplication(db: Db, id: number): Promise<Application | undefined> {
  const [row] = await db.select().from(applications).where(eq(applications.id, id));
  return row;
}

export async function pendingApplications(db: Db) {
  return db
    .select({ app: applications, displayName: members.displayName, username: members.username, avatarUrl: members.avatarUrl, joinedAt: members.joinedAt })
    .from(applications)
    .leftJoin(members, eq(members.id, applications.memberId))
    .where(eq(applications.status, 'pending'))
    .orderBy(asc(applications.createdAt));
}

export async function recentDecidedApplications(db: Db, limit = 30) {
  return db
    .select({ app: applications, displayName: members.displayName })
    .from(applications)
    .leftJoin(members, eq(members.id, applications.memberId))
    .where(inArray(applications.status, ['approved', 'rejected']))
    .orderBy(desc(applications.reviewedAt))
    .limit(limit);
}

export async function applicationsOf(db: Db, memberId: string) {
  return db.select().from(applications).where(eq(applications.memberId, memberId)).orderBy(desc(applications.createdAt));
}

export async function setAgeGroup(db: Db, memberId: string, ageGroup: 'minor' | 'adult' | 'unknown'): Promise<void> {
  await db.update(members).set({ ageGroup, updatedAt: sql`now()` }).where(eq(members.id, memberId));
}

// ───────── お参り期間 ─────────

const DAY = 86_400_000;

/** お参り期間を始める（再参加で承認し直したときは最初からやり直す） */
export async function startOmairi(db: Db, memberId: string, days: number, now: Date): Promise<void> {
  const values = { memberId, startedAt: now, endsAt: new Date(now.getTime() + days * DAY), extendedCount: 0, status: 'ongoing', decidedBy: null, decidedAt: null };
  await db.insert(omairi).values(values).onConflictDoUpdate({ target: omairi.memberId, set: { ...values, memberId: undefined } });
}

export async function getOmairi(db: Db, memberId: string): Promise<Omairi | undefined> {
  const [row] = await db.select().from(omairi).where(eq(omairi.memberId, memberId));
  return row;
}

/** 期間が終わった人（まだ判定していない人） */
export async function dueOmairi(db: Db, now: Date): Promise<Omairi[]> {
  return db.select().from(omairi).where(and(eq(omairi.status, 'ongoing'), lte(omairi.endsAt, now)));
}

export async function extendOmairi(db: Db, memberId: string, days: number, now: Date, by?: string): Promise<Omairi | undefined> {
  const [row] = await db
    .update(omairi)
    .set({
      endsAt: sql`greatest(${omairi.endsAt}, ${now.toISOString()}::timestamptz) + (${days} * interval '1 day')`,
      extendedCount: sql`${omairi.extendedCount} + 1`,
      status: 'ongoing',
      decidedBy: by ?? null,
      decidedAt: by ? now : null,
    })
    .where(and(eq(omairi.memberId, memberId), inArray(omairi.status, ['ongoing', 'review'])))
    .returning();
  return row;
}

/** お参り期間を終える（promoted: 氏子になった / review: 神職の判定待ち / removed: 退出） */
export async function setOmairiStatus(
  db: Db,
  memberId: string,
  status: 'promoted' | 'review' | 'removed',
  by?: string,
  onlyFrom: string[] = ['ongoing', 'review'],
): Promise<boolean> {
  const rows = await db
    .update(omairi)
    .set({ status, decidedBy: by ?? null, decidedAt: sql`now()` })
    .where(and(eq(omairi.memberId, memberId), inArray(omairi.status, onlyFrom)))
    .returning({ id: omairi.memberId });
  return rows.length > 0;
}

export async function omairiList(db: Db, statuses: string[]) {
  return db
    .select({ o: omairi, displayName: members.displayName, username: members.username, avatarUrl: members.avatarUrl, roleIds: members.roleIds, leftAt: members.leftAt })
    .from(omairi)
    .leftJoin(members, eq(members.id, omairi.memberId))
    .where(inArray(omairi.status, statuses))
    .orderBy(asc(omairi.endsAt));
}

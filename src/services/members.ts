import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { memberEvents, members, shuin, type Member } from '../db/schema.js';

/** Discord から取ったメンバー情報（BOT が渡す） */
export type MemberSnapshot = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  roleIds: string[];
  isBot: boolean;
  joinedAt: Date | null;
  /** サーバーブースト（奉納）を始めた日時。undefined なら変えない */
  boostingSince?: Date | null;
};

/** 参加（初参加なら join、戻ってきたなら rejoin を記録） */
export async function recordJoin(db: Db, m: MemberSnapshot): Promise<'join' | 'rejoin'> {
  const [before] = await db.select({ leftAt: members.leftAt }).from(members).where(eq(members.id, m.id));
  const kind = before ? 'rejoin' : 'join';
  await upsertMember(db, m, { leftAt: null });
  await db.insert(memberEvents).values({ memberId: m.id, kind });
  return kind;
}

/** 退出 */
export async function recordLeave(db: Db, id: string): Promise<void> {
  const updated = await db
    .update(members)
    .set({ leftAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(members.id, id), isNull(members.leftAt)))
    .returning({ id: members.id });
  if (updated.length) await db.insert(memberEvents).values({ memberId: id, kind: 'leave' });
}

/** 名前・アイコン・ロールの更新 */
export async function upsertMember(db: Db, m: MemberSnapshot, extra: { leftAt?: null } = {}): Promise<void> {
  const values = {
    id: m.id,
    username: m.username,
    displayName: m.displayName,
    avatarUrl: m.avatarUrl,
    roleIds: m.roleIds,
    isBot: m.isBot,
    joinedAt: m.joinedAt,
    ...(m.boostingSince !== undefined ? { boostingSince: m.boostingSince } : {}),
    updatedAt: sql`now()`,
    ...extra,
  };
  await db
    .insert(members)
    .values(values)
    .onConflictDoUpdate({ target: members.id, set: { ...values, id: undefined } });
}

/**
 * 起動時の全員同期。BOT が止まっていた間の参加・退出も反映する。
 * 返り値: 新しく参加扱いにした人数・退出扱いにした人数
 */
export async function syncAllMembers(db: Db, current: MemberSnapshot[]): Promise<{ joined: number; left: number }> {
  const inDb = await db.select({ id: members.id, leftAt: members.leftAt }).from(members);
  const known = new Map(inDb.map((r) => [r.id, r.leftAt]));
  const currentIds = new Set(current.map((m) => m.id));

  let joined = 0;
  for (const m of current) {
    if (!known.has(m.id) || known.get(m.id) !== null) {
      await recordJoin(db, m);
      joined++;
    } else {
      await upsertMember(db, m);
    }
  }
  let left = 0;
  for (const [id, leftAt] of known) {
    if (leftAt === null && !currentIds.has(id)) {
      await recordLeave(db, id);
      left++;
    }
  }
  return { joined, left };
}

/** 最後の活動日時を更新（同じ人は interval ミリ秒に 1 回だけ書き込む） */
export class ActivityTracker {
  private last = new Map<string, number>();
  constructor(
    private readonly db: Db,
    private readonly intervalMs = 5 * 60_000,
  ) {}

  async touch(id: string, now = Date.now()): Promise<boolean> {
    const prev = this.last.get(id);
    if (prev !== undefined && now - prev < this.intervalMs) return false;
    this.last.set(id, now);
    await this.db.update(members).set({ lastActiveAt: new Date(now) }).where(eq(members.id, id));
    return true;
  }
}

export async function recordPromotion(db: Db, id: string, from: string, to: string, goen: number): Promise<void> {
  await db.insert(memberEvents).values({ memberId: id, kind: 'promote', detail: { from, to, goen } });
}

// ───────── 管理画面の検索 ─────────

export type MemberListQuery = {
  /** 名前・ユーザー名・ID */
  q?: string;
  /** このロールを持つ人 */
  roleId?: string;
  ageGroup?: 'minor' | 'adult' | 'unknown';
  /** 在籍中 / 退出済み / 全員 */
  status?: 'active' | 'left' | 'all';
  /** N 日以上活動していない人 */
  inactiveDays?: number;
  sort?: 'goen' | 'joined' | 'active' | 'name';
  page?: number;
  perPage?: number;
};

export type MemberRow = Member & { goen: number };

const goenExpr = sql<number>`coalesce((select sum(${shuin.weight}) from ${shuin} where ${shuin.receiverId} = ${members.id} and ${shuin.revokedAt} is null), 0)::int`;

export async function listMembers(db: Db, query: MemberListQuery, now = new Date()): Promise<{ rows: MemberRow[]; total: number; page: number; pages: number }> {
  const conds: SQL[] = [eq(members.isBot, false)];
  const status = query.status ?? 'active';
  if (status === 'active') conds.push(isNull(members.leftAt));
  if (status === 'left') conds.push(isNotNull(members.leftAt));
  if (query.q?.trim()) {
    const q = query.q.trim();
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(or(ilike(members.displayName, like), ilike(members.username, like), eq(members.id, q))!);
  }
  if (query.roleId) conds.push(sql`${query.roleId} = any(${members.roleIds})`);
  if (query.ageGroup) conds.push(eq(members.ageGroup, query.ageGroup));
  if (query.inactiveDays && query.inactiveDays > 0) {
    const border = new Date(now.getTime() - query.inactiveDays * 86_400_000);
    conds.push(or(isNull(members.lastActiveAt), lt(members.lastActiveAt, border))!);
  }
  const where = and(...conds);

  const order = {
    goen: [desc(goenExpr), asc(members.displayName)],
    joined: [desc(members.joinedAt)],
    active: [sql`${members.lastActiveAt} desc nulls last`],
    name: [asc(members.displayName)],
  }[query.sort ?? 'goen'];

  const perPage = Math.min(Math.max(query.perPage ?? 50, 1), 200);
  const [totalRow] = await db.select({ n: count() }).from(members).where(where);
  const total = totalRow?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(query.page ?? 1, 1), pages);

  const rows = await db
    .select({ member: members, goen: goenExpr })
    .from(members)
    .where(where)
    .orderBy(...order)
    .limit(perPage)
    .offset((page - 1) * perPage);

  return { rows: rows.map((r) => ({ ...r.member, goen: Number(r.goen) })), total, page, pages };
}

export async function getMember(db: Db, id: string): Promise<Member | undefined> {
  const [m] = await db.select().from(members).where(eq(members.id, id));
  return m;
}

export async function eventsOf(db: Db, id: string, limit = 50) {
  return db.select().from(memberEvents).where(eq(memberEvents.memberId, id)).orderBy(desc(memberEvents.at)).limit(limit);
}

/** 朱印の履歴（頂いた・押した）。取り消し済みも含める */
export async function shuinHistory(db: Db, id: string, limit = 30) {
  const received = await db
    .select({ other: shuin.giverId, weight: shuin.weight, rank: shuin.giverRank, at: shuin.createdAt, revokedAt: shuin.revokedAt })
    .from(shuin)
    .where(eq(shuin.receiverId, id))
    .orderBy(desc(shuin.createdAt))
    .limit(limit);
  const given = await db
    .select({ other: shuin.receiverId, weight: shuin.weight, rank: shuin.giverRank, at: shuin.createdAt, revokedAt: shuin.revokedAt })
    .from(shuin)
    .where(eq(shuin.giverId, id))
    .orderBy(desc(shuin.createdAt))
    .limit(limit);
  return { received, given };
}

/** 表示名をまとめて引く（一覧で ID を名前に変えるため） */
export async function namesOf(db: Db, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (!unique.length) return new Map();
  const rows = await db
    .select({ id: members.id, name: members.displayName })
    .from(members)
    .where(inArray(members.id, unique));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** ホーム画面の数字 */
export async function homeStats(db: Db, since: Date) {
  const [active] = await db.select({ n: count() }).from(members).where(and(isNull(members.leftAt), eq(members.isBot, false)));
  const events = await db
    .select({ kind: memberEvents.kind, n: count() })
    .from(memberEvents)
    .where(gte(memberEvents.at, since))
    .groupBy(memberEvents.kind);
  const [shuinToday] = await db.select({ n: count() }).from(shuin).where(and(gte(shuin.createdAt, since), isNull(shuin.revokedAt)));
  const byKind = Object.fromEntries(events.map((e) => [e.kind, e.n]));
  return {
    members: active?.n ?? 0,
    joined: (byKind.join ?? 0) + (byKind.rejoin ?? 0),
    left: byKind.leave ?? 0,
    promoted: byKind.promote ?? 0,
    shuin: shuinToday?.n ?? 0,
  };
}

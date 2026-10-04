import { and, asc, count, desc, eq, gt, gte, ilike, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { activityDaily, memberEvents, members, shuin, wallets, type Member } from '../db/schema.js';

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

/** 最近抜けた人（新しい順。BOT はのぞく） */
export async function recentLeaves(db: Db, limit = 20): Promise<Member[]> {
  return db
    .select()
    .from(members)
    .where(and(isNotNull(members.leftAt), eq(members.isBot, false)))
    .orderBy(desc(members.leftAt))
    .limit(limit);
}

/** #記録 に出す「抜けました」（在籍日数・役職つき。通知は飛ばさない） */
export function leaveNotice(m: Pick<Member, 'id' | 'displayName' | 'username' | 'joinedAt'>, rank: string | undefined, now = new Date()) {
  const days = m.joinedAt ? Math.max(0, Math.floor((now.getTime() - m.joinedAt.getTime()) / 86_400_000)) : undefined;
  const stay = days === undefined ? '' : days === 0 ? '・入って 1 日たたずに' : `・在籍 ${days} 日`;
  return {
    content: `🚪 **${m.displayName}**（@${m.username}・<@${m.id}>）さんが抜けました${stay}${rank ? `・${rank}` : ''}（<t:${Math.floor(now.getTime() / 1000)}:t>）`,
    allowedMentions: { parse: [] as never[] },
  };
}

export type DiffRow = { member: Member; at: Date };
export type MemberDiff = {
  since: Date;
  /** since のときの人数・今の人数（BOT はのぞく） */
  before: number;
  now: number;
  /** since のときにいて、今いない人（抜けた時刻） */
  left: DiffRow[];
  /** since のときにいなくて、今いる人（入った時刻） */
  joined: DiffRow[];
  /** そのあいだに入って、もう抜けた人 */
  bounced: DiffRow[];
};

/**
 * ある時点（since）と今のメンバーの差（参加・退出の記録から）。
 * since より後に記録がない人は、変わっていないとみなす
 */
export async function memberDiff(db: Db, since: Date): Promise<MemberDiff> {
  const [active] = await db.select({ n: count() }).from(members).where(and(isNull(members.leftAt), eq(members.isBot, false)));
  const rows = await db
    .select({ event: memberEvents, member: members })
    .from(memberEvents)
    .innerJoin(members, eq(members.id, memberEvents.memberId))
    .where(and(gt(memberEvents.at, since), inArray(memberEvents.kind, ['join', 'rejoin', 'leave']), eq(members.isBot, false)))
    .orderBy(asc(memberEvents.at), asc(memberEvents.id));
  const byMember = new Map<string, { member: Member; events: { kind: string; at: Date }[] }>();
  for (const r of rows) {
    const cur = byMember.get(r.member.id) ?? { member: r.member, events: [] };
    cur.events.push({ kind: r.event.kind, at: r.event.at });
    byMember.set(r.member.id, cur);
  }
  const left: DiffRow[] = [];
  const joined: DiffRow[] = [];
  const bounced: DiffRow[] = [];
  for (const { member, events } of byMember.values()) {
    // いちばん初めの記録が「退出」なら、since のときはいた
    const wasHere = events[0]!.kind === 'leave';
    const isHere = member.leftAt === null;
    const lastLeave = [...events].reverse().find((e) => e.kind === 'leave')?.at;
    const firstJoin = events.find((e) => e.kind !== 'leave')?.at;
    if (wasHere && !isHere) left.push({ member, at: lastLeave ?? events.at(-1)!.at });
    else if (!wasHere && isHere) joined.push({ member, at: firstJoin ?? events[0]!.at });
    else if (!wasHere && !isHere) bounced.push({ member, at: firstJoin ?? events[0]!.at });
  }
  const newest = (a: DiffRow, b: DiffRow) => b.at.getTime() - a.at.getTime();
  const now = active?.n ?? 0;
  return { since, before: now - joined.length + left.length, now, left: left.sort(newest), joined: joined.sort(newest), bounced: bounced.sort(newest) };
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
  sort?: MemberSort;
  /** 並べる向き（なければ並べ方ごとの向き） */
  dir?: 'asc' | 'desc';
  page?: number;
  perPage?: number;
};

/** 並べ方と、はじめの向き（数が多い順・新しい順・名前は あ→ん） */
export const MEMBER_SORTS = {
  goen: { label: 'ご縁', dir: 'desc' },
  rank: { label: '役職', dir: 'desc' },
  joined: { label: '参加日', dir: 'desc' },
  active: { label: '最後の活動', dir: 'desc' },
  coins: { label: '銭', dir: 'desc' },
  given: { label: '朱印を押した人数', dir: 'desc' },
  vc30: { label: '通話（30 日）', dir: 'desc' },
  msg30: { label: '発言（30 日）', dir: 'desc' },
  name: { label: '名前', dir: 'asc' },
} as const satisfies Record<string, { label: string; dir: 'asc' | 'desc' }>;
export type MemberSort = keyof typeof MEMBER_SORTS;
export const isMemberSort = (v: unknown): v is MemberSort => typeof v === 'string' && Object.hasOwn(MEMBER_SORTS, v);

export type MemberRow = Member & { goen: number; coins: number; given: number; vc30: number; msg30: number };

const goenExpr = sql<number>`coalesce((select sum(${shuin.weight}) from ${shuin} where ${shuin.receiverId} = ${members.id} and ${shuin.revokedAt} is null), 0)::int`;
const coinsExpr = sql<number>`coalesce((select ${wallets.balance} from ${wallets} where ${wallets.memberId} = ${members.id}), 0)::int`;
const givenExpr = sql<number>`(select count(*) from ${shuin} where ${shuin.giverId} = ${members.id} and ${shuin.revokedAt} is null)::int`;
const activity30 = (col: typeof activityDaily.vcMinutes | typeof activityDaily.messageCount, since: string) =>
  sql<number>`coalesce((select sum(${col}) from ${activityDaily} where ${activityDaily.memberId} = ${members.id} and ${activityDaily.date} >= ${since}), 0)::int`;

export async function listMembers(
  db: Db,
  query: MemberListQuery,
  now = new Date(),
  /** 役職の並べ替え用（役職のロールと格） */
  ranks: { roleId: string; weight: number }[] = [],
): Promise<{ rows: MemberRow[]; total: number; page: number; pages: number }> {
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

  const since = new Date(now.getTime() + 9 * 3_600_000 - 29 * 86_400_000).toISOString().slice(0, 10);
  const vc30 = activity30(activityDaily.vcMinutes, since);
  const msg30 = activity30(activityDaily.messageCount, since);
  // 役職: 持っている役職のうち、いちばん格の高いもの（役職がなければ 0）
  const rankExpr = ranks.length
    ? sql`greatest(0, ${sql.join(
        ranks.map((r) => sql`case when ${r.roleId} = any(${members.roleIds}) then ${r.weight} else 0 end`),
        sql`, `,
      )})`
    : sql`0`;
  const sort = query.sort ?? 'goen';
  const dir = query.dir ?? MEMBER_SORTS[sort].dir;
  const by = (e: SQL | typeof members.displayName) => (dir === 'asc' ? sql`${e} asc nulls last` : sql`${e} desc nulls last`);
  const key: Record<MemberSort, SQL | typeof members.displayName> = {
    goen: goenExpr,
    rank: rankExpr,
    joined: sql`${members.joinedAt}`,
    active: sql`${members.lastActiveAt}`,
    coins: coinsExpr,
    given: givenExpr,
    vc30,
    msg30,
    name: members.displayName,
  };
  // 同じなら名前順
  const order = [by(key[sort]), asc(members.displayName)];

  const perPage = Math.min(Math.max(query.perPage ?? 50, 1), 200);
  const [totalRow] = await db.select({ n: count() }).from(members).where(where);
  const total = totalRow?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(query.page ?? 1, 1), pages);

  const rows = await db
    .select({ member: members, goen: goenExpr, coins: coinsExpr, given: givenExpr, vc30, msg30 })
    .from(members)
    .where(where)
    .orderBy(...order)
    .limit(perPage)
    .offset((page - 1) * perPage);

  return {
    rows: rows.map((r) => ({ ...r.member, goen: Number(r.goen), coins: Number(r.coins), given: Number(r.given), vc30: Number(r.vc30), msg30: Number(r.msg30) })),
    total,
    page,
    pages,
  };
}

export async function getMember(db: Db, id: string): Promise<Member | undefined> {
  const [m] = await db.select().from(members).where(eq(members.id, id));
  return m;
}

/** ID・ユーザー名・表示名（先頭の @ は無視）から、今いる人を 1 人に決める（2 人以上当たれば ambiguous） */
export async function findMemberByNameOrId(db: Db, raw: string): Promise<Member | 'ambiguous' | undefined> {
  const q = raw.trim().replace(/^@/, '');
  if (!q) return undefined;
  if (/^\d{17,20}$/.test(q)) return getMember(db, q);
  const rows = await db
    .select()
    .from(members)
    .where(and(isNull(members.leftAt), or(eq(members.username, q), eq(members.displayName, q))))
    .limit(2);
  return rows.length > 1 ? 'ambiguous' : rows[0];
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

/** 今いる人（BOT を除く）のロールごとの人数と、全員の人数 */
export async function roleMemberCounts(db: Db): Promise<{ counts: Map<string, number>; total: number }> {
  const rows = await db.select({ roleIds: members.roleIds }).from(members).where(and(isNull(members.leftAt), eq(members.isBot, false)));
  const counts = new Map<string, number>();
  for (const r of rows) for (const id of r.roleIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  return { counts, total: rows.length };
}

/** そのロールを付けられる人を探す（今いる人・BOT とすでに持っている人はのぞく。名前・ユーザー名・ID で。名前順・最大 limit 人） */
export async function searchMembersWithoutRole(db: Db, roleId: string, q: string, limit = 30): Promise<Pick<Member, 'id' | 'displayName' | 'username' | 'avatarUrl'>[]> {
  const term = q.trim().slice(0, 50);
  if (!term) return [];
  const like = `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  return db
    .select({ id: members.id, displayName: members.displayName, username: members.username, avatarUrl: members.avatarUrl })
    .from(members)
    .where(
      and(
        isNull(members.leftAt),
        eq(members.isBot, false),
        sql`not (${roleId} = any(${members.roleIds}))`,
        or(ilike(members.displayName, like), ilike(members.username, like), eq(members.id, term)),
      ),
    )
    .orderBy(asc(members.displayName))
    .limit(limit);
}

/** 付けた・外したロールを、こちらの記録にもすぐ入れる（Discord からの知らせを待たずに一覧に出すため） */
export async function setMemberRole(db: Db, memberId: string, roleId: string, has: boolean): Promise<void> {
  await db
    .update(members)
    .set({ roleIds: has ? sql`case when ${roleId} = any(${members.roleIds}) then ${members.roleIds} else array_append(${members.roleIds}, ${roleId}) end` : sql`array_remove(${members.roleIds}, ${roleId})` })
    .where(eq(members.id, memberId));
}

/** そのロールを持っている、今いる人（名前順・最大 limit 人） */
export async function membersWithRole(db: Db, roleId: string, limit = 300): Promise<Pick<Member, 'id' | 'displayName' | 'username' | 'avatarUrl'>[]> {
  return db
    .select({ id: members.id, displayName: members.displayName, username: members.username, avatarUrl: members.avatarUrl })
    .from(members)
    .where(and(isNull(members.leftAt), eq(members.isBot, false), sql`${roleId} = any(${members.roleIds})`))
    .orderBy(asc(members.displayName))
    .limit(limit);
}

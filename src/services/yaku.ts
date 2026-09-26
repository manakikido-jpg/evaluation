import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import type { EconomyConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { members, memos, yaku, type Yaku } from '../db/schema.js';
import { spendWithin } from './economy.js';

/**
 * 厄（警告）のデータ操作。Discord への反映（ロール・DM・BAN）は moderation.ts が行う。
 * ルール: 1 つ目は注意（厄年）、2 つ目で BAN。免罪符で 1 つ祓える（1 人 1 回まで）。重大な違反は一発 BAN。
 */

/** この人の処理を 1 つずつにする（2 人の神職が同時に厄を付けても数え間違えない） */
async function lockMember(tx: Db, memberId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'yaku:' + memberId}))`);
}

/**
 * この人への操作全体（厄を数える → 付ける → BAN → 記録）を 1 つずつにする。
 * 二重送信でも、2 回目は 1 回目の BAN の記録まで終わってから動く。
 */
export async function withMemberLock<T>(db: Db, memberId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await lockMember(tx, memberId);
    return fn(tx);
  });
}

const activeWhere = (memberId: string) =>
  and(eq(yaku.memberId, memberId), eq(yaku.kind, 'normal'), isNull(yaku.clearedAt));

async function countActive(tx: Db, memberId: string): Promise<number> {
  const [r] = await tx.select({ n: count() }).from(yaku).where(activeWhere(memberId));
  return r?.n ?? 0;
}

export async function activeYakuCount(db: Db, memberId: string): Promise<number> {
  return countActive(db, memberId);
}

export async function yakuHistory(db: Db, memberId: string): Promise<Yaku[]> {
  return db.select().from(yaku).where(eq(yaku.memberId, memberId)).orderBy(desc(yaku.createdAt), desc(yaku.id));
}

export type RecordYakuResult =
  | { status: 'recorded'; id: number; active: number }
  /** すでに厄が 1 つあり、確認（BAN してよいか）がまだ */
  | { status: 'needs_confirm'; active: number }
  /** すでに厄が 2 つ以上ある（二重送信などで、もう BAN 済み） */
  | { status: 'already_banned'; active: number };

/**
 * 厄を 1 つ付ける。返り値の active が 2 以上なら BAN にする。
 * 数えるのと付けるのを同じロックの中で行うので、二重送信でも確認なしに BAN にならない。
 */
export async function recordYaku(
  db: Db,
  input: { memberId: string; reason: string; issuedBy: string },
  opts: { confirmBan?: boolean } = {},
): Promise<RecordYakuResult> {
  return db.transaction(async (tx) => {
    await lockMember(tx, input.memberId);
    const before = await countActive(tx, input.memberId);
    if (before >= 2) return { status: 'already_banned', active: before };
    if (before >= 1 && !opts.confirmBan) return { status: 'needs_confirm', active: before };
    const [row] = await tx.insert(yaku).values({ ...input, kind: 'normal' }).returning({ id: yaku.id });
    return { status: 'recorded', id: row!.id, active: await countActive(tx, input.memberId) };
  });
}

/** 一発 BAN の記録 */
export async function recordInstantBan(db: Db, input: { memberId: string; reason: string; issuedBy: string }): Promise<number> {
  const [row] = await db.insert(yaku).values({ ...input, kind: 'instant_ban' }).returning({ id: yaku.id });
  return row!.id;
}

/** 神職による取り消し（間違えて付けたときなど）。いちばん新しい厄を 1 つ祓う */
export async function clearYakuByStaff(
  db: Db,
  input: { memberId: string; by: string; note: string },
): Promise<{ cleared: boolean; remaining: number }> {
  return db.transaction(async (tx) => {
    await lockMember(tx, input.memberId);
    const cleared = await clearLatest(tx, input.memberId, input.by, 'staff', input.note);
    return { cleared, remaining: await countActive(tx, input.memberId) };
  });
}

async function clearLatest(tx: Db, memberId: string, by: string, reason: 'staff' | 'menzaifu' | 'unban', note: string | null): Promise<boolean> {
  const [latest] = await tx.select({ id: yaku.id }).from(yaku).where(activeWhere(memberId)).orderBy(desc(yaku.createdAt), desc(yaku.id)).limit(1);
  if (!latest) return false;
  await tx
    .update(yaku)
    .set({ clearedAt: sql`now()`, clearedBy: by, clearedReason: reason, clearedNote: note })
    .where(eq(yaku.id, latest.id));
  return true;
}

/** BAN を解除するとき: 厄を keep 個だけ残して祓う（新しいものから祓う） */
export async function clearYakuForUnban(
  db: Db,
  input: { memberId: string; by: string; keep: 0 | 1; note: string },
): Promise<{ cleared: number; remaining: number }> {
  return db.transaction(async (tx) => {
    await lockMember(tx, input.memberId);
    let cleared = 0;
    while ((await countActive(tx, input.memberId)) > input.keep) {
      if (!(await clearLatest(tx, input.memberId, input.by, 'unban', input.note || null))) break;
      cleared++;
    }
    return { cleared, remaining: await countActive(tx, input.memberId) };
  });
}

export async function menzaifuUsed(db: Db, memberId: string): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(yaku)
    .where(and(eq(yaku.memberId, memberId), eq(yaku.clearedReason, 'menzaifu')));
  return r?.n ?? 0;
}

export type MenzaifuResult =
  | { status: 'ok'; remaining: number; price: number }
  | { status: 'no_yaku' }
  | { status: 'used_up'; max: number }
  | { status: 'insufficient'; price: number; balance: number };

/** 免罪符を買って厄を 1 つ祓う。支払いと祓いは同じトランザクション（どちらか片方だけにはならない） */
export async function buyMenzaifu(db: Db, economy: EconomyConfig, memberId: string, balanceOf: (tx: Db) => Promise<number>): Promise<MenzaifuResult> {
  return db.transaction(async (tx) => {
    await lockMember(tx, memberId);
    if ((await countActive(tx, memberId)) === 0) return { status: 'no_yaku' };
    if ((await menzaifuUsed(tx, memberId)) >= economy.menzaifuMaxUses) return { status: 'used_up', max: economy.menzaifuMaxUses };
    const paid = await spendWithin(tx, memberId, economy.menzaifuPrice, 'menzaifu');
    if (!paid) return { status: 'insufficient', price: economy.menzaifuPrice, balance: await balanceOf(tx) };
    await clearLatest(tx, memberId, memberId, 'menzaifu', null);
    return { status: 'ok', remaining: await countActive(tx, memberId), price: economy.menzaifuPrice };
  });
}

/** 厄が付いている人の一覧（管理画面） */
export async function membersWithYaku(db: Db) {
  return db
    .select({
      memberId: yaku.memberId,
      active: count(),
      latest: sql<Date>`max(${yaku.createdAt})`.mapWith((v) => new Date(v)),
      displayName: members.displayName,
      username: members.username,
      avatarUrl: members.avatarUrl,
      leftAt: members.leftAt,
    })
    .from(yaku)
    .leftJoin(members, eq(members.id, yaku.memberId))
    .where(and(eq(yaku.kind, 'normal'), isNull(yaku.clearedAt)))
    .groupBy(yaku.memberId, members.displayName, members.username, members.avatarUrl, members.leftAt)
    .orderBy(desc(sql`max(${yaku.createdAt})`));
}

// ───────── メモ ─────────

export async function addMemo(db: Db, input: { memberId: string; body: string; authorId: string }): Promise<void> {
  await db.insert(memos).values(input);
}

export async function memosOf(db: Db, memberId: string, limit = 50) {
  return db.select().from(memos).where(eq(memos.memberId, memberId)).orderBy(desc(memos.createdAt), desc(memos.id)).limit(limit);
}

import { and, count, desc, eq, inArray, isNotNull, isNull, sql, sum } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { shuin } from '../db/schema.js';

export type GiveResult =
  | { status: 'given'; weight: number; goen: number; restamped: boolean }
  | { status: 'already'; weight: number; goen: number };

export type RevokeResult = { status: 'revoked'; weight: number; goen: number } | { status: 'not_found'; goen: number };

/** 受け取ったご縁の合計（取り消し分を除く） */
export async function goenOf(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ total: sum(shuin.weight) })
    .from(shuin)
    .where(and(eq(shuin.receiverId, userId), isNull(shuin.revokedAt)));
  return Number(row?.total ?? 0);
}

/**
 * 朱印を押す。同じ相手には 1 回だけ。
 * 取り消し済みの朱印があれば、今の格で押し直す。
 * 二重クリックなどで同時に呼ばれても、主キーと条件付き UPDATE で 1 回分しか入らない。
 */
export async function giveShuin(
  db: Db,
  input: { giverId: string; receiverId: string; weight: number; giverRank: string },
): Promise<GiveResult> {
  if (input.giverId === input.receiverId) throw new Error('自分には朱印を押せません');

  const inserted = await db
    .insert(shuin)
    .values({ ...input })
    .onConflictDoNothing()
    .returning({ weight: shuin.weight });
  if (inserted[0]) {
    return { status: 'given', weight: inserted[0].weight, goen: await goenOf(db, input.receiverId), restamped: false };
  }

  const restamped = await db
    .update(shuin)
    .set({ weight: input.weight, giverRank: input.giverRank, createdAt: sql`now()`, revokedAt: null })
    .where(
      and(eq(shuin.giverId, input.giverId), eq(shuin.receiverId, input.receiverId), isNotNull(shuin.revokedAt)),
    )
    .returning({ weight: shuin.weight });
  if (restamped[0]) {
    return { status: 'given', weight: restamped[0].weight, goen: await goenOf(db, input.receiverId), restamped: true };
  }

  const [existing] = await db
    .select({ weight: shuin.weight })
    .from(shuin)
    .where(and(eq(shuin.giverId, input.giverId), eq(shuin.receiverId, input.receiverId)));
  return { status: 'already', weight: existing?.weight ?? 0, goen: await goenOf(db, input.receiverId) };
}

/** 朱印を取り消す（ご縁も減る。役職は下げない） */
export async function revokeShuin(db: Db, input: { giverId: string; receiverId: string }): Promise<RevokeResult> {
  const [row] = await db
    .update(shuin)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(shuin.giverId, input.giverId), eq(shuin.receiverId, input.receiverId), isNull(shuin.revokedAt)))
    .returning({ weight: shuin.weight });
  const goen = await goenOf(db, input.receiverId);
  return row ? { status: 'revoked', weight: row.weight, goen } : { status: 'not_found', goen };
}

export type GoshuinchoData = {
  goen: number;
  /** 朱印をくれた人数 */
  receivedCount: number;
  /** くれた人の役職（押した時点）ごとの人数 */
  byRank: Record<string, number>;
  /** 最近くれた人（新しい順） */
  recentGiverIds: string[];
  /** 自分が朱印を押した人数 */
  givenCount: number;
};

/** 御朱印帳に表示する内容 */
export async function goshuinchoOf(db: Db, userId: string, recentLimit = 5): Promise<GoshuinchoData> {
  const active = and(eq(shuin.receiverId, userId), isNull(shuin.revokedAt));

  const byRankRows = await db
    .select({ rank: shuin.giverRank, n: count(), total: sum(shuin.weight) })
    .from(shuin)
    .where(active)
    .groupBy(shuin.giverRank);

  const recent = await db
    .select({ giverId: shuin.giverId })
    .from(shuin)
    .where(active)
    .orderBy(desc(shuin.createdAt))
    .limit(recentLimit);

  const [given] = await db
    .select({ n: count() })
    .from(shuin)
    .where(and(eq(shuin.giverId, userId), isNull(shuin.revokedAt)));

  const byRank: Record<string, number> = {};
  let receivedCount = 0;
  let goen = 0;
  for (const r of byRankRows) {
    byRank[r.rank] = r.n;
    receivedCount += r.n;
    goen += Number(r.total ?? 0);
  }

  return { goen, receivedCount, byRank, recentGiverIds: recent.map((r) => r.giverId), givenCount: given?.n ?? 0 };
}

/** 朱印をくれた人数 */
export async function receivedCountOf(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(shuin)
    .where(and(eq(shuin.receiverId, userId), isNull(shuin.revokedAt)));
  return row?.n ?? 0;
}

/** 朱印をくれた人の一覧（新しい順） */
export async function giversOf(db: Db, userId: string, limit = 100): Promise<{ giverId: string; weight: number }[]> {
  return db
    .select({ giverId: shuin.giverId, weight: shuin.weight })
    .from(shuin)
    .where(and(eq(shuin.receiverId, userId), isNull(shuin.revokedAt)))
    .orderBy(desc(shuin.createdAt))
    .limit(limit);
}

/** その人が今朱印を押している相手（取り消したものは除く）のうち、ids にいる人 */
export async function stampedBy(db: Db, giverId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db
    .select({ id: shuin.receiverId })
    .from(shuin)
    .where(and(eq(shuin.giverId, giverId), inArray(shuin.receiverId, ids), isNull(shuin.revokedAt)));
  return new Set(rows.map((r) => r.id));
}

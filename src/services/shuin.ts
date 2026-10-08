import { and, count, desc, eq, gte, inArray, isNotNull, isNull, sql, sum } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { shuin } from '../db/schema.js';
import { specialGoenOf } from './specialGoen.js';

export type GiveResult =
  | { status: 'given'; weight: number; goen: number; restamped: boolean; addedGoen: number }
  | { status: 'already'; weight: number; goen: number };

export type RevokeResult = { status: 'revoked'; weight: number; goen: number } | { status: 'not_found'; goen: number };

/** 受け取ったご縁の合計（取り消し分を除く）。✨ 特別ご縁も足す */
export async function goenOf(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ total: sum(shuin.weight) })
    .from(shuin)
    .where(and(eq(shuin.receiverId, userId), isNull(shuin.revokedAt)));
  return Number(row?.total ?? 0) + (await specialGoenOf(db, userId));
}

/**
 * 同じ相手には1回分。格が上がったら、前のご縁を残して差額だけ足す。
 * 取り消し済みなら今の格で押し直す。行をロックし、連打でも差額は1回だけ。
 */
export async function giveShuin(
  db: Db,
  input: { giverId: string; receiverId: string; weight: number; giverRank: string },
): Promise<GiveResult> {
  if (input.giverId === input.receiverId) throw new Error('自分には朱印を押せません');
  return db.transaction(async (tx) => {
    const inserted = await tx.insert(shuin).values(input).onConflictDoNothing().returning({ weight: shuin.weight });
    if (inserted[0]) {
      return { status: 'given', weight: inserted[0].weight, goen: await goenOf(tx, input.receiverId), restamped: false, addedGoen: inserted[0].weight };
    }
    const [previous] = await tx.select({ weight: shuin.weight, revokedAt: shuin.revokedAt }).from(shuin)
      .where(and(eq(shuin.giverId, input.giverId), eq(shuin.receiverId, input.receiverId))).for('update');
    if (previous && (previous.revokedAt !== null || input.weight > previous.weight)) {
      await tx.update(shuin).set({ weight: input.weight, giverRank: input.giverRank, createdAt: sql`now()`, revokedAt: null })
        .where(and(eq(shuin.giverId, input.giverId), eq(shuin.receiverId, input.receiverId)));
      const addedGoen = input.weight - (previous.revokedAt === null ? previous.weight : 0);
      return { status: 'given', weight: input.weight, goen: await goenOf(tx, input.receiverId), restamped: true, addedGoen };
    }
    return { status: 'already', weight: previous?.weight ?? 0, goen: await goenOf(tx, input.receiverId) };
  });
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
  /** ご縁の合計（朱印＋特別ご縁） */
  goen: number;
  /** そのうち ✨ 特別ご縁 */
  special?: number;
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

  const special = await specialGoenOf(db, userId);
  return { goen: goen + special, special, receivedCount, byRank, recentGiverIds: recent.map((r) => r.giverId), givenCount: given?.n ?? 0 };
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

/** 今の格で押し済みの相手。前の格の朱印は残すが、押し直せるのでチェックを外す */
export async function stampedBy(db: Db, giverId: string, ids: string[], currentWeight = 0): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db
    .select({ id: shuin.receiverId })
    .from(shuin)
    .where(and(eq(shuin.giverId, giverId), inArray(shuin.receiverId, ids), isNull(shuin.revokedAt), gte(shuin.weight, currentWeight)));
  return new Set(rows.map((r) => r.id));
}

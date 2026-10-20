import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { castSessions, settings } from '../db/schema.js';
import { castStats, monthStart, type CastConfig } from './cast.js';
import { addCoins } from './economy.js';

/**
 * 🏆 キャストのランキング。月ごと（日本時間）に、終わった指名の回数の多い順（同じなら売り上げの多い順）。
 * - 毎月 1 日に、先月の上位 3 人を発表する（月ごとに 1 回だけ。settings の `cast.rank:YYYY-MM` が目印。1 日に止まっていたら 7 日までに）
 * - 1 位には、決めた銭（`rankBonus`）と称号のロール（`rankRoleId`）をわたす
 */

const JST = 9 * 3_600_000;

/** その月の 1 日（日本時間）。offset で前後の月 */
export function monthOf(d: Date, offset = 0): Date {
  const j = new Date(d.getTime() + JST);
  return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth() + offset, 1) - JST);
}

/** 月の名前（YYYY-MM・日本時間） */
export const monthKey = (start: Date) => new Date(start.getTime() + JST).toISOString().slice(0, 7);

/** YYYY-MM を、その月の 1 日に。読めなければ undefined */
export function parseMonth(s: string | undefined): Date | undefined {
  const m = /^(\d{4})-(\d{2})$/.exec(s ?? '');
  if (!m) return undefined;
  const y = Number(m[1]), mo = Number(m[2]);
  if (mo < 1 || mo > 12 || y < 2020 || y > 2100) return undefined;
  return new Date(Date.UTC(y, mo - 1, 1) - JST);
}

export type CastRankRow = {
  castId: string;
  count: number;
  earned: number;
  ratingAvg: number | null;
  ratings: number;
  /** 断った・返事がなかった */
  declined: number;
  /** 取り消し（お客・運営） */
  canceled: number;
  /** キャストが来なかった */
  noShow: number;
  /** 通報されて運営が決めた・戻した */
  disputed: number;
  /** 指名したお客の数・2 回以上のお客の数 */
  customers: number;
  repeaters: number;
};

/** 社務所Web のくわしいランキング（その月に作られた・終わった指名から） */
export async function castRanking(db: Db, start: Date): Promise<CastRankRow[]> {
  const end = monthOf(start, 1);
  const [done, others, people] = await Promise.all([
    castStats(db, start, undefined, end),
    // 終わらなかった指名は、作った月で数える
    db
      .select({ castId: castSessions.castId, status: castSessions.status, n: sql<number>`count(*)::int` })
      .from(castSessions)
      .where(and(gte(castSessions.createdAt, start), lt(castSessions.createdAt, end)))
      .groupBy(castSessions.castId, castSessions.status),
    db
      .select({ castId: castSessions.castId, customerId: castSessions.customerId, n: sql<number>`count(*)::int` })
      .from(castSessions)
      .where(and(eq(castSessions.status, 'done'), gte(castSessions.closedAt, start), lt(castSessions.closedAt, end)))
      .groupBy(castSessions.castId, castSessions.customerId),
  ]);
  const rows = new Map<string, CastRankRow>();
  const get = (id: string) => {
    let r = rows.get(id);
    if (!r) rows.set(id, (r = { castId: id, count: 0, earned: 0, ratingAvg: null, ratings: 0, declined: 0, canceled: 0, noShow: 0, disputed: 0, customers: 0, repeaters: 0 }));
    return r;
  };
  for (const s of done) Object.assign(get(s.castId), s);
  for (const o of others) {
    const r = get(o.castId);
    if (o.status === 'declined') r.declined += o.n;
    else if (o.status === 'canceled') r.canceled += o.n;
    else if (o.status === 'noshow_cast') r.noShow += o.n;
    else if (o.status === 'disputed' || o.status === 'refunded') r.disputed += o.n;
  }
  for (const p of people) {
    const r = get(p.castId);
    r.customers++;
    if (p.n >= 2) r.repeaters++;
  }
  return [...rows.values()].sort((a, b) => b.count - a.count || b.earned - a.earned || a.castId.localeCompare(b.castId));
}

/** 上位（終わった指名が 1 回以上の人だけ） */
export async function castTop(db: Db, start: Date, n = 3) {
  return (await castStats(db, start, undefined, monthOf(start, 1))).filter((x) => x.count > 0).slice(0, n);
}

export type CastRankAward = { month: string; top: Awaited<ReturnType<typeof castTop>>; winnerId?: string; bonus: number };

/**
 * 毎月 1 日（日本時間）に 1 回だけ、先月の発表とごほうび。もう済んだ月・指名がなかった月は何もしない（指名がなければ目印だけ付ける）。
 * 銭は目印と同じトランザクションでわたす（同時に呼ばれても 1 回だけ）
 */
export async function awardCastRank(db: Db, c: Pick<CastConfig, 'rankBonus'>, now = new Date()): Promise<CastRankAward | undefined> {
  // 1〜7 日だけ（BOT が止まっていた日があっても発表する。月の途中に入れたときに、先月の分をいきなり出さない）
  if (new Date(now.getTime() + JST).getUTCDate() > 7) return undefined;
  const start = monthOf(now, -1);
  const month = monthKey(start);
  const key = `cast.rank:${month}`;
  const [done] = await db.select({ key: settings.key }).from(settings).where(eq(settings.key, key));
  if (done) return undefined;
  const top = await castTop(db, start);
  return db.transaction(async (tx) => {
    const winnerId = top[0]?.castId;
    const bonus = winnerId ? Math.max(0, c.rankBonus ?? 0) : 0;
    const [mark] = await tx
      .insert(settings)
      .values({ key, value: { month, top: top.map((x) => ({ castId: x.castId, count: x.count })), winnerId: winnerId ?? null, bonus }, updatedBy: 'system' })
      .onConflictDoNothing()
      .returning();
    if (!mark) return undefined;
    if (winnerId && bonus > 0) await addCoins(tx, winnerId, bonus, 'cast_rank_bonus', { month });
    return top.length ? { month, top, winnerId, bonus } : undefined;
  });
}

/** 前の月までに、称号のロールをもらった人（外すため） */
export async function pastRankWinners(db: Db): Promise<string[]> {
  const rows = await db.select({ value: settings.value }).from(settings).where(sql`${settings.key} like 'cast.rank:%'`);
  return [...new Set(rows.map((r) => (r.value as { winnerId?: string | null }).winnerId).filter((x): x is string => Boolean(x)))];
}

export { monthStart };

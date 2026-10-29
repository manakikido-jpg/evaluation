import { and, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { castChampagnes, castSessions, coinTx } from '../db/schema.js';

/**
 * 💹 キャストの、運営側の収支（社務所Web の「🎀 キャスト」）。月ごと・日本時間。
 * - 指名・納品: その月に終わった（精算した）ものを数える。運営の取り分 = お客が払った − 戻した − キャストに渡した
 * - シャンパン: その月に払われたものを別枠で数える（手数料が運営の取り分）
 * - 月のごほうび（ランキングの銭）は運営の支出として引く
 */
export type CastProfit = {
  sessions: { count: number; sales: number; refunds: number; toCasts: number; fees: number };
  champagne: { count: number; sales: number; toCasts: number; fees: number };
  rankBonus: number;
  /** いま預かり中（返事待ち・予約・通話中・納品待ち）の銭。月とは関係なく、今の時点 */
  escrow: number;
  net: number;
};

const n = (v: unknown) => Number(v ?? 0);

export async function castProfit(db: Db, start: Date, end: Date): Promise<CastProfit> {
  const s = castSessions, t = coinTx, c = castChampagnes;
  // 戻した銭（指名ごと）。キャストに渡した銭は s.paid
  const res = await db.execute(sql`
    select count(*)::int as count,
      coalesce(sum(${s.price} + coalesce(r.declined, 0)), 0)::text as sales,
      coalesce(sum(least(${s.price} + coalesce(r.declined, 0), coalesce(r.amount, 0))), 0)::text as refunds,
      coalesce(sum(${s.paid}), 0)::text as to_casts
    from ${s} left join (
      select ${t.detail}->>'sessionId' as session_id, sum(${t.amount}) as amount,
        sum(${t.amount}) filter (where ${t.detail}->>'extendDeclined' = 'true') as declined
      from ${t} where ${t.reason} = 'cast_refund' group by ${t.detail}->>'sessionId'
    ) r on r.session_id = ${s.id}::text
    where ${s.closedAt} >= ${start} and ${s.closedAt} < ${end}`);
  const row = (res as unknown as { rows: Record<string, unknown>[] }).rows[0] ?? {};
  const sales = n(row.sales), refunds = n(row.refunds), toCasts = n(row.to_casts);
  const sessions = { count: n(row.count), sales, refunds, toCasts, fees: Math.max(0, sales - refunds - toCasts) };

  const [ch] = await db
    .select({ count: sql<number>`count(*)::int`, sales: sql<string>`coalesce(sum(${c.price}), 0)`, fees: sql<string>`coalesce(sum(${c.fee}), 0)` })
    .from(c)
    .where(and(isNotNull(c.paidAt), gte(c.paidAt, start), lt(c.paidAt, end)));
  const champagne = { count: n(ch?.count), sales: n(ch?.sales), toCasts: n(ch?.sales) - n(ch?.fees), fees: n(ch?.fees) };

  const [bonus] = await db.select({ v: sql<string>`coalesce(sum(${t.amount}), 0)` }).from(t).where(and(sql`${t.reason} = 'cast_rank_bonus'`, gte(t.at, start), lt(t.at, end)));
  const rankBonus = n(bonus?.v);

  const [held] = await db
    .select({ v: sql<string>`coalesce(sum(${s.price}), 0)` })
    .from(s)
    .where(inArray(s.status, ['requested', 'reserved', 'accepted', 'active', 'ordered', 'delivered', 'disputed']));
  return { sessions, champagne, rankBonus, escrow: n(held?.v), net: sessions.fees + champagne.fees - rankBonus };
}

/** 👤 キャストごとの中身（月ごと）。お客ごとの回数・金額も */
export type CastBreakdown = {
  castId: string;
  /** その月に終わった指名・納品（done） */
  done: number;
  /** その月の売上（終わった指名・納品＋払われたシャンパン。手数料を引く前） */
  sales: number;
  champagne: number;
  /** いま入っている予約・返事待ち・通話中・納品待ち（月とは関係なく今） */
  open: number;
  customers: { customerId: string; done: number; open: number; sales: number }[];
};

const OPEN_STATUSES = ['requested', 'reserved', 'accepted', 'active', 'ordered', 'delivered'] as const;

export async function castBreakdown(db: Db, start: Date, end: Date): Promise<CastBreakdown[]> {
  const s = castSessions, c = castChampagnes;
  const done = await db.select().from(s).where(and(inArray(s.status, ['done', 'noshow_customer']), gte(s.closedAt, start), lt(s.closedAt, end)));
  // 断った延長は price 自体から引かれているので、精算の返金と重ねて引かない。
  const refunds = await db.select({ sessionId: sql<string>`${coinTx.detail}->>'sessionId'`, amount: sql<string>`sum(${coinTx.amount})::text` }).from(coinTx).where(and(eq(coinTx.reason, 'cast_refund'), sql`coalesce(${coinTx.detail}->>'extendDeclined','false') <> 'true'`)).groupBy(sql`${coinTx.detail}->>'sessionId'`);
  const refunded = new Map(refunds.map(r => [r.sessionId, Number(r.amount)]));
  const open = await db.select().from(s).where(inArray(s.status, [...OPEN_STATUSES]));
  const champ = await db.select().from(c).where(and(isNotNull(c.paidAt), gte(c.paidAt, start), lt(c.paidAt, end)));
  const map = new Map<string, CastBreakdown>();
  const cast = (id: string) => map.get(id) ?? (map.set(id, { castId: id, done: 0, sales: 0, champagne: 0, open: 0, customers: [] }), map.get(id)!);
  const cust = (b: CastBreakdown, id: string) => b.customers.find((x) => x.customerId === id) ?? (b.customers.push({ customerId: id, done: 0, open: 0, sales: 0 }), b.customers.at(-1)!);
  for (const x of done) {
    const b = cast(x.castId);
    const counted = x.status === 'done' ? 1 : 0;
    const sales = Math.max(0, x.price - (refunded.get(String(x.id)) ?? 0));
    b.done += counted;
    b.sales += sales;
    const k = cust(b, x.customerId);
    k.done += counted;
    k.sales += sales;
  }
  for (const x of open) {
    const b = cast(x.castId);
    b.open++;
    cust(b, x.customerId).open++;
  }
  for (const x of champ) {
    const b = cast(x.castId);
    b.sales += x.price;
    b.champagne += x.price;
    cust(b, x.customerId).sales += x.price;
  }
  for (const b of map.values()) b.customers.sort((a, z) => z.sales - a.sales || z.done + z.open - (a.done + a.open));
  return [...map.values()].sort((a, z) => z.sales - a.sales || z.done - a.done);
}

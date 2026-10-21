import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { castChampagnes, castSessions, coinTx } from '../db/schema.js';
import { monthKey, monthOf } from './castRank.js';
export type CastLeaderboardRow = { castId:string; count:number; revenue:number };
/** 完了通話の本数と、返金を除いた手数料前売上。シャンパンは支払済みだけ。 */
export async function castLeaderboard(db:Db, now=new Date()) {
 const start=monthOf(now),end=monthOf(now,1),s=castSessions,c=castChampagnes,t=coinTx;
 const result=await db.execute(sql`
 select cast_id, sum(calls)::int as calls, sum(revenue)::text as revenue from (
   select ${s.castId} as cast_id, count(*) filter (where ${s.plan} not like 'dlv:%') as calls,
   sum(greatest(0, ${s.price} - coalesce((select sum(${t.amount}) from ${t} where ${t.reason}='cast_refund' and ${t.detail}->>'sessionId'=${s.id}::text and ${t.memberId}=${s.customerId}),0))) as revenue
   from ${s} where ${s.status}='done' and ${s.closedAt}>=${start} and ${s.closedAt}<${end} and ${s.closedAt}<=${now} group by ${s.castId}
   union all
   select ${c.castId} as cast_id, 0 as calls, sum(${c.price}) as revenue from ${c}
   where ${c.paidAt}>=${start} and ${c.paidAt}<${end} and ${c.paidAt}<=${now} group by ${c.castId}
 ) totals group by cast_id`);
 const rows:CastLeaderboardRow[]=(result as {rows:{cast_id:string;calls:number;revenue:string}[]}).rows.map(r=>({castId:String(r.cast_id),count:Number(r.calls),revenue:Number(r.revenue)}));
 return {month:monthKey(start),rows:rows.filter(r=>r.count>0||r.revenue>0)};
}

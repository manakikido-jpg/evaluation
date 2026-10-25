import {and,eq,gte,lt,sql} from 'drizzle-orm';
import type {Db} from '../db/client.js';
import {visitCreatorLicenses,visitPurchases,visitDesigns} from '../db/schema.js';
import {VISIT_ITEMS} from './visitProfile.js';
export async function visitRevenue(db:Db,start?:Date,end?:Date){
 const p=visitPurchases,l=visitCreatorLicenses;
 const range=start&&end?and(gte(p.createdAt,start),lt(p.createdAt,end)):undefined;
 const [totals,license,rows,designs]=await Promise.all([
  db.select({count:sql<number>`count(*)::int`,buyers:sql<number>`count(distinct ${p.memberId})::int`,sales:sql<string>`coalesce(sum(${p.price}),0)`,creatorPaid:sql<string>`coalesce(sum(${p.creatorPaid}),0)`}).from(p).where(range),
  db.select({count:sql<number>`count(*)::int`,sales:sql<string>`coalesce(sum(${l.price}),0)`}).from(l).where(start&&end?and(gte(l.createdAt,start),lt(l.createdAt,end)):undefined),
  db.select({id:p.itemId,count:sql<number>`count(*)::int`,sales:sql<string>`coalesce(sum(${p.price}),0)`,creatorPaid:sql<string>`coalesce(sum(${p.creatorPaid}),0)`}).from(p).where(range).groupBy(p.itemId),
  db.select({id:visitDesigns.id,name:visitDesigns.name,kind:visitDesigns.kind}).from(visitDesigns),
 ]);
 const sales=Number(totals[0]!.sales),creatorPaid=Number(totals[0]!.creatorPaid),licenseSales=Number(license[0]!.sales);
 return {count:totals[0]!.count,buyers:totals[0]!.buyers,sales,creatorPaid,licenseCount:license[0]!.count,licenseSales,revenue:sales-creatorPaid+licenseSales,
  items:rows.map(row=>{const item=VISIT_ITEMS.find(i=>i.id===row.id)??designs.find(i=>i.id===row.id);return {id:row.id,name:item?.name??row.id,kind:item?.kind??'unknown',count:row.count,sales:Number(row.sales),creatorPaid:Number(row.creatorPaid),revenue:Number(row.sales)-Number(row.creatorPaid)};}).sort((a,b)=>b.sales-a.sales||a.id.localeCompare(b.id))};
}
export type VisitRevenue=Awaited<ReturnType<typeof visitRevenue>>;

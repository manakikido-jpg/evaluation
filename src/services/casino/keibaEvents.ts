import { z } from 'zod';
import { and, eq, gte, lt, lte, desc, sql, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { keibaEvents,keibaEventEntries,keibaEventRewards,keibaEntries,keibaHorses,members } from '../../db/schema.js';
import { KB_DISTANCES } from './keiba.js';
import { KB_OUTFIT_COLORS } from './keibaOutfit.js';
import { loadRoster, setOwnerSilk } from './keibaStable.js';
import { createTable } from './tables/service.js';
import type { GuildConfig } from '../../config.js';
export const EVENT_KINDS={season:'季節限定レース',league:'シーズンリーグ',rookie:'新馬大会',condition:'条件戦',team:'馬主対抗戦'} as const;
export const eventSchema=z.object({
  name:z.string().trim().min(1).max(30),kind:z.enum(['season','league','rookie','condition','team']),
  startsAt:z.coerce.date(),endsAt:z.coerce.date(),
  rules:z.object({dist:z.number().refine(n=>(KB_DISTANCES as readonly number[]).includes(n)),surface:z.number().int().min(-1).max(1),maxStarts:z.number().int().min(0).max(100000),minWins:z.number().int().min(0).max(10000),maxWins:z.number().int().min(0).max(10000),points:z.array(z.number().int().min(0).max(100)).length(8),rewardTitle:z.string().trim().min(1).max(30),rewardColor:z.string().refine(v=>Object.hasOwn(KB_OUTFIT_COLORS,v)),rewardPlaces:z.number().int().min(1).max(100)}),
}).refine(x=>x.endsAt>x.startsAt&&x.endsAt.getTime()-x.startsAt.getTime()<=366*86400000&&x.rules.maxWins>=x.rules.minWins);
export type EventInput=z.infer<typeof eventSchema>;
export const events=(db:Db)=>db.select().from(keibaEvents).orderBy(desc(keibaEvents.startsAt)).limit(100);
export async function saveEvent(db:Db,raw:unknown,by:string,now:Date,id?:number){
 const parsed=eventSchema.safeParse(raw);if(!parsed.success||parsed.data.startsAt<=now)return false;
 return db.transaction(async tx=>{
  if(id){const [old]=await tx.select().from(keibaEvents).where(eq(keibaEvents.id,id)).for('update');if(!old||old.startsAt<=now||old.tableId||old.cancelled)return false;await tx.update(keibaEvents).set(parsed.data).where(eq(keibaEvents.id,id));}
  else await tx.insert(keibaEvents).values({...parsed.data,createdBy:by});return true;
 });
}
export async function cancelEvent(db:Db,id:number,now:Date){
 const r=await db.update(keibaEvents).set({cancelled:true}).where(and(eq(keibaEvents.id,id),gte(keibaEvents.startsAt,now),isNull(keibaEvents.tableId))).returning();return !!r.length;
}
export async function enterEvent(db:Db,id:number,horseId:number,ownerId:string,team:string,now:Date){
 return db.transaction(async tx=>{
  const [e]=await tx.select().from(keibaEvents).where(eq(keibaEvents.id,id)).for('update');
  const [h]=await tx.select().from(keibaHorses).where(eq(keibaHorses.id,horseId)).for('update');
  if(!e||e.cancelled||e.tableId||e.startsAt<=now||!h||h.ownerId!==ownerId||h.retiredAt||h.breeding)return false;
  if(h.starts>e.rules.maxStarts||h.wins<e.rules.minWins||h.wins>e.rules.maxWins||e.kind==='rookie'&&h.starts!==0)return false;
  const label=team.trim().slice(0,20);if(e.kind==='team'&&!label)return false;
  // 登録後のチーム変更・重複登録は行わない。
  await tx.insert(keibaEventEntries).values({eventId:id,horseId,ownerId,team:e.kind==='team'?label:''}).onConflictDoNothing();return true;
 });
}
export type EventScore={id:string;name:string;points:number;runs:number;wins:number;rank:number;members:string[]};
export async function eventScores(db:Db,id:number):Promise<EventScore[]>{
 const [e]=await db.select().from(keibaEvents).where(eq(keibaEvents.id,id));if(!e||e.cancelled)return [];
 const registered=await db.select().from(keibaEventEntries).where(eq(keibaEventEntries.eventId,id));
 const records=await db.select().from(keibaEntries).where(and(gte(keibaEntries.at,e.startsAt),lt(keibaEntries.at,e.endsAt)));
 const names=new Map((await db.select({id:members.id,name:members.displayName}).from(members)).map(m=>[m.id,m.name]));
 const scores=new Map<string,EventScore>();
 for(const row of records){const entry=registered.find(x=>x.horseId===row.horseId&&x.ownerId===row.ownerId);if(!entry||row.dist!==e.rules.dist||e.rules.surface>=0&&row.surface!==e.rules.surface)continue;
  // 単発大会は、そのイベント専用レースのみを数える。リーグ/対抗戦は期間内の条件一致を数える。
  if(e.kind!=='league'&&e.kind!=='team'&&row.tableId!==e.tableId)continue;
  const key=e.kind==='team'?entry.team:entry.ownerId;
  const score=scores.get(key)??{id:key,name:e.kind==='team'?key:names.get(key)??'不明な馬主',points:0,runs:0,wins:0,rank:0,members:[]};
  score.points+=e.rules.points[row.pos-1]??0;score.runs++;if(row.pos===1)score.wins++;
  if(!score.members.includes(entry.ownerId))score.members.push(entry.ownerId);scores.set(key,score);
 }
 const out=[...scores.values()].sort((a,b)=>b.points-a.points||a.id.localeCompare(b.id));
 out.forEach((s,i)=>s.rank=i&&out[i-1]!.points===s.points?out[i-1]!.rank:i+1);return out;
}
export async function claimEvent(db:Db,id:number,memberId:string,now:Date){
 return db.transaction(async tx=>{
  const [e]=await tx.select().from(keibaEvents).where(eq(keibaEvents.id,id)).for('update');if(!e||e.cancelled||now<e.endsAt)return false;
  const rank=(await eventScores(tx,id)).find(s=>s.members.includes(memberId))?.rank;if(!rank||rank>e.rules.rewardPlaces)return false;
  await tx.insert(keibaEventRewards).values({eventId:id,memberId,rank,title:e.rules.rewardTitle,color:e.rules.rewardColor,at:now}).onConflictDoNothing();return true;
 });
}
export async function equipEventSilk(db:Db,id:number,memberId:string){const [r]=await db.select().from(keibaEventRewards).where(and(eq(keibaEventRewards.eventId,id),eq(keibaEventRewards.memberId,memberId)));if(!r)return false;await setOwnerSilk(db,memberId,{base:r.color,accent:'#d4af37',pattern:2});return true;}
/** 通常の毎分処理から呼ぶ。再起動/並行起動でも1大会1卓。通知は既存のWebから確認する。 */
export async function eventTick(db:Db,cfg:GuildConfig,now:Date){
 if(!cfg.casino.enabled||!cfg.casino.games.includes('keiba'))return;
 const due=await db.select().from(keibaEvents).where(and(eq(keibaEvents.cancelled,false),lte(keibaEvents.startsAt,new Date(now.getTime()+10*60000)),gte(keibaEvents.endsAt,now)));
 for(const e of due){if(e.kind==='league'||e.kind==='team')continue;
  await db.transaction(async tx=>{await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'keiba_event:'+e.id}))`);const [latest]=await tx.select().from(keibaEvents).where(eq(keibaEvents.id,e.id));if(latest?.tableId||!latest||latest.cancelled||now>=e.endsAt)return;
   const entry=await tx.select().from(keibaEventEntries).where(eq(keibaEventEntries.eventId,e.id));
   const roster=await loadRoster(tx,now),field=roster.filter(h=>entry.some(x=>x.horseId===h.id&&x.ownerId===h.ownerId)&&h.starts<=e.rules.maxStarts&&h.wins>=e.rules.minWins&&h.wins<=e.rules.maxWins&&(e.kind!=='rookie'||h.starts===0));
   // 少なくとも4頭。8頭を超えた場合は登録馬番の順（抽選条件を隠さない）。
   if(now.getTime()>e.startsAt.getTime()+60000){await tx.update(keibaEvents).set({cancelled:true}).where(eq(keibaEvents.id,e.id));return;}
   if(field.length<4)return;
   const r=await createTable(tx,cfg,'keiba',{id:'bot:keiba:event:'+e.id,name:'咲楽ノ宮大会'},{big:'1',event:'1',field:field.slice(0,8).map(h=>h.id).join(','),title:e.name,dist:String(e.rules.dist),surface:String(e.rules.surface),cls:e.kind==='rookie'?'0':e.kind==='condition'?String(Math.min(5,e.rules.minWins+1)):'6',at:String(e.startsAt.getTime()),key:'event:'+e.id},now);
   if(r.status==='ok'&&'table'in r)await tx.update(keibaEvents).set({tableId:r.table.id}).where(eq(keibaEvents.id,e.id));
  });
 }
}

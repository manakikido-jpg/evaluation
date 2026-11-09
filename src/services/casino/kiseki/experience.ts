import {randomUUID} from 'node:crypto';
import {and,desc,eq,gt,inArray,isNull,sql} from 'drizzle-orm';
import type {Db} from '../../../db/client.js';
import {kisekiTickets,settings} from '../../../db/schema.js';
import {spendWithin} from '../../economy.js';
import {isRestrictedAccount} from '../../staffAlts.js';
import {audit} from '../../audit.js';
import {cryptoRng,type Rng} from '../cards.js';
import {act,expire,freshFloor,releasePlayer,trialView,KisekiError,type Floor,type Action} from './trial.js';
export const EXPERIENCE_PRICE=1500,EXPERIENCE_SECONDS=3600;
export const EXPERIENCE_FLOOR_KEY='casino.kisekiExperience.v1',EXPERIENCE_SALES_KEY='casino.kisekiExperience.sales';
export async function experienceSales(db:Db){const [r]=await db.select().from(settings).where(eq(settings.key,EXPERIENCE_SALES_KEY));return (r?.value as {enabled?:boolean}|undefined)?.enabled===true;}
/** ロビーの表示だけで遊技台をロック/初期化しない。購入済みの人は販売休止中も履歴へ戻れる。 */
export async function experienceVisible(db:Db,id:string){if(await experienceSales(db))return true;const [ticket]=await db.select({id:kisekiTickets.id}).from(kisekiTickets).where(eq(kisekiTickets.memberId,id)).limit(1);return !!ticket;}
export async function setExperienceSales(db:Db,id:string,enabled:boolean,now:Date){await db.transaction(async tx=>{
 // 購入と同じ順で排他し、販売停止と購入が食い違わないようにする。
 await lockedFloor(tx,id,now);
 await tx.insert(settings).values({key:EXPERIENCE_SALES_KEY,value:{enabled},updatedBy:id,updatedAt:now}).onConflictDoUpdate({target:settings.key,set:{value:{enabled},updatedBy:id,updatedAt:now}});
 await audit(tx,{actorId:id,action:'casino.kisekiExperience.sales',detail:{enabled},via:'web'});
});}
async function lockedFloor(tx:Db,id:string,now:Date):Promise<Floor>{
 await tx.insert(settings).values({key:EXPERIENCE_FLOOR_KEY,value:freshFloor(now.getTime()),updatedBy:id,updatedAt:now}).onConflictDoNothing();
 const [r]=await tx.select().from(settings).where(eq(settings.key,EXPERIENCE_FLOOR_KEY)).for('update');
 const f=structuredClone(r!.value) as Floor;if(f.version!=='kiseki-floor-1')throw new KisekiError('先行体験の保存形式を確認してください。',409);return f;
}
async function save(tx:Db,f:Floor,id:string,now:Date){await tx.update(settings).set({value:f,updatedBy:id,updatedAt:now}).where(eq(settings.key,EXPERIENCE_FLOOR_KEY));}
/** 期限後の新規回転を止める。進行中の1回転は残し、STOPを完了できる。 */
async function sweep(tx:Db,f:Floor,now:Date){
 expire(f,now.getTime());const owners=f.machines.flatMap(m=>m.owner?[m.owner]:[]);if(!owners.length)return;
 const active=await tx.select({memberId:kisekiTickets.memberId}).from(kisekiTickets).where(and(inArray(kisekiTickets.memberId,owners),gt(kisekiTickets.endsAt,now)));
 const ids=new Set(active.map(t=>t.memberId));for(const m of f.machines)if(m.owner&&!ids.has(m.owner)&&!m.state.pending)releasePlayer(f,m.owner);
}
export async function experienceState(db:Db,id:string,now:Date){return db.transaction(async tx=>{
 const f=await lockedFloor(tx,id,now),revision=f.revision;await sweep(tx,f,now);if(f.revision!==revision)await save(tx,f,id,now);
 const tickets=await tx.select().from(kisekiTickets).where(eq(kisekiTickets.memberId,id)).orderBy(desc(kisekiTickets.createdAt));
 const active=tickets.find(t=>t.endsAt&&t.endsAt>now)??null;
 return {enabled:await experienceSales(tx),result:f.players['u:'+id]?.receipt??null,active,unused:tickets.filter(t=>!t.startedAt),history:tickets.slice(0,30),view:{...trialView(f,id),revision:f.players['u:'+id]?.experienceRevision??0},finishSaved:!!f.players['u:'+id]?.saved?.pending,now:now.getTime()};
});}
export type ExperienceState=Awaited<ReturnType<typeof experienceState>>;
async function checkMember(tx:Db,id:string){if(await isRestrictedAccount(tx,id))throw new KisekiError('このアカウントでは体験券を利用できません。',403);}
export async function buyExperience(db:Db,id:string,requestId:string,now:Date){
 if(!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId))throw new KisekiError('購入画面を開き直してください。');
 return db.transaction(async tx=>{
 await lockedFloor(tx,id,now);await checkMember(tx,id);
 const [previous]=await tx.select().from(kisekiTickets).where(and(eq(kisekiTickets.memberId,id),eq(kisekiTickets.requestId,requestId)));if(previous)return previous;
 if(!await experienceSales(tx))throw new KisekiError('体験券の販売はお休み中です。',409);
 const ticket={id:randomUUID(),memberId:id,requestId,price:EXPERIENCE_PRICE,seconds:EXPERIENCE_SECONDS,createdAt:now};
 if(!await spendWithin(tx,id,EXPERIENCE_PRICE,'kiseki_ticket',{ticketId:ticket.id,seconds:EXPERIENCE_SECONDS}))throw new KisekiError('体験券を買う銭が足りません。');
 const [saved]=await tx.insert(kisekiTickets).values(ticket).returning();
 await audit(tx,{actorId:id,action:'casino.kisekiExperience.buy',detail:{ticketId:ticket.id,price:EXPERIENCE_PRICE,requestId},via:'web'});return saved!;
 });
}
export async function startExperience(db:Db,id:string,name:string,ticketId:string,now:Date){return db.transaction(async tx=>{
 const f=await lockedFloor(tx,id,now);await checkMember(tx,id);await sweep(tx,f,now);
 const [ticket]=await tx.select().from(kisekiTickets).where(and(eq(kisekiTickets.id,ticketId),eq(kisekiTickets.memberId,id))).for('update');
 if(!ticket)throw new KisekiError('自分の体験券を選んでください。',403);
 if(ticket.startedAt){if(ticket.endsAt!>now)return ticket;throw new KisekiError('この体験券は利用済みです。',409);}
 const [active]=await tx.select().from(kisekiTickets).where(and(eq(kisekiTickets.memberId,id),gt(kisekiTickets.endsAt,now)));if(active)throw new KisekiError('使用中の体験券が終わってから使えます。',409);
 const m=f.machines.find(m=>m.owner===id)??f.machines.find(m=>m.owner===null);if(!m)throw new KisekiError('満席です。券は未使用のままです。空席になってから開始してください。',409);
 if(!m.owner)act(f,id,name,{action:'seat',machine:m.id,revision:f.revision},now.getTime());
 const [started]=await tx.update(kisekiTickets).set({startedAt:now,endsAt:new Date(now.getTime()+EXPERIENCE_SECONDS*1000)}).where(and(eq(kisekiTickets.id,ticket.id),isNull(kisekiTickets.startedAt))).returning();
 f.players['u:'+id]!.experienceRevision=(f.players['u:'+id]!.experienceRevision??0)+1;
 await save(tx,f,id,now);await audit(tx,{actorId:id,action:'casino.kisekiExperience.start',detail:{ticketId:ticket.id,endsAt:started!.endsAt!.toISOString(),machine:m.id},via:'web'});return started!;
});}
export async function playExperience(db:Db,id:string,name:string,a:Action,now:Date,rng:Rng=cryptoRng){await db.transaction(async tx=>{
 const f=await lockedFloor(tx,id,now);await checkMember(tx,id);await sweep(tx,f,now);
 if(!['seat','leave','lever','stop','refill'].includes(a.action))throw new KisekiError('この操作は利用できません。',403);
 const [active]=await tx.select().from(kisekiTickets).where(and(eq(kisekiTickets.memberId,id),gt(kisekiTickets.endsAt,now)));
 const own=f.machines.find(m=>m.owner===id),savedPending=!!f.players['u:'+id]?.saved?.pending;
 const finish=a.action==='stop'&&!!own?.state.pending||a.action==='seat'&&savedPending;
 if(!active&&!finish&&a.action!=='leave')throw new KisekiError('体験時間が終わりました。続きは保存されます。体験券を使用してください。',403);
 // 他の体験者の操作では本人の表示を無効にしない。本人の再送は拒否する。
 const revision=f.players['u:'+id]?.experienceRevision??0;
 if(!Number.isSafeInteger(a.revision)||a.revision!==revision)throw new KisekiError('表示が更新されています。最新の画面を確認してください。',409);
 act(f,id,name,{...a,revision:f.revision},now.getTime(),rng);
 f.players['u:'+id]!.experienceRevision=revision+1;
 const after=f.machines.find(m=>m.owner===id);if(!active&&after&&!after.state.pending){const s=after.state;f.players['u:'+id]!.receipt={paid:s.lastPaid,role:s.lastRole,message:s.message,winEvent:s.winEvent};releasePlayer(f,id);}
 await save(tx,f,id,now);await audit(tx,{actorId:id,action:'casino.kisekiExperience.'+a.action,detail:{machine:a.machine,revision:f.revision,ticketId:active?.id??null,trialPoints:true},via:'web'});
});}
export async function experienceTotals(db:Db){const [r]=await db.select({count:sql<number>`count(*)::int`,coins:sql<number>`coalesce(sum(${kisekiTickets.price}),0)::bigint`,started:sql<number>`count(${kisekiTickets.startedAt})::int`}).from(kisekiTickets);return r!;}

import { randomUUID } from 'node:crypto';
import { eq, like, asc, desc, sql, and } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { settings, members, auditLogs } from '../db/schema.js';
import { adminLevelOf, type GuildConfig } from '../config.js';
import { highestRank } from '../domain/ranks.js';
import { audit } from './audit.js';
const JOB='ujiko.demotion:', HOLD='rank.promotion_hold:';
export class DemotionError extends Error {}
export type Entry={id:string;name:string;eligible:boolean;status:'ready'|'excluded'|'done'|'failed'|'skipped';note:string};
export type DemotionJob={id:string;by:string;reason:string;at:string;state:'preview'|'queued'|'running'|'finished';guildId:string;fromRole:string;toRole:string;entries:Entry[];lease?:string;leaseUntil?:string;finishedAt?:string};
export type PromotionHold={id:string;batch:string;by:string;at:string;reason:string};
export type DemotionMember={id:string;name:string;roles:string[];bot:boolean;protected?:boolean};
export type DemotionApi={fetch:(id:string)=>Promise<DemotionMember|null>;add:(id:string,role:string,reason:string)=>Promise<void>;remove:(id:string,role:string,reason:string)=>Promise<void>};
export function parseDemotionIds(text:string){
 if(text.length>20000)throw new DemotionError('リストが長すぎます（200人まで）。');
 const tokens=text.trim().split(/[\s,、]+/).filter(Boolean);if(!tokens.length)throw new DemotionError('ユーザーIDを入れてください。');
 const ids=tokens.map(t=>{const m=/^(?:<@!?(\d{17,20})>|(\d{17,20}))$/.exec(t);const id=m?.[1]??m?.[2];if(!id||BigInt(id)===0n||BigInt(id)>18446744073709551615n)throw new DemotionError('IDかメンションだけを入れてください。名前だけでは判定しません。');return id;});
 const unique=[...new Set(ids)];if(unique.length>200)throw new DemotionError('一度に200人まで確認できます。');return {ids:unique,duplicates:ids.length-unique.length};
}
export function demotionRoles(cfg:GuildConfig){const from=cfg.ranks.find(r=>r.key==='ujiko'),to=cfg.ranks.find(r=>r.key==='sanpaisha');if(!from||!to||from.roleId===to.roleId)throw new DemotionError('氏子と参拝者の役職設定を確認してください。');return {from,to};}
export function demotionEligibility(cfg:GuildConfig,m:DemotionMember|null){
 if(!m)return 'サーバーにいません';if(m.bot)return 'BOTは対象外';
 if(m.protected||adminLevelOf(cfg,m.roles))return '運営・管理者は対象外';
 if(highestRank(cfg.ranks,m.roles)?.key!=='ujiko')return '現在の最上位が氏子ではありません';return '';
}
async function read<T>(db:Db,key:string){return (await db.select().from(settings).where(eq(settings.key,key)))[0]?.value as T|undefined;}
async function put(db:Db,key:string,value:unknown,by:string,now:Date){await db.insert(settings).values({key,value,updatedBy:by,updatedAt:now}).onConflictDoUpdate({target:settings.key,set:{value,updatedBy:by,updatedAt:now}});}
export const promotionHold=(db:Db,id:string)=>read<PromotionHold>(db,HOLD+id);
export async function promotionHolds(db:Db){return (await db.select().from(settings).where(like(settings.key,HOLD+'%'))).map(r=>r.value as PromotionHold);}
export async function rankMutation<T>(db:Db,id:string,fn:(tx:Db)=>Promise<T>):Promise<T>{return db.transaction(async tx=>{await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`rank-mutation:${id}`}))`);return fn(tx as unknown as Db);});}
export const demotionJob=(db:Db,id:string)=>/^[a-f0-9-]{36}$/.test(id)?read<DemotionJob>(db,JOB+id):Promise.resolve(undefined);
export async function demotionJobs(db:Db){return (await db.select().from(settings).where(like(settings.key,JOB+'%')).orderBy(desc(settings.updatedAt)).limit(50)).map(r=>r.value as DemotionJob);}
export async function previewDemotion(db:Db,cfg:GuildConfig,ids:string[],by:string,reason:string,api:Pick<DemotionApi,'fetch'>,now=new Date()){
 const roles=demotionRoles(cfg);if(!reason.trim()||reason.length>500)throw new DemotionError('理由を1〜500文字で入れてください。');
 const checked=parseDemotionIds(ids.join('\n')).ids,entries:Entry[]=[];
 for(let offset=0;offset<checked.length;offset+=4){
  const results=await Promise.allSettled(checked.slice(offset,offset+4).map(async id=>{const m=await api.fetch(id),held=await promotionHold(db,id);const note=held?'すでに自動昇格を保留しています':demotionEligibility(cfg,m);return {id,name:m?.name??id,eligible:!note,status:note?'excluded' as const:'ready' as const,note:note||'氏子 → 参拝者・自動昇格を保留'};}));
  if(results.some(r=>r.status==='rejected'))throw new DemotionError('在籍を確認できない人がいます。少し待ってから確認し直してください。');
  for(const r of results)if(r.status==='fulfilled')entries.push(r.value);
 }
 const job:DemotionJob={id:randomUUID(),by,reason:reason.trim(),at:now.toISOString(),state:'preview',guildId:cfg.guildId,fromRole:roles.from.roleId,toRole:roles.to.roleId,entries};await put(db,JOB+job.id,job,by,now);await audit(db,{actorId:by,action:'rank.demotion_preview',detail:{batch:job.id,count:entries.length},via:'web'});return job;
}
export async function queueDemotion(db:Db,id:string,by:string,now=new Date()){
 return db.transaction(async tx=>{const [row]=await tx.select().from(settings).where(eq(settings.key,JOB+id)).for('update');if(!row)throw new DemotionError('確認済みのリストがありません。');const j=row.value as DemotionJob;
 if(j.by!==by)throw new DemotionError('確認した本人が実行してください。');if(j.state!=='preview')return j;
 if(+now-Date.parse(j.at)>30*60000)throw new DemotionError('確認から30分経ちました。もう一度リストを確認してください。');
 if(!j.entries.some(e=>e.eligible))throw new DemotionError('対象となる氏子がいません。');const next={...j,state:'queued' as const};await put(tx as unknown as Db,JOB+id,next,by,now);await audit(tx as unknown as Db,{actorId:by,action:'rank.demotion_queued',detail:{batch:id,count:j.entries.filter(e=>e.eligible).length},via:'web'});return next;});
}
export async function retryDemotion(db:Db,id:string,by:string,now=new Date()){
 return db.transaction(async tx=>{const [row]=await tx.select().from(settings).where(eq(settings.key,JOB+id)).for('update');if(!row)throw new DemotionError('処理がありません。');const j=row.value as DemotionJob;if(j.state!=='finished')throw new DemotionError('処理が終わってから再試行してください。');const entries=j.entries.map(e=>e.status==='failed'?{...e,status:'ready' as const,note:'再試行待ち'}:e);const next={...j,state:'queued' as const,entries,lease:undefined,leaseUntil:undefined};await put(tx as unknown as Db,JOB+id,next,by,now);await audit(tx as unknown as Db,{actorId:by,action:'rank.demotion_retry',detail:{batch:id},via:'web'});return next;});
}
export async function releasePromotionHold(db:Db,id:string,by:string,reason:string,now=new Date()){
 if(!reason.trim()||reason.length>500)throw new DemotionError('解除の理由を入れてください。');
 await rankMutation(db,id,async tx=>{const hold=await promotionHold(tx,id);if(!hold)return;const j=await demotionJob(tx,hold.batch);if(j&&['queued','running'].includes(j.state))throw new DemotionError('役職の変更処理が終わってから解除してください。');await tx.delete(settings).where(eq(settings.key,HOLD+id));await audit(tx,{actorId:by,targetId:id,action:'rank.promotion_hold_release',detail:{batch:hold.batch,reason:reason.trim()},via:'web'});});
}
async function takeJob(db:Db,now:Date){return db.transaction(async tx=>{
 const rows=await tx.select().from(settings).where(and(like(settings.key,JOB+'%'),sql`${settings.value}->>'state' in ('queued','running')`)).orderBy(asc(settings.updatedAt)).for('update',{skipLocked:true});
 for(const r of rows){const j=r.value as DemotionJob;if(j.state!=='queued'&&!(j.state==='running'&&Date.parse(j.leaseUntil??'')<=+now))continue;const next={...j,state:'running' as const,lease:randomUUID(),leaseUntil:new Date(+now+120000).toISOString()};await put(tx as unknown as Db,r.key,next,j.by,now);return next;}
 });}
async function saveEntry(db:Db,job:DemotionJob,entry:Entry,now:Date){return db.transaction(async tx=>{const [row]=await tx.select().from(settings).where(eq(settings.key,JOB+job.id)).for('update');if(!row)return false;const j=row.value as DemotionJob;if(j.lease!==job.lease)return false;const next={...j,entries:j.entries.map(e=>e.id===entry.id?entry:e),leaseUntil:new Date(+now+120000).toISOString()};await put(tx as unknown as Db,row.key,next,j.by,now);return true;});}
/** 一度に最大20人。保留は役職変更より先に確定し、途中失敗でも残す。 */
export async function runUjikoDemotions(db:Db,cfg:GuildConfig,api:DemotionApi,lock:<T>(id:string,fn:()=>Promise<T>)=>Promise<T>,budget=20,now=new Date()){
 const job=await takeJob(db,now);if(!job)return;
 const actor=await api.fetch(job.by);
 let roles:ReturnType<typeof demotionRoles>|undefined;try{roles=demotionRoles(cfg);}catch{}
 if(!actor||actor.bot||adminLevelOf(cfg,actor.roles)!=='guji'||!roles||job.guildId!==cfg.guildId||roles.from.roleId!==job.fromRole||roles.to.roleId!==job.toRole){for(const e of job.entries.filter(e=>e.status==='ready'))await saveEntry(db,job,{...e,status:'failed',note:'実行者の宮司権限、または役職設定を確認できないため中止しました。新しいリストで確認してください。'},now);await db.transaction(async tx=>{const j=await demotionJob(tx as unknown as Db,job.id);if(j?.lease===job.lease)await put(tx as unknown as Db,JOB+job.id,{...j,state:'finished',lease:undefined,leaseUntil:undefined},j.by,now);});return;}
 const {from,to}=roles;
 for(const entry of job.entries.filter(e=>e.status==='ready').slice(0,Math.max(1,Math.min(20,budget)))){
  let result:Entry;
  try{result=await lock(entry.id,async()=>{
   const m=await api.fetch(entry.id),held=await promotionHold(db,entry.id);const resume=held?.batch===job.id;
   const exclusion=demotionEligibility(cfg,m);
   if(held&&!resume)return {...entry,status:'skipped',note:'別の処理で自動昇格を保留済み'};
   if(exclusion&&!(resume&&m&&!m.bot&&!m.protected&&!adminLevelOf(cfg,m.roles)&&highestRank(cfg.ranks,m.roles)?.key==='sanpaisha'))return {...entry,status:'skipped',note:exclusion};
   await rankMutation(db,entry.id,async tx=>{const current=await demotionJob(tx,job.id);if(current?.lease!==job.lease||current.state!=='running')throw new DemotionError('処理は更新されています。');const h=await promotionHold(tx,entry.id);if(h&&h.batch!==job.id)throw new DemotionError('別の変更が進行中です。');await put(tx,HOLD+entry.id,{id:entry.id,batch:job.id,by:job.by,at:now.toISOString(),reason:job.reason},job.by,now);});
   return rankMutation(db,entry.id,async tx=>{
    const heldNow=await promotionHold(tx,entry.id),current=await demotionJob(tx,job.id);if(heldNow?.batch!==job.id||current?.lease!==job.lease||current.state!=='running')throw new DemotionError('処理は更新されています。');
    const fresh=await api.fetch(entry.id);if(!fresh)throw new DemotionError('在籍を確認できません。');
    const why=demotionEligibility(cfg,fresh);if(why&&!(highestRank(cfg.ranks,fresh.roles)?.key==='sanpaisha'&&!fresh.bot&&!fresh.protected&&!adminLevelOf(cfg,fresh.roles)))throw new DemotionError('役職が変わっています。運営が確認してください。');
    const reason=`氏子の見直し: ${job.reason}`;
    if(!fresh.roles.includes(to.roleId))await api.add(entry.id,to.roleId,reason);
    if(fresh.roles.includes(from.roleId))await api.remove(entry.id,from.roleId,reason);
    const after=await api.fetch(entry.id);if(!after||after.roles.includes(from.roleId)||!after.roles.includes(to.roleId))throw new DemotionError('役職の反映を確認できません。再試行してください。');
    await tx.update(members).set({roleIds:after.roles}).where(eq(members.id,entry.id));
    const [recorded]=await tx.select({id:auditLogs.id}).from(auditLogs).where(and(eq(auditLogs.action,'rank.ujiko_to_sanpaisha'),eq(auditLogs.targetId,entry.id),sql`${auditLogs.detail}->>'batch' = ${job.id}`)).limit(1);
    if(!recorded)await audit(tx,{actorId:job.by,targetId:entry.id,action:'rank.ujiko_to_sanpaisha',detail:{batch:job.id,reason:job.reason,hold:true},via:'system'});
    return {...entry,status:'done' as const,note:'参拝者へ変更・自動昇格を保留'};
   });
  });}catch{result={...entry,status:'failed',note:'変更を完了できませんでした。BOTの役職管理権限・ロールの位置と在籍を確認し、再試行してください。保留がある場合は維持します。'};}
  if(!await saveEntry(db,job,result,now))return;
 }
 await db.transaction(async tx=>{const [r]=await tx.select().from(settings).where(eq(settings.key,JOB+job.id)).for('update');if(!r)return;const j=r.value as DemotionJob;if(j.lease!==job.lease)return;const pending=j.entries.some(e=>e.status==='ready');await put(tx as unknown as Db,r.key,{...j,state:pending?'queued':'finished',lease:undefined,leaseUntil:undefined,...(!pending?{finishedAt:now.toISOString()}:{})},j.by,now);});
}

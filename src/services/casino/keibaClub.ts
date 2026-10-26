import {and,eq,desc,gte,lt,sql,inArray} from 'drizzle-orm';
import type {Db} from '../../db/client.js';
import {coinTx,keibaHorses,keibaShares,keibaEntries,keibaEventRewards,keibaReplays,members} from '../../db/schema.js';
import {development,isSkill,unlocked,type Skill,TRAINING,SKILLS} from './keibaDevelopment.js';
import {KB_FOAL_SPD_SWING,KB_FOAL_STA_SWING} from './keibaStable.js';
import {fatigueNow} from './keiba.js';
import {horseTitles} from './keibaHonors.js';
export async function equipSkills(db:Db,ownerId:string,id:number,skills:unknown[]){
 if(skills.length>2||!skills.every(isSkill)||new Set(skills).size!==skills.length)return false;
 return db.transaction(async tx=>{const [h]=await tx.select().from(keibaHorses).where(and(eq(keibaHorses.id,id),eq(keibaHorses.ownerId,ownerId))).for('update');if(!h)return false;const d=development(h.development);if(!(skills as Skill[]).every(k=>unlocked(d,k)))return false;d.skills=skills as Skill[];await tx.update(keibaHorses).set({development:d}).where(eq(keibaHorses.id,id));return true;});
}
export type Pedigree={id:number;name:string;wins:number;starts:number;titles:string[];father:Pedigree|null;mother:Pedigree|null};
export async function pedigree(db:Db,id:number,depth=3,seen=new Set<number>()):Promise<Pedigree|null>{
 if(depth<0||seen.has(id))return null;const [h]=await db.select().from(keibaHorses).where(eq(keibaHorses.id,id));if(!h)return null;
 const next=new Set([...seen,id]);const runs=await db.select().from(keibaEntries).where(eq(keibaEntries.horseId,id));
 return {id,name:h.name,wins:h.wins,starts:h.starts,titles:horseTitles(runs,!!h.retiredAt),father:h.parentId?await pedigree(db,h.parentId,depth-1,next):null,mother:h.damId?await pedigree(db,h.damId,depth-1,next):null};
}
export async function matingPreview(db:Db,sireId:number,damId:number){
 const rows=await db.select().from(keibaHorses).where(inArray(keibaHorses.id,[sireId,damId]));const sire=rows.find(h=>h.id===sireId),dam=rows.find(h=>h.id===damId);if(!sire||!dam)return null;
 const ancestors=(p:Pedigree|null):number[]=>p?[p.id,...ancestors(p.father),...ancestors(p.mother)]:[];
 const a=ancestors(await pedigree(db,sireId)),b=new Set(ancestors(await pedigree(db,damId)));
 return {sire:sire.name,dam:dam.name,related:a.some(id=>b.has(id)),speed:[Math.max(970,Math.round((sire.spd+dam.spd)/2)-KB_FOAL_SPD_SWING),Math.min(1020,Math.round((sire.spd+dam.spd)/2)+KB_FOAL_SPD_SWING)],stamina:[Math.max(850,Math.round((sire.sta+dam.sta)/2)-KB_FOAL_STA_SWING),Math.min(1200,Math.round((sire.sta+dam.sta)/2)+KB_FOAL_STA_SWING)],skills:[...new Set([...development(sire.development).skills,...development(dam.development).skills])],fee:sire.studFee};
}
export async function ownerLedger(db:Db,id:string,since?:Date){
 const where=and(eq(coinTx.memberId,id),sql`${coinTx.reason} like 'keiba_%'`,since?gte(coinTx.at,since):undefined);
 const rows=await db.select().from(coinTx).where(where).orderBy(desc(coinTx.at)).limit(100);
 const groups=await db.select({reason:coinTx.reason,amount:sql<number>`sum(${coinTx.amount})::float8`}).from(coinTx).where(where).groupBy(coinTx.reason);
 const [total]=await db.select({income:sql<number>`coalesce(sum(greatest(${coinTx.amount},0)),0)::float8`,expense:sql<number>`coalesce(sum(greatest(-${coinTx.amount},0)),0)::float8`}).from(coinTx).where(where);
 return {groups,income:total?.income??0,expense:total?.expense??0,rows,limited:false};
}
export async function clubHorse(db:Db,id:number,viewer:string,now=new Date()){
 const [horse]=await db.select().from(keibaHorses).where(eq(keibaHorses.id,id));if(!horse)return null;
 const holders=await db.select().from(keibaShares).where(eq(keibaShares.horseId,id));
 const names=new Map((await db.select({id:members.id,name:members.displayName}).from(members).where(inArray(members.id,[horse.ownerId??'',...holders.map(h=>h.memberId)]))).map(m=>[m.id,m.name]));
 const myUnits=holders.length?holders.find(h=>h.memberId===viewer)?.units??0:horse.ownerId===viewer?10:0;
 const shareHistory=myUnits>0?await db.select({at:coinTx.at,amount:coinTx.amount}).from(coinTx).where(and(eq(coinTx.reason,'keiba_trade'),sql`${coinTx.detail}->>'share' = ${String(id)}`,sql`${coinTx.amount}>0`)).orderBy(desc(coinTx.at)).limit(30):[];
 return {shareHistory,horse:{...horse,fatigue:fatigueNow(horse.fatigue,horse.fatigueAt,now)},development:development(horse.development),pedigree:await pedigree(db,id),holders:holders.length?holders.map(h=>({...h,name:names.get(h.memberId)??'不明な馬主'})):horse.ownerId?[{memberId:horse.ownerId,units:10,name:names.get(horse.ownerId)??'不明な馬主'}]:[],myUnits,manager:horse.ownerId===viewer};
}
export async function racingRankings(db:Db,since:Date,until:Date){
 const rows=await db.select().from(keibaEntries).where(and(gte(keibaEntries.at,since),lt(keibaEntries.at,until)));
 const horseIds=[...new Set(rows.map(r=>r.horseId))];const horses=horseIds.length?await db.select().from(keibaHorses).where(inArray(keibaHorses.id,horseIds)):[];
 const names=new Map((await db.select({id:members.id,name:members.displayName}).from(members)).map(m=>[m.id,m.name]));
 const parentIds=[...new Set(horses.flatMap(h=>h.parentId?[h.parentId]:[]))];const parents=parentIds.length?await db.select({id:keibaHorses.id,name:keibaHorses.name}).from(keibaHorses).where(inArray(keibaHorses.id,parentIds)):[];
 const aggregate=(kind:'horse'|'owner'|'sire')=>{const m=new Map<string,{id:string;name:string;wins:number;runs:number;prize:number}>();for(const r of rows){const parent=horses.find(h=>h.id===r.horseId)?.parentId;const key=kind==='horse'?String(r.horseId):kind==='owner'?r.ownerId:parent?String(parent):null;if(!key)continue;const s=m.get(key)??{id:key,name:kind==='horse'?r.horseName:kind==='owner'?names.get(key)??'不明な馬主':parents.find(h=>String(h.id)===key)?.name??`不明な種牡馬 #${key}`,wins:0,runs:0,prize:0};s.runs++;if(r.pos===1)s.wins++;s.prize+=r.prize;m.set(key,s);}return [...m.values()].sort((a,b)=>b.wins-a.wins||b.prize-a.prize||a.id.localeCompare(b.id)).slice(0,30);};
 return {horses:aggregate('horse'),owners:aggregate('owner'),sires:aggregate('sire')};
}
export const replays=(db:Db,before?:number)=>db.select({id:keibaReplays.id,at:keibaReplays.at,data:keibaReplays.data}).from(keibaReplays).where(before?lt(keibaReplays.id,before):undefined).orderBy(desc(keibaReplays.id)).limit(30);
export async function ownerProfile(db:Db,id:string){const [m]=await db.select({name:members.displayName}).from(members).where(eq(members.id,id));const rewards=await db.select().from(keibaEventRewards).where(eq(keibaEventRewards.memberId,id));const runs=await db.select().from(keibaEntries).where(eq(keibaEntries.ownerId,id));return {name:m?.name??'不明な馬主',runs:runs.length,wins:runs.filter(r=>r.pos===1).length,titles:[...new Set([...(runs.some(r=>r.cls===8&&r.pos===1)?['👑 G1馬主']:[]),...(runs.filter(r=>r.pos===1).length>=10?['🌸 十勝の馬主']:[]),...rewards.map(r=>r.title)])],rewards};}

export function racingMonth(now:Date){const j=new Date(now.getTime()+9*3600000),y=j.getUTCFullYear(),m=j.getUTCMonth();return {start:new Date(Date.UTC(y,m,1)-9*3600000),end:new Date(Date.UTC(y,m+1,1)-9*3600000)};}

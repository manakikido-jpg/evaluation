import { randomInt } from 'node:crypto';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { bingoEvents, bingoCards, members, settings, type BingoSummary } from '../db/schema.js';
import { audit } from './audit.js';

export class BingoError extends Error {}
const HOSTS='bingo.host_roles';
/** 🎯 ビンゴを回せるロール（宮司・神職のほかに。イベントメンバーなど） */
export async function bingoHostRoles(db:Db):Promise<string[]>{
 const [row]=await db.select().from(settings).where(eq(settings.key,HOSTS));
 return Array.isArray(row?.value)?(row.value as unknown[]).filter((x):x is string=>typeof x==='string'&&/^\d{17,20}$/.test(x)):[];
}
export async function saveBingoHostRoles(db:Db,roleIds:string[],by:string){
 const value=[...new Set(roleIds.filter(x=>/^\d{17,20}$/.test(x)))].slice(0,10);
 await db.transaction(async tx=>{
  await tx.insert(settings).values({key:HOSTS,value,updatedBy:by}).onConflictDoUpdate({target:settings.key,set:{value,updatedBy:by,updatedAt:new Date()}});
  await audit(tx as Db,{actorId:by,action:'bingo.host_roles',detail:{roleIds:value},via:'web'});
 });
 return value;
}
const LINES=Array.from({length:5},(_,r)=>Array.from({length:5},(_,c)=>r*5+c))
 .concat(Array.from({length:5},(_,c)=>Array.from({length:5},(_,r)=>r*5+c)),[[0,6,12,18,24],[4,8,12,16,20]]);
export function makeBingoCard(){
 const card=Array<number>(25);
 for(let c=0;c<5;c++){
  const pool=Array.from({length:15},(_,i)=>c*15+i+1);
  for(let r=0;r<5;r++)card[r*5+c]=pool.splice(randomInt(pool.length),1)[0]!;
 }
 card[12]=0;return card;
}
/** すでにあるカード（数字を , でつないだもの）と同じにならないカード。50 回作っても重なれば失敗 */
export function uniqueBingoCard(taken:ReadonlySet<string>,make:()=>number[]=makeBingoCard){
 for(let i=0;i<50;i++){const card=make();if(!taken.has(card.join(',')))return card;}
 throw new BingoError('カードを作れませんでした。もう一度お試しください。');
}
export function bingoProgress(card:readonly number[],draws:readonly number[]){
 const called=new Map(draws.map((n,i)=>[n,i+1]));
 const marked=card.map(n=>n===0||called.has(n));
 const complete=LINES.filter(line=>line.every(i=>marked[i]));
 const finishes=complete.map(line=>Math.max(...line.map(i=>called.get(card[i]!)??0))).sort((a,b)=>a-b);
 const reachNumbers=[...new Set(LINES.flatMap(line=>{const missing=line.filter(i=>!marked[i]);return missing.length===1?[card[missing[0]!]!]:[];}))].sort((a,b)=>a-b);
 return {marked,lines:complete.length,winningCells:[...new Set(complete.flat())],reachNumbers,bingoAt:finishes[0]??null,doubleAt:finishes[1]??null};
}
type Event=typeof bingoEvents.$inferSelect;
type Card=typeof bingoCards.$inferSelect;
function summarize(cards:Card[],draws:number[]):BingoSummary{
 const progress=cards.map(card=>({card,p:bingoProgress(card.numbers,draws)}));
 const winners=progress.filter(x=>x.p.bingoAt!==null).sort((a,b)=>a.p.bingoAt!-b.p.bingoAt!||a.card.memberId.localeCompare(b.card.memberId));
 let rank=0,lastAt=-1;
 return {participants:cards.length,reaches:progress.filter(x=>!x.p.lines&&x.p.reachNumbers.length).length,
  winners:winners.map((x,i)=>{if(x.p.bingoAt!==lastAt){rank=i+1;lastAt=x.p.bingoAt!;}return {memberId:x.card.memberId,name:x.card.name,rank,at:x.p.bingoAt!,lines:x.p.lines,doubleAt:x.p.doubleAt,claimed:!!x.card.claimedAt,claimedAt:x.card.claimedAt?.getTime()??null};})};
}
const staffOnly=(staff:boolean)=>{if(!staff)throw new BingoError('抽選の操作は宮司・神職とビンゴの担当だけが使えます。');};
const versionOf=(event:Event,version:number)=>{if(event.version!==version)throw new BingoError('画面が更新されています。最新の状態で操作してください。');};
async function locked(db:Db,id:string){const [event]=await db.select().from(bingoEvents).where(eq(bingoEvents.id,id)).for('update');if(!event)throw new BingoError('イベントが見つかりません。');return event;}
async function revealWithin(db:Db,event:Event,now:Date){
 if(event.pendingNumber===null||!event.revealAt||event.revealAt>now)return event;
 const draws=[...event.draws,event.pendingNumber];const cards=await db.select().from(bingoCards).where(eq(bingoCards.eventId,event.id));
 const [updated]=await db.update(bingoEvents).set({draws,pendingNumber:null,revealAt:null,summary:summarize(cards,draws),version:event.version+1}).where(eq(bingoEvents.id,event.id)).returning();return updated!;
}
export async function createBingo(db:Db,input:{id:string;title:string;actorId:string;staff:boolean},now=new Date()){
 staffOnly(input.staff);if(!/^[0-9a-f-]{36}$/i.test(input.id)||!input.title.trim()||input.title.trim().length>80)throw new BingoError('イベント名は1〜80文字で入力してください。');
 try{return await db.transaction(async tx=>{
  const [old]=await tx.select().from(bingoEvents).where(eq(bingoEvents.id,input.id));if(old){if(old.hostId!==input.actorId)throw new BingoError('この操作は確認できません。');return old;}
  const [live]=await tx.select({id:bingoEvents.id}).from(bingoEvents).where(ne(bingoEvents.status,'closed'));if(live)throw new BingoError('進行中のイベントを終了してから作成してください。');
  const [event]=await tx.insert(bingoEvents).values({id:input.id,title:input.title.trim(),hostId:input.actorId,createdAt:now}).returning();
  await audit(tx,{actorId:input.actorId,action:'bingo.create',detail:{eventId:event!.id,title:event!.title},via:'web'});return event!;
 });}catch(e){if(e instanceof BingoError)throw e;const cause=(e as {cause?:{constraint?:string}}).cause;if(cause?.constraint==='bingo_one_live')throw new BingoError('すでに受付中のイベントがあります。画面を更新してください。');throw e;}
}
export async function joinBingo(db:Db,id:string,memberId:string,now=new Date()){
 return db.transaction(async tx=>{
  const event=await locked(tx,id);const [old]=await tx.select().from(bingoCards).where(and(eq(bingoCards.eventId,id),eq(bingoCards.memberId,memberId)));if(old)return old;
  if(event.status!=='waiting')throw new BingoError('参加受付は終了しました。');
  const [member]=await tx.select().from(members).where(eq(members.id,memberId));if(!member||member.leftAt||member.isBot)throw new BingoError('在籍中のメンバーだけが参加できます。');
  // 同じイベントで、ほかの人とまったく同じカードにならないようにする（もともと重なることはほぼないが、念のため作りなおす）
  const taken=new Set((await tx.select({numbers:bingoCards.numbers}).from(bingoCards).where(eq(bingoCards.eventId,id))).map(r=>r.numbers.join(',')));
  const numbers=uniqueBingoCard(taken);
  const [card]=await tx.insert(bingoCards).values({eventId:id,memberId,name:member.displayName,numbers,joinedAt:now}).returning();
  await tx.update(bingoEvents).set({version:event.version+1,summary:{...event.summary,participants:event.summary.participants+1}}).where(eq(bingoEvents.id,id));return card!;
 });
}
export async function controlBingo(db:Db,input:{id:string;actorId:string;staff:boolean;action:'start'|'draw'|'close';version:number;confirm?:boolean},now=new Date()){
 staffOnly(input.staff);
 return db.transaction(async tx=>{
  let event=await locked(tx,input.id);versionOf(event,input.version);event=await revealWithin(tx,event,now);
  if(input.action==='start'){
   if(event.status!=='waiting'||!event.summary.participants)throw new BingoError('参加者が集まってから開始してください。');
   [event]=await tx.update(bingoEvents).set({status:'active',version:event.version+1}).where(eq(bingoEvents.id,event.id)).returning() as [Event];
  }else if(input.action==='draw'){
   if(event.status!=='active'||event.pendingNumber!==null)throw new BingoError('抽選中、または抽選できない状態です。');
   // 公開と次の抽選は別の操作。古い画面や再送で連続抽選しない。
   if(event.version!==input.version)return event;
   const pool=Array.from({length:75},(_,i)=>i+1).filter(n=>!event.draws.includes(n));if(!pool.length)throw new BingoError('すべての番号を抽選しました。');
   [event]=await tx.update(bingoEvents).set({pendingNumber:pool[randomInt(pool.length)]!,revealAt:new Date(now.getTime()+3000),version:event.version+1}).where(eq(bingoEvents.id,event.id)).returning() as [Event];
  }else{
   if(!input.confirm)throw new BingoError('終了の確認を入れてください。');if(event.status==='closed')return event;
   if(event.pendingNumber!==null)throw new BingoError('抽選結果が出てから終了してください。');
   [event]=await tx.update(bingoEvents).set({status:'closed',closedAt:now,version:event.version+1}).where(eq(bingoEvents.id,event.id)).returning() as [Event];
  }
  await audit(tx,{actorId:input.actorId,action:'bingo.'+input.action,detail:{eventId:event.id,version:event.version},via:'web'});return event;
 });
}
export async function claimBingo(db:Db,id:string,memberId:string,now=new Date()){
 return db.transaction(async tx=>{
  const event=await revealWithin(tx,await locked(tx,id),now);const [card]=await tx.select().from(bingoCards).where(and(eq(bingoCards.eventId,id),eq(bingoCards.memberId,memberId)));
  if(!card||event.status==='waiting'||!bingoProgress(card.numbers,event.draws).lines)throw new BingoError('まだビンゴが成立していません。');
  if(card.claimedAt)return;
  await tx.update(bingoCards).set({claimedAt:now}).where(and(eq(bingoCards.eventId,id),eq(bingoCards.memberId,memberId)));
  const cards=await tx.select().from(bingoCards).where(eq(bingoCards.eventId,id));await tx.update(bingoEvents).set({summary:summarize(cards,event.draws),version:event.version+1}).where(eq(bingoEvents.id,id));
  await audit(tx,{actorId:memberId,action:'bingo.claim',detail:{eventId:id},via:'web'});
 });
}
export async function bingoState(db:Db,memberId:string,id?:string,now=new Date()){
 let [event]=id?await db.select().from(bingoEvents).where(eq(bingoEvents.id,id)):await db.select().from(bingoEvents).orderBy(sql`case when ${bingoEvents.status} <> 'closed' then 0 else 1 end`,desc(bingoEvents.createdAt),desc(bingoEvents.id)).limit(1);
 if(!event)return {serverTime:now.getTime(),event:null,card:null};
 if(event.pendingNumber!==null&&event.revealAt&&event.revealAt<=now)event=await db.transaction(async tx=>revealWithin(tx,await locked(tx,event!.id),now));
 const [card]=await db.select().from(bingoCards).where(and(eq(bingoCards.eventId,event.id),eq(bingoCards.memberId,memberId)));
 // 予約された番号、他人のカード、サーバー内部の操作情報は返さない。
 return {serverTime:now.getTime(),event:{id:event.id,title:event.title,status:event.status,draws:event.draws,revealAt:event.revealAt?.getTime()??null,version:event.version,summary:{...event.summary,winners:event.summary.winners.slice(0,100)},winnerCount:event.summary.winners.length,latestClaims:event.summary.winners.filter(w=>w.claimed).sort((a,b)=>(b.claimedAt??0)-(a.claimedAt??0)).slice(0,5)},card:card?{numbers:card.numbers,claimed:!!card.claimedAt,rank:event.summary.winners.find(w=>w.memberId===memberId)?.rank??null,...bingoProgress(card.numbers,event.draws)}:null};
}

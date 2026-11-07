import { randomInt, randomUUID, createHash } from 'node:crypto';
import { and, asc, desc, eq, isNull, isNotNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type {Db} from '../db/client.js';
import {eventLotteries as events,eventLotteryEntries as entries,eventLotteryDraws as draws,eventLotteryNotices as notices,members,coinTx,type EventPrize} from '../db/schema.js';
import {addCoins,spendWithin} from './economy.js';
import {isRestrictedAccount} from './staffAlts.js';
import {audit} from './audit.js';
export class EventLotteryError extends Error {}
const fail=(message:string):never=>{throw new EventLotteryError(message);};
const text=z.string().trim().min(1).max(100);
export const eventLotteryInput=z.object({name:text,fee:z.coerce.number().int().min(1).max(100000000),channelId:z.string().regex(/^\d{17,20}$/),resultChannelId:z.string().regex(/^\d{17,20}$/),prizes:z.array(z.object({name:text,count:z.coerce.number().int().min(1).max(10000),coins:z.coerce.number().int().min(0).max(100000000),item:z.string().trim().max(500)}).transform(p=>({...p,item:p.coins===0&&!p.item?p.name:p.item}))).min(1).max(50)});
/** 作成/編集で同じ入力条件と、日本語の項目名を使う。 */
function parseEventLotteryInput(input:unknown){
 const parsed=eventLotteryInput.safeParse(input);if(parsed.success)return parsed.data;
 const issue=parsed.error.issues[0]!,[field,index,part]=issue.path;
 const messages:Record<string,string>={name:'イベント名：1〜100文字で入力してください。',fee:'参加費：1〜100,000,000銭の整数で入力してください。',channelId:'受付チャンネルのID：17〜20桁の数字を入力してください。',resultChannelId:'結果発表チャンネルのID：17〜20桁の数字を入力してください。',prizes:'景品：名前を入れた景品を1種類以上用意してください（最大50種類）。'};
 if(field==='prizes'&&typeof index==='number'){
  const raw=input&&typeof input==='object'&&'prizes' in input?input.prizes:undefined;
  const prize=Array.isArray(raw)?raw[index]:undefined;
  const label=prize&&typeof prize.name==='string'&&prize.name.trim()?`景品「${Array.from(prize.name.trim()).slice(0,40).join('')}」`:'景品';
  const details:Record<string,string>={name:'名前は1〜100文字で入力してください。',count:'本数は1〜10,000の整数で入力してください。',coins:'賞金は0〜100,000,000銭の整数で入力してください。',item:'品物・受け渡し内容は500文字以内で入力してください。'};
  return fail(`${label}：${details[String(part)]??'入力を確認してください。'}`);
 }
 return fail(messages[String(field)]??'イベントの入力を確認してください。');
}
export async function createEventLottery(db:Db,input:unknown,actorId:string){
 const data=parseEventLotteryInput(input);
 return db.transaction(async tx=>{const id=randomUUID();await tx.insert(events).values({...data,id,createdBy:actorId,prizes:data.prizes.map(p=>({...p,id:randomUUID()}))});await audit(tx,{actorId,action:'event_lottery.create',via:'web',detail:{eventId:id}});return id;});
}
export async function eventLotteryView(db:Db,id:string){
 const [event]=await db.select().from(events).where(eq(events.id,id));if(!event)return fail('イベントがありません。');
 const participants=await db.select().from(entries).where(eq(entries.eventId,id)).orderBy(asc(entries.createdAt),asc(entries.memberId));
 const results=await db.select().from(draws).where(eq(draws.eventId,id)).orderBy(asc(draws.createdAt),asc(draws.id));
 const messages=await db.select().from(notices).where(eq(notices.eventId,id));
 return {event,participants,results,messages,collected:participants.reduce((n,p)=>n+p.paid,0),refunded:participants.filter(p=>p.refunded).reduce((n,p)=>n+p.paid,0)};
}
export async function listEventLotteries(db:Db){return db.select().from(events).orderBy(desc(events.createdAt));}
async function lock(db:Db,id:string){const [event]=await db.select().from(events).where(eq(events.id,id)).for('update');return event??fail('イベントがありません。');}
function panel(e:typeof events.$inferSelect){const body={content:`🎟 ${e.name}\n参加費：${e.fee.toLocaleString('ja-JP')}銭（1人1口・1人1当選）\n受付終了後、運営が景品ごとに当選者を引きます。落選時の返金はありません。\n景品：${e.prizes.map(p=>`${p.name}×${p.count}（${p.coins}銭${p.item?'＋'+p.item:''}）`).join(' / ')}`,components:[{type:1,components:[{type:2,style:3,label:`参加する（${e.fee}銭）`,custom_id:`eventlottery:${e.id}`}]}],allowed_mentions:{parse:[]}};if(body.content.length>1900)return fail('景品の案内が長すぎます。全員が全文を確認できるよう、イベント名・景品名・受け渡し内容を短くしてください（案内は1900文字まで）。');return body;}
export async function enterEventLottery(db:Db,id:string,memberId:string,displayName:string){return db.transaction(async tx=>{
 const e=await lock(tx,id);const [old]=await tx.select().from(entries).where(and(eq(entries.eventId,id),eq(entries.memberId,memberId)));if(old)return '参加済みです。追加の支払いはありません。';
 if(e.state!=='open')return fail('このイベントは受付中ではありません。');
 const [m]=await tx.select().from(members).where(eq(members.id,memberId));if(!m||m.leftAt||m.isBot||await isRestrictedAccount(tx,memberId))return fail('参加できる在籍アカウントではありません。');
 if(!await spendWithin(tx,memberId,e.fee,'event_entry',{eventId:id}))return fail('銭が足りません。');
 await tx.insert(entries).values({eventId:id,memberId,displayName:displayName.slice(0,100),paid:e.fee});await audit(tx,{actorId:memberId,action:'event_lottery.enter',via:'discord',detail:{eventId:id,fee:e.fee}});return `${e.fee}銭を支払い、参加を受け付けました。`;
});}
export async function changeEventLottery(db:Db,id:string,actorId:string,version:number,action:string){return db.transaction(async tx=>{
 const e=await lock(tx,id);if(e.version!==version)return fail('状態が更新されました。画面を読み直してください。');
 const results=await tx.select().from(draws).where(eq(draws.eventId,id));
 let state=e.state;
 if(action==='open'&&state==='draft'){
  state='open';await tx.insert(notices).values({id:`panel:${id}`,eventId:id,channelId:e.channelId,body:panel(e),dueAt:new Date()});
 }else if(action==='close'&&state==='open')state='closed';
 else if(action==='cancel'&&['draft','open','closed'].includes(state)&&!results.length){
  const ps=await tx.select().from(entries).where(and(eq(entries.eventId,id),eq(entries.refunded,false)));
  // サブアカへ変更済みの人を飛ばして返金済みにしない。
  for(const p of ps){if(await isRestrictedAccount(tx,p.memberId))return fail('返金先に制限アカウントがあります。アカウント設定を確認してください。');const refundId=randomUUID();await addCoins(tx,p.memberId,p.paid,'event_refund',{eventId:id,refundId});const [credited]=await tx.select({id:coinTx.id}).from(coinTx).where(and(eq(coinTx.memberId,p.memberId),eq(coinTx.reason,'event_refund'),eq(coinTx.amount,p.paid),sql`${coinTx.detail}->>'refundId' = ${refundId}`));if(!credited)return fail('返金を確認できませんでした。アカウント設定を確認してから、もう一度中止してください。');await tx.update(entries).set({refunded:true}).where(and(eq(entries.eventId,id),eq(entries.memberId,p.memberId)));}
  state='cancelled';
 }else if(action==='complete'&&state==='closed'){
  const ps=await tx.select().from(entries).where(eq(entries.eventId,id));const remaining=e.prizes.some(p=>results.filter(r=>r.prizeId===p.id).length<p.count);
  let eligible=false;for(const p of ps){const [m]=await tx.select().from(members).where(eq(members.id,p.memberId));if(!p.refunded&&!results.some(r=>r.memberId===p.memberId)&&m&&!m.leftAt&&!m.isBot&&!await isRestrictedAccount(tx,p.memberId))eligible=true;}if(remaining&&eligible)return fail('まだ抽選できる景品と参加者がいます。');state='completed';
 }else return fail('この操作は現在の状態ではできません。');
 if(['closed','cancelled','completed'].includes(state)){const body={content:`🎟 ${e.name}：${state==='closed'?'受付を締め切りました。':state==='cancelled'?'中止しました。参加費は全額返金済みです。':'抽選が完了しました。'}`,allowed_mentions:{parse:[]}};await tx.update(notices).set({body}).where(and(eq(notices.id,`panel:${id}`),isNull(notices.sentAt)));await tx.insert(notices).values({id:`state:${id}:${state}`,eventId:id,channelId:e.channelId,body,dueAt:new Date()});}
 await tx.update(events).set({state,version:e.version+1}).where(eq(events.id,id));await audit(tx,{actorId,action:`event_lottery.${action}`,via:'web',detail:{eventId:id}});
});}
export async function drawEventLottery(db:Db,id:string,prizeId:string,actorId:string,version:number,operationId:string,now=new Date(),rng=(n:number)=>randomInt(n)){
 if(!z.string().uuid().safeParse(operationId).success)return fail('操作IDが不正です。');
 return db.transaction(async tx=>{
 const e=await lock(tx,id);const [old]=await tx.select().from(draws).where(eq(draws.id,operationId));if(old){if(old.eventId!==id||old.prizeId!==prizeId)return fail('操作IDが別の抽選に使われています。');return old;}
 if(e.state!=='closed'||e.version!==version)return fail('受付終了後の最新画面から抽選してください。');
 const prize=e.prizes.find(p=>p.id===prizeId)??fail('景品がありません。');
 const previous=await tx.select().from(draws).where(eq(draws.eventId,id));if(previous.some(r=>r.createdAt.getTime()+3000>now.getTime()))return fail('前の抽選の発表を待ってください。');if(previous.filter(r=>r.prizeId===prizeId).length>=prize.count)return fail('この景品は残っていません。');
 const people=await tx.select().from(entries).where(and(eq(entries.eventId,id),eq(entries.refunded,false))).orderBy(asc(entries.memberId));
 const eligible=[];for(const p of people){const [m]=await tx.select().from(members).where(eq(members.id,p.memberId));if(!previous.some(r=>r.memberId===p.memberId)&&m&&!m.leftAt&&!m.isBot&&!await isRestrictedAccount(tx,p.memberId))eligible.push(p);}
 if(!eligible.length)return fail('抽選対象者がいません。');const p=eligible[rng(eligible.length)]!;
 const [result]=await tx.insert(draws).values({id:operationId,eventId:id,memberId:p.memberId,displayName:p.displayName,prizeId,prizeName:prize.name,coins:prize.coins,item:prize.item,actorId,createdAt:now}).returning();
 if(prize.coins){await addCoins(tx,p.memberId,prize.coins,'event_prize',{eventId:id,drawId:operationId,by:actorId});if(await isRestrictedAccount(tx,p.memberId))return fail('当選者のアカウント状態が変わりました。画面を更新してください。');}
 await tx.insert(notices).values({id:operationId,eventId:id,channelId:e.resultChannelId,dueAt:new Date(now.getTime()+3000),body:{content:`🎉 ${e.name}\n${prize.name}：${p.displayName} さん（<@${p.memberId}>）\n${prize.coins.toLocaleString('ja-JP')}銭${prize.item?' / '+prize.item:''}`,allowed_mentions:{parse:[]}}});
 await tx.update(events).set({version:e.version+1}).where(eq(events.id,id));await audit(tx,{actorId,targetId:p.memberId,action:'event_lottery.draw',via:'web',detail:{eventId:id,drawId:operationId,prizeId}});return result!;
 });
}
export async function markEventDelivered(db:Db,eventId:string,drawId:string,actorId:string){await db.transaction(async tx=>{await lock(tx,eventId);const [d]=await tx.select().from(draws).where(and(eq(draws.id,drawId),eq(draws.eventId,eventId))).for('update');if(!d||!d.item)return fail('受け渡し対象がありません。');if(d.delivered)return;await tx.update(draws).set({delivered:true}).where(eq(draws.id,drawId));await audit(tx,{actorId,action:'event_lottery.deliver',via:'web',detail:{eventId,drawId}});});}
/** 失敗しても賞金や抽選は再実行せず、通知だけを再送する。送信中は同じ行を他workerが取らない。 */
export async function sendEventLotteryNotices(db:Db,send:(channelId:string,body:Record<string,unknown>)=>Promise<{id:string}>,now=new Date()){
 for(let i=0;i<20;i++){
  const found=await db.transaction(async tx=>{const [n]=await tx.select().from(notices).where(and(isNull(notices.sentAt),lte(notices.dueAt,now))).orderBy(asc(notices.dueAt)).limit(1).for('update',{skipLocked:true});if(!n)return false;
   try{const nonce=BigInt('0x'+createHash('sha256').update(n.id).digest('hex').slice(0,16)).toString();const m=await send(n.channelId,{...n.body,nonce,enforce_nonce:true});await tx.update(notices).set({sentAt:now,messageId:m.id,attempts:n.attempts+1,error:null}).where(eq(notices.id,n.id));}
   catch{await tx.update(notices).set({attempts:n.attempts+1,error:'Discordへの送信に失敗しました。',dueAt:new Date(now.getTime()+60000)}).where(eq(notices.id,n.id));}return true;});if(!found)break;
 }
}
export async function retryEventLotteryNotices(db:Db,eventId:string,actorId:string){await db.transaction(async tx=>{await lock(tx,eventId);await tx.update(notices).set({dueAt:new Date()}).where(and(eq(notices.eventId,eventId),isNull(notices.sentAt),isNotNull(notices.error)));await audit(tx,{actorId,action:'event_lottery.retry',via:'web',detail:{eventId}});});}
export async function editEventLottery(db:Db,id:string,input:unknown,actorId:string,version:number){const data=parseEventLotteryInput(input);await db.transaction(async tx=>{const e=await lock(tx,id);if(e.state!=='draft'||e.version!==version)return fail('準備中の最新画面でだけ変更できます。');await tx.update(events).set({...data,prizes:data.prizes.map(p=>({...p,id:randomUUID()})),version:e.version+1}).where(eq(events.id,id));await audit(tx,{actorId,action:'event_lottery.edit',via:'web',detail:{eventId:id}});});}

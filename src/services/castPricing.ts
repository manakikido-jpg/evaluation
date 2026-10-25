import { randomUUID } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { castChargeQuotes, type CastChargeQuote, type CastSession } from '../db/schema.js';
import { castPriceLock, extensionPriceOf, extendSession, getCast, getSession, isFreeMenu, menuOf, pickOptions, planMinutes, requestSession, validPrice, validQuote, type CastConfig, type CastPriceLock } from './cast.js';
import { audit } from './audit.js';
import { walletOf } from './economy.js';
export type ChargeRequest = { castId:string;plan:string;startAt?:string;quote?:{minutes:number;price:number;delivery?:boolean};options?:string[];threadId?:string;groupKey?:string };
export type ChargePayload = { route:'go'|'reserve'|'delivery'|'consult-delivery'|'group'|'extend';requests:ChargeRequest[];wish?:string;sessionId?:number;expectedExtensions?:number;originalId?:string;drawn?:Record<number,string> };
export class CastPricingError extends Error {}
export type PaidCastCharge = { quote:CastChargeQuote;payload:ChargePayload;sessions:CastSession[];fresh:boolean;balance:number };
export async function requestPrice(db:Db,c:CastConfig,r:ChargeRequest,now:Date):Promise<CastPriceLock>{
 const cast=await getCast(db,r.castId);if(!cast||cast.status!=='active')throw new CastPricingError('キャストを確認できません。メニューを開き直してください。');
 const found=menuOf(cast).find(m=>m.id===r.plan),q=r.quote;
 const valid=q&&(q.delivery?q.minutes===0&&validPrice(c,q.price):validQuote(c,q.minutes,q.price));
 const item=found?.consult?(valid?{...found,minutes:q!.minutes,price:q!.price,delivery:!!q!.delivery}:undefined):q?undefined:found;
 if(!item||item.price<=0)throw new CastPricingError('メニューや相談の料金を確認できません。開き直してください。');
 const opts=pickOptions(cast,r.options);
 if(r.options&&opts.length!==new Set(r.options).size)throw new CastPricingError('オプションが変わりました。選び直してください。');
 if(item.delivery&&(r.startAt||opts.length))throw new CastPricingError('納品には日時や通話オプションを付けられません。');
 const at=r.startAt?new Date(r.startAt):now;
 if(!Number.isFinite(at.getTime()))throw new CastPricingError('開始時刻を確認してください。');
 const minutes=item.delivery?0:item.night?planMinutes('night',at):isFreeMenu(item)?0:item.minutes;
 const baseExtension=minutes>0?(cast.menu.length?Math.ceil(item.price*30/minutes):cast.price30||Math.ceil(item.price*30/minutes)):0;
 return castPriceLock(c,item.price+opts.reduce((n,o)=>n+o.price,0),baseExtension,at);
}
export async function prepareCastCharge(db:Db,c:CastConfig,actorId:string,payload:ChargePayload,now=new Date(),actionKey?:string):Promise<CastChargeQuote>{
 const prices:CastPriceLock[]=[];
 if(payload.route==='extend'){
  const s=await getSession(db,payload.sessionId??0);
  if(!s||s.customerId!==actorId||s.status!=='active'||!s.endsAt||s.endsAt<=now||s.extensions!==payload.expectedExtensions||s.plan.startsWith('free:'))throw new CastPricingError('この指名は延長できません。最新のボタンを確認してください。');
  const base=s.baseExtensionPrice??extensionPriceOf(s);
  prices.push(castPriceLock(c,base,0,s.endsAt));
 }else{
  if(!payload.requests.length||payload.requests.length>3||new Set(payload.requests.map(r=>r.castId)).size!==payload.requests.length)throw new CastPricingError('予約するキャストを確認してください。');
  for(const r of payload.requests)prices.push(await requestPrice(db,c,r,now));
 }
 const [row]=await db.insert(castChargeQuotes).values({id:randomUUID(),actorId,actionKey,kind:payload.route,payload:payload as unknown as Record<string,unknown>,prices,createdAt:now,expiresAt:new Date(now.getTime()+5*60000)}).onConflictDoNothing().returning();
 if(row)return row;
 const [old]=await db.select().from(castChargeQuotes).where(eq(castChargeQuotes.actionKey,actionKey!));
 if(!old||old.actorId!==actorId)throw new CastPricingError('この料金確認は使えません。');
 return old;
}
export async function confirmCastCharge(db:Db,c:CastConfig,id:string,actorId:string,adult:boolean,now=new Date()):Promise<PaidCastCharge>{
 return db.transaction(async tx=>{
  const [quote]=await tx.select().from(castChargeQuotes).where(eq(castChargeQuotes.id,id)).for('update');
  if(!quote||quote.actorId!==actorId)throw new CastPricingError('この料金確認は本人だけが使えます。');
  const payload=quote.payload as unknown as ChargePayload;
  if(quote.consumedAt){const sessions=await Promise.all(quote.sessionIds.map(id=>getSession(tx,id)));return {quote,payload,sessions:sessions.filter((s):s is CastSession=>!!s),fresh:false,balance:(await walletOf(tx,actorId)).balance};}
  if(quote.expiresAt<=now)throw new CastPricingError('料金確認の5分間が過ぎました。メニューから確認し直してください。');
  const sessions:CastSession[]=[];
  if(payload.route==='extend'){
   const r=await extendSession(tx,payload.sessionId!,actorId,now,payload.expectedExtensions,quote.prices[0]);
   if(r.status!=='ok')throw new CastPricingError(r.status==='insufficient'?'銭が足りません。支払いはしていません。':r.status==='overlap'?'次の予約と重なるので延長できません。':'この延長は確定できません。最新のボタンを確認してください。');
   sessions.push(r.session);
  }else{
   // 複数指名は全員を同じ取引で確定。1人でも失敗すれば課金も予約も戻す。
   for(const {r,i} of payload.requests.map((r,i)=>({r,i})).sort((a,b)=>a.r.castId.localeCompare(b.r.castId))){
    const locked=quote.prices[i];if(!locked)throw new CastPricingError('料金を確認できません。');
    const result=await requestSession(tx,c,{...r,customerId:actorId,customerAdult:adult,...(r.startAt?{startAt:new Date(r.startAt)}:{startAt:undefined}),priceLock:locked},now);
    if(result.status!=='ok')throw new CastPricingError(result.status==='insufficient'?'銭が足りません。支払いはしていません。':'予約・注文を確定できません（'+result.status+'）。メニューと空き時間を確認してください。');
    sessions.push(result.session);
    if(result.drawn)payload.drawn={...payload.drawn,[result.session.id]:result.drawn};
   }
  }
  const [saved]=await tx.update(castChargeQuotes).set({consumedAt:now,sessionIds:sessions.map(s=>s.id),payload:payload as unknown as Record<string,unknown>}).where(eq(castChargeQuotes.id,id)).returning();
  await audit(tx,{actorId,action:'cast.price_confirm',detail:{quoteId:id,prices:quote.prices,sessions:sessions.map(s=>s.id)},via:'discord'});
  return {quote:saved!,payload,sessions,fresh:true,balance:(await walletOf(tx,actorId)).balance};
 });
}
export const pruneCastChargeQuotes=(db:Db,now=new Date())=>db.delete(castChargeQuotes).where(lt(castChargeQuotes.expiresAt,new Date(now.getTime()-7*86400000)));

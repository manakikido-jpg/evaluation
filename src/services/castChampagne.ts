import { randomUUID } from 'node:crypto';
import { and, desc, eq, gt, isNotNull, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { castChampagnes, castSessions, type CastSession, type CastChampagne } from '../db/schema.js';
import { castFee, castPriceLock, type CastConfig } from './cast.js';
import { audit } from './audit.js';
import { addCoins, spendWithin, walletOf } from './economy.js';

/** シャンパンは通話料金とは別に、運営30％・キャスト70％。 */
export const CHAMPAGNE_FEE_PERCENT = 30;
export const CHAMPAGNES = [
 { id:'sakura', name:'桜のしずく', emoji:'🌸', price:500, color:'#eaa3b9', tier:1 },
 { id:'moon', name:'月夜の泡', emoji:'🌙', price:1000, color:'#b4b9e8', tier:2 },
 { id:'silver', name:'白銀のきらめき', emoji:'💎', price:3000, color:'#c7e8ee', tier:3 },
 { id:'rose', name:'咲楽ロゼ', emoji:'👑', price:5000, color:'#ed95b4', tier:4 },
 { id:'yozakura', name:'宵桜の祝杯', emoji:'🥂', price:10000, color:'#eed28c', tier:5 },
] as const;
export const champagneOf = (id:string) => CHAMPAGNES.find(b=>b.id===id);
export class ChampagneError extends Error {}
export const champagneError = (err:unknown) => err instanceof ChampagneError ? err.message : '処理結果を確認できません。もう一度同じ確認ボタンから確認してください。';
function fail(s:string):never {throw new ChampagneError(s);}
type Party = { customerId:string; channelId:string };
export type ChampagnePresence = (s:CastSession) => boolean;
export function assertChampagneActive(s:CastSession|undefined,party:Party,here:ChampagnePresence,now:Date):asserts s is CastSession {
 if(!s || s.customerId!==party.customerId || s.castId===party.customerId || s.channelId!==party.channelId)fail('指名したお客だけが、その通話の部屋から贈れます。');
 if(s.status!=='active'||!s.startedAt||s.startedAt>now||!s.endsAt||s.endsAt<=now)fail('キャストとの通話中だけ贈れます。');
 if(!here(s))fail('お客とキャストが、両方その通話の部屋にいるときに贈れます。');
}
/** 確認時の価格と配分を5分間保存する。ブラウザやボタンの値段は受け取らない。 */
export async function prepareChampagne(db:Db,sessionId:number,bottleId:string,party:Party,here:ChampagnePresence,clock=()=>new Date(),pricing?:CastConfig) {
 const bottle=champagneOf(bottleId);if(!bottle)fail('ボトルを選び直してください。');
 return db.transaction(async tx=>{
  const [s]=await tx.select().from(castSessions).where(eq(castSessions.id,sessionId)).for('update');
  const now=clock();assertChampagneActive(s,party,here,now);
  const [pending]=await tx.select().from(castChampagnes).where(and(eq(castChampagnes.sessionId,sessionId),eq(castChampagnes.bottle,bottle.id),isNull(castChampagnes.paidAt),gt(castChampagnes.expiresAt,now)));
  if(pending)return pending;
  const price=pricing?castPriceLock(pricing,bottle.price,0,now).price:bottle.price;
  const [quote]=await tx.insert(castChampagnes).values({id:randomUUID(),sessionId,customerId:s.customerId,castId:s.castId,channelId:party.channelId,bottle:bottle.id,bottleName:bottle.name,price,fee:castFee({feePercent:CHAMPAGNE_FEE_PERCENT},price),createdAt:now,expiresAt:new Date(now.getTime()+5*60000)}).returning();
  return quote!;
 });
}
/** 支払・キャストへの入金・購入確定を同じトランザクションで1回だけ行う。 */
export async function buyChampagne(db:Db,id:string,party:Party,here:ChampagnePresence,clock=()=>new Date()) {
 return db.transaction(async tx=>{
  const [q]=await tx.select().from(castChampagnes).where(eq(castChampagnes.id,id)).for('update');
  if(!q||q.customerId!==party.customerId||q.channelId!==party.channelId)fail('この確認は使えません。ボトルを選び直してください。');
  if(q.paidAt)return {purchase:q,fresh:false,balance:(await walletOf(tx,party.customerId)).balance};
  const [s]=await tx.select().from(castSessions).where(eq(castSessions.id,q.sessionId)).for('update');
  const now=clock();assertChampagneActive(s,party,here,now);
  if(s.castId!==q.castId)fail('予約の相手を確認できません。選び直してください。');
  if(q.expiresAt<=now)fail('確認の期限が切れました。ボトルを選び直してください。');
  if(!await spendWithin(tx,q.customerId,q.price,'champagne_pay',{purchaseId:q.id,sessionId:q.sessionId,to:q.castId,fee:q.fee}))fail('銭が足りません。購入していません。');
  if(q.price-q.fee>0)await addCoins(tx,q.castId,q.price-q.fee,'champagne_reward',{purchaseId:q.id,sessionId:q.sessionId,from:q.customerId,fee:q.fee});
  const [purchase]=await tx.update(castChampagnes).set({paidAt:now}).where(eq(castChampagnes.id,id)).returning();
  await audit(tx,{actorId:q.customerId,targetId:q.castId,action:'cast.champagne.buy',detail:{purchaseId:q.id,sessionId:q.sessionId,bottle:q.bottle,price:q.price,fee:q.fee,paid:q.price-q.fee},via:'discord'});
  return {purchase:purchase!,fresh:true,balance:(await walletOf(tx,party.customerId)).balance};
 });
}
/** 表示の再試行は追加購入にしない。同時実行を直列化し、Discordのnonceも利用する。 */
export async function announceChampagne(db:Db,id:string,customerId:string,send:(q:CastChampagne)=>Promise<string>) {
 return db.transaction(async tx=>{
  const [q]=await tx.select().from(castChampagnes).where(eq(castChampagnes.id,id)).for('update');
  if(!q||q.customerId!==customerId||!q.paidAt)fail('購入が確認できません。');
  if(q.noticeId)return q.noticeId;
  const noticeId=await send(q);
  await tx.update(castChampagnes).set({noticeId}).where(eq(castChampagnes.id,id));
  return noticeId;
 });
}

/** 🍾 買われたシャンパン（新しい順。社務所Web の一覧） */
export const paidChampagnes = (db:Db,limit=100) => db.select().from(castChampagnes).where(isNotNull(castChampagnes.paidAt)).orderBy(desc(castChampagnes.paidAt)).limit(limit);

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { and, asc, eq, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import type { GuildConfig } from '../config.js';
import { marketBids, marketListingImages, marketListings, marketOffers, marketOrders, marketRequests, marketWebActions, members, type MarketWebAction } from '../db/schema.js';
import * as market from './market.js';
import { audit } from './audit.js';
export class MarketWebError extends Error {}
const ERROR: Record<string,string> = { no_license:'出品・引き受けには開業権利が必要です。', adult_only:'通話は18歳以上どうしだけ利用できます。', invalid:'入力内容を確認してください。', disabled:'市場の設定を確認できません。', insufficient:'購入者の銭が足りません。', full:'受付の上限に達しています。', self:'自分自身との取引はできません。', not_open:'受付を終えています。', offer_only:'この出品は価格の提案から購入してください。', not_offer:'この出品は固定価格です。', too_low:'最低価格以上を提案してください。', too_many:'同時に募集中の依頼は3件までです。', gone:'この提案はもう使えません。', forbidden:'この操作は本人だけが行えます。', not_paid:'この取引は預かり中ではありません。', not_done:'取引完了後に評価できます。', already:'評価済みです。', too_early:'予定時刻の10分後から報告できます。', not_call:'通話の取引だけが対象です。' };
function ok<T extends {status:string}>(r:T): Extract<T,{status:'ok'}> { if(r.status!=='ok')throw new MarketWebError(ERROR[r.status] ?? 'この操作はできません。');return r as Extract<T,{status:'ok'}>; }
function requireRow<T>(value:T|undefined):T {if(!value)throw new MarketWebError('対象が見つからないか、状態が変わりました。');return value;}
const num=(v:string|undefined)=>v!==undefined&&v!==''?Number(v):NaN;
export type MarketActor={id:string;roleIds:readonly string[]};
export type MarketPayload=Record<string,string>;
export async function executeMarketWeb(db:Db,cfg:GuildConfig,actor:MarketActor,action:string,id:number,b:MarketPayload,now=new Date(),image?:{type:string;data:Uint8Array}):Promise<string>{
 if(!z.string().uuid().safeParse(b.nonce).success)throw new MarketWebError('画面を開き直してから操作してください。');
 const hash=createHash('sha256').update(JSON.stringify(Object.entries(b).filter(([k])=>k!=='_csrf'&&k!=='nonce').sort(([a],[c])=>a.localeCompare(c)))).digest('hex');
 const key=`${action}:${id}`;
 return db.transaction(async tx=>{
  const inserted=await tx.insert(marketWebActions).values({id:b.nonce!,memberId:actor.id,action:key,payloadHash:hash,createdAt:now}).onConflictDoNothing().returning();
  if(!inserted.length){const [old]=await tx.select().from(marketWebActions).where(eq(marketWebActions.id,b.nonce!));if(old?.memberId!==actor.id||old.action!==key||old.payloadHash!==hash||!old.resultPath)throw new MarketWebError('この操作確認は使えません。画面を開き直してください。');return old.resultPath;}
  const [member]=await tx.select().from(members).where(eq(members.id,actor.id));
  if(!member||member.leftAt||member.isBot)throw new MarketWebError('在籍中のメンバーを確認できません。');
  const terms=(price:number)=>{if(b.confirm!=='yes'||num(b.quote)!==price||num(b.feePercent)!==cfg.market.feePercent||num(b.days)!==cfg.market.autoReleaseDays)throw new MarketWebError('金額や手数料・期限を確認し、画面を開き直してください。');};
  const adultPair=async(category:string,a:string,c:string)=>{if(a===c)throw new MarketWebError(ERROR.self);const rows=await tx.select().from(members).where(inArray(members.id,[a,c])).orderBy(asc(members.id)).for('update');if(rows.length!==2||rows.some(m=>m.leftAt||m.isBot))throw new MarketWebError('取引相手の在籍を確認できません。');if(category==='call'&&rows.some(m=>m.ageGroup!=='adult'))throw new MarketWebError(ERROR.adult_only);};
  let targetKind:MarketWebAction['targetKind']=null,targetId:number|null=null,path='/marketplace';
  const result=(kind:NonNullable<MarketWebAction['targetKind']>,value:number,href:string)=>{targetKind=kind;targetId=value;path=href;};
  if(action==='listing-new'){
   const r=ok(await market.createListing(tx,cfg,actor,{category:b.category??'',subcategory:b.subcategory,title:b.title??'',description:b.description??'',price:num(b.price),pricing:b.pricing==='offer'?'offer':'fixed',capacity:num(b.capacity??'0')}));
   // 📷 見本の写真は出品と同じまとまりで残す（Discord のカードを出すときに一緒に上げる）
   if(image)await tx.insert(marketListingImages).values({listingId:r.listing.id,contentType:image.type,data:image.data});
   result('listing',r.listing.id,`/marketplace/listings/${r.listing.id}`);
  }else if(action==='request-new'){
   await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'market-request-create:' + actor.id}))`);
   const r=ok(await market.createRequest(tx,actor.id,{category:b.category??'',subcategory:b.subcategory,title:b.title??'',description:b.description??'',budget:num(b.budget)}));
   result('request',r.request.id,`/marketplace/requests/${r.request.id}`);
  }else if(action.startsWith('listing-')){
   await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'market-listing:' + id}))`);
   const [l]=await tx.select().from(marketListings).where(eq(marketListings.id,id)).for('update');const listing=requireRow(l);
   if(action==='listing-buy'){terms(listing.price);await adultPair(listing.category,actor.id,listing.sellerId);const r=ok(await market.buyListing(tx,cfg,id,actor.id,now));result('order',r.order.id,`/marketplace/orders/${r.order.id}`);}
   else if(action==='listing-offer'){await adultPair(listing.category,actor.id,listing.sellerId);const r=ok(await market.makeOffer(tx,id,actor.id,num(b.amount),b.note??''));result('offer',r.offer.id,`/marketplace/listings/${id}`);}
   else{if(listing.sellerId!==actor.id)throw new MarketWebError(ERROR.forbidden);
    if(action==='listing-close'){requireRow(await market.closeListing(tx,id,'seller'));}
    else if(action==='listing-standby'){requireRow(await market.setStandby(tx,id,actor.id,b.on==='yes',now));}
    else throw new MarketWebError('操作を確認できません。');
    result('listing',id,`/marketplace/listings/${id}`);
   }
  }else if(action.startsWith('offer-')){
   const initial=requireRow(await market.getOffer(tx,id));
   await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'market-listing:' + initial.listingId}))`);
   await tx.select().from(marketListings).where(eq(marketListings.id,initial.listingId)).for('update');
   const [o]=await tx.select().from(marketOffers).where(eq(marketOffers.id,id)).for('update');const offer=requireRow(o);
   if(action==='offer-accept'){const listing=requireRow(await market.getListing(tx,offer.listingId));terms(offer.amount);await adultPair(listing.category,offer.buyerId,offer.sellerId);const accepted=await market.acceptOffer(tx,cfg,id,actor.id,now);if(accepted.status==='insufficient'){result('offer',id,'/marketplace/listings/'+offer.listingId+'?msg=offer_insufficient');}else{const r=ok(accepted);result('order',r.order.id,`/marketplace/orders/${r.order.id}`);}}
   else if(action==='offer-decline'){requireRow(await market.declineOffer(tx,id,actor.id));result('offer',id,`/marketplace/listings/${offer.listingId}`);}
   else throw new MarketWebError('操作を確認できません。');
  }else if(action.startsWith('request-')){
   const [r]=await tx.select().from(marketRequests).where(eq(marketRequests.id,id)).for('update');const request=requireRow(r);
   if(action==='request-bid'){await adultPair(request.category,actor.id,request.requesterId);const bid=ok(await market.bidRequest(tx,cfg,id,actor,num(b.amount),b.note??''));result('bid',bid.bid.id,`/marketplace/requests/${id}`);}
   else if(action==='request-close'){if(request.requesterId!==actor.id)throw new MarketWebError(ERROR.forbidden);requireRow(await market.closeRequest(tx,id));result('request',id,`/marketplace/requests/${id}`);}
   else throw new MarketWebError('操作を確認できません。');
  }else if(action==='bid-accept'){
   const initial=requireRow(await market.getBid(tx,id));
   await tx.select().from(marketRequests).where(eq(marketRequests.id,initial.requestId)).for('update');
   const [bidding]=await tx.select().from(marketBids).where(eq(marketBids.id,id)).for('update');const bid=requireRow(bidding),request=requireRow(await market.getRequest(tx,bid.requestId));
   terms(bid.amount);await adultPair(request.category,request.requesterId,bid.sellerId);const r=ok(await market.acceptBid(tx,cfg,id,actor.id,now));result('order',r.order.id,`/marketplace/orders/${r.order.id}`);
  }else if(action.startsWith('order-')){
   const [o]=await tx.select().from(marketOrders).where(eq(marketOrders.id,id)).for('update');const order=requireRow(o);
   if(order.buyerId!==actor.id&&order.sellerId!==actor.id)throw new MarketWebError(ERROR.forbidden);
   if(action==='order-receive'){if(order.buyerId!==actor.id||order.status!=='paid'||b.confirm!=='yes')throw new MarketWebError('預かり中の取引を、購入者本人が確認してください。');requireRow(await market.releaseOrder(tx,id,actor.id,now));}
   else if(action==='order-problem'){if(order.buyerId!==actor.id)throw new MarketWebError(ERROR.forbidden);requireRow(await market.disputeOrder(tx,id));}
   else if(action==='order-schedule'){const raw=b.at??'';const at=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)?new Date(raw+'+09:00'):undefined;if(!at||!Number.isFinite(at.getTime())||new Date(at.getTime()+9*3600000).toISOString().slice(0,16)!==raw||at<=now)throw new MarketWebError('これからの予定を日本時間で入れてください。');requireRow(await market.scheduleOrder(tx,id,actor.id,at));}
   else if(action==='order-noshow'){ok(await market.reportNoShow(tx,id,actor.id,now));}
   else if(action==='order-rate'){ok(await market.rateOrder(tx,id,actor.id,num(b.rating),b.review??'',now));}
   else throw new MarketWebError('操作を確認できません。');
   result('order',id,`/marketplace/orders/${id}`);
  }else throw new MarketWebError('操作を確認できません。');
  await tx.update(marketWebActions).set({targetKind,targetId,resultPath:path}).where(eq(marketWebActions.id,b.nonce!));
  await audit(tx,{actorId:actor.id,action:`market.web.${action}`,detail:{id:targetId},via:'web'});
  return path;
 });
}
export async function pendingMarketWebActions(db:Db,now=new Date()){
 return db.select().from(marketWebActions).where(and(isNotNull(marketWebActions.resultPath),or(eq(marketWebActions.syncStatus,'pending'),and(eq(marketWebActions.syncStatus,'running'),lt(marketWebActions.claimedAt,new Date(now.getTime()-600000)))))).orderBy(sql.raw('claimed_at nulls first'),asc(marketWebActions.createdAt)).limit(20);
}
export async function claimMarketWebAction(db:Db,id:string,now=new Date()){
 const [row]=await db.update(marketWebActions).set({syncStatus:'running',claimedAt:now}).where(and(eq(marketWebActions.id,id),or(eq(marketWebActions.syncStatus,'pending'),and(eq(marketWebActions.syncStatus,'running'),lt(marketWebActions.claimedAt,new Date(now.getTime()-600000)))))).returning();return row;
}
export async function finishMarketWebAction(db:Db,id:string,success:boolean){await db.update(marketWebActions).set({syncStatus:success?'done':'pending',claimedAt:success?null:new Date()}).where(eq(marketWebActions.id,id));}

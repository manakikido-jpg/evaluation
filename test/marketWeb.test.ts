import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { marketBids, marketListings, marketOrders, marketWebActions, members } from '../src/db/schema.js';
import { executeMarketWeb, claimMarketWebAction, finishMarketWebAction, pendingMarketWebActions } from '../src/services/marketWeb.js';
import { createListing, createRequest, bidRequest, makeOffer, getOffer, getOrder, autoReleaseOrders } from '../src/services/market.js';
import { addCoins, spendCoins, walletOf } from '../src/services/economy.js';
import { cfg as base, makeDb } from './helpers.js';
export const A='700000000000000001',B='700000000000000002',C='700000000000000003',ROLE='710000000000000001',CHANNEL='720000000000000001';
export const marketCfg={...base,channels:{...base.channels,market:CHANNEL},roles:{...base.roles,merchant:ROLE}};
const now=new Date('2026-10-25T12:00:00+09:00');
let db:Db,close:()=>Promise<void>;
beforeEach(async()=>{({db,close}=await makeDb());await db.insert(members).values([A,B,C].map(id=>({id,username:id,displayName:id,ageGroup:id===C?'minor':'adult'})));await addCoins(db,B,10000,'admin_grant');await addCoins(db,C,10000,'admin_grant');});
afterEach(async()=>close());
const terms={quote:'1000',feePercent:'10',days:'7',confirm:'yes'};
const run=(user:string,action:string,id:number,b:Record<string,string>={},nonce=randomUUID())=>executeMarketWeb(db,marketCfg,{id:user,roleIds:user===A?[ROLE]:[]},action,id,{nonce,...b},now);
async function listing(category='illust',pricing:'fixed'|'offer'='fixed',capacity=0){const r=await createListing(db,marketCfg,{id:A,roleIds:[ROLE]},{category,title:'見本の出品',description:'説明',price:1000,pricing,capacity});if(r.status!=='ok')throw new Error(r.status);return r.listing;}
it('Web出品も開業権利と入力条件を守り、再送しても1件。確認番号の他人利用・別内容を拒否',async()=>{
 const nonce=randomUUID(),b={category:'illust',title:'イラストを描きます',description:'見本',price:'1000',pricing:'fixed',capacity:'2'};
 await expect(run(B,'listing-new',0,b)).rejects.toThrow('開業権利');
 const path=await run(A,'listing-new',0,b,nonce);expect(await run(A,'listing-new',0,b,nonce)).toBe(path);
 expect(await db.select().from(marketListings)).toHaveLength(1);
 await expect(run(B,'listing-new',0,b,nonce)).rejects.toThrow('確認');
 await expect(run(A,'listing-new',0,{...b,price:'1'},nonce)).rejects.toThrow('確認');
});
it('同じ購入確認の連打は1回だけ預かり、別の確認なら別注文。容量・自己購入も共通',async()=>{
 const l=await listing('illust','fixed',1),nonce=randomUUID();
 const paths=await Promise.all([run(B,'listing-buy',l.id,terms,nonce),run(B,'listing-buy',l.id,terms,nonce)]);
 expect(paths[0]).toBe(paths[1]);expect((await walletOf(db,B)).balance).toBe(9000);expect(await db.select().from(marketOrders)).toHaveLength(1);
 await expect(run(C,'listing-buy',l.id,terms)).rejects.toThrow('上限');
 await expect(run(A,'listing-buy',l.id,terms)).rejects.toThrow('自分');
});
it('表示後の値段・手数料・期限の変更と未確認を拒否し、失敗した確認は消費しない',async()=>{
 const l=await listing(),nonce=randomUUID();
 await expect(run(B,'listing-buy',l.id,{...terms,quote:'1'},nonce)).rejects.toThrow('金額');
 expect(await db.select().from(marketWebActions)).toHaveLength(0);
 await expect(run(B,'listing-buy',l.id,{...terms,confirm:''})).rejects.toThrow('確認');
 await expect(run(B,'listing-buy',l.id,{...terms,days:'60'})).rejects.toThrow('確認');
 await run(B,'listing-buy',l.id,terms,nonce);expect((await walletOf(db,B)).balance).toBe(9000);
});
it('通話の購入は18歳以上どうしだけ。提案後に年齢が変わっても承諾で再確認する',async()=>{
 const call=await listing('call','offer');
 await expect(run(C,'listing-offer',call.id,{amount:'1000'})).rejects.toThrow('18歳');
 const offer=await makeOffer(db,call.id,B,1000,'相談');if(offer.status!=='ok')throw new Error(offer.status);
 await db.update(members).set({ageGroup:'unknown'}).where(eq(members.id,B));
 await expect(run(A,'offer-accept',offer.offer.id,terms)).rejects.toThrow('18歳');
 expect((await walletOf(db,B)).balance).toBe(10000);
});
it('価格提案の承諾で購入者の銭を1回だけ預かり、他人の承諾を拒否する',async()=>{
 const l=await listing('illust','offer'),offer=await makeOffer(db,l.id,B,1000,'非公開の提案');if(offer.status!=='ok')throw new Error(offer.status);
 await expect(run(C,'offer-accept',offer.offer.id,terms)).rejects.toThrow();
 const nonce=randomUUID();const path=await run(A,'offer-accept',offer.offer.id,terms,nonce);
 expect(await run(A,'offer-accept',offer.offer.id,terms,nonce)).toBe(path);
 expect((await walletOf(db,B)).balance).toBe(9000);expect(await db.select().from(marketOrders)).toHaveLength(1);
});
it('依頼作成・応募・選定も共通の開業権利と予算確認を使い、同時の募集を3件に抑える',async()=>{
 const input={category:'craft',title:'作ってほしいもの',description:'説明',budget:'1000'};
 const results=await Promise.allSettled(Array.from({length:4},()=>run(B,'request-new',0,input)));
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(3);
 const request=await createRequest(db,C,{category:'illust',title:'依頼',description:'説明',budget:1000});if(request.status!=='ok')throw new Error(request.status);
 await expect(run(B,'request-bid',request.request.id,{amount:'1000'})).rejects.toThrow('開業権利');
 await run(A,'request-bid',request.request.id,{amount:'1000',note:'できます'});
 const [bid]=await db.select().from(marketBids).where(eq(marketBids.requestId,request.request.id));
 await expect(run(B,'bid-accept',bid!.id,terms)).rejects.toThrow();
 const path=await run(C,'bid-accept',bid!.id,terms);expect(path).toContain('/orders/');expect((await walletOf(db,C)).balance).toBe(9000);
});
it('受け取りは購入者だけ。問題報告後はWeb受け取りと期限の自動払いを止める',async()=>{
 const l=await listing();const path=await run(B,'listing-buy',l.id,terms);const id=Number(path.split('/').at(-1));
 await expect(run(A,'order-receive',id,{confirm:'yes'})).rejects.toThrow('購入者');
 await expect(run(C,'order-problem',id)).rejects.toThrow('本人');
 await run(B,'order-problem',id);
 await expect(run(B,'order-receive',id,{confirm:'yes'})).rejects.toThrow('預かり中');
 expect(await autoReleaseOrders(db,new Date(now.getTime()+10*86400000))).toHaveLength(0);
 expect((await walletOf(db,A)).balance).toBe(0);expect((await getOrder(db,id))?.status).toBe('disputed');
});
it('受け取りで手数料を引いて売り手へ渡し、評価は購入者が1回だけ',async()=>{
 const l=await listing();const path=await run(B,'listing-buy',l.id,terms);const id=Number(path.split('/').at(-1));
 const nonce=randomUUID();await run(B,'order-receive',id,{confirm:'yes'},nonce);await run(B,'order-receive',id,{confirm:'yes'},nonce);
 expect((await walletOf(db,A)).balance).toBe(900);
 await expect(run(A,'order-rate',id,{rating:'5'})).rejects.toThrow();
 await run(B,'order-rate',id,{rating:'5',review:'ありがとう'});
 await expect(run(B,'order-rate',id,{rating:'1'})).rejects.toThrow('評価済み');
});
it('通話予定を日本時間で保存し、不正な日時・他人の変更と早すぎる欠席報告を拒否',async()=>{
 const l=await listing('call');const path=await run(B,'listing-buy',l.id,terms);const id=Number(path.split('/').at(-1));
 await expect(run(C,'order-schedule',id,{at:'2026-10-26T20:00'})).rejects.toThrow('本人');
 await expect(run(B,'order-schedule',id,{at:'2026-02-31T20:00'})).rejects.toThrow('日本時間');
 await run(A,'order-schedule',id,{at:'2026-10-26T20:00'});
 expect((await getOrder(db,id))?.scheduledAt?.toISOString()).toBe('2026-10-26T11:00:00.000Z');
 await expect(run(B,'order-noshow',id)).rejects.toThrow('10分');
});
it('在籍を確認できない相手には購入せず、出品終了は本人だけ',async()=>{
 const l=await listing();await db.update(members).set({leftAt:now}).where(eq(members.id,A));
 await expect(run(B,'listing-buy',l.id,terms)).rejects.toThrow('在籍');expect((await walletOf(db,B)).balance).toBe(10000);
 await expect(run(B,'listing-close',l.id)).rejects.toThrow('本人');
});
it('支払い途中のエラーは注文・財布・Web確認番号も全部戻す',async()=>{
 const l=await listing();await db.execute(sql.raw("ALTER TABLE market_orders ADD CONSTRAINT web_test_fail CHECK (price <> 1000)"));
 await expect(run(B,'listing-buy',l.id,terms)).rejects.toThrow();
 expect((await walletOf(db,B)).balance).toBe(10000);expect(await db.select().from(marketOrders)).toHaveLength(0);expect(await db.select().from(marketWebActions)).toHaveLength(0);
});
it('Discord同期は1つのworkerだけが確保し、失敗と再起動後のリース切れを再試行できる',async()=>{
 const l=await listing();await run(B,'listing-buy',l.id,terms);const [job]=await pendingMarketWebActions(db,now);expect(job).toBeDefined();
 const claims=await Promise.all([claimMarketWebAction(db,job!.id,now),claimMarketWebAction(db,job!.id,now)]);expect(claims.filter(Boolean)).toHaveLength(1);
 expect(await pendingMarketWebActions(db,now)).toHaveLength(0);
 expect(await pendingMarketWebActions(db,new Date(now.getTime()+600001))).toHaveLength(1);
 await finishMarketWebAction(db,job!.id,false);expect(await pendingMarketWebActions(db,now)).toHaveLength(1);
 await finishMarketWebAction(db,job!.id,true);expect(await pendingMarketWebActions(db,now)).toHaveLength(0);
});

it('価格提案の承諾時に購入者が残高不足なら、共通サービスどおり見送り状態を保存する',async()=>{
 const l=await listing('illust','offer'),offer=await makeOffer(db,l.id,B,1000,'相談');if(offer.status!=='ok')throw new Error(offer.status);
 await spendCoins(db,B,10000,'admin_take');
 const nonce=randomUUID(),path=await run(A,'offer-accept',offer.offer.id,terms,nonce);
 expect(path).toContain('offer_insufficient');expect((await getOffer(db,offer.offer.id))?.status).toBe('declined');
 await addCoins(db,B,2000,'admin_grant');expect(await run(A,'offer-accept',offer.offer.id,terms,nonce)).toBe(path);
 expect(await db.select().from(marketOrders)).toHaveLength(0);expect((await walletOf(db,B)).balance).toBe(2000);
});

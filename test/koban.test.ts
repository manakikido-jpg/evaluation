import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { coinTx, kobanPurchases, members, shopItems, shopPurchases } from '../src/db/schema.js';
import { KOBAN_VALUES, kobanPrice, kobanValue } from '../src/domain/koban.js';
import { buyKoban, heldKoban, kobanStats, sendKoban } from '../src/services/koban.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { flowOf } from '../src/services/economyStats.js';
import { discountable, listItems, priceOf, seedDefaultItems, updateItem } from '../src/services/shop.js';
import { kobanBuyConfirm } from '../src/discord/koban.js';
import { categoryOf } from '../src/discord/shopViews.js';
import { cfg, makeDb } from './helpers.js';
let db: Db, close: () => Promise<void>;
const A = '700000000000000001', B = '700000000000000002', C = '700000000000000003';
beforeEach(async () => {
 ({ db, close } = await makeDb());
 await seedDefaultItems(db, { colors: [], titles: [] });
 await db.insert(members).values([A,B,C].map(id=>({id,username:id,displayName:'メンバー'})));
 await addCoins(db,A,100000,'admin_grant');
});
afterEach(async()=>close());
const item = async(value=1000)=>(await listItems(db)).find(i=>kobanValue(i.kind)===value)!;
it('4額面を150％で販売し、割引・セール・編集価格を使わない。再起動で重複しない',async()=>{
 for(const value of KOBAN_VALUES){
  const i=await item(value);
  expect(i.price).toBe(kobanPrice(value));expect(categoryOf(i)).toBe('gift');expect(discountable(i)).toBe(false);
  expect(priceOf(i,{...cfg.economy,shopSalePercent:90,boostDiscountPercent:90},true)).toBe(kobanPrice(value));
  await updateItem(db,i.id,{price:1,durationDays:1,boosterOnly:true});
  expect(await item(value)).toMatchObject({price:kobanPrice(value),durationDays:null,boosterOnly:false});
 }
 expect(await seedDefaultItems(db,{colors:[],titles:[]})).toBe(0);
});
it('購入時は受取人に入らず、送った瞬間に額面だけ入る。全4種類の手数料を正しく集計する',async()=>{
 let total=0;
 for(const value of KOBAN_VALUES){
  const r=await buyKoban(db,A,(await item(value)).id,randomUUID());total+=kobanPrice(value);
  expect((await walletOf(db,A)).balance).toBe(100000-total);
  expect((await heldKoban(db,A))).toHaveLength(1);
  await sendKoban(db,A,r.receipt.id,B);
  expect((await heldKoban(db,A))).toHaveLength(0);
 }
 expect((await walletOf(db,B)).balance).toBe(19000);
 const stats=await kobanStats(db);
 expect(stats.reduce((n,k)=>n+k.count,0)).toBe(4);expect(stats.reduce((n,k)=>n+k.sales,0)).toBe(28500);
 expect(stats.reduce((n,k)=>n+k.fee,0)).toBe(9500);expect(stats.every(k=>k.sent===1&&k.pending===0)).toBe(true);
 expect((await db.select().from(coinTx).where(eq(coinTx.reason,'koban_fee')))).toHaveLength(4);
 expect(flowOf('koban_fee')).toBe('income');expect(flowOf('koban_redeem')).toBe('income');
});
it('同じ購入ボタンの連打・並行実行は1枚分だけ。別の確認なら追加購入できる',async()=>{
 const i=await item(), nonce=randomUUID();
 await Promise.all([buyKoban(db,A,i.id,nonce),buyKoban(db,A,i.id,nonce)]);
 expect((await walletOf(db,A)).balance).toBe(98500);expect(await heldKoban(db,A)).toHaveLength(1);
 expect(await db.select().from(shopPurchases)).toHaveLength(1);
 await buyKoban(db,A,i.id,randomUUID());expect(await heldKoban(db,A)).toHaveLength(2);
 await expect(buyKoban(db,B,i.id,nonce)).rejects.toThrow('確認');
 await expect(buyKoban(db,A,(await item(3000)).id,nonce)).rejects.toThrow('確認');
});
it('不足・販売停止・違う品・不正な購入番号は残高も持ち物も変えない',async()=>{
 const i=await item();
 await expect(buyKoban(db,B,i.id,randomUUID())).rejects.toThrow('足りません');
 await updateItem(db,i.id,{enabled:false});await expect(buyKoban(db,A,i.id,randomUUID())).rejects.toThrow('販売');
 const normal=(await listItems(db)).find(i=>i.kind==='name_change')!;
 await expect(buyKoban(db,A,normal.id,randomUUID())).rejects.toThrow('販売');
 await expect(buyKoban(db,A,i.id,'bad')).rejects.toThrow('開き直し');
 expect((await walletOf(db,A)).balance).toBe(100000);expect(await heldKoban(db,A)).toHaveLength(0);
 expect(await db.select().from(kobanPurchases)).toHaveLength(0);
});
it('在籍中の人以外・BOT・自己送付・他人の小判を拒否し、送付失敗でも小判を保持する',async()=>{
 const r=await buyKoban(db,A,(await item()).id,randomUUID());
 await expect(sendKoban(db,A,r.receipt.id,A)).rejects.toThrow('自分以外');
 await expect(sendKoban(db,B,r.receipt.id,C)).rejects.toThrow('持っていません');
 await db.update(members).set({isBot:true}).where(eq(members.id,B));await expect(sendKoban(db,A,r.receipt.id,B)).rejects.toThrow('在籍');
 await db.update(members).set({isBot:false,leftAt:new Date()}).where(eq(members.id,B));await expect(sendKoban(db,A,r.receipt.id,B)).rejects.toThrow('在籍');
 await expect(sendKoban(db,A,r.receipt.id,'700000000000000099')).rejects.toThrow('在籍');
 expect(await heldKoban(db,A)).toHaveLength(1);expect((await walletOf(db,B)).balance).toBe(0);
});
it('同じ小判を同時に2人へ送っても1人だけ換金でき、再送でも増えない',async()=>{
 const r=await buyKoban(db,A,(await item(10000)).id,randomUUID());
 const sent=await Promise.allSettled([sendKoban(db,A,r.receipt.id,B),sendKoban(db,A,r.receipt.id,C)]);
 expect(sent.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 expect((await walletOf(db,B)).balance+(await walletOf(db,C)).balance).toBe(10000);
 await expect(sendKoban(db,A,r.receipt.id,B)).rejects.toThrow('送付済み');
 expect(await db.select().from(coinTx).where(eq(coinTx.reason,'koban_redeem'))).toHaveLength(1);
});
it('未送付の額面を収益と分離し、商品を削除しても購入済みの小判は送れる',async()=>{
 const i=await item(5000);const r=await buyKoban(db,A,i.id,randomUUID());
 expect((await kobanStats(db)).find(k=>k.value===5000)).toMatchObject({count:1,sales:7500,fee:2500,sent:0,pending:1});
 await db.delete(shopItems).where(eq(shopItems.id,i.id));await sendKoban(db,A,r.receipt.id,B);
 expect((await walletOf(db,B)).balance).toBe(5000);
 expect((await kobanStats(db)).find(k=>k.value===5000)?.fee).toBe(2500);
});
it('購入途中で手数料の台帳記録に失敗すると、額面支払い・財布・販売記録も全部戻す',async()=>{
 await db.execute(sql`ALTER TABLE coin_tx ADD CONSTRAINT koban_test_failure CHECK (reason <> 'koban_fee')`);
 await expect(buyKoban(db,A,(await item()).id,randomUUID())).rejects.toThrow();
 expect((await walletOf(db,A)).balance).toBe(100000);expect(await db.select().from(kobanPurchases)).toHaveLength(0);expect(await db.select().from(shopPurchases)).toHaveLength(0);
 expect(await db.select().from(coinTx).where(eq(coinTx.reason,'koban_buy'))).toHaveLength(0);
});
it('換金中の失敗は消費と受取人の財布・履歴を全部戻す',async()=>{
 const r=await buyKoban(db,A,(await item()).id,randomUUID());
 await db.execute(sql`ALTER TABLE coin_tx ADD CONSTRAINT koban_test_failure CHECK (reason <> 'koban_redeem')`);
 await expect(sendKoban(db,A,r.receipt.id,B)).rejects.toThrow();
 expect(await heldKoban(db,A)).toHaveLength(1);expect((await walletOf(db,B)).balance).toBe(0);
 expect((await db.select().from(shopPurchases))[0]?.endedAt).toBeNull();
 await db.execute(sql`ALTER TABLE coin_tx DROP CONSTRAINT koban_test_failure`);await sendKoban(db,A,r.receipt.id,B);
 expect((await walletOf(db,B)).balance).toBe(1000);
});
it('購入確認に額面・販売額・手数料と追加料金なしを表示する',async()=>{
 const view=kobanBuyConfirm(await item(3000),10000);const text=JSON.stringify(view);
 expect(text).toContain('4,500');expect(text).toContain('3,000');expect(text).toContain('1,500');expect(text).toContain('追加料金はありません');expect(text).not.toContain('20%');
});

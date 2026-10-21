import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { fortuneScratch, coinTx } from '../src/db/schema.js';
import { scratchFinances, scratchPeriod, scratchPeriodStart } from '../src/services/casino/fortuneStats.js';
import { makeDb } from './helpers.js';
let db:Db,close:()=>Promise<void>;
const NOW=new Date('2026-10-22T03:00:00Z'),START=new Date('2026-10-21T15:00:00Z');
beforeEach(async()=>{({db,close}=await makeDb());});afterEach(async()=>close());
const row=(price:number,payout:number,createdAt:Date,openedAt:Date|null)=>({id:randomUUID(),memberId:'760000000000000001',day:'2026-10-22',price,payout,createdAt,openedAt});
it('JSTの今日を含む期間と、不正な期間の既定値を使う',()=>{
 expect(scratchPeriod('bad')).toBe('30d');expect(scratchPeriod('all')).toBe('all');
 expect(scratchPeriodStart('today',NOW)).toEqual(START);
 expect(scratchPeriodStart('7d',NOW)).toEqual(new Date('2026-10-15T15:00:00Z'));
 expect(scratchPeriodStart('30d',NOW)).toEqual(new Date('2026-09-22T15:00:00Z'));
 expect(scratchPeriodStart('all',NOW)).toBeUndefined();
});
it('空の期間は0件・0銭で、実績還元率は未計算にする',async()=>{
 const s=await scratchFinances(db,'today',NOW);
 expect(s).toMatchObject({sold:0,revenue:0,opened:0,wins:0,payout:0,cashNet:0,settledNet:0,pending:0,returnPct:null,prizes:[],recent:[]});
});
it('購入日と開封日を分け、未開封の当たり額を漏らさず、過去価格で収支を計算する',async()=>{
 const old=new Date('2026-10-20T03:00:00Z');
 await db.insert(fortuneScratch).values([
  row(100,1000,old,NOW),row(100,0,NOW,NOW),row(200,200,NOW,NOW),row(300,3000,NOW,null),
  row(100,200,old,new Date(START.getTime()-1)),row(50,100,START,START),
  row(10000,1000000,new Date(NOW.getTime()+1),null),
 ]);
 const s=await scratchFinances(db,'today',NOW);
 expect(s).toMatchObject({sold:4,revenue:650,opened:4,wins:3,payout:1300,cashNet:-650,settledSales:450,settledNet:-850,pending:1});
 expect(s.returnPct).toBeCloseTo(1300/450*100);
 expect(s.prizes.find(p=>p.multiplier===10)).toMatchObject({count:1,amount:1000,min:1000,max:1000});
 expect(s.recent).toHaveLength(3);expect(JSON.stringify(s)).not.toContain('3000');
 const all=await scratchFinances(db,'all',NOW);expect(all).toMatchObject({sold:6,revenue:850,opened:5,payout:1500});
 expect(await db.select().from(coinTx)).toEqual([]);
 expect(await db.select().from(fortuneScratch)).toHaveLength(7);
});
it('同じ倍率でも購入当時の金額を集計し、最近の当たりは20件までにする',async()=>{
 await db.insert(fortuneScratch).values(Array.from({length:22},(_,i)=>row(i%2?100:200,i%2?1000:2000,START,new Date(START.getTime()+i))));
 const s=await scratchFinances(db,'today',NOW);
 expect(s.prizes).toEqual([{multiplier:10,count:22,amount:33000,min:1000,max:2000}]);
 expect(s.recent).toHaveLength(20);expect(s.recent[0]!.openedAt).toEqual(new Date(START.getTime()+21));
 expect(s.cashNet).toBe(-29700);expect(s.settledNet).toBe(-29700);
});
it('実際の購入と開封に追従し、再開封でも払戻と収支を重複させない',async()=>{
 const {buyScratch,revealScratch}=await import('../src/services/casino/fortune.js');
 const {addCoins,walletOf}=await import('../src/services/economy.js');
 const {fortuneGamesSchema}=await import('../src/config.js');
 const member='760000000000000001';
 await addCoins(db,member,1000,'admin_grant');
 const id=await buyScratch(db,member,randomUUID(),fortuneGamesSchema.parse({enabled:true}),()=>NOW,()=>9999);
 expect(await scratchFinances(db,'today',NOW)).toMatchObject({revenue:100,payout:0,pending:1,cashNet:100,settledNet:0,prizes:[],recent:[]});
 await revealScratch(db,member,id,()=>NOW);await revealScratch(db,member,id,()=>NOW);
 expect(await scratchFinances(db,'today',NOW)).toMatchObject({sold:1,opened:1,revenue:100,payout:1000,pending:0,cashNet:-900,settledNet:-900});
 expect((await walletOf(db,member)).balance).toBe(1900);
});

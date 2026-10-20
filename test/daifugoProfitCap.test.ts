import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { daifugo, daifugoPayouts, type DaifugoState } from '../src/services/casino/tables/daifugo.js';
import { payoutByShares, SHARES } from '../src/services/casino/tables/partyBase.js';
import { actTable, createTable, pollTable, tableById } from '../src/services/casino/tables/service.js';
import { casinoTables, aiMatches, type CasinoTable } from '../src/db/schema.js';
import { casinoStats } from '../src/services/casino/casino.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { TableFrag, TablesLobby } from '../src/web/views/casinoTables.js';
import type { CasinoMe } from '../src/web/views/casino.js';
import type { Db } from '../src/db/client.js';
import { cfg, makeDb } from './helpers.js';
const A={id:'760000000000000001',name:'あや'};
const now=new Date('2026-10-20T03:00:00Z');
const config={...cfg,casino:{...cfg.casino,maxBet:10000,dailyBetLimit:0}};
const ctx=()=>({cfg:config,now:now.getTime(),rng:(n:number)=>n-1});
function state(n=4,bots=3,entry=1000):DaifugoState {
 const r=daifugo.create(A,{entry:String(entry),botProfitCap:'999999'},ctx());if(!r.ok)throw Error(r.error);
 const s=r.state;
 s.seats=Array.from({length:n},(_,i)=>({id:i>=n-bots?'bot:'+i:'76000000000000000'+(i+1),name:'席'+i,hand:[],out:true,gone:false,timeouts:0,...(i>=n-bots?{bot:true}:{})}));
 s.order=s.seats.map(x=>x.id);return s;
}
function* permutations<T>(a:T[]):Generator<T[]> {if(!a.length){yield [];return;}for(let i=0;i<a.length;i++)for(const rest of permutations(a.filter((_,j)=>j!==i)))yield [a[i]!,...rest];}
it('全順位・3〜5人・複数の人・端数でも利益上限と分配総額を守る',()=>{
 for(const n of [3,4,5])for(let bots=1;bots<n;bots++)for(const entry of [0,100,333,1000,9999]){
  const base=state(n,bots,entry);expect(base.botProfitCap).toBe(500);
  for(const order of permutations(base.order)){
   const s=structuredClone(base);s.order=order;const credits=daifugoPayouts(s);
   expect(credits.reduce((a,c)=>a+c.amount,0)).toBe(entry*n);
   for(const p of s.payouts){expect(p.amount).toBeGreaterThanOrEqual(0);if(!s.seats.find(x=>x.id===p.id)!.bot)expect(p.amount-entry).toBeLessThanOrEqual(500);}
  }
 }
});
it('1000銭で1位なら1500銭、100銭なら240銭。元の配当を増やさない',()=>{
 const large=state();daifugoPayouts(large);expect(large.payouts[0]!.amount).toBe(1500);
 const small=state(4,3,100);daifugoPayouts(small);expect(small.payouts[0]!.amount).toBe(240);
 const second=state(4,3,1000);second.order=[second.order[1]!,second.order[0]!,...second.order.slice(2)];daifugoPayouts(second);expect(second.payouts[1]!.amount).toBe(1200);
});
it('人だけの卓・旧卓は通常配当。BOTを入れて外した卓にも適用しない',()=>{
 for(const s of [state(4,0),state()]){
  if(s.seats.some(x=>x.bot))delete s.botProfitCap;
  const old=structuredClone(s);expect(daifugoPayouts(s)).toEqual(payoutByShares(old,SHARES[4]!));expect(s.payouts[0]!.amount).toBe(2400);
 }
});
it('参加前・対戦中・結果に保存された条件を表示し、旧卓は区別する',()=>{
 const s=state();const me={session:{userId:A.id,csrfToken:'test',displayName:'あや'},balance:10000,coin:{name:'銭',emoji:'🪙'}} as CasinoMe;
 const table={id:1,kind:'daifugo',hostId:A.id,status:'open',state:s} as unknown as CasinoTable;
 const lobby=TablesLobby({me,kind:'daifugo',casino:config.casino,tables:[table]}).toString();expect(lobby).toContain('BOT戦の利益上限 500');
 for(const phase of ['lobby','playing','done'] as const){s.phase=phase;s.turn=0;expect(TableFrag({table:{...table,state:s},me,casino:config.casino,now:now.getTime()}).toString()).toContain('この卓では最大1,500 銭');}
 delete s.botProfitCap;expect(TableFrag({table:{...table,state:s},me,casino:config.casino,now:now.getTime()}).toString()).toContain('以前の配当条件');
});
describe('実際の入金と収支',()=>{
 let db:Db,close:()=>Promise<void>;
 beforeEach(async()=>{({db,close}=await makeDb());await addCoins(db,A.id,10000,'admin_grant');});
 afterEach(async()=>close());
 it.each([false,true])('同時精算でも1回だけ入金し、旧卓=%sの配当と収支を維持する',async legacy=>{
  const made=await createTable(db,config,'daifugo',A,{entry:'1000'},now);if(!('table'in made))throw Error(made.status);
  const id=made.table.id;
  for(let k=0;k<3;k++)expect((await actTable(db,config,id,A.id,{action:'add_bot'},now)).status).toBe('ok');
  const table=(await tableById(db,id))!;const s=table.state as DaifugoState;
  if(legacy)delete s.botProfitCap;
  // 終局直前の正当な状態。人とBOT1が上がり、BOT2が最後の1枚を出す。
  s.phase='playing';s.rules=[];s.field=null;s.turn=2;s.deadline=now.getTime();s.order=[s.seats[0]!.id,s.seats[1]!.id];
  s.seats.forEach((x,i)=>{x.out=i<2;x.hand=i<2?[]:i===2?[3]:[4,5];});
  await db.update(casinoTables).set({state:s,dueAt:now}).where(eq(casinoTables.id,id));
  await Promise.all([pollTable(db,config,id,now,ctx().rng),pollTable(db,config,id,now,ctx().rng)]);
  const payout=legacy?2400:1500;
  expect((await walletOf(db,A.id)).balance).toBe(9000+payout);
  const end=(await tableById(db,id))!.state as DaifugoState;expect(end.phase).toBe('done');expect(end.payouts[0]!.amount).toBe(payout);
  const stats=(await casinoStats(db,new Date(now.getTime()-1000))).find(x=>x.game==='daifugo')!;expect(stats.wagered-stats.paid).toBe(1000-payout);
  const matches=await db.select().from(aiMatches);expect(matches).toHaveLength(1);expect(matches[0]!.seats.find(x=>!x.bot)!.net).toBe(payout-1000);
 });
});

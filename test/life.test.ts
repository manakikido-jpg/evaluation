import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { casinoTables, casinoGames } from '../src/db/schema.js';
import { life, lifeAssets, LIFE_GOAL, type LifeState } from '../src/services/casino/tables/life.js';
import { createTable, joinTable, actTable, pollTable, tableById } from '../src/services/casino/tables/service.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import type { Ctx, Step } from '../src/services/casino/tables/types.js';
import { cfg, makeDb } from './helpers.js';
const P=(i:number)=>({id:`76000000000000010${i}`,name:`参加者${i}`});
const state=(s:Step<LifeState>)=>{if(!s.ok)throw new Error(s.error);return s.state;};
const ctx:Ctx={now:1000000,rng:()=>0,cfg:{...cfg,casino:{...cfg.casino,dailyBetLimit:0}}};
function started(n:number,entry=100) {
 let s=state(life.create(P(0),{entry:String(entry)},ctx));
 for(let i=1;i<n;i++)s=state(life.join(s,P(i),{},ctx));
 return state(life.act(s,P(0).id,{action:'start'},ctx));
}
describe('人生ゲームの流れと賞金',()=>{
 it('2〜5人全員がゴールし、賞金合計は参加費だけ。再操作しても賞金は増えない',()=>{
  for(let n=2;n<=5;n++){
   let s=started(n,101),paid=0,records=0,clock=ctx.now;
   for(let k=0;s.phase==='playing' && k<500;k++){
    clock=s.deadline!+1;
    const step=life.tick(s,{...ctx,now:clock})!;
    if(step.ok){paid+=(step.fx?.credits??[]).reduce((a,b)=>a+b.amount,0);records+=step.fx?.records?.length??0;}
    s=state(step);
   }
   expect(s.phase).toBe('done');
   expect(Object.values(s.people).every(p=>p.position===LIFE_GOAL)).toBe(true);
   expect(paid).toBe(101*n);expect(records).toBe(n);
   expect(s.payouts.reduce((a,b)=>a+b.amount,0)).toBe(101*n);
   expect(life.act(s,P(0).id,{action:'roll',nonce:String(s.nonce)},ctx).ok).toBe(false);
   const closed=life.tick(s,{...ctx,now:s.deadline!+1})!;
   expect(closed.ok && closed.fx?.credits).toBeUndefined();
  }
 });
 it('古い操作番号・他人の番・残高不足の購入を拒否し、開始後の退出は返金しない',()=>{
  let s=started(2);
  expect(life.act(s,P(1).id,{action:'choose',choice:'work',nonce:'0'},ctx).ok).toBe(false);
  s=state(life.act(s,P(0).id,{action:'choose',choice:'study',nonce:'0'},ctx));
  expect(s.people[P(0).id]!.salary).toBe(240);
  expect(s.people[P(0).id]!.money).toBe(700);
  expect(life.act(s,P(0).id,{action:'roll',nonce:'0'},ctx).ok).toBe(false);
  s.pending={by:0,kind:'house'};s.people[P(0).id]!.money=599;
  expect(life.act(s,P(0).id,{action:'choose',choice:'buy',nonce:String(s.nonce)},ctx).ok).toBe(false);
  const left=life.leave(s,P(0).id,ctx);
  expect(left.ok && left.fx?.credits).toBeUndefined();
  expect(left.ok && left.state.seats[0]!.gone).toBe(true);
 });
 it('参加費ありのBOTを拒否。給料日を通過しても支払いはゲーム内だけ',()=>{
  const lobby=state(life.create(P(0),{entry:'100'},ctx));
  expect(life.act(lobby,P(0).id,{action:'add_bot'},ctx)).toEqual({ok:false,error:'life_paid_bot'});
  const free=state(life.create(P(0),{entry:'0'},ctx));
  expect(life.act(free,P(0).id,{action:'add_bot'},ctx).ok).toBe(true);
  let s=started(2);s.pending=null;s.people[P(0).id]!.job='仕事';s.people[P(0).id]!.position=5;
  const step=life.act(s,P(0).id,{action:'roll',nonce:String(s.nonce)},ctx);
  expect(step.ok && step.fx?.credits).toBeUndefined();
  const next=state(step);expect(next.people[P(0).id]!.money).toBe(1160);
 });
 it('最後の人もゴールまで進み、同じ資産なら賞金を均等に分ける',()=>{
  let s=started(2,101);s.pending=null;
  s.people[P(0).id] = {...s.people[P(0).id]!,job:'仕事',position:LIFE_GOAL,money:2000};
  s.people[P(1).id] = {...s.people[P(1).id]!,job:'仕事',position:LIFE_GOAL-1,money:1500};
  s.turn=1;
  const step=life.act(s,P(1).id,{action:'roll',nonce:String(s.nonce)},ctx);
  s=state(step);
  expect(s.phase).toBe('done');
  expect(s.order.map(id=>lifeAssets(s.people[id]!))).toEqual([2000,2000]);
  expect(s.payouts.map(p=>p.amount)).toEqual([101,101]);
 });
});
let db:Db,close:()=>Promise<void>;
beforeEach(async()=>{({db,close}=await makeDb());for(let i=0;i<2;i++)await addCoins(db,P(i).id,1000,'adjust');});
afterEach(async()=>close());
describe('人生ゲームの銭とロック',()=>{
 it('参加費を預かり、同時の操作を1回だけ進め、賞金も1回だけ渡す',async()=>{
  const t=await createTable(db,ctx.cfg,'life',P(0),{entry:'100'},new Date(ctx.now),ctx.rng);
  if(t.status!=='ok' || !('table' in t))throw new Error(t.status);
  const id=t.table.id;
  await joinTable(db,ctx.cfg,id,P(1),{},new Date(ctx.now),ctx.rng);
  expect((await walletOf(db,P(0).id)).balance).toBe(900);
  expect((await walletOf(db,P(1).id)).balance).toBe(900);
  await actTable(db,ctx.cfg,id,P(0).id,{action:'start'},new Date(ctx.now),ctx.rng);
  const choices=await Promise.all([0,1].map(()=>actTable(db,ctx.cfg,id,P(0).id,{action:'choose',choice:'work',nonce:'0'},new Date(ctx.now),ctx.rng)));
  expect(choices.map(r=>r.status).sort()).toEqual(['invalid','ok']);
  const current=(await tableById(db,id))!.state as LifeState;
  current.pending=null;current.turn=0;
  current.people[P(0).id] = {...current.people[P(0).id]!,position:LIFE_GOAL-1,money:1500};
  current.people[P(1).id] = {...current.people[P(1).id]!,position:LIFE_GOAL,money:1000};
  await db.update(casinoTables).set({state:current}).where(eq(casinoTables.id,id));
  const finishes=await Promise.all([0,1].map(()=>actTable(db,ctx.cfg,id,P(0).id,{action:'roll',nonce:String(current.nonce)},new Date(ctx.now),ctx.rng)));
  expect(finishes.map(r=>r.status).filter(x=>x==='ok')).toHaveLength(1);
  expect((await walletOf(db,P(0).id)).balance).toBe(1100);
  expect((await walletOf(db,P(1).id)).balance).toBe(900);
  await pollTable(db,ctx.cfg,id,new Date(ctx.now+1000),ctx.rng);
  expect((await walletOf(db,P(0).id)).balance).toBe(1100);
  expect(await db.select().from(casinoGames).where(eq(casinoGames.game,'life'))).toHaveLength(2);
 });
});

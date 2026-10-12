import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { casinoTables, casinoGames } from '../src/db/schema.js';
import { life, lifeAutoChoice, lifeAssets, lifeBoard, lifeGoal, LIFE_GOAL, type LifeState } from '../src/services/casino/tables/life.js';
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
    clock+=1000;
    const id=s.seats[s.turn!]!.id,kind=s.pending?.kind??(s.people[id]!.job==='これから選ぶ'?'career':undefined);
    const step=life.act(s,id,{action:kind?'choose':'roll',nonce:String(s.nonce),choice:kind==='career'?'work':lifeAutoChoice(s)},{...ctx,now:clock});
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
 it.each([20,40,60] as const)('%i分版のマスと時間を保存し、時間切れの賞金は一度だけ',minutes=>{
   let s=state(life.create(P(0),{entry:'101',minutes:String(minutes),pace:'relaxed'},ctx));
   expect(s.endsAt).toBeNull();expect(lifeBoard(s)).toHaveLength(minutes/20*36);
   expect(lifeBoard(s).filter(x=>x[2]==='goal')).toHaveLength(1);
   lifeBoard(s).forEach((tile,i)=>{if(i>0 && i<lifeGoal(s))expect(tile[2]==='pay').toBe(i%6===0);});
   s=state(life.join(s,P(1),{},ctx));
   const start=ctx.now+30_000;s=state(life.act(s,P(0).id,{action:'start'},{...ctx,now:start}));
   expect(s.endsAt).toBe(start+minutes*60_000);
   s.people[P(0).id]!.money=2000;s.people[P(1).id]!.money=1000;
   s.deadline=s.endsAt!+100_000;
   expect(life.due(s)).toBe(s.endsAt);
   expect(life.tick(s,{...ctx,now:s.endsAt!-1})).toBeNull();
   const end=life.tick(s,{...ctx,now:s.endsAt!})!;s=state(end);
   expect(s.phase).toBe('done');expect(s.pending).toBeNull();expect(s.payouts.map(x=>x.amount)).toEqual([202,0]);
   expect(end.ok && end.fx?.records).toHaveLength(2);
   const replay=life.tick(s,{...ctx,now:s.deadline!+1})!;
   expect(replay.ok && replay.fx?.credits).toBeUndefined();
 });
 it('長い版は35マスを通過し、107マスまで進める。早いゴールと古い卓にも対応する',()=>{
   let s=state(life.create(P(0),{entry:'0',minutes:'60'},ctx));s=state(life.join(s,P(1),{},ctx));s=state(life.act(s,P(0).id,{action:'start'},ctx));
   s.pending=null;s.people[P(0).id]!.job='仕事';s.people[P(0).id]!.position=35;
   s=state(life.act(s,P(0).id,{action:'roll',nonce:String(s.nonce)},ctx));
   expect(s.people[P(0).id]!.position).toBe(36);expect(s.phase).toBe('playing');
   expect(s.people[P(0).id]!.money).toBe(1160);
   for(const p of Object.values(s.people)){p.position=lifeGoal(s)-1;p.job='仕事';}s.turn=0;s.pending=null;
   s=state(life.act(s,P(0).id,{action:'roll',nonce:String(s.nonce)},ctx));
   expect(s.phase).toBe('playing');s=state(life.act(s,P(1).id,{action:'roll',nonce:String(s.nonce)},ctx));
   expect(s.phase).toBe('done');expect(Object.values(s.people).every(p=>p.position===107)).toBe(true);
   const legacy=started(2);delete legacy.minutes;delete legacy.endsAt;delete legacy.strategy;
   expect(lifeGoal(legacy)).toBe(35);
   expect(state(life.tick(legacy,{...ctx,now:ctx.now+100*60_000})!).phase).toBe('playing');
   expect(life.create(P(0),{entry:'0',minutes:'30'},ctx).ok).toBe(false);
 });
 it('終了直前の持ち時間は全体の期限を越えず、操作と退出でも時間切れを清算する',()=>{
   const s=started(2),at=s.endsAt!;
   const chosen=state(life.act(s,P(0).id,{action:'choose',choice:'work',nonce:'0'},{...ctx,now:at-1}));
   expect(chosen.deadline).toBe(at);
   for(const step of [life.act(s,P(0).id,{action:'roll',nonce:'0'},{...ctx,now:at}),life.leave(s,P(0).id,{...ctx,now:at})]){
     const done=state(step);expect(done.phase).toBe('done');expect(done.payouts.reduce((a,p)=>a+p.amount,0)).toBe(200);
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
 it('時間切れを同時に確かめても賞金と戦績は一度だけ',async()=>{
   const made=await createTable(db,ctx.cfg,'life',P(0),{entry:'100',minutes:'40'},new Date(ctx.now),ctx.rng);
   if(made.status!=='ok'||!('table' in made))throw Error(made.status);
   const id=made.table.id;await joinTable(db,ctx.cfg,id,P(1),{},new Date(ctx.now),ctx.rng);
   await actTable(db,ctx.cfg,id,P(0).id,{action:'start'},new Date(ctx.now),ctx.rng);
   const s=(await tableById(db,id))!.state as LifeState;
   await Promise.all([0,1,2].map(()=>pollTable(db,ctx.cfg,id,new Date(s.endsAt!),ctx.rng)));
   expect(((await tableById(db,id))!.state as LifeState).phase).toBe('done');
   expect((await walletOf(db,P(0).id)).balance+(await walletOf(db,P(1).id)).balance).toBe(2000);
   expect(await db.select().from(casinoGames).where(eq(casinoGames.game,'life'))).toHaveLength(2);
 });
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

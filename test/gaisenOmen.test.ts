import {describe,it,expect} from 'vitest';
import {lever,stop,scenario,newGaisen,pendingOmenSets,isProtected,type GaisenState,type Role} from '../src/services/casino/gaisen/engine.js';
import {actTrial,expireFloor,freshFloor,trialView} from '../src/services/casino/gaisen/trial.js';
import {simulationOrder,simulateGaisen} from '../src/services/casino/gaisen/simulation.js';
const max=(n:number)=>n-1;
function round(s:GaisenState,role:Role='none',rng=max){
 lever(s,rng,role);for(const i of simulationOrder(s.pending!,'follow-navi'))stop(s,i,rng);
}
function missGstop(s:GaisenState){
 lever(s,max,'none');s.pending!.group=['1','3','5'];
 // 153は揃い/リーチ/HOLDのいずれでもない。
 stop(s,0,()=>0);stop(s,1,()=>2);stop(s,2,()=>1);
}
describe('trial-2の前兆権利',()=>{
 it('通常の当選を確定権利として保存し、前兆終了時に一度だけGGへ渡す',()=>{
  const s=newGaisen(1,'trial-2');round(s,'none',()=>0);
  expect(s).toMatchObject({phase:'omen',omen:3,omenStocks:1,stocks:0,sets:0,firsts:0});
  const saved=JSON.parse(JSON.stringify(s)) as GaisenState;
  for(let i=0;i<2;i++){round(saved);expect(saved.phase).toBe('omen');expect(saved.omenStocks).toBe(1);}
  round(saved);expect(saved).toMatchObject({phase:'gg',ggLeft:100,stocks:0,sets:1,omen:0,omenStocks:0,firsts:1});
  expect(saved.winEvent).toMatchObject({kind:'gg',added:1});round(saved);expect(saved.winEvent).toBeNull();
 });
 it('前兆中のGODは5セットに既存の1セットを合わせ、消失/二重初当たりを防ぐ',()=>{
  for(const remaining of [1,5]){
   const s=scenario(1,'omen','trial-2');s.omen=remaining;lever(s,max,'god');stop(s,0,max);stop(s,1,max);
   expect(s.omenStocks).toBe(1);expect(s.stocks).toBe(0);
   const loaded=JSON.parse(JSON.stringify(s)) as GaisenState;stop(loaded,2,max);
   expect(loaded).toMatchObject({phase:'gg',stocks:5,sets:1,omenStocks:0,omen:0,firsts:1,gods:1});
   expect(loaded.winEvent).toMatchObject({kind:'god',added:6});expect(()=>stop(loaded,2,max)).toThrow();expect(loaded.stocks).toBe(5);
  }
 });
 it('前兆終了と黄7履歴の当選が同時でも2セットを保持する',()=>{
  for(const remaining of [1,5]){
   const s=scenario(1,'omen','trial-2');s.omen=remaining;s.symbolHistory=['yellow','yellow','yellow'];
   // レア役による追加抽選は落選させ、履歴の確定4連だけを成立。
   round(s,'rare');expect(s).toMatchObject({phase:'gg',stocks:1,sets:1,firsts:1,omenStocks:0});expect(s.winEvent?.added).toBe(2);
  }
 });
 it('赤7/SGGを挟んでも前兆権利を保持し、GG復帰時だけ移す',()=>{
  const s=scenario(1,'omen','trial-2');round(s,'red7');expect(s).toMatchObject({phase:'sgg',stocks:1,omenStocks:1,omen:5});
  const loaded=JSON.parse(JSON.stringify(s)) as GaisenState;
  for(let i=0;i<16;i++)round(loaded);
  expect(loaded).toMatchObject({phase:'gg',sets:1,stocks:1,omenStocks:0,omen:0,firsts:1});
  expect(loaded.winEvent).toMatchObject({kind:'gg',added:1});
 });
 it('G-STOPに割り込まれても前兆を保持し、ハズレ後に残りGから再開する',()=>{
  const s=scenario(1,'omen','trial-2');s.symbolHistory=['blue','blue','blue'];round(s,'replay');
  expect(s).toMatchObject({phase:'gstop',gstopReturn:'omen',omen:4,omenStocks:1});
  for(let i=0;i<5;i++)missGstop(s);
  expect(s).toMatchObject({phase:'omen',omen:4,omenStocks:1,stocks:0});
  for(let i=0;i<4;i++)round(s);
  expect(s).toMatchObject({phase:'gg',sets:1,stocks:0,omenStocks:0});
 });
 it('G-STOP当選と前兆権利を合算し、次の待機G-STOPでも重複しない',()=>{
  const s=scenario(1,'omen','trial-2');s.symbolHistory=['blue','blue','blue'];round(s,'replay');
  s.gstopQueue=1;lever(s,max,'none');s.pending!.group=['1'];for(const i of [0,1,2])stop(s,i,max);
  expect(s).toMatchObject({phase:'gstop',gstopReturn:'gg',stocks:1,sets:1,omenStocks:0,gstopQueue:0});
  for(let i=0;i<5;i++)missGstop(s);
  expect(s).toMatchObject({phase:'gg',stocks:1,sets:1,omenStocks:0});
 });
 it('天井に届く前に確定した前兆は追加の天井当選として二重加算しない',()=>{
  const s=scenario(1,'omen','trial-2');s.normalGames=1479;round(s);
  expect(s).toMatchObject({phase:'gg',stocks:0,sets:1,omenStocks:0});expect(s.winEvent?.added).toBe(1);
  const ceiling=scenario(1,'ceiling','trial-2');round(ceiling);expect(ceiling).toMatchObject({phase:'gg',stocks:0,sets:1});
 });
 it('旧trial-2の前兆/特殊区間/停止途中を補完し、JSON再読込で増殖しない',()=>{
  for(const phase of ['omen','gstop','sgg'] as const){
   const s=scenario(1,'omen','trial-2');delete s.omenStocks;s.phase=phase;s.gstopReturn='omen';s.sggReturn='omen';s.gstopLeft=5;s.sggLeft=16;
   lever(s,max,'god');stop(s,0,max);const loaded=JSON.parse(JSON.stringify(s)) as GaisenState;
   stop(loaded,1,max);stop(loaded,2,max);
   if(phase==='omen')expect(loaded).toMatchObject({phase:'gg',stocks:5,sets:1,omenStocks:0});
   else{expect(loaded).toMatchObject({stocks:5,omenStocks:1});round(loaded,'god');expect(loaded.omenStocks).toBe(1);expect(loaded.stocks).toBe(11);}
  }
  const noOmen=newGaisen(1,'trial-2');round(noOmen,'god');expect(noOmen.stocks).toBe(4);
  const consumed=scenario(1,'omen','trial-2');consumed.omenStocks=0;round(consumed,'god');expect(consumed.stocks).toBe(4);
 });
 it('期限超過で本人用に保存し、設定予約/他人の着席/別台再開から保護する',()=>{
  const f=freshFloor(0,'trial-2'),act=(uid:string,action:string,machine=1,more={})=>actTrial(f,uid,uid,{action,machine,revision:f.revision,...more},0,max);
  act('a','seat');act('a','scenario',1,{scenario:'omen'});act('a','setting',1,{setting:6});
  expireFloor(f,3599999);expect(f.machines[0]!.owner).toBe('a');expireFloor(f,3600000);
  expect(f.players['u:a']!.saved).toMatchObject({setting:1,omenStocks:1,omen:5});expect(f.machines[0]!.state.setting).toBe(6);
  act('b','seat');expect(pendingOmenSets(f.machines[0]!.state)).toBe(0);
  Object.assign(f,JSON.parse(JSON.stringify(f)));act('a','seat',2);
  const resumed=f.machines[1]!.state;expect(resumed).toMatchObject({setting:1,omen:5,omenStocks:1});
  const view=JSON.stringify(trialView(f,'a'));expect(view).not.toContain('omenStocks');expect(view).not.toContain('"omen":');expect(view).not.toContain('"mode":');
  round(resumed,'god');expect(resumed.stocks).toBe(5);
  const normal=newGaisen(1,'trial-2');normal.omenStocks=1;expect(isProtected(normal)).toBe(true);
 });
 it('旧版の前兆進行・抽選結果は維持し、権利フィールドを追加しない',()=>{
  const old=scenario(1,'omen');for(let i=0;i<5;i++)round(old);expect(old).toMatchObject({phase:'gg',sets:1,stocks:0});expect(old.omenStocks).toBeUndefined();
  const overlapped=scenario(1,'omen');round(overlapped,'god');expect(overlapped.stocks).toBe(4);expect(overlapped.omenStocks).toBeUndefined();
 });
 it('自然抽選の会計を再現し、前兆の未消化権利を払出と分ける',()=>{
  const a=simulateGaisen(1,100000,2026,'follow-navi','trial-2');
  expect(a).toEqual(simulateGaisen(1,100000,2026,'follow-navi','trial-2'));
  expect(a.awardedSets).toBe(a.startedSets+a.unfinished.stocks);
  expect(a.finalBalance).toBe(a.initialBalance+a.refillPoints+a.net);
  expect(a.unfinished.omenStocks).toBeGreaterThanOrEqual(0);
 });
});

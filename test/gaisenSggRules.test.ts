import {describe,it,expect} from 'vitest';
import {drawMedusa,drawMedusaReset,drawEx,drawExStock,MEDUSA_WEIGHTS,EX_ENTRY_WEIGHTS,EX_RESET_WEIGHTS} from '../src/services/casino/gaisen/sggRules.js';
import {newGaisen,scenario,lever,stop,type GaisenState,type Setting} from '../src/services/casino/gaisen/engine.js';
import {preparePhaseSpin,phaseTable,type PhaseFlag} from '../src/services/casino/gaisen/phaseRules.js';
import {simulationOrder} from '../src/services/casino/gaisen/simulation.js';
import {actTrial,expireFloor,freshFloor,trialView} from '../src/services/casino/gaisen/trial.js';
const miss=(n:number)=>n-1;
function begin(s:GaisenState,flag:PhaseFlag){lever(s,miss,'none');Object.assign(s.pending!,preparePhaseSpin(flag,miss));}
function finish(s:GaisenState,rng=miss){for(const i of simulationOrder(s.pending!,'follow-navi'))stop(s,i,rng);}
function spin(s:GaisenState,flag:PhaseFlag,rng=miss){begin(s,flag);finish(s,rng);}
describe('SGGの役別抽選と時間停止',()=>{
 it('時間停止の全当選境界と非当選域を区別する',()=>{
  for(const [flag,rows] of Object.entries(MEDUSA_WEIGHTS)){
   let at=0;for(const [award,weight] of rows){
    expect(drawMedusa(flag as PhaseFlag,n=>{expect(n).toBe(10000);return at;})).toBe(award);
    expect(drawMedusa(flag as PhaseFlag,()=>at+weight-1)).toBe(award);at+=weight;
   }
   expect(at).toBeLessThanOrEqual(10000);
   if(at<10000){expect(drawMedusa(flag as PhaseFlag,()=>at)).toBe(0);expect(drawMedusa(flag as PhaseFlag,miss)).toBe(0);}
  }
  expect(drawMedusa('blue',()=>{throw Error('対象外を抽選');})).toBe(0);
 });
 it('巻き戻しのSGG/EX/非当選と設定ごとのEX境界を区別する',()=>{
  for(const [flag,normal,ex] of [['middleBlue',2500,2500],['yellowLeft',0,2500],['yellowCommon',3333,3333],['yellowMiddle',5000,5000],['special',0,10000]] as const){
   if(normal){expect(drawMedusaReset(flag,()=>0)).toBe('sgg');expect(drawMedusaReset(flag,()=>normal-1)).toBe('sgg');}
   expect(drawMedusaReset(flag,()=>normal)).toBe('ex');expect(drawMedusaReset(flag,()=>normal+ex-1)).toBe('ex');
   if(normal+ex<10000)expect(drawMedusaReset(flag,()=>normal+ex)).toBeNull();
  }
  for(let setting=1;setting<=6;setting++)for(const entry of [false,true]){
   const threshold=(entry?EX_ENTRY_WEIGHTS:EX_RESET_WEIGHTS)[setting-1]!;
   expect(drawEx(setting as Setting,entry,()=>threshold-1)).toBe(true);expect(drawEx(setting as Setting,entry,()=>threshold)).toBe(false);
  }
 });
 it('時間停止は次Gから始まり、最後の1GもSGGを減らさず巻き戻せる',()=>{
  const s=scenario(1,'sgg','trial-2');spin(s,'middleBlue',()=>0);expect(s).toMatchObject({sggLeft:15,medusa:10});
  s.symbolHistory=[];for(let i=0;i<9;i++)spin(s,'none');expect(s).toMatchObject({sggLeft:15,medusa:1});
  spin(s,'middleBlue',()=>2500);expect(s).toMatchObject({sggLeft:16,medusa:0,ex:true,stocks:2});
  expect(s.winEvent?.added).toBe(1);
  const t=scenario(1,'medusa','trial-2');t.medusa=1;spin(t,'none');expect(t).toMatchObject({sggLeft:8,medusa:0});spin(t,'none');expect(t.sggLeft).toBe(7);
 });
 it('3枚役の無限当選は最終STOP後に告知し、回転途中には公開しない',()=>{
  const s=scenario(1,'sgg','trial-2');s.sggLeft=2;spin(s,'small',()=>0);
  expect(s).toMatchObject({sggLeft:1,medusaDeferred:true,medusaInfinite:false});expect(phaseTable(s)).toBe('sgg');
  begin(s,'none');stop(s,0,miss);stop(s,1,miss);expect(s.medusaInfinite).toBe(false);
  stop(s,2,miss);expect(s).toMatchObject({phase:'sgg',sggLeft:0,medusaDeferred:false,medusaInfinite:true});
  expect(phaseTable(s)).toBe('sgg-high');spin(s,'none');expect(s.sggLeft).toBe(0);expect(s.medusaInfinite).toBe(true);
 });
 it('即時無限・後告知の権利はJSON保存でき、巻き戻しは現在の時間停止を終了する',()=>{
  const s=scenario(1,'sgg','trial-2');spin(s,'special');expect(s.medusaInfinite).toBe(true);
  const resumed=JSON.parse(JSON.stringify(s)) as GaisenState;spin(resumed,'god');expect(resumed).toMatchObject({sggLeft:16,medusa:0,medusaInfinite:false,stocks:6});
  for(const flag of ['red','reverseRed'] as const){const t=scenario(1,'medusa','trial-2');spin(t,flag);expect(t).toMatchObject({sggLeft:16,medusa:0,medusaInfinite:false,stocks:2,ex:flag==='red'});}
 });
 it('EXの上乗せは成立役別で、通常の3枚役や非対象役では増えない',()=>{
  for(const flag of ['blue','bell'] as const){expect(drawExStock(flag,()=>0)).toBe(true);expect(drawExStock(flag,()=>1)).toBe(false);}
  for(const flag of ['coinB','coinC','middleBlue','yellowLeft','yellowCommon','yellowMiddle','special'] as const)expect(drawExStock(flag,miss)).toBe(true);
  for(const flag of ['small','none','god','red','reverseRed','reverseFake','fake'] as const)expect(drawExStock(flag,()=>0)).toBe(false);
  const s=scenario(1,'sgg-ex','trial-2');spin(s,'small',()=>0);expect(s.stocks).toBe(1);expect(s.medusaDeferred).toBe(false);
  spin(s,'coinB');expect(s.stocks).toBe(2);expect(s.sggLeft).toBe(6);
 });
 it('新しいSGGへの突入だけでEX初期抽選し、既存の状態を再抽選しない',()=>{
  const s=newGaisen(3,'trial-2');spin(s,'red',()=>624);expect(s.ex).toBe(true);
  const t=newGaisen(3,'trial-2');spin(t,'red',()=>625);expect(t.ex).toBe(false);
  spin(t,'reverseRed',()=>155);expect(t.ex).toBe(true);
  const old=scenario(1,'sgg','trial-2');delete old.medusaInfinite;delete old.medusaDeferred;old.medusa=3;old.ex=true;
  spin(old,'none');expect(old).toMatchObject({medusa:2,sggLeft:16,ex:true});
 });
 it('1時間後の別台再開で停止位置・後告知・EX・受入台を保全し、二重STOPを拒否する',()=>{
  const f=freshFloor(0,'trial-2');const act=(action:string,machine=1,extra={})=>actTrial(f,'a','試遊',{action,machine,revision:f.revision,...extra},0,miss);
  act('seat');act('scenario',1,{scenario:'sgg-ex'});
  const s=f.machines[0]!.state;s.medusaDeferred=true;s.medusaInfinite=true;begin(s,'red');stop(s,2,miss);
  expireFloor(f,3600000);expect(f.machines[0]!.owner).toBeNull();
  const base=structuredClone(f.machines[1]!.state);act('seat',2);const m=f.machines[1]!;
  expect(m.base).toEqual(base);expect(m.state).toMatchObject({medusaDeferred:true,medusaInfinite:true,ex:true,pending:{stops:[2]}});
  const v=trialView(f,'a');expect(v.own?.medusaInfinite).toBe(true);expect(JSON.stringify(v)).not.toContain('medusaDeferred');
  act('stop',2,{index:1});const revision=f.revision;act('stop',2,{index:0});const saved=structuredClone(m.state);
  expect(()=>actTrial(f,'a','試遊',{action:'stop',machine:2,index:0,revision},0,miss)).toThrow();expect(m.state).toEqual(saved);
  expect(m.state).toMatchObject({stocks:2,sggLeft:16,medusaInfinite:false,medusaDeferred:true,ex:true});
  expect(m.state.balance).toBe(100000-m.state.input+m.state.output);
  m.state.medusaDeferred=false;m.state.phase='gzone';m.state.zoneLeft=1;m.state.stocks=0;begin(m.state,'none');
  for(const index of [0,1,2])act('stop',2,{index});expect(m.base).toBeNull();expect(m.state.normalGames).toBe(base.normalGames);
 });
 it('旧版には新しい確認場面を追加しない',()=>{
  const f=freshFloor(0);actTrial(f,'a','試遊',{action:'seat',machine:1,revision:0},0);
  expect(()=>actTrial(f,'a','試遊',{action:'scenario',machine:1,revision:f.revision,scenario:'medusa'},0)).toThrow();
 });
});

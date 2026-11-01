import {describe,it,expect,vi} from 'vitest';
import {drawInitialOmen,initialOmenGroup,INITIAL_OMEN_WEIGHTS,drawCeilingLoop} from '../src/services/casino/gaisen/omenRules.js';
import {newGaisen,scenario,lever,stop,pendingOmenSets,type GaisenState} from '../src/services/casino/gaisen/engine.js';
import {FLAGS,preparePhaseSpin,type PhaseFlag} from '../src/services/casino/gaisen/phaseRules.js';
import {simulationOrder} from '../src/services/casino/gaisen/simulation.js';
import {actTrial,expireFloor,freshFloor,trialView} from '../src/services/casino/gaisen/trial.js';
const max=(n:number)=>n-1;
function round(s:GaisenState,flag:PhaseFlag='none',rng=max){
 lever(s,max,'none');Object.assign(s.pending!,preparePhaseSpin(flag,max));
 for(const i of simulationOrder(s.pending!,'follow-navi'))stop(s,i,rng);
}
describe('初当たり前兆の契機別振分',()=>{
 it('全抽選区間の両端が対応するG数へ入り、公開丸め値の比率を保持する',()=>{
  const flags={none:'yellowReplay',blue:'blue',middleBlue:'middleBlue',other:'yellowMiddle'} as const;
  for(const group of Object.keys(flags) as (keyof typeof flags)[]){
   const weights=INITIAL_OMEN_WEIGHTS[group],total=weights.reduce<number>((a,b)=>a+b,0);let offset=0;
   for(let i=0;i<weights.length;i++){
    for(const ticket of [offset,offset+weights[i]!-1])expect(drawInitialOmen(flags[group],n=>{expect(n).toBe(total);return ticket;})).toBe(i+1);
    offset+=weights[i]!;
   }
  }
 });
 it('実装の全フラグを分類し、青7は12G、中段青7は16G、それ以外は24Gまで',()=>{
  for(const flag of Object.keys(FLAGS) as PhaseFlag[]){
   expect(initialOmenGroup(flag)).toBe(flag==='none'||flag==='yellowReplay'?'none':flag==='blue'?'blue':flag==='middleBlue'?'middleBlue':'other');
   expect(drawInitialOmen(flag,()=>0)).toBe(1);
   expect(drawInitialOmen(flag,max)).toBe(flag==='blue'?12:flag==='middleBlue'?16:24);
  }
 });
 it.each(['none','blue','middleBlue','yellowCommon'] as const)('%s当選の長さを一度だけ決め、再読込でも予定どおり発動する',flag=>{
  const s=newGaisen(1,'trial-2');
  // 抽選の当否は当選、前兆の抽選だけ最終区間へ。
  round(s,flag,n=>n===1003||n===1004?n-1:0);
  const games=flag==='blue'?12:flag==='middleBlue'?16:24;
  expect(s).toMatchObject({phase:'omen',omen:games,omenStocks:1,sets:0});
  const loaded=JSON.parse(JSON.stringify(s)) as GaisenState;
  for(let i=1;i<games;i++){round(loaded);expect(loaded.phase).toBe('omen');expect(pendingOmenSets(loaded)).toBe(1);}
  round(loaded);expect(loaded).toMatchObject({phase:'gg',sets:1,stocks:0,omen:0});
 });
});
describe('通常天井・24G前兆・天井ループ',()=>{
 it('1479Gでは未当選、1480Gで1回だけ当選し、24G後に開始する',()=>{
  const s=newGaisen(1,'trial-2');s.normalGames=1478;round(s);expect(s.phase).toBe('normal');expect(pendingOmenSets(s)).toBe(0);
  round(s);expect(s).toMatchObject({phase:'omen',normalGames:1480,ceilingHit:true,ceilingLeft:24,ceilingStocks:1,sets:0});
  for(let i=0;i<23;i++){round(s);expect(s.phase).toBe('omen');expect(pendingOmenSets(s)).toBe(1);}
  round(s);expect(s).toMatchObject({phase:'gg',normalGames:0,sets:1,stocks:0,ceilingStocks:0,ceilingLeft:0,ceilingHit:false});
  expect(s.winEvent?.added).toBe(1);
 });
 it.each([1,80] as const)('%s%%ループは次ゲームから1回ずつ抽選し、落選で止まる',rate=>{
  expect(drawCeilingLoop(()=>rate===1?0:1)).toBe(rate);
  const s=scenario(1,'ceiling','trial-2');round(s,'none',n=>n===2?(rate===1?0:1):max(n));
  expect(s.ceilingLoop).toBe(rate);expect(s.ceilingStocks).toBe(1);
  round(s,'none',n=>n===100?rate-1:max(n));expect(s.ceilingStocks).toBe(2);expect(s.ceilingLeft).toBe(23);
  round(s,'none',n=>n===100?rate:max(n));expect(s.ceilingStocks).toBe(2);expect(s.ceilingLoop).toBe(0);
  const fail=vi.fn(max);round(s,'none',fail);expect(fail).not.toHaveBeenCalledWith(100);
  for(let i=0;i<21;i++)round(s);
  expect(s).toMatchObject({phase:'gg',sets:1,stocks:1});
 });
 it('停止途中の保存・再読込と重複STOPで天井やループ権利が増えない',()=>{
  const s=scenario(1,'ceiling','trial-2');lever(s,max,'none');stop(s,0,max);stop(s,1,max);
  expect(s.normalGames).toBe(1479);expect(s.ceilingHit).toBeUndefined();
  const loaded=JSON.parse(JSON.stringify(s)) as GaisenState;stop(loaded,2,max);
  expect(loaded.ceilingStocks).toBe(1);expect(()=>stop(loaded,2,max)).toThrow();
  lever(loaded,max,'none');stop(loaded,0,max);const again=JSON.parse(JSON.stringify(loaded)) as GaisenState;
  stop(again,1,max);stop(again,2,n=>n===100?0:max(n));expect(again.ceilingStocks).toBe(2);
  expect(()=>stop(again,2,()=>0)).toThrow();expect(again.ceilingStocks).toBe(2);
 });
 it('前兆最後のGで天井に到達しても、当選済み1セットと天井1セットを保持する',()=>{
  const s=scenario(1,'omen','trial-2');s.omen=1;s.normalGames=1479;round(s);
  expect(s).toMatchObject({phase:'gg',sets:1,stocks:1,ceilingLoop:80});
  round(s,'none',n=>n===100?79:max(n));expect(s.stocks).toBe(2);
  round(s);expect(s.stocks).toBe(2);expect(s.ceilingLoop).toBe(0);
 });
 it('G-ZONEと通常へ戻るG-STOPを数え、GG/SGG内では進めない',()=>{
  const zone=scenario(1,'gg','trial-2');zone.ggLeft=1;round(zone);
  for(let i=0;i<5;i++)round(zone);expect(zone.normalGames).toBe(5);
  const s=scenario(1,'gstop','trial-2');s.normalGames=1479;
  lever(s,max,'none');s.pending!.group=['1','3','5'];stop(s,0,()=>0);stop(s,1,()=>2);stop(s,2,()=>1);
  expect(s).toMatchObject({phase:'gstop',normalGames:1480,ceilingStocks:1,ceilingLeft:24});
  for(const phase of ['gg','sgg'] as const){const x=scenario(1,phase,'trial-2');x.normalGames=1479;round(x);expect(x.normalGames).toBe(1479);expect(x.ceilingHit??false).toBe(false);}
 });
 it.each(['god','red'] as const)('天井前兆中の%sでも天井の権利を失わない',flag=>{
  const s=scenario(1,'ceiling','trial-2');round(s);round(s,flag);
  if(flag==='red'){for(let i=0;i<16;i++)round(s);}
  expect(s.phase).toBe('gg');expect(s.stocks+s.sets).toBe(flag==='god'?6:2);expect(pendingOmenSets(s)).toBe(0);
 });
 it('天井前兆を期限後に本人保存し、別台の設定や通常状態と混ぜず再開する',()=>{
  const f=freshFloor(0,'trial-2');const act=(action:string,machine=1,more={})=>actTrial(f,'a','a',{action,machine,revision:f.revision,...more},0,max);
  act('seat');act('scenario',1,{scenario:'ceiling'});round(f.machines[0]!.state);
  act('setting',1,{setting:6});expireFloor(f,3600000);
  expect(f.players['u:a']!.saved).toMatchObject({ceilingLeft:24,ceilingStocks:1,ceilingLoop:80,setting:1});
  act('seat',2);const s=f.machines[1]!.state;expect(s.ceilingLeft).toBe(24);
  const view=JSON.stringify(trialView(f,'a'));for(const hidden of ['ceilingStocks','ceilingLeft','ceilingLoop','ceilingHit'])expect(view).not.toContain(hidden);
  for(let i=0;i<24;i++)round(s);expect(s).toMatchObject({phase:'gg',sets:1,stocks:0,setting:1});
 });
});

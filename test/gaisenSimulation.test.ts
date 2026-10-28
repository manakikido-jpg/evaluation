import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {lever,scenario,newGaisen,ORDERS,type Role,type Setting} from '../src/services/casino/gaisen/engine.js';
import {freshFloor,trialView} from '../src/services/casino/gaisen/trial.js';
import {simulateGaisen,simulationOrder,summarizeGaisen,type StopPolicy} from '../src/services/casino/gaisen/simulation.js';

describe('神殿スロットの収支監査',()=>{
 it('既存の保存済み10万G試算と同じ抽選列・払出を維持する',()=>{
  const old=JSON.parse(readFileSync(new URL('../docs/gaisen-trial-simulation.json',import.meta.url),'utf8')).samples[0];
  const result=simulateGaisen(old.setting,old.games,old.seed);
  for(const key of ['input','output','net','minNet','maxNet','refills','phases','god','ggFirsts','sgg'] as const)
   expect(result[key]).toEqual(old[key]);
 });
 it('全区間・全役・全押し順で、実際の画面のナビだけを試算に使う',()=>{
  for(const phase of ['normal','omen','gg','gzone','gstop','sgg'] as const)
   for(const role of ['god','red7','rare','replay','bell','smallBell','none'] as Role[])
    for(const order of ORDERS){
     const f=freshFloor(0),s=newGaisen();s.phase=phase;lever(s,()=>0,role);s.pending!.order=order.slice();
     f.machines[0]!.state=s;f.machines[0]!.owner='tester';
     const navi=trialView(f,'tester').own!.navi;
     expect(simulationOrder(s.pending!,'follow-navi')).toEqual(navi??[0,1,2]);
     expect(simulationOrder(s.pending!,'left-only')).toEqual([0,1,2]);
     if(navi)expect(simulationOrder(s.pending!,'miss-navi')).not.toEqual(navi);
     else expect(simulationOrder(s.pending!,'miss-navi')).toEqual([0,1,2]);
    }
  const s=scenario(1,'gstop');s.hold='V';lever(s,()=>0,'none');
  for(const policy of ['follow-navi','left-only','miss-navi'] as StopPolicy[])expect(simulationOrder(s.pending!,policy)).toEqual([1]);
 });
 it('区間別・役別の合計と補充を含む残高が一致し、ナビミスは払出0になる',()=>{
  const s=simulateGaisen(1,100000,71,'miss-navi'),phases=Object.values(s.byPhase);
  expect(s.refills).toBeGreaterThan(0);
  expect(s.finalBalance).toBe(s.initialBalance+s.refillPoints+s.net);
  expect(s.output-s.input).toBe(s.paidOutput-s.paidInput);
  expect(s.paidInput).toBe(s.paidGames*30);
  for(const key of ['games','input','output','net','replayCredits','awardedSets'] as const)
   expect(phases.reduce((n,p)=>n+p[key],0)).toBe(s[key]);
  for(const p of phases){expect(Object.values(p.roles).reduce((a,b)=>a+b,0)).toBe(p.games);
   expect(Object.values(p.paidByRole).reduce((a,b)=>a+b,0)).toBe(p.output);}
  expect(s.byPhase.gg.bellHits).toBe(0);expect(s.byPhase.gg.bellMisses).toBeGreaterThan(0);
  expect(s.awardedSets).toBe(s.startedSets+s.unfinished.stocks);
  expect(s.maxDrawdown).toBeGreaterThanOrEqual(-s.minNet);
 });
 it('まとめは元データの比率/区間合計と一致し、0G区間はnullになる',()=>{
  const samples=[1,2,3].map(seed=>simulateGaisen(1,1,seed)),s=summarizeGaisen(samples);
  expect(s.games).toBe(3);expect(s.returnPercent).toBe(samples.reduce((n,x)=>n+x.output,0)/90*100);
  expect(s.phaseTotals.gg!.netUnitsPerGame).toBeNull();
  expect(s.sessionNet.min).toBe(Math.min(...samples.map(x=>x.net)));
  expect(s.sessionNet.max).toBe(Math.max(...samples.map(x=>x.net)));
  expect(summarizeGaisen([samples[0]!,samples[1]!,samples[2]!])).toEqual(s);
 });
 it('誤条件・重複seed・異なる操作条件の混在を拒否する',()=>{
  for(const games of [0,1.1,1000001,NaN])expect(()=>simulateGaisen(1,games,1)).toThrow();
  for(const seed of [-1,.1,NaN,4294967296])expect(()=>simulateGaisen(1,1,seed)).toThrow();
  expect(()=>simulateGaisen(7 as Setting,1,1)).toThrow();
  expect(()=>simulateGaisen(1,1,1,'invalid' as StopPolicy)).toThrow();
  const s=simulateGaisen(1,10,1);expect(()=>summarizeGaisen([])).toThrow();
  expect(()=>summarizeGaisen([s,s])).toThrow();
  for(const other of [simulateGaisen(2,10,2),simulateGaisen(1,11,2),simulateGaisen(1,10,2,'left-only')])
   expect(()=>summarizeGaisen([s,other])).toThrow();
 });
});

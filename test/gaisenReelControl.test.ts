import {describe,it,expect} from 'vitest';
import {newGaisen,lever,stop,visibleReels,ORDERS,type GaisenState} from '../src/services/casino/gaisen/engine.js';
import {FLAGS,preparePhaseSpin,type PhaseFlag} from '../src/services/casino/gaisen/phaseRules.js';
import {REEL_STRIPS,reelRows,reelSymbol,controlReel,type ReelControl} from '../src/services/casino/gaisen/reelRules.js';
import {freshFloor,trialView} from '../src/services/casino/gaisen/trial.js';
function spin(flag:PhaseFlag){const s=newGaisen(1,'trial-2');lever(s,()=>0,'none',true);Object.assign(s.pending!,preparePhaseSpin(flag,()=>0));return s;}
function finish(s:GaisenState,inputs?:number[]){for(const i of s.pending!.order)stop(s,i,n=>n-1,inputs?.[i]);}
describe('独自20コマの目押し・4コマ引込み',()=>{
 it('全コマからGOD/3色の7を0〜4コマ以内に引込み、20→1の境界をまたげる',()=>{
  expect(REEL_STRIPS.map(s=>s.length)).toEqual([20,20,20]);
  for(let reel=0;reel<3;reel++)for(const target of ['god','red7','blue7','gold7'] as const)for(let input=0;input<20;input++){
   const r=controlReel(reel,target,input,{stops:[null,null,null],miss:false});
   expect(r.position).toBe((input+r.slip)%20);expect(r.slip).toBeLessThanOrEqual(4);expect(r.miss).toBe(false);expect(REEL_STRIPS[reel]![r.position]).toBe(target);
  }
  expect(controlReel(0,'god',18,{stops:[null,null,null],miss:false})).toMatchObject({position:0,slip:2});
  expect(reelRows(0,19)).toEqual([REEL_STRIPS[0]![0],REEL_STRIPS[0]![19],REEL_STRIPS[0]![18]]);
 });
 it('押す周回によって異なる番号で止まり、成立役・払出を引き直さない',()=>{
  const a=spin('god'),b=spin('god');finish(a,[0,2,3]);finish(b,[5,7,8]);
  expect(a.lastReelStops!.map(s=>s!.position)).toEqual([0,2,3]);expect(b.lastReelStops!.map(s=>s!.position)).toEqual([5,7,8]);
  expect(a.lastPaid).toBe(150);expect(b.lastPaid).toBe(150);expect(a.gods).toBe(1);expect(b.gods).toBe(1);
 });
 it('宝石が4コマ圏外なら取りこぼし、届く位置と補助では払出する',()=>{
  const miss=spin('small'),caught=spin('small'),assist=spin('small');
  finish(miss,[0,0,0]);finish(caught,[9,4,9]);finish(assist);
  expect(miss.lastPaid).toBe(0);expect(miss.output).toBe(0);expect(miss.balance).toBe(99970);
  expect(caught.lastPaid).toBe(30);expect(assist.lastPaid).toBe(30);expect(assist.lastReelStops!.every(s=>s!.assisted)).toBe(true);
 });
 it('全フラグ・6押し順・20の入力位置で停止済み位置を変えず、3段が配列と一致する',()=>{
  for(const flag of Object.keys(FLAGS) as PhaseFlag[])for(const order of ORDERS)for(let n=0;n<20;n++){
   let s=spin(flag);const seen=new Map<number,unknown>();
   for(const index of order){
    stop(s,index,n=>n-1,(n+index*7)%20);
    for(const [i,record] of seen)expect((s.pending?.control?.stops??s.lastReelStops)![i]).toEqual(record);
    const record=(s.pending?.control?.stops??s.lastReelStops)![index]!;seen.set(index,structuredClone(record));
    expect(record.slip).toBeGreaterThanOrEqual(0);expect(record.slip).toBeLessThanOrEqual(4);
    expect(reelSymbol(visibleReels(s)[index]!,index)).toBe(REEL_STRIPS[index]![record.position]);
    s=JSON.parse(JSON.stringify(s));
   }
   expect(s.pending).toBeNull();expect(s.lastPaid).toBeGreaterThanOrEqual(0);expect(s.balance).toBe(100000-30+s.lastPaid);
   if(FLAGS[flag].replay)expect(s.lastPaid).toBe(30);
  }
 });
 it('取りこぼしの8000通りでも別の当たり揃いを完成させない',()=>{
  const wins=['god,god,god','red7,red7,red7','blue7,blue7,blue7','gold7,gold7,gold7','crest,crest,crest','gold7,blue7,gold7','red7,blue7,red7','crest,flower,crest','flower,crest,flower','crest,flower,blue7','flower,flower,crest'];
  for(let a=0;a<20;a++)for(let b=0;b<20;b++)for(let c=0;c<20;c++){
   const control:ReelControl={stops:[null,null,null],miss:false};
   for(const [i,input] of [a,b,c].entries()){const result=controlReel(i,(['blue7','crest','flower'] as const)[i]!,input,control);control.stops[i]=result;control.miss ||=result.miss;}
   const shown=control.stops.map((r,i)=>REEL_STRIPS[i]![r!.position]).join(',');expect(wins).not.toContain(shown);
  }
 });
 it('未停止の成立役/停止予定/取りこぼし予定を公開せず、旧保存とG-STOPは補助を保つ',()=>{
  const floor=freshFloor(0,'trial-2'),machine=floor.machines[0]!;machine.owner='u';
  const a=spin('god'),b=spin('none');machine.state=a;const av=trialView(floor,'u');machine.state=b;
  expect(trialView(floor,'u')).toEqual(av);expect(av.own!.reelStops).toEqual([null,null,null]);
  const old=newGaisen(1,'trial-2');lever(old,()=>0,'god');expect(old.pending!.control).toBeUndefined();finish(old);expect(old.lastPaid).toBe(150);
  const gs=newGaisen(1,'trial-2');gs.phase='gstop';gs.gstopLeft=5;lever(gs,()=>0,'none',true);expect(gs.pending!.control).toBeUndefined();
 });
 it('1000ゲームの補助入力で基礎抽選・乱数の消費・払出・進行を従来と揃える',()=>{
  let seedA=12345,seedB=12345,callsA=0,callsB=0;
  const rngA=(n:number)=>{callsA++;seedA=(Math.imul(seedA,1664525)+1013904223)>>>0;return seedA%n;};
  const rngB=(n:number)=>{callsB++;seedB=(Math.imul(seedB,1664525)+1013904223)>>>0;return seedB%n;};
  const a=newGaisen(1,'trial-2'),b=newGaisen(1,'trial-2');
  for(let game=0;game<1000;game++){
   lever(a,rngA);lever(b,rngB,undefined,true);
   const copy=structuredClone(b.pending!);delete copy.control;expect(copy).toEqual(a.pending);
   const order=a.pending!.phase==='gstop'?[0,1,2]:a.pending!.order;
   for(const i of order)if(a.pending&&!a.pending.stops.includes(i)){stop(a,i,rngA);stop(b,i,rngB);}
   const state=structuredClone(b);delete state.lastReelStops;const expected=structuredClone(a);delete expected.lastReelStops;
   expect(state).toEqual(expected);expect(callsA).toBe(callsB);
  }
 });
 it('不正な位置と同じSTOPの再送を拒否し、保存済み結果へ二重払いしない',()=>{
  const s=spin('god'),before=structuredClone(s);
  for(const input of [-1,20,.5,NaN,Infinity])expect(()=>stop(s,0,()=>0,input)).toThrow('停止位置');expect(s).toEqual(before);
  stop(s,0,()=>0,0);const partial=structuredClone(s);expect(()=>stop(s,0,()=>0,5)).toThrow();expect(s).toEqual(partial);
  stop(s,1,()=>0,2);stop(s,2,()=>0,3);const saved=structuredClone(s);expect(()=>stop(s,2,()=>0,3)).toThrow();expect(s).toEqual(saved);
 });
});

import {describe,it,expect,vi} from 'vitest';
import {historyAward,historySymbol,type HistorySymbol} from '../src/services/casino/gaisen/historyRules.js';
import {lever,stop,scenario,type GaisenState,type Phase} from '../src/services/casino/gaisen/engine.js';
import {preparePhaseSpin,type PhaseFlag} from '../src/services/casino/gaisen/phaseRules.js';
import {simulationOrder,simulateGaisen} from '../src/services/casino/gaisen/simulation.js';
import {actTrial,freshFloor,trialView} from '../src/services/casino/gaisen/trial.js';
const max=(n:number)=>n-1;
const repeated=(symbol:HistorySymbol,n:number)=>Array.from({length:n},()=>symbol);
const rules=(phase:Phase='normal',setting:GaisenState['setting']=1,gstopReturn:Phase='normal')=>({phase,setting,gstopReturn});
function spin(s:GaisenState,flag:PhaseFlag,order?:number[]){
 lever(s,max,flag==='god'?'god':flag==='red'?'red7':'none');Object.assign(s.pending!,preparePhaseSpin(flag,max));
 for(const i of order??simulationOrder(s.pending!,'follow-navi'))stop(s,i,max);
}
describe('trial-2の小役履歴',()=>{
 it('通常3連の設定別境界、4/5連の優先順位を一度だけ抽選する',()=>{
  for(const [setting,b,y] of [[1,500,2000],[2,500,2000],[3,750,2250],[4,1250,2500],[5,1500,3000],[6,2000,3330]] as const){
   for(const [symbol,cutoff] of [['blue',b],['yellow',y]] as const){
    expect(historyAward(rules('normal',setting),repeated(symbol,3),()=>cutoff-1)).toMatchObject(symbol==='blue'?{gstop:1,gg:0}:{gstop:0,gg:1});
    expect(historyAward(rules('normal',setting),repeated(symbol,3),()=>cutoff)).toMatchObject({gg:0,gstop:0});
   }
  }
  const rng=vi.fn(max);expect(historyAward(rules(),repeated('blue',5),rng)).toMatchObject({gg:1,gstop:1});expect(rng).not.toHaveBeenCalled();
  expect(historyAward(rules(),repeated('blue',4),rng)).toMatchObject({gg:0,gstop:1});
  expect(historyAward(rules(),repeated('yellow',5),rng)).toMatchObject({gg:1,gstop:0});
  const chance=vi.fn(()=>0);historyAward(rules(),repeated('blue',3),chance);expect(chance).toHaveBeenCalledTimes(1);
 });
 it('GGは青/黄5連、SGGは両方GG、G-STOPは戻る区間の条件を使う',()=>{
  for(const phase of ['gg','sgg'] as const)for(const symbol of ['blue','yellow'] as const){
   for(const n of [3,4])expect(historyAward(rules(phase),repeated(symbol,n),()=>0)).toMatchObject({gg:0,gstop:0});
   expect(historyAward(rules(phase),repeated(symbol,5),max)).toMatchObject(phase==='gg'&&symbol==='blue'?{gg:0,gstop:1}:{gg:1,gstop:0});
  }
  expect(historyAward(rules('gstop',1,'normal'),repeated('blue',4),max).gstop).toBe(1);
  expect(historyAward(rules('gstop',1,'gg'),repeated('blue',4),max).gstop).toBe(0);
  expect(historyAward(rules('gzone'),repeated('yellow',4),max).gg).toBe(1);
 });
 it('白点5連・宝石・赤7・GODの条件と上位優先、古い履歴の失効を守る',()=>{
  expect(historyAward(rules('gg'),repeated('white',5),()=>104).gstop).toBe(1);expect(historyAward(rules('gg'),repeated('white',5),()=>105).gstop).toBe(0);
  expect(historyAward(rules('sgg'),repeated('white',5),()=>0).gstop).toBe(0);
  expect(historyAward(rules(),['gem','none','gem'],()=>1249).gg).toBe(1);expect(historyAward(rules(),['gem','none','gem'],()=>1250).gg).toBe(0);
  expect(historyAward(rules(),repeated('gem',3),()=>4999).gg).toBe(1);expect(historyAward(rules(),repeated('gem',3),()=>5000).gg).toBe(0);
  expect(historyAward(rules(),repeated('gem',4),max).gg).toBe(1);
  expect(historyAward(rules(),['gem','gem','none'],()=>0).gg).toBe(0);
  expect(historyAward(rules(),['gem','none','none','none','none','gem'],()=>0).gg).toBe(0);
  expect(historyAward(rules('sgg'),['red','blue','red'],()=>2499).gg).toBe(1);expect(historyAward(rules('sgg'),['red','blue','red'],()=>2500).gg).toBe(0);
  expect(historyAward(rules('sgg'),['red','red'],max).gg).toBe(1);expect(historyAward(rules('sgg'),['red','blue','red','blue','red'],max).gg).toBe(1);
  expect(historyAward(rules('gg'),['god','blue','god'],max).gg).toBe(1);expect(historyAward(rules(),['god','blue','god'],max).gg).toBe(1);
 });
 it('中段青7も青、下段黄7は黄、フェイクは宝石、ミスは成立履歴にしない',()=>{
  for(const [flag,mark] of [['blue','blue'],['middleBlue','blue'],['yellowReplay','yellow'],['fake','gem'],['reverseFake','gem'],['special','gem'],['coinB','none'],['small','white'],['red','red'],['god','god']] as const){
   const s=scenario(1,'sgg','trial-2');lever(s,max,'none');Object.assign(s.pending!,preparePhaseSpin(flag,max));s.pending!.stops=simulationOrder(s.pending!,'follow-navi');expect(historySymbol(s.pending!)).toBe(mark);
  }
  const s=scenario(1,'sgg','trial-2');lever(s,max,'none');Object.assign(s.pending!,preparePhaseSpin('reverseRed',max));s.pending!.stops=[0,1,2];expect(historySymbol(s.pending!)).toBe('blue');
  Object.assign(s.pending!,preparePhaseSpin('small',max));expect(historySymbol(s.pending!)).toBe('none');
 });
 it('GGの3/4連で突入せず、5連のG-STOPを開始。SGG赤7の基礎獲得と履歴追加を両立',()=>{
  const s=scenario(1,'gg','trial-2');for(let i=0;i<4;i++)spin(s,'blue');expect(s.phase).toBe('gg');expect(s.ggLeft).toBe(96);
  spin(s,'blue');expect(s.phase).toBe('gstop');expect(s.gstopReturn).toBe('gg');expect(s.ggLeft).toBe(95);
  const t=scenario(1,'sgg','trial-2');spin(t,'red');expect(t.stocks).toBe(2);lever(t,max,'red7');stop(t,2,max);expect(t.symbolHistory).toEqual(['red']);stop(t,1,max);expect(t.stocks).toBe(2);stop(t,0,max);expect(t.stocks).toBe(4);expect(t.winEvent?.added).toBe(2);expect(t.sggLeft).toBe(16);
  expect(()=>stop(t,0,max)).toThrow();expect(t.stocks).toBe(4);
 });
 it('G-STOP中の追加当選を待機し、今の残りとHOLDを失わず次回を開始する',()=>{
  const s=scenario(1,'gstop','trial-2');s.symbolHistory=repeated('blue',3);s.hold='V';spin(s,'blue');
  expect(s.gstopQueue).toBe(1);expect(s.gstopLeft).toBe(5);expect(s.phase).toBe('gstop');
  // 終了する遊技で当選しない停止形に固定し、待機分を一度だけ開始。
  s.gstopLeft=1;s.hold=null;lever(s,max,'none');s.pending!.group=['1','3','5'];stop(s,0,()=>0);stop(s,1,()=>1);stop(s,2,()=>2);
  expect(s.phase).toBe('gstop');expect(s.gstopQueue).toBe(0);expect(s.gstopLeft).toBe(5);
 });
 it('直近5GとG-STOP待機を保存し、別台再開後も同じ次回判定になる',()=>{
  const f=freshFloor(0,'trial-2'),act=(action:string,machine=1,more={})=>actTrial(f,'a','a',{action,machine,revision:f.revision,...more},0,max);
  act('seat');act('scenario',1,{scenario:'sgg'});const s=f.machines[0]!.state;s.symbolHistory=['gem','blue','gem'];s.gstopQueue=2;
  act('leave');Object.assign(f,JSON.parse(JSON.stringify(f)));act('seat',2);expect(trialView(f,'a').own).toMatchObject({symbolHistory:['gem','blue','gem'],gstopQueue:2});
  const t=f.machines[1]!.state;t.sggLeft=1;t.medusa=0;t.ex=false;spin(t,'none');expect(t.phase).toBe('gstop');expect(t.gstopQueue).toBe(1);
  expect(t.symbolHistory).toEqual(['gem','blue','gem','none']);expect(t.version).toBe('trial-2');
  const old=scenario(1,'gg');lever(old,max,'none');for(const i of [0,1,2])stop(old,i,max);expect(old.symbolHistory).toBeUndefined();
 });
 it('自然抽選を再現し、履歴上乗せ後も会計とストック数が整合する',()=>{
  const a=simulateGaisen(1,100000,71,'follow-navi','trial-2'),b=simulateGaisen(1,100000,71,'follow-navi','trial-2');expect(a).toEqual(b);
  expect(a.awardedSets).toBe(a.startedSets+a.unfinished.stocks);expect(a.finalBalance).toBe(a.initialBalance+a.refillPoints+a.net);
 });
});

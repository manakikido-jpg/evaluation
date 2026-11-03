import {describe,it,expect,vi} from 'vitest';
import {FRONT_MODES,MODE_TRANSITIONS,MODE_DRAW_SIZE,percentWeights,drawFrontMode,frontHitPercent,backTransition,backHitPercent,resetFrontMode,resetCeiling,type ModeContext} from '../src/services/casino/gaisen/modeRules.js';
import {LOOP_WEIGHTS,drawLoop,roleLoopTable,historyLoopTable} from '../src/services/casino/gaisen/loopRules.js';
import {GSTOP_GROUPS,GROUP_WEIGHTS,drawGstopGroup,drawHoldGroup,isHold,isReach} from '../src/services/casino/gaisen/gstopRules.js';
import {drawSggResetLoop} from '../src/services/casino/gaisen/sggLoopRules.js';
import {FLAGS,preparePhaseSpin,type PhaseFlag} from '../src/services/casino/gaisen/phaseRules.js';
import {newGaisen,scenario,lever,stop,isProtected,pendingOmenSets,type Setting,type GaisenState} from '../src/services/casino/gaisen/engine.js';
import {actTrial,expireFloor,freshFloor,trialView} from '../src/services/casino/gaisen/trial.js';
import {simulationOrder} from '../src/services/casino/gaisen/simulation.js';
const miss=(n:number)=>n-1;
function begin(s:GaisenState,flag:PhaseFlag){lever(s,miss,'none');Object.assign(s.pending!,preparePhaseSpin(flag,miss));}
function spin(s:GaisenState,flag:PhaseFlag,rng=miss){begin(s,flag);for(const i of simulationOrder(s.pending!,'follow-navi'))stop(s,i,rng);}
const contexts:ModeContext[]=['normal','omen','gg','gstop','sgg'];
describe('表裏モードと追加抽選の仕上げ',()=>{
 it.each(contexts)('%sの全モード・設定・役の合計と抽選境界が一致する',ctx=>{
  for(const mode of FRONT_MODES)for(let setting=1;setting<=6;setting++)for(const flag of Object.keys(FLAGS) as PhaseFlag[]){
   const row=MODE_TRANSITIONS[ctx][mode][setting-1]![flag];let offset=0;
   for(const [next,weight] of row){expect(weight).toBeGreaterThanOrEqual(0);if(weight>0)for(const ticket of [offset,offset+weight-1])expect(drawFrontMode(ctx,mode,setting as Setting,flag,n=>{expect(n).toBe(MODE_DRAW_SIZE);return ticket;})).toBe(next);offset+=weight;}
   expect(offset).toBe(MODE_DRAW_SIZE);
   const hit=frontHitPercent(ctx,mode,setting as Setting,flag);expect(hit).toBeGreaterThanOrEqual(0);expect(hit).toBeLessThanOrEqual(100);
  }
 });
 it('公開表の小さな丸め差だけを補正し、大きな不一致を拒否する',()=>{
  expect(percentWeights([75,17.6,6.3,.8,.4]).reduce((a,b)=>a+b,0)).toBe(100000);
  expect(()=>percentWeights([50,60])).toThrow();expect(()=>percentWeights([-1,101])).toThrow();
 });
 it('設定差と高確・確定役の移行を区別する',()=>{
  expect(frontHitPercent('normal','low1',1,'none')).toBe(.01);
  expect(frontHitPercent('normal','low1',6,'none')).toBe(.10);
  expect(frontHitPercent('normal','long',1,'yellowMiddle')).toBe(100);
  expect(drawFrontMode('normal','low1',1,'special',()=>0)).toBe('long');
  expect(drawFrontMode('normal','low1',1,'special',miss)).toBe('super');
  expect(drawFrontMode('gstop','prepare',1,'red',()=>0)).toBe('prepare');
  expect(drawFrontMode('gstop','v',1,'red',()=>0)).toBe('v');
  expect(drawFrontMode('gg','long',1,'coinB',miss)).toBe('super');
 });
 it('通常当選にVの3セットを確保し、最終STOP前や再送で増やさない',()=>{
  const s=newGaisen(1,'trial-2');s.frontMode='v';begin(s,'yellowMiddle');stop(s,0,miss);stop(s,1,miss);expect(pendingOmenSets(s)).toBe(0);
  const saved=JSON.parse(JSON.stringify(s)) as GaisenState;stop(saved,2,miss);
  expect(saved.frontMode).toBe('short');expect(saved.omenStocks).toBe(3);expect(saved.bonusLoops).toHaveLength(1);expect(saved.stocks).toBe(0);
  expect(()=>stop(saved,2,miss)).toThrow();expect(saved.omenStocks).toBe(3);
  saved.omen=1;spin(saved,'none');expect(saved).toMatchObject({phase:'gg',sets:1,stocks:2,frontMode:'short'});
 });
 it('本前兆中の追加当選は残りGを延ばさず、前兆終了時に合算する',()=>{
  const s=scenario(1,'omen','trial-2');s.frontMode='super';s.omen=1;spin(s,'special');
  expect(s).toMatchObject({phase:'gg',sets:1,stocks:1,omenStocks:0,ggLeft:100});
 });
 it('裏天国当選と表の移行は独立し、G-STOP/G-ZONEで裏抽選をしない',()=>{
  expect(backHitPercent('normal','high','yellowReplay')).toBe(25);
  expect(backHitPercent('gg','high','blue')).toBe(15.6);
  expect(backTransition('normal','high',1,'blue',()=>0)).toBe('high');
  expect(backTransition('gstop','high',1,'blue',()=>0)).toBe('high');
  const s=scenario(1,'back-high','trial-2');spin(s,'yellowReplay',()=>0);expect(s.omenStocks).toBe(1);
  const g=scenario(1,'gstop','trial-2');g.backMode='high';begin(g,'blue');g.pending!.group=['1','3','5'];
  stop(g,0,()=>0);stop(g,1,()=>2);stop(g,2,n=>n===3?1:0);expect(g.backMode).toBe('high');expect(g.stocks).toBe(0);
  const z=newGaisen(1,'trial-2');z.phase='gzone';z.zoneLeft=2;z.backMode='high';spin(z,'yellowReplay',()=>0);expect(z.backMode).toBe('high');expect(z.stocks).toBe(0);
 });
 it('裏当選とGG中の表当選で各1権利、EXの通常抽選は二重に足さない',()=>{
  const g=scenario(1,'gg','trial-2');g.backMode='high';spin(g,'blue',()=>0);expect(g.stocks).toBe(1);expect(g.bonusLoops).toHaveLength(1);
  const s=scenario(1,'sgg-ex','trial-2');s.frontMode='super';spin(s,'special',()=>0);expect(s.stocks).toBe(2);expect(s.bonusLoops).toHaveLength(1);
  const f=scenario(1,'sgg-ex','trial-2');spin(f,'fake',()=>0);expect(f.stocks).toBe(1);
 });
 it('全ループ表の境界と役/履歴による表の選択が一致する',()=>{
  LOOP_WEIGHTS.forEach((rows,table)=>{let at=0;for(const [rate,weight] of rows){if(weight)for(const ticket of [at,at+weight-1])expect(drawLoop(table,()=>ticket)).toBe(rate);at+=weight;}expect(at).toBe(100000);});
  expect(roleLoopTable('normal','short','blue')).toBe(8);expect(roleLoopTable('normal','long','blue')).toBe(9);
  expect(roleLoopTable('normal','super','special')).toBe(5);expect(roleLoopTable('gg','super','coinB')).toBe(7);
  expect(roleLoopTable('sgg','low1','blue',true)).toBe(7);
  expect(historyLoopTable('normal','normal',['yellow','yellow','yellow','yellow','yellow'])).toBe(5);
  expect(historyLoopTable('sgg','normal',['gem','gem','gem','gem','gem'])).toBe(4);
  expect(historyLoopTable('gg','normal',['gem','gem','gem','gem','gem'])).toBe(6);
  expect(historyLoopTable('sgg','normal',['red','red'])).toBe(2);
  expect(historyLoopTable('normal','normal',['yellow','none','yellow','yellow','yellow'])).toBe(0);
 });
 it('メデューサでは減算前の残りG、EXでは残りGに依らない巻き戻し表を選ぶ',()=>{
  for(const left of [0,7,11])expect(drawSggResetLoop(left,()=>0,'medusa')).toBe(25);
  expect(drawSggResetLoop(8,()=>7500,'medusa')).toBe(25);
  for(let left=0;left<=16;left++)expect(drawSggResetLoop(left,()=>0,'ex')).toBe(1);
  const s=scenario(1,'medusa','trial-2');s.sggLeft=7;spin(s,'reverseRed',()=>0);expect(s.sggLoops).toEqual([25]);
 });
 it('前兆中のループは当選済み権利へ足し、次Gから各一度だけ進める',()=>{
  const s=scenario(1,'omen','trial-2');s.bonusLoops=[50,75];begin(s,'none');stop(s,0,miss);stop(s,1,miss);
  const rng=vi.fn((n:number)=>n===100?60:miss(n));stop(s,2,rng);
  expect(s).toMatchObject({omen:4,omenStocks:2,bonusLoops:[75],stocks:0});
  expect(rng.mock.calls.filter(([n])=>n===100)).toHaveLength(2);
  const t=newGaisen(1,'trial-2');t.bonusLoops=[1];expect(isProtected(t)).toBe(true);
 });
 it('旧保存を読んで停止済みフラグを保ち、新しい内部情報を公開しない',()=>{
  const f=freshFloor(0,'trial-2');actTrial(f,'a','試遊',{action:'seat',machine:1,revision:0},0,miss);
  const s=f.machines[0]!.state;begin(s,'none');const flag=s.pending!.model;stop(s,0,miss);stop(s,1,miss);
  const loaded=JSON.parse(JSON.stringify(f));const state=loaded.machines[0].state;expect(state.pending.model).toEqual(flag);stop(state,2,miss);
  expect(FRONT_MODES).toContain(state.frontMode);expect(state.backMode).toBe('low');
  state.bonusLoops=[75];state.holdGroup=['V','S'];state.ceilingLimit=510;
  const view=JSON.stringify(trialView(loaded,'a'));
  for(const hidden of ['frontMode','backMode','bonusLoops','holdGroup','ceilingLimit','reservedReset'])expect(view).not.toContain(hidden);
 });
});
describe('G-STOPの群・鏡・HOLD',()=>{
 it('区間別と成立役別の群を選び、全表が100%となる',()=>{
  for(const weights of Object.values(GROUP_WEIGHTS))expect(weights.reduce((n,[,w])=>n+w,0)).toBe(100000);
  expect(drawGstopGroup('normal','none',()=>0)).toEqual(GSTOP_GROUPS[0]);
  expect(drawGstopGroup('high','none',()=>0)).toEqual(GSTOP_GROUPS[1]);
  expect(drawGstopGroup('low','middleBlue',()=>0)).toEqual(GSTOP_GROUPS[2]);
  expect(drawGstopGroup('normal','special',miss)).toEqual(GSTOP_GROUPS[7]);
  expect(drawGstopGroup('low','yellowMiddle',()=>0)).toEqual(GSTOP_GROUPS[3]);
 });
 it('HOLDは4種類のみ、リーチ目は5種類を認識する',()=>{
  for(const x of ['VSV','SVS','7S7','S7S'])expect(isHold(x.split(''))).toBe(true);
  for(const x of ['V1V','S3S','757','VVV','135'])expect(isHold(x.split(''))).toBe(false);
  for(const x of ['135','175','315','753','V31'])expect(isReach(x.split(''))).toBe(true);
  expect(isReach(['1','5','3'])).toBe(false);
 });
 it('前ゲームの鏡を引き継ぎ、HOLD中のレア役で当選図柄だけに絞る',()=>{
  for(const group of GSTOP_GROUPS){const held=group.includes('V')?'V':'7';
   expect(drawHoldGroup(group,held,'yellowMiddle',miss)).toEqual([held]);
   expect(drawHoldGroup(group,held,'blue',()=>0)).toHaveLength(group.filter(x=>x!=='鏡').length);
  }
  const s=scenario(1,'gstop','trial-2');s.hold='V';s.holdGroup=GSTOP_GROUPS[3]!.slice();
  lever(s,()=>0,'rare');expect(s.pending).toMatchObject({group:['V'],stops:[0,2],hold:true});
  const loaded=JSON.parse(JSON.stringify(s)) as GaisenState;stop(loaded,1,miss);
  expect(loaded).toMatchObject({phase:'gg',sets:1,stocks:2,hold:null});
 });
 it('鏡は次の非鏡に変化し、第三停止で鏡を引かない',()=>{
  const s=scenario(1,'gstop','trial-2');begin(s,'none');s.pending!.group=GSTOP_GROUPS[3]!.slice();
  stop(s,0,()=>0);expect(s.pending!.symbols).toEqual(['鏡',null,null]);
  stop(s,1,()=>2);expect(s.pending!.symbols).toEqual(['鏡','鏡',null]);
  stop(s,2,n=>n===2?0:miss(n));expect(s.display).toEqual(['V','V','V']);expect(s.phase).toBe('gg');
 });
 it('GODでG-STOPを終え、5セットと前兆権利をGGへ渡す',()=>{
  const s=scenario(1,'omen','trial-2');s.phase='gstop';s.gstopReturn='omen';s.gstopLeft=4;s.hold='S';
  spin(s,'god');expect(s).toMatchObject({phase:'gg',sets:1,stocks:5,omenStocks:0,hold:null,bonusLoops:[75]});
 });
});
describe('設定変更時の抽選を保存する',()=>{
 it('天井の設定差・境界を区別し、開始モードの全設定を抽選できる',()=>{
  for(let n=1;n<=6;n++){const setting=n as Setting;
   expect(resetCeiling(setting,()=>999)).toBe(510);expect(resetCeiling(setting,()=>1000)).toBe(1000);
   expect(resetCeiling(setting,miss)).toBe(n<=3?1000:1480);
   expect(FRONT_MODES).toContain(resetFrontMode(setting,()=>0));expect(FRONT_MODES).toContain(resetFrontMode(setting,miss));
  }
  expect(resetCeiling(6,()=>9530)).toBe(1000);expect(resetCeiling(6,()=>9531)).toBe(1480);
 });
 it('短縮天井到達を一度だけ確保し、GG開始後は1480Gへ戻す',()=>{
  const s=newGaisen(1,'trial-2');s.ceilingLimit=510;s.normalGames=509;spin(s,'none');
  expect(s).toMatchObject({ceilingStocks:1,ceilingLeft:24});
  for(let i=0;i<24;i++)spin(s,'none');expect(s).toMatchObject({phase:'gg',sets:1,stocks:0,ceilingLimit:1480});
 });
 it('予約時だけ乱数を使い、JSON復元・期限・別台再開で引き直さない',()=>{
  const f=freshFloor(0,'trial-2');const act=(action:string,machine=1,extra={},rng=miss)=>actTrial(f,'a','試遊',{action,machine,revision:f.revision,...extra},0,rng);
  act('seat');act('scenario',1,{scenario:'omen'});const rng=vi.fn(()=>0);act('setting',1,{setting:6},rng);
  expect(rng).toHaveBeenCalledTimes(2);expect(f.machines[0]!.reservedReset).toEqual({front:'low1',ceiling:510});
  const loaded=JSON.parse(JSON.stringify(f));expireFloor(loaded,3600000);
  expect(loaded.machines[0].state).toMatchObject({setting:6,frontMode:'low1',ceilingLimit:510});
  expect(loaded.players['u:a'].saved).toMatchObject({setting:1,omenStocks:1});
  actTrial(loaded,'a','試遊',{action:'seat',machine:2,revision:loaded.revision},3600001,()=>{throw Error('再開で再抽選');});
  expect(loaded.machines[1].state.setting).toBe(1);
  expect(loaded.machines[0].reservedReset).toBeUndefined();expect(rng).toHaveBeenCalledTimes(2);
 });
});

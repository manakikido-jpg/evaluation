import {describe,it,expect,vi} from 'vitest';
import {SGG_LOOP_WEIGHTS,drawSggResetLoop,drawSggRescueLoop} from '../src/services/casino/gaisen/sggLoopRules.js';
import {scenario,lever,stop,isProtected,type GaisenState} from '../src/services/casino/gaisen/engine.js';
import {preparePhaseSpin,type PhaseFlag} from '../src/services/casino/gaisen/phaseRules.js';
import {simulationOrder} from '../src/services/casino/gaisen/simulation.js';
import {actTrial,expireFloor,freshFloor,trialView} from '../src/services/casino/gaisen/trial.js';
const miss=(n:number)=>n-1;
function begin(s:GaisenState,flag:PhaseFlag='none'){lever(s,miss,'none');Object.assign(s.pending!,preparePhaseSpin(flag,miss));}
function finish(s:GaisenState,rng=miss){for(const i of simulationOrder(s.pending!,'follow-navi'))stop(s,i,rng);}
function spin(s:GaisenState,flag:PhaseFlag='none',rng=miss){begin(s,flag);finish(s,rng);}
describe('SGGの通常巻き戻しと救済ループ',()=>{
 it('残り0〜15Gの表は合計1万で、全区間の両端を正しく選ぶ',()=>{
  for(let remaining=0;remaining<=15;remaining++){
   const rows=remaining===0?SGG_LOOP_WEIGHTS.last:[7,11].includes(remaining)?SGG_LOOP_WEIGHTS.special:SGG_LOOP_WEIGHTS.ordinary;
   let at=0;for(const [rate,weight] of rows){
    for(const ticket of [at,at+weight-1])expect(drawSggResetLoop(remaining,n=>{expect(n).toBe(10000);return ticket;})).toBe(rate);
    at+=weight;
   }expect(at).toBe(10000);
  }
  expect([0,1,2,3].map(x=>drawSggRescueLoop(n=>{expect(n).toBe(4);return x;}))).toEqual([50,50,50,75]);
 });
 it.each([[16,1],[12,25],[8,25],[1,50]] as const)('残り%sGの赤7で減算後の表を選び、次ゲームから抽選する',(left,rate)=>{
  const s=scenario(1,'sgg','trial-2');s.sggLeft=left;
  begin(s,'reverseRed');stop(s,2,miss);stop(s,1,miss);expect(s.sggLoops).toBeUndefined();
  stop(s,0,n=>n===10000?7500:miss(n));expect(s).toMatchObject({stocks:2,sggLeft:16,sggLoops:[rate]});
  const selected=s.sggLoops![0]!;spin(s,'none',n=>n===100?selected-1:miss(n));expect(s.stocks).toBe(3);
  spin(s,'none',n=>n===100?selected:miss(n));expect(s.stocks).toBe(3);expect(s.sggLoops).toEqual([]);
 });
 it('メデューサ/EXには巻き戻し、GODには別ループを付け、逆押しミスには付けない',()=>{
  for(const name of ['medusa','sgg-ex'] as const){const s=scenario(1,name,'trial-2');spin(s,'reverseRed');expect(s.sggLoops).toEqual([75]);}
  const god=scenario(1,'sgg','trial-2');spin(god,'god');expect(god.sggLoops).toEqual([]);expect(god.bonusLoops).toEqual([75]);
  const s=scenario(1,'sgg','trial-2');begin(s,'reverseRed');for(const i of [0,1,2])stop(s,i,miss);
  expect(s).toMatchObject({sggRescueEligible:false,sggLeft:15,stocks:1,sggLoops:[]});
 });
 it('救済の資格を16G追跡し、終了時にはセットを確約しない',()=>{
  for(const ticket of [0,3]){
   const s=scenario(1,'sgg','trial-2');for(let i=0;i<15;i++)spin(s);
   expect(s).toMatchObject({sggRescueEligible:true,sggLeft:1,sggLoops:[]});
   spin(s,'none',n=>n===4?ticket:miss(n));expect(s).toMatchObject({phase:'gg',sets:1,stocks:0,sggRescueEligible:false,sggLoops:[ticket===0?50:75]});
   spin(s);expect(s).toMatchObject({stocks:0,sggLoops:[]});
  }
 });
 it.each(['red','reverseRed','fake','reverseFake','god','special'] as const)('%s成立後は時間停止が終わっても救済しない',flag=>{
  const s=scenario(1,'sgg','trial-2');spin(s,flag);expect(s.sggRescueEligible).toBe(false);
  s.ex=false;s.medusa=0;s.medusaInfinite=false;s.sggLeft=1;spin(s);expect(s.sggLoops).toEqual([]);
 });
 it('時間停止の発生/初期EXで資格を消し、後告知は先に発動する',()=>{
  const s=scenario(1,'sgg','trial-2');spin(s,'middleBlue',()=>0);expect(s.sggRescueEligible).toBe(false);
  const ex=scenario(1,'normal','trial-2');spin(ex,'red',()=>0);expect(ex).toMatchObject({ex:true,sggRescueEligible:false});
  const t=scenario(1,'sgg','trial-2');t.sggLeft=1;spin(t,'small',()=>0);
  expect(t).toMatchObject({phase:'sgg',medusaInfinite:true,sggRescueEligible:false,sggLoops:[]});
 });
 it('旧保存の履歴を推測して救済せず、新しいSGG開始時から追跡する',()=>{
  const s=scenario(1,'sgg','trial-2');delete s.sggRescueEligible;s.sggLeft=1;spin(s);expect(s.sggLoops).toEqual([]);
  spin(s,'red');expect(s.sggRescueEligible).toBe(true);
  const old=scenario(1,'sgg');old.sggLeft=1;lever(old,miss,'none');for(const i of [0,1,2])stop(old,i,miss);
  expect(old.sggLoops).toBeUndefined();expect(old.sggRescueEligible).toBeUndefined();
 });
 it('重なるループは各1回、天井と別に進み、JSON再開/重複STOPで増えない',()=>{
  const s=scenario(1,'sgg','trial-2');s.sggLoops=[50,75];s.ceilingLoop=80;
  begin(s);stop(s,0,miss);const loaded=JSON.parse(JSON.stringify(s)) as GaisenState;
  stop(loaded,1,miss);expect(loaded.stocks).toBe(1);
  const rng=vi.fn((n:number)=>n===100?60:miss(n));stop(loaded,2,rng);
  expect(rng.mock.calls.filter(([n])=>n===100)).toHaveLength(3);expect(loaded.stocks).toBe(3);expect(loaded.sggLoops).toEqual([75]);
  expect(()=>stop(loaded,2,rng)).toThrow();expect(loaded.stocks).toBe(3);
 });
 it.each([true,false])('救済資格%sを途中保存・期限後の別台再開へ引き継ぐ',eligible=>{
  const f=freshFloor(0,'trial-2');const act=(action:string,machine=1,extra={})=>actTrial(f,'a','試遊',{action,machine,revision:f.revision,...extra},0,miss);
  act('seat');act('scenario',1,{scenario:'sgg'});const s=f.machines[0]!.state;
  s.sggLeft=1;s.sggRescueEligible=eligible;begin(s);stop(s,0,miss);
  expireFloor(f,3600000);act('seat',2);expect(f.machines[1]!.state.sggRescueEligible).toBe(eligible);
  act('stop',2,{index:1});act('stop',2,{index:2});
  expect(f.machines[1]!.state.sggLoops).toEqual(eligible?[75]:[]);
 });
 it('ループだけ残る通常区間も1時間保護し、別台の状態/設定予約を最後まで守る',()=>{
  const f=freshFloor(0,'trial-2');const act=(action:string,machine=1,extra={},rng=miss)=>actTrial(f,'a','試遊',{action,machine,revision:f.revision,...extra},0,rng);
  act('seat');const s=f.machines[0]!.state;s.sggLoops=[50];s.sggRescueEligible=false;
  expect(isProtected(s)).toBe(true);expireFloor(f,600000);expect(f.machines[0]!.owner).toBe('a');
  expireFloor(f,3600000);const base=structuredClone(f.machines[1]!.state);act('seat',2);act('setting',2,{setting:6});
  const m=f.machines[1]!;expect(m.state.sggLoops).toEqual([50]);expect(m.base).toEqual(base);
  const view=JSON.stringify(trialView(f,'a'));expect(view).not.toContain('sggLoops');expect(view).not.toContain('sggRescueEligible');
  begin(m.state);for(const index of [0,1,2])act('stop',2,{index},n=>n===100?49:miss(n));
  expect(m.state).toMatchObject({phase:'gg',sets:1,setting:1});expect(m.reservedSetting).toBe(6);
  // ループだけが最後まで続く場合、予約設定と受入台を先に消費しない。
  m.state.phase='gzone';m.state.zoneLeft=1;m.state.stocks=0;begin(m.state);
  for(const index of [0,1,2])act('stop',2,{index});
  expect(m.base).toBeNull();expect(m.reservedSetting).toBeNull();expect(m.state.setting).toBe(6);
 });
});

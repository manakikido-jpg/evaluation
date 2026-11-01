import {describe,it,expect} from 'vitest';
import {lever,stop,newGaisen,scenario,ORDERS,visibleReels,type GaisenState,type Spin} from '../src/services/casino/gaisen/engine.js';
import {FLAGS,PHASE_TABLES,PHASE_DRAW_SIZE,drawPhaseFlag,phaseTable,preparePhaseSpin,phaseOutcome,spinNavi,type PhaseFlag} from '../src/services/casino/gaisen/phaseRules.js';
import {actTrial,expireFloor,freshFloor,trialView} from '../src/services/casino/gaisen/trial.js';
import {simulationOrder,simulateGaisen,summarizeGaisen} from '../src/services/casino/gaisen/simulation.js';

function begin(s:GaisenState,flag:PhaseFlag,rng=(n:number)=>n-1):Spin{
 lever(s,rng,FLAGS[flag].role==='god'?'god':FLAGS[flag].role==='red7'?'red7':'none');const p=s.pending!,prepared=preparePhaseSpin(flag,rng);
 Object.assign(p,prepared);return p;
}
const complete=(s:GaisenState,order=simulationOrder(s.pending!,'follow-navi'))=>{for(const i of order)stop(s,i,n=>n-1);};
describe('神殿スロット trial-2 の区間別抽選',()=>{
 it('全抽選境界を隙間なく覆い、GODと共通赤7の基礎確率を変えない',()=>{
  for(const kind of Object.keys(PHASE_TABLES) as (keyof typeof PHASE_TABLES)[]){
   const s=newGaisen(1,'trial-2');s.phase=kind==='normal'?'normal':kind==='gg'?'gg':'sgg';s.ex=kind==='sgg-high';
   let n=0;for(const row of PHASE_TABLES[kind]){
    expect(row.weight).toBeGreaterThan(0);
    expect(drawPhaseFlag(s,max=>{expect(max).toBe(PHASE_DRAW_SIZE);return n;})).toBe(row.flag);
    expect(drawPhaseFlag(s,()=>n+row.weight-1)).toBe(row.flag);n+=row.weight;
   }
   expect(n).toBe(PHASE_DRAW_SIZE);
   expect(PHASE_TABLES[kind].find(x=>x.flag==='god')!.weight/n).toBe(1/8192);
   expect(PHASE_TABLES[kind].find(x=>x.flag==='red')!.weight/n).toBe(12/65536);
  }
  const red=(kind:keyof typeof PHASE_TABLES)=>PHASE_TABLES[kind].filter(r=>FLAGS[r.flag].role==='red7').reduce((n,r)=>n+r.weight,0)/PHASE_DRAW_SIZE;
  expect(red('sgg')).toBeCloseTo(1/29.5+1/206.6+12/65536,6);
  expect(red('sgg-high')).toBeGreaterThan(red('sgg'));expect(red('sgg')).toBeGreaterThan(red('normal')*200);
  expect(PHASE_TABLES.normal.some(x=>x.flag==='small'||x.flag==='bell')).toBe(false);
 });
 it('G-ZONEは通常表、G-STOPは戻る区間、メデューサ/EXは高確率表を使う',()=>{
  const s=newGaisen(1,'trial-2');s.phase='gzone';expect(phaseTable(s)).toBe('normal');
  s.phase='gstop';for(const phase of ['normal','omen','gzone','gg'] as const){s.gstopReturn=phase;expect(phaseTable(s)).toBe(phase==='gg'?'gg':'normal');}
  s.phase='sgg';expect(phaseTable(s)).toBe('sgg');s.medusa=1;expect(phaseTable(s)).toBe('sgg-high');
  s.medusa=0;s.ex=true;expect(phaseTable(s)).toBe('sgg-high');
 });
 it('リプレイ・1枚・15枚を区別し、3STOP完了前には払わず再停止も拒否する',()=>{
  for(const [flag,paid] of [['yellowReplay',30],['red',30],['fake',30],['middleBlue',30],['coinA',10],['coinB',10],['coinC',10],['yellowLeft',150],['yellowCommon',150],['yellowMiddle',150],['god',150],['special',0]] as const){
   const s=newGaisen(1,'trial-2');begin(s,flag);stop(s,0,n=>n-1);stop(s,1,n=>n-1);expect(s.output).toBe(0);
   stop(s,2,n=>n-1);expect(s.lastPaid).toBe(paid);expect(s.balance).toBe(100000-30+paid);expect(()=>stop(s,2,()=>0)).toThrow();
   if(flag==='red'){expect(s.phase).toBe('sgg');expect(s.winEvent?.added).toBe(1);}
   if(flag==='yellowReplay'){expect(s.phase).toBe('normal');expect(s.blue).toBe(0);expect(s.yellow).toBe(1);}
  }
 });
 it('4択の15枚/3枚役はナビと停止出目が一致し、ミス時の1枚はレバーで固定する',()=>{
  for(const flag of ['bell','small'] as const)for(let choice=0;choice<4;choice++)for(const order of ORDERS){
   const s=scenario(1,'gg','trial-2');const p=begin(s,flag,n=>n===4?choice:0),correct=order.every((v,i)=>v===p.order[i]);
   expect(p.order[0]).not.toBe(0);expect(spinNavi(p)).toEqual(p.order);complete(s,order);
   expect(s.lastPaid).toBe(correct?flag==='bell'?150:30:10);
   expect(visibleReels(s)).not.toContain(null);
   expect(visibleReels(s).every(x=>x===(flag==='bell'?'黄7':'◆'))).toBe(correct);
  }
  const s=scenario(1,'gg','trial-2');begin(s,'small');complete(s,[0,1,2]);expect(s.lastPaid).toBe(0);
 });
 it('SGGの本物とフェイクは同じ右ナビ、当選は3STOPで確定し残り16Gへ戻る',()=>{
  for(const flag of ['red','reverseRed','reverseFake'] as const){
   const s=scenario(1,'sgg','trial-2');s.sggLeft=2;begin(s,flag);expect(spinNavi(s.pending!)).toEqual([2,1,0]);
   const f=freshFloor(0,'trial-2');f.machines[0]!.owner='a';f.machines[0]!.state=s;
   const view=trialView(f,'a');expect(view.own?.winEvent).toBeNull();expect(view.own?.resultRole).toBeNull();
   expect(JSON.stringify(view)).not.toMatch(/"(model|flag|missUnits|order|group)":/);
   stop(s,2,()=>1);expect(s.stocks).toBe(1);stop(s,1,()=>1);stop(s,0,()=>1);
   expect(s.lastPaid).toBe(30);expect(s.stocks).toBe(flag==='reverseFake'?1:2);expect(s.sggLeft).toBe(flag==='reverseFake'?1:16);
  }
  const s=scenario(1,'sgg','trial-2');begin(s,'reverseRed');complete(s,[0,1,2]);
  expect(s.winEvent).toBeNull();expect(s.lastRole).toBe('replay');expect(s.lastPaid).toBe(30);expect(visibleReels(s)).toEqual(['青7','青7','青7']);
 });
 it('G-STOPは左停止/HOLDの操作を保ち、下部はナビ補助で決済する',()=>{
  const s=scenario(1,'gstop','trial-2');s.gstopReturn='gg';s.ggLeft=50;const p=begin(s,'bell');
  expect(spinNavi(p)).toBeNull();expect(()=>stop(s,1,()=>1)).toThrow();complete(s);expect(s.lastPaid).toBe(150);expect(visibleReels(s)).toEqual(['黄7','黄7','黄7']);
  const t=scenario(1,'gstop','trial-2');t.hold='V';begin(t,'bell');expect(simulationOrder(t.pending!,'follow-navi')).toEqual([1]);complete(t);expect(t.lastPaid).toBe(150);
  const u=scenario(1,'gstop','trial-2');u.hold='V';begin(u,'god');expect(u.pending!.hold).toBe(false);complete(u);expect(u.display).toEqual(['G','O','D']);expect(visibleReels(u)).toEqual(['G','O','D']);
 });
 it('全区間/全フラグの試算は実画面のナビだけを使い、版の異なる試算を混ぜない',()=>{
  for(const phase of ['normal','omen','gg','sgg','gzone','gstop'] as const)for(const flag of Object.keys(FLAGS) as PhaseFlag[]){
   const s=newGaisen(1,'trial-2');s.phase=phase;const p=begin(s,flag),f=freshFloor(0,'trial-2');f.machines[0]!.owner='a';f.machines[0]!.state=s;
   expect(simulationOrder(p,'follow-navi')).toEqual(trialView(f,'a').own!.navi??[0,1,2]);
   if(spinNavi(p)&&FLAGS[flag].order!=='any'){p.stops=simulationOrder(p,'miss-navi');expect(phaseOutcome(p).correct).toBe(false);}
  }
  const a=simulateGaisen(1,30000,71,'follow-navi','trial-2');expect(a).toEqual(simulateGaisen(1,30000,71,'follow-navi','trial-2'));
  const missed=simulateGaisen(1,30000,71,'miss-navi','trial-2');expect(missed.byPhase.gg.bellHits).toBe(0);expect(missed.byPhase.gg.bellMisses).toBeGreaterThan(0);
  expect(a.paidInput).toBe(a.paidGames*30);expect(a.paidOutput-a.paidInput).toBe(a.net);
  expect(a.finalBalance).toBe(a.initialBalance+a.refillPoints+a.net);
  expect(()=>summarizeGaisen([a,simulateGaisen(1,30000,72)])).toThrow();
 });
 it('期限切れ・別台再開・場面変更・予約設定でも新版を維持し途中の抽選を変えない',()=>{
  let f=freshFloor(0,'trial-2');const act=(action:string,machine=1,extra={})=>actTrial(f,'a','a',{action,machine,revision:f.revision,...extra},0,n=>n-1);
  act('seat');act('scenario',1,{scenario:'sgg'});const s=f.machines[0]!.state;begin(s,'reverseRed');stop(s,2,()=>1);const pending=structuredClone(s.pending);
  expireFloor(f,3600000);f=JSON.parse(JSON.stringify(f));act('seat',2);expect(f.machines[1]!.state.pending).toEqual(pending);
  act('stop',2,{index:1});act('stop',2,{index:0});expect(f.machines[1]!.state.lastPaid).toBe(30);expect(f.machines[1]!.state.sggLeft).toBe(16);
  act('leave',2);act('setting',1,{setting:6});expect(f.machines[0]!.state.version).toBe('trial-2');
  expect(f.machines.every(m=>m.state.version==='trial-2')).toBe(true);
 });
});

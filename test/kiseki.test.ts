import {describe,it,expect} from 'vitest';
import {newKiseki,lever,stop,scenario,protectedState,type KisekiState} from '../src/services/casino/kiseki/engine.js';
import {ROLES,ROLE_WEIGHTS,DRAW_SIZE,STRIPS,rows,pattern,roleRows,stopPlan,winningLines,sggGames,drawRole,type KisekiRole} from '../src/services/casino/kiseki/rules.js';
import {freshFloor,act,trialView,expire} from '../src/services/casino/kiseki/trial.js';
const last=(n:number)=>n-1;
function play(s:KisekiState,role:KisekiRole,rng=last,order?:number[]){lever(s,rng,role);for(const i of order??s.pending!.order)stop(s,i,rng);}
describe('軌跡版の独立した遊技',()=>{
 it('確定役の確率を再正規化せず、抽選全境界を固定する',()=>{
  expect(ROLE_WEIGHTS.reduce((n,r)=>n+r.weight,0)).toBe(DRAW_SIZE);let start=0;
  for(const r of ROLE_WEIGHTS){expect(r.weight).toBeGreaterThan(0);expect(drawRole(()=>start)).toBe(r.role);expect(drawRole(()=>start+r.weight-1)).toBe(r.role);start+=r.weight;}
  for(const role of ['god','red','sp'] as const)expect(ROLE_WEIGHTS.find(r=>r.role===role)!.weight).toBe(Math.round(DRAW_SIZE/ROLES[role].denominator));
 });
 it('上/中/下/右上がり/小V/SPを、同じ20コマの停止窓で再現する',()=>{
  expect(STRIPS.map(s=>s.length)).toEqual([20,20,20]);
  for(const role of Object.keys(ROLES) as KisekiRole[]){const pos=stopPlan(role),p=pattern(role);if(p)expect(pos.map((v,i)=>rows(i,v)[roleRows(role)[i]!])).toEqual(p.symbols);else expect(winningLines(pos)).toEqual([]);}
  const small=stopPlan('small');expect(rows(1,small[1]!)).toEqual(['god','red7','gold7']);
  expect(rows(0,19)[2]).toBe(STRIPS[0]![0]);
 });
 it('GODは15枚とPGG50G＋GG3ストック、赤7も15枚でセット制SGGへ',()=>{
  const god=newKiseki();play(god,'god');expect(god.lastPaid).toBe(150);expect(god.phase).toBe('pgg');expect(god.left).toBe(50);expect(god.stocks+god.sets).toBe(4);expect(god.gods).toBe(1);expect(god.loops).toEqual([80]);expect(god.winEvent).toMatchObject({kind:'god',added:4});
  const red=newKiseki();play(red,'red');expect(red.lastPaid).toBe(150);expect(red.lastReplay).toBe(false);expect(red.phase).toBe('sgg');expect([10,20,30,50,100]).toContain(red.left);expect(red.stocks).toBe(1);expect(red.sggSet).toBe(1);
 });
 it('全押し順と全役で、停止済みの帯を変えず、上限0〜150Pを1回だけ払い出す',()=>{
  const orders=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
  for(const role of Object.keys(ROLES) as KisekiRole[])for(const order of orders){const s=newKiseki();lever(s,last,role);const expected=s.pending!.order.slice(),seen=new Map<number,number>();
   for(const i of order){stop(s,i,last);for(const [j,pos]of seen)expect((s.pending?.positions??s.lastPositions)[j]).toBe(pos);seen.set(i,(s.pending?.positions??s.lastPositions)[i]!);}
   const correct=role!=='bell'||order.join()===expected.join();expect(s.lastPaid).toBe(correct?ROLES[role].units*10:0);expect(s.balance).toBe(100000-30+s.lastPaid);expect(s.output).toBe(s.lastPaid);
   if(!correct)expect(winningLines(s.lastPositions)).toEqual([]);const saved=structuredClone(s);expect(()=>stop(s,2,last)).toThrow();expect(s).toEqual(saved);
  }
 });
 it('GG50GとG-ZONE5G、ナビを守ったGG中ガイアは15枚',()=>{
  const s=scenario(1,'gg');play(s,'gaia');expect(s.lastPaid).toBe(150);expect(s.lastLayout).toBe('bell');for(let i=1;i<50;i++)play(s,'none');expect(s.phase).toBe('gzone');expect(s.left).toBe(5);for(let i=0;i<5;i++)play(s,'none');expect(s.phase).toBe('normal');
 });
 it('通常/GG中のSPの1/2は、GG1個と80%ループを付ける',()=>{
  for(const phase of ['normal','gg'] as const){const a=phase==='gg'?scenario(1,'gg'):newKiseki(),b=structuredClone(a);play(a,'sp',()=>0);play(b,'sp',last);expect(a.lastPaid).toBe(150);expect(a.stocks+a.sets).toBe(b.stocks+b.sets+1);expect(a.loops).toContain(80);expect(b.loops).toEqual([]);if(phase==='gg')expect(a.left).toBe(49);}
 });
 it('SGGは16Gへの巻き戻しではなくセット制。5の倍数は10Gなし、100Gは継続権利を追加',()=>{
  for(let i=0;i<10000;i+=13){expect(sggGames(5,'none',()=>i)).not.toBe(10);expect(sggGames(10,'sp',()=>i)).toBe(100);}
  const s=scenario(1,'sgg');s.left=1;play(s,'none');expect(s.phase).toBe('sgg-retry');expect(s.left).toBe(3);play(s,'diagonal');expect(s.phase).toBe('sgg');expect(s.sggSet).toBe(2);expect(s.left).toBe(100);expect(s.sggStocks).toBe(1);
  const fail=scenario(1,'sgg-retry');for(let i=0;i<3;i++)play(fail,'none');expect(fail.phase).toBe('gg');expect(fail.left).toBe(50);
 });
 it('SGG中SPは継続権利3個、保有権利は引き戻し抽選より先に消費する',()=>{
  const s=scenario(1,'sgg');s.left=1;play(s,'sp');expect(s.sggStocks).toBe(3);expect(s.phase).toBe('sgg-retry');play(s,'none');expect(s.sggStocks).toBeGreaterThanOrEqual(2);expect(s.phase).toBe('sgg');
 });
 it('Z-ZONEは黄7で減算を止め、5連で1ストック、Z-GAMEは黄7ごとに加算し青7で終了',()=>{
  const s=scenario(1,'zzone');for(let i=0;i<4;i++){play(s,'bell');expect(s.phase).toBe('zzone');expect(s.left).toBe(5);}play(s,'bell');expect(s.phase).toBe('zgame');expect(s.stocks).toBe(2);play(s,'bell');expect(s.stocks).toBe(3);play(s,'blue');expect(s.phase).toBe('gg');expect(s.stocks).toBe(2);
  const fail=scenario(1,'zzone');play(fail,'bell');play(fail,'none');expect(fail.phase).toBe('zzone');expect(fail.left).toBe(4);expect(fail.zRun).toBe(0);for(let i=0;i<4;i++)play(fail,'none');expect(fail.phase).toBe('gg');
  const zero=scenario(1,'zzone');for(let i=0;i<5;i++)play(zero,'none',()=>0);expect(zero.loops).toContain(80);
 });
 it('天井1480Gの権利、ループ、割込み前の区間を保存し、再読込で再抽選しない',()=>{
  const s=scenario(1,'ceiling');play(s,'none');expect(s.phase).toBe('zzone');expect(s.stocks).toBe(1);expect(s.loops).toEqual([1]);
  const gg=scenario(1,'gg');gg.left=23;play(gg,'red');expect(gg.frames[0]).toMatchObject({phase:'gg',left:23});const restored=JSON.parse(JSON.stringify(gg));restored.phase='sgg-retry';restored.left=1;restored.sggStocks=0;play(restored,'none');expect(restored.phase).toBe('gg');expect(restored.left).toBe(23);
 });
 it('未停止のGODとハズレの公開ビューを同一にし、将来の停止位置とモードを漏らさない',()=>{
  const f=freshFloor(0),m=f.machines[0]!;m.owner='u';lever(m.state,last,'god');const a=trialView(f,'u');m.state=newKiseki();lever(m.state,last,'none');const b=trialView(f,'u');expect(b).toEqual(a);expect(a.own!.positions).toEqual([null,null,null]);expect(JSON.stringify(a)).not.toMatch(/"(plan|role|mode|loops|omenLeft|ceiling)"/);
 });
 it('保存分を別台へ再開しても止めた帯を保持し、受入台の通常状態は後で戻す',()=>{
  const f=freshFloor(0);const action=(a:string,machine=1)=>act(f,'u','試遊',{action:a,machine,revision:f.revision},0,last);action('seat');f.machines[0]!.state=scenario(1,'gg');lever(f.machines[0]!.state,last,'god');stop(f.machines[0]!.state,0,last);const pos=f.machines[0]!.state.pending!.positions[0];action('leave');action('seat',2);expect(f.machines[1]!.state.pending!.positions[0]).toBe(pos);stop(f.machines[1]!.state,1,last);stop(f.machines[1]!.state,2,last);expect(f.machines[1]!.state.lastPaid).toBe(150);expect(f.machines[1]!.state.gods).toBe(1);expect(trialView(f,'other').own).toBeNull();
 });
 it('自然抽選1000Gでも残高/入出力を整合し、公開中の区間を負の残りGにしない',()=>{
  let seed=771;const rng=(n:number)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
  const s=newKiseki(6);for(let game=0;game<1000;game++){lever(s,rng);const nav=(s.pending!.role==='bell'&&!['normal','omen','gaia'].includes(s.phase))?s.pending!.order.slice():[0,1,2];for(const i of nav)stop(s,i,rng);expect(s.balance).toBe(100000-s.input+s.output);expect(s.spins).toBe(game+1);expect(s.left).toBeGreaterThanOrEqual(0);expect(s.stocks).toBeGreaterThanOrEqual(0);expect(s.pending).toBeNull();}
 });
 it('期限で保存した通常ゲームの最終払出も、受入台の復元後に表示を保持する',()=>{
  const f=freshFloor(0),rng=last;act(f,'u','試遊',{action:'seat',machine:1,revision:0},0,rng);
  lever(f.machines[0]!.state,rng,'middleGold');expire(f,600001);
  act(f,'u','試遊',{action:'seat',machine:2,revision:f.revision},600001,rng);const base=f.machines[1]!.base!;base.normalGames=357;base.mode='high';
  for(const index of [0,1,2])act(f,'u','試遊',{action:'stop',index,machine:2,revision:f.revision},600001,rng);
  const v=trialView(f,'u');expect(v.points).toBe(100120);expect(v.own!.lastPaid).toBe(150);expect(v.own!.lastRole).toBe('middleGold');expect(v.own!.positions).toEqual(stopPlan('middleGold'));expect(v.own!.normalGames).toBe(357);expect(f.machines[1]!.state.mode).toBe('high');expect(f.machines[1]!.base).toBeNull();
 });
 it('時限は閲覧で延長せず、設定予約の天井は1回だけ選ぶ',()=>{
  const f=freshFloor(0);act(f,'u','試遊',{action:'seat',machine:1,revision:0},0,last);const a={action:'setting',machine:1,revision:f.revision,setting:6};act(f,'u','試遊',a,0,()=>0);expect(f.machines[0]!.reservedCeiling).toBe(510);const before=structuredClone(f);trialView(f,'u');expect(f).toEqual(before);expire(f,599999);expect(f.machines[0]!.owner).toBe('u');expire(f,600000);expect(f.machines[0]!.owner).toBeNull();expect(f.machines[0]!.state.setting).toBe(6);expect(f.machines[0]!.state.ceiling).toBe(510);
  expect(protectedState(scenario(1,'sgg-retry'))).toBe(true);
 });
});

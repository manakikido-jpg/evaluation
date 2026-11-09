import {expect,it} from 'vitest';
import {lever,newKiseki,stop,type KisekiState} from '../src/services/casino/kiseki/engine.js';
import {LINES,ROLES,rows,winningLines,type KisekiRole} from '../src/services/casino/kiseki/rules.js';
import {act,expire,freshFloor,trialView} from '../src/services/casino/kiseki/trial.js';

const last=(n:number)=>n-1,orders=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
function expectNoDecorationLine(positions:number[]){
 const windows=positions.map((position,i)=>rows(i,position));
 for(const line of LINES){const symbols=line.map((row,i)=>windows[i]![row]);expect(symbols).not.toEqual(['flower','flower','flower']);expect(symbols).not.toEqual(['crest','crest','crest']);}
}

it('自動補助のハズレを64G続けても同じ窓や246へ固定せず、桜・紋章を役のように揃えない',()=>{
 const s=newKiseki(),windows=new Set<string>(),digits=new Set<string>();let fixed246=0;
 for(let game=0;game<64;game++){
  lever(s,last,'none',true);const seen=new Map<number,number>();
  for(const index of orders[game%6]!){stop(s,index,last);const positions=s.pending?.positions??s.lastPositions;for(const [i,p] of seen)expect(positions[i]).toBe(p);seen.set(index,positions[index]!);}
  expectNoDecorationLine(s.lastPositions);expect(winningLines(s.lastPositions)).toEqual([]);expect(s.lastPaid).toBe(0);
  windows.add(s.lastPositions.join());digits.add(s.lastDigits!.join());if(s.lastDigits!.join()==='2,4,6')fixed246++;
 }
 expect(windows.size).toBeGreaterThan(12);expect(digits.size).toBeGreaterThan(20);expect(fixed246).toBeLessThan(8);expect(s.balance).toBe(100000-64*30);
});

it('目押し対応前の自動停止でも、ハズレと押し順ミスの窓を分散して払出0を保つ',()=>{
 for(const role of ['none','bell'] as const){const windows=new Set<string>();
  for(let game=0;game<40;game++){const s=newKiseki();s.spins=game;lever(s,last,role);const order=role==='bell'?[0,1,2]:orders[game%6]!;for(const i of order)stop(s,i,last);
   expect(s.lastPaid).toBe(0);expect(winningLines(s.lastPositions)).toEqual([]);expectNoDecorationLine(s.lastPositions);windows.add(s.lastPositions.join());
  }expect(windows.size).toBeGreaterThan(10);
 }
});

it('旧保存で桜テンパイ済みでも、停止した2本を保持して最後の1本で見せかけ揃いを避ける',()=>{
 for(const timing of [false,true])for(const order of orders){const s=newKiseki();lever(s,last,'none',timing);
  s.pending!.plan=[0,0,0];s.pending!.positions=[null,null,null];for(const i of order.slice(0,2))s.pending!.positions[i]=0;s.pending!.stops=order.slice(0,2);
  const restored=JSON.parse(JSON.stringify(s)) as KisekiState;stop(restored,order[2]!,last,0);
  for(const i of order.slice(0,2))expect(restored.lastPositions[i]).toBe(0);expectNoDecorationLine(restored.lastPositions);expect(restored.lastPaid).toBe(0);
 }
});

it('途中の期限保存を別台で再開しても、停止済みの窓と数字を維持し、最後にハズレが揃わない',()=>{
 const f=freshFloor(0);act(f,'u','試遊',{action:'seat',machine:1,revision:0},0,last);lever(f.machines[0]!.state,last,'none',true);
 stop(f.machines[0]!.state,0,last,0);const first=trialView(f,'u').own!;expire(f,600001);act(f,'u','試遊',{action:'seat',machine:2,revision:f.revision},600001,last);
 const restored=trialView(f,'u').own!;expect(restored.positions[0]).toBe(first.positions[0]);expect(restored.digits[0]).toBe(first.digits[0]);
 for(const index of [1,2])act(f,'u','試遊',{action:'stop',machine:2,revision:f.revision,index},600001,last);
 const final=trialView(f,'u').own!;expect(final.positions[0]).toBe(first.positions[0]);expect(final.digits[0]).toBe(first.digits[0]);expect(final.lastPaid).toBe(0);expectNoDecorationLine(final.positions as number[]);
 expect(trialView(JSON.parse(JSON.stringify(f)),'u').own).toEqual(final);
});

it('旧保存の確定済み窓を閲覧で書き換えず、新しいゲームから見せかけ揃いを避ける',()=>{
 const f=freshFloor(0),m=f.machines[0]!;m.owner='u';m.state.spins=10;m.state.lastPositions=[0,0,0];delete m.state.reelSet;const before=structuredClone(f);
 expect(trialView(f,'u').own!.reels.map(reel=>reel![2])).toEqual(['flower','flower','flower']);expect(f).toEqual(before);
 lever(m.state,last,'none',true);for(const i of [0,1,2])stop(m.state,i,last);expectNoDecorationLine(m.state.lastPositions);expect(m.state.lastPaid).toBe(0);
});

it('全役・全押し順で自動補助と目押しの乱数呼出し、払出、区間、獲得権利を一致させる',()=>{
 const economy=(s:KisekiState)=>{const {lastPositions,lastDigits,lastReelStops,...state}=s;return state;};
 for(const role of Object.keys(ROLES) as KisekiRole[])for(const order of orders){const a=newKiseki(),b=newKiseki(),ra:number[]=[],rb:number[]=[];
  const random=(calls:number[])=>(n:number)=>{calls.push(n);return n-1;};const ar=random(ra),br=random(rb);lever(a,ar,role,true);lever(b,br,role,true);
  for(const i of order){stop(a,i,ar);stop(b,i,br,(i*7+13)%20);}
  expect(ra).toEqual(rb);expect(economy(a)).toEqual(economy(b));expectNoDecorationLine(a.lastPositions);expectNoDecorationLine(b.lastPositions);
 }
});

import {expect,it} from 'vitest';
import {newKiseki,lever,stop} from '../src/services/casino/kiseki/engine.js';
import {ROLES,pattern,roleRows,rows,winningLines,LINES,type KisekiRole} from '../src/services/casino/kiseki/rules.js';
import {kisekiDigits,kisekiTheme} from '../src/services/casino/kiseki/presentation.js';
import {controlKisekiReel} from '../src/services/casino/kiseki/reelControl.js';
import {freshFloor,trialView,act,expire} from '../src/services/casino/kiseki/trial.js';
const last=(n:number)=>n-1,orders=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];

it('全役・全押し順・20入力位置で停止窓を固定し、払出と役の停止形を保つ',()=>{
 for(const role of Object.keys(ROLES) as KisekiRole[])for(const order of orders)for(let input=0;input<20;input++){
  const s=newKiseki();lever(s,last,role,true);const expected=s.pending!.order.slice(),seen=new Map<number,number>();
  for(const i of order){const from=(input+i*7)%20;stop(s,i,last,from);const positions=s.pending?.positions??s.lastPositions;
   for(const [j,p] of seen)expect(positions[j]).toBe(p);seen.set(i,positions[i]!);
   const result=(s.pending?.reelStops??s.lastReelStops)?.[i];
   if(result){expect(result.input).toBe(from);expect(result.slip).toBe((result.position-from+20)%20);if(!result.assisted)expect(result.slip).toBeLessThanOrEqual(4);}
  }
  const correct=role!=='bell'||order.join()===expected.join();expect(s.lastPaid).toBe(correct?ROLES[role].units*10:0);expect(s.balance).toBe(100000-30+s.lastPaid);
  const p=pattern(role);if(correct&&p)expect(s.lastPositions.map((v,i)=>rows(i,v)[roleRows(role)[i]!])).toEqual(p.symbols);
  if(!correct||!p)expect(winningLines(s.lastPositions)).toEqual([]);
  for(const line of LINES){const symbols=line.map((row,i)=>rows(i,s.lastPositions[i]!)[row]);expect(symbols.every(s=>s==='flower')||symbols.every(s=>s==='crest')).toBe(false);}
 }
});
it('0〜4コマで届く窓と、届かない場合の補助を区別し、不正入力で変更しない',()=>{
 const zero=controlKisekiReel('god',0,[null,null,null],4);expect(zero).toEqual({input:4,position:4,slip:0,assisted:false});
 const fallback=controlKisekiReel('red',0,[null,null,null],3);expect(fallback.slip).toBeGreaterThan(4);expect(fallback.assisted).toBe(true);
 const s=newKiseki();lever(s,last,'bell',true);const before=structuredClone(s);
 for(const n of [-1,20,1.5,NaN,Infinity]){expect(()=>stop(s,0,last,n)).toThrow();expect(s).toEqual(before);}
});
it('目押しをしても抽選乱数・投入・払出・権利を変えず、未停止情報を渡さない',()=>{
 const a=newKiseki(),b=newKiseki();let ca=0,cb=0;lever(a,n=>{ca++;return n-1;},'god',true);lever(b,n=>{cb++;return n-1;},'god');
 for(const i of [0,1,2]){stop(a,i,n=>{ca++;return n-1;},19);stop(b,i,n=>{cb++;return n-1;});}
 expect(ca).toBe(cb);for(const key of ['balance','input','output','gods','stocks','sets','phase','left'] as const)expect(a[key]).toEqual(b[key]);
 const f=freshFloor(0);f.machines[0]!.owner='u';f.machines[0]!.state=newKiseki();lever(f.machines[0]!.state,last,'god',true);const god=trialView(f,'u');
 f.machines[0]!.state=newKiseki();lever(f.machines[0]!.state,last,'none',true);expect(trialView(f,'u')).toEqual(god);
 expect(god.own!.digits).toEqual([null,null,null]);expect(god.own!.reelStops).toEqual([null,null,null]);
});
it('液晶は公開窓から毎ゲーム変わり、停止途中・再読込でも同じ数字になる',()=>{
 expect(kisekiDigits(0,[0,0,0],false)).toEqual([2,4,6]);
 const f=freshFloor(0),m=f.machines[0]!;m.owner='u';lever(m.state,last,'none',true);stop(m.state,2,last,7);
 const first=trialView(f,'u').own!;expect(first.digits[0]).toBeNull();expect(first.digits[1]).toBeNull();expect(first.digits[2]).toBeTypeOf('number');
 expect(trialView(JSON.parse(JSON.stringify(f)),'u').own!.digits).toEqual(first.digits);
 const before=structuredClone(f);trialView(f,'u');expect(f).toEqual(before);
 const results=Array.from({length:20},(_,i)=>kisekiDigits(i+1,[0,1,2],false).join());expect(new Set(results).size).toBeGreaterThan(7);
 for(let n=1;n<100;n++)expect(new Set(kisekiDigits(n,[0,0,0],false)).size).toBeGreaterThan(1);
});
it('目押し途中の期限保存を別台へ再開し、旧保存の自動補助も続けられる',()=>{
 const f=freshFloor(0);act(f,'u','試遊',{action:'seat',machine:1,revision:0},0,last);lever(f.machines[0]!.state,last,'god',true);stop(f.machines[0]!.state,0,last,19);
 const position=f.machines[0]!.state.pending!.positions[0],record=structuredClone(f.machines[0]!.state.pending!.reelStops![0]);expire(f,600001);
 act(f,'u','試遊',{action:'seat',machine:2,revision:f.revision},600001,last);
 expect(trialView(f,'u').own!.reelStops[0]).toEqual(record);expect(trialView(f,'u').own!.positions[0]).toBe(position);
 for(const index of [1,2])act(f,'u','試遊',{action:'stop',machine:2,revision:f.revision,index,position:19},600001,last);
 expect(trialView(f,'u').own!.lastPaid).toBe(150);
 const old=newKiseki();lever(old,last,'blue');delete old.pending!.timing;delete old.pending!.reelStops;delete old.lastReelStops;
 for(const i of [0,1,2])stop(old,i,last);expect(old.lastPaid).toBe(30);
});
it('公開された区間だけでGG/PGG/SGGのテーマを選ぶ',()=>{
 expect(['normal','omen','gaia'].map(kisekiTheme)).toEqual([null,null,null]);
 expect(['gg','gzone','zzone','zgame','pgg','sgg','sgg-retry'].map(kisekiTheme)).toEqual(['gg','gg','gg','gg','pgg','sgg','sgg']);
});
it('3数字が同じになる場合も最後に押した数字だけを調整し、先に止めた数字を変えない',()=>{
 const positions=[0,1,2].map(i=>Array.from({length:20},(_,p)=>p).find(p=>kisekiDigits(1,[p,p,p],true)[i]===3)!);
 expect(kisekiDigits(1,positions,true)).toEqual([3,3,3]);
 for(const lastIndex of [0,1,2]){const result=kisekiDigits(1,positions,false,lastIndex);expect(result[lastIndex]).not.toBe(3);for(const i of [0,1,2].filter(i=>i!==lastIndex))expect(result[i]).toBe(3);}
});
it('通常ゲームの保存再開で受入台へ戻っても、先に止めた液晶数字と最終数字を保持する',()=>{
 const f=freshFloor(0);act(f,'u','試遊',{action:'seat',machine:1,revision:0},0,last);lever(f.machines[0]!.state,last,'middleGold',true);stop(f.machines[0]!.state,0,last,3);
 const first=trialView(f,'u').own!.digits[0];expire(f,600001);act(f,'u','試遊',{action:'seat',machine:2,revision:f.revision},600001,last);
 for(const index of [1,2])act(f,'u','試遊',{action:'stop',machine:2,revision:f.revision,index,position:3},600001,last);
 const own=trialView(f,'u').own!;expect(own.spins).toBe(0);expect(own.lastPaid).toBe(150);expect(own.digits[0]).toBe(first);
 expect(own.digits).toEqual(f.machines[1]!.state.lastDigits);expect(trialView(JSON.parse(JSON.stringify(f)),'u').own!.digits).toEqual(own.digits);
});

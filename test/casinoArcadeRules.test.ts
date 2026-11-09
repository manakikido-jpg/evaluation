import {expect,it} from 'vitest';
import {ARCADE_KINDS,type ArcadeKind} from '../src/domain/casinoArcade.js';
import {newArcade,actArcade,arcadePublic,arcadePayout,cashMultiplier,pokerResult,kenoProbability,kenoMultipliers,FORTUNE_MULT,MONEY_MULT,PLINKO_MULT,combinations} from '../src/services/casino/arcadeRules.js';
const last=(n:number)=>n-1,zero=()=>0;
it('全11台を開始でき、即時結果と継続する台を区別し、公開情報に非公開状態を入れない',()=>{
 for(const kind of ARCADE_KINDS){const s=newArcade(kind,{choice:3,picks:[1,2,3]},last,0),p=arcadePublic(s,0);expect(s.kind).toBe(kind);expect(Object.hasOwn(p,'hidden')).toBe(false);for(const field of ['deck','traffic','crash','mines','tower'])expect(Object.hasOwn(p,field)).toBe(false);expect(arcadePayout(100,s)).toBe(s.done?Math.floor(s.mult/10):0);if(kind==='mines')expect(p.board).toEqual(Array(25).fill('hidden'));if(kind==='videopoker')expect(p.hand).toHaveLength(5);}
});
it('ホイール/プリンクの確率から期待払戻を計算し、ケノ全選択数も97%以下になる',()=>{
 expect(FORTUNE_MULT.reduce((a,b)=>a+b,0)/10/1000).toBe(.95);MONEY_MULT.forEach((n,i)=>expect(n*[.5,.25,.125,.125][i]!/1000).toBe(.95));
 const rtp=PLINKO_MULT.reduce((s,n,i)=>s+n/1000*combinations(9,i)/512,0);expect(rtp).toBeCloseTo(.949453125,10);
 for(let k=1;k<=10;k++){const pays=kenoMultipliers(k),prob=Array.from({length:k+1},(_,h)=>kenoProbability(k,h));expect(prob.reduce((a,b)=>a+b,0)).toBeCloseTo(1,10);const ev=pays.reduce((s,n,h)=>s+n/1000*prob[h]!,0);expect(ev).toBeLessThanOrEqual(.9700000001);expect(ev).toBeGreaterThan(.968);expect(pays[0]).toBe(0);expect(Math.max(...pays)).toBeLessThan(100000);}
});
it('マインスイーパーは保存した地雷で判定し、既開封・不正マスを拒否して途中受取する',()=>{
 const s=newArcade('mines',{},last,0);expect(()=>actArcade(s,'collect',undefined,undefined,0)).toThrow();const safe=actArcade(s,'pick',24,undefined,0);expect(s.selected).toEqual([]);expect(safe.step).toBe(1);expect(cashMultiplier(safe,0)).toBe(1102);expect(()=>actArcade(safe,'pick',24,undefined,0)).toThrow();for(const bad of [-1,25,NaN,.5])expect(()=>actArcade(safe,'pick',bad,undefined,0)).toThrow();const won=actArcade(safe,'collect',undefined,undefined,0);expect(arcadePayout(100,won)).toBe(110);expect(()=>actArcade(won,'collect',undefined,undefined,0)).toThrow();const lost=actArcade(s,'pick',0,undefined,0);expect(lost.done).toBe(true);expect(lost.mult).toBe(0);expect(arcadePublic(lost,0).board?.filter(n=>n==='bomb')).toHaveLength(3);
});
it('ドラゴンタワーとペンギンは全段・途中受取・失敗を判定し、勝手な操作を拒否する',()=>{
 let tower=newArcade('tower',{},last,0);for(let i=0;i<9;i++){tower=actArcade(tower,'pick',0,undefined,0);expect(tower.step).toBe(i+1);}expect(tower.done).toBe(true);expect(tower.mult).toBe(37290);expect(actArcade(newArcade('tower',{},last,0),'pick',2,undefined,0).mult).toBe(0);
 let p=newArcade('penguin',{},last,0);for(let i=0;i<8;i++)p=actArcade(p,'step',undefined,undefined,0);expect(p.done).toBe(true);expect(p.mult).toBe(5781);expect(actArcade(newArcade('penguin',{},zero,0),'step',undefined,undefined,0).mult).toBe(0);
 for(const kind of ['tower','penguin'] as const){const s=newArcade(kind,{},last,0),next=actArcade(s,kind==='tower'?'pick':'step',0,undefined,0);expect(actArcade(next,'collect',undefined,undefined,0).mult).toBeGreaterThan(1000);expect(()=>actArcade(s,'draw',undefined,[],0)).toThrow();}
});
it('クラッシュはサーバー時間と固定破裂点で決まり、再読込時刻・上限でも重複精算しない',()=>{
 const s=newArcade('crash',{},zero,10000);expect(arcadePublic(s,17000).mult).toBe(2718);expect(arcadePublic(s,17000).terminal).toBe(false);expect(()=>actArcade(s,'settle',undefined,undefined,17000)).toThrow();const won=actArcade(s,'collect',undefined,undefined,17000);expect(won.mult).toBe(2718);expect(actArcade(s,'settle',undefined,undefined,100000).mult).toBe(100000);
 const lost=newArcade('crash',{},last,10000);expect(arcadePublic(lost,10000).terminal).toBe(true);expect(actArcade(lost,'collect',undefined,undefined,10000).mult).toBe(0);expect(JSON.stringify(arcadePublic(lost,10000))).not.toContain('hidden');
});
it('ストリートクラップスの初投とポイント勝負を、ちんちろと分ける',()=>{
 expect(newArcade('craps',{},zero).mult).toBe(0);let at=0;const natural=newArcade('craps',{},()=>[2,3][at++]!);expect(natural.mult).toBe(2000);const point=newArcade('craps',{},()=>1);expect(point.point).toBe(4);expect(point.done).toBe(false);const again=actArcade(point,'roll',undefined,undefined,0,zero);expect(again.done).toBe(false);expect(actArcade(again,'roll',undefined,undefined,0,()=>1).mult).toBe(2000);at=0;expect(actArcade(point,'roll',undefined,undefined,0,()=>[2,3][at++]!).mult).toBe(0);
});
it('1Pポーカーは52枚で重複せず、32通りの残し方と主要役を判定する',()=>{
 for(let mask=0;mask<32;mask++){const s=newArcade('videopoker',{},last),keep=[0,1,2,3,4].filter(i=>mask&(1<<i)),next=actArcade(s,'draw',undefined,keep,0);expect(next.done).toBe(true);expect(new Set(next.hand).size).toBe(5);for(const i of keep)expect(next.hand[i]).toBe(s.hand[i]);for(let i=0;i<5;i++)if(!keep.includes(i))expect(s.hand).not.toContain(next.hand[i]);}
 expect(pokerResult([0,9,10,11,12]).mult).toBe(250000);expect(pokerResult([0,1,2,3,4]).mult).toBe(50000);expect(pokerResult([0,14,28,42,4]).mult).toBe(4000);expect(pokerResult([10,23,2,30,44]).mult).toBe(1000);expect(pokerResult([9,22,2,30,44]).mult).toBe(0);
});
it('選択の重複・範囲外と終了後の操作を拒否し、ケノ/レース/プリンクを固定結果にする',()=>{
 for(const picks of [[],[1,1],[0],[41],Array.from({length:11},(_,i)=>i+1)])expect(()=>newArcade('keno',{picks},last)).toThrow();expect(()=>newArcade('duckrace',{choice:5},last)).toThrow();expect(()=>newArcade('moneywheel',{choice:-1},last)).toThrow();
 const k=newArcade('keno',{picks:[1,2,3]},last);expect(k.step).toBe(3);expect(new Set(k.shown).size).toBe(10);expect(k.mult).toBe(21762);expect(()=>actArcade(k,'collect',undefined,undefined,0)).toThrow();const p=newArcade('plinko',{},last);expect(p.index).toBe(9);expect(p.mult).toBe(24000);expect(p.path).toEqual(Array(9).fill(1));expect(newArcade('duckrace',{choice:4},last).mult).toBe(4850);
});

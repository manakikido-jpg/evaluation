import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {expect,it} from 'vitest';
function physics(){const window:any={};runInNewContext(readFileSync(new URL('../src/web/public/pinball-physics.js',import.meta.url),'utf8'),{window});return window.PinballPhysics;}
const api=physics();
function finish(s:any,input:()=>Record<string,boolean>=()=>({}),limit=180){for(let i=0;i<limit*120&&s.phase==='playing';i++)api.step(s,1/120,input());}
it('プリンクは各位置から5球を落とし、実際のポケットの点を1回だけ加えて終了する',()=>{
 for(let seed=1;seed<=8;seed++){
  const s=api.create('plinko',seed);
  for(const position of [48,144,240,336,432]){expect(api.launch(s,position)).toBe(true);expect(api.launch(s,position)).toBe(false);finish(s,()=>({}),18);expect(s.phase).not.toBe('playing');expect(s.used).toBe(s.history.length);expect(s.history.at(-1)).toBe(api.POCKETS[s.lastPocket]);}
  expect(s.phase).toBe('over');expect(s.used).toBe(5);expect(s.score).toBe(s.history.reduce((a:number,b:number)=>a+b,0));const saved=structuredClone(s);expect(api.launch(s)).toBe(false);api.step(s,1);expect(s).toEqual(saved);
 }
});
it('フリッパーの発射がレーンを抜けて盤面へ入り、3球で終了する',()=>{
 for(const strength of [40,80,100]){const s=api.create('flipper',123);for(let ball=0;ball<3;ball++){expect(api.launch(s,strength)).toBe(true);let entered=false;for(let i=0;i<120*120&&s.phase==='playing';i++){api.step(s,1/120);if(s.ball?.x<410)entered=true;}expect(entered).toBe(true);expect(s.used).toBe(ball+1);}expect(s.phase).toBe('over');expect(s.ball).toBeNull();expect(Number.isSafeInteger(s.score)).toBe(true);}
});
it('左右のフリッパーを上げると、接触した玉を上へ打ち返せる',()=>{
 for(const side of ['left','right']){const s=api.create('flipper');s.phase='playing';s.ball={x:side==='left'?195:285,y:590,vx:0,vy:180};let hit=false;for(let i=0;i<15;i++){api.step(s,1/120,{[side]:true});if(s.ball?.vy< -200)hit=true;}expect(hit,side).toBe(true);}
});
it('バンパーで反発・加点し、同じ接触の連打で加点し続けない',()=>{
 const s=api.create();s.phase='playing';s.ball={x:150,y:177,vx:0,vy:200};for(let i=0;i<4;i++)api.step(s,1/120);expect(s.score).toBe(250);expect(s.ball.vy).toBeLessThan(0);const score=s.score;s.ball={x:150,y:180,vx:0,vy:1};api.step(s,1/120);expect(s.score).toBe(score);
});
it('星を全部集めたときのボーナスを1回だけ付ける',()=>{
 const s=api.create();s.phase='playing';for(const target of api.TARGETS){s.ball={x:target.x,y:target.y+18,vx:0,vy:-200};api.step(s,1/120);}expect(s.targets.every(Boolean)).toBe(true);expect(s.score).toBe(1500);const t=api.TARGETS[0];s.ball={x:t.x,y:t.y+18,vx:0,vy:-200};api.step(s,1/120);expect(s.score).toBe(1500);
});
it('同じseedと固定刻み入力は同じ結果となり、停止中・不正な経過時間では進まない',()=>{
 const a=api.create('plinko',1234),b=api.create('plinko',1234);api.launch(a,240);api.launch(b,240);finish(a,()=>({}),18);finish(b,()=>({}),18);expect(a).toEqual(b);
 const ready=api.create();for(const dt of [0,-1,NaN,Infinity])api.step(ready,dt);expect(ready).toEqual(api.create());
});
it('遅いフレームでも玉が壁を抜けず、異常な球は同じ球として戻す',()=>{
 const s=api.create('plinko');api.launch(s,48);for(let i=0;i<400&&s.phase==='playing';i++){api.step(s,1/30);if(s.ball){expect(s.ball.x).toBeGreaterThanOrEqual(42);expect(s.ball.x).toBeLessThanOrEqual(438);}}
 const bad=api.create();api.launch(bad);bad.ball.x=NaN;api.step(bad,1/120);expect(bad.phase).toBe('ready');expect(bad.used).toBe(0);expect(bad.score).toBe(0);expect(bad.ball).toBeNull();
});

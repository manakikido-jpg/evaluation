import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../src/web/public/gaisen-normal.js',import.meta.url),'utf8');
function fixture(){
 let motion='normal',hidden=false,light=false,value=.1,now=0,id=0;const jobs=new Map<number,{at:number;fn:()=>void}>(),window:any={},sounds:string[]=[],animations:any[]=[];
 runInNewContext(source,{window,setTimeout:(fn:()=>void,ms:number)=>{const k=++id;jobs.set(k,{at:now+ms,fn});return k;},clearTimeout:(k:number)=>jobs.delete(k)});
 const director=new window.GaisenNormalDirector({motion:()=>motion,hidden:()=>hidden,light:()=>light,random:()=>value,sound:(k:string)=>sounds.push(k),stopSound:()=>sounds.splice(0)});
 const machine=(spins=1,phase='normal',spinning=true)=>{const caption={textContent:''},digits=['1','2','3'].map(textContent=>({textContent,classList:{contains:()=>spinning},animate:(frames:any,timing:any)=>{const a={frames,timing,cancelled:false,cancel(){this.cancelled=true;},onfinish:null};animations.push(a);return a;}}));return {dataset:{spins:String(spins),phase,gtMachineId:'1',spinning:String(spinning)} as Record<string,string>,caption,digits,querySelector:()=>caption,querySelectorAll:()=>digits};};
 const update=(m:ReturnType<typeof machine>,action='lever',index=0,before=machine(Number(m.dataset.spins)-1,m.dataset.phase))=>{const ticket=director.begin();director.update({before,machine:m,action,index,ticket});};
 const tick=(ms:number)=>{now+=ms;for(const[k,j]of [...jobs])if(j.at<=now){jobs.delete(k);j.fn();}};
 return{director,machine,update,tick,jobs,sounds,animations,value:(n:number)=>{value=n;},motion:(v:string)=>{motion=v;},hide:()=>{hidden=true;},light:()=>{light=true;}};
}
describe('通常時の液晶装飾',()=>{
 it('大半は静かで、独立した装飾抽選だけで風/光/遠雷/消灯を選ぶ',()=>{
  const f=fixture();for(const[p,cue]of [[.1,undefined],[.7,'wind'],[.8,'glint'],[.88,'thunder'],[.94,'dim']] as const){f.value(p);const m=f.machine(Math.round(p*100)+1);f.update(m);expect(m.dataset.normalCue).toBe(cue);if(cue){f.tick(760);expect(m.dataset.normalCue).toBeUndefined();expect(m.caption.textContent).toBe('');expect(f.jobs.size).toBe(0);}}
 });
 it('装飾の気配は3ゲーム続き、当選を作らず静まる',()=>{
  const f=fixture();f.value(.99);
  for(const[n,cue]of [[1,'wind'],[2,'thunder'],[3,'gates']] as const){const m=f.machine(n);f.update(m);expect(m.dataset.normalCue).toBe(cue);for(const i of [0,1,2]){const stopped=f.machine(n,'normal',i!==2);f.update(stopped,'stop',i);if(i===2&&n===3)expect(stopped.dataset.normalCue).toBe('quiet');}}
  expect(f.director.chain).toBeNull();expect(f.director.last).toBe('1:3');
 });
 it('公開済み前兆を風→遠雷→扉へ発展させ、残りGや内部役を使わない',()=>{
  const f=fixture();for(const[n,cue]of [[1,'wind'],[2,'thunder'],[3,'gates'],[4,'gates']] as const){const m=f.machine(n,'omen');f.update(m);expect(m.dataset.normalCue).toBe(cue);expect(m.dataset.normalMood).toBe(String(Math.min(n,3)));}
  const gg=f.machine(5,'gg');f.update(gg);expect(gg.dataset.normalCue).toBeUndefined();expect(f.director.chain).toBeNull();
 });
 it('停止数字の文字/保存状態を変えず150msで収め、取消でアニメーションも止める',()=>{
  const f=fixture(),m=f.machine(1,'normal',false),before=m.digits.map(d=>d.textContent),data={...m.dataset};f.update(m,'stop',1);expect(m.digits.map(d=>d.textContent)).toEqual(before);expect(m.dataset).toEqual(data);expect(f.animations).toHaveLength(1);expect(f.animations[0].timing.duration).toBe(150);expect(f.animations[0].frames.at(-1).transform).toBe('translateY(0)');f.director.cancel();expect(f.animations[0].cancelled).toBe(true);
 });
 it('2つの公開済み数字が同じときだけ、未停止数字の装飾の間を変える',()=>{
  const f=fixture(),m=f.machine();m.digits[0]!.textContent=m.digits[2]!.textContent='2';for(const i of [0,2])m.digits[i]!.classList.contains=()=>false;
  f.update(m,'stop',2);expect(m.dataset.normalHold).toBe('true');expect(m.digits.map(d=>d.textContent)).toEqual(['2','2','2']);f.director.cancel();expect(m.dataset.normalHold).toBeUndefined();
 });
 it('初回/再送/同一ゲーム/台違い/巻戻しをレバー演出のきっかけにしない',()=>{
  const f=fixture();f.value(.9);for(const before of [null,f.machine(1),f.machine(2),Object.assign(f.machine(0),{dataset:{...f.machine(0).dataset,gtMachineId:'2'}})]){const m=f.machine();const ticket=f.director.begin();f.director.update({before,machine:m,action:'lever',ticket});expect(m.dataset.normalCue).toBeUndefined();}
  const m=f.machine();f.update(m);f.update(f.machine());expect(f.jobs.size).toBe(0);
 });
 it('低減/即表示/軽量/非表示では装飾も追加音も始めない',()=>{
  for(const setup of [(f:ReturnType<typeof fixture>)=>f.motion('low'),(f:ReturnType<typeof fixture>)=>f.motion('instant'),(f:ReturnType<typeof fixture>)=>f.light(),(f:ReturnType<typeof fixture>)=>f.hide()]){const f=fixture();setup(f);f.value(.99);const m=f.machine();f.update(m);f.update(m,'stop');expect(f.jobs.size).toBe(0);expect(f.animations).toHaveLength(0);expect(f.sounds).toHaveLength(0);expect(f.director.chain).toBeNull();}
 });
 it('非表示/設定変更と次操作で取消し、古い応答やタイマーで再演しない',()=>{
  const f=fixture();f.value(.99);const m=f.machine();f.update(m);const ticket=f.director.generation;f.director.suspend();f.director.update({before:f.machine(1),machine:f.machine(2),action:'lever',ticket});f.tick(2000);expect(f.jobs.size).toBe(0);expect(f.sounds).toHaveLength(0);expect(m.caption.textContent).toBe('');expect(f.director.chain).toBeNull();
 });
 it('場面変更/離席で装飾の連続を切り、抽選源の故障でも確定操作を失敗させない',()=>{
  const f=fixture();f.value(.99);f.update(f.machine());f.update(f.machine(),'scenario');expect(f.director.chain).toBeNull();f.director.random=()=>{throw Error('unavailable');};expect(()=>f.update(f.machine(2))).not.toThrow();expect(f.jobs.size).toBe(0);
 });
});

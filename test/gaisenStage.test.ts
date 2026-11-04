import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../src/web/public/gaisen-stage.js',import.meta.url),'utf8');
function fixture(){
 let motion='normal',hidden=false,now=0,id=0;const jobs=new Map<number,{at:number;fn:()=>void}>(),window:any={};
 runInNewContext(source,{window,setTimeout:(fn:()=>void,ms:number)=>{const key=++id;jobs.set(key,{at:now+ms,fn});return key;},clearTimeout:(key:number)=>jobs.delete(key)});
 const stage=new window.GaisenStageDirector({motion:()=>motion,hidden:()=>hidden});
 const machine=(scene:string)=>({dataset:{scene} as Record<string,string>});
 const tick=(ms:number)=>{const end=now+ms;while(true){const next=[...jobs].filter(([,j])=>j.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;jobs.delete(next[0]);now=next[1].at;next[1].fn();}now=end;};
 return{stage,machine,tick,jobs,motion:(value:string)=>{motion=value;},hide:()=>{hidden=true;}};
}
describe('公開区間と筐体の連動',()=>{
 it('区間切替で上部→側面→下部を一度だけ流し、短時間で消す',()=>{
  const f=fixture(),m=f.machine('gg');f.stage.transition('normal',m);expect(m.dataset.transition).toBe('doors');expect(m.dataset.lightStage).toBe('top');f.tick(180);expect(m.dataset.lightStage).toBe('rails');f.tick(240);expect(m.dataset.lightStage).toBe('apron');f.tick(530);expect(m.dataset).toEqual({scene:'gg'});expect(f.jobs.size).toBe(0);
 });
 it('初回読込・同区間・未知の区間では予告や再演を起こさない',()=>{
  const f=fixture();for(const [before,after] of [[undefined,'gg'],['gg','gg'],['normal','hidden-mode']]){const m=f.machine(after!);f.stage.transition(before,m);expect(m.dataset).toEqual({scene:after});expect(f.jobs.size).toBe(0);}
 });
 it('公開済み区間に応じて扉・光・輪・静かな復帰を使い分ける',()=>{
  const f=fixture();for(const [scene,effect] of [['sgg','doors'],['gstop','sweep'],['ex','sweep'],['medusa','ring'],['normal','fade']]){const m=f.machine(scene!);f.stage.transition(scene==='normal'?'gg':'normal',m);expect(m.dataset.transition).toBe(effect);}
 });
 it('次の操作で取消し、古いタイマーが別の区間を光らせない',()=>{
  const f=fixture(),a=f.machine('gg'),b=f.machine('gstop');f.stage.transition('normal',a);f.tick(100);f.stage.cancel();f.tick(2000);expect(a.dataset).toEqual({scene:'gg'});f.stage.transition('gg',b);f.tick(180);expect(b.dataset.lightStage).toBe('rails');expect(a.dataset).toEqual({scene:'gg'});
 });
 it('当選段階の光を同期し、次の段階と取消で古い光を消す',()=>{
  const f=fixture(),m=f.machine('gg');for(const [phase,light] of [['charge','top'],['reveal','rails'],['award','apron']]){f.stage.win(m,'god',phase);expect(m.dataset.lightStage).toBe(light);expect(m.dataset.lightKind).toBe('god');}f.stage.cancel();expect(m.dataset).toEqual({scene:'gg'});
 });
 it('低減・即表示・非表示では開始せず、途中で隠れても再開しない',()=>{
  for(const mode of ['low','instant']){const f=fixture(),m=f.machine('gg');f.motion(mode);f.stage.transition('normal',m);f.stage.win(m,'god','charge');expect(m.dataset).toEqual({scene:'gg'});}
  const f=fixture(),m=f.machine('gg');f.stage.transition('normal',m);f.hide();f.tick(180);expect(m.dataset).toEqual({scene:'gg'});expect(f.jobs.size).toBe(0);f.stage.win(m,'god','award');expect(m.dataset).toEqual({scene:'gg'});
 });
 it('当選の各段階で選んだ装飾を保ち、取消で消す',()=>{const f=fixture(),m=f.machine('gg');for(const step of ['charge','reveal','award']){f.stage.win(m,'god',step,'b');expect(m.dataset.variation).toBe('b');}f.stage.cancel();expect(m.dataset.variation).toBeUndefined();});

});

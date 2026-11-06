import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function fixture(){
 const window:any={},jobs=new Map<number,()=>void>(),sounds:any[]=[];let timer=0,p=.9,hidden=false,motion='normal',light=false,draws=0;
 const context={window,setTimeout:(fn:()=>void)=>{jobs.set(++timer,fn);return timer;},clearTimeout:(id:number)=>jobs.delete(id)};
 for(const file of ['gaisen-normal','gaisen-stage','kiseki-direction'])runInNewContext(readFileSync(new URL('../src/web/public/'+file+'.js',import.meta.url),'utf8'),context);
 const options={motion:()=>motion,hidden:()=>hidden,light:()=>light,random:()=>{draws++;return p;},sound:(kind:string,step:number)=>sounds.push([kind,step]),stopSound:()=>{}};
 const director=new window.KisekiNormalDirector(options),stage=new window.KisekiStageDirector(options);
 const machine=(spins=1,stopped:number[]=[],phase='normal',id='1',landscape='spring')=>{
  const caption={textContent:''},title={textContent:''},mode={textContent:phase==='normal'?'蒼泉の神殿':phase};
  const digits=['1','1','3'].map((textContent,i)=>({textContent,classList:{contains:()=>!stopped.includes(i)},animate:()=>({cancel(){},onfinish:null})}));
  return {dataset:{spins:String(spins),gtMachineId:id,phase,kisekiPhase:phase,landscape,spinning:String(stopped.length!==3)} as Record<string,string>,digits,caption,title,
   querySelector:(s:string)=>s==='[data-kt-stage-title]'?title:s==='.gt-screen-mode'?mode:caption,querySelectorAll:()=>digits};
 };
 const update=(machine:any,action='lever',index=0,before=machine)=>{const ticket=director.begin();director.update({before,machine,action,index,ticket});};
 const start=(phase='normal')=>{const m=machine(1,[],phase);update(m,'lever',0,machine(0,[],phase));return m;};
 return {director,stage,machine,update,start,jobs,sounds,draws:()=>draws,value:(v:number)=>p=v,hide:()=>hidden=true,low:()=>motion='low',light:()=>light=true,flush:()=>{for(const [id,fn]of [...jobs]){jobs.delete(id);fn();}}};
}

it('予告は1G1抽選、HTML差替え後も実際の停止順に第3停止まで引き継ぐ',()=>{
 for(const order of [[0,1,2],[2,0,1],[1,2,0]]){
  const f=fixture(),first=f.start(),kind=first.dataset.ktCue;expect(kind).toBeTruthy();
  const seen:number[]=[];for(const i of order){seen.push(i);const m=f.machine(1,seen);f.update(m,'stop',i);expect(m.dataset.ktCue).toBe(kind);expect(m.dataset.ktCueStep).toBe(String(seen.length));if(seen.length===3)expect(m.dataset.ktCueEnding).toBe('true');}
  expect(f.draws()).toBe(1);expect(f.sounds.map(v=>v[1])).toEqual([0,1,2,3]);expect(f.director.plan).toBeNull();f.flush();expect(f.jobs.size).toBe(0);
 }
});
it('短い装飾が終わっても、同じゲームの次のSTOPで同じ予告を再開する',()=>{
 const f=fixture(),m=f.start();f.flush();expect(m.dataset.ktCue).toBeUndefined();const stopped=f.machine(1,[0]);f.update(stopped,'stop',0);expect(stopped.dataset.ktCue).toBeTruthy();expect(f.draws()).toBe(1);
});
it('大半の通常ゲームは静かで、公開前兆だけ停止連動の段階を進める',()=>{
 const f=fixture();f.value(.1);expect(f.start().dataset.ktCue).toBeUndefined();expect(f.sounds).toEqual([]);
 const g=fixture();for(let i=1;i<=4;i++){const m=g.machine(i,[],'omen');g.update(m,'lever',0,g.machine(i-1,[],i===1?'normal':'omen'));expect(m.dataset.ktCue).toBe(['wind','glint','thunder','gates'][i-1]);}
});
it('再送・不正なSTOP・別台・別ゲームへ予告を引き継がない',()=>{
 for(const mode of ['repeat','wrongIndex','otherMachine','otherGame']){
  const f=fixture();f.start();const m=f.machine(mode==='otherGame'?2:1,[0],'normal',mode==='otherMachine'?'2':'1');
  f.update(m,'stop',mode==='wrongIndex'?2:0);if(mode==='repeat')f.update(m,'stop',0);
  if(mode==='repeat'||mode==='wrongIndex')expect(f.director.plan).toBeNull();else expect(m.dataset.ktCue).toBeUndefined();
 }
});
it('非表示・低減・軽量・失敗の中断で音と装飾を取り消し、後で勝手に復活しない',()=>{
 for(const mode of ['hide','low','light','error'] as const){const f=fixture(),m=f.start();if(mode==='error')f.director.suspend();else {f[mode]();f.update(f.machine(1,[0]),'stop',0);}f.flush();expect(m.dataset.ktCue).toBeUndefined();expect(f.director.plan).toBeNull();expect(f.jobs.size).toBe(0);}
});
it('古い通信結果を新しい予告へ反映せず、特別区間では通常予告を止める',()=>{
 const f=fixture();f.start();const ticket=f.director.begin();f.director.begin();const m=f.machine(1,[0]);f.director.update({machine:m,action:'stop',index:0,ticket});expect(m.dataset.ktCue).toBeUndefined();
 f.update(f.machine(1,[0,1,2],'gg'),'stop',2);expect(f.director.plan).toBeNull();
});
it('風景だけの変更と、突入・待ち・復帰・前兆の移行を区別する',()=>{
 const f=fixture();for(const [phase,kind]of [['gg','entry'],['pgg','entry'],['sgg','entry'],['gzone','waiting'],['sgg-retry','waiting'],['gaia','approach'],['omen','approach'],['normal','return']]){
  const m=f.machine(1,[],phase);f.stage.transition(f.machine(0,[],phase==='normal'?'gg':'normal'),m);expect(m.dataset.ktTransition).toBe(kind);expect(m.title.textContent).toBeTruthy();f.stage.cancel();expect(m.dataset.ktTransition).toBeUndefined();expect(m.title.textContent).toBe('');expect(f.jobs.size).toBe(0);
 }
 const garden=f.machine(1,[],'normal','1','garden');f.stage.transition(f.machine(),garden);expect(garden.dataset.ktTransition).toBe('landscape');
});
it('同じ区間のSTOP/再読込では突入映像を再演せず、中断後のタイマーを残さない',()=>{
 const f=fixture(),m=f.machine();f.stage.transition(f.machine(),m);expect(f.jobs.size).toBe(0);f.stage.transition(undefined,m);expect(f.jobs.size).toBe(0);
 const gg=f.machine(1,[],'gg');f.stage.transition(m,gg);expect(f.jobs.size).toBe(3);f.hide();f.flush();expect(f.jobs.size).toBe(0);expect(gg.dataset.ktTransition).toBeUndefined();
});

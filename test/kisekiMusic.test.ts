import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../src/web/public/kiseki-live.js',import.meta.url),'utf8');
function fixture(){
 const window:any={},started:any[]=[],pending:(()=>void)[]=[],stopped:string[]=[],selector={value:''};let hidden=false,defer=false,loads=0;
 const display={dataset:{} as Record<string,string>},machine={dataset:{ktTheme:'gg'},querySelector:()=>display,querySelectorAll:()=>[]};
 const root={classList:{contains:()=>true},querySelector:()=>machine,querySelectorAll:()=>[selector]};
 const bank={enabled:true,context:{},resuming:Promise.resolve(),running:()=>true,load:async(key:string)=>{loads++;if(defer)await new Promise<void>(r=>pending.push(r));return {duration:24,key};},stopGroup:(group:string)=>stopped.push(group),createNode:(buffer:any,options:any)=>{const node={buffer,options};started.push(node);return node;}};
 runInNewContext(source,{window,localStorage:{getItem:()=>null,setItem:()=>{}}});
 const director=new window.KisekiLiveDirector({bank,root:()=>root,motion:()=> 'normal',light:()=>false,hidden:()=>hidden});
 const ready=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
 return {director,bank,machine,display,started,selector,stopped,ready,pending,loads:()=>loads,delay:()=>defer=true,hide:()=>hidden=true};
}
it('操作前と音OFFは取得0、操作後に1ループだけ再生し、設定更新で再起動しない',async()=>{
 const f=fixture();await f.director.sync();expect(f.loads()).toBe(0);f.bank.enabled=false;f.director.prepare();await f.ready();expect(f.loads()).toBe(0);
 f.bank.enabled=true;f.director.prepare();await f.ready();expect(f.started).toHaveLength(1);expect(f.started[0].buffer.key).toBe('bgm-gg');
 expect(f.started[0].options).toMatchObject({group:'bgm',loop:true,loopStart:0,loopEnd:24,priority:-1});
 await f.director.sync();await f.director.sync();expect(f.started).toHaveLength(1);
});
it('音源の読込中にPGGへ変わったら、古いGGを遅れて鳴らさない',async()=>{
 const f=fixture();f.delay();f.director.prepare();f.machine.dataset.ktTheme='pgg';void f.director.sync();
 expect(f.pending).toHaveLength(2);f.pending.splice(0).forEach(r=>r());await f.ready();expect(f.started).toHaveLength(1);expect(f.started[0].buffer.key).toBe('bgm-pgg');
});
it('BGMだけOFF、非表示、GOD告知中のいずれも読込中の古い音を取り消す',async()=>{
 for(const cancel of ['off','hidden','god'] as const){const f=fixture();f.delay();f.director.prepare();
  if(cancel==='off')f.director.preference('off');if(cancel==='hidden'){f.hide();void f.director.sync();}if(cancel==='god'){f.display.dataset.winKind='god';void f.director.sync();}
  f.pending.splice(0).forEach(r=>r());await f.ready();expect(f.started).toHaveLength(0);expect(f.stopped).toContain('bgm');
 }
});
it('BGM停止は操作音を止めず、SGGと通常の移行も公開テーマだけを使う',async()=>{
 const f=fixture();f.director.prepare();await f.ready();f.machine.dataset.ktTheme='sgg';await f.director.sync();expect(f.started.at(-1).buffer.key).toBe('bgm-sgg');
 f.machine.dataset.ktTheme='normal';await f.director.sync();expect(f.stopped.every(g=>g==='bgm')).toBe(true);expect(f.director.key).toBeNull();
});

import{readFileSync}from'node:fs';import{runInNewContext}from'node:vm';import{expect,it}from'vitest';
const source=readFileSync('src/web/public/event-stream.js','utf8');
function setup(){
 const listeners=new Map<string,()=>void>(),timers=new Map<number,()=>void>();let seq=0;
 class Element{value='';textContent='';hidden=false;disabled=false;type='password';dataset={csrf:'csrf'};handlers=new Map<string,()=>void>();attrs=new Map<string,string>();paused=true;currentTime=0;canPlayType(){return '';}addEventListener(n:string,fn:()=>void){this.handlers.set(n,fn);}fire(n:string){this.handlers.get(n)?.();}removeAttribute(n:string){this.attrs.delete(n);}pause(){this.paused=true;}load(){}async play(){this.paused=false;}select(){}querySelectorAll(){return [];}querySelector(){return {requestFullscreen:async()=>{}};}}
 const ids=['event-stream','event-video','event-title','event-notice','event-connection','event-error','event-placeholder','event-wait','event-play','event-reconnect','event-fullscreen','event-key-show','event-key-hide','event-key-copy','event-key','event-server','event-key-expiry','event-publisher'];const elements=Object.fromEntries(ids.map(id=>[id,new Element()]));
 const document={hidden:false,getElementById:(id:string)=>elements[id],addEventListener:(n:string,fn:()=>void)=>listeners.set(n,fn)};
 const instances:any[]=[];
 class Hls{static isSupported(){return true;}static Events={ERROR:'error',MANIFEST_PARSED:'parsed'};callbacks=new Map<string,Function>();destroyed=false;source='';constructor(public options:unknown){instances.push(this);}on(name:string,fn:Function){this.callbacks.set(name,fn);}loadSource(src:string){this.source=src;}attachMedia(){}destroy(){this.destroyed=true;}}
 const state={configured:true,staff:true,event:{id:'event-id',title:'イベント',notice:'案内',status:'live'}};
 let fetcher=(url:string,_options:unknown)=>Promise.resolve({ok:true,json:async()=>url.endsWith('/publisher')?{server:'rtmps://test/event',key:'publisher-key',expiresAt:0}:state});
 const calls:string[]=[];runInNewContext(source,{document,window:{Hls,addEventListener:(n:string,fn:()=>void)=>listeners.set(n,fn)},navigator:{vendor:'test',clipboard:{writeText:async()=>{}}},fetch:(url:string,options:unknown)=>{calls.push(url);return fetcher(url,options);},AbortController,URLSearchParams,FormData,Date,setTimeout:(fn:()=>void)=>{timers.set(++seq,fn);return seq;},clearTimeout:(id:number)=>timers.delete(id)});
 return {elements,instances,timers,listeners,document,state,calls,setFetcher:(fn:typeof fetcher)=>fetcher=fn};
}
async function drain(){for(let n=0;n<12;n++)await Promise.resolve();}
it('視聴は本人のクリック後だけ開始し、停止操作は媒体を破棄する',async()=>{
 const f=setup();await drain();expect(f.instances).toHaveLength(0);f.elements['event-play']!.fire('click');await drain();expect(f.instances).toHaveLength(1);expect(f.instances[0].source).toBe('/visit/event/media/event-id/index.m3u8');expect(f.elements['event-connection']!.textContent).toContain('受信');f.elements['event-video']!.fire('playing');expect(f.elements['event-connection']!.textContent).toContain('視聴しています');f.elements['event-play']!.fire('click');expect(f.instances[0].destroyed).toBe(true);expect(f.elements['event-video']!.paused).toBe(true);
});
it('非表示で再生/更新/鍵を停止し、復帰しても自動再生しない',async()=>{
 const f=setup();await drain();f.elements['event-play']!.fire('click');await drain();f.elements['event-key-show']!.fire('click');await drain();expect(f.elements['event-key']!.value).toBe('publisher-key');f.document.hidden=true;f.listeners.get('visibilitychange')!();expect(f.instances[0].destroyed).toBe(true);expect(f.elements['event-key']!.value).toBe('');expect(f.elements['event-publisher']!.hidden).toBe(true);expect(f.timers.size).toBe(0);f.document.hidden=false;f.listeners.get('visibilitychange')!();await drain();expect(f.instances).toHaveLength(1);
});
it('非同期の鍵取得中にウィンドウを離れた場合、後から鍵を再表示しない',async()=>{
 const f=setup();await drain();let resolve:Function=()=>{};f.setFetcher(()=>new Promise(r=>{resolve=r;}));f.elements['event-key-show']!.fire('click');f.listeners.get('blur')!();resolve({ok:true,json:async()=>({server:'rtmps://test/event',key:'late-private-key',expiresAt:0})});await drain();expect(f.elements['event-key']!.value).toBe('');
});
it('イベント終了や在籍確認の失敗でHLSを破棄し、遅れた再生コールバックを無視する',async()=>{
 const f=setup();await drain();f.elements['event-play']!.fire('click');await drain();const instance=f.instances[0];f.state.event.status='closed';f.document.hidden=false;f.listeners.get('visibilitychange')!();await drain();expect(instance.destroyed).toBe(true);instance.callbacks.get('parsed')();await drain();expect(f.elements['event-video']!.paused).toBe(true);
 f.state.event.status='live';f.listeners.get('visibilitychange')!();await drain();f.elements['event-play']!.fire('click');await drain();f.setFetcher(()=>Promise.reject(new Error('在籍を確認できません。')));f.listeners.get('visibilitychange')!();await drain();expect(f.instances[1].destroyed).toBe(true);expect(f.elements['event-error']!.textContent).toContain('在籍');
});

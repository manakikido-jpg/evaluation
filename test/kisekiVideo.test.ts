import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {expect,it} from 'vitest';
import {kisekiVideoSources,STATIC} from '../src/web/assets.js';

function fixture(){
 const window:any={},jobs=new Map<number,()=>void>(),videos:any[]=[];let seq=0,motion='normal',hidden=false,light=false;
 const root={dataset:{ktVideos:JSON.stringify(Object.fromEntries(['god','gg','gaia','zzone','zgame'].map(k=>[k,`/static/kiseki-media-veo-${k}.mp4?v=0123456789`])) )}};
 const document={createElement:()=>{const video:any={dataset:{},setAttribute(){},removeAttribute(k:string){delete this[k];},play:()=>Promise.resolve(),pause(){this.paused=true;},load(){this.released=true;},remove(){this.removed=true;}};videos.push(video);return video;}};
 runInNewContext(readFileSync(new URL('../src/web/public/kiseki-video.js',import.meta.url),'utf8'),{window,document,setTimeout:(f:()=>void)=>{jobs.set(++seq,f);return seq;},clearTimeout:(i:number)=>jobs.delete(i)});
 const director=new window.KisekiVideoDirector({root:()=>root,motion:()=>motion,light:()=>light,hidden:()=>hidden});
 const machine=(phase='normal',id='1')=>({dataset:{kisekiPhase:phase,gtMachineId:id},querySelector:()=>({append(){}})});
 return {director,root,jobs,videos,machine,mode:(v:string)=>motion=v,hide:()=>hidden=true,light:()=>light=true};
}
it('動画は存在する検品済みファイルだけを配信し、未納品時は空の一覧にする',()=>{
 for(const [key,url] of Object.entries(kisekiVideoSources())){expect(['god','gg','gaia','zzone','zgame']).toContain(key);expect(STATIC[`kiseki-media-veo-${key}.mp4`]?.type).toBe('video/mp4');expect(url).toMatch(/\?v=[a-f0-9]{10}$/);}
});
it('再生が始まってから背景を表示し、音声を既存BGMに重ねない',async()=>{
 const f=fixture();f.director.win(f.machine('pgg'),'god');const v=f.videos[0];expect(v.dataset.playing).toBeUndefined();expect(v.muted&&v.defaultMuted&&v.playsInline).toBe(true);v.onplaying();expect(v.dataset.playing).toBe('true');expect(f.jobs.size).toBe(1);
 v.onended();expect(v.paused&&v.released&&v.removed).toBe(true);expect(f.director.current).toBeNull();expect(f.jobs.size).toBe(0);
});
it('未追加・外部URL・不正一覧・未対応の当選種別で動画を作らない',()=>{
 for(const manifest of ['{}','{','{"god":"https://example.test/movie.mp4"}','{"god":"/static/kiseki-media-veo-gg.mp4?v=0123456789"}']){const f=fixture();f.root.dataset.ktVideos=manifest;f.director.win(f.machine('pgg'),'god');expect(f.videos).toHaveLength(0);}
 const f=fixture();for(const kind of ['stock','sgg','unknown'])f.director.win(f.machine('gg'),kind);expect(f.videos).toHaveLength(0);
});
it('非表示・軽量・動き低減時は動画通信をせず、再生中の切替でも解放する',()=>{
 for(const mode of ['hidden','light','low','instant']){const f=fixture();f.director.win(f.machine(),'gg');const v=f.videos[0];if(mode==='hidden')f.hide();else if(mode==='light')f.light();else f.mode(mode);f.director.sync();expect(v.removed).toBe(true);f.director.win(f.machine(),'god');expect(f.videos).toHaveLength(1);}
});
it('エラー・読込期限・再生期限で従来背景に戻り、古い通知で次の動画を消さない',()=>{
 const f=fixture();f.director.play(f.machine(),'god');const old=f.videos[0],late=old.onerror;f.director.play(f.machine(),'gg');expect(old.removed).toBe(true);late();expect(f.director.current?.video).toBe(f.videos[1]);f.videos[1].onerror();expect(f.jobs.size).toBe(0);
 for(const timeout of ['loading','end']){f.director.play(f.machine(),'god');const c=f.director.current;f.jobs.get(c[timeout])!();expect(c.video.removed).toBe(true);expect(f.jobs.size).toBe(0);}
});
it('自動再生拒否でも待機を残さず既存背景へ戻す',async()=>{
 const f=fixture();f.director.play(f.machine(),'god');f.director.cancel();const original=f.machine();original.querySelector=()=>({append(){f.videos.at(-1).play=()=>Promise.reject(Error('autoplay'));}});
 f.director.play(original,'god');await new Promise<void>(resolve=>setImmediate(resolve));expect(f.director.current).toBeNull();expect(f.jobs.size).toBe(0);
});
it('確定した同じ台の区間移行だけで再生し、再読込・同一区間では再発火しない',()=>{
 const f=fixture();f.director.transition(null,f.machine('gaia'));f.director.transition(f.machine('gaia'),f.machine('gaia'));f.director.transition(f.machine('normal','2'),f.machine('gaia'));expect(f.videos).toHaveLength(0);
 for(const phase of ['gaia','zzone','zgame']){f.director.transition(f.machine(),f.machine(phase));expect(f.videos.at(-1).src).toContain(`veo-${phase}.mp4`);}
 f.director.win(f.machine('zzone'),'stock');expect(f.videos.at(-1).src).toContain('veo-zzone.mp4');f.director.cancel();expect(f.jobs.size).toBe(0);
});

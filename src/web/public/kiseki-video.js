// Veoで制作・検品した背景動画だけ。結果や進行は動画に依存させない。
(() => {
 const durations={god:6000,gg:4300,gaia:3000,zzone:2800,zgame:3000};
 class KisekiVideoDirector {
  constructor({root,motion,light,hidden}){Object.assign(this,{root,motion,light,hidden});this.current=null;}
  enabled(){return this.motion()==='normal'&&!this.light()&&!this.hidden();}
  sync(){if(!this.enabled())this.cancel();}
  cancel(){
   const c=this.current;this.current=null;if(!c)return;
   clearTimeout(c.loading);clearTimeout(c.end);c.video.onplaying=c.video.onerror=c.video.onended=null;
   c.video.pause();c.video.removeAttribute('src');c.video.load();c.video.remove();
  }
  play(machine,key){
   this.cancel();if(!this.enabled()||!machine||!Object.hasOwn(durations,key))return;
   let sources;try{sources=JSON.parse(this.root()?.dataset.ktVideos||'{}');}catch{return;}
   const src=sources?.[key],target=machine.querySelector('.gt-display');
   // 配信名を固定。外部URL・利用者入力・未追加ファイルを使わない。
   if(typeof src!=='string'||!new RegExp('^/static/kiseki-media-veo-'+key+'\\.mp4\\?v=[a-f0-9]{10}$').test(src)||!target)return;
   const video=document.createElement('video');video.className='kt-video';video.muted=true;video.defaultMuted=true;video.playsInline=true;video.preload='none';video.tabIndex=-1;video.setAttribute('aria-hidden','true');
   const c={video,loading:0,end:0};this.current=c;
   const stop=()=>{if(this.current===c)this.cancel();};
   // 読み込み中は従来の背景。待機や操作の無効化を挟まない。
   c.loading=setTimeout(stop,1200);c.end=setTimeout(stop,durations[key]);
   video.onplaying=()=>{if(this.current!==c)return;if(!this.enabled()){stop();return;}clearTimeout(c.loading);video.dataset.playing='true';};
   video.onerror=stop;video.onended=stop;video.src=src;target.append(video);
   try{Promise.resolve(video.play()).catch(stop);}catch{stop();}
  }
  win(machine,kind){this.play(machine,kind==='stock'&&machine?.dataset.kisekiPhase==='zzone'?'zzone':kind);}
  transition(before,machine){
   const from=before?.dataset.kisekiPhase,to=machine?.dataset.kisekiPhase;
   if(!from||from===to||before.dataset.gtMachineId!==machine.dataset.gtMachineId)return;
   if(['gaia','zzone','zgame'].includes(to))this.play(machine,to);
  }
 }
 window.KisekiVideoDirector=KisekiVideoDirector;
})();

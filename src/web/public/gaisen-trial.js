// 無料試遊専用。抽選/ポイント/着席は全てサーバー側。自動プレイはしない。
(() => {
 let busy=false,audio=false,ctx=null,motion='normal',startAt=0,frame=0;
 try{audio=localStorage.getItem('gaisen-trial-audio')==='on';motion=localStorage.getItem('gaisen-trial-motion')||'normal';}catch{}
 const root=()=>document.querySelector('[data-gaisen-trial]');
 const actualMotion=()=>matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':motion;
 function ramp(){
  cancelAnimationFrame(frame);frame=0;
  const r=root();if(!r||document.hidden)return;
  const elapsed=performance.now()-startAt;
  const speed=actualMotion()==='normal'&&elapsed<480?.15+.85*Math.min(1,elapsed/480):1;
  r.querySelectorAll('.gt-reel.is-spinning .gt-reel-strip').forEach(el=>{const a=el.getAnimations()[0];if(a)a.playbackRate=speed;});
  if(speed<1)frame=requestAnimationFrame(ramp);
 }
 function prefs(){const r=root();if(!r)return;r.dataset.hidden=String(document.hidden);r.dataset.motion=actualMotion();r.querySelector('[data-gt-audio]').textContent='音：'+(audio?'ON':'OFF');r.querySelector('[data-gt-motion]').value=motion;if(actualMotion()==='instant')r.querySelectorAll('.gt-reel.is-stopped .gt-reel-strip').forEach(el=>el.getAnimations().forEach(a=>a.cancel()));ramp();}
 function prepareAudio(){if(!audio||document.hidden)return;try{ctx??=new AudioContext();void ctx.resume().catch(()=>{});}catch{}}
 function tone(action,index){
  if(!audio||document.hidden||!ctx||!['lever','stop'].includes(action))return;
  try{
   const t=ctx.currentTime;
   function pulse(type,from,to,delay,duration,volume){const o=ctx.createOscillator(),g=ctx.createGain();o.type=type;o.connect(g);g.connect(ctx.destination);o.frequency.setValueAtTime(from,t+delay);o.frequency.exponentialRampToValueAtTime(to,t+delay+duration);g.gain.setValueAtTime(.0001,t+delay);g.gain.exponentialRampToValueAtTime(volume,t+delay+.008);g.gain.exponentialRampToValueAtTime(.0001,t+delay+duration);o.start(t+delay);o.stop(t+delay+duration+.01);o.onended=()=>{o.disconnect();g.disconnect();};}
   if(action==='lever'){pulse('triangle',150,55,0,.1,.04);pulse('sine',90,310,.04,.28,.018);}
   else{pulse('triangle',510+index*70,150,0,.08,.035);pulse('sine',900+index*90,400,.018,.1,.012);}
  }catch{}
 }
 function mutePending(){const old=ctx;ctx=null;if(old)void old.close().catch(()=>{});}
 document.addEventListener('click',e=>{if(!e.target.closest?.('[data-gt-audio]'))return;audio=!audio;if(!audio)mutePending();else prepareAudio();try{localStorage.setItem('gaisen-trial-audio',audio?'on':'off');}catch{}prefs();});
 document.addEventListener('change',e=>{if(!e.target.matches?.('[data-gt-motion]'))return;motion=e.target.value;try{localStorage.setItem('gaisen-trial-motion',motion);}catch{}prefs();});
 document.addEventListener('submit',async e=>{
  const form=e.target;if(!(form instanceof HTMLFormElement)||!form.closest('[data-gaisen-trial]'))return;
  e.preventDefault();if(busy)return;busy=true;root().setAttribute('aria-busy','true');
  const action=form.elements.namedItem('action')?.value,index=Number(form.elements.namedItem('index')?.value);
  prepareAudio();
  try{
   const r=await fetch(form.getAttribute('action'),{method:'POST',body:new FormData(form),credentials:'same-origin'});
   const html=await r.text(),doc=new DOMParser().parseFromString(html,'text/html'),next=doc.querySelector('[data-gaisen-trial]');
   if(!next)throw Error('操作結果を確認できませんでした。再送せず「最新の状態を確認」から確認してください。');
   const times=[...root().querySelectorAll('.gt-reel')].map(el=>el.classList.contains('is-spinning')?el.querySelector('.gt-reel-strip').getAnimations()[0]?.currentTime:null);
   root().replaceWith(next);
   if(r.ok&&action==='lever')startAt=performance.now();
   prefs();
   root().querySelectorAll('.gt-reel.is-spinning').forEach(el=>{const i=Number(el.dataset.gtReel),a=el.querySelector('.gt-reel-strip').getAnimations()[0];if(a&&times[i]!=null&&action!=='lever')a.currentTime=times[i];});
   if(r.ok){
    tone(action,index);
    if(action==='stop'&&Number.isInteger(index)&&actualMotion()!=='instant'&&!document.hidden){
     const el=root().querySelector(`[data-gt-reel="${index}"].is-stopped .gt-reel-strip`);
     const distance=actualMotion()==='low'?2:7;
     el?.animate([{transform:`translateY(-${distance}px)`},{transform:`translateY(${distance/2}px)`,offset:.45},{transform:'translateY(0)'}],{duration:actualMotion()==='low'?120:210,easing:'ease-out'});
    }
   }
  }catch(e){const error=root()?.querySelector('[data-gt-error]');if(error){error.hidden=false;error.textContent=e.message||'通信できませんでした。最新の状態を確認してください。';}}
  finally{busy=false;root()?.removeAttribute('aria-busy');}
 });
 document.addEventListener('visibilitychange',()=>{if(document.hidden){mutePending();root()?.querySelectorAll('.gt-reel.is-stopped .gt-reel-strip').forEach(el=>el.getAnimations().forEach(a=>a.cancel()));}prefs();});
 window.addEventListener('pagehide',()=>{cancelAnimationFrame(frame);mutePending();});
 matchMedia('(prefers-reduced-motion:reduce)').addEventListener('change',prefs);prefs();
})();

// 無料試遊専用。抽選/ポイント/着席は全てサーバー側。自動プレイはしない。
(() => {
 let busy=false,audio=false,ctx=null,motion='normal',startAt=0,frame=0;
 try{audio=localStorage.getItem('gaisen-trial-audio')==='on';motion=localStorage.getItem('gaisen-trial-motion')||'normal';}catch{}
 let activeWin=null;const sounds=new Set();
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
 function prefs(){if(activeWin&&actualMotion()==='instant'&&!activeWin.sample)endWin();const r=root();if(!r)return;r.dataset.hidden=String(document.hidden);r.dataset.motion=actualMotion();r.querySelector('[data-gt-audio]').textContent='音：'+(audio?'ON':'OFF');r.querySelector('[data-gt-motion]').value=motion;r.querySelectorAll('[data-gt-win-mute]').forEach(b=>b.hidden=!audio);if(actualMotion()==='instant')r.querySelectorAll('.gt-reel.is-stopped .gt-reel-strip').forEach(el=>el.getAnimations().forEach(a=>a.cancel()));ramp();}
 function prepareAudio(){if(!audio||document.hidden)return;try{ctx??=new AudioContext();void ctx.resume().catch(()=>{});}catch{}}
 function stopSounds(pool){for(const o of [...pool]){try{o.stop();}catch{}sounds.delete(o);}pool.clear();}
 function pulse(type,from,to,delay,duration,volume,pool=sounds){
  if(!audio||document.hidden||!ctx)return;
  try{const t=ctx.currentTime,o=ctx.createOscillator(),g=ctx.createGain();o.type=type;o.connect(g);g.connect(ctx.destination);o.frequency.setValueAtTime(from,t+delay);o.frequency.exponentialRampToValueAtTime(to,t+delay+duration);g.gain.setValueAtTime(.0001,t+delay);g.gain.exponentialRampToValueAtTime(volume,t+delay+.008);g.gain.exponentialRampToValueAtTime(.0001,t+delay+duration);sounds.add(o);pool.add(o);o.onended=()=>{sounds.delete(o);pool.delete(o);o.disconnect();g.disconnect();};o.start(t+delay);o.stop(t+delay+duration+.01);}catch{}
 }
 function tone(action,index){
  if(action==='lever'){pulse('triangle',150,55,0,.1,.04);pulse('sine',90,310,.04,.28,.018);}
  else if(action==='stop'){pulse('triangle',510+index*70,150,0,.08,.035);pulse('sine',900+index*90,400,.018,.1,.012);}
 }
 function mutePending(){stopSounds(sounds);const old=ctx;ctx=null;if(old)void old.close().catch(()=>{});}
 function endWin(){
  const w=activeWin;if(!w)return;activeWin=null;
  w.timers.forEach(clearTimeout);stopSounds(w.sounds);
  if(w.dialog.open)w.dialog.close();
  if(w.focus?.isConnected)w.focus.focus({preventScroll:true});
 }
 function readWin(){const e=root()?.querySelector('[data-gt-win]');return e?{kind:e.dataset.winKind,added:Number(e.dataset.winAdded),set:Number(e.dataset.winSet),ggGames:Number(e.dataset.winGg),sggGames:Number(e.dataset.winSgg)}:null;}
 function celebrate(event,sample=false){
  endWin();if(!event||document.hidden||(!sample&&actualMotion()==='instant'))return;
  const d=root()?.querySelector('[data-gt-celebration]');if(!d||!['gg','sgg','god','stock'].includes(event.kind))return;
  const kind=event.kind,short=actualMotion()!=='normal',scene=d.querySelector('.gt-award-scene');
  const title={gg:'GOD GAME',sgg:'SPECIAL GOD GAME',god:'GOD',stock:'GG BOOST'}[kind];
  const prefix={gg:event.added?'神殿の扉が開く':'次なる神殿へ',sgg:'紅紫の覚醒',god:'神 降 臨',stock:'上乗せ確定'}[kind];
  const set=(name,value)=>d.querySelector('[data-gt-win-'+name+']').textContent=value;
  d.dataset.kind=kind;d.dataset.sample=String(sample);
  set('kicker',sample?'演出見本 · ポイントや進行は変わりません':'咲楽ノ宮 · 当選結果');set('title',title);set('prefix',prefix);
  set('count',event.added>0?'＋'+event.added:'第'+event.set);set('unit','SET');
  const detail=[event.added>0?'GG '+event.added+'セット獲得（開始分を含む）':'保存済みの次セットを開始'];
  if(event.sggGames>0)detail.push('SGG 残り'+event.sggGames+'G');if(event.ggGames>0)detail.push('GG 残り'+event.ggGames+'G');
  set('detail',detail.join(' · '));set('hint',sample?'表示だけの見本です':'結果は保存済みです');set('skip',short?'閉じる':'演出をスキップ');
  d.querySelector('[data-gt-win-mute]').hidden=!audio;
  const focused=document.activeElement;
  const w={dialog:d,timers:new Set(),sounds:new Set(),sample,focus:sample?focused:root()?.querySelector('.gt-lever')};activeWin=w;
  const later=(fn,delay)=>{const id=setTimeout(()=>{w.timers.delete(id);if(activeWin===w&&!document.hidden)fn();},delay);w.timers.add(id);};
  const chime=()=>{const notes=kind==='sgg'?[261.63,311.13,392,523.25]:kind==='stock'?[392,523.25,659.25]:[261.63,329.63,392,523.25];notes.forEach((n,i)=>pulse('sine',n,n,i*.11,short?.3:.7,short?.012:.018,w.sounds));if(kind==='god'&&!short)pulse('triangle',65.4,130.8,0,1.5,.025,w.sounds);};
  scene.dataset.stage=short?'award':kind==='stock'?'reveal':'charge';
  if(kind==='god')stopSounds(sounds);
  d.showModal();
  if(short){chime();if(!sample)later(endWin,2200);return;}
  const reveal=kind==='god'?1050:kind==='stock'?0:450,award=kind==='god'?2050:kind==='stock'?350:1050;
  later(()=>{scene.dataset.stage='reveal';chime();},reveal);
  later(()=>{scene.dataset.stage='award';},award);
  later(endWin,kind==='god'?6000:kind==='stock'?2800:4300);
 }
 document.addEventListener('click',e=>{
  if(e.target.closest?.('[data-gt-win-skip]')){endWin();return;}
  if(e.target.closest?.('[data-gt-win-mute]')){audio=false;mutePending();try{localStorage.setItem('gaisen-trial-audio','off');}catch{}prefs();return;}
  const b=e.target.closest?.('[data-gt-win-preview]');if(!b)return;
  prepareAudio();const kind=b.dataset.gtWinPreview;
  celebrate({kind,added:kind==='god'?5:1,set:1,ggGames:['god','gg'].includes(kind)?100:0,sggGames:kind==='sgg'?16:0},true);
 });
 document.addEventListener('cancel',e=>{if(e.target.matches?.('[data-gt-celebration]')){e.preventDefault();endWin();}},true);
 document.addEventListener('close',e=>{if(e.target===activeWin?.dialog)endWin();},true);
 document.addEventListener('click',e=>{if(!e.target.closest?.('[data-gt-audio]'))return;audio=!audio;if(!audio)mutePending();else prepareAudio();try{localStorage.setItem('gaisen-trial-audio',audio?'on':'off');}catch{}prefs();});
 document.addEventListener('change',e=>{if(!e.target.matches?.('[data-gt-motion]'))return;motion=e.target.value;try{localStorage.setItem('gaisen-trial-motion',motion);}catch{}prefs();});
 document.addEventListener('submit',async e=>{
  const form=e.target;if(!(form instanceof HTMLFormElement)||!form.closest('[data-gaisen-trial]'))return;
  e.preventDefault();if(busy)return;endWin();busy=true;root().setAttribute('aria-busy','true');
  const action=form.elements.namedItem('action')?.value,index=Number(form.elements.namedItem('index')?.value);
  const hadWin=!!root().querySelector('[data-gt-win]');prepareAudio();
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
    const win=action==='stop'&&!hadWin?readWin():null;
    if(win){celebrate(win);}else tone(action,index);
    if(!win&&action==='stop'&&Number.isInteger(index)&&actualMotion()!=='instant'&&!document.hidden){
     const el=root().querySelector(`[data-gt-reel="${index}"].is-stopped .gt-reel-strip`);
     const distance=actualMotion()==='low'?2:7;
     el?.animate([{transform:`translateY(-${distance}px)`},{transform:`translateY(${distance/2}px)`,offset:.45},{transform:'translateY(0)'}],{duration:actualMotion()==='low'?120:210,easing:'ease-out'});
    }
   }
  }catch(e){const error=root()?.querySelector('[data-gt-error]');if(error){error.hidden=false;error.textContent=e.message||'通信できませんでした。最新の状態を確認してください。';}}
  finally{busy=false;root()?.removeAttribute('aria-busy');}
 });
 document.addEventListener('visibilitychange',()=>{if(document.hidden){endWin();mutePending();root()?.querySelectorAll('.gt-reel.is-stopped .gt-reel-strip').forEach(el=>el.getAnimations().forEach(a=>a.cancel()));}prefs();});
 window.addEventListener('pagehide',()=>{endWin();cancelAnimationFrame(frame);mutePending();});
 matchMedia('(prefers-reduced-motion:reduce)').addEventListener('change',prefs);prefs();
})();

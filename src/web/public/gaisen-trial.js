// 無料試遊専用。抽選/ポイント/着席は全てサーバー側。自動プレイはしない。
(() => {
 let busy=false,audio=false,motion='normal',startAt=0,frame=0;
 try{audio=localStorage.getItem('gaisen-trial-audio')==='on';motion=localStorage.getItem('gaisen-trial-motion')||'normal';}catch{}
 let activeWin=null,volume=.65,focusMode=false;
 try{const saved=Number(localStorage.getItem('gaisen-trial-volume'));if([.3,.65,1].includes(saved))volume=saved;focusMode=localStorage.getItem('gaisen-trial-focus')==='on';}catch{}
 const root=()=>document.querySelector('[data-gaisen-trial]');
 const bank=window.GaisenSampleBank?new window.GaisenSampleBank(JSON.parse(root()?.dataset.gtSounds||'{}')):null;
 const actualMotion=()=>matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':motion;
 function ramp(){
  cancelAnimationFrame(frame);frame=0;
  const r=root();if(!r||document.hidden)return;
  const elapsed=performance.now()-startAt;
  const speed=actualMotion()==='normal'&&elapsed<360?.12+.88*Math.min(1,elapsed/360):1;
  r.querySelectorAll('.gt-reel.is-spinning .gt-reel-strip').forEach(el=>{const a=el.getAnimations()[0];if(a)a.playbackRate=speed;});
  if(speed<1)frame=requestAnimationFrame(ramp);
 }
 function prefs(){bank?.setVolume(volume);bank?.setEnabled(audio&&!document.hidden);if(activeWin&&actualMotion()==='instant'&&!activeWin.sample)endWin();const r=root();if(!r)return;r.dataset.focus=String(focusMode&&!!r.querySelector('.gt-machine'));r.querySelectorAll('[data-gt-focus]').forEach(b=>{b.textContent=focusMode?'全体に戻る':'操作に集中';b.setAttribute('aria-pressed',String(focusMode));});r.querySelector('[data-gt-volume]').value=String(volume);r.querySelector('[data-gt-audio]').setAttribute('aria-pressed',String(audio));r.dataset.hidden=String(document.hidden);r.dataset.motion=actualMotion();r.querySelector('[data-gt-audio]').textContent='音：'+(audio?'ON':'OFF');r.querySelector('[data-gt-motion]').value=motion;r.querySelectorAll('[data-gt-win-mute]').forEach(b=>b.hidden=!audio);if(actualMotion()==='instant')r.querySelectorAll('.gt-reel.is-stopped .gt-reel-strip').forEach(el=>el.getAnimations().forEach(a=>a.cancel()));ramp();}
 function prepareAudio(){bank?.setEnabled(audio&&!document.hidden);bank?.prepare();}
 function resultTone(before,after){
  if(!after)return;
  if(before?.dataset.scene!==after.dataset.scene){
   void bank?.play(['medusa','ex'].includes(after.dataset.scene)?after.dataset.scene:'phase');
   after.dataset.feedback='phase';
  }else if(after.dataset.spinning==='false'&&Number(after.dataset.paid)>0){
   // 最終STOPの成功時だけ。読込み・場面設定・再送では鳴らさない。
   const replay=!!after.querySelector('[data-gt-settlement]')?.textContent.includes('リプレイ');
   void bank?.play(replay?'replay':'payout');
   after.dataset.feedback='paid';
  }
 }
 function tone(action,index){if(action==='lever')void bank?.play('lever');else if(action==='stop'&&Number.isInteger(index))void bank?.play(['stop-left','stop-middle','stop-right'][index]);}
 function mutePending(){bank?.setEnabled(false);}
 function endWin(){
  const w=activeWin;if(!w)return;activeWin=null;
  w.timers.forEach(clearTimeout);bank?.stopGroup('win');
  if(w.dialog.open)w.dialog.close();
  if(w.sample&&w.focus?.isConnected)w.focus.focus({preventScroll:true});
 }
 function readWin(){const e=root()?.querySelector('[data-gt-win]');return e?{kind:e.dataset.winKind,added:Number(e.dataset.winAdded),set:Number(e.dataset.winSet),ggGames:Number(e.dataset.winGg),sggGames:Number(e.dataset.winSgg)}:null;}
 function celebrate(event,sample=false){
  endWin();if(!event||document.hidden||(!sample&&actualMotion()==='instant'))return;
  const d=root()?.querySelector('[data-gt-celebration]');if(!d||!['gg','sgg','god','stock'].includes(event.kind))return;
  const kind=event.kind,short=actualMotion()!=='normal',scene=(!sample&&root()?.querySelector('[data-gt-lcd-award]'))||d.querySelector('.gt-award-scene');
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
  const w={dialog:d,timers:new Set(),sample,focus:sample?focused:root()?.querySelector('.gt-lever')};activeWin=w;
  const later=(fn,delay)=>{const id=setTimeout(()=>{w.timers.delete(id);if(activeWin===w&&!document.hidden)fn();},delay);w.timers.add(id);};
  const chime=()=>{void bank?.play(kind,{group:'win',level:short?.55:.8});};
  scene.dataset.stage=short?'award':kind==='stock'?'reveal':'charge';
  if(kind==='god')bank?.stopAll();
  if(sample)d.showModal();else w.focus?.focus({preventScroll:true});
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
 document.addEventListener('click',e=>{const b=e.target.closest?.('[data-gt-focus]');if(!b)return;focusMode=!focusMode;try{localStorage.setItem('gaisen-trial-focus',focusMode?'on':'off');}catch{}prefs();root()?.querySelector('.gt-machine')?.scrollIntoView({block:'start',behavior:'instant'});});
 document.addEventListener('change',e=>{if(!e.target.matches?.('[data-gt-volume]'))return;volume=Number(e.target.value);bank?.setVolume(volume);prepareAudio();try{localStorage.setItem('gaisen-trial-volume',String(volume));}catch{}});
 document.addEventListener('change',e=>{if(!e.target.matches?.('[data-gt-motion]'))return;motion=e.target.value;try{localStorage.setItem('gaisen-trial-motion',motion);}catch{}prefs();});
 // キーを押し続けても連続送信しない。入力欄・別の操作・ダイアログは奪わない。
 document.addEventListener('keydown',e=>{
  if(e.isComposing||e.ctrlKey||e.metaKey||e.altKey||e.shiftKey||document.hidden)return;
  const r=root(),target=e.target;
  if(!r||!r.querySelector('.gt-machine')||activeWin?.sample||document.querySelector('dialog[open]'))return;
  if(target?.closest?.('input,select,textarea,[contenteditable]:not([contenteditable="false"]),a,summary,[role="textbox"]'))return;
  if(target?.closest?.('button')&&!target.closest('[data-gt-key]'))return;
  const key=e.code==='Space'?'lever':({'1':'stop-0','2':'stop-1','3':'stop-2'})[e.key];
  if(!key)return;
  const button=r.querySelector(`[data-gt-key="${key}"]`);if(!button)return;
  e.preventDefault();if(e.repeat||busy||button.disabled)return;button.click();
 });
 document.addEventListener('submit',async e=>{
  const form=e.target;if(!(form instanceof HTMLFormElement)||!form.closest('[data-gaisen-trial]'))return;
  e.preventDefault();if(busy)return;endWin();busy=true;root().setAttribute('aria-busy','true');
  const action=form.elements.namedItem('action')?.value,index=Number(form.elements.namedItem('index')?.value);
  const hadWin=!!root().querySelector('[data-gt-win]'),before=root().querySelector('.gt-machine');
  const focusedKey=document.activeElement?.dataset?.gtKey,pressed=form.querySelector('[data-gt-key]');if(pressed)pressed.dataset.pressed='true';prepareAudio();
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
    if(win){celebrate(win);}else {tone(action,index);if(action==='stop')resultTone(before,root().querySelector('.gt-machine'));}
    if(focusedKey&&!win){const target=root().querySelector(`[data-gt-key="${focusedKey}"]:not(:disabled)`)||root().querySelector('.gt-stop.is-next:not(:disabled)')||root().querySelector('.gt-lever:not(:disabled)');target?.focus({preventScroll:true});}
    if(!win&&action==='stop'&&Number.isInteger(index)&&actualMotion()!=='instant'&&!document.hidden){
     const el=root().querySelector(`[data-gt-reel="${index}"].is-stopped .gt-reel-strip`);
     // 前後の絵柄を余白に置き、窓を空けずに減速して定位置へ収める。
     const height=el?.querySelector('.gt-symbol')?.getBoundingClientRect().height;
     if(height){const travel=actualMotion()==='low'?2:height*.72;
      el.animate([{transform:`translateY(${-height-travel}px)`,filter:actualMotion()==='low'?'none':'blur(.6px)'},{transform:`translateY(${-height+2}px)`,filter:'none',offset:.82},{transform:`translateY(${-height}px)`,filter:'none'}],{duration:actualMotion()==='low'?100:180,easing:'cubic-bezier(.12,.65,.22,1)'});
     }
    }
   }
  }catch(e){const error=root()?.querySelector('[data-gt-error]');if(error){error.hidden=false;error.textContent=e.message||'通信できませんでした。最新の状態を確認してください。';}}
  finally{if(pressed)delete pressed.dataset.pressed;busy=false;root()?.removeAttribute('aria-busy');}
 });
 document.addEventListener('visibilitychange',()=>{if(document.hidden){endWin();mutePending();root()?.querySelectorAll('.gt-reel.is-stopped .gt-reel-strip').forEach(el=>el.getAnimations().forEach(a=>a.cancel()));}prefs();});
 window.addEventListener('pagehide',()=>{endWin();cancelAnimationFrame(frame);mutePending();});
 matchMedia('(prefers-reduced-motion:reduce)').addEventListener('change',prefs);prefs();
})();

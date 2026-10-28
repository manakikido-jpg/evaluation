// 固定された演出見本だけ。場面・STOPは端末内で切り替え、ゲームAPIは呼ばない。
(() => {
 const root=document.querySelector('[data-casino-scenes]');if(!root)return;
 const read=(key,fallback)=>{try{return localStorage.getItem(key)||fallback;}catch{return fallback;}};
 const save=(key,value)=>{try{localStorage.setItem(key,value);}catch{}};
 const reduce=matchMedia('(prefers-reduced-motion:reduce)');
 let stage=Number(root.dataset.sceneInitial)||0,audio=read('sakura-scenes-audio','off')==='on',motion=read('sakura-scenes-motion',reduce.matches?'instant':'normal'),context=null,playing=false;
 if(!['normal','low','instant'].includes(motion))motion='normal';
 const pending=new Set();
 const cancel=()=>{pending.forEach(clearTimeout);pending.clear();};
 const later=(fn,delay)=>{const timer=setTimeout(()=>{pending.delete(timer);fn();},delay);pending.add(timer);};
 const sound=(kind)=>{if(!audio||document.hidden)return;try{
  context??=new AudioContext();if(context.state==='suspended')void context.resume();
  const t=context.currentTime,notes=kind==='result'?[523,659,784,1046]:kind==='settle'?[440,392]:kind==='demo'?[523,659]:kind==='drama'?[196,220]:kind==='dice'?[170,240,190]:kind==='reel'?[820]:[620];
  notes.forEach((frequency,i)=>{const osc=context.createOscillator(),gain=context.createGain(),start=t+i*.09;osc.type=kind==='dice'?'sine':'triangle';osc.frequency.setValueAtTime(frequency,start);gain.gain.setValueAtTime(.025,start);gain.gain.exponentialRampToValueAtTime(.001,start+.12);osc.connect(gain);gain.connect(context.destination);osc.start(start);osc.stop(start+.13);});
 }catch{}};
 const stopAudio=()=>{if(context){void context.close().catch(()=>{});context=null;}};
 function preferences(){root.dataset.sceneMotion=reduce.matches?'instant':motion;root.querySelector('[data-scene-motion]').value=motion;const b=root.querySelector('[data-scene-audio]');b.textContent=audio?'音 ON':'音 OFF';b.setAttribute('aria-pressed',String(audio));}
 function playbackButton(){const button=root.querySelector('[data-scene-play]');button.textContent=playing?'■ 再生を止める':'▶ 連続で演出を見る';button.setAttribute('aria-pressed',String(playing));}
 function stopReplay(pause=false){playing=false;cancel();root.classList.toggle('csp-replay-paused',pause);if(pause)stopAudio();playbackButton();}
 function stopReel(button,manual){
  if(button.disabled||stage!==1)return;if(manual)stopReplay();
  button.disabled=true;button.setAttribute('aria-pressed','true');root.querySelector(`[data-scene-panel="1"] [data-scene-reel="${button.dataset.sceneStop}"]`).classList.add('csp-stopped');sound('reel');
  const left=root.querySelectorAll('[data-scene-panel="1"] [data-scene-stop]:not(:disabled)').length;root.dataset.sceneStops=String(3-left);
  if(left===1)root.querySelector('[data-scene-cue-live]').textContent='最後のSTOP、その瞬間を待つ。';
  if(manual&&left===0)later(()=>show(2),root.dataset.sceneMotion==='normal'?350:0);
 }
 function queuePhase(){
  if(!playing)return;if(stage===3){playing=false;playbackButton();return;}
  const low=root.dataset.sceneMotion!=='normal',family=root.dataset.sceneFamily;
  const delay=low?600:stage===0?1100:stage===1?(family==='roulette'?3200:family==='slots'||family==='atslot'?2500:2200):1400;
  if(stage===1&&(family==='slots'||family==='atslot'))[0,1,2].forEach((n)=>later(()=>{const b=root.querySelector(`[data-scene-panel="1"] [data-scene-stop="${n}"]`);if(b)stopReel(b,false);},low?150+n*140:650+n*650));
  if(stage===1&&!low)later(()=>sound('drama'),delay-550);
  later(()=>show(stage+1),delay);
 }
 function show(next,announce=true){
  cancel();root.classList.remove('csp-replay-paused');stage=Math.max(0,Math.min(3,next));root.dataset.sceneStage=String(stage);root.dataset.sceneStops='0';
  root.querySelectorAll('[data-scene-panel]').forEach(panel=>{panel.hidden=Number(panel.dataset.scenePanel)!==stage;panel.querySelectorAll('[data-scene-reel]').forEach(reel=>reel.classList.remove('csp-stopped'));panel.querySelectorAll('[data-scene-stop]').forEach(button=>{button.disabled=stage!==1;button.setAttribute('aria-pressed','false');});});
  root.querySelectorAll('[data-scene-phase]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.scenePhase)===stage)));
  root.querySelector('[data-scene-prev]').disabled=stage===0;root.querySelector('[data-scene-next]').textContent=stage===3?'最初から見る':'次の場面';
  root.querySelector('[data-scene-cue-live]').textContent=root.querySelector(`[data-scene-panel="${stage}"]`).dataset.sceneCue;
  const active=root.querySelector(`[data-scene-phase="${stage}"]`);root.querySelector('[data-scene-caption]').textContent=active.textContent.slice(2)+'の見本';
  const url=new URL(location.href);url.searchParams.set('stage',String(stage));history.replaceState(null,'',url);
  if(announce){sound(stage===3?(root.dataset.sceneOutcome==='win'?'result':root.dataset.sceneOutcome==='demo'?'demo':'settle'):root.dataset.sceneFamily==='dice'?'dice':'card');if(stage===1&&root.dataset.sceneFamily==='dice'&&root.dataset.sceneMotion==='normal')later(()=>sound('dice'),180);}
  queuePhase();
 }
 root.addEventListener('click',event=>{
  const target=event.target instanceof Element?event.target:null;if(!target)return;
  if(target.closest('[data-scene-play]')){if(playing){stopReplay(true);return;}if(root.dataset.sceneMotion==='instant'){stopReplay();show(3);return;}playing=true;playbackButton();show(0);return;}
  if(target.closest('[data-scene-skip]')){stopReplay();show(3);return;}
  const phase=target.closest('[data-scene-phase]');if(phase){stopReplay();show(Number(phase.dataset.scenePhase));return;}
  if(target.closest('[data-scene-next]')){stopReplay();return show(stage===3?0:stage+1);}
  if(target.closest('[data-scene-prev]')){stopReplay();return show(stage-1);}
  if(target.closest('[data-scene-audio]')){audio=!audio;save('sakura-scenes-audio',audio?'on':'off');if(!audio)stopAudio();preferences();if(audio)sound('card');return;}
  if(target.closest('[data-scene-fullscreen]')){const promise=document.fullscreenElement?document.exitFullscreen?.():root.requestFullscreen?.();const report=()=>{const output=root.querySelector('[data-scene-status]');output.hidden=false;output.textContent='この端末では全画面表示を使えません。通常の画面で確認できます。';};if(promise)void promise.catch(report);else report();return;}
  const stop=target.closest('[data-scene-stop]');if(stop)stopReel(stop,true);
 });
 root.addEventListener('change',event=>{if(event.target.matches('[data-scene-motion]')){motion=event.target.value;save('sakura-scenes-motion',motion);const wasPlaying=playing;stopReplay();preferences();show(wasPlaying&&root.dataset.sceneMotion==='instant'?3:stage,false);}});
 document.addEventListener('visibilitychange',()=>{root.classList.toggle('csp-paused',document.hidden);if(document.hidden){stopReplay(true);}});
 window.addEventListener('pagehide',()=>{stopReplay();stopAudio();});reduce.addEventListener('change',()=>{stopReplay();preferences();show(stage,false);});
 preferences();show(stage,false);
})();

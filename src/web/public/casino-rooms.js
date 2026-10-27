// 運営の固定サンプルだけ。送信はGETに限り、通信失敗時は同じ操作を自動で送り直さない。
(() => {
 const path='/economy/casino-test';
 let root=document.querySelector('[data-immersive-root]');if(!root)return;
 const get=(key,fallback)=>{try{return localStorage.getItem(key)??fallback;}catch{return fallback;}};
 const set=(key,value)=>{try{localStorage.setItem(key,value);}catch{}};
 const reduced=matchMedia('(prefers-reduced-motion:reduce)').matches;
 let audio=get('sakura-room-audio','off')==='on',motion=get('sakura-room-motion',reduced?'instant':'normal');
 if(!['normal','low','instant'].includes(motion))motion='normal';
 let context=null,busy=false,soundTimer=0,controller=null;
 let revealTimer=0,countFrame=0;
 const timers=new Set();
 const later=(fn,ms)=>{const id=setTimeout(()=>{timers.delete(id);fn();},ms);timers.add(id);return id;};
 const clearSoundTimers=()=>{clearTimeout(soundTimer);for(const timer of timers)clearTimeout(timer);timers.clear();};
 const stopSound=()=>{clearSoundTimers();if(context){void context.close().catch(()=>{});context=null;}};
 const tone=(freq,duration=.06,offset=0)=>{if(!audio||document.hidden)return;try{context??=new AudioContext();if(context.state==='suspended')void context.resume();const oscillator=context.createOscillator(),gain=context.createGain(),t=context.currentTime+offset;oscillator.type='triangle';oscillator.frequency.value=freq;gain.gain.setValueAtTime(.025,t);gain.gain.exponentialRampToValueAtTime(.001,t+duration);oscillator.connect(gain);gain.connect(context.destination);oscillator.start(t);oscillator.stop(t+duration);}catch{}};
 const paper=(duration=.06)=>{if(!audio||document.hidden)return;try{context??=new AudioContext();if(context.state==='suspended')void context.resume();const buffer=context.createBuffer(1,Math.ceil(context.sampleRate*duration),context.sampleRate),samples=buffer.getChannelData(0);for(let i=0;i<samples.length;i++)samples[i]=(Math.random()*2-1)*(1-i/samples.length);const source=context.createBufferSource(),filter=context.createBiquadFilter(),gain=context.createGain();source.buffer=buffer;filter.type='highpass';filter.frequency.value=1200;gain.gain.value=.045;source.connect(filter);filter.connect(gain);gain.connect(context.destination);source.start();}catch{}};

 function apply(){root.classList.remove('ir-mode-normal','ir-mode-low','ir-mode-instant');root.classList.add('ir-mode-'+motion);root.querySelector('[data-ir-motion]').value=motion;const button=root.querySelector('[data-ir-audio]');button.textContent=audio?'音 ON':'音 OFF';button.setAttribute('aria-pressed',String(audio));}
 // 音とは別に結果表示を管理する。音を切っても回転や払戻を止めない。
 function clearRound(){clearTimeout(revealTimer);cancelAnimationFrame(countFrame);revealTimer=0;countFrame=0;}
 function syncWheel(){
  const form=root.querySelector('form[data-rb]');if(!form||form.dataset.rbSettled==='true')return;
  const numbers=new Set();form.querySelectorAll('.placed[data-rb-covers]').forEach(cell=>cell.dataset.rbCovers.split(',').forEach(n=>numbers.add(n)));
  root.querySelectorAll('[data-ir-pocket]').forEach(pocket=>pocket.classList.toggle('ir-pocket-bet',numbers.has(pocket.dataset.irPocket)));
 }
 function finishRound(animate=false){
  clearRound();if(!root.querySelector('.ir-roulette')||root.dataset.irFinished!=='true')return;
  root.dataset.irPhase='settled';root.classList.remove('ir-spinning');root.classList.add('ir-still');
  const result=root.querySelector('[data-ir-roulette-result]');result?.removeAttribute('aria-hidden');
  const number=root.querySelector('.ir-pocket-result')?.dataset.irPocket;
  root.querySelector('.c-wheel2')?.setAttribute('aria-label',`出た数字 ${number}`);
  const paid=root.querySelector('[data-ir-payout]'),balance=root.querySelector('[data-ir-balance]');
  const total=Number(paid?.dataset.irPayout||0),before=Number(root.dataset.irBalanceBefore),after=Number(root.dataset.irBalanceAfter);
  root.querySelector('[data-ir-round-status]').textContent=total>0?'払戻あり · 次の回へ進めます':'結果確定 · 次の回へ進めます';
  root.querySelector('[data-ir-skip]').hidden=true;
  root.querySelectorAll('.ir-next').forEach(link=>{link.inert=false;link.removeAttribute('aria-disabled');});
  const paint=(progress)=>{if(paid)paid.textContent=Math.floor(total*progress).toLocaleString('ja-JP');if(balance)balance.textContent=Math.floor(before+(after-before)*progress).toLocaleString('ja-JP');};
  if(animate&&motion==='normal'&&!reduced&&total>0){const start=performance.now();const tick=now=>{const progress=Math.min(1,(now-start)/850);paint(1-(1-progress)**3);if(progress<1)countFrame=requestAnimationFrame(tick);};paint(0);countFrame=requestAnimationFrame(tick);}else paint(1);
 }
 function startRound(replay){
  clearRound();root.classList.remove('ir-spinning','ir-still');syncWheel();
  if(!root.querySelector('.ir-roulette')){delete root.dataset.irPhase;return;}
  if(root.dataset.irFinished!=='true'){root.dataset.irPhase='bet';return;}
  const delay=replay&&!reduced?(motion==='normal'?5100:motion==='low'?750:0):0;
  if(!delay){finishRound();return;}
  root.dataset.irPhase='spinning';root.classList.add('ir-spinning');
  root.querySelector('[data-ir-roulette-result]')?.setAttribute('aria-hidden','true');
  root.querySelector('.c-wheel2')?.setAttribute('aria-label','ルーレット回転中');
  root.querySelector('[data-ir-balance]').textContent=Number(root.dataset.irBalanceBefore).toLocaleString('ja-JP');
  root.querySelector('[data-ir-round-status]').textContent='回転中 · BETした数字は金色';root.querySelector('[data-ir-skip]').hidden=false;
  root.querySelectorAll('.ir-next').forEach(link=>{link.inert=true;link.setAttribute('aria-disabled','true');});
  revealTimer=setTimeout(()=>finishRound(true),delay);
 }
 function message(text){const el=root.querySelector('[data-ir-network]');el.textContent=text;el.hidden=!text;}
 async function visit(url,historyMode='push'){
  if(busy)return;busy=true;root.classList.add('ir-busy');message('');clearSoundTimers();controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);
  try{
   const response=await fetch(url,{credentials:'same-origin',cache:'no-store',signal:controller.signal});
   if(response.redirected){const destination=new URL(response.url);if(destination.origin===location.origin&&destination.pathname!==path){location.assign(destination.href);return;}}
   if(response.status===400){message('入力・チップの合計・見本の残高を確認して、もう一度お試しください。');return;}
   if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))throw Error('response');
   const doc=new DOMParser().parseFromString(await response.text(),'text/html'),next=doc.querySelector('[data-immersive-root]');if(!next)throw Error('content');
   const imported=document.importNode(next,true);clearRound();root.replaceChildren(...imported.childNodes);root.dataset.irFinished=next.dataset.irFinished;root.dataset.irNet=next.dataset.irNet;root.dataset.irBalanceBefore=next.dataset.irBalanceBefore;root.dataset.irBalanceAfter=next.dataset.irBalanceAfter;apply();
   if(historyMode==='push')history.pushState(null,'',url);
   document.dispatchEvent(new CustomEvent('c-live-updated'));startRound(historyMode==='push');
   if(root.querySelector('.ir-roulette')&&root.dataset.irFinished==='true'&&audio){const duration=motion==='normal'&&!reduced?4900:motion==='low'&&!reduced?650:0;if(duration)for(let i=0;i<16;i++)later(()=>{tone(1400+i*25,.025);paper(.018);},duration*(i/15)**2);}
   else paper(.07);
   if(root.dataset.irFinished==='true'&&Number(root.dataset.irNet)>0){const delay=root.querySelector('.ir-roulette')?(motion==='normal'&&!reduced?5100:motion==='low'&&!reduced?750:0):350;soundTimer=setTimeout(()=>{tone(660,.15);tone(880,.2,.16);tone(1100,.3,.32);},delay);}
   else tone(560,.05);
  }catch(error){if(error.name!=='AbortError'||!document.hidden)message('通信を確認できませんでした。画面は残しています。接続を確かめて再度お試しください。');}
  finally{clearTimeout(timer);busy=false;root.classList.remove('ir-busy');controller=null;}
 }
 document.addEventListener('submit',event=>{const form=event.target;if(!(form instanceof HTMLFormElement)||!root.contains(form)||event.defaultPrevented)return;if(form.dataset.rbSettled==='true'){event.preventDefault();return;}const url=new URL(form.action,location.href);if(url.pathname!==path||form.method.toLowerCase()!=='get')return;event.preventDefault();const data=new FormData(form);const button=event.submitter;if(button?.name)data.set(button.name,button.value);url.search=new URLSearchParams(data).toString();tone(900,.035);void visit(url.href);},true);
 document.addEventListener('click',event=>{const target=event.target instanceof Element?event.target:null;if(!target||!root.contains(target))return;
  if(target.closest('[data-ir-skip]')){clearSoundTimers();finishRound();return;}
  if(target.closest('.ir-next[aria-disabled="true"]')){event.preventDefault();return;}
  if(target.closest('[data-ir-audio]')){audio=!audio;set('sakura-room-audio',audio?'on':'off');if(!audio)stopSound();apply();if(audio)tone(700,.1);return;}
  if(target.closest('[data-ir-fullscreen]')){const task=document.fullscreenElement?document.exitFullscreen?.():root.requestFullscreen?.();if(task)void task.catch(()=>message('この端末では没入表示を使えません。通常の表示で確認できます。'));else message('この端末では没入表示を使えません。');return;}
  const link=target.closest('a[href]');if(link&&event.button===0&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey){const url=new URL(link.href);if(url.origin===location.origin&&url.pathname===path){event.preventDefault();tone(650,.04);void visit(url.href);return;}}
  if(target.closest('button'))tone(target.closest('.c-rb-cell,.c-chip')?1250:700,.035);
 });
 document.addEventListener('change',event=>{if(!event.target.matches?.('[data-ir-motion]'))return;motion=event.target.value;set('sakura-room-motion',motion);clearSoundTimers();apply();if(root.dataset.irFinished==='true'){finishRound();} });
 document.addEventListener('input',event=>{if(root.contains(event.target)&&event.target.matches?.('form[data-rb]'))syncWheel();});
 window.addEventListener('popstate',()=>{if(location.pathname===path)void visit(location.href,'none');});
 document.addEventListener('visibilitychange',()=>{root.classList.toggle('ir-paused',document.hidden);if(document.hidden){if(root.dataset.irPhase==='spinning')finishRound();clearSoundTimers();if(context)void context.suspend();}});
 window.addEventListener('pageshow',event=>{if(event.persisted&&root.dataset.irPhase==='spinning')finishRound();});
 window.addEventListener('pagehide',()=>{controller?.abort();clearRound();stopSound();});
 apply();startRound(false);
})();

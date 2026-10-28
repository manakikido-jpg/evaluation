// 無料試遊専用。抽選/ポイント/着席は全てサーバー側。自動プレイはしない。
(() => {
 let busy=false,audio=false,ctx=null,motion='normal';
 try{audio=localStorage.getItem('gaisen-trial-audio')==='on';motion=localStorage.getItem('gaisen-trial-motion')||'normal';}catch{}
 const root=()=>document.querySelector('[data-gaisen-trial]');
 function prefs(){const r=root();if(!r)return;r.dataset.motion=matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':motion;r.querySelector('[data-gt-audio]').textContent='音：'+(audio?'ON':'OFF');r.querySelector('[data-gt-motion]').value=motion;}
 function tone(action){if(!audio||document.hidden)return;try{ctx??=new AudioContext();void ctx.resume();const t=ctx.currentTime,o=ctx.createOscillator(),g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.frequency.setValueAtTime(action==='lever'?180:520,t);o.frequency.exponentialRampToValueAtTime(action==='lever'?80:260,t+.1);g.gain.setValueAtTime(.025,t);g.gain.exponentialRampToValueAtTime(.0001,t+.13);o.start(t);o.stop(t+.14);}catch{}}
 function mutePending(){const old=ctx;ctx=null;if(old)void old.close().catch(()=>{});}
 document.addEventListener('click',e=>{if(!e.target.closest?.('[data-gt-audio]'))return;audio=!audio;if(!audio)mutePending();try{localStorage.setItem('gaisen-trial-audio',audio?'on':'off');}catch{}prefs();});
 document.addEventListener('change',e=>{if(!e.target.matches?.('[data-gt-motion]'))return;motion=e.target.value;try{localStorage.setItem('gaisen-trial-motion',motion);}catch{}prefs();});
 document.addEventListener('submit',async e=>{
  const form=e.target;if(!(form instanceof HTMLFormElement)||!form.closest('[data-gaisen-trial]'))return;
  e.preventDefault();if(busy)return;busy=true;root().setAttribute('aria-busy','true');const action=form.elements.namedItem('action')?.value;
  try{const r=await fetch(form.getAttribute('action'),{method:'POST',body:new FormData(form),credentials:'same-origin'});const html=await r.text(),doc=new DOMParser().parseFromString(html,'text/html'),next=doc.querySelector('[data-gaisen-trial]');if(!next)throw Error('操作結果を確認できませんでした。再送せず「最新の状態を確認」から確認してください。');root().replaceWith(next);prefs();if(r.ok)tone(action);}
  catch(e){const error=root()?.querySelector('[data-gt-error]');if(error){error.hidden=false;error.textContent=e.message||'通信できませんでした。最新の状態を確認してください。';}}
  finally{busy=false;root()?.removeAttribute('aria-busy');}
 });
 document.addEventListener('visibilitychange',()=>{if(document.hidden)mutePending();});window.addEventListener('pagehide',mutePending);prefs();
})();

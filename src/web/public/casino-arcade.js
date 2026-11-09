// 表示は保存済みの公開結果だけ。金額・抽選・精算はサーバーで確定する。
(() => {
 let dispose=()=>{};
 function init(){
  dispose();const root=document.querySelector('[data-casino-arcade]');if(!root)return;
  const listeners=new AbortController(),reduced=()=>matchMedia('(prefers-reduced-motion:reduce)').matches,animations=new Set();
  let timer=0,soundTimer=0,controller=null,stopped=false,polling=false,submitting=false,model;
  try{model=JSON.parse(root.dataset.agModel||'null');}catch{return;}
  const bet=Number(root.dataset.agBet||0),animate=(el,frames,options)=>{if(!el||reduced()||document.hidden)return;const a=el.animate(frames,options);animations.add(a);a.onfinish=()=>animations.delete(a);};
  const show=(selector,value)=>{const el=root.querySelector(selector);if(el&&el.textContent!==value)el.textContent=value;},pretty=n=>(n/1000).toFixed(3).replace(/\.?0+$/,'')+'倍';
  const stop=()=>{stopped=true;clearTimeout(timer);clearTimeout(soundTimer);controller?.abort();controller=null;for(const a of animations)a.cancel();animations.clear();listeners.abort();};dispose=stop;
  if(model?.done){
   const wheel=root.querySelector('[data-ag-wheel]');if(wheel){const target=model.kind==='moneywheel'?[85.5,220.5,292.5,337.5][model.index]:(model.index+.5)*36,degrees=1800-target;wheel.style.transform=`rotate(${degrees}deg)`;animate(wheel,[{transform:'rotate(0deg)'},{transform:`rotate(${degrees}deg)`}],{duration:2600,easing:'cubic-bezier(.12,.65,.18,1)'});}
   if(model.kind==='duckrace')for(const el of root.querySelectorAll('[data-ag-duck]')){const winner=Number(el.dataset.agDuck)===model.index,distance=el.parentElement.clientWidth-85;el.style.transform=`translateX(${distance*(winner?1:.65+Number(el.dataset.agDuck)*.04)}px)`;animate(el,[{transform:'translateX(0px)'},{transform:el.style.transform}],{duration:winner?2900:3300,easing:'cubic-bezier(.25,.35,.4,1)'});}
   if(model.kind==='plinko'){
    const ball=root.querySelector('[data-ag-ball]');if(ball){const points=[[240,25]];let x=240;model.path.forEach((n,i)=>{points.push([x,65+i*43]);x+=n?20:-20;points.push([x,90+i*43]);});points.push([x,470]);ball.setAttribute('cx','0');ball.setAttribute('cy','0');ball.style.transform=`translate(${x}px,470px)`;animate(ball,points.map(([px,py])=>({transform:`translate(${px}px,${py}px)`})),{duration:3000,easing:'linear'});}
   }
   let fresh=true;try{const key='sakura-arcade-seen-'+root.dataset.agRound+'-'+root.dataset.agVersion;fresh=!sessionStorage.getItem(key);sessionStorage.setItem(key,'1');}catch{}
   if(fresh)soundTimer=setTimeout(()=>{if(!stopped&&!document.hidden)window.CasinoSound?.tone(model.mult?700:180,0,.12,{type:'sine',vol:.06});},reduced()?100:['fortune','moneywheel','plinko','duckrace'].includes(model.kind)?3000:150);
  }
  const start=root.querySelector('[data-ag-start]');if(start){const picks=[...start.querySelectorAll('input[name=picks]')];if(picks.length)start.addEventListener('change',()=>{const count=picks.filter(x=>x.checked).length;show('[data-ag-keno-count]',`選択 ${count} / 10個`);for(const p of picks)p.disabled=!p.checked&&count>=10;});}
  root.addEventListener('submit',async event=>{
   event.preventDefault();if(submitting)return;const form=event.target;if(!(form instanceof HTMLFormElement))return;
   const destination=new URL(form.getAttribute('action')||location.href,location.href).href;
   submitting=true;clearTimeout(timer);clearTimeout(soundTimer);controller?.abort();const data=new FormData(form),submitter=event.submitter;if(submitter?.name)data.append(submitter.name,submitter.value);
   root.setAttribute('aria-busy','true');root.querySelectorAll('button[type=submit]').forEach(b=>b.setAttribute('aria-disabled','true'));
   const postController=new AbortController(),timeout=setTimeout(()=>postController.abort(),15000);
   try{
    const response=await fetch(destination,{method:'POST',body:data,credentials:'same-origin',headers:{'X-Arcade-Update':'1'},signal:postController.signal});const html=await response.text(),doc=new DOMParser().parseFromString(html,'text/html'),next=doc.querySelector('[data-casino-arcade]');
    const url=new URL(response.url||destination,location.href);if(url.origin!==location.origin)throw Error('destination');
    if(!next){if(response.ok||response.status===401){location.assign(url.href);return;}throw Error('response');}
    if(next.dataset.agBuild!==root.dataset.agBuild){location.assign(url.href);return;}
    const before=root.querySelector('.ag-stage')?.getBoundingClientRect().top??root.getBoundingClientRect().top;
    root.replaceWith(next);const header=doc.querySelector('.c-top');if(header)document.querySelector('.c-top')?.replaceWith(header);history.replaceState(null,'',url.href);
    const after=next.querySelector('.ag-stage')?.getBoundingClientRect().top??next.getBoundingClientRect().top;window.scrollBy(0,after-before);
    document.querySelectorAll('[data-sound-toggle]').forEach(b=>{const on=!!window.CasinoSound?.on;b.setAttribute('aria-pressed',String(on));b.textContent=on?'🔊':'🔇';});
    init();document.dispatchEvent(new Event('c-page-swapped'));
   }catch{
    stop();const notice=document.createElement('section');notice.className='ag-error';notice.setAttribute('role','alert');const text=document.createElement('p');text.textContent='通信結果を確認できません。賭けは受け付け済みの場合があります。もう一度賭けず、最新の状態を確認してください。';const link=document.createElement('a');link.href=destination;link.textContent='この台の最新状態を確認';notice.append(text,link);root.prepend(notice);
   }finally{clearTimeout(timeout);}
  },{signal:listeners.signal});
  const settle=()=>{const f=root.querySelector('[data-ag-settle]');if(f&&!submitting)f.requestSubmit();};
  async function poll(){
   if(stopped||polling||submitting||document.hidden||model?.kind!=='crash'||model.done)return;polling=true;
   const currentController=controller=new AbortController(),timeout=setTimeout(()=>currentController.abort(),3500);
   try{
    const response=await fetch(`/casino/arcade/round/${root.dataset.agRound}/state`,{credentials:'same-origin',cache:'no-store',signal:currentController.signal});if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw Error('response');const data=await response.json();
    if(stopped||submitting)return;if(data.status==='done'){location.replace(location.href);return;}
    model=data.model;show('[data-ag-crash-mult]',model.terminal?'終了':pretty(model.mult));show('[data-ag-current-mult]',pretty(model.mult));show('[data-ag-current-pay]',Math.floor(bet*model.mult/1000).toLocaleString('ja-JP')+' '+(root.dataset.agCurrency||'銭'));show('[data-ag-connection]','');
    const rocket=root.querySelector('[data-ag-rocket]');if(rocket)rocket.style.setProperty('--ag-flight',String(Math.min(100,Math.max(0,Math.log(Math.max(1,model.mult/1000))/Math.log(100)*100))));
    if(model.terminal){settle();return;}
   }catch{if(!stopped&&!submitting&&!document.hidden)show('[data-ag-connection]','接続を確認しています。受取はサーバー受付時に確定します。');}
   finally{clearTimeout(timeout);controller=null;polling=false;}
   if(!stopped&&!submitting&&!document.hidden)timer=setTimeout(poll,350);
  }
  window.addEventListener('pagehide',()=>{clearTimeout(timer);clearTimeout(soundTimer);controller?.abort();for(const a of animations)a.cancel();animations.clear();},{signal:listeners.signal});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(timer);controller?.abort();for(const a of animations)a.cancel();animations.clear();}else if(!stopped)void poll();},{signal:listeners.signal});
  window.addEventListener('pageshow',event=>{if(event.persisted)init();},{signal:listeners.signal});
  if(model?.kind==='crash'&&!model.done)void poll();
 }
 init();
})();

// 実ゲームの表示だけ。フォーム・ゲームAPI・銭・持ち時間は既存の処理に任せる。
(() => {
 if(!document.body.hasAttribute('data-casino-immersive'))return;
 const read=(key,fallback)=>{try{return localStorage.getItem(key)||fallback;}catch{return fallback;}};
 const reduce=matchMedia('(prefers-reduced-motion:reduce)');
 let motion=read('casino-live-motion',reduce.matches?'instant':'normal'),timer=0;
 if(!['normal','low','instant'].includes(motion))motion='normal';
 const seen=new Set();
 const observer=new MutationObserver(records=>{if(records.some(record=>record.type==='attributes'?record.target.matches?.('.c-later,.c-result,.c-seat-result'):Array.from(record.addedNodes).some(node=>node.nodeType===1)))feedback();});
 function preference(){document.body.dataset.ciMotion=reduce.matches?'instant':motion;document.querySelectorAll('select[data-ci-motion]').forEach(select=>select.value=motion);}
 function syncWheel(form){
  const wheel=form.closest('.ci-stage')?.querySelector('.c-wheel2');if(!wheel)return;
  const selected=new Set();form.querySelectorAll('.placed[data-rb-covers]').forEach(cell=>cell.dataset.rbCovers.split(',').forEach(n=>selected.add(n)));
  wheel.querySelectorAll('[data-ir-pocket]').forEach(pocket=>pocket.classList.toggle('ir-pocket-bet',selected.has(pocket.dataset.irPocket)));
 }
 function visible(element){for(let p=element;p&&p!==document.body;p=p.parentElement){const style=getComputedStyle(p);if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)<.9)return false;}return true;}
 function feedback(attempt=0){
  clearTimeout(timer);if(document.hidden)return;
  const live=document.querySelector('#c-live');
  if(live?.dataset.ciEnabled==='false'){location.reload();return;}
  let result=document.querySelector('[data-ci-result]');
  if(!result){result=document.querySelector('.c-seat.me .c-seat-result');if(result)result.dataset.ciResult=result.classList.contains('win')?'win':result.classList.contains('lose')?'lose':'draw';}if(!result)return;
  if(!visible(result)){if(attempt<120)timer=setTimeout(()=>feedback(attempt+1),250);return;}
  const round=live?.dataset.ciRound||document.body.dataset.ciRound;if(!round)return;
  const key=[document.body.dataset.ciViewer,document.body.dataset.ciGame,round,result.dataset.ciResult].join(':');
  if(seen.has(key))return;seen.add(key);if(seen.size>128)seen.delete(seen.values().next().value);
  try{if(sessionStorage.getItem('casino-live-result-'+key))return;sessionStorage.setItem('casino-live-result-'+key,'1');}catch{}
  result.classList.add('ci-result-enter');
  const cue=document.querySelector('[data-ci-cue]');if(cue)cue.textContent=result.dataset.ciResult==='win'?'勝負の決着。あなたの結果を確認しましょう。':result.dataset.ciResult==='draw'?'引き分けです。戻りと結果を確認しましょう。':'勝負が終わりました。結果を確認しましょう。';
 }
 function update(){preference();observer.disconnect();const game=document.querySelector('.ci-game');if(game)observer.observe(game,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});feedback();}
 document.addEventListener('input',event=>{if(event.target instanceof HTMLFormElement&&event.target.matches('[data-rb]'))syncWheel(event.target);});
 document.addEventListener('change',event=>{if(!event.target.matches?.('select[data-ci-motion]'))return;window.CasinoSound?.stopPending?.();motion=event.target.value;try{localStorage.setItem('casino-live-motion',motion);}catch{}preference();});
 document.addEventListener('click',event=>{const target=event.target instanceof Element?event.target:null;if(!target?.closest('[data-ci-fullscreen]'))return;const main=document.querySelector('.c-main');const task=document.fullscreenElement?document.exitFullscreen?.():main?.requestFullscreen?.();const report=()=>{const status=document.querySelector('[data-ci-status]');if(status){status.hidden=false;status.textContent='この端末では全画面を使えません。通常の表示で遊べます。';}};if(task)void task.catch(report);else report();});
 for(const event of ['c-page-swapped','c-live-updated','htmx:afterSwap'])document.addEventListener(event,update);
 document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(timer);window.CasinoSound?.stopPending?.();}else update();});
 window.addEventListener('pagehide',()=>{observer.disconnect();clearTimeout(timer);window.CasinoSound?.stopPending?.();});reduce.addEventListener('change',preference);
 update();
})();

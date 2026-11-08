(()=>{
 const root=document.querySelector('[data-el-screen]');if(!root)return;
 const find=s=>root.querySelector('[data-screen-'+s+']'),demo=root.dataset.demo==='true';
 let current=JSON.parse(root.dataset.initial),timer,stopped=false,active=false,holdUntil=0;
 function render(next){
  if(JSON.stringify(next)===JSON.stringify(current))return;
  const draw=next.draw,stage=draw?(draw.winner===null?'drawing':'winner'):next.state==='cancelled'?'cancelled':next.state==='completed'?'ended':'waiting';
  const fresh=stage==='winner'&&(current.draw?.id!==draw.id||current.draw?.winner===null);
  root.dataset.stage=stage;root.dataset.longName=String((draw?.winner?.length||0)>24);
  if(stage!=='winner')root.classList.remove('els-reveal');
  if(fresh){holdUntil=performance.now()+2500;root.classList.remove('els-reveal');void root.offsetWidth;root.classList.add('els-reveal');}
  find('name').textContent=next.name;document.title=next.name+' · 抽選会';
  find('label').textContent=stage==='winner'?(demo?'テスト当選':'ご当選'):stage==='drawing'?'運命のひとくじ':['cancelled','ended'].includes(stage)?'お知らせ':'幸運を、あなたに';
  find('prize').hidden=!draw;find('prize').textContent=draw?.prize||'';
  find('waiting').hidden=!!draw;find('drawing').hidden=stage!=='drawing';find('winner').hidden=stage!=='winner';
  find('wait-title').textContent=demo?'テストでくじを引いてみましょう':next.state==='open'?'ただいま参加受付中':next.state==='cancelled'?'このイベントは中止になりました':next.state==='completed'?'本日の抽選は終了しました':'まもなく抽選が始まります';
  find('wait-note').textContent=demo?'「テストで1回引く」を押すと演出が始まります':['cancelled','completed'].includes(next.state)?'ご参加ありがとうございました':'当選発表まで、そのままお待ちください';
  find('winner-name').textContent=draw?.winner||'';
  find('coins').hidden=!draw?.coins;
  find('amount').textContent=(draw?.coins||0).toLocaleString('ja-JP');
  find('participants').textContent=String(next.participants);find('winners').textContent=String(next.winners);
  find('footer').textContent=demo?'練習用です。銭の増減・景品の消費・Discord発表はありません':next.state==='completed'?'ご参加ありがとうございました':'当選結果はDiscordでも発表します';
  current=next;
 }
 async function refresh(){
  if(demo||active||stopped)return;active=true;
  try{
   const url=new URL(root.dataset.endpoint,location.href);
   if(current.draw&&(current.draw.winner===null||performance.now()<holdUntil))url.searchParams.set('focus',current.draw.id);
   else url.searchParams.set('after',current.draw?.id||'start');
   const response=await fetch(url,{credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
   if(!response.ok)throw Error('status');const next=await response.json();render(next);find('connection').hidden=true;
  }catch{find('connection').hidden=false;find('connection').textContent='更新が止まっています。接続を確認して、この画面を読み直してください。';}
  active=false;if(!stopped)timer=setTimeout(refresh,1000);
 }
 find('fullscreen').addEventListener('click',async()=>{
  try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}
  catch{find('connection').hidden=false;find('connection').textContent='全画面にできませんでした。ブラウザーの全画面表示をお使いください。';}
 });
 document.addEventListener('fullscreenchange',()=>{find('fullscreen').textContent=document.fullscreenElement?'全画面を閉じる':'全画面';});
 window.addEventListener('pagehide',()=>{stopped=true;clearTimeout(timer);});
 window.addEventListener('pageshow',e=>{if(e.persisted){stopped=false;refresh();}});
 if(demo){
  const initial=JSON.parse(root.dataset.initial),button=find('demo-draw');let drawn=0,demoTimer;
  find('demo-reset').addEventListener('click',()=>{clearTimeout(demoTimer);demoTimer=undefined;drawn=0;button.disabled=false;button.textContent='テストで1回引く';render({...initial});});
  button.addEventListener('click',()=>{
   if(demoTimer||drawn>=initial.participants)return;
   button.disabled=true;button.textContent='くじを引いています…';
   const id='demo-'+(drawn+1),prize=['テスト景品・お楽しみ賞','テスト景品・記念品','テスト景品・500銭'][drawn%3];
   render({...initial,winners:drawn,draw:{id,prize,winner:null,coins:null}});
   demoTimer=setTimeout(()=>{
    demoTimer=undefined;drawn++;
    render({...initial,winners:drawn,draw:{id,prize,winner:'テスト参加者 '+String.fromCharCode(64+drawn),coins:drawn%3===0?500:0}});
    button.disabled=drawn>=initial.participants;button.textContent=button.disabled?'全員のテストが終了しました':'もう1回テストで引く';
   },3000);
  });
  return;
 }
 render(current);refresh();
})();

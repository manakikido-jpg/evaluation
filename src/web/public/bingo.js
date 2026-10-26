(() => {
 const root=document.getElementById('bingo-app');if(!root)return;
 const by=id=>document.getElementById(id);
 let snapshot=null,eventId=new URLSearchParams(location.search).get('id')||'',busy=false,polling=false,stopped=false,timer=null,clockOffset=0,shownEvent='',lastBingo=0;
 const sound=by('sound'),motion=by('motion');
 const pref=(key,fallback)=>{try{const v=localStorage.getItem('bingo-'+key);return v===null?fallback:v==='yes';}catch{return fallback;}};
 sound.checked=pref('sound',false);motion.checked=pref('motion',!matchMedia('(prefers-reduced-motion: reduce)').matches);
 let context=null;
 const tone=(win=false)=>{if(!sound.checked||!context)return;try{const t=context.currentTime;[0,1,2].slice(0,win?3:1).forEach((_,i)=>{const osc=context.createOscillator(),gain=context.createGain();osc.frequency.value=win?[523,659,784][i]:660;gain.gain.setValueAtTime(.07,t+i*.12);gain.gain.exponentialRampToValueAtTime(.001,t+i*.12+.15);osc.connect(gain);gain.connect(context.destination);osc.start(t+i*.12);osc.stop(t+i*.12+.16);});}catch{}};
 for(const input of [sound,motion])input.addEventListener('change',()=>{try{localStorage.setItem('bingo-'+input.id,input.checked?'yes':'no');}catch{}if(input===motion&&!input.checked&&snapshot?.event?.revealAt)by('current-number').textContent='…';if(input===sound&&input.checked){try{context=context||new (window.AudioContext||window.webkitAudioContext)();context.resume().then(()=>tone());}catch{sound.checked=false;}}});
 const celebrate=()=>{tone(true);if(!motion.checked)return;by('b-confetti').replaceChildren();for(let i=0;i<32;i++){const p=document.createElement('span');p.style.left=(Math.random()*100)+'%';p.style.background=['#d9b666','#cf7c8d','#8b3348'][i%3];p.style.animationDelay=(Math.random()*.35)+'s';by('b-confetti').append(p);}setTimeout(()=>by('b-confetti').replaceChildren(),3500);};
 const error=message=>{by('b-error').textContent=message;by('b-error').hidden=!message;};
 const updateCountdown=()=>{
  if(!snapshot?.event?.revealAt){by('countdown').textContent='';return;}
  const left=Math.max(0,Math.ceil((snapshot.event.revealAt-(Date.now()+clockOffset))/1000));by('countdown').textContent=left?left+'秒後に公開':'結果を確認中…';
  if(left>0&&motion.checked)by('current-number').textContent=String(1+Math.floor(Math.random()*75));
  if(left===0&&!polling)poll();
 };
 setInterval(updateCountdown,250);
 const render=data=>{
  if(snapshot?.event?.id===data.event?.id&&data.event&&data.event.version<snapshot.event.version)return;
  const previous=snapshot;snapshot=data;clockOffset=data.serverTime-Date.now();const event=data.event,card=data.card;
  by('connection').textContent='接続中 · 自動更新';by('no-event').hidden=!!event;by('b-play').hidden=!event;by('b-create').hidden=!data.staff||!!event&&event.status!=='closed';
  root.dataset.staff=data.staff?'yes':'no';
  if(event){
   eventId=event.id;by('event-title').textContent=event.title;by('b-host').hidden=!data.staff;by('b-latest').hidden=event.status!=='closed';
   const createId=by('b-create').querySelector('[name=id]');if(createId.value===event.id)createId.value=(crypto.randomUUID?crypto.randomUUID():createId.value.replace(/[018]/g,c=>(Number(c)^crypto.getRandomValues(new Uint8Array(1))[0]&15>>Number(c)/4).toString(16)));
   const changedEvent=shownEvent!==event.id;if(changedEvent){shownEvent=event.id;lastBingo=0;by('b-broadcast').textContent='';by('b-close').querySelector('[name=confirm]').checked=false;}
   const waiting=event.status==='waiting',pending=!!event.revealAt;
   by('draw-caption').textContent=pending?'抽選中':event.status==='closed'?'終了 · 最後の番号':waiting?'参加受付中':'今回の番号';
   by('current-number').textContent=pending?'…':String(event.draws.at(-1)??'—');by('draw-count').textContent=event.draws.length+' / 75';
   by('current-number').setAttribute('aria-live',pending?'off':'polite');
   if(previous?.event?.id===event.id&&previous.event.draws.length<event.draws.length){tone();if(motion.checked){by('current-number').classList.remove('b-announce');requestAnimationFrame(()=>by('current-number').classList.add('b-announce'));}}
   const previousClaims=new Set(previous?.event?.id===event.id?(previous.event.latestClaims||previous.event.summary.winners).filter(w=>w.claimed).map(w=>w.memberId):[]);
   const freshClaims=previous?.event?.id===event.id?(event.latestClaims||event.summary.winners).filter(w=>w.claimed&&!previousClaims.has(w.memberId)):[];
   if(freshClaims.length){by('b-broadcast').textContent=freshClaims.slice(0,5).map(w=>w.name).join('・')+' さん、ビンゴ！';celebrate();}
   by('participant-count').textContent=event.summary.participants+'人参加';by('public-reach').textContent='リーチ '+event.summary.reaches+'人 · ビンゴ '+event.winnerCount+'人';
   const numbers=by('b-numbers');numbers.replaceChildren();for(let n=1;n<=75;n++){const ball=document.createElement('span');const hit=event.draws.includes(n);ball.className='b-ball'+(hit?' is-drawn':'')+(n===event.draws.at(-1)?' is-last':'');ball.textContent=String(n);ball.setAttribute('aria-label',n+(hit?' 抽選済み':' 未抽選'));numbers.append(ball);}
   const board=by('b-card');board.replaceChildren();for(let i=0;i<25;i++){const cell=document.createElement('span'),value=card?.numbers[i];cell.className='b-cell'+(!card?' is-empty':card.marked[i]?' is-hit':'')+(card?.winningCells.includes(i)?' is-line':'')+(i===12?' is-free':'');cell.textContent=card?(value===0?'FREE':String(value)):i===12?'FREE':'—';cell.setAttribute('aria-label',card?(value===0?'中央のフリーマス':value+(card.marked[i]?' 開いています':' 未抽選')):'参加するとカードを発行します');board.append(cell);}
   by('personal-status').textContent=card?card.lines?'ビンゴ '+card.lines+'ライン'+(card.rank?' / '+card.rank+'位':''):card.reachNumbers.length?'リーチ！':'抽選を待とう':waiting?'受付中':'参加受付終了';
   by('reach-detail').textContent=card?.reachNumbers.length?'あと '+card.reachNumbers.join('・')+' で'+(card.lines?'次のライン':'ビンゴ')+'！':event.status==='closed'?'イベントは終了しました。':card?'当たったマスは自動で開きます。':'';
   if(card?.lines&&!lastBingo){celebrate();lastBingo=card.lines;}else if(card?.lines>lastBingo){celebrate();lastBingo=card.lines;}
   by('b-join').hidden=!waiting||!!card;by('b-claim').hidden=!card?.lines||card.claimed;
   by('b-start').hidden=!waiting;by('b-next').hidden=event.status!=='active';by('b-close').hidden=event.status==='closed';
   const winners=by('b-winners');winners.replaceChildren();for(const w of event.summary.winners){const li=document.createElement('li');li.value=w.rank;li.textContent=w.rank+'位 · '+w.name+' / '+w.at+'回目'+(w.doubleAt?' · ダブルビンゴ '+w.doubleAt+'回目':'')+(w.claimed?' · ビンゴ！':'');winners.append(li);}by('empty-winners').hidden=event.winnerCount>0;by('ranking-limit').hidden=event.winnerCount<=100;
   for(const form of root.querySelectorAll('form[data-bingo-action]')){if(form.dataset.bingoAction==='create')continue;form.querySelector('[name=id]').value=event.id;const version=form.querySelector('[name=version]');if(version)version.value=String(event.version);}
   for(const button of root.querySelectorAll('form button'))button.disabled=busy;
   by('b-start').querySelector('button').disabled=busy||!event.summary.participants;by('b-next').querySelector('button').disabled=busy||pending||event.draws.length>=75;by('b-close').querySelector('button').disabled=busy||pending;
  }else{for(const button of root.querySelectorAll('form button'))button.disabled=busy;}
  updateCountdown();
 };
 async function poll(){
  if(polling||stopped)return;polling=true;clearTimeout(timer);
  try{const r=await fetch('/visit/bingo/state'+(eventId?'?id='+encodeURIComponent(eventId):''),{credentials:'same-origin',cache:'no-store'});const data=await r.json();if(!r.ok){if(r.status===401||r.status===403)stopped=true;throw Error(data.error||'更新できませんでした。');}render(data);}
  catch(e){by('connection').textContent='接続を確認中 · 再接続しても同じカードです';error(e instanceof TypeError||e instanceof SyntaxError?'通信を確認してください。':e.message||'通信を確認してください。');}
  finally{polling=false;if(!stopped)timer=setTimeout(poll,document.hidden?5000:2000);}
 }
 for(const form of root.querySelectorAll('form[data-bingo-action]'))form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;const body=new FormData(form);busy=true;for(const b of root.querySelectorAll('form button'))b.disabled=true;error('');
  try{const r=await fetch(form.action,{method:'POST',credentials:'same-origin',body});const data=await r.json();if(!r.ok)throw Error(data.error||'操作を確認できませんでした。');render(data);}
  catch(e){error(e instanceof TypeError||e instanceof SyntaxError?'結果を確認できません。画面を更新して確認してください。':e.message||'結果を確認できません。画面を更新して確認してください。');}
  finally{busy=false;if(snapshot)render(snapshot);poll();}
 });
 root.addEventListener('pointerdown',()=>{if(sound.checked&&!context){try{context=new (window.AudioContext||window.webkitAudioContext)();context.resume();}catch{sound.checked=false;}}});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});window.addEventListener('online',()=>poll());poll();
})();

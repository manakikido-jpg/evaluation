// 端末内だけの無料練習。操作・演出から銭を動かす通信はしない。
(() => {
 const root=document.querySelector('[data-pinball]'),api=window.PinballPhysics;if(!root||!api)return;
 const elements=new Map(),q=s=>{if(!elements.has(s))elements.set(s,root.querySelector('[data-pb-'+s+']'));return elements.get(s);},canvas=q('canvas'),ctx=canvas.getContext('2d');
 const put=(name,value)=>{const el=q(name);if(el.textContent!==value)el.textContent=value;};
 if(!ctx){q('status').textContent='このブラウザーでは盤面を表示できません。別のブラウザーでお試しください。';return;}
 const seed=()=>{try{return crypto.getRandomValues(new Uint32Array(1))[0];}catch{return Date.now()>>>0;}};
 const states={flipper:api.create('flipper',seed()),plinko:api.create('plinko',seed())};
 let mode='flipper',paused=false,frame=0,last=0,accumulator=0,trail=[],seenScore=0,saved=false;
 const chosen={flipper:80,plinko:240},keys=new Set(),heldKeys=new Set(),pointers=new Map(),best={flipper:0,plinko:0};
 for(const key of Object.keys(best)){try{const n=Number(localStorage.getItem('sakura-pinball-best-v1-'+key));if(Number.isSafeInteger(n)&&n>0)best[key]=n;}catch{}}
 const state=()=>states[mode],active=()=>state().phase==='playing'&&!paused&&!document.hidden;
 const motion=matchMedia('(prefers-reduced-motion:reduce)');
 const dpr=Math.min(2,window.devicePixelRatio||1);canvas.width=api.W*dpr;canvas.height=api.H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);
 function line(ax,ay,bx,by,color,width){ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(bx,by);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.stroke();}
 function text(value,x,y,size=16,color='#ead8a8'){ctx.fillStyle=color;ctx.font=`600 ${size}px system-ui`;ctx.textAlign='center';ctx.fillText(value,x,y);}
 function disc(x,y,r,colors){const g=ctx.createRadialGradient(x-r*.3,y-r*.4,1,x,y,r);g.addColorStop(0,colors[0]);g.addColorStop(.55,colors[1]);g.addColorStop(1,colors[2]);ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();}
 function draw(){
  const s=state();ctx.clearRect(0,0,480,720);
  const bg=ctx.createLinearGradient(0,0,480,720);bg.addColorStop(0,'#141c35');bg.addColorStop(.55,'#081722');bg.addColorStop(1,'#1c102a');ctx.fillStyle=bg;ctx.fillRect(0,0,480,720);
  ctx.strokeStyle='#bda4670e';ctx.lineWidth=1;for(let y=50;y<720;y+=30)line(30,y,450,y,'#bda4670e',1);
  // 桜の五弁を、静かな盤面の透かしとして描く。
  ctx.save();ctx.translate(240,345);for(let i=0;i<5;i++){ctx.rotate(Math.PI*2/5);ctx.beginPath();ctx.ellipse(0,-92,42,92,0,0,Math.PI*2);ctx.fillStyle='#d48eac08';ctx.fill();}ctx.restore();
  text(s.mode==='flipper'?'SAKURA PINBALL':'SAKURA PLINKO',240,30,14,'#cdb47a');
  if(s.mode==='flipper'){
   for(const wall of api.WALLS){line(...wall,'#050c17',14);line(...wall,'#90784f',8);line(...wall,'#f3dda1',2);}
   for(const sling of api.SLINGS){line(...sling,'#5f295c',15);line(...sling,'#ed9fc9',3);}
   for(let i=0;i<api.TARGETS.length;i++){const t=api.TARGETS[i];disc(t.x,t.y,16,s.targets[i]?['#fff9d0','#ebc768','#876324']:['#3d4354','#232f40','#101a29']);text('✦',t.x,t.y+6,18,s.targets[i]?'#fff9d9':'#7d8799');}
   for(let i=0;i<api.BUMPERS.length;i++){const b=api.BUMPERS[i],lit=!motion.matches&&(s.cooldown['b'+i]||0)>s.time;
    ctx.beginPath();ctx.arc(b.x,b.y,b.r+9,0,Math.PI*2);ctx.strokeStyle=lit?'#fff2b7':'#b48c5860';ctx.lineWidth=lit?5:2;ctx.stroke();disc(b.x,b.y,b.r,['#fff0b7','#b98a44','#372c28']);disc(b.x,b.y,b.r-8,['#a4fbf7','#267a85','#103544']);text('✿',b.x,b.y+10,28,'#f7da94');
   }
   text('FIVE STARS · +1000',240,155,11,'#baa775');text('打ち返して、星を灯そう',240,410,16,'#cabb9966');
   line(423,685,447,685,'#dcbf7a',4);text('↑',435,635,25,'#d3bb7a');
   for(let i=0;i<2;i++){const f=api.flipper(s,i,s.angles[i]);line(f.x,f.y,f.ex,f.ey,'#34242c',28);line(f.x,f.y,f.ex,f.ey,keys.has(i?'right':'left')?'#f7dc83':'#cbaa68',20);line(f.x,f.y-4,f.ex,f.ey-4,'#fff3c366',3);disc(f.x,f.y,12,['#ffe4a3','#9e763f','#302831']);}
   text('DRAIN',240,692,11,'#927b8d');
  }else{
   line(35,75,35,695,'#b99a61',5);line(445,75,445,695,'#b99a61',5);
   for(const peg of api.PEGS){disc(peg.x,peg.y,peg.r+2,['#fff3c3','#b79355','#3b3335']);}
   if(s.phase==='ready'){const x=Number(q('setting').value);line(x,70,x,120,'#90e5e9aa',2);text('▼',x,65,18,'#a6eeed');}
   for(let i=0;i<10;i++){const x=35+i*41,lit=s.lastPocket===i;ctx.fillStyle=lit?'#97733355':i<2||i>7?'#8c3a7228':'#237f8220';ctx.fillRect(x+3,600,35,93);text(String(api.POCKETS[i]),x+20.5,683,12,lit?'#fff3b6':'#ceb98d');line(x,597,x,695,'#b99a61',3);}
   line(445,597,445,695,'#b99a61',3);text('POCKET SCORE · 練習点',240,714,10,'#c6b68e');
  }
  if(s.ball){if(!motion.matches)for(let i=0;i<trail.length;i++){ctx.globalAlpha=i/trail.length*.25;disc(trail[i].x,trail[i].y,api.R*.8,['#d1f8ff','#7ec4e0','#33536e']);}ctx.globalAlpha=1;disc(s.ball.x,s.ball.y,api.R,['#ffffff','#b5d9ed','#3f5b78']);}
  ctx.strokeStyle='#d8b97655';ctx.lineWidth=2;ctx.strokeRect(12,12,456,696);
 }
 function clearInput(){keys.clear();heldKeys.clear();pointers.clear();for(const side of ['left','right'])q(side).setAttribute('aria-pressed','false');}
 function refreshInput(){for(const side of ['left','right']){const codes=side==='left'?['ArrowLeft','KeyA']:['ArrowRight','KeyD'];if(codes.some(code=>heldKeys.has(code))||[...pointers.values()].includes(side))keys.add(side);else keys.delete(side);q(side).setAttribute('aria-pressed',String(keys.has(side)));}}
 function update(){
  const s=state(),running=active(),plinko=mode==='plinko';
  if(s.phase==='over'&&!saved){saved=true;best[mode]=Math.max(best[mode],s.score);try{localStorage.setItem('sakura-pinball-best-v1-'+mode,String(best[mode]));}catch{}}
  put('score',s.score.toLocaleString('ja-JP'));put('balls',String(s.total-s.used));put('best',best[mode].toLocaleString('ja-JP'));
  q('launch').disabled=s.phase!=='ready';put('launch',s.phase==='over'?'終了しました':s.phase==='playing'?'プレイ中':plinko?'玉を落とす':'発射する');
  q('setting').disabled=s.phase==='playing';q('pause').disabled=s.phase!=='playing';put('pause',paused?'再開する':'一時停止');q('reset').disabled=false;
  for(const side of ['left','right']){q(side).hidden=plinko;q(side).disabled=!running;}
  const notice=paused&&s.phase==='playing'?'一時停止中。「再開する」で続けられます。':s.notice;if(q('status').textContent!==notice)q('status').textContent=notice;
  q('overlay').hidden=s.phase==='playing'&&!paused;put('overlay-title',paused?'PAUSED':s.phase==='over'?'FINISH':'READY');put('overlay-note',paused?'「再開する」で続きをどうぞ':s.phase==='over'?s.score.toLocaleString('ja-JP')+'点 · 「最初から」で再挑戦':plinko?'位置を選んで「玉を落とす」':'下の「発射する」でスタート');
  put('history',plinko?(s.history.length?s.history.map((n,i)=>`${i+1}球目 ${n}点`).join(' / '):'5球の合計点を狙おう。'):`${s.used} / ${s.total}球を発射 · 五つの星 ${s.targets.filter(Boolean).length} / 5`);
  root.dataset.mode=mode;
 }
 function stop(){cancelAnimationFrame(frame);frame=0;last=0;accumulator=0;}
 function loop(time){
  frame=0;if(!root.isConnected){stop();clearInput();return;}if(!active())return;
  if(last)accumulator+=Math.min(.05,(time-last)/1000);last=time;
  while(accumulator>=1/120&&active()){api.step(state(),1/120,{left:keys.has('left'),right:keys.has('right')});accumulator-=1/120;}
  if(state().ball){trail.push({x:state().ball.x,y:state().ball.y});if(trail.length>9)trail.shift();}
  if(state().score!==seenScore){if(state().score>seenScore)window.CasinoSound?.tone(mode==='plinko'?950:720,0,.07,{type:'sine',vol:.06});seenScore=state().score;}
  if(state().phase!=='playing')clearInput();update();draw();if(active())frame=requestAnimationFrame(loop);
 }
 function start(){if(active()&&!frame){last=0;accumulator=0;frame=requestAnimationFrame(loop);}}
 function pause(){if(state().phase!=='playing')return;paused=true;stop();clearInput();update();draw();}
 function togglePause(){if(state().phase!=='playing')return;if(paused&&!document.hidden){paused=false;update();start();}else pause();}
 function focusBoard(){const game=q('canvas').closest('.pb-game'),head=document.querySelector('.c-top');const offset=Math.max(0,head?.getBoundingClientRect().bottom||0)+8;window.scrollTo({top:Math.max(0,window.scrollY+game.getBoundingClientRect().top-offset),behavior:motion.matches?'instant':'smooth'});}
 function launch(){if(document.hidden||paused)return;if(api.launch(state(),Number(q('setting').value))){saved=false;trail=[];seenScore=state().score;clearInput();window.CasinoSound?.tone(220,0,.09,{type:'triangle',vol:.06});update();start();focusBoard();}}
 function configure(){
  const plinko=mode==='plinko';q('title').textContent=plinko?'落とす位置を狙ってみよう':'三つの球で星を灯そう';q('description').textContent=plinko?'交互に並ぶピンを抜け、入ったポケットの点が加わります。':'バンパーに当てて得点。上の五つの星を全部灯すとボーナスです。';
  q('setting-label').textContent=plinko?'玉を落とす位置':'発射の強さ';q('setting').min=plinko?'48':'40';q('setting').max=plinko?'432':'100';q('setting').value=String(chosen[mode]);q('setting').setAttribute('aria-label',plinko?'玉を落とす位置':'発射の強さ');settingLabel();
  canvas.setAttribute('aria-label',plinko?'プリンクの盤面。位置を選び「玉を落とす」で遊べます。':'ピンボールの盤面。左右のボタンか左右キーで操作できます。');
  q('help').textContent=plinko?'落とす位置を選んで「玉を落とす」。Spaceでも落とせます。1球ずつ、5球の合計を狙おう。Pで一時停止。':'PC：← → または A・Dで打ち返す。Spaceで発射、Pで一時停止。スマホ：左右のボタンを押し続けて操作。';
  const rules=plinko?['1回5球。1球ずつ位置を選んで落とします。','下の数字は入ったときの練習点です。','端のポケットは1,000点、中央は50点。','倍率や銭の払出ではありません。']:['1回3球。発射の強さを選べます。','丸いバンパー：250点。','上の星：各100点。五つでさらに1,000点。','中央のすき間へ落ちると次の球です。'];
  q('rules').replaceChildren(...rules.map(value=>{const li=document.createElement('li');li.textContent=value;return li;}));
  root.querySelectorAll('[data-pb-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.pbMode===mode)));
 }
 function settingLabel(){q('setting-value').textContent=mode==='plinko'?Math.round((Number(q('setting').value)-48)/384*100)+'%（左 → 右）':q('setting').value+'%';}
 q('setting').addEventListener('input',()=>{chosen[mode]=Number(q('setting').value);settingLabel();draw();});q('launch').addEventListener('click',launch);q('pause').addEventListener('click',togglePause);
 q('reset').addEventListener('click',()=>{stop();clearInput();states[mode]=api.create(mode,seed());paused=false;saved=false;trail=[];seenScore=0;update();draw();});
 root.querySelectorAll('[data-pb-mode]').forEach(button=>button.addEventListener('click',()=>{if(button.dataset.pbMode===mode)return;stop();clearInput();mode=button.dataset.pbMode;paused=state().phase==='playing';trail=[];seenScore=state().score;saved=state().phase==='over';configure();update();draw();}));
 for(const side of ['left','right']){
  const button=q(side);button.addEventListener('pointerdown',e=>{if(!active()||mode!=='flipper')return;e.preventDefault();pointers.set(e.pointerId,side);button.setPointerCapture(e.pointerId);refreshInput();});
  const release=e=>{pointers.delete(e.pointerId);refreshInput();};
  for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,release);
 }
 window.addEventListener('keydown',e=>{if(e.target.closest?.('input,select,textarea,[contenteditable=true]')||e.ctrlKey||e.metaKey||e.altKey)return;
  const side=['ArrowLeft','KeyA'].includes(e.code)?'left':['ArrowRight','KeyD'].includes(e.code)?'right':null;
  if(side&&mode==='flipper'&&active()){e.preventDefault();heldKeys.add(e.code);refreshInput();}
  if(e.code==='Space'&&!e.target.closest?.('button,a')){e.preventDefault();if(!e.repeat)launch();}
  if(e.code==='KeyP'){e.preventDefault();if(!e.repeat)togglePause();}
 });
 window.addEventListener('keyup',e=>{const side=['ArrowLeft','KeyA'].includes(e.code)?'left':['ArrowRight','KeyD'].includes(e.code)?'right':null;if(side){heldKeys.delete(e.code);refreshInput();}});
 window.addEventListener('blur',pause);window.addEventListener('pagehide',pause);document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});motion.addEventListener('change',()=>{trail=[];draw();});
 configure();update();draw();
})();

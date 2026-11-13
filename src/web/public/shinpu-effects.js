/** 音はユーザー操作で有効にする。演出と音が止まっても対戦処理は進められる。 */
(() => {
  const read=(k,d)=>{try{return localStorage.getItem(k)??d;}catch{return d;}};
  const save=(k,v)=>{try{localStorage.setItem(k,v);}catch{/* 設定を保存できなくても、この画面では使える。 */}};
  let enabled=read('shinpu.sound','off')==='on',volume=Number(read('shinpu.volume','0.3')),mode=read('shinpu.motion','normal'),ctx=null,timer;
  if(!Number.isFinite(volume))volume=.3;volume=Math.max(0,Math.min(1,volume));
  if(!['normal','short','off'].includes(mode))mode='normal';
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  function controls(){document.getElementById('sound-toggle').textContent=enabled?'音 ON':'音 OFF';document.getElementById('sound-toggle').setAttribute('aria-pressed',String(enabled));document.getElementById('sound-volume').value=String(volume);document.getElementById('effect-mode').value=mode;document.body.dataset.effectMode=mode;}
  function stopAudio(){const old=ctx;ctx=null;if(old)void old.close().catch(()=>{});}
  async function unlock(){if(!enabled||document.hidden)return;try{if(!ctx){const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)throw Error();ctx=new Audio();}if(ctx.state==='suspended')await ctx.resume();}catch{enabled=false;save('shinpu.sound','off');stopAudio();controls();document.getElementById('effects-status').textContent='音を使えません。このまま対戦できます。';}}
  const notes={turn:[660,880],attack:[180,280,430],guard:[520,780],damage:[150,110],summon:[392,523,659,784],victory:[523,659,784,1046],heal:[440,660]};
  function sound(kind){if(!enabled||!ctx||ctx.state!=='running'||document.hidden)return;try{const ac=ctx;for(const [i,hz] of (notes[kind]||notes.turn).entries()){const o=ac.createOscillator(),g=ac.createGain(),start=ac.currentTime+i*.09;o.type=kind==='attack'?'triangle':'sine';o.frequency.value=hz;g.gain.setValueAtTime(0,start);g.gain.linearRampToValueAtTime(volume*.12,start+.012);g.gain.exponentialRampToValueAtTime(.0001,start+.18);o.connect(g);g.connect(ac.destination);o.start(start);o.stop(start+.2);}}catch{/* 音の失敗を操作の失敗にしない。 */}}
  function effect(kind,text){if(document.hidden)return;const fx=document.getElementById('battle-fx');clearTimeout(timer);fx.hidden=true;fx.replaceChildren();if(mode==='off'||reduced.matches)return;fx.dataset.kind=kind;fx.append(Object.assign(document.createElement('span'),{textContent:text}));fx.hidden=false;timer=setTimeout(()=>{fx.hidden=true;},mode==='short'?250:850);}
  let round='',seen=new Set();
  const once=(key,kind,text)=>{if(seen.has(key))return;seen.add(key);sound(kind);effect(kind,text);};
  function observe(before,after){const s=after.state;if(!s)return;const key=after.roomId+':'+after.round;
    if(!before?.state||key!==round){stopVisuals();round=key;seen=new Set();if(before?.state&&key!==before.roomId+':'+before.round)once('start','turn','新しい対戦');return;}
    const old=before.state;
    const major=!!(s.summon&&s.summon.id!==old.summon?.id||s.result&&s.result.id!==old.result?.id||s.pending&&JSON.stringify(s.pending)!==JSON.stringify(old.pending));
    if(s.phase==='over'&&old.phase!=='over'){once('over',s.winner===after.myIndex?'victory':'guard',s.winner<0?'引き分け':s.winner===after.myIndex?'勝利':'対戦終了');return;}
    if(s.summon&&s.summon.id!==old.summon?.id)once('summon:'+s.summon.id,'summon','式神降臨');
    else if(s.result&&s.result.id!==old.result?.id)once('result:'+s.result.id,s.result.damage===0?'guard':'damage',s.result.damage===0?'防御成功':s.result.damage+'ダメージ');
    else if(s.pending&&JSON.stringify(s.pending)!==JSON.stringify(old.pending))once('attack:'+s.turns+':'+s.pending.from+':'+s.pending.to,'attack','攻撃');
    const active=s.phase==='choice'?s.choice?.player:s.phase==='defense'?s.pending?.to:s.turn;
    const oldActive=old.phase==='choice'?old.choice?.player:old.phase==='defense'?old.pending?.to:old.turn;
    if(!major&&active===after.myIndex&&(oldActive!==active||s.phase!==old.phase||s.turns!==old.turns))once('turn:'+s.turns+':'+s.phase+':'+active,'turn','あなたの番');
  }
  function stopVisuals(){clearTimeout(timer);document.getElementById('battle-fx').hidden=true;const card=document.getElementById('card-play');if(card){card.hidden=true;card.replaceChildren();}}
  function stop(){stopVisuals();stopAudio();}
  document.getElementById('sound-toggle').addEventListener('click',async()=>{enabled=!enabled;save('shinpu.sound',enabled?'on':'off');if(enabled){await unlock();sound('turn');}else stopAudio();controls();});
  document.getElementById('sound-volume').addEventListener('input',e=>{volume=Math.max(0,Math.min(1,Number(e.target.value)));save('shinpu.volume',String(volume));if(volume===0)stopAudio();});
  document.getElementById('effect-mode').addEventListener('change',e=>{mode=e.target.value;save('shinpu.motion',mode);stopVisuals();controls();});
  document.addEventListener('pointerdown',()=>{void unlock();});document.addEventListener('keydown',()=>{void unlock();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});window.addEventListener('pagehide',stop);reduced.addEventListener('change',stopVisuals);
  controls();window.ShinpuEffects={observe,stop};
})();

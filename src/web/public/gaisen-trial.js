// 無料試遊専用。抽選/ポイント/着席は全てサーバー側。自動プレイはしない。
(() => {
 let busy=false,audio=false,motion='normal',startAt=0,frame=0;
 try{audio=localStorage.getItem('gaisen-trial-audio')==='on';motion=localStorage.getItem('gaisen-trial-motion')||'normal';}catch{}
 let control='timing',timingPress=null;try{if(localStorage.getItem('gaisen-trial-control')==='assist')control='assist';}catch{}
 let activeWin=null,volume=.65,focusMode=false;
 try{const saved=Number(localStorage.getItem('gaisen-trial-volume'));if([.3,.65,1].includes(saved))volume=saved;focusMode=localStorage.getItem('gaisen-trial-focus')==='on';}catch{}
 let quality='auto',glow=.7,syncOffset=0,perfFrame=0,needsRecovery=false,contact=null,probeTimer=0,probeSequence=0;
 try{const q=localStorage.getItem('gaisen-trial-quality');if(['auto','full','light'].includes(q))quality=q;const g=Number(localStorage.getItem('gaisen-trial-glow'));if([.35,.7,1].includes(g))glow=g;const offset=Number(localStorage.getItem('gaisen-trial-sync'));if([0,40,80].includes(offset))syncOffset=offset;}catch{}
 const save=(key,value)=>{try{localStorage.setItem('gaisen-trial-'+key,String(value));}catch{}};
 if(!['normal','low','instant'].includes(motion))motion='normal';
 const root=()=>document.querySelector('[data-gaisen-trial]');
 const diagnosticBuild={build:root()?.dataset.gtBuild,diagnosticBuild:root()?.dataset.gtDiagnosticBuild};
 let diagnosticPress=null,diagnosticInput=null,lastDiagnosticReport='',diagnosticCopyTicket=0,diagnosticCopyPending=false;
 const diagnostics=window.GaisenDiagnostics?new window.GaisenDiagnostics({onChange:()=>{if(root()?.querySelector('[data-gt-preferences]')?.open)renderDiagnostics();}}):null;
 const bank=window.GaisenSampleBank?new window.GaisenSampleBank(JSON.parse(root()?.dataset.gtSounds||'{}')):null;
 const actualMotion=()=>matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':motion;
 const comfort=window.GaisenComfort?new window.GaisenComfort({onChange:()=>prefs()}):null;
 const isLight=()=>quality==='light'||quality==='auto'&&!!comfort?.light;
 const pitch=variant=>({a:1,b:.98,c:1.02})[variant]||1;
 const isKiseki=!!root()?.classList?.contains('kt-root');
 const StageDirector=isKiseki?window.KisekiStageDirector:window.GaisenStageDirector;
 const NormalDirector=isKiseki?window.KisekiNormalDirector:window.GaisenNormalDirector;
 const stageDirector=StageDirector?new StageDirector({motion:actualMotion,hidden:()=>document.hidden,variant:()=>comfort?.nextVariant()||'a'}):null;
 const normalDirector=NormalDirector?new NormalDirector({motion:actualMotion,hidden:()=>document.hidden,light:isLight,sound:(kind,step=0,index=null)=>{if(isKiseki){NormalDirector.playCue(bank,kind,step,index);return;}const key=kind==='thunder'?'cue-thunder':kind==='wind'?'cue-wind':'cue-glint';void bank?.play(key,{group:'normal',level:kind==='dim'?.15:.38});},stopSound:()=>bank?.stopGroup('normal')}):null;
 const kisekiLive=window.KisekiLiveDirector?new window.KisekiLiveDirector({bank,root,motion:actualMotion,light:isLight,hidden:()=>document.hidden}):null;
 const kisekiRealism=window.KisekiRealismDirector?new window.KisekiRealismDirector({bank,root,motion:actualMotion,light:isLight,hidden:()=>document.hidden}):null;
 if(normalDirector&&kisekiRealism){normalDirector.density=()=>kisekiRealism.density();normalDirector.avoidRepeat=()=>!!root()?.classList.contains('kt-root');}
 function ramp(){
  cancelAnimationFrame(frame);frame=0;
  const r=root();if(!r||document.hidden)return;
  const elapsed=performance.now()-startAt;
  const speed=actualMotion()==='normal'&&elapsed<360?.12+.88*Math.min(1,elapsed/360):1;
  r.dataset.drive=speed<1?'starting':'running';r.style.setProperty('--gt-reel-blur',actualMotion()==='normal'&&!isLight()?`${.15+speed*.95}px`:'0px');
  r.querySelectorAll('.gt-reel.is-spinning .gt-reel-strip').forEach(el=>{const a=el.getAnimations()[0];if(a)a.playbackRate=speed;});
  if(speed<1)frame=requestAnimationFrame(ramp);
 }
 function monitor(){
  if(!comfort||quality!=='auto'||comfort.light||document.hidden||actualMotion()!=='normal'){cancelAnimationFrame(perfFrame);perfFrame=0;return;}
  const active=()=>{const m=root()?.querySelector('.gt-machine');return !!(m?.dataset?.spinning==='true'||m?.dataset?.transition||activeWin);};
  if(perfFrame||!active())return;
  perfFrame=requestAnimationFrame(time=>{perfFrame=0;const moving=active();comfort.sample(time,{visible:!document.hidden,active:moving});if(moving)monitor();});
 }
 function prefs(){
  if(actualMotion()!=='normal'||document.hidden||isLight())normalDirector?.suspend();
  comfort?.setMode(quality);if(actualMotion()!=='normal'||document.hidden)stageDirector?.cancel();bank?.setVolume(volume);bank?.setEnabled(audio&&!document.hidden);if(activeWin&&actualMotion()!=='normal'&&!activeWin.sample)endWin();const r=root();if(!r)return;
  r.dataset.focus=String(focusMode&&!!r.querySelector('.gt-machine'));r.dataset.hidden=String(document.hidden);r.dataset.motion=actualMotion();r.dataset.quality=isLight()?'light':'full';r.style.setProperty('--gt-glow-alpha',String(glow));
  const machine=r.querySelector('.gt-machine');if(machine?.dataset)machine.dataset.ambient=comfort?.ambient(machine.dataset.spins)||'a';
  r.querySelectorAll('[data-gt-focus]').forEach(b=>{b.textContent=focusMode?'全体に戻る':'操作に集中';b.setAttribute('aria-pressed',String(focusMode));});
  r.querySelectorAll('[data-gt-audio],[data-gt-settings-audio]').forEach(b=>{b.textContent='音：'+(audio?'ON':'OFF');b.setAttribute('aria-pressed',String(audio));});
  for(const [key,value] of Object.entries({volume,motion,quality,glow,control,sync:syncOffset})){const control=r.querySelector('[data-gt-'+key+']');if(control)control.value=String(value);}
  const note=r.querySelector('[data-gt-quality-note]');if(note)note.hidden=!(quality==='auto'&&isLight());const probe=r.querySelector('[data-gt-sync-probe]');if(probe)probe.disabled=!audio||document.hidden;const probeNote=r.querySelector('[data-gt-probe-note]');if(!audio&&probeNote)probeNote.textContent='音ONで確認できます。ゲームの進行は変わりません。';
  r.querySelectorAll('[data-gt-win-mute]').forEach(b=>b.hidden=!audio);if(actualMotion()==='instant')r.querySelectorAll('.gt-reel.is-stopped .gt-reel-strip').forEach(el=>el.getAnimations().forEach(a=>a.cancel()));bank?.setMotor(actualMotion()==='instant'?0:r.querySelectorAll('.gt-reel.is-spinning').length);ramp();monitor();renderDiagnostics();void kisekiLive?.sync();kisekiRealism?.sync();
 }
 function diagnosticSettings(){return {audio,volume,motion:actualMotion(),mode:quality,quality:isLight()?'light':'full',glow,sync:syncOffset,...(kisekiRealism?.active()?{kiseki:kisekiRealism.diagnosticSettings()}: {})};}
 function renderDiagnostics(){
  const r=root();if(!r)return;const toggle=r.querySelector('[data-gt-diagnostic-toggle]');if(!toggle)return;
  if(!diagnostics){toggle.disabled=true;return;}
  const summary=diagnostics.summary(),api=window.GaisenDiagnostics;
  toggle.textContent=diagnostics.enabled?'記録停止':'記録開始';toggle.setAttribute('aria-pressed',String(diagnostics.enabled));
  const badge=r.querySelector('[data-gt-diagnostic-badge]');if(badge)badge.hidden=!diagnostics.enabled;
  const clear=r.querySelector('[data-gt-diagnostic-clear]'),copy=r.querySelector('[data-gt-diagnostic-copy]');if(clear)clear.disabled=!summary.count&&!summary.active;if(copy)copy.disabled=!summary.count||diagnosticCopyPending;
  const status=r.querySelector('[data-gt-diagnostic-status]');if(status)status.textContent=`記録${diagnostics.enabled?'中':'OFF'} · ${summary.count}件（成功${summary.successful}件） · 計測中${summary.active}件。設定変更なしの成功${summary.stable}件の中央値：応答待ち ${api.ms(summary.response)} / 表示までの目安 ${api.ms(summary.frame)}`;
  if(!r.querySelector('[data-gt-preferences]')?.open)return;
  const body=r.querySelector('[data-gt-diagnostic-rows]');if(body){body.replaceChildren();for(const row of diagnostics.rows){const tr=document.createElement('tr');for(const value of [row.action+'（'+({pointer:'押下',keyboard:'キー',click:'クリック',submit:'送信開始'})[row.inputKind]+'）',api.ms(row.inputMs),api.ms(row.responseMs),api.ms(row.updateMs),api.ms(row.frameMs),api.state(row.state)+(row.changed?'（設定変更）':'')]){const td=document.createElement('td');td.textContent=value;tr.append(td);}const settings=document.createElement('small');settings.textContent=api.settingsText(row.settings);tr.firstElementChild?.append(settings);body.append(tr);}}
  const report=r.querySelector('[data-gt-diagnostic-report]');if(report){report.value=lastDiagnosticReport;report.hidden=!lastDiagnosticReport;}
 }
 function interruptDiagnostics(){diagnosticPress=null;diagnosticInput=null;diagnostics?.interrupt();}
 function showRecovery(){const r=root(),notice=r?.querySelector('[data-gt-recovery]'),text=r?.querySelector('[data-gt-recovery-text]');if(!notice||!text)return;const m=r.querySelector('.gt-machine'),guide=r.querySelector('[data-gt-guide]')?.textContent.trim();text.textContent=window.GaisenComfort?.recovery(guide,m?.dataset?.spinning==='true')||((m?.dataset?.spinning==='true'?'停止待ち：':'画面の続き：')+(guide||'台を選んで続けられます'));notice.hidden=false;needsRecovery=false;}
 function timingPosition(button){
  if(!button||!root()?.querySelector('.gt-machine[data-timing="true"]')||control!=='timing'||actualMotion()!=='normal'||document.hidden)return null;
  const key=button.dataset.gtKey;if(!/^stop-[012]$/.test(key||''))return null;
  const reel=root().querySelector('[data-gt-reel="'+key.slice(-1)+'"].is-spinning'),strip=reel?.querySelector('.gt-reel-strip');
  const animation=strip?.getAnimations().find(a=>a.animationName==='gt-reel-roll'),height=strip?.querySelector('.gt-symbol')?.getBoundingClientRect().height;
  if(!animation||!height)return null;
  const y=new DOMMatrixReadOnly(getComputedStyle(strip).transform).m42;
  const cell=((Math.round(-y/height+1)%20)+20)%20;
  return {button,position:19-cell,animation};
 }
 function clearTiming(){if(timingPress?.animation?.playState==='paused')timingPress.animation.play();timingPress=null;}
 function releaseContact(event){kisekiRealism?.release();if(contact)delete contact.dataset.contact;contact=null;if(event?.type==='pointercancel'||event?.type==='blur'){clearTiming();diagnosticPress=null;diagnosticInput=null;}}
 function stopProbe(){probeSequence++;clearTimeout(probeTimer);probeTimer=0;bank?.stopGroup('probe');const lamp=root()?.querySelector('[data-gt-sync-lamp]');if(lamp)delete lamp.dataset.flash;}
 function openSettings(focusId,scroll){const d=root()?.querySelector('[data-gt-preferences]');if(!d)return;if(!d.open)d.showModal();renderDiagnostics();if(['gt-volume','gt-motion','gt-glow','gt-quality','gt-sync','gt-diagnostic-toggle','gt-diagnostic-clear','gt-diagnostic-copy','gt-diagnostic-report','gt-diagnostic-region','gt-diagnostic-summary'].includes(focusId))d.querySelector('#'+focusId)?.focus({preventScroll:true});if(Number.isFinite(scroll))d.scrollTop=scroll;}
 function closeSettings(){stopProbe();root()?.querySelector('[data-gt-preferences]')?.close();}
 function prepareAudio(){bank?.setEnabled(audio&&!document.hidden);bank?.prepare();kisekiLive?.prepare();}
 function resultTone(before,after){
  if(!after)return;
  if(after.dataset.ktTheme)return;
  if(before?.dataset.scene!==after.dataset.scene){
   void bank?.play(['medusa','ex'].includes(after.dataset.scene)?after.dataset.scene:'phase',{rate:pitch(after.dataset.ambient)});
   after.dataset.feedback='phase';
  }else if(after.dataset.spinning==='false'&&Number(after.dataset.paid)>0){
   // 最終STOPの成功時だけ。読込み・場面設定・再送では鳴らさない。
   const replay=!!after.querySelector('[data-gt-settlement]')?.textContent.includes('リプレイ');
   void bank?.play(replay?'replay':'payout',{level:replay?.42:.52});
   after.dataset.feedback='paid';
  }
 }
 function tone(action,index){if(action==='lever')void bank?.play('lever');else if(action==='stop'&&Number.isInteger(index))void bank?.play(['stop-left','stop-middle','stop-right'][index],{pan:[-.28,0,.28][index]});}
 function mutePending(){kisekiRealism?.pause();kisekiLive?.stop();bank?.setEnabled(false);}
 function endWin(){
  const w=activeWin;if(!w)return;activeWin=null;
  w.timers.forEach(clearTimeout);stageDirector?.cancel();bank?.stopGroup('win');if(w.panel){delete w.panel.dataset.winStage;delete w.panel.dataset.winKind;delete w.panel.dataset.variation;}
  if(w.dialog.open)w.dialog.close();void kisekiLive?.sync();
  if(w.sample&&w.focus?.isConnected)w.focus.focus({preventScroll:true});else if(!w.sample&&root()?.classList.contains('kt-root')&&!document.hidden&&!root()?.querySelector('[data-gt-preferences]')?.open)root()?.querySelector('.gt-lever:not(:disabled)')?.focus({preventScroll:true});
 }
 function readWin(){const e=root()?.querySelector('[data-gt-win]');return e?{kind:e.dataset.winKind,added:Number(e.dataset.winAdded),set:Number(e.dataset.winSet),ggGames:Number(e.dataset.winGg),sggGames:Number(e.dataset.winSgg)}:null;}
 function celebrate(event,sample=false){
  endWin();if(!event||document.hidden||(!sample&&actualMotion()==='instant'))return;
  const d=root()?.querySelector('[data-gt-celebration]');if(!d||!['gg','sgg','god','stock'].includes(event.kind))return;
  if(root()?.classList.contains('kt-root')){const background=root().querySelector('.kt-machine .gt-landscape'),image=d.querySelector('.gt-award-background');if(background&&image){image.src=background.dataset?.ktAwardSrc||background.currentSrc||background.src;image.removeAttribute('srcset');}}
  const variant=comfort?.nextVariant()||'a';const kind=event.kind,short=actualMotion()!=='normal',scene=(!sample&&root()?.querySelector('[data-gt-lcd-award]'))||d.querySelector('.gt-award-scene');
  const zEntry=root()?.classList.contains('kt-root')&&root()?.querySelector('.kt-machine')?.dataset.kisekiPhase==='zzone'&&kind==='stock';
  const title=zEntry?'Z-ZONE':{gg:'GOD GAME',sgg:root()?.classList.contains('kt-root')?'SUPER GOD GAME':'SPECIAL GOD GAME',god:'GOD',stock:'GG BOOST'}[kind];
  const prefix=zEntry?'ゼロ揃い':{gg:event.added?'神殿の扉が開く':'次なる神殿へ',sgg:'紅紫の覚醒',god:'神 降 臨',stock:'上乗せ確定'}[kind];
  const set=(name,value)=>d.querySelector('[data-gt-win-'+name+']').textContent=value;
  d.dataset.variation=variant;d.dataset.kind=kind;d.dataset.sample=String(sample);
  set('kicker',sample?'演出見本 · ポイントや進行は変わりません':'咲楽ノ宮 · 当選結果');set('title',title);set('prefix',prefix);
  set('count',event.added>0?'＋'+event.added:'第'+event.set);set('unit','SET');
  const detail=[event.added>0?'GG '+event.added+'セット獲得（開始分を含む）':'保存済みの次セットを開始'];
  if(event.sggGames>0)detail.push('SGG 残り'+event.sggGames+'G');if(event.ggGames>0)detail.push('GG 残り'+event.ggGames+'G');
  set('detail',detail.join(' · '));set('hint',sample?'表示だけの見本です':'結果は保存済みです');set('skip',short?'閉じる':'演出をスキップ');
  d.querySelector('[data-gt-win-mute]').hidden=!audio;
  const focused=document.activeElement,panel=sample?null:root()?.querySelector('.gt-display');
  const w={dialog:d,panel,timers:new Set(),sample,focus:sample?focused:(root()?.querySelector('.kt-lcd-actions [data-gt-win-skip]')||root()?.querySelector('.gt-lever'))};activeWin=w;
  const later=(fn,delay)=>{const id=setTimeout(()=>{w.timers.delete(id);if(activeWin===w&&!document.hidden)fn();},delay);w.timers.add(id);};
  const chime=()=>{void bank?.play(kind,{group:'win',level:short?.55:.8,rate:pitch(variant)});};
  const stage=value=>{scene.dataset.stage=value;if(panel&&!short){panel.dataset.winKind=kind;panel.dataset.winStage=value;panel.dataset.variation=variant;stageDirector?.win(root()?.querySelector('.gt-machine'),kind,value,variant);}};
  stage(short?'award':kind==='stock'?'reveal':'charge');
  if(kind==='god'){kisekiLive?.stop();bank?.stopAll();}
  if(sample)d.showModal();else w.focus?.focus({preventScroll:true});monitor();
  if(short){chime();if(!sample)later(endWin,2200);return;}
  const reveal=kind==='god'?1050:kind==='stock'?0:450,award=kind==='god'?2050:kind==='stock'?350:1050;
  later(()=>{stage('reveal');chime();},reveal);
  later(()=>{stage('award');},award);
  later(endWin,kind==='god'?6000:kind==='stock'?2800:4300);
 }
 document.addEventListener('pointerdown',e=>{const b=e.target.closest?.('.gt-play button');if(b&&!b.disabled&&!busy){releaseContact();contact=b;b.dataset.contact='true';clearTiming();timingPress=timingPosition(b);timingPress?.animation.pause();if(diagnostics?.enabled)diagnosticPress={button:b,at:performance.now(),kind:'pointer'};}if(e.target.closest?.('.gt-play,[data-gt-audio],[data-gt-settings-audio],[data-gt-volume],[data-gt-win-preview],[data-gt-sync-probe]'))prepareAudio();if(b&&!b.disabled&&!busy)kisekiRealism?.contact(b);},{passive:true});
 document.addEventListener('click',e=>{const button=e.target.closest?.('[data-gt-key]');if(!diagnostics?.enabled||!button||button.disabled||busy||document.hidden){diagnosticInput=null;diagnosticPress=null;return;}const press=diagnosticPress?.button===button?diagnosticPress:null;diagnosticInput={button,at:press?.at??performance.now(),kind:press?.kind||'click'};diagnosticPress=null;});
 document.addEventListener('toggle',e=>{if(e.target.matches?.('[data-gt-diagnostics]'))renderDiagnostics();},true);
 document.addEventListener('click',async e=>{
  if(e.target.closest?.('[data-gt-diagnostic-toggle]')){diagnosticInput=null;diagnosticPress=null;diagnostics?.setEnabled(!diagnostics.enabled);renderDiagnostics();}
  if(e.target.closest?.('[data-gt-diagnostic-clear]')){diagnosticCopyTicket++;lastDiagnosticReport='';diagnosticInput=null;diagnosticPress=null;diagnostics?.clear();renderDiagnostics();const note=root()?.querySelector('[data-gt-diagnostic-copy-note]');if(note)note.textContent='記録を消しました。ゲームの進行は変わりません。';}
  if(!e.target.closest?.('[data-gt-diagnostic-copy]')||!diagnostics?.rows.length||diagnosticCopyPending)return;
  const ticket=++diagnosticCopyTicket;lastDiagnosticReport=diagnostics.report({...diagnosticBuild,width:innerWidth,height:innerHeight});const reportText=lastDiagnosticReport;diagnosticCopyPending=true;renderDiagnostics();
  let copied=false;try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(reportText);copied=true;}}catch{}finally{diagnosticCopyPending=false;renderDiagnostics();}if(ticket!==diagnosticCopyTicket)return;
  const r=root(),note=r?.querySelector('[data-gt-diagnostic-copy-note]'),report=r?.querySelector('[data-gt-diagnostic-report]');if(note)note.textContent=copied?'診断結果をコピーしました。':'コピー用テキストを表示しました。選択してコピーできます。';if(!copied&&report?.isConnected&&r.querySelector('[data-gt-preferences]')?.open){report.focus();report.select();}
 });
 document.addEventListener('pointerup',e=>{releaseContact(e);const press=timingPress;setTimeout(()=>{if(timingPress===press)clearTiming();},0);},{passive:true});document.addEventListener('pointercancel',releaseContact,{passive:true});window.addEventListener('blur',releaseContact);
 document.addEventListener('click',e=>{if(e.target.closest?.('[data-gt-settings]'))openSettings();if(e.target.closest?.('[data-gt-settings-close]'))closeSettings();if(e.target.closest?.('[data-gt-recovery-dismiss]')){const n=root()?.querySelector('[data-gt-recovery]');if(n)n.hidden=true;}});
 document.addEventListener('close',e=>{if(e.target.matches?.('[data-gt-preferences]')){stopProbe();if(!document.hidden)root()?.querySelector('[data-gt-settings]')?.focus({preventScroll:true});}},true);
 document.addEventListener('click',e=>{if(!e.target.closest?.('[data-gt-sync-probe]')||!audio)return;stopProbe();prepareAudio();const ticket=probeSequence,note=root()?.querySelector('[data-gt-probe-note]');if(!bank?.buffers.has('stop-middle')){if(note)note.textContent='音を準備しています。少し待ってもう一度お試しください。';return;}void Promise.resolve(bank.resuming).then(()=>{if(ticket!==probeSequence||!audio||document.hidden||!root()?.querySelector('[data-gt-preferences]')?.open)return;if(note)note.textContent='ランプと停止音を比べて調整できます。ゲームの進行は変わりません。';void bank.play('stop-middle',{group:'probe'});probeTimer=setTimeout(()=>{const lamp=root()?.querySelector('[data-gt-sync-lamp]');if(lamp)lamp.dataset.flash='true';probeTimer=setTimeout(()=>{if(lamp)delete lamp.dataset.flash;},180);},actualMotion()==='instant'?0:syncOffset);});});
 document.addEventListener('click',e=>{
  if(e.target.closest?.('[data-gt-win-skip]')){endWin();return;}
  if(e.target.closest?.('[data-gt-win-mute]')){audio=false;mutePending();try{localStorage.setItem('gaisen-trial-audio','off');}catch{}prefs();return;}
  const b=e.target.closest?.('[data-gt-win-preview]');if(!b)return;
  prepareAudio();const kind=b.dataset.gtWinPreview;
  celebrate({kind,added:kind==='god'?5:1,set:1,ggGames:['god','gg'].includes(kind)?100:0,sggGames:kind==='sgg'?16:0},true);
 });
 document.addEventListener('cancel',e=>{if(e.target.matches?.('[data-gt-celebration]')){e.preventDefault();endWin();}},true);
 document.addEventListener('close',e=>{if(e.target===activeWin?.dialog)endWin();},true);
 document.addEventListener('click',e=>{if(!e.target.closest?.('[data-gt-audio],[data-gt-settings-audio]'))return;audio=!audio;if(!audio){stopProbe();mutePending();}else prepareAudio();try{localStorage.setItem('gaisen-trial-audio',audio?'on':'off');}catch{}prefs();});
 document.addEventListener('click',e=>{const b=e.target.closest?.('[data-gt-focus]');if(!b)return;focusMode=!focusMode;try{localStorage.setItem('gaisen-trial-focus',focusMode?'on':'off');}catch{}prefs();root()?.querySelector('.gt-machine')?.scrollIntoView({block:'start',behavior:'instant'});});
 document.addEventListener('change',e=>{if(e.target.matches?.('[data-kt-bgm]'))kisekiLive?.preference(e.target.value);});
 document.addEventListener('change',e=>{if(e.target.matches?.('[data-kt-pref]'))kisekiRealism?.preference(e.target.dataset.ktPref,e.target.value);});
 document.addEventListener('click',e=>{if(e.target.closest?.('[data-kt-break-dismiss]'))kisekiRealism?.dismissBreak();if(e.target.closest?.('[data-kt-replay-win]')){prepareAudio();celebrate(readWin(),true);}});
 document.addEventListener('change',e=>{if(e.target.matches?.('[data-gt-control]')){control=e.target.value==='assist'?'assist':'timing';save('control',control);clearTiming();}});
 document.addEventListener('change',e=>{if(!e.target.matches?.('[data-gt-volume]'))return;volume=Number(e.target.value);bank?.setVolume(volume);prepareAudio();try{localStorage.setItem('gaisen-trial-volume',String(volume));}catch{}});
 document.addEventListener('change',e=>{if(!e.target.matches?.('[data-gt-motion]'))return;motion=e.target.value;try{localStorage.setItem('gaisen-trial-motion',motion);}catch{}prefs();});
 document.addEventListener('change',e=>{if(e.target.matches?.('[data-gt-quality]')){quality=['auto','full','light'].includes(e.target.value)?e.target.value:'auto';save('quality',quality);prefs();}else if(e.target.matches?.('[data-gt-glow]')){const value=Number(e.target.value);if([.35,.7,1].includes(value))glow=value;save('glow',glow);prefs();}else if(e.target.matches?.('[data-gt-sync]')){const value=Number(e.target.value);if([0,40,80].includes(value))syncOffset=value;save('sync',syncOffset);stopProbe();prefs();}});
 // キーを押し続けても連続送信しない。入力欄・別の操作・ダイアログは奪わない。
 document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&activeWin&&root()?.classList.contains('kt-root')&&!document.querySelector('dialog[open]')){e.preventDefault();endWin();return;}
  if(e.isComposing||e.ctrlKey||e.metaKey||e.altKey||e.shiftKey||document.hidden)return;
  clearTiming();const r=root(),target=e.target;
  if(!r||!r.querySelector('.gt-machine')||activeWin?.sample||document.querySelector('dialog[open]'))return;
  if(target?.closest?.('input,select,textarea,[contenteditable]:not([contenteditable="false"]),a,summary,[role="textbox"]'))return;
  if(target?.closest?.('button')&&!target.closest('[data-gt-key]'))return;
  if(e.key==='Enter'&&diagnostics?.enabled){const b=target?.closest?.('[data-gt-key]');if(b&&!b.disabled&&!busy)diagnosticPress={button:b,at:performance.now(),kind:'keyboard'};}
  const key=e.code==='Space'?'lever':({'1':'stop-0','2':'stop-1','3':'stop-2'})[e.key];
  if(!key)return;
  const button=r.querySelector(`[data-gt-key="${key}"]`);if(!button)return;
  e.preventDefault();if(e.repeat||busy||button.disabled)return;if(diagnostics?.enabled)diagnosticPress={button,at:performance.now(),kind:'keyboard'};button.click();
 });
 document.addEventListener('submit',async e=>{
  const form=e.target;if(!(form instanceof HTMLFormElement)||!form.closest('[data-gaisen-trial]'))return;
  e.preventDefault();if(busy)return;kisekiRealism?.cancel();endWin();stageDirector?.cancel();const normalTicket=normalDirector?.begin();busy=true;root().setAttribute('aria-busy','true');
  const action=form.elements.namedItem('action')?.value,index=Number(form.elements.namedItem('index')?.value);
  const hadWin=!!root().querySelector('[data-gt-win]'),before=root().querySelector('.gt-machine');
  const focusedKey=document.activeElement?.dataset?.gtKey,pressed=form.querySelector('[data-gt-key]');if(pressed)pressed.dataset.pressed='true';prepareAudio();
  const input=diagnosticInput?.button===pressed?diagnosticInput:null;diagnosticInput=null;diagnosticPress=null;const diagnostic=diagnostics?.begin({action,index,inputAt:input?.at,inputKind:input?.kind,settings:diagnosticSettings(),visible:!document.hidden});let diagnosticOutcome=null,receivedBody=false;
  try{
   const body=new FormData(form);
   if(action==='lever'&&control==='timing'&&actualMotion()==='normal')body.set('control','timing');
   const timing=timingPress?.button===pressed?timingPress:timingPosition(pressed);
   if(action==='stop'&&timing)body.set('position',String(timing.position));
   timingPress=null;
   const r=await fetch(form.getAttribute('action'),{method:'POST',headers:{'X-Gaisen-Update':'1'},body,credentials:'same-origin'});
   diagnostics?.mark(diagnostic,'headers');const html=await r.text();receivedBody=true;diagnostics?.mark(diagnostic,'body');const doc=new DOMParser().parseFromString(html,'text/html'),next=doc.querySelector('[data-gaisen-trial]');
   if(!next)throw Error('操作結果を確認できませんでした。再送せず「最新の状態を確認」から確認してください。');
   const settingsOpen=!!root().querySelector('[data-gt-preferences]')?.open,diagnosticOpen=!!root().querySelector('[data-gt-diagnostics]')?.open,settingsScroll=root().querySelector('[data-gt-preferences]')?.scrollTop,diagnosticNotice=root().querySelector('[data-gt-diagnostic-copy-note]')?.textContent,settingId=document.activeElement?.id;
   const times=[...root().querySelectorAll('.gt-reel')].map(el=>el.classList.contains('is-spinning')?el.querySelector('.gt-reel-strip').getAnimations()[0]?.currentTime:null);
   root().replaceWith(next);
   if(r.ok&&action==='lever')startAt=performance.now();
   const detail=root().querySelector('[data-gt-diagnostics]');if(detail)detail.open=diagnosticOpen;const copyNote=root().querySelector('[data-gt-diagnostic-copy-note]');if(copyNote)copyNote.textContent=diagnosticNotice||'';prefs();if(settingsOpen)openSettings(settingId,settingsScroll);
   root().querySelectorAll('.gt-reel.is-spinning').forEach(el=>{const i=Number(el.dataset.gtReel),a=el.querySelector('.gt-reel-strip').getAnimations()[0];if(a&&times[i]!=null&&action!=='lever')a.currentTime=times[i];});
   if(r.ok){
    if(['lever','stop','seat','leave'].includes(action)){needsRecovery=false;const notice=root().querySelector('[data-gt-recovery]');if(notice)notice.hidden=true;}
    const win=action==='stop'&&!hadWin?readWin():null;
    if(win){normalDirector?.suspend();celebrate(win);}else {if(['lever','stop'].includes(action))stageDirector?.transition(isKiseki?before:before?.dataset.scene,root().querySelector('.gt-machine'));tone(action,index);if(action==='stop'||action==='lever'&&before?.dataset.scene!==root().querySelector('.gt-machine')?.dataset.scene)resultTone(before,root().querySelector('.gt-machine'));}
    if(!win)normalDirector?.update({before,machine:root().querySelector('.gt-machine'),action,index,ticket:normalTicket});
    monitor();
    if(focusedKey&&!win&&!settingsOpen){const target=root().querySelector(`[data-gt-key="${focusedKey}"]:not(:disabled)`)||root().querySelector('.gt-stop.is-next:not(:disabled)')||root().querySelector('.gt-lever:not(:disabled)');target?.focus({preventScroll:true});}
    if(!win&&action==='stop'&&Number.isInteger(index)&&actualMotion()!=='instant'&&!document.hidden){
     const el=root().querySelector(`[data-gt-reel="${index}"].is-stopped .gt-reel-strip`);
     // 前後の絵柄を余白に置き、窓を空けずに減速して定位置へ収める。
     const height=el?.querySelector('.gt-symbol')?.getBoundingClientRect().height;
     const timed=el?.closest('.is-timed-stop'),slip=Number(timed?.dataset.slip);
     if(timed&&height){const travel=timed.dataset.assisted==='true'?0:slip;el.animate([{transform:`translateY(${-height*(5+travel)}px)`},{transform:`translateY(${-height*5}px)`}],{duration:Math.min(205,55+travel*35),easing:'cubic-bezier(.15,.65,.25,1)'});}
     else {const settle=window.GaisenComfort?.stopMotion?.(height,{motion:actualMotion(),light:isLight(),sync:syncOffset});if(settle)el.animate(settle.frames,settle.timing);}
    }
   }
   kisekiLive?.update({action,ok:r.ok});kisekiRealism?.update({before,action,index,ok:r.ok});
   if(!r.ok)normalDirector?.suspend();
   diagnosticOutcome=r.ok?'ok':r.status===409?'conflict':'http';
  }catch(e){root()?.querySelectorAll('.gt-reel.is-spinning .gt-reel-strip').forEach(el=>el.getAnimations().forEach(a=>a.play()));normalDirector?.suspend();diagnostics?.finish(diagnostic,receivedBody?'display':'network');const error=root()?.querySelector('[data-gt-error]');if(error){error.hidden=false;error.textContent=e.message||'通信できませんでした。最新の状態を確認してください。';}}
  finally{if(pressed)delete pressed.dataset.pressed;busy=false;root()?.removeAttribute('aria-busy');if(diagnosticOutcome)diagnostics?.complete(diagnostic,diagnosticOutcome,!document.hidden,diagnosticSettings());}
 });
 document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTiming();normalDirector?.suspend();interruptDiagnostics();needsRecovery=true;releaseContact();stopProbe();comfort?.pause();cancelAnimationFrame(perfFrame);perfFrame=0;endWin();stageDirector?.cancel();mutePending();root()?.querySelectorAll('.gt-reel.is-stopped .gt-reel-strip').forEach(el=>el.getAnimations().forEach(a=>a.cancel()));}prefs();if(!document.hidden&&needsRecovery)showRecovery();});
 window.addEventListener('pagehide',()=>{clearTiming();normalDirector?.suspend();interruptDiagnostics();needsRecovery=true;releaseContact();stopProbe();comfort?.pause();cancelAnimationFrame(perfFrame);perfFrame=0;endWin();stageDirector?.cancel();cancelAnimationFrame(frame);mutePending();});
 window.addEventListener('pageshow',e=>{if(e.persisted){normalDirector?.suspend();stageDirector?.cancel();prefs();showRecovery();}});
 matchMedia('(prefers-reduced-motion:reduce)').addEventListener('change',prefs);prefs();if(root()?.querySelector('.gt-machine')?.dataset?.spinning==='true')showRecovery();
})();

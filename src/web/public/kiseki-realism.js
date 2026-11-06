// 軌跡の公開済み表示と端末内の演出だけ。抽選・払出・保存APIを呼ばない。
(() => {
 const allowed={density:['quiet','normal','rich'],operationsVolume:[0,.5,1],effectsVolume:[0,.5,1],bgmVolume:[.25,.5,1],contact:['on','off'],haptics:['off','on'],rest:[0,30,60]};
 const defaults={density:'normal',operationsVolume:1,effectsVolume:1,bgmVolume:.5,contact:'on',haptics:'off',rest:0};
 const names={normal:'通常へ',omen:'神殿に気配…',gaia:'GAIA STAGE',gg:'GOD GAME',pgg:'PREMIUM GOD GAME',gzone:'継続を待つ…',sgg:'SUPER GOD GAME','sgg-retry':'SGG · 引き戻し',zzone:'Z-ZONE',zgame:'Z-GAME'};
 class KisekiRealismDirector {
  constructor({bank,root,motion,hidden,light,now=()=>performance.now()}){
   Object.assign(this,{bank,root,motion,hidden,light,now});this.settings={...defaults};this.timers=new Set();this.generation=0;this.machine=null;this.results=[];this.lastResult=null;this.visibleMs=0;this.lastClock=this.now();this.wasVisible=!this.hidden();this.nextBreak=0;this.contactButton=null;
   try{const value=JSON.parse(localStorage.getItem('kiseki-realism')||'{}');for(const key of Object.keys(allowed))if(allowed[key].includes(value?.[key]))this.settings[key]=value[key];}catch{}
   if(this.active()&&bank){bank.eagerKeys=Object.keys(bank.urls||{}).filter(key=>!key.startsWith('bgm-'));bank.maxNodes=28;}
  }
  active(){return !!this.root()?.classList?.contains('kt-root');}
  density(){return !this.active()?1:({quiet:.3,normal:1,rich:1.2})[this.settings.density];}
  diagnosticSettings(){return {...this.settings};}
  moving(){return this.active()&&!this.hidden()&&this.motion()==='normal'&&!this.light();}
  later(fn,ms){const generation=this.generation,id=setTimeout(()=>{this.timers.delete(id);if(generation===this.generation&&!this.hidden()&&this.active())fn();},ms);this.timers.add(id);}
  cancel(){this.generation++;for(const id of this.timers)clearTimeout(id);this.timers.clear();this.bank?.stopGroup('kt-payout');this.bank?.stopGroup('kt-effect');if(this.machine){for(const key of ['ktFeedback','ktStage','ktPayout','ktStop','ktAward'])delete this.machine.dataset[key];const banner=this.machine.querySelector('[data-kt-phase-announcement]');if(banner)banner.textContent='';}this.machine=null;this.release();}
  release(){if(this.contactButton)delete this.contactButton.dataset.ktContact;this.contactButton=null;}
  preference(key,value){
   if(!Object.hasOwn(allowed,key))return;
   const next=typeof defaults[key]==='number'?Number(value):value;if(!allowed[key].includes(next))return;
   this.settings[key]=next;if(key==='rest')this.nextBreak=0;
   try{localStorage.setItem('kiseki-realism',JSON.stringify(this.settings));}catch{}this.sync();
  }
  clock(){const now=this.now();if(Number.isFinite(now)&&now>=this.lastClock&&this.wasVisible)this.visibleMs+=now-this.lastClock;this.lastClock=now;this.wasVisible=!this.hidden();}
  sync(){
   if(!this.active())return;this.clock();const r=this.root();r.dataset.ktDensity=this.settings.density;
   for(const el of r.querySelectorAll('[data-kt-pref]')){const key=el.dataset.ktPref;if(Object.hasOwn(this.settings,key))el.value=String(this.settings[key]);}
   for(const group of ['play','motor','kt-contact'])this.bank?.setGroupLevel?.(group,this.settings.operationsVolume);
   for(const group of ['normal','win','kt-effect','kt-payout'])this.bank?.setGroupLevel?.(group,this.settings.effectsVolume);
   this.bank?.setGroupLevel?.('bgm',this.settings.bgmVolume);
   const supported=typeof navigator!=='undefined'&&typeof navigator.vibrate==='function',haptics=r.querySelector('[data-kt-pref="haptics"]'),note=r.querySelector('[data-kt-haptics-note]');
   if(haptics)haptics.disabled=!supported;if(note)note.textContent=supported?'振動は成功したSTOP・告知だけ。動きを減らす設定では停止します。':'この端末では振動に対応していません。ボタンとランプで操作を表示します。';
   const stats=r.querySelector('[data-kt-session-stats]');if(stats){const returned=this.results.reduce((n,v)=>n+v.paid,0),miss=this.results.filter(v=>v.paid===0).length;stats.textContent=`この画面の直近${this.results.length}ゲーム · 戻り${returned.toLocaleString('ja-JP')}ポイント · 戻り0は${miss}回 · 表示時間${Math.floor(this.visibleMs/60000)}分`;}
   const audio=r.querySelector('[data-kt-audio-state]'),context=this.bank?.context;if(audio){const ms=value=>Number.isFinite(value)&&value>=0?Math.round(value*1000)+'ms':'端末からの申告なし';audio.textContent=context?`音声処理：${context.state||'準備済み'} · 基本遅延 ${ms(context.baseLatency)} · 出力遅延 ${ms(context.outputLatency)}`:'音声処理：音ON後の操作で準備します。';}
   const rest=this.settings.rest*60000,breakNote=r.querySelector('[data-kt-break-note]');if(rest&&!this.nextBreak)this.nextBreak=this.visibleMs+rest;if(breakNote)breakNote.hidden=!rest||this.visibleMs<this.nextBreak;
   if(this.hidden()||!this.moving()||!this.bank?.enabled){this.cancel();}
  }
  dismissBreak(){this.clock();this.nextBreak=this.visibleMs+this.settings.rest*60000;this.sync();}
  pause(){this.clock();this.wasVisible=false;this.cancel();}
  contact(button){
   if(!this.active()||this.hidden()||!button||button.disabled)return;this.release();this.contactButton=button;button.dataset.ktContact='true';
   if(this.settings.contact==='on')void this.bank?.play('kt-contact',{group:'kt-contact',level:.28});
  }
  vibrate(win=false){if(this.settings.haptics!=='on'||!this.moving())return;try{navigator.vibrate?.(win?[18,25,25]:8);}catch{}}
  pulse(kind){if(!this.moving()||!this.machine)return;this.machine.dataset.ktFeedback=kind;this.machine.dataset.ktStage='top';this.later(()=>{if(this.machine)this.machine.dataset.ktStage='rails';},110);this.later(()=>{if(this.machine)this.machine.dataset.ktStage='console';},250);this.later(()=>{if(this.machine){delete this.machine.dataset.ktStage;delete this.machine.dataset.ktFeedback;}},700);}
  payout(paid,replay){
   if(!this.bank?.enabled)return;
   if(replay){void this.bank?.play('replay',{group:'kt-effect',level:.48});return;}
   const count=Math.min(15,Math.max(0,Math.round(paid/10)));for(let n=0;n<count;n++)this.later(()=>{if(this.machine)this.machine.dataset.ktPayout=String(n%2);void this.bank?.play('kt-payout-tick',{group:'kt-payout',level:.22,pan:n%2?.12:-.12});},n*36);
  }
  update({before,action,index,ok}){
   if(!this.active())return;this.cancel();this.sync();const r=this.root(),machine=r.querySelector('.kt-machine');this.machine=machine;if(!ok||!machine||!['lever','stop'].includes(action))return;
   const awarded=!!machine.querySelector('[data-gt-lcd-award]'),finished=action==='stop'&&machine.dataset.spinning==='false',paid=Math.max(0,Number(machine.dataset.paid)||0),role=machine.dataset.ktRole||'none';
   if(finished&&r.dataset.revision!==this.lastResult){this.lastResult=r.dataset.revision;this.results.push({paid,role,pattern:machine.dataset.ktPattern||'mixed'});if(this.results.length>120)this.results.shift();this.sync();this.machine=machine;}
   if(this.hidden())return;
   if(awarded){const count=Math.max(0,Number(r.querySelector('[data-gt-win]')?.dataset.winAdded)||0);machine.dataset.ktAward=count>=4?'grand':count>=2?'strong':'normal';this.vibrate(true);return;}
   const phase=machine.dataset.kisekiPhase,oldPhase=before?.dataset.kisekiPhase;
   if(oldPhase&&phase!==oldPhase){const banner=machine.querySelector('[data-kt-phase-announcement]');if(banner&&this.moving()){banner.textContent=names[phase]||'';this.later(()=>banner.textContent='',1400);}void this.bank?.play(phase==='normal'||phase==='gzone'?'kt-phase-end':'kt-phase-enter',{group:'kt-effect',level:.45});this.pulse('phase');}
   else this.pulse(action==='lever'?'lever':finished&&paid?'paid':'stop');
   if(action==='stop'){
    machine.dataset.ktStop=String(index);
    this.vibrate();void this.bank?.play('kt-brake',{group:'kt-effect',level:.12,pan:[-.28,0,.28][index]||0});
    const stopped=[...machine.querySelectorAll('.gt-digits>span')].filter(el=>!el.classList.contains('gt-digit-spinning'));
    if(stopped.length===2&&stopped[0].textContent===stopped[1].textContent)void this.bank?.play('kt-tenpai',{group:'kt-effect',level:.28});
    if(finished){if(['middleGold','diagonal','middleBlue','sp'].includes(role))void this.bank?.play('kt-rare-stop',{group:'kt-effect',level:.4});this.payout(paid,['blue','middleBlue','fake'].includes(role));}
   }
   if(action==='lever'&&machine.querySelector('[data-gt-lcd-navigation]'))void this.bank?.play('kt-nav',{group:'kt-effect',level:.24});
  }
 }
 window.KisekiRealismDirector=KisekiRealismDirector;
})();

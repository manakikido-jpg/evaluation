// 軌跡専用の演出進行。公開済みの停止/区間だけを使い、抽選や操作を待たせない。
(() => {
 class KisekiNormalDirector extends window.GaisenNormalDirector {
  constructor(options){super(options);this.plan=null;}
  clearFrame(){
   if(this.machine)for(const key of ['ktCue','ktCueStep','ktCueEnding'])delete this.machine.dataset[key];
  }
  cancel(){this.clearFrame();super.cancel();}
  suspend(){super.suspend();this.plan=null;this.last=null;this.omenAge=0;}
  update({before,machine,action,index,ticket}){
   if(ticket!==this.generation)return;
   if(!this.enabled()||!machine||!['lever','stop'].includes(action)||!['normal','omen'].includes(machine.dataset.phase)){this.suspend();return;}
   const key=machine.dataset.gtMachineId+':'+machine.dataset.spins;
   if(action==='lever'){
    if(!before||before.dataset.gtMachineId!==machine.dataset.gtMachineId||Number(machine.dataset.spins)!==Number(before.dataset.spins)+1||key===this.last){this.suspend();return;}
    this.last=key;this.plan=null;
    // 装飾抽選は1Gに1回だけ。小役/当選予定は見ない。頻度は独自調整。
    let p;try{p=this.random();}catch{return;}
    if(!Number.isFinite(p)||p<0||p>=1)return;
    const density=Math.max(.1,Math.min(1.3,this.density()));
    const kinds=['wind','glint','thunder','gates'];
    let kind=machine.dataset.phase==='omen'?kinds[Math.min(3,(this.omenAge=(before.dataset.phase==='omen'?(this.omenAge||0):0)+1)-1)]:p>1-.22*density?kinds[Math.min(3,Math.floor((1-p)/(.22*density)*4))]:null;
    if(kind&&kind===this.lastCue&&machine.dataset.phase!=='omen')kind=kind==='wind'?'glint':'wind';
    if(kind){this.lastCue=kind;this.plan={key,kind,seen:0};}
   }
   const plan=this.plan;if(!plan||plan.key!==key){this.plan=null;return;}
   const digits=[...machine.querySelectorAll('.gt-digits > span')];
   const stopped=digits.filter(d=>!d.classList.contains('gt-digit-spinning'));
   const step=action==='lever'?0:stopped.length;
   if(action==='stop'&&(!Number.isInteger(index)||index<0||index>2||digits[index]?.classList.contains('gt-digit-spinning')||step<=plan.seen||step>3)){this.suspend();return;}
   plan.seen=step;this.machine=machine;
   machine.dataset.ktCue=plan.kind;machine.dataset.ktCueStep=String(step);
   const caption=machine.querySelector('[data-gt-normal-caption]');
   // 派手な文字で期待度を断定しない。説明は読上げ向け、画面は映像を主体にする。
   if(caption)caption.textContent=({wind:'光の風',glint:'光の粒',thunder:'雷',gates:'神殿の扉'})[plan.kind];
   this.sound(plan.kind,step);
   if(action==='stop'){
    const digit=digits[index];this.animate(digit,[{transform:'translateY(-8px) scale(1.04)',opacity:.75},{transform:'translateY(2px) scale(1)',opacity:1,offset:.7},{transform:'translateY(0)',opacity:1}],{duration:170,easing:'ease-out'});
   }
   if(step===2&&stopped[0]?.textContent===stopped[1]?.textContent)machine.dataset.normalHold='true';
   if(step===3){
    machine.dataset.ktCueEnding='true';this.plan=null;
    this.later(()=>this.cancel(),850);
   }else{
    // 押し続けず放置したときの装飾だけを消す。次のSTOPでは同じ予告を再開。
    this.later(()=>this.cancel(),2600);
   }
  }
 }
 class KisekiStageDirector extends window.GaisenStageDirector {
  cancel(){if(this.machine){delete this.machine.dataset.ktTransition;const title=this.machine.querySelector('[data-kt-stage-title]');if(title)title.textContent='';}super.cancel();}
  transition(before,machine){
   this.cancel();if(!this.enabled()||!machine||!before||typeof before!=='object')return;
   const from=before.dataset.kisekiPhase,to=machine.dataset.kisekiPhase;
   const landscape=from===to&&before.dataset.landscape!==machine.dataset.landscape;
   if(!landscape&&from===to)return;
   this.machine=machine;
   machine.dataset.ktTransition=landscape?'landscape':to==='normal'?'return':['gzone','sgg-retry'].includes(to)?'waiting':['omen','gaia'].includes(to)?'approach':'entry';
   const title=machine.querySelector('[data-kt-stage-title]');
   if(title)title.textContent=machine.querySelector('.gt-screen-mode')?.textContent||'';
   machine.dataset.lightKind=to;machine.dataset.lightStage='top';
   const generation=this.generation;
   const later=(fn,ms)=>{const id=setTimeout(()=>{this.timers.delete(id);if(generation===this.generation){if(this.enabled())fn();else this.cancel();}},ms);this.timers.add(id);};
   later(()=>machine.dataset.lightStage='rails',180);later(()=>machine.dataset.lightStage='apron',400);later(()=>this.cancel(),1100);
  }
 }
 window.KisekiNormalDirector=KisekiNormalDirector;window.KisekiStageDirector=KisekiStageDirector;
})();

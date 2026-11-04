// 確定した公開区間だけをつなぐ。操作や抽選の進行は待たせない。
(() => {
 class GaisenStageDirector {
  constructor({motion,hidden,variant=()=> 'a'}){this.variant=variant;this.motion=motion;this.hidden=hidden;this.machine=null;this.timers=new Set();this.generation=0;}
  cancel(){this.generation++;for(const timer of this.timers)clearTimeout(timer);this.timers.clear();if(this.machine){delete this.machine.dataset.transition;delete this.machine.dataset.variation;delete this.machine.dataset.lightStage;delete this.machine.dataset.lightKind;}this.machine=null;}
  enabled(){return this.motion()==='normal'&&!this.hidden();}
  transition(before,machine){
   this.cancel();const scene=machine?.dataset.scene;
   if(!this.enabled()||!before||before===scene||!['normal','gg','gstop','gzone','sgg','medusa','ex','omen'].includes(scene))return;
   this.machine=machine;machine.dataset.variation=this.variant();machine.dataset.transition=scene==='medusa'?'ring':['gstop','gzone','ex'].includes(scene)?'sweep':scene==='normal'?'fade':'doors';machine.dataset.lightKind=scene;machine.dataset.lightStage='top';
   const generation=this.generation;
   const later=(fn,ms)=>{const timer=setTimeout(()=>{this.timers.delete(timer);if(this.generation===generation){if(this.enabled())fn();else this.cancel();}},ms);this.timers.add(timer);};
   later(()=>{machine.dataset.lightStage='rails';},180);later(()=>{machine.dataset.lightStage='apron';},420);later(()=>this.cancel(),950);
  }
  win(machine,kind,stage,variant='a'){
   this.cancel();if(!this.enabled()||!machine||!['god','gg','sgg','stock'].includes(kind))return;
   this.machine=machine;machine.dataset.variation=['a','b','c'].includes(variant)?variant:'a';machine.dataset.lightKind=kind;machine.dataset.lightStage=stage==='charge'?'top':stage==='reveal'?'rails':'apron';
  }
 }
 window.GaisenStageDirector=GaisenStageDirector;
})();

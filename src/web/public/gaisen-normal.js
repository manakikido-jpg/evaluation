// 通常時の装飾だけ。公開済みの区間/数字を使い、抽選・未停止役・前兆残りGを受け取らない。
(() => {
 class GaisenNormalDirector {
  constructor({motion,hidden,light=()=>false,sound=()=>{},stopSound=()=>{},random=()=>{const n=new Uint32Array(1);crypto.getRandomValues(n);return n[0]/4294967296;}}){
   Object.assign(this,{motion,hidden,light,sound,stopSound,random});this.generation=0;this.machine=null;this.timers=new Set();this.animations=new Set();this.chain=null;this.last=null;
  }
  enabled(){return this.motion()==='normal'&&!this.hidden()&&!this.light();}
  cancel(){this.generation++;for(const t of this.timers)clearTimeout(t);this.timers.clear();for(const a of this.animations)a.cancel();this.animations.clear();this.stopSound();if(this.machine){for(const k of ['normalCue','normalMood','normalHold'])delete this.machine.dataset[k];const c=this.machine.querySelector('[data-gt-normal-caption]');if(c)c.textContent='';}this.machine=null;}
  suspend(){this.cancel();this.chain=null;}
  begin(){this.cancel();return this.generation;}
  later(fn,ms){const generation=this.generation,t=setTimeout(()=>{this.timers.delete(t);if(generation!==this.generation)return;if(this.enabled())fn();else this.suspend();},ms);this.timers.add(t);}
  animate(el,frames,timing){if(!el?.animate)return;const a=el.animate(frames,timing);this.animations.add(a);a.onfinish=()=>this.animations.delete(a);}
  cue(machine,kind,mood=1){
   this.machine=machine;machine.dataset.normalCue=kind;machine.dataset.normalMood=String(mood);
   const caption=machine.querySelector('[data-gt-normal-caption]');if(caption)caption.textContent=({wind:'風が通る…',glint:'光が集まる…',thunder:'遠くで雷鳴…',dim:'灯りが揺らぐ…',gates:'神殿の扉に気配…',quiet:'気配が静まる'})[kind]||'';
   if(kind!=='quiet')this.sound(kind);
   this.later(()=>{delete machine.dataset.normalCue;if(caption)caption.textContent='';},kind==='gates'?1000:760);
  }
  update({before,machine,action,index,ticket}){
   if(ticket!==this.generation||!this.enabled()){this.chain=null;return;}
   if(!machine||!['lever','stop'].includes(action)){this.chain=null;this.last=null;return;}
   const phase=machine.dataset.phase;if(!['normal','omen'].includes(phase)){this.chain=null;return;}
   const spins=Number(machine.dataset.spins),id=machine.dataset.gtMachineId,key=id+':'+spins;
   if(action==='lever'){
    if(!before||before.dataset.gtMachineId!==id||spins!==Number(before.dataset.spins)+1||this.last===key){this.chain=null;return;}
    if(this.last&&!this.last.startsWith(id+':'))this.chain=null;this.last=key;
    if(phase==='omen'){
     this.chain=this.chain?.kind==='omen'?{kind:'omen',age:this.chain.age+1}:{kind:'omen',age:1};
     const age=this.chain.age;this.cue(machine,age>=3?'gates':age===2?'thunder':'wind',Math.min(3,age));
    }else if(this.chain?.kind==='omen'){this.chain=null;}
    else if(this.chain?.kind==='tease'){
     this.chain.age++;this.cue(machine,this.chain.age===2?'thunder':'gates',Math.min(3,this.chain.age));
    }else{
     let p;try{p=this.random();}catch{return;}if(!Number.isFinite(p)||p<0||p>=1)return;
     if(p>=.97){this.chain={kind:'tease',age:1};this.cue(machine,'wind');}
     else if(p>=.94)this.cue(machine,'dim');else if(p>=.88)this.cue(machine,'thunder');else if(p>=.8)this.cue(machine,'glint');else if(p>=.7)this.cue(machine,'wind');
    }
   }else{
    this.machine=machine;const digits=[...machine.querySelectorAll('.gt-digits > span')],digit=digits[index];
    if(Number.isInteger(index)&&index>=0&&index<3&&digit&&!digit.classList.contains('gt-digit-spinning'))this.animate(digit,[{transform:'translateY(-7px)',opacity:.75},{transform:'translateY(1px)',opacity:1,offset:.75},{transform:'translateY(0)',opacity:1}],{duration:150,easing:'ease-out'});
    const stopped=digits.filter(d=>!d.classList.contains('gt-digit-spinning'));
    if(stopped.length===2&&stopped[0].textContent===stopped[1].textContent)machine.dataset.normalHold='true';
    if(machine.dataset.spinning==='false'&&phase==='normal'&&this.chain?.kind==='tease'&&this.chain.age>=3){this.chain=null;this.cue(machine,'quiet');}
   }
  }
 }
 window.GaisenNormalDirector=GaisenNormalDirector;
})();

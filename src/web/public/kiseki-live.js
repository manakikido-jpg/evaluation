// 軌跡専用。公開中の区間・数字だけを使う。抽選とポイントは扱わない。
(() => {
 class KisekiLiveDirector {
  constructor({bank,root,motion,light,hidden}){Object.assign(this,{bank,root,motion,light,hidden});this.key=null;this.ticket=0;this.source=null;this.music=true;this.used=false;try{this.music=localStorage.getItem('kiseki-trial-bgm')!=='off';}catch{}}
  active(){return this.root()?.classList.contains('kt-root');}
  stop(fade=0){this.ticket++;this.key=null;this.source=null;this.bank?.stopGroup('bgm',fade);}
  async sync(){
   if(!this.active())return;
   const r=this.root(),machine=r.querySelector('.kt-machine'),theme=machine?.dataset.ktTheme;
   const charge=machine?.querySelector('.gt-display')?.dataset.winKind==='god';
   const key=!charge&&this.music&&this.used&&!this.hidden()&&this.bank?.enabled&&['gg','pgg','sgg'].includes(theme)?'bgm-'+theme:null;
   r.querySelectorAll('[data-kt-bgm]').forEach(e=>e.value=this.music?'on':'off');
   if(!key){if(this.key)this.stop(!charge&&!this.hidden()&&this.bank?.enabled&&this.music?140:0);return;}
   if(this.key===key)return;
   this.stop(140);this.key=key;const ticket=this.ticket,context=this.bank.context;
   if(!context){this.key=null;return;}
   const buffer=await this.bank.load(key);await this.bank.resuming;
   if(ticket!==this.ticket||context!==this.bank.context||!this.bank.enabled||this.hidden()||!this.bank.running(context)){if(ticket===this.ticket)this.key=null;return;}
   if(!buffer){this.key=null;return;}
   try{this.source=this.bank.createNode(buffer,{group:'bgm',level:.2,priority:-1,loop:true,loopStart:0,loopEnd:buffer.duration});}catch{this.key=null;}
  }
  prepare(){if(this.active()){this.used=true;void this.sync();}}
  preference(value){this.music=value==='on';try{localStorage.setItem('kiseki-trial-bgm',this.music?'on':'off');}catch{}void this.sync();}
  update({action,ok}){
   if(!this.active())return;
   const machine=this.root().querySelector('.kt-machine'),digits=[...(machine?.querySelectorAll('.gt-digits > span')??[])];
   // テンパイはすでに止まった2数字の一致だけ。未停止の役は見ない。
   const stopped=digits.filter(d=>!d.classList.contains('gt-digit-spinning'));
   if(machine)machine.dataset.ktTenpai=String(stopped.length===2&&stopped[0].textContent===stopped[1].textContent);
   if(ok&&['lever','stop'].includes(action))this.prepare();else void this.sync();
  }
 }
 window.KisekiLiveDirector=KisekiLiveDirector;
})();

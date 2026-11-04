// 表示の負荷と装飾だけを扱う。抽選・停止位置・払出には触れない。
(() => {
 class GaisenComfort {
  constructor({onChange=()=>{}}={}){this.onChange=onChange;this.mode='auto';this.light=false;this.previous=null;this.frames=[];this.sequence=0;}
  setMode(value){const mode=['auto','full','light'].includes(value)?value:'auto';if(mode===this.mode)return;this.mode=mode;this.pause();this.light=mode==='light';}
  pause(){this.previous=null;this.frames=[];}
  sample(time,{visible=true,active=true}={}){
   if(!visible){this.pause();return;}
   if(!active||this.mode!=='auto'||this.light){this.previous=null;return;}
   const before=this.previous;this.previous=time;if(before===null)return;
   const delta=time-before;if(delta<4||delta>1000){this.previous=null;return;}
   this.frames.push(delta);if(this.frames.length<90)return;
   const slow=this.frames.filter(ms=>ms>28).length/this.frames.length;this.frames=[];
   if(slow>.35){this.light=true;this.onChange(true);}
  }
  nextVariant(){return ['a','b','c'][this.sequence++%3];}
  ambient(spins){return ['a','b','c'][Math.abs(Math.trunc(Number(spins)||0))%3];}
  // 保存成功後の停止表示だけ。待ち時間は増やさず、小さい揺り戻しで機械の収まりを作る。
  static stopMotion(height,{motion='normal',light=false,sync=0}={}){
   if(!Number.isFinite(height)||height<=0||height>2048||!['normal','low'].includes(motion))return null;
   const low=motion==='low'||light,travel=low?Math.min(1.5,height*.06):Math.min(30,height*.72),rebound=low?0:Math.min(1.8,height*.04);
   const position=value=>`translateY(${value}px)`;
   return {frames:[{transform:position(-height-travel),filter:low?'none':'blur(.45px)'},{transform:position(-height-Math.min(travel*.14,2.4)),filter:'none',offset:.48},{transform:position(-height+rebound),filter:'none',offset:.76},{transform:position(-height-(low?0:.35)),filter:'none',offset:.93},{transform:position(-height),filter:'none'}],timing:{duration:low?100:205,delay:[0,40,80].includes(sync)?sync:0,fill:'backwards',easing:'cubic-bezier(.12,.65,.22,1)'}};
  }
  static recovery(guide,spinning){return spinning?'停止待ち：'+(guide||'操作できるSTOPから続けられます'):'画面の続き：'+(guide||'台を選んで続けられます');}
 }
 window.GaisenComfort=GaisenComfort;
})();

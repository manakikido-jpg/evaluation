// 独自音源だけを再生する。ポイントや抽選は扱わない。
(() => {
 class GaisenSampleBank {
  constructor(urls){this.urls=urls;this.enabled=false;this.volume=.65;this.context=null;this.buffers=new Map();this.loading=new Map();this.nodes=new Map();this.generation=0;this.groups=new Map();this.resuming=Promise.resolve();this.motorCount=0;this.motor=null;this.motorTicket=0;this.motorLoading=null;}
  setEnabled(value){if(this.enabled===value)return;this.enabled=value;if(!value){this.stopAll();const old=this.context;this.context=null;if(old)try{void Promise.resolve(old.close()).catch(()=>{});}catch{}}}
  setVolume(value){this.volume=Math.max(0,Math.min(1,value));for(const {gain,level} of this.nodes.values())gain.gain.setTargetAtTime(this.volume*level,this.context.currentTime,.015);}
  prepare(){
   if(!this.enabled)return;
   try{const Context=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Context)return;this.context??=new Context();this.resuming=Promise.resolve(this.context.resume()).catch(()=>{});for(const key of Object.keys(this.urls))void this.load(key);this.syncMotor();}catch{}
  }
  async load(key){
   if(this.buffers.has(key))return this.buffers.get(key);
   if(!this.context||!this.urls[key])return null;
   if(this.loading.has(key))return this.loading.get(key);
   const context=this.context;
   const request=(async()=>{try{const response=await fetch(this.urls[key],{credentials:'same-origin'});if(!response.ok)return null;const buffer=await context.decodeAudioData(await response.arrayBuffer());this.buffers.set(key,buffer);return buffer;}catch{return null;}})();
   this.loading.set(key,request);void request.finally(()=>this.loading.delete(key));return request;
  }
  running(context){return !context.state||context.state==='running';}
  createNode(buffer,{group,level,pan=0,loop=false}){
   const context=this.context,source=context.createBufferSource(),gain=context.createGain();source.buffer=buffer;
   const panner=context.createStereoPanner?.();gain.gain.value=loop?0:this.volume*level;source.connect(gain);
   if(panner){panner.pan.value=Math.max(-1,Math.min(1,pan));gain.connect(panner);panner.connect(context.destination);}else gain.connect(context.destination);
   if(loop){source.loop=true;source.loopStart=.25;source.loopEnd=Math.min(2.25,buffer.duration||3);gain.gain.setTargetAtTime(this.volume*level,context.currentTime,.035);}
   this.nodes.set(source,{gain,group,level});source.onended=()=>{this.nodes.delete(source);if(this.motor===source)this.motor=null;source.disconnect();gain.disconnect();panner?.disconnect();};source.start();return source;
  }
  async play(key,{group='play',level=.65,pan=0}={}){
   if(!this.enabled||!this.context)return;
   const context=this.context,generation=this.generation,groupGeneration=this.groups.get(group)||0,queued=performance.now();
   const buffer=await this.load(key);await this.resuming;
   // Safariの音の開始待ちも含め、遅れた操作音や取消済みの音を後から鳴らさない。
   if(!buffer||!this.enabled||context!==this.context||!this.running(context)||generation!==this.generation||groupGeneration!==(this.groups.get(group)||0)||performance.now()-queued>180)return;
   try{this.createNode(buffer,{group,level,pan});}catch{}
  }
  setMotor(count){
   count=this.enabled?Math.max(0,Math.min(3,Math.trunc(count))):0;
   if(count!==this.motorCount){this.motorCount=count;this.motorTicket++;}
   if(!count){const source=this.motor;this.motor=null;const entry=this.nodes.get(source);if(entry){entry.level=0;entry.gain.gain.setTargetAtTime(0,this.context.currentTime,.025);try{source.stop(this.context.currentTime+.09);}catch{}}return;}
   this.syncMotor();
  }
  syncMotor(){
   if(!this.enabled||!this.context||!this.motorCount)return;
   const level=.055+.035*this.motorCount,entry=this.nodes.get(this.motor);
   if(entry){entry.level=level;entry.gain.gain.setTargetAtTime(this.volume*level,this.context.currentTime,.045);return;}
   if(this.motorLoading)return;
   const context=this.context,ticket=this.motorTicket,generation=this.generation;
   const task=(async()=>{const buffer=await this.load('reel-motor');await this.resuming;
    if(!buffer||!this.enabled||!this.motorCount||context!==this.context||!this.running(context)||ticket!==this.motorTicket||generation!==this.generation)return;
    try{this.motor=this.createNode(buffer,{group:'motor',level:.055+.035*this.motorCount,loop:true});}catch{}
   })();this.motorLoading=task;
   void task.finally(()=>{if(this.motorLoading===task)this.motorLoading=null;if(this.motorCount&&ticket!==this.motorTicket)this.syncMotor();});
  }
  stopGroup(group){if(group==='motor'){this.motorCount=0;this.motorTicket++;this.motor=null;}this.groups.set(group,(this.groups.get(group)||0)+1);for(const [source,entry] of this.nodes)if(entry.group===group){try{source.stop();}catch{}this.nodes.delete(source);}}
  stopAll(){this.motorCount=0;this.motorTicket++;this.motor=null;this.generation++;for(const source of this.nodes.keys()){try{source.stop();}catch{}}this.nodes.clear();}
 }
 window.GaisenSampleBank=GaisenSampleBank;
})();

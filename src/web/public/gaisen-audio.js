// 独自音源だけを再生する。ポイントや抽選は扱わない。
(() => {
 class GaisenSampleBank {
  constructor(urls){this.urls=urls;this.enabled=false;this.volume=.65;this.context=null;this.output=null;this.buffers=new Map();this.loading=new Map();this.nodes=new Map();this.generation=0;this.groups=new Map();this.resuming=Promise.resolve();this.motorCount=0;this.motor=null;this.motorTicket=0;this.motorLoading=null;}
  setEnabled(value){if(this.enabled===value)return;this.enabled=value;if(!value){this.stopAll();const old=this.context;this.context=null;this.output=null;if(old)try{void Promise.resolve(old.close()).catch(()=>{});}catch{}}}
  setVolume(value){this.volume=Math.max(0,Math.min(1,value));this.rebalance();}
  rebalance(){
   if(!this.context)return;
   const active=[...this.nodes.values()].filter(e=>e.level>0),highest=Math.max(0,...active.map(e=>e.priority));
   for(const entry of this.nodes.values()){
    const peers=active.filter(e=>e.priority===entry.priority).length;
    const duck=entry.priority>=highest?1:highest===3?(entry.priority===0?.14:entry.priority===1?.35:.45):highest===2?(entry.priority===0?.35:.7):.65;
    const target=this.volume*entry.level*duck/Math.sqrt(Math.max(1,peers));
    entry.gain.gain.setTargetAtTime(target,this.context.currentTime,target<entry.gain.gain.value?.018:.09);
   }
  }
  prepare(){
   if(!this.enabled)return;
   try{const Context=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Context)return;this.context??=new Context();
    if(!this.output){const limiter=this.context.createDynamicsCompressor?.();if(limiter){for(const [key,value] of Object.entries({threshold:-8,knee:8,ratio:8,attack:.003,release:.14}))limiter[key].value=value;limiter.connect(this.context.destination);}this.output=limiter||this.context.destination;}
    this.resuming=Promise.resolve(this.context.resume()).catch(()=>{});for(const key of Object.keys(this.urls))void this.load(key);this.syncMotor();}catch{}
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
  createNode(buffer,{group,level,pan=0,loop=false,rate=1,priority=group==='win'?3:group==='motor'?0:group==='normal'?.5:1}){
   const context=this.context,source=context.createBufferSource(),gain=context.createGain();source.buffer=buffer;if(source.playbackRate)source.playbackRate.value=Math.max(.96,Math.min(1.04,rate));
   const panner=context.createStereoPanner?.();gain.gain.value=loop?0:this.volume*level;source.connect(gain);
   if(panner){panner.pan.value=Math.max(-1,Math.min(1,pan));gain.connect(panner);panner.connect(this.output||context.destination);}else gain.connect(this.output||context.destination);
   if(loop){source.loop=true;source.loopStart=.25;source.loopEnd=Math.min(2.25,buffer.duration||3);gain.gain.setTargetAtTime(this.volume*level,context.currentTime,.035);}
   this.nodes.set(source,{gain,group,level,priority});source.onended=()=>{this.nodes.delete(source);if(this.motor===source)this.motor=null;source.disconnect();gain.disconnect();panner?.disconnect();this.rebalance();};this.rebalance();try{source.start();}catch(error){source.onended();throw error;}return source;
  }
  async play(key,{group='play',level=.65,pan=0,rate=1}={}){
   if(!this.enabled||!this.context)return;
   const context=this.context,generation=this.generation,groupGeneration=this.groups.get(group)||0,queued=performance.now();
   const buffer=await this.load(key);await this.resuming;
   // Safariの音の開始待ちも含め、遅れた操作音や取消済みの音を後から鳴らさない。
   if(!buffer||!this.enabled||context!==this.context||!this.running(context)||generation!==this.generation||groupGeneration!==(this.groups.get(group)||0)||performance.now()-queued>180)return;
   try{this.createNode(buffer,{group,level,pan,rate,priority:group==='win'?3:group==='normal'?.5:['payout','replay'].includes(key)?2:1});}catch{}
  }
  setMotor(count){
   count=this.enabled?Math.max(0,Math.min(3,Math.trunc(count))):0;
   if(count!==this.motorCount){this.motorCount=count;this.motorTicket++;}
   if(!count){const source=this.motor;this.motor=null;const entry=this.nodes.get(source);if(entry){entry.level=0;this.rebalance();try{source.stop(this.context.currentTime+.09);}catch{}}return;}
   this.syncMotor();
  }
  syncMotor(){
   if(!this.enabled||!this.context||!this.motorCount)return;
   const level=.055+.035*this.motorCount,entry=this.nodes.get(this.motor);
   if(entry){entry.level=level;this.rebalance();return;}
   if(this.motorLoading)return;
   const context=this.context,ticket=this.motorTicket,generation=this.generation;
   const task=(async()=>{const buffer=await this.load('reel-motor');await this.resuming;
    if(!buffer||!this.enabled||!this.motorCount||context!==this.context||!this.running(context)||ticket!==this.motorTicket||generation!==this.generation)return;
    try{this.motor=this.createNode(buffer,{group:'motor',level:.055+.035*this.motorCount,loop:true});}catch{}
   })();this.motorLoading=task;
   void task.finally(()=>{if(this.motorLoading===task)this.motorLoading=null;if(this.motorCount&&ticket!==this.motorTicket)this.syncMotor();});
  }
  stopGroup(group){if(group==='motor'){this.motorCount=0;this.motorTicket++;this.motor=null;}this.groups.set(group,(this.groups.get(group)||0)+1);for(const [source,entry] of this.nodes)if(entry.group===group){try{source.stop();}catch{}this.nodes.delete(source);}this.rebalance();}
  stopAll(){this.motorCount=0;this.motorTicket++;this.motor=null;this.generation++;for(const source of this.nodes.keys()){try{source.stop();}catch{}}this.nodes.clear();}
 }
 window.GaisenSampleBank=GaisenSampleBank;
})();

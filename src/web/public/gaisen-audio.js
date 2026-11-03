// 独自に制作した音源ファイルの再生だけを担当する。ゲームの状態は扱わない。
(() => {
 class GaisenSampleBank {
  constructor(urls){this.urls=urls;this.enabled=false;this.volume=.65;this.context=null;this.buffers=new Map();this.loading=new Map();this.nodes=new Map();this.generation=0;this.groups=new Map();}
  setEnabled(value){if(this.enabled===value)return;this.enabled=value;if(!value){this.stopAll();const old=this.context;this.context=null;if(old)void old.close().catch(()=>{});}}
  setVolume(value){this.volume=Math.max(0,Math.min(1,value));for(const {gain,level} of this.nodes.values())gain.gain.setTargetAtTime(this.volume*level,this.context.currentTime,.015);}
  prepare(){
   if(!this.enabled)return;
   try{this.context??=new AudioContext();void this.context.resume().catch(()=>{});for(const key of Object.keys(this.urls))void this.load(key);}catch{}
  }
  async load(key){
   if(this.buffers.has(key))return this.buffers.get(key);
   if(!this.context||!this.urls[key])return null;
   if(this.loading.has(key))return this.loading.get(key);
   const context=this.context;
   const request=(async()=>{
    try{const response=await fetch(this.urls[key],{credentials:'same-origin'});if(!response.ok)return null;const buffer=await context.decodeAudioData(await response.arrayBuffer());this.buffers.set(key,buffer);return buffer;}catch{return null;}
   })();
   this.loading.set(key,request);void request.finally(()=>this.loading.delete(key));return request;
  }
  async play(key,{group='play',level=.65}={}){
   if(!this.enabled||!this.context)return;
   const context=this.context,generation=this.generation,groupGeneration=this.groups.get(group)||0,queued=performance.now();
   const buffer=await this.load(key);
   // 読み込みが遅れた操作音は後から鳴らさない。ミュート・非表示・終了後も無音。
   if(!buffer||!this.enabled||context!==this.context||generation!==this.generation||groupGeneration!==(this.groups.get(group)||0)||performance.now()-queued>180)return;
   try{const source=context.createBufferSource(),gain=context.createGain();source.buffer=buffer;gain.gain.value=this.volume*level;source.connect(gain);gain.connect(context.destination);this.nodes.set(source,{gain,group,level});source.onended=()=>{this.nodes.delete(source);source.disconnect();gain.disconnect();};source.start();}catch{}
  }
  stopGroup(group){this.groups.set(group,(this.groups.get(group)||0)+1);for(const [source,entry] of this.nodes)if(entry.group===group){try{source.stop();}catch{}this.nodes.delete(source);}}
  stopAll(){this.generation++;for(const source of this.nodes.keys()){try{source.stop();}catch{}}this.nodes.clear();}
 }
 window.GaisenSampleBank=GaisenSampleBank;
})();

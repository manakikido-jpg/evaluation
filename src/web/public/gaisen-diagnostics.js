// 本人がONにした間だけ、操作の時間をメモリーへ記録する。外へ送信しない。
(() => {
 const STATES={ok:'成功',conflict:'状態の変更',http:'応答エラー',network:'通信失敗',display:'表示失敗',hidden:'中断',stopped:'計測停止'};
 const choice=(value,allowed,fallback)=>allowed.includes(value)?value:fallback;
 const median=values=>{if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;};
 class GaisenDiagnostics {
  constructor({now=()=>performance.now(),requestFrame=fn=>requestAnimationFrame(fn),cancelFrame=id=>cancelAnimationFrame(id),visible=()=>!globalThis.document?.hidden,onChange=()=>{}}={}){this.now=now;this.visible=visible;this.requestFrame=requestFrame;this.cancelFrame=cancelFrame;this.onChange=onChange;this.enabled=false;this.rows=[];this.active=new Set();this.generation=0;this.sequence=0;}
  emit(){try{this.onChange();}catch{}}
  static settings(value={}){value=value&&typeof value==='object'?value:{};const result={audio:value.audio===true,volume:choice(value.volume,[.3,.65,1],.65),motion:choice(value.motion,['normal','low','instant'],'normal'),mode:choice(value.mode,['auto','full','light'],'auto'),quality:choice(value.quality,['full','light'],'full'),glow:choice(value.glow,[.35,.7,1],.7),sync:choice(value.sync,[0,40,80],0)};const k=value.kiseki;if(k&&typeof k==='object')result.kiseki={density:choice(k.density,['quiet','normal','rich'],'normal'),operationsVolume:choice(k.operationsVolume,[0,.5,1],1),effectsVolume:choice(k.effectsVolume,[0,.5,1],1),bgmVolume:choice(k.bgmVolume,[.25,.5,1],.5),contact:choice(k.contact,['on','off'],'on'),haptics:choice(k.haptics,['on','off'],'off'),rest:choice(k.rest,[0,30,60],0)};return result;}
  static state(value){return Object.hasOwn(STATES,value)?STATES[value]:STATES.display;}
  static ms(value){return Number.isFinite(value)?Math.round(value)+' ms':'—';}
  static settingsText(value){const s=GaisenDiagnostics.settings(value),k=s.kiseki;return `音${s.audio?'ON':'OFF'}/${s.volume}・演出${{normal:'通常',low:'控えめ',instant:'即表示'}[s.motion]}・画質${{auto:'自動',full:'通常',light:'軽め'}[s.mode]}(${s.quality==='light'?'軽め':'通常'})・発光${s.glow}・映像待ち${s.sync}ms`+(k?`・軌跡頻度${{quiet:'静か',normal:'ふつう',rich:'にぎやか'}[k.density]}/操作音${k.operationsVolume}/演出音${k.effectsVolume}/BGM${k.bgmVolume}/接触${k.contact}/振動${k.haptics}/休憩${k.rest}分`:'');}
  setEnabled(value){value=!!value;if(value===this.enabled)return;this.enabled=value;if(!value)this.interrupt('stopped');else{this.generation++;this.emit();}}
  valid(token){return !!token&&this.active.has(token)&&token.generation===this.generation;}
  begin({action,index,inputAt,inputKind,settings,visible=true}={}){
   if(!this.enabled||!visible||!this.visible()||!['lever','stop'].includes(action)||action==='stop'&&(!Number.isInteger(index)||index<0||index>2))return null;
   const submitted=this.now();if(!Number.isFinite(submitted))return null;
   const measured=Number.isFinite(inputAt)&&inputAt>=0&&inputAt<=submitted;
   const token={id:++this.sequence,generation:this.generation,action:action==='lever'?'レバー':['左STOP','中STOP','右STOP'][index],inputKind:measured?choice(inputKind,['pointer','keyboard','click'],'submit'):'submit',input:measured?inputAt:submitted,submitted,headers:null,body:null,dom:null,settings:GaisenDiagnostics.settings(settings),frames:new Set()};
   this.active.add(token);this.emit();return token;
  }
  mark(token,stage){
   if(!this.valid(token)||!['headers','body'].includes(stage)||token[stage]!==null)return;
   const time=this.now(),before=stage==='headers'?token.submitted:token.headers;
   if(before!==null&&Number.isFinite(time)&&time>=before)token[stage]=time;
  }
  complete(token,state='ok',visible=true,settings){
   if(!this.valid(token)||token.dom!==null)return;
   if(!visible){this.finish(token,'hidden');return;}
   const time=this.now();if(token.body===null||!Number.isFinite(time)||time<token.body){this.finish(token,'display');return;}
   token.dom=time;if(settings)token.endSettings=GaisenDiagnostics.settings(settings);
   const schedule=fn=>{const id=this.requestFrame(()=>{token.frames.delete(id);if(this.valid(token)){if(this.visible())fn();else this.finish(token,'hidden');}});token.frames.add(id);};
   // 2回目のコールバックまでを目安にする。実際の描画や聴感とは別。
   try{schedule(()=>{try{schedule(()=>this.finish(token,state,this.now()));}catch{this.finish(token,'display');}});}catch{this.finish(token,'display');}
  }
  finish(token,state,frame=null,notify=true){
   if(!this.valid(token))return;
   for(const id of token.frames){try{this.cancelFrame(id);}catch{}}token.frames.clear();this.active.delete(token);
   state=Object.hasOwn(STATES,state)?state:'display';
   const row={id:token.id,action:token.action,inputKind:token.inputKind,state,settings:token.endSettings||token.settings,startSettings:token.settings,changed:!!token.endSettings&&JSON.stringify(token.settings)!==JSON.stringify(token.endSettings),inputMs:token.submitted-token.input,responseMs:token.body===null?null:token.body-token.submitted,updateMs:token.dom===null||token.body===null?null:token.dom-token.body,frameMs:Number.isFinite(frame)&&frame>=token.dom&&token.dom!==null?frame-token.input:null};
   this.rows=[row,...this.rows].sort((a,b)=>b.id-a.id).slice(0,20);if(notify)this.emit();
  }
  interrupt(state='hidden'){for(const token of [...this.active])this.finish(token,state,null,false);this.generation++;this.emit();}
  clear(){for(const token of this.active)for(const id of token.frames){try{this.cancelFrame(id);}catch{}}this.active.clear();this.rows=[];this.sequence=0;this.generation++;this.emit();}
  summary(){const successful=this.rows.filter(r=>r.state==='ok'),stable=successful.filter(r=>!r.changed);return {count:this.rows.length,successful:successful.length,stable:stable.length,active:this.active.size,response:median(stable.map(r=>r.responseMs).filter(Number.isFinite)),frame:median(stable.map(r=>r.frameMs).filter(Number.isFinite))};}
  report(meta={}){
   meta=meta&&typeof meta==='object'?meta:{};
   const build=value=>typeof value==='string'&&/^[a-f0-9]{10}$/.test(value)?value:'不明';
   const dimension=value=>Number.isFinite(value)&&value>0&&value<=10000?Math.round(value):'不明';
   const summary=this.summary(),method={pointer:'押下',keyboard:'キー',click:'クリック',submit:'送信開始'};
   const lines=['神殿スロット 操作時間診断',`画面JS: ${build(meta.build)} / 診断JS: ${build(meta.diagnosticBuild)}`,`画面サイズ: ${dimension(meta.width)} × ${dimension(meta.height)}`,`保存件数: ${summary.count} / 成功: ${summary.successful} / 中央値の対象: ${summary.stable} / 計測中: ${summary.active}`,`成功・設定変更なしの中央値: 応答待ち ${GaisenDiagnostics.ms(summary.response)} / 表示までの目安 ${GaisenDiagnostics.ms(summary.frame)}`,'各行は画面更新時の設定（更新前の中断・失敗は開始時）。画面サイズはコピー時点。単位ms。'];
   for(const r of [...this.rows].reverse())lines.push(`${r.id}. ${r.action} (${method[r.inputKind]}) ${GaisenDiagnostics.state(r.state)}${r.changed?'（設定変更）':''} | 入力待ち ${GaisenDiagnostics.ms(r.inputMs)} / 応答待ち ${GaisenDiagnostics.ms(r.responseMs)} / 画面更新 ${GaisenDiagnostics.ms(r.updateMs)} / 表示までの目安 ${GaisenDiagnostics.ms(r.frameMs)} | ${r.changed?GaisenDiagnostics.settingsText(r.startSettings)+' → ':''}${GaisenDiagnostics.settingsText(r.settings)}`);
   lines.push('入力待ち: 入力イベントから送信開始まで。指を離すまでの時間を含む場合があります。','応答待ち: 送信開始から本文受信まで。通信・サーバー処理・ブラウザーの実行待ちを含みます。','画面更新: 本文受信からDOM更新処理の完了まで。','表示までの目安: 入力イベントから2回目の描画コールバックまで。停止演出の完了・実描画・音が聞こえる時間は測定していません。','画面を隠した記録や途中停止/失敗/設定変更のある記録は中央値から除外。記録はメモリー内だけで、送信・永続保存していません。');return lines.join('\n');
  }
 }
 window.GaisenDiagnostics=GaisenDiagnostics;
})();

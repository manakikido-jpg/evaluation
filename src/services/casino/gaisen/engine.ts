import {controlReel,reelSymbol,reelValue,REEL_STRIPS,type ReelControl,type ReelStop} from './reelRules.js';
import {drawFrontMode,frontHitPercent,backTransition,backHitPercent,hitPercent,type FrontMode,type BackMode,type ModeContext} from './modeRules.js';
import {drawLoop,normalLoopTable,roleLoopTable,historyLoopTable} from './loopRules.js';
import {drawGstopGroup,drawHoldGroup,isHold,isReach} from './gstopRules.js';
import {drawSggResetLoop,drawSggRescueLoop,blocksSggRescue,type SggLoopRate} from './sggLoopRules.js';
import {drawMedusa,drawMedusaReset,drawEx,drawExStock} from './sggRules.js';
import type {Rng} from '../cards.js';
import {historySymbol,historyAward,type HistorySymbol} from './historyRules.js';
import {drawPhaseFlag,preparePhaseSpin,phaseOutcome,phaseReels,type PhaseSpin} from './phaseRules.js';
import {drawInitialOmen,drawCeilingLoop,CEILING_GAMES,CEILING_OMEN} from './omenRules.js';

/** 無料試遊用。確認済みの区間構成と、未照合の暫定抽選を分離する。実銭には接続しない。 */
export const RULE_VERSION='trial-1';
export type RuleVersion='trial-1'|'trial-2';
export const BET=30, UNIT=10;
export type Phase='normal'|'omen'|'gg'|'gstop'|'sgg'|'gzone';
export type Role='god'|'red7'|'rare'|'replay'|'bell'|'smallBell'|'none';
export type Setting=1|2|3|4|5|6;
export const ORDERS=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
export const PHASE_NAMES:Record<Phase,string>={normal:'参道',omen:'神殿の前兆',gg:'GOD GAME',gstop:'G-STOP',sgg:'SPECIAL GOD GAME',gzone:'G-ZONE'};
export const ROLE_NAMES:Record<Role,string>={god:'GOD揃い',red7:'赤7揃い',rare:'レア役',replay:'リプレイ',bell:'黄7',smallBell:'3枚役',none:'ハズレ'};
export type GSymbol='1'|'3'|'5'|'V'|'S'|'7'|'鏡';
export type Spin={role:Role;order:number[];stops:number[];symbols:(string|null)[];group:GSymbol[];hold:boolean;phase:Phase;model?:PhaseSpin;control?:ReelControl};
export type WinEvent={kind:'gg'|'sgg'|'god'|'stock';added:number;set:number;ggGames:number;sggGames:number};
export type GaisenState={
 version:RuleVersion;sample:boolean;setting:Setting;phase:Phase;normalGames:number;mode:0|1|2;omen:number;ggLeft:number;stocks:number;sets:number;zoneLeft:number;
 gstopLeft:number;gstopReturn:Phase;hold:GSymbol|null;sggLeft:number;sggReturn:Phase;medusa:number;ex:boolean;yellow:number;blue:number;pending:Spin|null;
 balance:number;spins:number;input:number;output:number;lastPaid:number;lastRole:Role|null;display:string[];message:string;history:string[];
 gods:number;firsts:number;sggs:number;chainWon:number;
 symbolHistory?:HistorySymbol[];gstopQueue?:number;
 // 旧保存は低確1/裏低確/通常天井から継続。停止済みフラグを引き直さない。
 frontMode?:FrontMode;backMode?:BackMode;ceilingLimit?:510|1000|1480;bonusLoops?:SggLoopRate[];
 holdGroup?:GSymbol[];mirrorHigh?:boolean;
 // 前兆の残りGと確定権利を分離。旧trial-2の未設定は残りGから一度だけ補完する。
 omenStocks?:number;
 // 無限の時間停止と、まだ告知していない当選分。旧保存の未設定はfalse相当。
 medusaInfinite?:boolean;medusaDeferred?:boolean;
 // 新しいSGG開始時から救済条件を追跡。旧保存の未設定は対象外。
 sggRescueEligible?:boolean;sggLoops?:SggLoopRate[];
 // 天井の前兆/権利/ループを通常の前兆と分離。旧保存では未設定。
 ceilingStocks?:number;ceilingLeft?:number;ceilingHit?:boolean;ceilingLoop?:0|1|80;
 // 表示用。旧保存データでは未設定。抽選や払出の判定には使わない。
 reelDisplay?:string[];lastReelStops?:(ReelStop|null)[];reelPhase?:Phase;lastReplay?:boolean;winEvent?:WinEvent|null;
};
export function newGaisen(setting:Setting=1,version:RuleVersion=RULE_VERSION):GaisenState{return {version,sample:false,setting,phase:'normal',normalGames:0,mode:0,omen:0,ggLeft:0,stocks:0,sets:0,zoneLeft:0,gstopLeft:0,gstopReturn:'normal',hold:null,sggLeft:0,sggReturn:'normal',medusa:0,ex:false,yellow:0,blue:0,pending:null,balance:100000,spins:0,input:0,output:0,lastPaid:0,lastRole:null,display:['0','1','2'],message:'レバーで開始。実際の銭は使いません。',history:[],gods:0,firsts:0,sggs:0,chainWon:0};}
const ordinaryOmenSets=(s:GaisenState)=>s.version==='trial-2'?(s.omenStocks??(s.omen>0?1:0)):0;
export const pendingOmenSets=(s:GaisenState)=>ordinaryOmenSets(s)+(s.version==='trial-2'?(s.ceilingStocks??0):0);
export const isProtected=(s:GaisenState)=>s.phase!=='normal'||s.stocks>0||(s.gstopQueue??0)>0||pendingOmenSets(s)>0||(s.ceilingLoop??0)>0||(s.version==='trial-2'&&((s.sggLoops?.length??0)>0||(s.bonusLoops?.length??0)>0));
function note(s:GaisenState,text:string){s.message=text;s.history.unshift(`${s.spins}G · ${text}`);s.history.length=Math.min(s.history.length,60);}
function startGG(s:GaisenState){
 const pending=pendingOmenSets(s);
 if(s.version==='trial-2'){s.omenStocks=0;s.ceilingStocks=0;s.ceilingLeft=0;s.ceilingHit=false;if(pending>0)award(s,pending);}
 if(s.version==='trial-2')s.ceilingLimit=1480;
 s.phase='gg';s.ggLeft=100;s.stocks--;s.sets++;s.normalGames=0;s.omen=0;
 note(s,`GG 第${s.sets}セット開始 · 100G${pending>0?'（前兆の当選分を引き継ぎ）':''}`);
}
function beginOmen(s:GaisenState,games:number){if(s.version==='trial-2')s.omenStocks=ordinaryOmenSets(s)+1;s.omen=games;}
function award(s:GaisenState,n:number){if(s.sets===0&&s.stocks===0){s.firsts++;s.chainWon=0;}s.stocks+=n;}
function enterGstop(s:GaisenState){s.gstopReturn=s.phase;s.phase='gstop';s.gstopLeft=5;s.hold=null;s.holdGroup=undefined;note(s,'G-STOP · 自分でSTOPを押して抽選');}
function enterSGG(s:GaisenState,rng?:Rng){s.sggReturn=s.phase==='gstop'?s.gstopReturn:s.phase;s.phase='sgg';s.sggLeft=16;s.medusa=0;s.ex=s.version==='trial-2'&&!!rng&&drawEx(s.setting,true,rng);if(s.version==='trial-2'){s.medusaInfinite=false;s.medusaDeferred=false;s.sggRescueEligible=!s.ex;}s.sggs++;note(s,'SGG開始 · 16GのST');}
function restore(s:GaisenState,phase:Phase){s.phase=phase;if((phase==='normal'||phase==='omen')&&s.stocks>0)startGG(s);else if(phase==='gg'&&s.ggLeft<=0){s.phase='gzone';s.zoneLeft=5;}}
/** GOD/赤7の基礎フラグ以外は暫定の役分布。実機の全役抽選表ではない。 */
export function drawRole(rng:Rng):Role{const n=rng(65536);return n<8?'god':n<20?'red7':n<1184?'rare':n<17568?'replay':n<31986?'bell':n<56890?'smallBell':'none';}
export function lever(s:GaisenState,rng:Rng,forced?:Role,timing=false):void{
 if(s.pending)throw Error('先に3つのSTOPを押してください。');if(s.balance<BET)throw Error('試遊ポイントが足りません。');
 s.balance-=BET;s.input+=BET;s.spins++;s.lastPaid=0;s.winEvent=null;
 const next=s.version==='trial-2'?preparePhaseSpin(forced?({god:'god',red7:'red',rare:'yellowCommon',replay:'blue',bell:'bell',smallBell:'small',none:'none'} as const)[forced]:drawPhaseFlag(s,rng),rng):null;
 const role=next?.role??forced??drawRole(rng),phase=s.phase,hold=phase==='gstop'&&s.hold!==null&&!(next&&(role==='god'||role==='red7'));
 if(next&&phase==='gstop'&&!hold)s.hold=null;
 // 新版では区間と成立役から候補を選び、停止途中もこの群を保存する。
 let group:GSymbol[];
 if(next){
  // GG中の鏡高確への移行率は未公表。自然試遊は低確、専用場面で高確を確認する。
  group=phase==='gstop'?(hold?drawHoldGroup(s.holdGroup??(s.hold==='7'?['1','7','3','S','5']:['1','V','3','S','5']),s.hold!,next.model.flag,rng)
   :drawGstopGroup(s.gstopReturn==='gg'?(s.mirrorHigh?'high':'low'):'normal',next.model.flag,rng)):[];
 }else{group=rng(4)===0?['1','3','5','7','S']:['1','3','5','V','S'];if(rng(3)===0)group[0]='鏡';if(role==='rare')group[2]='鏡';}
 s.pending={role,phase,order:next?.order??ORDERS[rng(6)]!.slice(),stops:hold?[0,2]:[],symbols:hold?[s.hold,null,s.hold]:[null,null,null],group,hold,...(next?{model:next.model}:{})};
 if(timing&&s.version==='trial-2'&&phase!=='gstop')s.pending.control={stops:[null,null,null],miss:false};
 s.message=hold?'HOLD · 中STOPで抽選':'3つのSTOPを押してください。';
}
function gstopStop(p:Spin,index:number,rng:Rng){
 // 鏡は次の非鏡に変化。鏡がない停止以降は鏡候補を除く。
 const hadNonMirror=p.symbols.some(x=>x!==null&&x!=='鏡');
 const options=p.group.filter(x=>(hadNonMirror||p.stops.length===2||p.hold)?x!=='鏡':true);
 const symbol=options[rng(options.length)]!;p.symbols[index]=symbol;
 if(symbol!=='鏡')for(let i=0;i<3;i++)if(p.symbols[i]==='鏡')p.symbols[i]=symbol;
}
/** 停止した帯だけを返す。押し順を外した時点以降は金7を止めない。 */
function logicalReelStops(p:Spin):(string|null)[]{
 if(p.model)return phaseReels(p);
 return [0,1,2].map(index=>{
  const at=p.stops.indexOf(index);if(at<0)return null;
  // G-STOP/HOLDは上部の抽選。下部を数字や鏡に変換して当たりを装わない。
  if(p.phase==='gstop')return ['青7','◆','桜'][index]!;
  if(p.role==='bell')return p.stops.slice(0,at+1).every((v,i)=>v===p.order[i])?'黄7':['◆','桜','青7'][index]!;
  return roleReels(p.role)[index]!;
 });
}
export function reelStops(p:Spin):(string|null)[]{
 if(p.control)return p.control.stops.map((s,i)=>s?reelValue(REEL_STRIPS[i]![s.position]!,i):null);
 return logicalReelStops(p);
}
function roleReels(role:Role|null):string[]{
 return role==='god'?['G','O','D']:role==='red7'?['赤7','赤7','赤7']:role==='replay'?['青7','青7','青7']
  :role==='bell'?['黄7','黄7','黄7']:role==='smallBell'?['◆','◆','◆']:role==='rare'?['黄7','青7','黄7']:['青7','◆','桜'];
}
/** 旧保存の読取りにも対応する。進行中は保存済みの停止順から同じ帯を復元。 */
export function visibleReels(s:GaisenState):(string|null)[]{
 if(s.pending)return reelStops(s.pending);
 if(s.reelDisplay)return s.reelDisplay;
 if(s.lastRole==='bell'&&s.lastPaid===0)return ['黄7','黄7','◆'];
 if(s.lastRole===null&&s.display.join('')==='GOD')return roleReels('god');
 return roleReels(s.lastRole);
}
export function stop(s:GaisenState,index:number,rng:Rng,position?:number):boolean{
 const p=s.pending;if(!p||!Number.isInteger(index)||index<0||index>2||p.stops.includes(index))throw Error('このSTOPは押せません。');
 if(position!==undefined&&(!Number.isInteger(position)||position<0||position>=20))throw Error('停止位置は0〜19です。');
 if(p.phase==='gstop'&&index!==[0,1,2].find(i=>!p.stops.includes(i)))throw Error('G-STOPは左から順に停止します。');
 if(p.phase==='gstop'&&p.role!=='god'&&p.role!=='red7')gstopStop(p,index,rng);
 else if(p.model){const preview={...p,stops:[...p.stops,index]};p.symbols[index]=phaseReels(preview)[index]!;}
 else p.symbols[index]=p.role==='god'?['G','O','D'][index]!:p.role==='red7'?'赤7':p.role==='replay'?'青7':p.role==='bell'?'黄7':p.role==='smallBell'?'◆':p.role==='rare'?['黄7','青7','黄7'][index]!:['2','4','6'][index]!;
 if(p.control){
  const target=reelSymbol(logicalReelStops({...p,stops:[...p.stops,index]})[index]!,index);
  const result=controlReel(index,target,position,p.control);
  p.control.stops[index]=result;p.control.miss ||=result.miss;
 }
 p.stops.push(index);if(p.stops.length<3)return false;
 s.reelDisplay=reelStops(p).map(x=>x!);s.lastReelStops=p.control?structuredClone(p.control.stops):undefined;s.reelPhase=p.phase;
 const before={total:s.stocks+s.sets,sets:s.sets,gods:s.gods,sggs:s.sggs};
 if(p.model)s.lastReplay=phaseOutcome(p).replay;
 s.pending=null;s.lastRole=p.model?phaseOutcome(p).role:p.role;s.display=p.symbols.map(x=>x??'0');finish(s,p,rng);
 // 開始時に消費したストックも獲得数へ含める。演出用に再抽選しない。
 const added=Math.max(0,s.stocks+s.sets-before.total);
 const kind=s.gods>before.gods?'god':s.sggs>before.sggs?'sgg':s.phase==='gg'&&s.sets>before.sets?'gg':added>0?'stock':null;
 s.winEvent=kind?{kind,added,set:s.sets,ggGames:s.phase==='gg'?s.ggLeft:0,sggGames:s.phase==='sgg'?s.sggLeft:0}:null;
 return true;
}
function finish(s:GaisenState,p:Spin,rng:Rng){
 // 停止途中・特殊区間に退避した旧保存も、残っている前兆の権利を明示化する。
 if(p.model&&s.omenStocks===undefined)s.omenStocks=ordinaryOmenSets(s);
 const outcome=p.model?phaseOutcome(p):null,role=outcome?.role??p.role;
 const correct=outcome?.correct??p.stops.every((v,i)=>v===p.order[i]);
 const paid=outcome?outcome.units*UNIT:p.role==='replay'?BET:p.role==='bell'?(correct?15*UNIT:0):p.role==='god'?15*UNIT:p.role==='rare'||p.role==='smallBell'?3*UNIT:0;
 s.balance+=paid;s.output+=paid;s.lastPaid=paid;if(p.phase!=='normal'&&p.phase!=='omen')s.chainWon+=paid-BET;
 // blue/yellowは旧版用の連続カウンタ。新版の履歴抽選はsymbolHistoryだけを使う。
 s.yellow=(outcome?outcome.mark==='yellow':p.role==='bell'&&correct)?s.yellow+1:0;s.blue=(outcome?outcome.mark==='blue':p.role==='replay')?s.blue+1:0;
 note(s,`${outcome?.name??ROLE_NAMES[p.role]} · 戻り${paid}ポイント${p.control?.miss?'（目押しが届きませんでした）':(outcome||p.role==='bell')&&!correct?'（押し順不一致）':''}`);
 let loopAdded=0;const frontAtStart=s.frontMode??'low1';
 const modeContext:ModeContext=p.phase==='gzone'?(s.stocks>0||pendingOmenSets(s)>0?'omen':'normal'):p.phase==='normal'&&pendingOmenSets(s)>0?'omen':p.phase;
 if(p.model){
  // 当選の次ゲームから各ループを1回だけ抽選。停止途中・再送では進めない。
  s.sggLoops=(s.sggLoops??[]).filter(rate=>{if(rng(100)>=rate)return false;award(s,1);loopAdded++;return true;});
  s.bonusLoops=(s.bonusLoops??[]).filter(rate=>{if(rng(100)>=rate)return false;
   if(ordinaryOmenSets(s)>0)s.omenStocks=ordinaryOmenSets(s)+1;else if((s.ceilingStocks??0)>0)s.ceilingStocks!++;else{award(s,1);loopAdded++;}return true;});
  if(p.phase==='sgg'&&(s.ex||s.medusa>0||s.medusaInfinite||blocksSggRescue(p.model.flag)))s.sggRescueEligible=false;
  advanceCeiling(s,p,rng,role);
 }
 const history=p.model?historySymbol(p):null;
 let extra={gg:0,gstop:0,reason:''};
 if(history){s.symbolHistory=[...(s.symbolHistory??[]),history].slice(-5);extra=historyAward({...s,phase:p.phase},s.symbolHistory,rng);if(extra.gg){award(s,extra.gg);addLoop(s,historyLoopTable(p.phase,s.gstopReturn,s.symbolHistory),rng);}s.gstopQueue=(s.gstopQueue??0)+extra.gstop;}
 const beganOmen=p.model?resolveModes(s,p,rng,frontAtStart,modeContext):false;
 finishPhase(s,p,rng,role,beganOmen,frontAtStart);
 if(p.model){
  if(['normal','omen','gzone'].includes(s.phase)&&(s.ceilingStocks??0)>0){
   if(s.ceilingLeft===0)startGG(s);
   else if(s.phase==='normal')s.phase='omen';
  }
  // G-STOP中に得た次回分は、現在のG-STOP/SGGを終えてから消化する。
  if((s.gstopQueue??0)>0&&s.phase!=='gstop'&&s.phase!=='sgg'){s.gstopQueue=(s.gstopQueue??0)-1;enterGstop(s);}
  else if((extra.gg>0||loopAdded>0)&&(s.phase==='normal'||s.phase==='omen'))startGG(s);
  if(extra.gg||extra.gstop)note(s,`履歴：${extra.reason}${extra.gg?' · GG＋'+extra.gg:''}${extra.gstop?' · G-STOP＋'+extra.gstop:''}`);
 }
}
/** 天井の権利は到達時に一度だけ確保。前兆中や通常へ戻るG-STOPも数える。 */
function advanceCeiling(s:GaisenState,p:Spin,rng:Rng,role:Role){
 // 当選の次ゲームから1回ずつ。停止途中では確定せず、再読込で回数を増やさない。
 if(s.ceilingLoop){
  if(rng(100)<s.ceilingLoop){
   if((s.ceilingStocks??0)>0)s.ceilingStocks!++;
   else award(s,1);
  }else s.ceilingLoop=0;
 }
 const phase=p.phase==='gstop'?s.gstopReturn:p.phase;
 if(!['normal','omen','gzone'].includes(phase))return;
 s.normalGames++;
 if((s.ceilingLeft??0)>0)s.ceilingLeft!--;
 // 同じゲームの確定役は優先する試遊仕様。未告知の本前兆は天井を妨げない。
 if(!s.ceilingHit&&s.normalGames>=(s.ceilingLimit??CEILING_GAMES)&&s.stocks===0&&role!=='god'&&role!=='red7'){
  s.ceilingHit=true;s.ceilingLeft=CEILING_OMEN;s.ceilingStocks=(s.ceilingStocks??0)+1;s.ceilingLoop=drawCeilingLoop(rng);
 }
}
function addLoop(s:GaisenState,table:number,rng:Rng){(s.bonusLoops??=[]).push(drawLoop(table,rng));}
/** 判定は開始時モード、移行先は次Gへ。特殊区間で通常前兆を二重に進めない。 */
function resolveModes(s:GaisenState,p:Spin,rng:Rng,front:FrontMode,ctx:ModeContext):boolean{
 const flag=p.model!.flag,back=s.backMode??'low';
 const frontAllowed=!(p.phase==='sgg'&&(s.ex||s.medusa>0||s.medusaInfinite));
 const frontHit=frontAllowed&&hitPercent(frontHitPercent(ctx,front,s.setting,flag),rng);
 const backHit=p.phase!=='gzone'&&hitPercent(backHitPercent(ctx,back,flag),rng);
 let n=0;
 if(frontHit){n+=ctx==='normal'&&front==='v'?3:1;addLoop(s,roleLoopTable(ctx,front,flag),rng);}
 if(backHit){n++;addLoop(s,1,rng);}
 let began=false;
 if(n){
  if(p.phase==='normal'||p.phase==='omen'){
   if(ordinaryOmenSets(s)===0){s.omen=drawInitialOmen(flag,rng);began=true;}
   s.omenStocks=ordinaryOmenSets(s)+n;s.phase='omen';note(s,'神殿に光が集まる…');
  }else{award(s,n);note(s,`GG＋${n}`);}
 }
 s.frontMode=drawFrontMode(ctx,front,s.setting,flag,rng);
 if(frontHit&&ctx==='normal'&&front==='v')s.frontMode='short';
 s.backMode=p.phase==='gzone'?back:backTransition(ctx,back,s.setting,flag,rng);
 return began;
}
function finishNormalV2(s:GaisenState,beganOmen:boolean){
 if(!beganOmen&&s.omen>0)s.omen--;
 if(s.omen===0&&ordinaryOmenSets(s)>0){startGG(s);return;}
 if(pendingOmenSets(s)>0)s.phase='omen';
}
function finishPhase(s:GaisenState,p:Spin,rng:Rng,role:Role,beganOmen=false,front:FrontMode='low1'){
 // 特別役は区間を問わず優先。SGG/G-STOPも残りを失わない。
 if(role==='god'){s.gods++;award(s,5);if(p.model)addLoop(s,p.phase==='gstop'?4:10,rng);if(p.phase==='normal'||p.phase==='omen'||p.phase==='gzone')startGG(s);else if(p.phase==='sgg'){if(p.model)resetSGGV2(s);else s.sggLeft=16;}else if(p.model&&p.phase==='gstop'){s.hold=null;s.holdGroup=undefined;restore(s,s.gstopReturn);}note(s,p.model?'神降臨 · GG5セット追加':'神降臨 · GG5セット追加（追加ループは未照合）');return;}
 if(role==='red7'){award(s,1);if(p.phase==='sgg'){if(p.model){const medusa=s.medusa>0||!!s.medusaInfinite;
    (s.sggLoops??=[]).push(drawSggResetLoop(Math.max(0,s.sggLeft-(medusa?0:1)),rng,s.ex?'ex':medusa?'medusa':'ordinary'));
    resetSGGV2(s);if(!s.ex)s.ex=p.model.flag==='red'||(!medusa&&drawEx(s.setting,false,rng));}else s.sggLeft=16;note(s,'赤7 · GG＋1、残り16Gへ');}else{if(p.model)addLoop(s,p.phase==='gstop'?4:normalLoopTable(front),rng);enterSGG(s,rng);}return;}
 switch(p.phase){
  case 'normal':case 'omen':{
   if(p.model){finishNormalV2(s,beganOmen);break;}
   s.normalGames++;
   if(role==='rare'){s.mode=Math.min(2,s.mode+1)as 0|1|2;if(rng([32,28,26,22,18,14][s.setting-1]!)===0&&s.omen===0)beginOmen(s,3+rng(5));}
   if(!p.model&&s.yellow>=4){award(s,1);startGG(s);note(s,'黄7連続 · GG当選');break;}
   if(!p.model&&s.blue>=3&&rng(8-s.setting)===0){enterGstop(s);break;}
   if(s.normalGames>=1480){if(!pendingOmenSets(s))award(s,1);startGG(s);note(s,'天井到達 · GG（ループ振分は暫定未搭載）');break;}
   if(s.omen>0){s.phase='omen';s.omen--;if(s.omen===0){if(!p.model)award(s,1);startGG(s);}}
   else if(rng([3000,2700,2400,2000,1700,1400][s.setting-1]!/(s.mode+1)|0)===0){beginOmen(s,3+rng(5));s.phase='omen';note(s,'神殿に光が集まる…');}
   break;
  }
  case 'gg':s.ggLeft--;if(!p.model&&s.yellow>=5){award(s,1);note(s,'黄7連続 · GG＋1');}if(!p.model&&role==='rare'&&rng(32)===0){award(s,1);note(s,'レア役 · GG＋1');}if(!p.model&&s.blue>=3&&rng(8)===0){enterGstop(s);break;}if(s.ggLeft<=0){s.phase='gzone';s.zoneLeft=5;note(s,'G-ZONE · 次のセットを待つ');}break;
  case 'gzone':s.zoneLeft--;if(s.zoneLeft<=0){if(s.stocks>0)startGG(s);else{s.phase='normal';note(s,`連チャン${s.sets}セット終了 · 区間差引${s.chainWon}ポイント`);s.sets=0;s.mode=0;}}break;
  case 'gstop':{
   const a=p.symbols as GSymbol[];const same=a.every(x=>x===a[0]);
   const reach=p.model?isReach(a):a.join('')==='135'||a.join('')==='V31';
   if(same){const n=a[0]==='7'?5:a[0]==='V'?3:1;award(s,n);if(p.model)addLoop(s,roleLoopTable('gstop',front,p.model.flag),rng);s.hold=null;s.holdGroup=undefined;if(a[0]==='S')enterSGG(s,rng);else{restore(s,s.gstopReturn);note(s,`G-STOP ${a.join('')} · GG＋${n}`);}break;}
   if(reach){award(s,1);if(p.model)addLoop(s,roleLoopTable('gstop',front,p.model.flag),rng);note(s,'リーチ目 · GG＋1、G-STOP継続');}
   if(!p.hold)s.gstopLeft--;
   s.hold=!p.hold&&(p.model?isHold(a):a[0]===a[2]&&['V','S','7'].includes(a[0]!))?a[0]!:null;
   if(p.model)s.holdGroup=s.hold?p.group.slice():undefined;
   if(s.gstopLeft<=0&&!s.hold)restore(s,s.gstopReturn);else if(s.hold)note(s,`${s.hold} HOLD · 次は中STOPのみ`);
   break;
  }
  case 'sgg':{
   if(p.model){finishSGGV2(s,p,rng);break;}
   if(s.medusa>0)s.medusa--;else s.sggLeft--;
   if(role==='rare'){if(s.medusa>0){s.sggLeft=16;award(s,1);s.ex=true;note(s,'巻き戻し · GG＋1、EXへ');}else if(rng(4)===0){s.medusa=10;note(s,'時が止まる · 10Gの減算停止');}}
   if(s.ex&&rng(3)===0){award(s,1);note(s,'EX · GG＋1');}
   if(s.sggLeft<=0&&s.medusa<=0)restore(s,s.sggReturn);
   break;
  }
 }
}
/** 巻き戻しは現在の時間停止を終了。後告知の当選済み分は失わず残す試遊規則。 */
function resetSGGV2(s:GaisenState){s.sggRescueEligible=false;s.sggLeft=16;s.medusa=0;s.medusaInfinite=false;}
function finishSGGV2(s:GaisenState,p:Spin,rng:Rng){
 const flag=p.model!.flag,wasMedusa=s.medusa>0||!!s.medusaInfinite,wasEx=s.ex;
 // 最後の時間停止Gも、減算前の区間で抽選する。
 if(wasMedusa){
  const reset=drawMedusaReset(flag,rng);
  if(reset){addLoop(s,roleLoopTable('sgg',s.frontMode??'low1',flag),rng);resetSGGV2(s);award(s,1);s.ex ||=reset==='ex';note(s,'巻き戻し · GG＋1、残り16Gへ');return;}
  if(!s.medusaInfinite)s.medusa--;
 }else{
  s.sggLeft--;
  // EX中との重複は未照合。試遊ではEXを優先し、新規の時間停止を抽選しない。
  if(!wasEx){
   const next=drawMedusa(flag,rng);
   if(next==='deferred')s.medusaDeferred=true;
   else if(next==='infinite'){s.sggRescueEligible=false;s.medusaInfinite=true;note(s,'時が止まる · 巻き戻しまで継続');}
   else if(next){s.sggRescueEligible=false;s.medusa=next;note(s,`時が止まる · ${next}Gの減算停止`);}
  }
 }
 // 昇格した同じゲームの役にEX抽選を重ねない。
 if(wasEx&&drawExStock(flag,rng)){award(s,1);addLoop(s,roleLoopTable('sgg',s.frontMode??'low1',flag,true),rng);note(s,'GG＋1');}
 if(s.sggLeft<=0&&s.medusa<=0&&!s.medusaInfinite){
  if(s.medusaDeferred){s.sggRescueEligible=false;s.medusaDeferred=false;s.medusaInfinite=true;note(s,'時が止まる · 巻き戻しまで継続');}
  else {
   if(s.sggRescueEligible===true)(s.sggLoops??=[]).push(drawSggRescueLoop(rng));
   s.sggRescueEligible=false;restore(s,s.sggReturn);
  }
 }
}
export const SCENARIOS=['normal','gg','god','gstop','sgg','ceiling','omen','medusa','sgg-ex','heaven','back-high','gstop-high']as const;
export type Scenario=typeof SCENARIOS[number];
/** 無料の場面確認。実際の成立率の統計には混ぜない。 */
export function scenario(setting:Setting,name:Scenario,version:RuleVersion=RULE_VERSION):GaisenState{const s=newGaisen(setting,version);s.sample=name!=='normal';if(name==='gg'){award(s,1);startGG(s);}if(name==='god'){s.display=['G','O','D'];s.gods=1;award(s,5);startGG(s);note(s,'場面確認 · 神降臨から開始');}if(name==='gstop')enterGstop(s);if(name==='sgg'){award(s,1);enterSGG(s);}if(version==='trial-2'&&(name==='medusa'||name==='sgg-ex')){award(s,1);enterSGG(s);s.sggLeft=8;s.sggRescueEligible=false;if(name==='medusa')s.medusa=10;else s.ex=true;note(s,'場面確認 · '+(name==='medusa'?'時間停止10Gから開始':'SGG-EXから開始'));}if(version==='trial-2'){if(name==='heaven')s.frontMode='short';if(name==='back-high')s.backMode='high';if(name==='gstop-high'){award(s,1);startGG(s);s.mirrorHigh=true;enterGstop(s);}}if(name==='ceiling')s.normalGames=1479;if(name==='omen'){beginOmen(s,5);s.phase='omen';note(s,'場面確認 · 前兆から開始（残り5G）');}return s;}

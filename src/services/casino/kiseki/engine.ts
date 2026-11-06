import type {Rng} from '../cards.js';
import {BET,UNIT,ROLES,drawRole,stopPlan,sggGames,type KisekiRole} from './rules.js';
import {kisekiDigits} from './presentation.js';
import {controlKisekiReel,automaticReelStart,type KisekiStop} from './reelControl.js';
export type Phase='normal'|'omen'|'gaia'|'gg'|'pgg'|'gzone'|'sgg'|'sgg-retry'|'zzone'|'zgame';
export const PHASE_NAMES:Record<Phase,string>={normal:'参道',omen:'神殿の前兆',gaia:'GAIA STAGE',gg:'GOD GAME',pgg:'PREMIUM GOD GAME',gzone:'G-ZONE',sgg:'SUPER GOD GAME','sgg-retry':'SGG · 引き戻し',zzone:'Z-ZONE',zgame:'Z-GAME'};
export type Win={kind:'gg'|'god'|'sgg'|'stock';added:number;set:number;ggGames:number;sggGames:number};
type Frame={phase:Phase;left:number;sggSet:number;sggStocks:number;sggHigh:boolean;zRun:number;zSeen:boolean};
export type Spin={role:KisekiRole;layout:KisekiRole;phase:Phase;order:number[];stops:number[];plan:number[];positions:(number|null)[];correct:boolean;loopAdded:number;timing?:boolean;reelStops?:(KisekiStop|null)[]};
export type KisekiState={version:'kiseki-1';setting:number;sample:boolean;balance:number;spins:number;input:number;output:number;phase:Phase;left:number;normalGames:number;ceiling:number;stocks:number;sets:number;gods:number;firsts:number;sggs:number;chainWon:number;lastPaid:number;lastRole:KisekiRole|null;lastLayout:KisekiRole;lastReplay:boolean;lastPositions:number[];lastCorrect:boolean;lastReelStops?:(KisekiStop|null)[];lastDigits?:number[];pending:Spin|null;history:string[];message:string;winEvent:Win|null;trail:('blue'|'yellow'|'white'|'gem'|'god'|'red'|'none')[];mode:'low'|'normal'|'high';gaiaBells:number;omenLeft:number;omenAwards:number;loops:number[];sggSet:number;sggStocks:number;sggHigh:boolean;zRun:number;zSeen:boolean;frames:Frame[]};
export const newKiseki=(setting=1):KisekiState=>({version:'kiseki-1',setting,sample:false,balance:100000,spins:0,input:0,output:0,phase:'normal',left:0,normalGames:0,ceiling:1480,stocks:0,sets:0,gods:0,firsts:0,sggs:0,chainWon:0,lastPaid:0,lastRole:null,lastLayout:'none',lastReplay:false,lastPositions:stopPlan('none'),lastCorrect:true,pending:null,history:[],message:'左からSTOP。実際の銭は使いません。',winEvent:null,trail:[],mode:'low',gaiaBells:0,omenLeft:0,omenAwards:0,loops:[],sggSet:0,sggStocks:0,sggHigh:false,zRun:0,zSeen:false,frames:[]});
export const protectedState=(s:KisekiState)=>s.phase!=='normal'||s.stocks>0||s.omenAwards>0||s.loops.length>0||s.frames.length>0;
function note(s:KisekiState,text:string){s.message=text;s.history.unshift(`${s.spins}G · ${text}`);s.history.length=Math.min(60,s.history.length);}
function grant(s:KisekiState,n:number){if(!s.stocks&&!s.sets)s.firsts++;s.stocks+=n;}
function startGG(s:KisekiState,pgg=false){if(s.stocks<=0)throw Error('GGの権利を確認してください。');s.stocks--;s.sets++;s.phase=pgg?'pgg':'gg';s.left=50;s.normalGames=0;s.ceiling=1480;note(s,`${pgg?'PGG':'GG'} 第${s.sets}セット · 50G`);}
function capture(s:KisekiState){if(!['normal','omen'].includes(s.phase))s.frames.push({phase:s.phase,left:s.left,sggSet:s.sggSet,sggStocks:s.sggStocks,sggHigh:s.sggHigh,zRun:s.zRun,zSeen:s.zSeen});}
function resume(s:KisekiState){const frame=s.frames.pop();if(frame){Object.assign(s,frame);note(s,`${PHASE_NAMES[s.phase]}の残りを再開`);}else if(s.stocks>0)startGG(s);else{s.phase='gzone';s.left=5;note(s,'G-ZONE · 最大5G');}}
function flushOmen(s:KisekiState){if(s.omenAwards){grant(s,s.omenAwards);s.omenAwards=0;s.omenLeft=0;}}
function startSggSet(s:KisekiState,role:KisekiRole,rng:Rng){s.sggSet++;s.left=sggGames(s.sggSet,role,rng);s.phase='sgg';if(s.left===100)s.sggStocks++;if(s.sggSet%5===0&&!s.sggHigh&&(s.sggSet>=20||rng(1000)<125)){s.loops.push(80);s.sggHigh=true;}note(s,`SGG 第${s.sggSet}セット · ${s.left}G`);}
/** 未公表のPGG/赤7ループ振分は、この試遊ではPGG80%・赤7は25%を採用。 */
export function lever(s:KisekiState,rng:Rng,forced?:KisekiRole,timing=false){
 if(s.pending)throw Error('先に3つのSTOPを押してください。');if(s.balance<BET)throw Error('試遊ポイントが足りません。');
 s.balance-=BET;s.input+=BET;s.spins++;s.lastPaid=0;s.winEvent=null;
 let loopAdded=0;s.loops=s.loops.slice().sort((a,b)=>a-b).filter(rate=>{if(rng(10000)>=rate*100)return false;grant(s,1);loopAdded++;return true;});
 const role=forced??drawRole(rng,['zzone','zgame'].includes(s.phase));
 const orders=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]],order=role==='bell'?orders[rng(6)]!.slice():role==='gaia'&&['normal','omen','gaia'].includes(s.phase)?[2,1,0]:[0,1,2];
 const layout=role==='gaia'&&!(['normal','omen','gaia'] as Phase[]).includes(s.phase)?'bell':role;
 s.pending={role,layout,phase:s.phase,order,stops:[],plan:stopPlan(layout),positions:[null,null,null],correct:true,loopAdded,timing,reelStops:[null,null,null]};s.message='3つのSTOPを押してください。';
}
export function navi(s:KisekiState):number[]|null{const p=s.pending;if(!p)return null;return p.role==='gaia'&&['normal','omen','gaia'].includes(p.phase)||p.role==='bell'&&!['normal','omen','gaia'].includes(p.phase)?p.order.slice():null;}
export function stop(s:KisekiState,index:number,rng:Rng,input?:number):boolean{
 const p=s.pending;if(!p||!Number.isInteger(index)||index<0||index>2||p.stops.includes(index))throw Error('このSTOPは押せません。');
 if(input!==undefined&&(!Number.isInteger(input)||input<0||input>=20))throw Error('停止位置は0〜19です。');
 if(p.role==='bell'&&index!==p.order[p.stops.length])p.correct=false;
 if(p.timing){const result=controlKisekiReel(p.correct?p.layout:'none',index,p.positions,input,automaticReelStart(s.spins,index));(p.reelStops??=[null,null,null])[index]=result;p.positions[index]=result.position;}
 else p.positions[index]=p.correct&&p.layout!=='none'?p.plan[index]!:controlKisekiReel('none',index,p.positions,undefined,automaticReelStart(s.spins,index)).position;p.stops.push(index);if(p.stops.length<3)return false;
 const before={sets:s.sets,stocks:s.stocks,gods:s.gods,sggs:s.sggs};
 s.lastDigits=kisekiDigits(s.spins,p.positions,false,index,p.correct?p.role:'none') as number[];s.lastReelStops=p.reelStops?.map(v=>v?{...v}:null);s.lastPositions=p.positions as number[];s.lastRole=p.role;s.lastLayout=p.layout;s.lastCorrect=p.correct;s.lastReplay=['blue','middleBlue','fake'].includes(p.role);
 // AT中のガイアベルは左からの下段黄7（15枚）表示へ変えるが、停止済みの帯は書き換えない。
 const paid=p.correct?(p.role==='gaia'&&p.layout==='bell'?15:ROLES[p.role].units)*UNIT:0;s.lastPaid=paid;s.balance+=paid;s.output+=paid;if(!['normal','omen','gaia'].includes(p.phase))s.chainWon+=paid-BET;
 s.pending=null;
 note(s,`${ROLES[p.role].name} · 戻り${paid}ポイント${p.correct?'':'（押し順不一致）'}`);
 const mark:KisekiState['trail'][number]=!p.correct?'none':p.role==='god'?'god':p.role==='red'?'red':p.role==='gaia'?'white':['bell','diagonal','middleGold','small'].includes(p.role)?'yellow':p.role==='sp'||p.role==='fake'?'gem':['blue','middleBlue'].includes(p.role)?'blue':'none';
 s.trail=[...s.trail,mark].slice(-5);
 if(p.role==='god'){
  flushOmen(s);capture(s);s.gods++;grant(s,4);s.loops.push(80);startGG(s,true);note(s,'GOD · PGG50G＋GG3ストック、ループストック獲得');
 }else if(p.role==='red'){
  flushOmen(s);capture(s);grant(s,1);s.loops.push(25);s.sggs++;s.sggSet=0;s.sggStocks=0;s.sggHigh=false;startSggSet(s,'red',rng);
 }else{
  if(p.role==='sp'&&['normal','omen','gaia','gg','pgg'].includes(p.phase)&&rng(2)===0){grant(s,1);s.loops.push(80);if(['normal','omen','gaia'].includes(p.phase)){flushOmen(s);startGG(s);}if(['gg','pgg'].includes(p.phase))advance(s,p,rng);note(s,'SP役 · GG1ストック＋80%ループ獲得');}
  else advance(s,p,rng);
 }
 const added=Math.max(0,s.stocks+s.sets-before.stocks-before.sets)+p.loopAdded;
 const kind=s.gods>before.gods?'god':s.sggs>before.sggs?'sgg':s.sets>before.sets?'gg':added?'stock':null;
 s.winEvent=kind?{kind,added,set:s.sets,ggGames:['gg','pgg'].includes(s.phase)?s.left:0,sggGames:s.phase==='sgg'?s.left:0}:null;
 return true;
}
function advance(s:KisekiState,p:Spin,rng:Rng){
 const r=p.role;
 if(['normal','omen','gaia'].includes(p.phase)){
  s.normalGames++;
  if(s.omenAwards>0){if(--s.omenLeft<=0){flushOmen(s);startGG(s);}return;}
  if(s.normalGames>=s.ceiling){grant(s,1);const n=rng(1000);s.loops.push(n<167?1:n<334?25:n<501?50:n<668?80:1);if(n>=668){s.phase='zzone';s.left=5;s.zRun=0;s.zSeen=false;note(s,'天井 · GG権利＋Z-ZONE');}else startGG(s);return;}
  if(r==='gaia'&&++s.gaiaBells%5===0&&rng(4)===0){s.phase='gaia';s.left=10;note(s,'ガイアステージ · GG高確率へ');return;}
  // 表裏モード・ガイア規定回数の完全な公開表は未照合。ここは明示した試遊用の暫定抽選。
  if(['diagonal','middleGold','middleBlue'].includes(r)&&rng(4)===0)s.mode=s.mode==='low'?'normal':'high';
  else if(r==='none'&&rng(20)===0)s.mode='low';
  const base=[533,420,496,338,455,295][s.setting-1]!,factor=s.mode==='high'?4:s.mode==='normal'?2:1;
  const chance=r==='sp'?0:p.phase==='gaia'?.2:r==='middleGold'?.2:r==='diagonal'?.05:r==='middleBlue'?.025:factor/base;
  if(rng(1000000)<chance*1000000){if(p.phase==='gaia'&&rng(2)===0){grant(s,1);s.phase='zzone';s.left=5;s.zRun=0;s.zSeen=false;note(s,'ガイアからZ-ZONE');}else{s.omenAwards++;s.omenLeft=8;s.phase='omen';note(s,'神殿に光が集まる…');}return;}
  if(p.phase==='gaia'&&--s.left<=0){s.phase='normal';note(s,'ガイアステージ終了');}
  return;
 }
 if(['gg','pgg'].includes(p.phase)){
  const rate=r==='middleGold'?.102:r==='diagonal'?.012:0;if(rng(10000)<rate*10000)grant(s,1);
  if(--s.left<=0){if(s.frames.length)resume(s);else{s.phase='gzone';s.left=5;note(s,'G-ZONE · 最大5G');}}return;
 }
 if(p.phase==='gzone'){
  if(--s.left<=0){if(s.stocks>0)startGG(s);else{s.phase='normal';s.sets=0;note(s,'通常へ戻ります。');}}return;
 }
 if(p.phase==='sgg'){
  if(r==='sp')s.sggStocks+=3;else if(rng(1000)<(r==='middleGold'?500:['diagonal','middleBlue'].includes(r)?102:0))s.sggStocks++;
  if(--s.left<=0){s.phase='sgg-retry';s.left=3;note(s,'SGG · 3Gの引き戻し');}return;
 }
 if(p.phase==='sgg-retry'){
  if(s.sggStocks>0){s.sggStocks--;startSggSet(s,'gaia',rng);return;}
  if(['gaia','fake','middleBlue','diagonal','middleGold','sp'].includes(r)||rng(1000)<344){startSggSet(s,r,rng);return;}
  if(--s.left<=0)resume(s);return;
 }
 if(p.phase==='zzone'){
  if(p.correct&&['bell','small','diagonal','middleGold'].includes(r)){s.zSeen=true;s.zRun=['diagonal','middleGold'].includes(r)?5:s.zRun+1;if(s.zRun>=5){grant(s,1);s.phase='zgame';note(s,'Z-GAME · 黄7でGG上乗せ');}return;}
  s.zRun=0;if(s.zSeen)resume(s);else if(--s.left<=0){if(rng(2)===0)s.loops.push(80);resume(s);}return;
 }
 if(p.phase==='zgame'){
  if(p.correct&&['bell','small','diagonal','middleGold'].includes(r)){grant(s,1);note(s,'Z-GAME · GG＋1');}else if(r==='none'||r==='blue'||r==='middleBlue')resume(s);
 }
}
export const SCENARIOS=['normal','gg','pgg','sgg','sgg-retry','gaia','zzone','zgame','ceiling'] as const;
export function scenario(setting:number,name:string):KisekiState{
 if(!(SCENARIOS as readonly string[]).includes(name))throw Error('場面を選び直してください。');
 const s=newKiseki(setting);s.sample=name!=='normal';
 if(name==='gg'||name==='pgg'){grant(s,name==='pgg'?4:1);startGG(s,name==='pgg');}
 if(name==='sgg'||name==='sgg-retry'){grant(s,1);s.phase=name;s.left=name==='sgg'?10:3;s.sggSet=1;s.sggs=1;}
 if(name==='gaia'){s.phase='gaia';s.left=10;}
 if(name==='zzone'||name==='zgame'){grant(s,1);s.phase=name;s.left=5;s.zRun=name==='zgame'?5:0;s.zSeen=name==='zgame';}
 if(name==='ceiling')s.normalGames=1479;
 return s;
}

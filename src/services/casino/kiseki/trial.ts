import {eq} from 'drizzle-orm';
import type {Db} from '../../../db/client.js';
import {settings} from '../../../db/schema.js';
import {audit} from '../../audit.js';
import {cryptoRng,type Rng} from '../cards.js';
import {newKiseki,protectedState,lever,stop,scenario,SCENARIOS,navi,type KisekiState} from './engine.js';
import {rows} from './rules.js';
export const TRIAL_KEY='casino.kisekiTrial.v1';
export class KisekiError extends Error{constructor(message:string,public status:400|403|409=400){super(message);}}
type Stat={day:string;spins:number;input:number;output:number;god:number;gg:number;sgg:number;sample:boolean;resumed:boolean;graph:number[]};
type Machine={id:number;state:KisekiState;owner:string|null;ownerName:string|null;lastAction:number;reservedSetting:number|null;reservedCeiling:number|null;base:KisekiState|null;checkpoint:KisekiState|null;stat:Stat;lastScenario:string};
type Player={points:number;saved:KisekiState|null};
export type Floor={version:'kiseki-floor-1';revision:number;machines:Machine[];players:Record<string,Player>};
const day=(n:number)=>new Date(n+9*3600000).toISOString().slice(0,10);
const stat=(n:number):Stat=>({day:day(n),spins:0,input:0,output:0,god:0,gg:0,sgg:0,sample:false,resumed:false,graph:[0]});
export const freshFloor=(n:number):Floor=>({version:'kiseki-floor-1',revision:0,machines:[1,1,2,2,4].map((setting,i)=>({id:i+1,state:newKiseki(setting),owner:null,ownerName:null,lastAction:0,reservedSetting:null,reservedCeiling:null,base:null,checkpoint:null,stat:stat(n),lastScenario:'自然抽選（試遊用の暫定部分あり）'})),players:{}});
const player=(f:Floor,id:string)=>f.players['u:'+id]??={points:100000,saved:null};
function consume(m:Machine){m.state=newKiseki(m.reservedSetting!);m.state.ceiling=m.reservedCeiling??1480;m.reservedSetting=null;m.reservedCeiling=null;}
/** 受入台の通常状態を復元しても、いま確定した払出と停止窓は消さない。 */
function carryResult(from:KisekiState,to:KisekiState){to.lastPaid=from.lastPaid;to.lastRole=from.lastRole;to.lastLayout=from.lastLayout;to.lastReplay=from.lastReplay;to.lastCorrect=from.lastCorrect;to.lastPositions=from.lastPositions.slice();to.message=from.message;to.winEvent=from.winEvent;}
function apply(m:Machine){if(m.reservedSetting!==null&&m.owner===null&&!protectedState(m.state)&&!m.state.pending)consume(m);}
function release(f:Floor,m:Machine){if(!m.owner)return;const p=player(f,m.owner);p.points=m.state.balance;
 if(protectedState(m.state)||m.base||m.state.pending){if(p.saved)throw new KisekiError('保存状態を確認してください。',409);p.saved=structuredClone(m.state);m.state=m.base??m.checkpoint??newKiseki(m.state.setting);m.base=null;m.checkpoint=null;}
 m.owner=null;m.ownerName=null;m.lastAction=0;apply(m);
}
export function expire(f:Floor,n:number){for(const m of f.machines){if(m.stat.day!==day(n)){m.stat=stat(n);f.revision++;}if(m.owner!==null&&n-m.lastAction>=(protectedState(m.state)?3600000:600000)){release(f,m);f.revision++;}}}
export async function readTrial(db:Db,now:Date):Promise<Floor>{const [r]=await db.select().from(settings).where(eq(settings.key,TRIAL_KEY));const f=r?structuredClone(r.value) as Floor:freshFloor(now.getTime());if(f.version!=='kiseki-floor-1')throw new KisekiError('軌跡版の保存形式を確認してください。',409);expire(f,now.getTime());return f;}
export type Action={action:string;machine:number;revision:number;index?:number;setting?:number;scenario?:string};
export function act(f:Floor,id:string,name:string,a:Action,now:number,rng:Rng=cryptoRng){
 expire(f,now);if(!Number.isSafeInteger(a.revision)||a.revision!==f.revision)throw new KisekiError('表示が更新されています。最新の画面を確認してください。',409);
 const m=f.machines.find(m=>m.id===a.machine);if(!m)throw new KisekiError('台を選び直してください。');
 if(a.action==='setting'){if(!Number.isInteger(a.setting)||a.setting!<1||a.setting!>6)throw new KisekiError('設定は1〜6です。');m.reservedSetting=a.setting!;const n=rng(1000);m.reservedCeiling=n<152?510:n<355?1000:1480;apply(m);f.revision++;return;}
 const p=player(f,id);
 if(a.action==='seat'){if(m.owner!==null||f.machines.some(m=>m.owner===id))throw new KisekiError('すでに着席中です。',409);m.owner=id;m.ownerName=name;m.lastAction=now;if(p.saved){m.base=structuredClone(m.state);m.state=p.saved;p.saved=null;m.stat.resumed=true;m.stat.sample ||=m.state.sample;}m.state.balance=p.points;f.revision++;return;}
 if(m.owner!==id)throw new KisekiError('着席した本人だけが操作できます。',403);
 const old={phase:m.state.phase,spins:m.state.spins,input:m.state.input,output:m.state.output,gods:m.state.gods,firsts:m.state.firsts,sggs:m.state.sggs};
 try{switch(a.action){
  case 'leave':if(m.state.pending&&!protectedState(m.state))throw new KisekiError('先に3つのSTOPを押してください。');release(f,m);break;
  case 'lever':if(!protectedState(m.state)&&!m.state.pending)m.checkpoint=structuredClone(m.state);lever(m.state,rng);m.lastAction=now;break;
  case 'stop':if(stop(m.state,a.index!,rng))m.checkpoint=null;m.lastAction=now;break;
  case 'refill':if(m.state.pending)throw new KisekiError('STOP後に補充してください。');if(m.state.balance>10000000)throw new KisekiError('試遊ポイントは十分にあります。');m.state.balance+=100000;p.points=m.state.balance;break;
  case 'scenario':if(!(SCENARIOS as readonly string[]).includes(a.scenario!)||m.state.pending||m.base)throw new KisekiError('回転中・保存分の再開中は場面を変更できません。');{const balance=m.state.balance;m.state=scenario(m.state.setting,a.scenario!);m.state.balance=balance;m.stat=stat(now);m.stat.sample=m.state.sample;m.lastScenario='場面確認：'+a.scenario;m.lastAction=now;}break;
  default:throw new KisekiError('操作を選び直してください。');
 }}catch(e){if(e instanceof KisekiError)throw e;throw new KisekiError(e instanceof Error?e.message:'操作できませんでした。');}
 if(a.action==='lever'||a.action==='stop'){
  const s=m.state,t=m.stat;t.spins+=s.spins-old.spins;t.input+=s.input-old.input;t.output+=s.output-old.output;t.god+=s.gods-old.gods;t.gg+=s.firsts-old.firsts;t.sgg+=s.sggs-old.sggs;p.points=s.balance;
  if(!s.pending){t.graph.push((t.output-t.input)/10);t.graph=t.graph.slice(-200);if(!protectedState(s)){if(m.base){m.state=m.base;m.base=null;m.state.balance=p.points;carryResult(s,m.state);}if(m.reservedSetting!==null&&!(['normal','omen','gaia'] as string[]).includes(old.phase)){consume(m);m.state.balance=p.points;carryResult(s,m.state);}}}
 }
 f.revision++;
}
export async function writeTrial(db:Db,id:string,name:string,a:Action,now:Date,rng:Rng=cryptoRng){await db.transaction(async tx=>{
 await tx.insert(settings).values({key:TRIAL_KEY,value:freshFloor(now.getTime()),updatedBy:id,updatedAt:now}).onConflictDoNothing();
 const [r]=await tx.select().from(settings).where(eq(settings.key,TRIAL_KEY)).for('update');const f=structuredClone(r!.value) as Floor;if(f.version!=='kiseki-floor-1')throw new KisekiError('保存形式を確認してください。',409);
 act(f,id,name,a,now.getTime(),rng);await tx.update(settings).set({value:f,updatedBy:id,updatedAt:now}).where(eq(settings.key,TRIAL_KEY));
 await audit(tx,{actorId:id,action:'casino.kisekiTrial.'+a.action,detail:{machine:a.machine,revision:f.revision,free:true,version:'kiseki-1'},via:'web'});
 });}
/** 公開済みの停止位置・残りGだけ返す。役/モード/ループ率/未停止予定位置は渡さない。 */
export function trialView(f:Floor,id:string){const own=f.machines.find(m=>m.owner===id),p=f.players['u:'+id],s=own?.state;
 return {revision:f.revision,points:s?.balance??p?.points??100000,saved:!!p?.saved,machines:f.machines.map(m=>({id:m.id,ownerName:m.ownerName,mine:m.owner===id,occupied:m.owner!==null,setting:m.state.setting,reservedSetting:m.reservedSetting,stat:m.stat,lastScenario:m.lastScenario})),own:own&&s?{id:own.id,phase:s.phase,left:['normal','omen','zgame'].includes(s.phase)?null:s.left,normalGames:s.normalGames,stocks:s.stocks,sets:s.sets,sggSet:s.sggSet,sggStocks:s.sggStocks,zRun:s.zRun,spins:s.spins,lastPaid:s.lastPaid,lastRole:s.pending?null:s.lastRole,lastLayout:s.pending?null:s.lastLayout,lastReplay:!s.pending&&s.lastReplay,lastCorrect:s.pending?true:s.lastCorrect,chainWon:s.chainWon,history:s.history.slice(),message:s.message,trail:s.trail.slice(),winEvent:s.pending?null:s.winEvent,resumed:!!own.base,spinning:!!s.pending,stopped:s.pending?.stops.slice()??[],positions:s.pending?s.pending.positions.slice():s.lastPositions.slice(),reels:(s.pending?s.pending.positions:s.lastPositions).map((p,i)=>p===null?null:rows(i,p)),navi:navi(s)}:null};
}
export type View=ReturnType<typeof trialView>;

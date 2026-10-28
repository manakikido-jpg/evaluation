import {eq} from 'drizzle-orm';
import type {Db} from '../../../db/client.js';
import {settings} from '../../../db/schema.js';
import {audit} from '../../audit.js';
import {cryptoRng,type Rng} from '../cards.js';
import {isProtected,lever,newGaisen,scenario,SCENARIOS,stop,type GaisenState,type Setting,type Scenario} from './engine.js';

export const TRIAL_KEY='casino.gaisenTrial.v1';
const INITIAL:Setting[]=[1,1,2,2,4];
type Stat={day:string;spins:number;input:number;output:number;god:number;gg:number;sgg:number;resumed:boolean;sample:boolean;graph:number[]};
export type TrialMachine={id:number;state:GaisenState;owner:string|null;ownerName:string|null;lastAction:number;reservedSetting:Setting|null;base:GaisenState|null;checkpoint:GaisenState|null;stat:Stat;lastScenario:string};
type Player={points:number;saved:GaisenState|null;history:string[]};
export type TrialFloor={v:1;revision:number;machines:TrialMachine[];players:Record<string,Player>};
export class TrialError extends Error{constructor(message:string,public status:400|403|409=400){super(message);}}
const day=(now:number)=>new Date(now+9*3600000).toISOString().slice(0,10);
const stat=(now:number):Stat=>({day:day(now),spins:0,input:0,output:0,god:0,gg:0,sgg:0,resumed:false,sample:false,graph:[0]});
export const freshFloor=(now:number):TrialFloor=>({v:1,revision:0,machines:INITIAL.map((setting,i)=>({id:i+1,state:newGaisen(setting),owner:null,ownerName:null,lastAction:0,reservedSetting:null,base:null,checkpoint:null,stat:stat(now),lastScenario:'自然抽選（暫定）'})),players:{}});
const playerKey=(id:string)=>'u:'+id;
function player(f:TrialFloor,id:string):Player{return f.players[playerKey(id)]??={points:100000,saved:null,history:[]};}
function applySetting(m:TrialMachine){if(m.reservedSetting!==null&&m.owner===null&&!isProtected(m.state)&&!m.state.pending){m.state=newGaisen(m.reservedSetting);m.reservedSetting=null;}}
function release(f:TrialFloor,m:TrialMachine){
 if(m.owner===null)return;
 const p=player(f,m.owner);p.points=m.state.balance;p.history=m.state.history.slice();
 if(isProtected(m.state)||m.base||m.state.pending){
  if(p.saved)throw new TrialError('保存状態が重複しています。運営が確認してください。',409);
  p.saved=structuredClone(m.state);
  m.state=m.base??m.checkpoint??newGaisen(m.state.setting);m.base=null;m.checkpoint=null;
 }
 m.owner=null;m.ownerName=null;m.lastAction=0;applySetting(m);
}
export function expireFloor(f:TrialFloor,now:number){for(const m of f.machines){
 if(m.stat.day!==day(now)){m.stat=stat(now);f.revision++;}
 if(m.owner!==null&&now-m.lastAction>=(isProtected(m.state)?3600000:600000)){
  // 通常の回転中は台に残す。ボーナス中は停止済み位置も本人用に退避する。
  release(f,m);f.revision++;
 }
}}
export async function readTrial(db:Db,now:Date):Promise<TrialFloor>{const [r]=await db.select().from(settings).where(eq(settings.key,TRIAL_KEY));const f=r?structuredClone(r.value)as TrialFloor:freshFloor(now.getTime());expireFloor(f,now.getTime());return f;}
export type TrialAction={action:string;machine:number;revision:number;index?:number;setting?:number;scenario?:string};
export function actTrial(f:TrialFloor,uid:string,name:string,a:TrialAction,now:number,rng:Rng=cryptoRng):void{
 expireFloor(f,now);if(!Number.isSafeInteger(a.revision)||a.revision!==f.revision)throw new TrialError('表示が更新されています。最新の画面を確認してください。',409);
 const m=f.machines.find(x=>x.id===a.machine);if(!m)throw new TrialError('台を選び直してください。');
 if(a.action==='setting'){
  if(!Number.isInteger(a.setting)||a.setting!<1||a.setting!>6)throw new TrialError('設定は1〜6です。');
  m.reservedSetting=a.setting as Setting;applySetting(m);f.revision++;return;
 }
 const p=player(f,uid),mine=f.machines.find(x=>x.owner===uid);
 if(a.action==='seat'){
  if(m.owner!==null||mine)throw new TrialError('すでに着席中です。',409);
  m.owner=uid;m.ownerName=name;m.lastAction=now;
  if(p.saved){m.base=structuredClone(m.state);m.state=p.saved;p.saved=null;m.stat.resumed=true;m.stat.sample ||=m.state.sample;}
  m.state.balance=p.points;f.revision++;return;
 }
 if(m.owner!==uid)throw new TrialError('着席した本人だけが操作できます。',403);
 const before={spins:m.state.spins,input:m.state.input,output:m.state.output,god:m.state.gods,gg:m.state.firsts,sgg:m.state.sggs,phase:m.state.phase};
 switch(a.action){
  case 'leave':if(m.state.pending&&!isProtected(m.state))throw new TrialError('先に3つのSTOPを押してください。');release(f,m);break;
  case 'lever':if(!isProtected(m.state)&&!m.state.pending)m.checkpoint=structuredClone(m.state);lever(m.state,rng);m.lastAction=now;break;
  case 'stop':if(stop(m.state,a.index!,rng))m.checkpoint=null;m.lastAction=now;break;
  case 'scenario':{
   if(!SCENARIOS.includes(a.scenario as Scenario))throw new TrialError('場面を選び直してください。');
   if(m.state.pending||m.base)throw new TrialError('回転中・保存分の再開中は場面を切り替えられません。');
   const points=m.state.balance;m.state=scenario(m.state.setting,a.scenario as Scenario);m.state.balance=points;m.lastScenario='場面確認：'+a.scenario;m.stat=stat(now);m.stat.sample=m.state.sample;m.lastAction=now;f.revision++;return;
  }
  case 'refill':if(m.state.balance>10000000)throw new TrialError('試遊ポイントは十分にあります。');if(m.state.pending)throw new TrialError('STOP後に補充してください。');m.state.balance+=100000;break;
  default:throw new TrialError('操作を選び直してください。');
 }
 if(a.action==='lever'||a.action==='stop'){
  const s=m.state;const t=m.stat;t.spins+=s.spins-before.spins;t.input+=s.input-before.input;t.output+=s.output-before.output;t.god+=s.gods-before.god;t.gg+=s.firsts-before.gg;t.sgg+=s.sggs-before.sgg;
  if(!s.pending){t.graph.push((t.output-t.input)/10);t.graph=t.graph.slice(-200);}
  p.points=s.balance;p.history=s.history.slice();
  if(!s.pending&&!isProtected(s)){
   // 再開分の終了で受入台を復元。通常遊技を保存分の状態で続けない。
   if(m.base){m.state=m.base;m.base=null;m.state.balance=p.points;}
   // 通常時の変更は離席後、ボーナス後の予約はここで反映する。
   if(a.action==='stop'&&before.phase!=='normal'&&m.reservedSetting!==null){const setting=m.reservedSetting;m.reservedSetting=null;m.state=newGaisen(setting);m.state.balance=p.points;}
  }
 }
 f.revision++;
}
export async function writeTrial(db:Db,uid:string,name:string,a:TrialAction,now:Date,rng:Rng=cryptoRng):Promise<void>{
 await db.transaction(async tx=>{
  await tx.insert(settings).values({key:TRIAL_KEY,value:freshFloor(now.getTime()),updatedBy:uid,updatedAt:now}).onConflictDoNothing();
  const [r]=await tx.select().from(settings).where(eq(settings.key,TRIAL_KEY)).for('update');
  const f=structuredClone(r!.value)as TrialFloor;
  try{actTrial(f,uid,name,a,now.getTime(),rng);}catch(e){if(e instanceof TrialError)throw e;throw new TrialError(e instanceof Error?e.message:'操作できませんでした。');}
  await tx.update(settings).set({value:f,updatedBy:uid,updatedAt:now}).where(eq(settings.key,TRIAL_KEY));
  await audit(tx,{actorId:uid,action:'casino.gaisenTrial.'+a.action,detail:{machine:a.machine,revision:f.revision,free:true},via:'web'});
 });
}
/** 自分の保存分だけ返す。未停止の役/内部モード/次の押し順をHTMLへ出さない。 */
export function trialView(f:TrialFloor,uid:string){const own=f.machines.find(m=>m.owner===uid);const p=f.players[playerKey(uid)];return {revision:f.revision,points:own?.state.balance??p?.points??100000,saved:!!p?.saved,machines:f.machines.map(m=>({id:m.id,ownerName:m.ownerName,mine:m.owner===uid,occupied:m.owner!==null,setting:m.state.setting,reservedSetting:m.reservedSetting,lastAction:m.lastAction,protected:isProtected(m.state),stat:m.stat,lastScenario:m.lastScenario})),own:own?{id:own.id,phase:own.state.phase,ggLeft:own.state.ggLeft,sets:own.state.sets,stocks:own.state.stocks,gstopLeft:own.state.gstopLeft,sggLeft:own.state.sggLeft,medusa:own.state.medusa,ex:own.state.ex,resumed:!!own.base,normalGames:own.state.normalGames,lastPaid:own.state.lastPaid,chainWon:own.state.chainWon,message:own.state.message,history:own.state.history,display:own.state.pending?own.state.pending.symbols:own.state.display,stopped:own.state.pending?.stops??[],spinning:!!own.state.pending,navi:own.state.pending?.role==='bell'&&['gg','sgg','gzone'].includes(own.state.phase)?own.state.pending.order:null}:null};}
export type TrialView=ReturnType<typeof trialView>;

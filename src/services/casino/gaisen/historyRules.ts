import type {Rng} from '../cards.js';
import type {GaisenState,Spin} from './engine.js';
import {phaseOutcome} from './phaseRules.js';

export type HistorySymbol='blue'|'yellow'|'white'|'gem'|'red'|'god'|'none';
export const HISTORY_NAMES:Record<HistorySymbol,string>={blue:'青7',yellow:'黄7',white:'白点',gem:'宝石',red:'赤7',god:'GOD',none:'―'};
export type HistoryAward={gg:number;gstop:number;reason:string};
/** 成立した役だけを記録。押し順ミスを当選アイコンとして数えない。 */
export function historySymbol(p:Spin):HistorySymbol{
 const result=phaseOutcome(p),flag=p.model!.flag;
 if(result.role==='god')return 'god';
 if(result.role==='red7')return 'red';
 if(!result.correct)return result.replay?'blue':'none';
 if(flag==='fake'||flag==='reverseFake'||flag==='special')return 'gem';
 if(flag==='blue'||flag==='middleBlue')return 'blue';
 if(result.mark==='yellow')return 'yellow';
 return flag==='small'?'white':'none';
}
/** 一つの成立役につき最も強い履歴条件を一度だけ判定。資料の概数を使う。 */
export function historyAward(s:Pick<GaisenState,'phase'|'gstopReturn'|'setting'>,trail:HistorySymbol[],rng:Rng):HistoryAward{
 const last=trail.at(-1),window=trail.slice(-5),empty={gg:0,gstop:0,reason:''};
 if(!last||last==='none')return empty;
 const run=window.slice().reverse().findIndex(x=>x!==last),streak=run<0?window.length:run;
 const count=window.filter(x=>x===last).length;
 const phase=s.phase==='gstop'?s.gstopReturn:s.phase,normal=['normal','omen','gzone'].includes(phase);
 const chance=(basisPoints:number)=>basisPoints>=10000||rng(10000)<basisPoints;
 const result=(gg:number,gstop:number,reason:string)=>({gg,gstop,reason});
 if(last==='blue'){
  if(normal){
   if(streak>=5)return result(1,1,'青7・5連');
   if(streak===4)return result(0,1,'青7・4連');
   if(streak===3&&chance([500,500,750,1250,1500,2000][s.setting-1]!))return result(0,1,'青7・3連');
  }else if(streak>=5)return phase==='sgg'?result(1,0,'青7・5連'):result(0,1,'青7・5連');
 }
 if(last==='yellow'){
  if(streak>=5||normal&&streak===4)return result(1,0,`黄7・${streak}連`);
  if(normal&&streak===3&&chance([2000,2000,2250,2500,3000,3330][s.setting-1]!))return result(1,0,'黄7・3連');
 }
 if(last==='white'&&phase==='gg'&&streak>=5&&chance(105))return result(0,1,'白点・5連');
 if(last==='gem'&&count>=2&&chance(count>=4?10000:count===3?5000:1250))return result(1,0,`5G以内の宝石${count}個`);
 if(last==='god'&&count>=2)return result(1,0,`5G以内のGOD${count}個`);
 if(last==='red'&&phase==='sgg'&&count>=2&&chance(streak>=2||count>=3?10000:2500))return result(1,0,streak>=2?'赤7・2連以上':`5G以内の赤7${count}個`);
 return empty;
}

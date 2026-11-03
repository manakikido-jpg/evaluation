import type {Rng} from '../cards.js';
import type {Phase} from './engine.js';
import type {FrontMode,ModeContext} from './modeRules.js';
import {drawWeighted,percentWeights} from './modeRules.js';
import type {PhaseFlag} from './phaseRules.js';
import type {HistorySymbol} from './historyRules.js';
import type {SggLoopRate} from './sggLoopRules.js';

const rates:SggLoopRate[]=[1,25,50,67,75];
// 頂の小数第2位までの表を採用。丸め差のみ最大項目へ戻す。
export const LOOP_WEIGHTS=[
 [87.50,8.79,3.12,.39,.20],[75,17.58,6.25,.78,.39],[50,35.16,12.50,1.56,.78],
 [0,75,17.19,6.25,1.56],[0,0,75,15.62,9.38],[0,0,0,75,25],[0,0,0,0,100],
 [99.46,0,.39,.10,.05],[0,87.50,11.91,.39,.20],[0,75,21.09,3.13,.78],[0,82.81,12.50,3.13,1.56],
].map(values=>percentWeights(values).map((weight,i)=>[rates[i]!,weight] as const));
export function drawLoop(table:number,rng:Rng):SggLoopRate{return drawWeighted(LOOP_WEIGHTS[table]!,rng);}
export const normalLoopTable=(m:FrontMode)=>m==='short'?8:m==='long'?9:m==='super'?4:0;
export function roleLoopTable(ctx:ModeContext,m:FrontMode,f:PhaseFlag,ex=false):number{
 if(f==='special')return 5;
 if(ctx==='normal')return normalLoopTable(m);
 if(['none','coinA','coinB','coinC'].includes(f))return 7;
 if(['middleBlue','yellowLeft','yellowCommon','yellowMiddle'].includes(f))return 1;
 if(ctx==='sgg'&&(f==='bell'||ex&&f==='blue'))return 7;
 return 0;
}
/** 当選した履歴だけに使う。履歴による当選可否はhistoryRulesで一度だけ判定。 */
export function historyLoopTable(phase:Phase,back:Phase,history:HistorySymbol[]):number{
 const p=phase==='gstop'?back:phase,normal=['normal','omen','gzone'].includes(p),last=history.at(-1);
 const count=history.filter(x=>x===last).length;
 const end=history.slice().reverse().findIndex(x=>x!==last),streak=end<0?history.length:end;
 if(last==='gem')return p==='sgg'?(count>=5?4:count===4?2:0):(count>=5?6:count===4?4:count===3?2:0);
 if(last==='red'&&p==='sgg')return history.at(-2)==='red'?2:count>=3?1:0;
 if(last==='yellow')return normal?(streak>=5?5:streak===4?3:0):7;
 if(last==='blue')return normal?0:7;
 return 0;
}

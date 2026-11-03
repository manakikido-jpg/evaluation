import type {Rng} from '../cards.js';
import type {Setting} from './engine.js';
import type {PhaseFlag} from './phaseRules.js';

export const FRONT_MODES=['low1','low2','normal','prepare','v','short','long','super'] as const;
export type FrontMode=typeof FRONT_MODES[number];
export type BackMode='low'|'prepare'|'high';
export type ModeContext='normal'|'omen'|'gg'|'gstop'|'sgg';
export const MODE_DRAW_SIZE=100000;
export type ModeRow=readonly (readonly [FrontMode,number])[];
type PercentRow=Partial<Record<FrontMode,number>>;
/** 公開値の丸め差だけを最大の項目へ戻す。誤記を自動で丸め込まない。 */
export function percentWeights(values:readonly number[]):number[]{
 const weights=values.map(n=>Math.round(n*1000));
 const difference=MODE_DRAW_SIZE-weights.reduce((a,b)=>a+b,0);
 if(weights.some(n=>n<0)||Math.abs(difference)>150)throw Error('抽選表の合計を確認してください。');
 const largest=weights.indexOf(Math.max(...weights));weights[largest]!+=difference;return weights;
}
function row(values:PercentRow):ModeRow{const keys=Object.keys(values) as FrontMode[];const weights=percentWeights(keys.map(k=>values[k]!));return keys.map((k,i)=>[k,weights[i]!] as const);}
export function drawWeighted<T>(rows:readonly (readonly [T,number])[],rng:Rng):T{
 let ticket=rng(MODE_DRAW_SIZE);for(const [value,weight] of rows){if(ticket<weight)return value;ticket-=weight;}
 throw Error('抽選の乱数が範囲外です。');
}
const stay=(mode:FrontMode):PercentRow=>({[mode]:100});
const pick=(setting:Setting,a:number,b:number,c:number)=>setting===3?b:setting===5?c:a;
const blank=(f:PhaseFlag)=>['none','coinA','coinB','coinC','blue'].includes(f);
const oneCoin=(f:PhaseFlag)=>['none','coinA','coinB','coinC'].includes(f);
const yellow=(f:PhaseFlag)=>f==='yellowLeft'||f==='yellowCommon';
function transitions(ctx:ModeContext,m:FrontMode,s:Setting,f:PhaseFlag):PercentRow{
 const special=f==='special',red=f==='red'||f==='god';
 if(ctx==='sgg'){
  if(m==='super')return ['blue','bell','small'].includes(f)?{long:3.91,super:96.09}:stay(m);
  return special?{long:50,super:50}:stay(m);
 }
 if(special)return m==='long'||m==='super'?{super:100}:{long:50,super:50};
 if(red){
  if(m==='low1'||m==='low2')return {[m]:75,normal:24.22,short:.78};
  if(m==='normal')return {normal:98.44,short:1.56};
  if(m==='prepare')return {prepare:96.88,short:3.13};
  if(m==='v')return ctx==='gstop'?stay(m):{short:100};return stay(m);
 }
 if(ctx==='gstop')return stay(m);
 const bonus=ctx==='gg',omen=ctx==='omen';
 const basic=bonus?(blank(f)||f==='small'||f==='bell'):blank(f);
 const fake=f==='fake';
 if(fake){
  if(m==='v'||m==='super')return stay(m);
  if(m==='short')return {short:99.22,long:.39,super:.39};
  if(m==='long')return {long:99.22,super:.78};
  return {[m]:!bonus&&!omen?pick(s,99.22,98.44,96.88):99.22,
   short:!bonus&&!omen?pick(s,.76,1.53,3.05):.76,long:!bonus&&!omen?pick(s,.01,.02,.05):.01,super:!bonus&&!omen?pick(s,.006,.012,.024):.006};
 }
 if(m==='super')return basic&&(!bonus||!oneCoin(f))?{long:3.91,super:96.09}:stay(m);
 if(m==='v')return bonus||omen?{short:100}:basic?{low1:2.73,low2:.39,normal:.15,prepare:.05,v:96.68}:stay(m);
 if(m==='long'){
  if(bonus&&oneCoin(f))return {super:100};
  if(basic)return omen?stay(m):bonus?{short:1.1,long:98.9}:{short:1.66,long:98.33,super:.01};
  if(f==='middleBlue')return {long:93.75,super:6.25};
  if(yellow(f))return bonus?(f==='yellowLeft'?{long:99.22,super:.78}:{long:87.5,super:12.5}):{long:98.27,super:1.73};
  if(f==='yellowMiddle')return {long:75,super:25};return stay(m);
 }
 if(m==='short'){
  if(basic)return omen||bonus&&oneCoin(f)?stay(m):bonus?{low1:.76,low2:.2,normal:.1,prepare:.05,short:98.89}:{low1:2.73,low2:.39,normal:.15,prepare:.05,short:96.65,long:.02,super:.006};
  if(f==='middleBlue')return bonus?{short:98.44,long:1.53,super:.04}:{short:96.88,long:3.05,super:.07};
  if(yellow(f))return bonus?(f==='yellowLeft'?{short:99.19,long:.78,super:.02}:{short:96.88,long:3.05,super:.07}):{short:98.76,long:1.21,super:.04};
  if(f==='yellowMiddle')return {short:75,long:23.44,super:1.56};return stay(m);
 }
 const normal=ctx==='normal',variant=(a:number,b:number,c:number)=>normal?pick(s,a,b,c):a;
 if(basic){
  if(m==='low1')return bonus?{low1:99.84,low2:.15,normal:.01,prepare:.003}:omen?{low1:99.81,low2:.17,normal:.01,prepare:.003,super:.003}:{low1:s===5?99.78:99.81,low2:.17,normal:.01,prepare:.003,v:pick(s,.003,.012,.037)};
  if(m==='low2')return bonus?{low1:oneCoin(f)?0:.15,low2:oneCoin(f)?99.901:99.751,normal:.09,prepare:.006,short:.003}:omen?{low2:99.818,normal:.17,prepare:.009,super:.003}:{low1:s%2===0?.11:.07,low2:100-(s%2===0?.11:.07)-.18-pick(s,.003,.04,.07),normal:.17,prepare:.01,v:pick(s,.003,.04,.07)};
  if(m==='normal')return bonus?{low1:oneCoin(f)?0:.29,low2:oneCoin(f)?0:.07,normal:oneCoin(f)?99.917:99.557,prepare:.08,short:.003}:omen?{normal:99.818,prepare:.17,short:.009,super:.003}:{low1:s%2===0?.29:.21,low2:s%2===0?.07:.04,normal:s%2===0?99.467:99.577,prepare:.17,short:.003};
  return bonus?{low1:oneCoin(f)?0:1.56,low2:oneCoin(f)?0:.29,normal:oneCoin(f)?0:.2,prepare:oneCoin(f)?99.897:97.847,short:.1,long:.003}:omen?{prepare:99.884,short:.11,long:.003,super:.003}:{low1:s%2===0?1.17:.77,low2:s%2===0?.22:.11,normal:s%2===0?.15:.07,prepare:s%2===0?98.347:98.937,short:.11,long:.003};
 }
 if(f==='middleBlue'){
  if(m==='low1')return {low1:variant(66.67,66.67,50),low2:variant(29.33,25.3,34),normal:variant(3.13,6.3,12.5),prepare:variant(.78,1.6,3.1),short:variant(.1,.2,.4)};
  if(m==='low2')return {low2:66.67,normal:variant(31.67,30,26.7),prepare:variant(1.56,3.1,6.3),short:variant(.1,.2,.4)};
  if(m==='normal')return {normal:66.67,prepare:variant(32.89,32.45,31.56),short:variant(.39,.78,1.56),long:variant(.05,.10,.20),super:variant(.003,.006,.012)};
  return bonus?{prepare:75,short:24.8,long:.2,super:.006}:{prepare:66.67,short:variant(33.13,32.93,32.53),long:variant(.2,.39,.78),super:variant(.006,.012,.024)};
 }
 if(yellow(f)){
  if(bonus){
   const common=f==='yellowCommon';
   if(m==='low1')return common?{low1:50,low2:41.99,normal:6.25,prepare:1.56,short:.2}:{low1:80,low2:19.56,normal:.39,prepare:.05,short:.003};
   if(m==='low2')return common?{low2:50,normal:46.68,prepare:3.13,short:.2}:{low2:80,normal:19.8,prepare:.2,short:.006};
   if(m==='normal')return common?{normal:50,prepare:49.12,short:.78,long:.1,super:.006}:{normal:80,prepare:19.99,short:.01};
   return common?{prepare:66.67,short:32.93,long:.39,super:.01}:{prepare:90,short:9.99,long:.006};
  }
  if(m==='low1')return {low1:77.57,low2:variant(21.38,20.32,18.21),normal:variant(.87,1.73,3.47),prepare:variant(.17,.34,.68),short:variant(.02,.04,.07)};
  if(m==='low2')return {low2:77.57,normal:variant(21.97,21.52,20.60),prepare:variant(.43,.87,1.73),short:variant(.02,.05,.10)};
  if(m==='normal')return {normal:77.57,prepare:variant(22.34,22.26,22.09),short:variant(.07,.15,.29),long:variant(.01,.02,.04),super:variant(.003,.006,.012)};
  return {prepare:84.47,short:variant(15.49,15.45,15.38),long:variant(.04,.07,.14),super:variant(.003,.006,.012)};
 }
 if(f==='yellowMiddle'){
  if(m==='low1')return {low2:variant(67.87,60.7,46.5),normal:25,prepare:variant(6.25,12.5,25),short:variant(.78,1.6,3.1),long:variant(.1,.2,.4)};
  if(m==='low2')return {normal:75,prepare:variant(23.24,21.5,18),short:variant(1.56,3.1,6.3),long:variant(.2,.4,.8)};
  if(m==='normal')return {prepare:variant(92.97,85.94,71.88),short:variant(6.25,12.5,25),long:variant(.59,1.17,2.34),super:variant(.2,.39,.78)};
  return {prepare:25,short:variant(73.05,71.09,67.19),long:variant(1.56,3.13,6.25),super:variant(.39,.78,1.56)};
 }
 return stay(m);
}
const contexts:ModeContext[]=['normal','omen','gg','gstop','sgg'];
const flags:PhaseFlag[]=['god','red','reverseRed','reverseFake','fake','blue','middleBlue','yellowReplay','yellowLeft','yellowCommon','yellowMiddle','bell','small','coinA','coinB','coinC','special','none'];
export const MODE_TRANSITIONS=Object.fromEntries(contexts.map(ctx=>[ctx,Object.fromEntries(FRONT_MODES.map(m=>[m,Array.from({length:6},(_,i)=>Object.fromEntries(flags.map(f=>[f,row(transitions(ctx,m,(i+1) as Setting,f))])))]))])) as Record<ModeContext,Record<FrontMode,Record<PhaseFlag,ModeRow>[]>>;
export const drawFrontMode=(ctx:ModeContext,m:FrontMode,s:Setting,f:PhaseFlag,rng:Rng)=>drawWeighted(MODE_TRANSITIONS[ctx][m][s-1]![f],rng);
/** 当該ゲームの開始時モードで判定。モード移行は次のゲームへ保存する。 */
export function frontHitPercent(ctx:ModeContext,m:FrontMode,s:Setting,f:PhaseFlag):number{
 if(ctx==='gstop')return 0;
 if(ctx==='normal'){
  if(m==='low1'||m==='low2'||m==='prepare')return blank(f)?[.01,.01,.01,.05,.05,.10][s-1]!:f==='middleBlue'?[.39,.78,.39,.78,.39,.78][s-1]!:yellow(f)?[.38,.76,.38,.96,.38,1.17][s-1]!:f==='yellowMiddle'?[5,10,5,15,5,20][s-1]!:f==='special'?50:0;
  if(m==='normal')return blank(f)?[.07,.17,.07,.25,.15,.34][s-1]!:f==='middleBlue'?[1.56,3.13,1.56,3.13,1.56,3.13][s-1]!:yellow(f)?[1.53,2.25,1.53,2.25,1.53,2.45][s-1]!:f==='yellowMiddle'?(s===6?25:20):f==='special'?50:0;
  return blank(f)?({v:5,short:2.5,long:5,super:9.4}[m]):f==='middleBlue'?25:yellow(f)?({v:31.1,short:22.5,long:26.5,super:31.1}[m]):f==='yellowMiddle'?(m==='short'?75:100):f==='special'?(m==='long'||m==='super'?100:50):0;
 }
 const high=m==='short'||m==='long',top=m==='super',low=m==='low1'||m==='low2';
 if(ctx==='sgg')return oneCoin(f)?(top?50:10):f==='bell'?.1:f==='special'?(m==='long'||top?100:50):0;
 if(ctx==='gg')return oneCoin(f)?(top?50:m==='long'?10:m==='short'?5:2.5):f==='middleBlue'?(top?25:high?.39:low?.1:.2):f==='yellowLeft'?(top?25:[.01,.01,.01,.05,.24,.49][s-1]!):f==='yellowCommon'?(top?50:high?10:1.56):f==='yellowMiddle'?(top?75:high?25:3.13):f==='special'?(high||top?100:50):0;
 return f==='middleBlue'?(top?25:high?.4:low?.1:.2):yellow(f)?(top?27:high?.8:.1):f==='yellowMiddle'?(top?75:high?25:3.1):f==='special'?(high||top?100:50):0;
}
export const hitPercent=(percent:number,rng:Rng)=>percent>=100||percent>0&&rng(MODE_DRAW_SIZE)<Math.round(percent*1000);
export function backTransition(ctx:ModeContext,m:BackMode,s:Setting,f:PhaseFlag,rng:Rng):BackMode{
 if(ctx==='gstop')return m;
 let low=0,prepare=0,high=0;const normal=ctx==='normal',none=oneCoin(f);
 if(m==='low'){
  if(none){prepare=normal?(s===6?.049:s===4?.024:.006):(s===6?.4:.2);high=s===6?.018:s===4?.006:.003;}
  if(yellow(f))prepare=normal?(s===6?4.04:s===4?2.02:1.01):(f==='yellowCommon'?(s===6?6.3:3.1):(s===6?.6:.3));
 }else if(m==='prepare'){
  if(normal){if(none){low=s>=4?.8:1.6;high=.2;}if(yellow(f))high=2;}
  else{if(f==='blue')low=s===3?9.4:s===5?4.7:12.5;if(none)high=s===6?3.1:s===4?1.6:.8;if(yellow(f))high=f==='yellowCommon'?(s===6?12.5:s===4?6.3:3.1):(s===6?1.1:s===4?.6:.3);}
 }else if(!normal&&f==='blue')low=[7.8,7.8,7,7,3.9,6.3][s-1]!;
 if(low+prepare+high===0)return m;
 const n=rng(MODE_DRAW_SIZE);return n<low*1000?'low':n<(low+prepare)*1000?'prepare':n<(low+prepare+high)*1000?'high':m;
}
export const backHitPercent=(ctx:ModeContext,m:BackMode,f:PhaseFlag)=>m!=='high'||ctx==='gstop'?0:ctx==='normal'?(f==='yellowReplay'?25:0):(f==='blue'?15.6:0);
export function resetFrontMode(s:Setting,rng:Rng):FrontMode{
 const low1=[60,60,50,50,40,40][s-1]!,part=[7.81,6.25,12.5,9.38,15.63,12.5][s-1]!,normal=[22.60,25.72,23.22,29.47,26.97,33.22][s-1]!;
 return drawWeighted(row({low1,low2:part,normal,prepare:part,v:.01,short:1.56,long:.2,super:.01}),rng);
}
export function resetCeiling(s:Setting,rng:Rng):510|1000|1480{
 const n=rng(10000);return n<1000?510:n<10000-[0,0,0,39,234,469][s-1]!?1000:1480;
}

import type {Rng} from '../cards.js';
import type {GSymbol} from './engine.js';
import type {PhaseFlag} from './phaseRules.js';
import {drawWeighted,percentWeights} from './modeRules.js';
export type MirrorMode='normal'|'low'|'high';
export const GSTOP_GROUPS:readonly (readonly GSymbol[])[]=[
 ['1','V','3','S','5'],['鏡','V','3','S','5'],['鏡','V','3','S','鏡'],['鏡','V','鏡','S','鏡'],
 ['1','7','3','S','5'],['鏡','7','3','S','5'],['鏡','7','3','S','鏡'],['鏡','7','鏡','S','鏡'],
];
const rows=(p:number[])=>percentWeights(p).map((weight,i)=>[i,weight] as const);
export const GROUP_WEIGHTS={
 normal:rows([34.38,33.15,7.32,.15,15.63,8.20,1.16,.01]),
 low:rows([53.13,21.36,.43,.09,21.88,3.05,.06,.01]),
 high:rows([0,31.25,41.41,2.34,0,18.75,5.47,.78]),
 middle:rows([0,0,65.63,9.38,0,0,21.88,3.13]),
 lowMiddle:rows([0,0,72.27,2.73,0,0,24.61,.39]),
 left:rows([0,0,73.44,1.56,0,0,24.61,.39]),
 lowLeft:rows([0,0,86.13,1.37,0,0,12.30,.20]),
 highLeft:rows([0,0,70.31,4.69,0,0,23.44,1.56]),
 common:rows([0,0,56.25,18.75,0,0,18.75,6.25]),
 yellowMiddle:rows([0,0,0,50,0,0,0,50]),fake:rows([0,0,0,0,0,0,87.5,12.5]),special:rows([0,0,0,0,0,0,0,100]),
};
export function drawGstopGroup(mode:MirrorMode,flag:PhaseFlag,rng:Rng):GSymbol[]{
 const key=flag==='special'?'special':flag==='fake'||flag==='reverseFake'?'fake':flag==='yellowMiddle'?'yellowMiddle':flag==='yellowCommon'?'common'
  :flag==='middleBlue'?(mode==='low'?'lowMiddle':'middle')
  :flag==='yellowLeft'||mode!=='normal'&&flag==='coinA'?(mode==='normal'?'left':mode==='low'?'lowLeft':'highLeft'):mode;
 return GSTOP_GROUPS[drawWeighted(GROUP_WEIGHTS[key],rng)]!.slice();
}
export const isHold=(symbols:readonly string[])=>['VSV','SVS','7S7','S7S'].includes(symbols.join(''));
export const isReach=(symbols:readonly string[])=>['135','175','315','753','V31'].includes(symbols.join(''));
// 添字は減らす個数。鏡を外した候補から、成立役に応じてさらに絞る。
const reductions=[
 {ordinary:[99.55,.39,.05,.01,0],middle:[0,95.90,3.13,.78,.20],left:[0,97.95,1.56,.39,.10],common:[0,91.80,6.25,1.56,.39],fake:[0,0,96.09,3.13,.78],special:[0,0,0,0,100]},
 {ordinary:[99.94,.05,.01,0],middle:[0,98.24,1.56,.20],left:[0,99.12,.78,.10],common:[0,96.48,3.13,.39],fake:[0,0,99.22,.78],special:[0,0,0,100]},
 {ordinary:[99.95,.05,0],middle:[0,99.61,.39],left:[0,99.80,.20],common:[0,99.22,.78],fake:[0,0,100],special:[0,0,100]},
 {ordinary:[100,0],middle:[0,100],left:[0,100],common:[0,100],fake:[0,100],special:[0,100]},
].map(table=>({ordinary:rows(table.ordinary),middle:rows(table.middle),left:rows(table.left),common:rows(table.common),fake:rows(table.fake),special:rows(table.special)}));
export function drawHoldGroup(previous:readonly GSymbol[],held:GSymbol,flag:PhaseFlag,rng:Rng):GSymbol[]{
 const mirrors=previous.filter(x=>x==='鏡').length,options=previous.filter(x=>x!=='鏡');
 if(mirrors>3||!options.some(x=>x===held))throw Error('HOLDの保存図柄を確認してください。');
 const key=flag==='yellowMiddle'||flag==='special'?'special':flag==='middleBlue'?'middle':flag==='yellowLeft'?'left':flag==='yellowCommon'?'common':flag==='fake'||flag==='reverseFake'?'fake':'ordinary';
 const count=Math.max(1,options.length-drawWeighted(reductions[mirrors]![key],rng));
 // 残す非当選図柄の内訳は未公表。試遊では固定順。当選図柄は必ず残し停止率1/個数を保つ。
 return [held,...options.filter(x=>x!==held).slice(0,count-1)];
}

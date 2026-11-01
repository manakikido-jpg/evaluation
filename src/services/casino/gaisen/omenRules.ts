import type {Rng} from '../cards.js';
import type {PhaseFlag} from './phaseRules.js';

/** なな徹の凱旋・初当たり前兆表（2026-11-01確認）。0.1%を1とする相対重み。
 * 公開値の丸めで合計は1000にならない。内部の正確な抽選値とは扱わない。
 * https://nana-press.com/kaiseki/machine/49/858/
 */
export const INITIAL_OMEN_WEIGHTS={
 none:[1,1,1,16,1,1,1,31,8,8,8,156,16,16,16,275,16,16,16,219,8,8,8,156],
 blue:[4,4,4,250,16,16,16,395,16,16,16,250],
 middleBlue:[2,2,2,125,2,2,2,188,16,16,16,332,16,16,16,250],
 other:[1,1,1,31,1,1,1,63,8,8,8,188,16,16,16,275,16,8,8,188,8,8,8,125],
} as const;
export function initialOmenGroup(flag:PhaseFlag):keyof typeof INITIAL_OMEN_WEIGHTS{
 return flag==='none'||flag==='yellowReplay'?'none':flag==='blue'?'blue':flag==='middleBlue'?'middleBlue':'other';
}
export function drawInitialOmen(flag:PhaseFlag,rng:Rng):number{
 const weights=INITIAL_OMEN_WEIGHTS[initialOmenGroup(flag)];
 let ticket=rng(weights.reduce<number>((n,w)=>n+w,0));
 for(let i=0;i<weights.length;i++){if(ticket<weights[i]!)return i+1;ticket-=weights[i]!;}
 throw Error('前兆抽選の乱数が範囲外です。');
}
export const CEILING_GAMES=1480,CEILING_OMEN=24;
/** 天井だけのループ率。ほかの契機の未確認率へ流用しない。 */
export function drawCeilingLoop(rng:Rng):1|80{return rng(2)===0?1:80;}

import type {Rng} from '../cards.js';
import type {Setting} from './engine.js';
import type {PhaseFlag} from './phaseRules.js';

/** 公開解析の丸め値を使う試遊用。出典・未照合の差分は docs/gaisen-sgg-rules.md。 */
export const SGG_DRAW_SIZE=10000;
export type MedusaAward=0|10|20|30|'infinite'|'deferred';
// 無条件の当選率（百分率×100）。残りは非当選。3枚役は最終Gで告知する。
export const MEDUSA_WEIGHTS:Partial<Record<PhaseFlag,readonly (readonly [MedusaAward,number])[]>>={
 small:[['deferred',20]],
 middleBlue:[[10,2090],[20,313],[30,78],['infinite',20]],
 yellowLeft:[[20,765],[30,117],['infinite',117]],
 yellowCommon:[[10,4180],[20,625],[30,156],['infinite',39]],
 yellowMiddle:[[10,7500],[20,1875],[30,469],['infinite',156]],
 special:[['infinite',10000]],
};
export function drawMedusa(flag:PhaseFlag,rng:Rng):MedusaAward{
 const rows=MEDUSA_WEIGHTS[flag];if(!rows)return 0;
 let n=rng(SGG_DRAW_SIZE);for(const [award,weight] of rows){if(n<weight)return award;n-=weight;}return 0;
}
export const EX_ENTRY_WEIGHTS=[156,156,625,156,313,156] as const;
export const EX_RESET_WEIGHTS=[39,39,156,39,78,39] as const;
export function drawEx(setting:Setting,entry:boolean,rng:Rng){return rng(SGG_DRAW_SIZE)<(entry?EX_ENTRY_WEIGHTS:EX_RESET_WEIGHTS)[setting-1]!;}
// 当選先を一度の抽選で決める。未当選を再抽選しない。
export const MEDUSA_RESET_WEIGHTS:Partial<Record<PhaseFlag,readonly [number,number]>>={
 middleBlue:[2500,2500],yellowLeft:[0,2500],yellowCommon:[3333,3333],yellowMiddle:[5000,5000],special:[0,10000],
};
export function drawMedusaReset(flag:PhaseFlag,rng:Rng):'sgg'|'ex'|null{
 const row=MEDUSA_RESET_WEIGHTS[flag];if(!row)return null;
 const n=rng(SGG_DRAW_SIZE);return n<row[0]?'sgg':n<row[0]+row[1]?'ex':null;
}
/** 赤7/GODの基本獲得と別に抽選しない。逆押しフェイク/3枚役も対象外。 */
export function drawExStock(flag:PhaseFlag,rng:Rng):boolean{
 if(flag==='blue'||flag==='bell')return rng(2)===0;
 return ['coinB','coinC','middleBlue','yellowLeft','yellowCommon','yellowMiddle','special'].includes(flag);
}

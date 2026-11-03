import type {Rng} from '../cards.js';
import type {PhaseFlag} from './phaseRules.js';

export type SggLoopRate=1|25|50|67|75;
/** 通常SGGの赤7巻き戻し。残りGはそのゲームの減算後。公開丸め値×100。 */
export const SGG_LOOP_WEIGHTS={
 ordinary:[[1,9844],[50,153],[67,2],[75,1]],
 special:[[1,7500],[25,2070],[50,313],[67,78],[75,39]],
 last:[[25,7500],[50,2266],[67,156],[75,78]],
} as const;
export function drawSggResetLoop(remaining:number,rng:Rng,mode:'ordinary'|'medusa'|'ex'='ordinary'):SggLoopRate{
 const special=remaining===7||remaining===11;
 const rows=mode==='ex'?SGG_LOOP_WEIGHTS.ordinary:remaining===0||mode==='medusa'&&special?SGG_LOOP_WEIGHTS.last:special||mode==='medusa'?SGG_LOOP_WEIGHTS.special:SGG_LOOP_WEIGHTS.ordinary;
 let n=rng(10000);for(const [rate,weight] of rows){if(n<weight)return rate;n-=weight;}
 throw Error('SGGの抽選範囲を確認してください。');
}
/** 救済はストック確定ではない。次ゲーム以降にこの率で追加抽選する。 */
export const drawSggRescueLoop=(rng:Rng):SggLoopRate=>rng(4)<3?50:75;
/** 押し順を外しても成立フラグを使う。特殊SPは時間停止へ進むため対象外。 */
export const blocksSggRescue=(flag:PhaseFlag)=>['god','red','reverseRed','fake','reverseFake','special'].includes(flag);

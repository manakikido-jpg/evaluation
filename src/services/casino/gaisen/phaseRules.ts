import type {Rng} from '../cards.js';
import type {GaisenState,Role,Spin} from './engine.js';

/** 公開解析の丸め値を使う試遊モデル。実機の内部フラグ表ではない。根拠・差分は docs/gaisen-phase-rules.md。 */
export const PHASE_DRAW_SIZE=2**24;
export type PhaseTable='normal'|'gg'|'sgg'|'sgg-high';
type OrderKind='any'|'left'|'right'|'four';
type FlagSpec={name:string;role:Role;units:number;replay:boolean;order:OrderKind;reels:string[];mark?:'blue'|'yellow'};
const spec=(name:string,role:Role,units:number,reels:string[],order:OrderKind='any',replay=false,mark?:'blue'|'yellow'):FlagSpec=>({name,role,units,reels,order,replay,mark});
export const FLAGS={
 god:spec('GOD揃い','god',15,['G','O','D']),
 red:spec('赤7揃い','red7',3,['赤7','赤7','赤7'],'any',true),
 reverseRed:spec('逆押し赤7揃い','red7',3,['赤7','赤7','赤7'],'right',true),
 reverseFake:spec('赤7チャンス・リプレイ','replay',3,['赤7','青7','赤7'],'right',true),
 fake:spec('赤7フェイク・リプレイ','rare',3,['赤7','青7','赤7'],'any',true),
 blue:spec('青7リプレイ','replay',3,['青7','青7','青7'],'any',true,'blue'),
 middleBlue:spec('中段青7リプレイ','rare',3,['青7','青7','青7'],'any',true),
 yellowReplay:spec('下段黄7リプレイ','replay',3,['黄7','黄7','黄7'],'any',true,'yellow'),
 yellowLeft:spec('右上がり黄7・左から','rare',15,['黄7','青7','黄7'],'left',false,'yellow'),
 yellowCommon:spec('右上がり黄7','rare',15,['黄7','青7','黄7'],'any',false,'yellow'),
 yellowMiddle:spec('中段黄7','rare',15,['黄7','黄7','黄7'],'any',false,'yellow'),
 bell:spec('押し順黄7','bell',15,['黄7','黄7','黄7'],'four',false,'yellow'),
 small:spec('押し順3枚役','smallBell',3,['◆','◆','◆'],'four'),
 coinA:spec('1枚役','none',1,['◆','桜','◆']),
 coinB:spec('特殊1枚役B','rare',1,['桜','◆','桜']),
 coinC:spec('特殊1枚役C','rare',1,['◆','桜','青7']),
 special:spec('特殊SP','rare',0,['桜','桜','◆']),
 none:spec('ハズレ','none',0,['青7','◆','桜']),
} satisfies Record<string,FlagSpec>;
export type PhaseFlag=keyof typeof FLAGS;
export type PhaseSpin={flag:PhaseFlag;missUnits:number};
type Weight={flag:PhaseFlag;weight:number};
function table(kind:PhaseTable):Weight[]{
 const rows:Weight[]=[];
 const add=(flag:PhaseFlag,probability:number)=>rows.push({flag,weight:Math.round(PHASE_DRAW_SIZE*probability)});
 add('god',1/8192);add('red',12/65536);
 add('coinB',1/102.4);add('coinC',1/409.6);
 add('middleBlue',1/99.9);add('yellowLeft',1/57.7);add('yellowCommon',1/655.4);add('yellowMiddle',1/936.2);
 add('fake',2/655.4);add('special',1/65536);
 if(kind==='normal'){
  add('coinA',1/10.4);add('blue',1/7.9);add('yellowReplay',1/17.4);
 }else{
  add('bell',1/4.4);
  add('blue',1/(kind==='gg'?5.4:kind==='sgg'?21.9:24.1));
  if(kind!=='gg'){add('reverseRed',kind==='sgg'?1/29.5+1/206.6:1/26.7+1/187.2);add('reverseFake',1/10);}
 }
 // ハズレ約1/1.5・3枚役約1/1.8は残余。丸め済みの値を足して全役を再正規化するとGODまで変わるので避ける。
 const remaining=PHASE_DRAW_SIZE-rows.reduce((n,r)=>n+r.weight,0);
 if(remaining<=0)throw Error('区間別の役確率が合計1を超えています。');
 rows.push({flag:kind==='normal'?'none':'small',weight:remaining});return rows;
}
export const PHASE_TABLES:Record<PhaseTable,Weight[]>={normal:table('normal'),gg:table('gg'),sgg:table('sgg'),'sgg-high':table('sgg-high')};
export function phaseTable(s:GaisenState):PhaseTable{
 if(s.phase==='sgg')return s.medusa>0||s.ex?'sgg-high':'sgg';
 if(s.phase==='gg'||s.phase==='gstop'&&s.gstopReturn==='gg')return 'gg';
 return 'normal';
}
export function drawPhaseFlag(s:GaisenState,rng:Rng):PhaseFlag{
 let n=rng(PHASE_DRAW_SIZE);
 for(const row of PHASE_TABLES[phaseTable(s)]){if(n<row.weight)return row.flag;n-=row.weight;}
 throw Error('乱数の範囲が不正です。');
}
const FOUR=[[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
export function preparePhaseSpin(flag:PhaseFlag,rng:Rng):{model:PhaseSpin;order:number[];role:Role}{
 const d=FLAGS[flag];
 return {model:{flag,missUnits:d.order==='four'?(rng(8)===0?1:0):d.order==='left'?1:0},
  order:d.order==='four'?FOUR[rng(4)]!.slice():d.order==='right'?[2,1,0]:[0,1,2],role:d.role};
}
/** G-STOPでは上部の停止操作を優先し、下部の押し順は自動補助する試遊仕様。 */
export function phaseOrderCorrect(p:Spin,stops=p.stops):boolean{
 const kind=FLAGS[p.model!.flag].order;
 if(p.phase==='gstop'||kind==='any')return true;
 if(kind==='left'||kind==='right')return stops.length===0||stops[0]===(kind==='left'?0:2);
 return stops.every((reel,i)=>reel===p.order[i]);
}
export function phaseOutcome(p:Spin){
 const d=FLAGS[p.model!.flag],correct=phaseOrderCorrect(p),units=d.replay?3:correct?d.units:p.model!.missUnits;
 const role:Role=!correct&&d.role==='red7'?'replay':d.role;
 return {units,role,replay:d.replay,correct,name:!correct&&d.role==='red7'?'赤7チャンス・リプレイ':d.name,mark:correct?d.mark:undefined};
}
export function phaseReels(p:Spin):(string|null)[]{
 const d=FLAGS[p.model!.flag];
 return [0,1,2].map(i=>{
  const at=p.stops.indexOf(i);if(at<0)return null;
  if(phaseOrderCorrect(p,p.stops.slice(0,at+1)))return d.reels[i]!;
  return d.replay?'青7':['◆','桜','青7'][i]!;
 });
}
/** 本物の赤7とフェイクのナビを同じにし、停止前に当否を漏らさない。 */
export function spinNavi(p:Spin):number[]|null{
 if(!p.model)return p.role==='bell'&&['gg','sgg','gzone'].includes(p.phase)?p.order.slice():null;
 if(p.phase==='gstop'||!['gg','sgg'].includes(p.phase))return null;
 if(p.phase==='sgg'&&['red','reverseRed','reverseFake'].includes(p.model.flag))return [2,1,0];
 return ['four','left'].includes(FLAGS[p.model.flag].order)?p.order.slice():null;
}

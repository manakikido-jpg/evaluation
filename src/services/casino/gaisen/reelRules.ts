/** 試遊独自の20コマ。添字0が配列表の1番。実機の制御表ではない。 */
export type ReelSymbol='god'|'gold7'|'red7'|'blue7'|'flower'|'crest';
export const REEL_LABELS:Record<ReelSymbol,string>={god:'神紋',gold7:'金の7',red7:'赤の7',blue7:'青の7',flower:'桜',crest:'宝石'};
export const REEL_STRIPS:readonly (readonly ReelSymbol[])[]=[
 ['god','gold7','red7','blue7','flower','god','gold7','red7','blue7','crest','god','gold7','red7','blue7','flower','god','gold7','red7','blue7','crest'],
 ['blue7','gold7','god','red7','crest','blue7','gold7','god','red7','flower','blue7','gold7','god','red7','crest','blue7','gold7','god','red7','flower'],
 ['red7','blue7','gold7','god','flower','red7','blue7','gold7','god','crest','red7','blue7','gold7','god','flower','red7','blue7','gold7','god','crest'],
];
export type ReelStop={input:number;position:number;slip:number;assisted:boolean;miss:boolean};
export type ReelControl={stops:(ReelStop|null)[];miss:boolean};
export function reelRows(reel:number,position:number):ReelSymbol[]{const strip=REEL_STRIPS[reel]!;return [strip[(position+1)%20]!,strip[position]!,strip[(position+19)%20]!];}
const LEGACY:ReelSymbol[]=['gold7','flower','blue7','crest','red7','flower','god','blue7','crest'];
export function reelSymbol(value:string|null,index:number):ReelSymbol{
 if(value==='黄7')return 'gold7';if(value==='青7')return 'blue7';if(value==='赤7')return 'red7';
 if(value&&['G','O','D'].includes(value))return 'god';if(value==='◆')return 'crest';if(value==='桜')return 'flower';
 return LEGACY[(Number(value)||index+1)%LEGACY.length]!;
}
export function reelValue(symbol:ReelSymbol,index:number):string{return {gold7:'黄7',blue7:'青7',red7:'赤7',god:['G','O','D'][index]!,flower:'桜',crest:'◆'}[symbol];}
export function canonicalPosition(reel:number,symbol:ReelSymbol):number{return REEL_STRIPS[reel]!.indexOf(symbol);}
const WIN_PATTERNS=['god,god,god','gold7,gold7,gold7','red7,red7,red7','blue7,blue7,blue7','crest,crest,crest','gold7,blue7,gold7','red7,blue7,red7','crest,flower,crest','flower,crest,flower','crest,flower,blue7','flower,flower,crest'];
/** 前へ0〜4コマ。取りこぼした役で別の当たり絵柄を完成させない。 */
export function controlReel(reel:number,target:ReelSymbol,input:number|undefined,control:ReelControl):ReelStop{
 const assisted=input===undefined,start=input??canonicalPosition(reel,target),strip=REEL_STRIPS[reel]!;
 const choices=Array.from({length:5},(_,slip)=>({input:start,position:(start+slip)%20,slip,assisted,miss:strip[(start+slip)%20]!==target}));
 const safe=(choice:ReelStop)=>{
  if(!control.miss&&!choice.miss)return true;
  const symbols=control.stops.map((s,i)=>i===reel?strip[choice.position]:s?REEL_STRIPS[i]![s.position]:null);
  return symbols.some(s=>s===null)||!WIN_PATTERNS.includes(symbols.join(','));
 };
 const chosen=choices.find(c=>!c.miss&&safe(c))??choices.find(safe);
 if(!chosen)throw Error('停止位置を決められません。');
 return chosen;
}

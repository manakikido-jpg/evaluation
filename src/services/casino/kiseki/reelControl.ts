import {stripsFor, pattern, roleRows, rows, validStop, type KisekiRole, type ReelSet} from './rules.js';

export type KisekiStop = {input:number;position:number;slip:number;assisted:boolean};
const cache = new Map<string, number[][]>();
/** 途中で止めた窓を保持し、最後に別の当たりを表示しない停止候補。 */
function plans(role:KisekiRole,set:ReelSet):number[][] {
 const key=set+':'+role,known=cache.get(key);if(known)return known;
 const p=pattern(role),line=roleRows(role);
 const options=stripsFor(set).map((_,i)=>Array.from({length:20},(_,n)=>n)
  .filter(n=>!p||rows(i,n,set)[line[i]!]===p.symbols[i])
  .filter(n=>i!==1||role!=='small'||rows(i,n,set)[0]==='god'&&rows(i,n,set)[1]==='red7')
  .filter(n=>i!==1||role!=='bell'||rows(i,n,set)[1]!=='red7'));
 const result:number[][]=[];
 for(const a of options[0]!)for(const b of options[1]!)for(const c of options[2]!){
  const pos=[a,b,c];if(validStop(role,pos,set))result.push(pos);
 }
 cache.set(key,result);return result;
}
/** 原則0〜4コマ。届かないときは補助を明示し、小役を取りこぼさない試遊制御。 */
export function controlKisekiReel(role:KisekiRole,reel:number,positions:(number|null)[],input?:number,automaticStart=0,set:ReelSet='reference'):KisekiStop {
 if(input!==undefined&&(!Number.isInteger(input)||input<0||input>=20))throw Error('停止位置は0〜19です。');
 const available=plans(role,set).filter(p=>positions.every((v,i)=>i===reel||v===null||p[i]===v));
 if(!available.length)throw Error('停止済みの配列を確認してください。');
 const start=input??automaticStart;
 // 上→下の配列を下へ回すと、窓中央のコマ番号は減る。旧配列は従来どおり。
 const distance=(position:number)=>set==='reference'?(start-position+20)%20:(position-start+20)%20;
 const choice=available.reduce((a,b)=>distance(b[reel]!)<distance(a[reel]!)?b:a);
 const position=choice[reel]!,slip=distance(position);
 return {input:start,position,slip,assisted:input===undefined||slip>4};
}
/** 自動補助の開始コマ。公開ゲーム数だけを使い、抽選用の乱数は消費しない。 */
export function automaticReelStart(spins:number,reel:number):number{
 let n=(Math.imul(spins+1,0x9e3779b1)^Math.imul(reel+1,0x85ebca6b))>>>0;
 n=Math.imul(n^(n>>>16),0x7feb352d);return ((n^(n>>>15))>>>0)%20;
}

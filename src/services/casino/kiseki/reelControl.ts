import {STRIPS, pattern, roleRows, rows, winningLines, decorationLine, type KisekiRole} from './rules.js';

export type KisekiStop = {input:number;position:number;slip:number;assisted:boolean};
const cache = new Map<KisekiRole, number[][]>();
/** 途中で止めた窓を保持し、最後に別の当たりを表示しない停止候補。 */
function plans(role:KisekiRole):number[][] {
 const known=cache.get(role);if(known)return known;
 const p=pattern(role),line=roleRows(role);
 const options=STRIPS.map((_,i)=>Array.from({length:20},(_,n)=>n)
  .filter(n=>!p||rows(i,n)[line[i]!]===p.symbols[i])
  .filter(n=>i!==1||role!=='small'||rows(i,n)[0]==='god'&&rows(i,n)[1]==='red7')
  .filter(n=>i!==1||role!=='bell'||rows(i,n)[1]!=='red7'));
 const result:number[][]=[];
 for(const a of options[0]!)for(const b of options[1]!)for(const c of options[2]!){
  const pos=[a,b,c];if(!decorationLine(pos)&&winningLines(pos).every(w=>role==='fake'&&w.symbols.every(s=>s==='blue7')||p&&w.line===p.line&&w.symbols.join()===p.symbols.join()))result.push(pos);
 }
 cache.set(role,result);return result;
}
/** 原則0〜4コマ。届かないときは補助を明示し、小役を取りこぼさない試遊制御。 */
export function controlKisekiReel(role:KisekiRole,reel:number,positions:(number|null)[],input?:number,automaticStart=0):KisekiStop {
 if(input!==undefined&&(!Number.isInteger(input)||input<0||input>=20))throw Error('停止位置は0〜19です。');
 const available=plans(role).filter(p=>positions.every((v,i)=>i===reel||v===null||p[i]===v));
 if(!available.length)throw Error('停止済みの配列を確認してください。');
 const start=input??automaticStart;
 const choice=available.reduce((a,b)=>(b[reel]!-start+20)%20<(a[reel]!-start+20)%20?b:a);
 const position=choice[reel]!,slip=(position-start+20)%20;
 return {input:start,position,slip,assisted:input===undefined||slip>4};
}
/** 自動補助の開始コマ。公開ゲーム数だけを使い、抽選用の乱数は消費しない。 */
export function automaticReelStart(spins:number,reel:number):number{
 let n=(Math.imul(spins+1,0x9e3779b1)^Math.imul(reel+1,0x85ebca6b))>>>0;
 n=Math.imul(n^(n>>>16),0x7feb352d);return ((n^(n>>>15))>>>0)%20;
}

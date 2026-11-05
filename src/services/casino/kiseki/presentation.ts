import type {KisekiRole} from './rules.js';
/** 停止済み窓を維持する。小役の傾向は確定した最後の数字だけへ反映し、抽選乱数は消費しない。 */
export function kisekiDigits(spins:number,positions:(number|null)[],spinning:boolean,lastIndex=2,role?:KisekiRole):(number|null)[] {
 if(!spins)return [2,4,6];
 const digits=positions.map((p,i)=>{
  if(p===null)return null;
  let n=(Math.imul(spins+1,0x9e3779b1)^Math.imul(p+1,0x85ebca6b)^Math.imul(i+1,0xc2b2ae35))>>>0;
  n=Math.imul(n^(n>>>16),0x7feb352d);n^=n>>>15;return 1+(n>>>0)%7;
 });
 if(!spinning&&role&&digits[lastIndex]!==null){
  const value=digits[lastIndex]!;
  if(['blue','middleBlue','fake'].includes(role))digits[lastIndex]=[2,4,6][value%3]!;
  else if(['diagonal','middleGold','gaia'].includes(role))digits[lastIndex]=[1,3,5,7][value%4]!;
  else if(['god','red','sp'].includes(role))digits[lastIndex]=7;
 }
 if(!spinning&&digits.every(d=>d===digits[0])){
  const choices=role&&['blue','middleBlue','fake'].includes(role)?[2,4,6]:role&&['diagonal','middleGold','gaia'].includes(role)?[1,3,5,7]:[1,2,3,4,5,6,7];
  digits[lastIndex]=choices.find(d=>d!==digits[0])!;
 }
 return digits;
}
/** 出目の説明であり、隠れたモードや当選予定の判定には使わない。 */
export function kisekiDigitPattern(digits:(number|null)[]):'spinning'|'pair'|'ascending'|'descending'|'odd'|'even'|'mixed'{
 if(digits.length!==3||digits.some(d=>d===null))return 'spinning';
 const [a,b,c]=digits as [number,number,number];
 if(a===b||b===c||a===c)return 'pair';
 if(b===a+1&&c===b+1)return 'ascending';
 if(b===a-1&&c===b-1)return 'descending';
 if(digits.every(d=>d!%2===1))return 'odd';
 if(digits.every(d=>d!%2===0))return 'even';
 return 'mixed';
}
export function kisekiTheme(phase:string):'gg'|'pgg'|'sgg'|null {
 return phase==='pgg'?'pgg':['sgg','sgg-retry'].includes(phase)?'sgg':['gg','gzone','zzone','zgame'].includes(phase)?'gg':null;
}

/** 公開済みのゲーム数と停止窓だけで作る液晶。抽選乱数は消費しない。 */
export function kisekiDigits(spins:number,positions:(number|null)[],spinning:boolean,lastIndex=2):(number|null)[] {
 if(!spins)return [2,4,6];
 const digits=positions.map((p,i)=>{
  if(p===null)return null;
  let n=(Math.imul(spins+1,0x9e3779b1)^Math.imul(p+1,0x85ebca6b)^Math.imul(i+1,0xc2b2ae35))>>>0;
  n=Math.imul(n^(n>>>16),0x7feb352d);n^=n>>>15;return 1+(n>>>0)%7;
 });
 if(!spinning&&digits.every(d=>d===digits[0]))digits[lastIndex]=digits[lastIndex]!%7+1;
 return digits;
}
export function kisekiTheme(phase:string):'gg'|'pgg'|'sgg'|null {
 return phase==='pgg'?'pgg':['sgg','sgg-retry'].includes(phase)?'sgg':['gg','gzone','zzone','zgame'].includes(phase)?'gg':null;
}

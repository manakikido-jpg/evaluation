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
export function kisekiDigitPattern(digits:(KisekiDigit|null)[]):'spinning'|'pair'|'ascending'|'descending'|'odd'|'even'|'mixed'{
 if(digits.length!==3||digits.some(d=>d===null))return 'spinning';
 const [a,b,c]=digits as [KisekiDigit,KisekiDigit,KisekiDigit];
 if(a===b||b===c||a===c)return 'pair';
 if(typeof a==='number'&&typeof b==='number'&&typeof c==='number'){
  if(b===a+1&&c===b+1)return 'ascending';
  if(b===a-1&&c===b-1)return 'descending';
  if([a,b,c].every(d=>d%2===1))return 'odd';
  if([a,b,c].every(d=>d%2===0))return 'even';
 }
 return 'mixed';
}
export function kisekiTheme(phase:string):'gg'|'pgg'|'sgg'|null {
 return phase==='pgg'?'pgg':['sgg','sgg-retry'].includes(phase)?'sgg':['gg','gzone','zzone','zgame'].includes(phase)?'gg':null;
}

export const NORMAL_MODES=['lowA','lowB','normal','preHeaven','heaven','superHeaven'] as const;
export type NormalMode=typeof NORMAL_MODES[number];
export const NORMAL_MODE_NAMES:Record<NormalMode,string>={lowA:'低確A',lowB:'低確B',normal:'通常',preHeaven:'天国準備',heaven:'天国',superHeaven:'超天国'};
export const modeGroup=(mode:NormalMode):'low'|'normal'|'high'=>['heaven','superHeaven'].includes(mode)?'high':['normal','preHeaven'].includes(mode)?'normal':'low';
/** 旧3段階の保存もそのまま読める。閲覧では保存値を書き換えない。 */
export function normalModeOf(s:{mode:'low'|'normal'|'high';normalMode?:NormalMode}):NormalMode{
 return s.normalMode&&modeGroup(s.normalMode)===s.mode?s.normalMode:s.mode==='high'?'heaven':s.mode==='normal'?'normal':'lowA';
}
export const nextNormalMode=(mode:NormalMode):NormalMode=>NORMAL_MODES[Math.min(5,NORMAL_MODES.indexOf(mode)+1)]!;
export type KisekiDigit=number|'V';
export const REACH_PATTERNS:readonly (readonly KisekiDigit[])[]=[[1,'V',3],[2,2,3],[3,1,5],[4,'V',8],[5,2,6],[6,3,4],[8,0,8],['V',3,1]];
export const ATTENTION_PATTERNS:readonly (readonly KisekiDigit[])[]=[[2,3,4],[2,0,0],[3,0,0],[3,8,'V'],[4,6,1],[4,6,8],[6,3,1],[8,3,1]];
const HIGH_MODE_PATTERNS:readonly (readonly KisekiDigit[])[]=[...ATTENTION_PATTERNS,[3,1,3],['V',5,'V'],[5,6,7],[1,5,5],[6,3,3],[1,5,3]];
const digitHash=(n:number)=>{let v=Math.imul(n+1,0x9e3779b1)>>>0;v=Math.imul(v^(v>>>16),0x7feb352d);return (v^(v>>>15))>>>0;};
/** 液晶の装飾計画。実抽選の乱数を消費せず、予定は停止した窓だけに公開する。 */
export function planKisekiDigits(s:{spins:number;omenAwards:number;omenLeft:number;mode:'low'|'normal'|'high';normalMode?:NormalMode},role:KisekiRole):KisekiDigit[]{
 const h=digitHash(s.spins);
 if(role==='god'||role==='red')return [7,7,7];
 if(s.omenAwards>0&&s.omenLeft<=1)return [1,1,1];
 if(s.omenAwards>0&&h%4===0)return [...REACH_PATTERNS[(h>>>3)%REACH_PATTERNS.length]!];
 if(['preHeaven','heaven','superHeaven'].includes(normalModeOf(s))&&h%3===0)return [...HIGH_MODE_PATTERNS[(h>>>3)%HIGH_MODE_PATTERNS.length]!];
 const pool:KisekiDigit[]=[0,1,2,3,4,5,6,7,8,'V'],digits=[pool[h%10]!,pool[(h>>>8)%10]!,pool[(h>>>16)%10]!];
 // 普通の外れで確定を思わせる揃い/リーチ目を作らない。
 const bad=()=>digits.every(d=>d===digits[0])||digits[0]==='V'&&digits[2]==='V'||REACH_PATTERNS.some(p=>p.join(',')===digits.join(','));
 for(let i=0;i<pool.length&&bad();i++)digits[2]=pool[(pool.indexOf(digits[2]!)+1)%pool.length]!;
 return digits;
}
export const STAGE_NAMES={apollon:'アポロンステージ',aphrodite:'アフロディーテステージ',artemis:'アルテミスステージ',acropolis:'アクロポリスステージ',athena:'アテナステージ',olympus:'オリンポスステージ',poseidon:'ポセイドンステージ',zeus:'ゼウスステージ',god:'GODステージ',gaia:'ガイアステージ',zzone:'Z-ZONE',zgame:'Z-GAME',sgg:'SUPER GOD GAME'} as const;
export type KisekiStage=keyof typeof STAGE_NAMES;
export function kisekiStage(s:{phase:string;spins:number;normalGames:number;stocks:number;omenAwards:number;mode:'low'|'normal'|'high';normalMode?:NormalMode}):KisekiStage{
 if(s.phase==='pgg')return 'god';
 if(['sgg','sgg-retry'].includes(s.phase))return 'sgg';
 if(['gaia','zzone','zgame'].includes(s.phase))return s.phase as 'gaia'|'zzone'|'zgame';
 const mode=normalModeOf(s),n=digitHash(Math.floor(s.normalGames/20)+Math.floor(s.spins/50))%8;
 if(['gg','gzone'].includes(s.phase))return s.stocks>0&&n<5?(['heaven','superHeaven'].includes(mode)?'zeus':'poseidon'):'olympus';
 if(s.phase==='omen'||s.omenAwards>0)return n%3===0?'acropolis':'athena';
 // ステージ振分も未公表のため独自の示唆表示。高い風景は当選の保証にしない。
 const normal:KisekiStage[]=['apollon','aphrodite','artemis'];
 if(['heaven','superHeaven'].includes(mode)&&n<5||mode==='preHeaven'&&n<2||n===7)return 'acropolis';
 if(n===6)return 'athena';
 return normal[n%3]!;
}

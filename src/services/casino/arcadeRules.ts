import {type ArcadeKind} from '../../domain/casinoArcade.js';
import {cryptoRng,shuffledShoe,rankOf,suitOf,type Rng} from './cards.js';
export const MULT_UNIT=1000,ARCADE_PAYOUT_LIMIT=100_000_000;
export const FORTUNE_MULT=[0,0,500,500,1000,1000,1000,1000,1500,3000];
export const MONEY_MULT=[1900,3800,7600,7600];
export const PLINKO_MULT=[24000,5000,2000,750,310,310,750,2000,5000,24000];
export const POKER_PAYS=[['ロイヤルフラッシュ',250],['ストレートフラッシュ',50],['フォーカード',25],['フルハウス',9],['フラッシュ',6],['ストレート',4],['スリーカード',3],['ツーペア',2],['J以上のワンペア',1],['役なし',0]] as const;
export type ArcadeOptions={choice?:number;picks?:number[]};
export type ArcadeState={v:1;kind:ArcadeKind;done:boolean;step:number;mult:number;result:string;selected:number[];shown:number[];path:number[];rolls:number[][];point:number;index:number;hand:number[];startedAt:number;
 hidden:{mines:number[];tower:number[];traffic:boolean[];deck:number[];crash:number}};
export class ArcadeRuleError extends Error{}
const validInt=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isInteger(v)&&v>=min&&v<=max;
const shuffled=(n:number,rng:Rng)=>{const a=Array.from({length:n},(_,i)=>i);for(let i=n-1;i>0;i--){const j=rng(i+1);[a[i],a[j]]=[a[j]!,a[i]!];}return a;};
const finish=(s:ArcadeState,mult:number,result:string)=>{s.done=true;s.mult=mult;s.result=result;return s;};
export function combinations(n:number,k:number):number{if(k<0||k>n)return 0;let x=1;for(let i=1;i<=k;i++)x=x*(n-i+1)/i;return x;}
export function kenoProbability(picks:number,hits:number){return combinations(picks,hits)*combinations(40-picks,10-hits)/combinations(40,10);}
/** 一致数の4乗に比例。表全体の期待値は丸め前97%。0個一致は0。 */
export function kenoMultipliers(picks:number):number[]{
 if(!validInt(picks,1,10))throw new ArcadeRuleError('選ぶ数字は1〜10個です。');
 const expected=Array.from({length:picks+1},(_,h)=>kenoProbability(picks,h)*h**4).reduce((a,b)=>a+b,0);
 return Array.from({length:picks+1},(_,h)=>Math.floor(970*h**4/expected));
}
export function pokerResult(hand:number[]):{mult:number;name:string}{
 const ranks=hand.map(c=>rankOf(c)===1?14:rankOf(c)).sort((a,b)=>b-a),groups=new Map<number,number>();for(const r of ranks)groups.set(r,(groups.get(r)??0)+1);
 const counts=[...groups.values()].sort((a,b)=>b-a),flush=hand.every(c=>suitOf(c)===suitOf(hand[0]!));
 const straight=groups.size===5&&((ranks[0]! - ranks[4]!)===4||ranks.join() ==='14,5,4,3,2');
 const i=straight&&flush?(ranks[4]===10?0:1):counts[0]===4?2:counts[0]===3&&counts[1]===2?3:flush?4:straight?5:counts[0]===3?6:counts[0]===2&&counts[1]===2?7:[...groups].some(([rank,n])=>n===2&&rank>=11)?8:9;
 return {mult:POKER_PAYS[i]![1]*1000,name:POKER_PAYS[i]![0]};
}
export function cashMultiplier(s:ArcadeState,now:number):number{
 if(s.done)return s.mult;
 if(s.kind==='crash')return Math.min(100_000,Math.floor(Math.exp(Math.max(0,now-s.startedAt)/7000)*1000));
 if(!s.step)return 0;
 const probability=s.kind==='mines'?combinations(22,s.step)/combinations(25,s.step):s.kind==='tower'?(2/3)**s.step:s.kind==='penguin'?.8**s.step:0;
 return probability>0?Math.min(1_000_000,Math.floor(970/probability)):0;
}
function rollCraps(s:ArcadeState,rng:Rng){
 const roll=[1+rng(6),1+rng(6)],sum=roll[0]!+roll[1]!;s.rolls=[...s.rolls,roll].slice(-20);s.step++;
 if(!s.point){if(sum===7||sum===11)return finish(s,2000,'ナチュラル！');if([2,3,12].includes(sum))return finish(s,0,'クラップス');s.point=sum;s.result='ポイント '+sum+'。もう一度出せば勝ち。';}
 else if(sum===s.point)return finish(s,2000,'ポイント成立！');else if(sum===7)return finish(s,0,'セブンアウト');return s;
}
export function newArcade(kind:ArcadeKind,options:ArcadeOptions={},rng:Rng=cryptoRng,now=Date.now()):ArcadeState{
 const s:ArcadeState={v:1,kind,done:false,step:0,mult:0,result:'進むか、途中で受け取るか選べます。',selected:[],shown:[],path:[],rolls:[],point:0,index:-1,hand:[],startedAt:now,hidden:{mines:[],tower:[],traffic:[],deck:[],crash:0}};
 if(kind==='fortune'){s.index=rng(10);return finish(s,FORTUNE_MULT[s.index]!,FORTUNE_MULT[s.index]?'倍率に止まりました':'今回は0倍');}
 if(kind==='moneywheel'){
  if(!validInt(options.choice,0,3))throw new ArcadeRuleError('賭ける色を選んでください。');s.selected=[options.choice!];const roll=rng(40);s.index=roll<20?0:roll<30?1:roll<35?2:3;return finish(s,s.index===options.choice?MONEY_MULT[s.index]!:0,s.index===options.choice?'選んだ色に停止！':'別の色に停止');
 }
 if(kind==='duckrace'){
  if(!validInt(options.choice,0,4))throw new ArcadeRuleError('応援するアヒルを選んでください。');s.selected=[options.choice!];s.index=rng(5);return finish(s,s.index===options.choice?4850:0,(s.index+1)+'番が1着！');
 }
 if(kind==='plinko'){s.path=Array.from({length:9},()=>rng(2));s.index=s.path.reduce((a,b)=>a+b,0);return finish(s,PLINKO_MULT[s.index]!,'ポケット '+(s.index+1)+'に入りました');}
 if(kind==='keno'){
  const picks=options.picks??[];if(!validInt(picks.length,1,10)||new Set(picks).size!==picks.length||picks.some(n=>!validInt(n,1,40)))throw new ArcadeRuleError('1〜40から、重複せず1〜10個選んでください。');
  s.selected=[...picks].sort((a,b)=>a-b);s.shown=shuffled(40,rng).slice(0,10).map(n=>n+1).sort((a,b)=>a-b);s.step=s.selected.filter(n=>s.shown.includes(n)).length;return finish(s,kenoMultipliers(picks.length)[s.step]!,s.step+'個一致');
 }
 if(kind==='mines')s.hidden.mines=shuffled(25,rng).slice(0,3);
 if(kind==='tower')s.hidden.tower=Array.from({length:9},()=>rng(3));
 if(kind==='penguin')s.hidden.traffic=Array.from({length:8},()=>rng(5)!==0);
 if(kind==='videopoker'){const deck=shuffledShoe(1,rng);s.hand=deck.slice(0,5);s.hidden.deck=deck.slice(5);s.result='残す札を選び、1回交換できます。';}
 if(kind==='crash'){s.hidden.crash=Math.max(1000,Math.floor(970_000_000_000/(1+rng(1_000_000_000))));s.result='破裂する前に受け取ろう。';}
 if(kind==='craps')rollCraps(s,rng);
 return s;
}
export type ArcadeAction='pick'|'collect'|'draw'|'roll'|'step'|'settle'|'giveup';
export function actArcade(state:ArcadeState,action:string,choice:number|undefined,picks:number[]|undefined,now:number,rng:Rng=cryptoRng):ArcadeState{
 if(state.v!==1||state.done)throw new ArcadeRuleError('この回は終了しています。');const s=structuredClone(state);
 if(action==='giveup')return finish(s,0,'この回を終了しました');
 if(s.kind==='crash'){
  const mult=cashMultiplier(s,now);if(!['collect','settle'].includes(action))throw new ArcadeRuleError('受取を選んでください。');
  if(mult>=s.hidden.crash)return finish(s,0,'クラッシュ！');
  if(mult>=100_000)return finish(s,100_000,'上限100倍で受取');
  if(action==='settle')throw new ArcadeRuleError('まだ終了していません。');return finish(s,mult,'途中受取');
 }
 if(action==='collect'){
  const mult=cashMultiplier(s,now);if(!['mines','tower','penguin'].includes(s.kind)||!mult)throw new ArcadeRuleError('1回進んでから受け取れます。');return finish(s,mult,'途中受取');
 }
 if(s.kind==='mines'&&action==='pick'){
  if(!validInt(choice,0,24)||s.selected.includes(choice!))throw new ArcadeRuleError('まだ開けていないマスを選んでください。');s.selected.push(choice!);s.step++;
  if(s.hidden.mines.includes(choice!))return finish(s,0,'地雷でした');if(s.step===22)return finish(s,cashMultiplier(s,now),'全ての安全なマスを開きました');s.result=s.step+'マス成功';return s;
 }
 if(s.kind==='tower'&&action==='pick'){
  if(!validInt(choice,0,2)||s.step>=9)throw new ArcadeRuleError('今の階から1マス選んでください。');s.selected.push(choice!);
  if(s.hidden.tower[s.step]===choice)return finish(s,0,'ドラゴンの目に止まりました');s.step++;if(s.step===9)return finish(s,cashMultiplier(s,now),'9階到達！');s.result=s.step+'階到達';return s;
 }
 if(s.kind==='penguin'&&action==='step'){
  if(!s.hidden.traffic[s.step])return finish(s,0,'車に当たりました');s.step++;if(s.step===8)return finish(s,cashMultiplier(s,now),'全ての道を渡りました！');s.result=s.step+'本の道を渡りました';return s;
 }
 if(s.kind==='craps'&&action==='roll')return rollCraps(s,rng);
 if(s.kind==='videopoker'&&action==='draw'){
  const keep=picks??[];if(new Set(keep).size!==keep.length||keep.some(n=>!validInt(n,0,4)))throw new ArcadeRuleError('残す札を確認してください。');s.selected=[...keep];let next=0;s.hand=s.hand.map((c,i)=>keep.includes(i)?c:s.hidden.deck[next++]!);const result=pokerResult(s.hand);return finish(s,result.mult,result.name);
 }
 throw new ArcadeRuleError('この操作はできません。');
}
export function arcadePayout(bet:number,s:ArcadeState){return s.done?Math.floor(bet*s.mult/1000):0;}
export const ARCADE_MAX_MULT:Record<ArcadeKind,number>={fortune:3,moneywheel:7.6,craps:2,duckrace:4.85,crash:100,plinko:24,penguin:6,keno:100,videopoker:250,tower:38,mines:1000};
/** 未停止の山札・地雷・危険階・破裂点を画面へ渡さない。 */
export function arcadePublic(s:ArcadeState,now:number){
 const mult=cashMultiplier(s,now),crashBusted=s.kind==='crash'&&!s.done&&mult>=s.hidden.crash;
 return {v:1,kind:s.kind,done:s.done,step:s.step,mult:s.done?s.mult:crashBusted?0:mult,result:s.result,selected:s.selected,shown:s.shown,path:s.path,rolls:s.rolls,point:s.point,index:s.index,hand:s.hand,startedAt:s.kind==='crash'?s.startedAt:undefined,serverNow:now,
  terminal:s.kind==='crash'&&(crashBusted||mult>=100_000),board:s.kind==='mines'?Array.from({length:25},(_,i)=>s.selected.includes(i)?s.hidden.mines.includes(i)?'bomb':'safe':s.done&&s.hidden.mines.includes(i)?'bomb':'hidden'):undefined};
}
export type ArcadePublic=ReturnType<typeof arcadePublic>;

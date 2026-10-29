import {BET,UNIT,lever,newGaisen,stop,type Phase,type Role,type Setting,type Spin,type RuleVersion} from './engine.js';

import {spinNavi,phaseOutcome} from './phaseRules.js';

export type StopPolicy='follow-navi'|'left-only'|'miss-navi';
export const SIMULATION_VERSION='audit-1';
const PHASES:Phase[]=['normal','omen','gg','gstop','sgg','gzone'];
const ROLES:Role[]=['god','red7','rare','replay','bell','smallBell','none'];
const counts=()=>Object.fromEntries(ROLES.map(role=>[role,0])) as Record<Role,number>;
/** 画面でナビが出る場面だけ利用する。通常時の隠れた押し順は参照しない。 */
export function simulationOrder(p:Spin,policy:StopPolicy):number[]{
 if(p.hold)return [1];
 if(p.phase==='gstop')return [0,1,2];
 const guided=spinNavi(p);
 if(!guided||policy==='left-only')return [0,1,2];
 if(policy==='miss-navi')return [guided[1]!,guided[0]!,guided[2]!];
 return guided.slice();
}
/** 再現用LCG。暗号乱数ではないので実プレイに使用しない。 */
export function simulationRng(seed:number){
 if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw Error('seedは0〜4294967295の整数です。');
 let n=seed>>>0;
 return (max:number)=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return Math.floor(n/4294967296*max);};
}
/** 自然抽選のみ。補充は払出へ混ぜず、未消化権利は最後に別記する。 */
export function simulateGaisen(setting:Setting,games:number,seed:number,policy:StopPolicy='follow-navi',version:RuleVersion='trial-1'){
 if(!Number.isInteger(setting)||setting<1||setting>6)throw Error('設定は1〜6です。');
 if(!Number.isSafeInteger(games)||games<1||games>1000000)throw Error('試算は1〜100万ゲームです。');
 if(!['follow-navi','left-only','miss-navi'].includes(policy))throw Error('押し順の条件を確認してください。');
 const rng=simulationRng(seed),s=newGaisen(setting,version),initialBalance=s.balance;
 let minNet=0,maxNet=0,refills=0,maxDrawdown=0,peak=0,paidGames=0,replayCredits=0;
 let maxNormalGames=0,maxChainSets=0,completedChains=0,awardedSets=0,startedSets=0;
 const phases:Record<string,number>={};
 const byPhase=Object.fromEntries(PHASES.map(phase=>[phase,{
  games:0,input:0,output:0,replayCredits:0,net:0,roles:counts(),paidByRole:counts(),
  bellHits:0,bellMisses:0,awardedSets:0,firsts:0,sggEntries:0,
 }])) as Record<Phase,{games:number;input:number;output:number;replayCredits:number;net:number;
  roles:Record<Role,number>;paidByRole:Record<Role,number>;bellHits:number;bellMisses:number;
  awardedSets:number;firsts:number;sggEntries:number}>;
 const transitions:Record<string,number>={};
 for(let i=0;i<games;i++){
  if(s.balance<BET){s.balance+=100000;refills++;}
  const phase=s.phase,before={input:s.input,output:s.output,firsts:s.firsts,sggs:s.sggs,sets:s.sets};
  phases[phase]=(phases[phase]??0)+1;
  lever(s,rng);
  // STOP前に必要なBETも資金の最大落ち込みに含む。最高値は確定後の収支。
  maxDrawdown=Math.max(maxDrawdown,peak-(s.output-s.input));
  const p=s.pending!,role=p.role;
  for(const reel of simulationOrder(p,policy))stop(s,reel,rng);
  const t=byPhase[phase],input=s.input-before.input,output=s.output-before.output;
  t.games++;t.input+=input;t.output+=output;t.net+=output-input;t.roles[role]++;t.paidByRole[role]+=output;
  if(p.model?phaseOutcome(p).replay:role==='replay'){replayCredits+=output;t.replayCredits+=output;}else paidGames++;
  if(role==='bell'){if(p.model?phaseOutcome(p).correct:output>0)t.bellHits++;else t.bellMisses++;}
  const added=s.winEvent?.added??0;t.awardedSets+=added;awardedSets+=added;
  t.firsts+=s.firsts-before.firsts;t.sggEntries+=s.sggs-before.sggs;
  if(s.sets>before.sets)startedSets+=s.sets-before.sets;
  maxChainSets=Math.max(maxChainSets,s.sets);
  if(before.sets>0&&s.sets===0)completedChains++;
  maxNormalGames=Math.max(maxNormalGames,s.normalGames);
  if(s.phase!==phase){const key=phase+'->'+s.phase;transitions[key]=(transitions[key]??0)+1;}
  const net=s.output-s.input;minNet=Math.min(minNet,net);maxNet=Math.max(maxNet,net);peak=Math.max(peak,net);
  if(s.pending||s.balance!==initialBalance+refills*100000+net||s.stocks<0||s.ggLeft<0||s.sggLeft<0)
   throw Error('試算で状態または収支の不整合を検出しました。');
 }
 return {version,setting,games,seed,policy,input:s.input,output:s.output,
  // 旧試算と互換の投入/払出。リプレイ返却を両辺に含む。
  returnPercent:Number((s.output/s.input*100).toFixed(3)),net:s.output-s.input,
  // 実消費の観点も別記。実機媒体の機械割と同じ定義とは断言しない。
  paidInput:s.input-replayCredits,paidOutput:s.output-replayCredits,replayCredits,paidGames,
  minNet,maxNet,maxDrawdown,refills,refillPoints:refills*100000,initialBalance,finalBalance:s.balance,
  phases,byPhase,transitions,god:s.gods,ggFirsts:s.firsts,sgg:s.sggs,
  awardedSets,startedSets,completedChains,maxChainSets,maxNormalGames,
  unfinished:{phase:s.phase,ggLeft:s.ggLeft,stocks:s.stocks,sets:s.sets,normalGames:s.normalGames,
   omen:s.omen,gstopLeft:s.gstopLeft,hold:s.hold,sggLeft:s.sggLeft,medusa:s.medusa,ex:s.ex,
   gstopReturn:s.gstopReturn,sggReturn:s.sggReturn,gstopQueue:s.gstopQueue??0,symbolHistory:s.symbolHistory??[]},provisional:true};
}
export type GaisenSimulation=ReturnType<typeof simulateGaisen>;
/** 同一ゲーム数・同一設定・同じ操作条件の試算だけまとめる。 */
export function summarizeGaisen(samples:GaisenSimulation[]){
 const first=samples[0];
 if(!first||samples.some(s=>s.setting!==first.setting||s.games!==first.games||s.policy!==first.policy||s.version!==first.version)
  ||new Set(samples.map(s=>s.seed)).size!==samples.length)throw Error('異なるseedで、同じ設定・ゲーム数・操作条件を指定してください。');
 const total=(f:(s:GaisenSimulation)=>number)=>samples.reduce((n,s)=>n+f(s),0);
 const range=(f:(s:GaisenSimulation)=>number)=>{const v=samples.map(f).sort((a,b)=>a-b);return {
  min:v[0]!,p10:v[Math.ceil(v.length*.1)-1]!,median:v[Math.ceil(v.length*.5)-1]!,p90:v[Math.ceil(v.length*.9)-1]!,max:v.at(-1)!,
 };};
 const input=total(s=>s.input),output=total(s=>s.output);
 const phaseTotals=Object.fromEntries(PHASES.map(phase=>{
  const games=total(s=>s.byPhase[phase].games),paid=total(s=>s.byPhase[phase].output),spent=total(s=>s.byPhase[phase].input);
  return [phase,{games,input:spent,output:paid,net:paid-spent,netUnitsPerGame:games?(paid-spent)/games/UNIT:null,
   red7:total(s=>s.byPhase[phase].roles.red7),gods:total(s=>s.byPhase[phase].roles.god),
   replayCredits:total(s=>s.byPhase[phase].replayCredits),smallBellOutput:total(s=>s.byPhase[phase].paidByRole.smallBell),
   bellHits:total(s=>s.byPhase[phase].bellHits),bellMisses:total(s=>s.byPhase[phase].bellMisses),
   awardedSets:total(s=>s.byPhase[phase].awardedSets)}];
 }));
 return {version:first.version,setting:first.setting,policy:first.policy,runs:samples.length,gamesPerRun:first.games,games:total(s=>s.games),
  input,output,returnPercent:output/input*100,runReturnPercent:range(s=>s.output/s.input*100),
  sessionNet:range(s=>s.net),maxDrawdown:range(s=>s.maxDrawdown),positiveRuns:samples.filter(s=>s.net>0).length,
  zeroRuns:samples.filter(s=>s.net===0).length,refills:total(s=>s.refills),
  gods:total(s=>s.god),ggFirsts:total(s=>s.ggFirsts),sgg:total(s=>s.sgg),
  maxObservedChainSets:Math.max(...samples.map(s=>s.maxChainSets)),phaseTotals,
  note:'seed別の観測範囲・nearest-rank分位点。信頼区間や将来の最大損失ではない。未消化権利は払出に含めない。'};
}

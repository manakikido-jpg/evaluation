/** DB・Discord・設定を読み込まない開発用の自然抽選監査。JSONだけを標準出力へ返す。 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {BET,RULE_VERSION,drawRole,lever,newGaisen,stop,ORDERS,type Role,type Setting} from '../services/casino/gaisen/engine.js';
import {SIMULATION_VERSION,simulateGaisen,summarizeGaisen,type StopPolicy} from '../services/casino/gaisen/simulation.js';

if(process.argv.length>2)throw Error('引数はありません。node --import tsx src/scripts/gaisen-audit.ts > /tmp/gaisen-audit.json');
const seeds=[71,2026,449],settings:Setting[]=[1,2,3,4,5,6];
const sourceHashes=Object.fromEntries(['engine.ts','simulation.ts'].map(name=>[name,
 createHash('sha256').update(readFileSync(new URL('../services/casino/gaisen/'+name,import.meta.url))).digest('hex')]));
// 現在の区間共通フラグを全列挙。将来drawRoleを区間別にする際は、この監査も更新する。
const flags:Partial<Record<Role,number>>={};
for(let i=0;i<65536;i++){const role=drawRole(()=>i);flags[role]=(flags[role]??0)+1;}
const expectations=Object.fromEntries((['normal','gg'] as const).map(phase=>{
 let meanOutput=0;const byRole:Partial<Record<Role,number>>={};
 for(const role of Object.keys(flags) as Role[]){let paid=0;
  for(let order=0;order<6;order++){
   const s=newGaisen();s.phase=phase;s.ggLeft=100;
   lever(s,()=>0,role);s.pending!.order=ORDERS[order]!.slice();
   for(const reel of phase==='gg'?ORDERS[order]!:[0,1,2])stop(s,reel,()=>1);
   paid+=s.lastPaid;
  }
  const contribution=flags[role]!/65536*paid/6;byRole[role]=contribution;meanOutput+=contribution;
 }
 return [phase,{meanOutput,netUnitsPerGame:(meanOutput-BET)/10,byRole,
  note:'現行フラグ分布×6押し順を列挙した1Gの期待払出。通常は左中右、GGはナビ遵守。区間移行後の価値は含まない。'}];
}));
function batch(setting:Setting,games:number,runSeeds:number[],policy:StopPolicy){
 process.stderr.write(`設定${setting} ${policy} ${games}G × ${runSeeds.length}\n`);
 const samples=runSeeds.map(seed=>simulateGaisen(setting,games,seed,policy));
 return {summary:summarizeGaisen(samples),samples};
}
const longRuns=settings.map(setting=>batch(setting,1000000,seeds,'follow-navi'));
const policyComparison=settings.map(setting=>({setting,runs:(['follow-navi','left-only','miss-navi'] as const)
 .map(policy=>batch(setting,100000,seeds,policy))}));
const shortSessions=settings.map(setting=>{
 const {summary,samples}=batch(setting,1000,Array.from({length:100},(_,i)=>10001+i),'follow-navi');
 // 短期600本は再集計に必要な項目だけ保存し、同じ役別表を大量に重複させない。
 return {summary,samples:samples.map(s=>({seed:s.seed,input:s.input,output:s.output,net:s.net,
  maxDrawdown:s.maxDrawdown,refills:s.refills,god:s.god,ggFirsts:s.ggFirsts,sgg:s.sgg,unfinished:s.unfinished}))};
});
process.stdout.write(JSON.stringify({schema:SIMULATION_VERSION,rules:RULE_VERSION,sourceHashes,
 method:{random:'LCG32 (1664525,1013904223), 既存試算と同じ。実プレイの暗号乱数ではない。',
  initial:'毎回通常0G・10万試遊ポイント、自然抽選。強制当選・場面見本なし。',
  navi:'無料試遊と同じくbellかつgg/sgg/gzoneでのみ参照。G-STOPは左中右、HOLDは中。',
  balance:'不足時10万を補充。補充をinput/output/netには含めない。',
  returns:'output/input。リプレイの30返却を両辺に含む。実機公表機械割と直接同一視しない。',
  ending:'指定ゲーム数で打切り。残りGG/ストック/各特殊区間の権利は別記し、換金しない。',
  distribution:'短期は毎回通常0Gから独立開始。seed間の範囲と観測分位点であり、信頼区間ではない。',
  safeguards:'各ゲームで残高整合・pending解消・ストック/残りG非負を検査。DB・本番保存を参照しない。'},
 flags,expectations,longRuns,policyComparison,shortSessions},null,2)+'\n');

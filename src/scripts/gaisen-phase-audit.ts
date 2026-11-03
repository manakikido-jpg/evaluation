/** 区間別の新試遊を再現する。DB・実財布・本番設定には接続しない。 */
import {SGG_LOOP_WEIGHTS} from '../services/casino/gaisen/sggLoopRules.js';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PHASE_TABLES,PHASE_DRAW_SIZE,FLAGS} from '../services/casino/gaisen/phaseRules.js';
import {MEDUSA_WEIGHTS,MEDUSA_RESET_WEIGHTS,EX_ENTRY_WEIGHTS,EX_RESET_WEIGHTS} from '../services/casino/gaisen/sggRules.js';
import {INITIAL_OMEN_WEIGHTS} from '../services/casino/gaisen/omenRules.js';
import {simulateGaisen,summarizeGaisen,type StopPolicy} from '../services/casino/gaisen/simulation.js';
import type {Setting} from '../services/casino/gaisen/engine.js';

if(process.argv.length>2)throw Error('引数はありません。node --import tsx src/scripts/gaisen-phase-audit.ts > /tmp/gaisen-phase-audit.json');
const seeds=[71,2026,449],settings:Setting[]=[1,2,3,4,5,6];
const sourceHashes=Object.fromEntries(['engine.ts','phaseRules.ts','historyRules.ts','omenRules.ts','sggRules.ts','sggLoopRules.ts','modeRules.ts','loopRules.ts','gstopRules.ts','simulation.ts'].map(name=>[name,
 createHash('sha256').update(readFileSync(new URL('../services/casino/gaisen/'+name,import.meta.url))).digest('hex')]));
function batch(setting:Setting,games:number,policy:StopPolicy,start:'normal'|'reset'='normal'){
 process.stderr.write(`trial-2 設定${setting} ${policy} ${start} ${games}G × ${seeds.length}\n`);
 const samples=seeds.map(seed=>simulateGaisen(setting,games,seed,policy,'trial-2',start));
 return {summary:summarizeGaisen(samples),samples};
}
const expectations=Object.fromEntries(Object.entries(PHASE_TABLES).map(([phase,rows])=>{
 const outputUnits=rows.reduce((n,r)=>n+FLAGS[r.flag].units*r.weight/PHASE_DRAW_SIZE,0);
 return [phase,{outputUnits,netUnitsPerGame:outputUnits-3,
  note:'公開丸め値から作った役表の1G期待値。ナビ遵守/目押し補助。次の当選権利は含まない。'}];
}));
const resetRuns=settings.map(setting=>batch(setting,100000,'follow-navi','reset'));
const longRuns=settings.map(setting=>batch(setting,1000000,'follow-navi'));
const policyComparison=settings.map(setting=>({setting,runs:(['follow-navi','left-only','miss-navi'] as const).map(policy=>batch(setting,100000,policy))}));
process.stdout.write(JSON.stringify({schema:'phase-audit-7',modes:'front-back-1',gstop:'groups-hold-1',reset:'reserved-once-1',sgg:'medusa-ex-all-loops-3',rules:'trial-2',history:'history-1',omen:'initial-and-ceiling-1',sourceHashes,
 method:{seeds,longGamesPerRun:1000000,policyGamesPerRun:100000,
  random:'LCG32。trial-1の監査と同じseed/ゲーム数だが抽選モデルの違いで乱数消費順は異なる。',
  start:'通常0G・試遊10万ポイント。不足時の補充は投入/払出から除外。',
  replay:'リプレイは30返却。共通赤7、逆押し赤7、下段黄7、フェイク、中段青7も含む。',
  comparison:'docs/gaisen-odds-audit.json のtrial-1を比較元とする。旧結果は上書きしない。',
  limits:'通常/裏モード・役/履歴/GOD/赤7/SGGの追加ループ・G-STOP群/HOLD/リーチ目を追加。設定変更開始はresetRunsで別記。資料差の採用規則、未公表の鏡高確移行、EXと時間停止の重複、判定順などはdocs/gaisen-completion.md参照。未消化権利/ループは払出に含めない。実機の機械割ではない。'},
 drawSize:PHASE_DRAW_SIZE,tables:PHASE_TABLES,initialOmenWeights:INITIAL_OMEN_WEIGHTS,sggTables:{normalResetLoops:SGG_LOOP_WEIGHTS,medusa:MEDUSA_WEIGHTS,reset:MEDUSA_RESET_WEIGHTS,exEntry:EX_ENTRY_WEIGHTS,exReset:EX_RESET_WEIGHTS},expectations,longRuns,resetRuns,policyComparison},null,2)+'\n');

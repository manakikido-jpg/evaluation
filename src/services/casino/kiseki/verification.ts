import {lever,navi,newKiseki,stop} from './engine.js';
import {DRAW_SIZE,ROLE_WEIGHTS,ROLES,decorationLine,drawRole,pattern,roleRows,rows,winningLines,type KisekiRole} from './rules.js';

/** DB/Discord/実財布を使わず、独立した固定seedで試遊モデルの整合性を確認する。 */
export function verifyKiseki({games=1000,draws=100000,seed=20261106,mode='assist'}:{games?:number;draws?:number;seed?:number;mode?:'assist'|'timing'|'legacy'}={}){
 if(!Number.isSafeInteger(games)||games<1||games>20000||!Number.isSafeInteger(draws)||draws<1||draws>2000000||!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff||!['assist','timing','legacy'].includes(mode))throw Error('試行数・seed・停止方法を確認してください。');
 const random=(initial:number)=>{let state=initial>>>0,calls=0;return {next:(size:number)=>{calls++;state=(Math.imul(state,1664525)+1013904223)>>>0;return Math.floor(state/4294967296*size);},calls:()=>calls};};
 const draw=random(seed),game=random(seed^0x9e3779b9),counts=Object.fromEntries((Object.keys(ROLES) as KisekiRole[]).map(role=>[role,0])) as Record<KisekiRole,number>;
 for(let i=0;i<draws;i++)counts[drawRole(draw.next)]++;
 const phases:Record<string,number>={},gameRoles={...counts};for(const role of Object.keys(gameRoles) as KisekiRole[])gameRoles[role]=0;
 const initial=1000000000;let state=newKiseki();state.balance=initial;
 for(let i=0;i<games;i++){
  phases[state.phase]=(phases[state.phase]??0)+1;lever(state,game.next,undefined,mode!=='legacy');
  for(const index of navi(state)??[0,1,2])stop(state,index,game.next,mode==='timing'?(i*7+index*3)%20:undefined);
  const role=state.lastRole!,p=pattern(state.lastLayout);gameRoles[role]++;
  if(state.balance!==initial-state.input+state.output||state.lastPaid<0||decorationLine(state.lastPositions))throw Error('ポイントまたは装飾の停止窓が一致しません。');
  if(state.lastCorrect&&p){const symbols=state.lastPositions.map((position,reel)=>rows(reel,position)[roleRows(state.lastLayout)[reel]!]);if(symbols.join()!==p.symbols.join())throw Error('役の停止窓が一致しません。');}
  else if(winningLines(state.lastPositions).length)throw Error('払出しのない当たり窓を確認してください。');
  if(i%17===0)state=JSON.parse(JSON.stringify(state)) as typeof state;
 }
 return {model:'独自の暫定試遊モデル（実機の機械割ではありません）',seed,games,draws,mode,drawCalls:game.calls(),
  roles:ROLE_WEIGHTS.map(({role,weight})=>({role,name:ROLES[role].name,weight,probability:weight/DRAW_SIZE,observed:counts[role],observedProbability:counts[role]/draws})),
  gameRoles,phases,input:state.input,returned:state.output,netPoints:state.balance-initial,modelReturnPercent:100*state.output/state.input,invariants:true,realWalletUsed:false};
}

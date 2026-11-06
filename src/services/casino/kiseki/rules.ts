import type {Rng} from '../cards.js';
import type {ReelSymbol} from '../gaisen/reelRules.js';
/** 一撃の公開概数。丸め誤差はハズレで調整し、確定役を再正規化しない。 */
export const DRAW_SIZE=2**24,BET=30,UNIT=10;
export const ROLES={
 god:{name:'GOD揃い',denominator:16384,units:15},red:{name:'赤7揃い',denominator:6900,units:15},sp:{name:'SP役',denominator:65536,units:15},
 middleBlue:{name:'中段リプレイ',denominator:109.2,units:3},diagonal:{name:'右上がり黄7',denominator:186.2,units:15},middleGold:{name:'中段黄7',denominator:963.8,units:15},
 fake:{name:'赤7フェイクリプレイ',denominator:936.2,units:3},blue:{name:'上段リプレイ',denominator:7.9,units:3},small:{name:'下段黄7B',denominator:18.4,units:3},
 gaia:{name:'ガイアベル',denominator:37.6,units:1},bell:{name:'押し順黄7',denominator:1.7,units:15},none:{name:'ハズレ',denominator:0,units:0},
} as const;
export type KisekiRole=keyof typeof ROLES;
export const ROLE_WEIGHTS:{role:KisekiRole;weight:number}[]=(Object.keys(ROLES) as KisekiRole[]).filter(r=>r!=='none').map(role=>({role,weight:Math.round(DRAW_SIZE/ROLES[role].denominator)}));
ROLE_WEIGHTS.push({role:'none',weight:DRAW_SIZE-ROLE_WEIGHTS.reduce((n,r)=>n+r.weight,0)});
export function drawRole(rng:Rng,z=false):KisekiRole{
 if(!z){let n=rng(DRAW_SIZE);for(const r of ROLE_WEIGHTS){if(n<r.weight)return r.role;n-=r.weight;}throw Error('乱数の範囲を確認してください。');}
 // Z中の確定役は先に同じ確率で抽選。残りを黄7約1/1.4と青7/ハズレへ割当てる試遊モデル。
 const n=rng(DRAW_SIZE);let edge=0;for(const role of ['god','red','sp'] as const){edge+=Math.round(DRAW_SIZE/ROLES[role].denominator);if(n<edge)return role;}
 return n<DRAW_SIZE/1.4?'bell':n<DRAW_SIZE*.86?'blue':'none';
}
/** 独自の20コマ。実機配列の転載ではない。通常時は目押しによる取りこぼしを作らない。 */
export const STRIPS:readonly (readonly ReelSymbol[])[]=[
 ['god','gold7','blue7','red7','crest','god','gold7','blue7','red7','flower','god','gold7','blue7','red7','crest','god','gold7','blue7','red7','flower'],
 ['gold7','blue7','god','red7','crest','gold7','red7','god','blue7','flower','gold7','blue7','god','red7','crest','gold7','red7','god','blue7','flower'],
 ['god','red7','blue7','gold7','crest','god','red7','blue7','gold7','flower','god','red7','blue7','gold7','crest','god','red7','blue7','gold7','flower'],
];
export const LINES=[[0,0,0],[1,1,1],[2,2,2],[2,1,0],[0,1,2]];
export function rows(reel:number,pos:number):ReelSymbol[]{const s=STRIPS[reel]!;return [s[(pos+1)%20]!,s[pos]!,s[(pos+19)%20]!];}
/** 桜・紋章は払出役ではないため、新しい停止候補では3つの見せかけ揃いを避ける。 */
export function decorationLine(positions:(number|null)[]):boolean{
 if(positions.some(p=>p===null))return false;
 return LINES.some(line=>{const symbols=line.map((row,i)=>rows(i,positions[i]!)[row]!);return ['flower','crest'].includes(symbols[0]!)&&symbols.every(s=>s===symbols[0]);});
}
export function winningLines(positions:(number|null)[]):{line:number;symbols:ReelSymbol[]}[]{
 if(positions.some(p=>p===null))return [];
 return LINES.flatMap((line,n)=>{const symbols=line.map((row,i)=>rows(i,positions[i]!)[row]!);return symbols.every(s=>s===symbols[0])&&['god','red7','blue7','gold7'].includes(symbols[0]!)||symbols.join(',')==='red7,red7,god'?[{line:n,symbols}]:[];});
}
export function pattern(role:KisekiRole):{line:number;symbols:ReelSymbol[]}|null{
 if(role==='none')return null;
 const line=role==='blue'?0:['bell','small'].includes(role)?2:role==='diagonal'?3:1;
 const symbols:ReelSymbol[]=role==='god'?['god','god','god']:role==='red'?['red7','red7','red7']:role==='sp'?['red7','red7','god']:['blue','middleBlue'].includes(role)?['blue7','blue7','blue7']:role==='fake'?['red7','blue7','red7']:role==='gaia'?['gold7','gold7','gold7']:['gold7','gold7','gold7'];
 // ガイアベルは小V（上・中・上）。通常の一直線ラインとは区別する。
 return {line:role==='gaia'?5:line,symbols};
}
export function roleRows(role:KisekiRole){return role==='gaia'?[0,1,0]:LINES[pattern(role)?.line??1]!;}
const plans=new Map<KisekiRole,number[]>();
export function stopPlan(role:KisekiRole):number[]{
 if(plans.has(role))return plans.get(role)!.slice();
 const p=pattern(role),line=roleRows(role);
 const options=STRIPS.map((_,reel)=>Array.from({length:20},(_,i)=>i).filter(i=>!p||rows(reel,i)[line[reel]!]===p.symbols[reel]).filter(i=>reel!==1||role!=='small'||rows(reel,i)[0]==='god'&&rows(reel,i)[1]==='red7').filter(i=>reel!==1||role!=='bell'||rows(reel,i)[1]!=='red7'));
 for(const a of options[0]!)for(const b of options[1]!)for(const c of options[2]!){const pos=[a,b,c],wins=winningLines(pos);if(!decorationLine(pos)&&wins.every(w=>role==='fake'&&w.symbols.every(s=>s==='blue7')||p&&w.line===p.line&&w.symbols.join()===p.symbols.join())){plans.set(role,pos);return pos.slice();}}
 throw Error('停止形を作れません：'+role);
}
export function missPosition(reel:number,stopped:(number|null)[]):number{
 for(let p=0;p<20;p++){const a=stopped.slice();a[reel]=p;if(a.some(v=>v===null)||!winningLines(a).length&&!decorationLine(a))return p;}
 throw Error('外れの停止位置を確認してください。');
}
export const SGG_GAMES=[10,20,30,50,100];
export function sggGames(set:number,role:KisekiRole,rng:Rng):number{
 const fifth=set%5===0;
 const weights=role==='sp'?(fifth?[0,0,0,0,100]:[0,0,0,50,50]):role==='middleGold'?(fifth?[0,0,50,25,25]:[0,50,25,12.5,12.5]):['middleBlue','diagonal'].includes(role)?(fifth?[0,50,25,12.5,12.5]:[0,69.5,20.3,5.1,5.1]):['none','blue','bell','small'].includes(role)?(fifth?[0,79.5,13.6,3.4,3.4]:[83,11.4,3.4,1.1,1.1]):(fifth?[0,88.3,7.8,2,2]:[88.3,7.8,2.3,.8,.8]);
 let n=rng(10000)*weights.reduce((a,b)=>a+b,0)/10000;for(let i=0;i<5;i++){if(n<weights[i]!)return SGG_GAMES[i]!;n-=weights[i]!;}return 100;
}

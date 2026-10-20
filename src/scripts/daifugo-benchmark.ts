/** DB・Discordへ接続せず、同じ公開ルールで先読みBOTを強いBOT3人と比較する。 */
import { active, daifugo, dBotLookahead, dBotStrong, type DaifugoRule, type DaifugoState } from '../services/casino/tables/party.js';
import { guildConfigSchema } from '../config.js';
const rounds=Number(process.argv[2] ?? 4);
if(!Number.isInteger(rounds)||rounds<4||rounds>100||rounds%4)throw Error('対戦数は4〜100の4の倍数にしてください。例: npx tsx src/scripts/daifugo-benchmark.ts 16');
const config=guildConfigSchema.parse({guildId:'900000000000000000',channels:{keiji:'900000000000000001'},roles:{yakudoshi:'100000000000000009'},ranks:[{key:'sanpaisha',name:'参拝者',emoji:'🌸',roleId:'100000000000000001',weight:1,auto:true,requiredGoen:0}]});
const groups:{name:string;rules:DaifugoRule[]}[]=[
 {name:'基本',rules:['revolution','eight','joker']},
 {name:'階段・反則上がり',rules:['revolution','eight','joker','stairs','foul']},
 {name:'7渡し・10捨て',rules:['revolution','eight','joker','give7','drop10']},
 {name:'バック・しばり・逆回り',rules:['revolution','eight','joker','jback','shibari','reverse9']},
];
for(const group of groups){
 let total=0,first=0,fouls=0;
 for(let game=0;game<rounds;game++){
  let seed=300+game;const rng=(n:number)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return Math.floor(seed/4294967296*n);};
  const ctx={cfg:config,now:1000000,rng};const who={id:'760000000000000001',name:'比較用'};
  const take=(r:ReturnType<typeof daifugo.create>):DaifugoState=>{if(!r.ok)throw Error(r.error);return r.state;};
  let s=take(daifugo.create(who,{entry:'0',rules_set:'1',rules:group.rules},ctx));
  for(let i=0;i<3;i++)s=take(daifugo.act(s,who.id,{action:'add_bot'},ctx));
  s=take(daifugo.act(s,who.id,{action:'start'},ctx));const target=game%4;
  let steps=0;
  for(;steps<2000&&active(s).length>1;steps++){const i=s.turn!;s=take((i===target?dBotLookahead:dBotStrong)(structuredClone(s),i));}
  if(active(s).length>1)throw Error(group.name+'で終局しませんでした');
  const order=[...s.order,...s.seats.filter(x=>!x.out).map(x=>x.id),...[...(s.fouls??[])].reverse()];
  const place=order.indexOf(s.seats[target]!.id);if(place<0)throw Error('順位がありません');
  total+=place;first+=Number(place===0);fouls+=Number(s.fouls?.includes(s.seats[target]!.id));
 }
 console.log(JSON.stringify({rules:group.name,rounds,meanPlace:Number((total/rounds+1).toFixed(3)),sameStrengthPlace:2.5,firstRate:first/rounds,fouls,note:'強いBOT3人に対する比較。人との実績・運営収支の予測ではありません。'}));
}

import type {GuildConfig} from '../../config.js';
import {keiba,type KbState} from './tables/keiba.js';
import type {Ctx} from './tables/types.js';
/** DBや銭を動かさない固定レースでの試算。日額枠は未使用の前提。 */
export function balanceScenarios(cfg:GuildConfig){
 return [{name:'無投票・単独所有',bet:0,shared:false},{name:'少人数・最小額',bet:cfg.casino.minBet,shared:false},{name:'共同所有・最小額',bet:cfg.casino.minBet,shared:true}].map(scenario=>{
  let seed=17;const owner='760000000000000001',other='760000000000000002';
  const ctx:Ctx={cfg,now:Date.parse('2026-10-27T00:00:00Z'),rng:n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return Math.floor(seed/2**32*n);}};
  let r=keiba.create({id:owner,name:'試算'}, {dist:'1600',cls:'0'},ctx);if(!r.ok)throw Error('balance create');let state=r.state;
  state.horses.forEach(h=>{h.ownerId=owner;if(scenario.shared)h.shares=[{memberId:owner,units:5},{memberId:other,units:5}];});
  if(scenario.bet){r=keiba.act(state,owner,{action:'bet',type:'win',a:'1',bet:String(scenario.bet)},ctx);if(!r.ok)throw Error('balance bet');state=r.state;}
  r=keiba.act(state,owner,{action:'start'},ctx);if(!r.ok)throw Error('balance start');state=r.state;
  const result=keiba.tick(state,{...ctx,now:state.deadline+1});if(!result?.ok)throw Error('balance result');
  const capped=new Map<string,number>();let ownerPaid=0,betPaid=0;
  for(const c of result.fx?.credits??[]){if(c.reason!=='keiba_prize'){betPaid+=c.amount;continue;}let amount=c.amount;if(c.cap){const limit=c.cap==='keiba_purse'?cfg.casino.keibaNoBetDailyCap:cfg.casino.keibaBetDailyCap,key=c.memberId+':'+c.cap,used=capped.get(key)??0;amount=limit>0?Math.min(amount,Math.max(0,limit-used)):amount;capped.set(key,used+amount);}ownerPaid+=amount;}
  return {name:scenario.name,bet:scenario.bet,betPaid,ownerPaid,net:scenario.bet-betPaid-ownerPaid};
 });
}

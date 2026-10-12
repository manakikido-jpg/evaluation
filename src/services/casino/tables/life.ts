import { addLog, partyEngine, SHARES, type PartyBase } from './partyBase.js';
import { fail, intOf, ok, str, type Ctx, type Form, type Step, type TableEngine } from './types.js';

/** イベントで動く資金はゲーム内だけ。実際の銭は参加費を順位で分ける。 */
export const LIFE_TURN_SECONDS = 45;
export const LIFE_BOARD = [
  ['🌱','旅立ち','start'], ['🎁','門出の祝い','gift'], ['💼','昇給','promotion'], ['🎲','できごと','luck'], ['💍','家族が増える','family'], ['🎨','趣味を楽しむ','hobby'],
  ['💰','給料日','pay'], ['💼','昇給','promotion'], ['🏠','家を買う？','house'], ['🔧','修理代','accident'], ['🏮','お祭りの手伝い','festival'], ['🛡','保険に入る？','insurance'],
  ['💰','給料日','pay'], ['🧳','旅行に行く','travel'], ['💼','昇給','promotion'], ['🎲','できごと','luck'], ['🍼','家族が増える','family'], ['🌿','暮らしの手入れ','maintenance'],
  ['💰','給料日','pay'], ['🎁','贈り物を受け取る','gift'], ['🔧','修理代','accident'], ['🏠','家を買う？','house'], ['🛍','買い物を楽しむ','shopping'], ['🎲','できごと','luck'],
  ['💰','給料日','pay'], ['👪','家族の祝い','celebrate'], ['💼','昇給','promotion'], ['🔧','修理代','accident'], ['🏮','お祭りの手伝い','festival'], ['🛡','保険に入る？','insurance'],
  ['💰','給料日','pay'], ['🔧','修理代','accident'], ['🏮','お祭りの手伝い','festival'], ['🎨','趣味を楽しむ','hobby'], ['🌿','貯金の祝い','gift'], ['🏁','ゴール','goal'],
] as const;
export const LIFE_GOAL = LIFE_BOARD.length - 1;
export type LifePlayer = { position: number; money: number; salary: number; job: string; house: boolean; insured: boolean; family: number };
export type LifeState = PartyBase & { kind: 'life'; people: Record<string, LifePlayer>; nonce: number; lastRoll: { id: string; die: number; from: number; to: number } | null; pending: { by: number; kind: 'career' | 'house' | 'insurance' } | null };
export const lifeAssets = (p: LifePlayer) => p.money + (p.house ? 750 : 0) + p.family * 100;
const player = () : LifePlayer => ({ position: 0, money: 1000, salary: 160, job: 'これから選ぶ', house: false, insured: false, family: 0 });
function next(s: LifeState, from: number) {
  for (let n=1;n<=s.seats.length;n++) {
    const index=(from+n)%s.seats.length;
    if (s.people[s.seats[index]!.id]!.position<LIFE_GOAL) { s.turn=index; return; }
  }
  s.turn=null;
  s.seats.forEach(x=>{x.out=true;});
}
function move(s: LifeState, i: number, ctx: Ctx): Step<LifeState> {
  const seat=s.seats[i]!, p=s.people[seat.id]!;
  const from=p.position, die=ctx.rng(6)+1;
  p.position=Math.min(LIFE_GOAL,from+die);
  s.nonce++;
  s.lastRoll={id:seat.id,die,from,to:p.position};
  const paydays=Math.floor(Math.min(p.position,30)/6)-Math.floor(Math.min(from,30)/6);
  p.money+=paydays*p.salary;
  addLog(s,`${seat.name}：🎲 ${die} → ${p.position}マス${paydays ? `・給料 +${paydays*p.salary}G` : ''}`);
  const tile=LIFE_BOARD[p.position]![2];
  let amount=0;
  switch(tile) {
    case 'gift': amount=100; break;
    case 'promotion': p.salary+=40; addLog(s,`${seat.name}：昇給！給料は${p.salary}Gに`); break;
    case 'luck': amount=[-300,-100,200,400][ctx.rng(4)]!; break;
    case 'family': p.family++; amount=-150; break;
    case 'hobby': amount=-100; break;
    case 'travel': amount=-120; break;
    case 'shopping': amount=-180; break;
    case 'festival': amount=200; break;
    case 'accident': amount=p.insured ? -40 : -220; break;
    case 'maintenance': amount=p.house ? -100 : 100; break;
    case 'celebrate': amount=100+p.family*100; break;
    case 'house': if (!p.house) s.pending={by:i,kind:'house'}; break;
    case 'insurance': if (!p.insured) s.pending={by:i,kind:'insurance'}; break;
    case 'goal': amount=500; break;
  }
  p.money+=amount;
  if (amount) addLog(s,`${seat.name}：${LIFE_BOARD[p.position]![1]} ${amount>0?'+':''}${amount}G`);
  if (!s.pending) next(s,i);
  return ok(s);
}
function choose(s: LifeState,i:number,value:string):Step<LifeState> {
  if (!s.pending || s.pending.by!==i) return fail('invalid');
  const seat=s.seats[i]!,p=s.people[seat.id]!,kind=s.pending.kind;
  if (kind==='career') {
    if (!['work','study'].includes(value)) return fail('invalid');
    p.job=value==='work'?'すぐに就職':'学んでから就職';
    p.salary=value==='work'?160:240;
    if(value==='study') p.money-=300;
    addLog(s,`${seat.name}：${p.job}・給料${p.salary}G`);
  } else {
    if (!['buy','skip'].includes(value)) return fail('invalid');
    const cost=kind==='house'?600:120;
    if(value==='buy') {
      if(p.money<cost) return fail('invalid');
      p.money-=cost;
      if(kind==='house') p.house=true; else p.insured=true;
    }
    addLog(s,`${seat.name}：${kind==='house'?'家':'保険'}を${value==='buy'?'購入した':'見送った'}`);
  }
  s.pending=null;s.nonce++;
  if(kind!=='career') next(s,i);
  return ok(s);
}
function play(s:LifeState,i:number,f:Form,ctx:Ctx):Step<LifeState> {
  if(intOf(f,'nonce')!==s.nonce) return fail('invalid');
  if(s.pending) return str(f,'action')==='choose'?choose(s,i,str(f,'choice')??''):fail('invalid');
  return str(f,'action')==='roll'?move(s,i,ctx):fail('invalid');
}
const base=partyEngine<LifeState>({
  kind:'life',min:2,max:5,turnSeconds:LIFE_TURN_SECONDS,
  init:()=>({kind:'life',people:{},nonce:0,lastRoll:null,pending:null}),
  deal(s) { s.people=Object.fromEntries(s.seats.map(x=>[x.id,player()]));s.turn=0;s.pending={by:0,kind:'career'};return s; },
  play(s,i,f,ctx) {
    const p=s.people[s.seats[i]!.id]!;
    if(!s.pending && p.job==='これから選ぶ') s.pending={by:i,kind:'career'};
    // 最初の職業選びは、自分の番の表示でも案内する。
    return play(s,i,f,ctx);
  },
  auto(s,i,ctx) {
    const p=s.people[s.seats[i]!.id]!;
    if(!s.pending && p.job==='これから選ぶ') s.pending={by:i,kind:'career'};
    if(s.pending) return choose(s,i,s.pending.kind==='career'?'work':p.money>=(s.pending.kind==='house'?600:120)?'buy':'skip');
    return move(s,i,ctx);
  },
  finish(s) {
    s.order=[...s.seats].sort((a,b)=>lifeAssets(s.people[b.id]!)-lifeAssets(s.people[a.id]!)).map(x=>x.id);
    const pot=s.entry*s.seats.length, shares=SHARES[s.seats.length]!;
    const amounts=shares.map(share=>Math.floor(pot*share/100));
    amounts[0]!+=pot-amounts.reduce((a,b)=>a+b,0);
    for(let from=0;from<s.order.length;) {
      let to=from+1;
      while(to<s.order.length && lifeAssets(s.people[s.order[from]!]!)===lifeAssets(s.people[s.order[to]!]!)) to++;
      const total=amounts.slice(from,to).reduce((a,b)=>a+b,0), each=Math.floor(total/(to-from)), rest=total-each*(to-from);
      for(let k=from;k<to;k++) amounts[k]=each+(k-from<rest?1:0);
      from=to;
    }
    s.payouts=s.order.map((id,i)=>({id,name:s.seats.find(x=>x.id===id)!.name,amount:amounts[i]??0}));
    return s.payouts.filter(p=>p.amount>0).map(p=>({memberId:p.id,amount:p.amount,reason:'casino_win' as const}));
  },
});
/** 完了の一度だけ戦績を残す。BOTとの練習では実際の銭を動かさない。 */
const result=(step:Step<LifeState>,before:LifeState) => {
  if(step.ok && before.phase==='playing' && step.state.phase==='done') step.fx={...step.fx,records:step.state.seats.filter(x=>!x.bot).map(x=>({memberId:x.id,game:'life',bet:step.state.entry,payout:step.state.payouts.find(p=>p.id===x.id)?.amount??0}))};
  return step;
};
export const life:TableEngine<LifeState>={...base,
  act(s,id,f,ctx) {
    if(str(f,'action')==='add_bot' && s.entry>0) return fail('life_paid_bot');
    return result(base.act(s,id,f,ctx),s);
  },
  tick(s,ctx) { const step=base.tick(s,ctx); return step?result(step,s):null; },
};

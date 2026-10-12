import { addLog, partyAiMatch, partyEngine, SHARES, type PartyBase } from './partyBase.js';
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
export type LifePlayer = { position: number; money: number; salary: number; job: string; house: boolean; insured: boolean; family: number; cards?: LifeCard[]; route?: 'steady'|'venture'; fork?: number };
export const LIFE_CARDS = {move:{name:'出目指定',note:'サイコロの目を1〜6から選ぶ'},shield:{name:'回避札',note:'修理代を取り戻す'},retry:{name:'再挑戦',note:'挑戦に失敗したとき、もう一度だけ挑戦'}} as const;
export type LifeCard = keyof typeof LIFE_CARDS;
export const lifeForks = (s: {minutes?:LifeMinutes;strategy?:number}) => s.strategy===1 ? Array.from({length:Math.max(0,Math.floor((lifeGoal(s)-12)/12)+1)},(_,i)=>4+i*12) : [];
export const LIFE_VERSIONS = {20: {label:'20分', cells:36}, 40: {label:'40分', cells:72}, 60: {label:'60分', cells:108}} as const;
export type LifeMinutes = keyof typeof LIFE_VERSIONS;
export const lifeMinutes = (s: {minutes?: LifeMinutes}): LifeMinutes => s.minutes && Object.hasOwn(LIFE_VERSIONS,s.minutes) ? s.minutes : 20;
export const lifeBoard = (s: {minutes?: LifeMinutes;strategy?:number}) => {
  const count=LIFE_VERSIONS[lifeMinutes(s)].cells;
  return Array.from({length:count},(_,i)=>{
    if(i===0)return LIFE_BOARD[0];
    if(i===count-1)return LIFE_BOARD[LIFE_GOAL]!;
    if(lifeForks(s).includes(i))return ['🛤','分かれ道','fork'] as const;
    if(i%6===0)return LIFE_BOARD[6];
    if(s.strategy===1&&i%12===7)return LIFE_BOARD[4];
    const tile=LIFE_BOARD[1+(i-1)%(LIFE_GOAL-1)]!;
    return tile[2]==='pay'?LIFE_BOARD[3]:tile;
  });
};
export const lifeGoal = (s: {minutes?: LifeMinutes}) => LIFE_VERSIONS[lifeMinutes(s)].cells-1;
export type LifeState = PartyBase & { strategy?:1; minutes?: LifeMinutes; endsAt?: number | null; kind: 'life'; people: Record<string, LifePlayer>; nonce: number; lastRoll: { id: string; die: number; from: number; to: number } | null; pending: { by: number; kind: 'career' | 'house' | 'insurance' | 'fork' | 'event' | 'accident' | 'retry'; event?:'chance'|'learn'|'travel'; cost?:number } | null };
export const lifeAssets = (p: LifePlayer) => p.money + (p.house ? 750 : 0) + p.family * 100;
const player = () : LifePlayer => ({ position: 0, money: 1000, salary: 160, job: 'これから選ぶ', house: false, insured: false, family: 0 });
function next(s: LifeState, from: number) {
  for (let n=1;n<=s.seats.length;n++) {
    const index=(from+n)%s.seats.length;
    if (s.people[s.seats[index]!.id]!.position<lifeGoal(s)) { s.turn=index; return; }
  }
  s.turn=null;
  s.seats.forEach(x=>{x.out=true;});
}
function move(s: LifeState, i: number, ctx: Ctx, forced?:number): Step<LifeState> {
  const seat=s.seats[i]!, p=s.people[seat.id]!;
  const from=p.position, die=forced??ctx.rng(6)+1;
  const destination=Math.min(lifeGoal(s),from+die),fork=lifeForks(s).find(n=>n>from&&n<=destination);
  p.position=fork??destination;
  s.nonce++;
  s.lastRoll={id:seat.id,die,from,to:p.position};
  const paydays=Math.floor(Math.min(p.position,lifeGoal(s)-1)/6)-Math.floor(Math.min(from,lifeGoal(s)-1)/6);
  p.money+=paydays*p.salary;
  addLog(s,`${seat.name}：🎲 ${die} → ${p.position}マス${paydays ? `・給料 +${paydays*p.salary}G` : ''}`);
  if(p.route && p.fork!==undefined){
    for(let at=Math.floor(from/6)*6+6;at<=p.position;at+=6){
      if(at>p.fork && at<=p.fork+8){
        const bonus=p.route==='steady'?40:ctx.rng(2)===0?240:-120;p.money+=bonus;
        addLog(s,`${seat.name}：${p.route==='steady'?'堅実':'挑戦'}の道 ${bonus>0?'+':''}${bonus}G`);
      }
    }
  }
  const tile=lifeBoard(s)[p.position]![2];
  if(fork!==undefined)addLog(s,`${seat.name}：分かれ道で止まります`);
  let amount=0;
  switch(tile) {
    case 'gift': amount=100; break;
    case 'promotion': p.salary+=40; addLog(s,`${seat.name}：昇給！給料は${p.salary}Gに`); break;
    case 'luck': if(s.strategy===1)s.pending={by:i,kind:'event',event:'chance'};else amount=[-300,-100,200,400][ctx.rng(4)]!; break;
    case 'family': p.family++; amount=-150; break;
    case 'hobby': if(s.strategy===1)s.pending={by:i,kind:'event',event:'learn'};else amount=-100; break;
    case 'travel': if(s.strategy===1)s.pending={by:i,kind:'event',event:'travel'};else amount=-120; break;
    case 'shopping': amount=-180; break;
    case 'festival': amount=200; break;
    case 'accident': amount=p.insured ? -40 : -220;if(s.strategy===1&&p.cards?.includes('shield'))s.pending={by:i,kind:'accident',cost:-amount};break;
    case 'fork': s.pending={by:i,kind:'fork'};break;
    case 'maintenance': amount=p.house ? -100 : 100; break;
    case 'celebrate': amount=100+p.family*100; break;
    case 'house': if (!p.house) s.pending={by:i,kind:'house'}; break;
    case 'insurance': if (!p.insured) s.pending={by:i,kind:'insurance'}; break;
    case 'goal': amount=500; break;
  }
  p.money+=amount;
  if (amount) addLog(s,`${seat.name}：${lifeBoard(s)[p.position]![1]} ${amount>0?'+':''}${amount}G`);
  if (!s.pending) next(s,i);
  return ok(s);
}
function choose(s: LifeState,i:number,value:string,ctx:Ctx):Step<LifeState> {
  if (!s.pending || s.pending.by!==i) return fail('invalid');
  const seat=s.seats[i]!,p=s.people[seat.id]!,kind=s.pending.kind;
  if (kind==='career') {
    if (!['work','study'].includes(value)) return fail('invalid');
    p.job=value==='work'?'すぐに就職':'学んでから就職';
    p.salary=value==='work'?160:240;
    if(value==='study') p.money-=300;
    addLog(s,`${seat.name}：${p.job}・給料${p.salary}G`);
  } else if(kind==='fork') {
    if(value!=='steady'&&value!=='venture')return fail('invalid');
    p.route=value;p.fork=p.position;
    addLog(s,`${seat.name}：${value==='steady'?'堅実':'挑戦'}の道を選びました（${Math.min(lifeGoal(s),p.position+8)}マスで合流）`);
  } else if(kind==='event') {
    const event=s.pending.event;
    if(event==='chance'){
      if(value!=='safe'&&value!=='challenge')return fail('invalid');
      const gain=value==='safe'?100:ctx.rng(2)===0?500:-200;p.money+=gain;
      addLog(s,`${seat.name}：${value==='safe'?'堅実に受け取る':'挑戦'} ${gain>0?'+':''}${gain}G`);
      if(gain<0&&p.cards?.includes('retry')){s.pending={by:i,kind:'retry'};s.nonce++;return ok(s);}
    } else if(event==='learn'){
      if(value!=='learn'&&value!=='rest')return fail('invalid');
      if(value==='learn'){if(p.money<150)return fail('invalid');p.money-=150;p.salary+=40;}else p.money+=60;
      addLog(s,`${seat.name}：${value==='learn'?'学ぶ（−150G・給料＋40G）':'休む（＋60G）'}`);
    } else if(event==='travel'){
      if(value!=='trip'&&value!=='stay')return fail('invalid');
      if(value==='trip'){
        if(p.money<120||(p.cards?.length??0)>=5)return fail('invalid');
        p.money-=120;const card=(['move','shield','retry'] as const)[ctx.rng(3)]!;p.cards=[...(p.cards??[]),card];
        addLog(s,`${seat.name}：旅で「${LIFE_CARDS[card].name}」を入手（−120G）`);
      } else {p.money+=40;addLog(s,`${seat.name}：旅を見送る（＋40G）`);}
    } else return fail('invalid');
  } else if(kind==='retry'){
    if(value!=='retry'&&value!=='accept')return fail('invalid');
    if(value==='retry'){
      if(!takeCard(p,'retry'))return fail('invalid');
      const won=ctx.rng(2)===0;if(won)p.money+=700;
      addLog(s,`${seat.name}：再挑戦 ${won?'成功！先ほどの−200Gを戻して＋500G':'失敗（−200Gのまま）'}`);
    } else addLog(s,`${seat.name}：再挑戦の札を残して進みます`);
  } else if(kind==='accident'){
    if(value!=='shield'&&value!=='pay')return fail('invalid');
    if(value==='shield'){
      if(!takeCard(p,'shield'))return fail('invalid');p.money+=s.pending.cost??0;
      addLog(s,`${seat.name}：回避札で修理代${s.pending.cost??0}Gを取り戻しました`);
    }
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
function takeCard(p:LifePlayer,card:LifeCard) {
  const at=p.cards?.indexOf(card)??-1;if(at<0)return false;p.cards!.splice(at,1);return true;
}
export function lifeAutoChoice(s:LifeState):string {
  const kind=s.pending?.kind,p=s.turn===null?undefined:s.people[s.seats[s.turn]!.id];
  if(kind==='career')return 'work';if(kind==='fork')return 'steady';if(kind==='retry')return 'accept';if(kind==='accident')return 'pay';
  if(kind==='event')return s.pending?.event==='learn'?'rest':s.pending?.event==='travel'?'stay':'safe';
  return p && p.money>=(kind==='house'?600:120)?'buy':'skip';
}
function play(s:LifeState,i:number,f:Form,ctx:Ctx):Step<LifeState> {
  if(intOf(f,'nonce')!==s.nonce) return fail('invalid');
  if(s.pending) return str(f,'action')==='choose'?choose(s,i,str(f,'choice')??'',ctx):fail('invalid');
  if(str(f,'action')==='card'){
    const p=s.people[s.seats[i]!.id]!,die=intOf(f,'die');
    if(s.strategy!==1||str(f,'card')!=='move'||!Number.isInteger(die)||die<1||die>6||!takeCard(p,'move'))return fail('invalid');
    addLog(s,`${s.seats[i]!.name}：出目指定で${die}を選びました`);return move(s,i,ctx,die);
  }
  return str(f,'action')==='roll'?move(s,i,ctx):fail('invalid');
}
function finish(s:LifeState) {
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
}

const base=partyEngine<LifeState>({
  kind:'life',min:2,max:5,turnSeconds:LIFE_TURN_SECONDS,
  init:f=>({kind:'life',strategy:1,minutes:(intOf(f,'minutes') || 20) as LifeMinutes,endsAt:null,people:{},nonce:0,lastRoll:null,pending:null}),
  deal(s,_rng,now) { s.endsAt=now+lifeMinutes(s)*60_000;s.people=Object.fromEntries(s.seats.map(x=>[x.id,{...player(),...(s.strategy===1?{cards:['move','shield','retry'] as LifeCard[]}:{})}]));s.turn=0;s.pending={by:0,kind:'career'};return s; },
  play(s,i,f,ctx) {
    const p=s.people[s.seats[i]!.id]!;
    if(!s.pending && p.job==='これから選ぶ') s.pending={by:i,kind:'career'};
    // 最初の職業選びは、自分の番の表示でも案内する。
    return play(s,i,f,ctx);
  },
  auto(s,i,ctx) {
    const p=s.people[s.seats[i]!.id]!;
    if(!s.pending && p.job==='これから選ぶ') s.pending={by:i,kind:'career'};
    if(s.pending) return choose(s,i,lifeAutoChoice(s),ctx);
    return move(s,i,ctx);
  },
  finish,
  aiVariant:s=>`${lifeMinutes(s)}${s.strategy===1?'-strategy':''}`,

});
/** 完了の一度だけ戦績を残す。BOTとの練習では実際の銭を動かさない。 */
const result=(step:Step<LifeState>,before:LifeState) => {
  if(step.ok && before.phase==='playing' && step.state.phase==='done') step.fx={...step.fx,records:step.state.seats.filter(x=>!x.bot).map(x=>({memberId:x.id,game:'life',bet:step.state.entry,payout:step.state.payouts.find(p=>p.id===x.id)?.amount??0}))};
  return step;
};
/** 選んだ時間を過ぎたら、今の資産で一度だけ清算する。古い卓は従来通り。 */
function expired(s:LifeState,ctx:Ctx):Step<LifeState>|null {
  if(s.phase!=='playing' || !s.endsAt || ctx.now<s.endsAt)return null;
  const next=structuredClone(s);next.phase='done';next.turn=null;next.pending=null;next.nonce++;
  next.deadline=ctx.now+90_000;next.seats.forEach(x=>{x.out=true;});
  addLog(next,`${lifeMinutes(s)}分が経ちました。今の資産で順位を決めます。`);
  const credits=finish(next),ai=partyAiMatch(next,'life',credits,'1',`${lifeMinutes(s)}${s.strategy===1?'-strategy':''}`);
  return result(ok(next,{credits,...(ai?{aiMatch:[ai]}:{})}),s);
}
function cap(step:Step<LifeState>):Step<LifeState> {
  if(step.ok && step.state.phase==='playing' && step.state.endsAt && step.state.deadline)step.state.deadline=Math.min(step.state.deadline,step.state.endsAt);
  return step;
}
export const life:TableEngine<LifeState>={...base,
  create(host,f,ctx){
    if(str(f,'minutes')!==undefined && !['20','40','60'].includes(str(f,'minutes')!))return fail('invalid');
    return base.create(host,f,ctx);
  },
  leave(s,id,ctx){return s.seats.some(x=>x.id===id)?expired(s,ctx)??cap(base.leave(s,id,ctx)):base.leave(s,id,ctx);},
  due(s){return s.phase==='playing' && s.endsAt ? Math.min(s.deadline??Infinity,s.endsAt) : base.due(s);},
  act(s,id,f,ctx) {
    if(str(f,'action')==='add_bot' && s.entry>0) return fail('life_paid_bot');
    if(s.seats.some(x=>x.id===id)){const done=expired(s,ctx);if(done)return done;}
    return cap(result(base.act(s,id,f,ctx),s));
  },
  tick(s,ctx) { const done=expired(s,ctx);if(done)return done;const step=base.tick(s,ctx); return step?cap(result(step,s)):null; },
};

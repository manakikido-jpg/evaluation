import { expect, it } from 'vitest';
import * as E from '../src/services/shinpu/engine.js';
import { catalog } from '../src/services/shinpu/catalog.js';
import { STATIC } from '../src/web/assets.js';

function game(count = 3) {
  const s = E.create(count, () => 0);
  s.players.forEach(p => { p.hp = 40; p.mp = 20; p.money = 50; });
  s.deck = Array(50).fill('SK-001'); s.discard = [];
  return s;
}
function hand(s: E.State, player: number, ...ids: string[]) {
  s.players[player]!.hand = ids.map(id => {
    const card = E.playableCards.find(c => c.id === id);
    if (!card) throw Error(id);
    return { ...card, uid: ++s.seq };
  });
  return s.players[player]!.hand.map(c => c.uid);
}
function attack(s: E.State, id: string, options: E.ActionOptions = {}, target = 1) {
  const ids=hand(s,0,id); E.act(s, 'attack', ids, target, options); return ids[0]!;
}
function use(s: E.State, id: string, target?: number, options: E.ActionOptions = {}) {
  const ids=hand(s,0,id,'SK-001','SK-002'); E.act(s, 'use', [ids[0]!], target, options); return ids[0]!;
}
function snapshot(s: E.State) { return JSON.stringify(s); }

it('237枚の完成仕様と、別枠の式神を呼ぶが実際の山札に揃う', () => {
  expect(E.playableCards).toHaveLength(238);
  expect(E.playableCards.filter(c => c.id.startsWith('SK-')).map(c => c.id)).toEqual(catalog.map(c => c.id));
  for (const card of catalog) {
    const rule = E.playableCards.find(c => c.id === card.id)!;
    expect(rule).toMatchObject({ name: card.name, cost: card.mpCost, element: card.element, effect: card.effectKey, weight: card.drawWeight, price: card.tradeValue });
    expect(STATIC[`shinpu-catalog-thumbnails-${rule.id}.webp`]?.type).toBe('image/webp');
  }
  expect(E.playableCards.filter(c => c.stackable).map(c => c.id)).toEqual(['SK-038']);
  const s = E.create();
  const actual = [...s.deck, ...s.players.flatMap(p => p.hand.map(c => c.id))];
  for (const c of E.playableCards) expect(actual.filter(id => id === c.id)).toHaveLength(c.weight!);
});

for (const definition of E.playableCards.filter(c => c.effect)) {
  it(`${definition.id} ${definition.name}を実際に使用し、効果待ちも終了できる`, () => {
    const s = game(); let usedUid: number;
    if (definition.type === 'guard') {
      attack(s, 'SK-004');
      const ids=hand(s,1,definition.id); usedUid=ids[0]!; E.defend(s, ids);
    } else if (definition.type === 'attack') {
      usedUid=attack(s, definition.id, { element: '火', pay: true, ...(definition.effect === 'two_targets' ? { targets: [1, 2] } : {}) });
      while (s.phase === 'defense') E.defend(s, []);
    } else {
      if (definition.effect === 'recover_basic') {
        const basic = { ...E.playableCards[0]!, uid: ++s.seq };
        s.discard.push(basic); s.players[0]!.lastBasic = basic;
      }
      usedUid=use(s, definition.id, 0, { element: '光' });
      if (s.phase === 'choice') E.autoChoose(s);
    }
    expect(s.phase).toBe('action');
    expect(s.turn).toBe(1);
    expect(s.players.flatMap(p => p.hand).some(c => c.uid === usedUid)).toBe(false);
    for (const p of s.players) {
      expect(p.hp).toBeGreaterThanOrEqual(0); expect(p.hp).toBeLessThanOrEqual(60);
      expect(p.mp).toBeGreaterThanOrEqual(0); expect(p.mp).toBeLessThanOrEqual(20);
      expect(p.money).toBeGreaterThanOrEqual(0); expect(p.hand.length).toBeLessThanOrEqual(10);
    }
  });
}

it.each([
  ['SK-085', 60, 40, 8], ['SK-087', 40, 20, 10], ['SK-088', 60, 40, 10],
  ['SK-099', 40, 40, 9], ['SK-107', 40, 40, 15],
])('条件付き攻撃%sの威力を条件から計算する', (id, targetHp, ownHp, power) => {
  const s = game(); s.players[0]!.hp = ownHp as number; s.players[1]!.hp = targetHp as number;
  attack(s, id as string); expect(s.pending!.power).toBe(power);
});
it('通常攻撃＋追加札、加算・減算を合算して一度だけ消費する', () => {
  const s=game(); s.players[0]!.attackBoost=3; s.players[0]!.attackPenalty=2;
  E.act(s,'attack',hand(s,0,'SK-004','SK-038','SK-038'),1);
  expect(s.pending!.power).toBe(12);
  expect(s.players[0]!.attackBoost).toBe(0); expect(s.players[0]!.attackPenalty).toBe(0);
});
it('同属性の防具に＋2し、異なる属性には基本防御だけ使う', () => {
  for (const [attackId, hp] of [['SK-007',40],['SK-019',38]] as const) {
    const s=game(); attack(s,attackId); E.defend(s,hand(s,1,'SK-112'));
    expect(s.players[1]!.hp).toBe(hp);
  }
});
it('鈴音の連矢は2回分の威力に防御1枚だけを引く', () => {
  const s=game(); attack(s,'SK-089');
  const ids=hand(s,1,'SK-108','SK-109'), before=snapshot(s);
  expect(()=>E.defend(s,ids)).toThrow('1枚'); expect(snapshot(s)).toBe(before);
  E.defend(s,[ids[0]!]); expect(s.players[1]!.hp).toBe(36);
});
it('結界裂きは各防御札を2下げ、次の防御の加算は一度だけ使う', () => {
  const s=game(); attack(s,'SK-092'); s.players[1]!.guardBoost=1;
  E.defend(s,hand(s,1,'SK-108','SK-109'));
  expect(s.players[1]!.hp).toBe(36); expect(s.players[1]!.guardBoost).toBe(0);
});
it('商人の護り札の追加支払いは任意で、不足時は状態を変えない', () => {
  for(const [pay,hp,money] of [[false,31,50],[true,36,46]] as const){
    const s=game();attack(s,'SK-012');E.defend(s,hand(s,1,'SK-185'),{pay});
    expect(s.players[1]!.hp).toBe(hp);expect(s.players[1]!.money).toBe(money);
  }
  const t=game();attack(t,'SK-012');const ids=hand(t,1,'SK-185');t.players[1]!.money=3;const before=snapshot(t);
  expect(()=>E.defend(t,ids,{pay:true})).toThrow('霊銭');expect(snapshot(t)).toBe(before);
});
it('防御札の回復・ドロー・MP回復と低HPでの追加防御が働く', () => {
  const s=game();attack(s,'SK-007');E.defend(s,hand(s,1,'SK-181'));expect(s.players[1]!.hp).toBe(40);
  const t=game();attack(t,'SK-007');const guards=hand(t,1,'SK-182',...Array(8).fill('SK-001'));E.defend(t,[guards[0]!]);expect(t.players[1]!.hand).toHaveLength(9);
  const u=game();attack(u,'SK-007');u.players[1]!.mp=5;E.defend(u,hand(u,1,'SK-183'));expect(u.players[1]!.mp).toBe(7);
  const v=game();attack(v,'SK-012');v.players[1]!.hp=20;E.defend(v,hand(v,1,'SK-184'));expect(v.players[1]!.hp).toBe(16);
});
it('回復道具の固定値と、自分専用の複合回復を守る', () => {
  for(const [id,mp] of [['SK-221',5],['SK-222',8],['SK-223',11]] as const){const s=game();s.players[0]!.mp=2;use(s,id);expect(s.players[0]!.mp).toBe(mp);}
  const t=game();t.players[0]!.mp=5;use(t,'SK-219');expect(t.players[0]!.hp).toBe(45);expect(t.players[0]!.mp).toBe(7);
  const u=game();u.players[0]!.mp=5;u.players[0]!.burn=1;use(u,'SK-234');expect(u.players[0]!.hp).toBe(48);expect(u.players[0]!.mp).toBe(2);expect(u.players[0]!.burn).toBe(0);
});
it('任意の霊銭・MP払いは明示した場合だけ行い、不足時は札も状態も変えない', () => {
  const s=game(); attack(s,'SK-100'); expect(s.pending!.power).toBe(8); expect(s.players[0]!.money).toBe(50);
  const t=game(); attack(t,'SK-100',{pay:true}); expect(t.pending!.power).toBe(12); expect(t.players[0]!.money).toBe(46);
  const u=game(),ids=hand(u,0,'SK-100');u.players[0]!.money=3; const before=snapshot(u);
  expect(()=>E.act(u,'attack',ids,1,{pay:true})).toThrow('霊銭'); expect(snapshot(u)).toBe(before);
  const v=game(); attack(v,'SK-102',{pay:true}); E.defend(v,hand(v,1,'SK-178'));
  expect(v.players[1]!.hp).toBe(40); expect(v.players[0]!.mp).toBe(18);
  const w=game();attack(w,'SK-102',{pay:true});E.defend(w,hand(w,1,'SK-108'));expect(w.players[1]!.hp).toBe(31);
});
it('HPを払う札、属性選択、対象重複の不正は消費前に拒否する', () => {
  const s=game(),ids=hand(s,0,'SK-101');s.players[0]!.hp=3;const before=snapshot(s);
  expect(()=>E.act(s,'attack',ids,1)).toThrow('HP3');expect(snapshot(s)).toBe(before);
  const t=game(),colors=hand(t,0,'SK-104'),b=snapshot(t);
  expect(()=>E.act(t,'attack',colors,1,{element:'月'})).toThrow('属性');expect(snapshot(t)).toBe(b);
  const u=game(),multi=hand(u,0,'SK-105'),c=snapshot(u);
  expect(()=>E.act(u,'attack',multi,1,{targets:[1,1]})).toThrow('重複');expect(snapshot(u)).toBe(c);
});
it('2人への攻撃はMPと札を一度だけ使い、各人が順番に防御する', () => {
  const s=game();attack(s,'SK-105',{targets:[1,2]});expect(s.players[0]!.mp).toBe(18);
  E.defend(s,[]);expect(s.pending!.to).toBe(2);expect(s.turn).toBe(0);
  E.defend(s,[]);expect(s.players[1]!.hp).toBe(36);expect(s.players[2]!.hp).toBe(36);expect(s.turn).toBe(1);
});
it('身代わりはダメージと命中時効果を消し、水鏡は再反射せず攻撃者を倒せる', () => {
  const s=game();attack(s,'SK-188');E.defend(s,hand(s,1,'SK-180'));
  expect(s.players[1]!.hp).toBe(40);expect(s.players[1]!.burn).toBe(0);
  const t=game(2);t.players[0]!.hp=2;attack(t,'SK-012');E.defend(t,hand(t,1,'SK-179'));
  expect(t.phase).toBe('over');expect(t.winner).toBe(1);
});
it.each([['火',54,20,0,0],['水',56,19,0,0],['風',56,20,1,0],['雷',56,20,0,1],['土',56,20,2,0],['光',56,20,0,0],['闇',56,18,0,0]])('奇跡の%s属性の追加効果を適用する', (color,hp,mp,guard,penalty) => {
  const s=game();s.players[1]!.hp=60;
  const card=E.playableCards.find(c=>c.effect==='element_miracle'&&c.element===color)!;
  attack(s,card.id);E.defend(s,[]);
  expect(s.players[1]!.hp).toBe(hp);expect(s.players[1]!.mp).toBe(mp);
  expect(s.players[0]!.guardBoost).toBe(guard);expect(s.players[1]!.attackPenalty).toBe(penalty);
  if(color==='光')expect(s.players[0]!.hp).toBe(42);
});
it('厄除けはダメージを防がず、火傷・MP減少を1回だけ防ぐ', () => {
  const s=game();s.players[1]!.statusGuard=true;attack(s,'SK-186');E.defend(s,[]);
  expect(s.players[1]!.hp).toBe(36);expect(s.players[1]!.burn).toBe(0);expect(s.players[1]!.statusGuard).toBe(false);
});
it('回復対象を選べて、HP上限・火傷・攻撃減算の解除が働く', () => {
  const s=game();s.players[1]!.hp=55;s.players[1]!.burn=1;s.players[1]!.attackPenalty=2;
  use(s,'SK-214',1);
  expect(s.players[1]!.hp).toBe(60);expect(s.players[1]!.burn).toBe(0);expect(s.players[1]!.attackPenalty).toBe(0);
  expect(s.players[0]!.hp).toBe(40);expect(s.players[0]!.mp).toBe(12);
});
it('山札3枚の選択は自分だけに保持し、選ばなかった2枚を山札の下へ戻す', () => {
  const s=game();s.deck=['SK-002','SK-003','SK-004','SK-005'];use(s,'SK-227');
  expect(s.phase).toBe('choice');expect(s.choice!.cards.map(c=>c.id)).toEqual(['SK-002','SK-003','SK-004']);
  const selected=s.choice!.cards[1]!; E.act(s,'choose',[selected.uid]);
  expect(s.players[0]!.hand.some(c=>c.uid===selected.uid)).toBe(true);
  expect(s.deck).toEqual(['SK-005','SK-002','SK-004']);
});
it('買札は価格をサーバーで確かめ、不足・二重確定を拒否し、取りやめもできる', () => {
  const s=game();use(s,'SK-235');const choice=s.choice!,first=choice.cards[0]!;
  s.players[0]!.money=0;const before=snapshot(s);
  expect(()=>E.act(s,'choose',[first.uid])).toThrow('霊銭');expect(snapshot(s)).toBe(before);
  s.players[0]!.money=50; E.act(s,'choose',[first.uid]);
  expect(s.players[0]!.money).toBe(50-first.price!);expect(()=>E.act(s,'choose',[first.uid])).toThrow();
  const t=game();use(t,'SK-235');E.act(t,'choose',[]);expect(t.players[0]!.money).toBe(50);
});
it('売却は半額切り捨て、交換は選んだ枚数だけ、回収は本人の最後の並札だけ', () => {
  const s=game();use(s,'SK-236');const sold=s.choice!.cards[0]!;E.act(s,'choose',[sold.uid]);
  expect(s.players[0]!.money).toBe(50+Math.max(1,Math.floor(sold.price!/2)));
  const t=game();use(t,'SK-237');const ids=t.choice!.cards.map(c=>c.uid);E.act(t,'choose',ids);
  expect(t.players[0]!.hand).toHaveLength(2);expect(t.players[0]!.hand.every(c=>!ids.includes(c.uid))).toBe(true);
  const u=game();attack(u,'SK-001');E.defend(u,[]);E.act(u,'pass');E.act(u,'pass');
  const original=u.players[0]!.lastBasic!.uid; use(u,'SK-229');expect(u.players[0]!.hand.some(c=>c.uid===original)).toBe(true); expect(u.discard.some(c=>c.uid===original)).toBe(false);
});
it('手札超過は本人が捨てる札を選び、無効な枚数や札では状態を変えない', () => {
  const s=game(),ids=hand(s,0,'SK-226',...Array(9).fill('SK-002'));
  E.act(s,'use',[ids[0]!]);expect(s.phase).toBe('choice');expect(s.players[0]!.hand).toHaveLength(11);
  const before=snapshot(s);expect(()=>E.act(s,'choose',[])).toThrow();expect(snapshot(s)).toBe(before);
  E.act(s,'choose',[s.choice!.cards[0]!.uid]);expect(s.players[0]!.hand).toHaveLength(10);expect(s.turn).toBe(1);
});
it.each([
  ['SK-086','attackBoost',2],['SK-091','hp',43],['SK-093','money',53],['SK-098','guardBoost',2],
])('%sの自分への効果が、条件どおり一度だけ働く', (id,field,value) => {
  const s=game();attack(s,id);E.defend(s,[]);
  expect(s.players[0]![field as 'hp']).toBe(value);
});
it('霊脈の吸刃・雷鳴の小槌はMPを減らし、厄除けがあれば減らさない', () => {
  for(const [id,reduced] of [['SK-090',2],['SK-096',3]] as const){
    const s=game();s.players[0]!.mp=5;s.players[1]!.mp=10;attack(s,id);E.defend(s,[]);
    expect(s.players[1]!.mp).toBe(10-reduced);expect(s.players[0]!.mp).toBe(id==='SK-090'?7:5);
    const t=game();t.players[1]!.statusGuard=true;attack(t,id);E.defend(t,[]);
    expect(t.players[1]!.mp).toBe(20);expect(t.players[1]!.statusGuard).toBe(false);
  }
});
it('火傷は次の自分の番に一度だけ、攻撃減算も次の攻撃で一度だけ働く', () => {
  const s=game();attack(s,'SK-094');E.defend(s,[]);expect(s.players[1]!.hp).toBe(34);
  E.act(s,'pass');E.act(s,'pass');E.act(s,'pass');expect(s.players[1]!.hp).toBe(34);
  const t=game();attack(t,'SK-095');E.defend(t,[]);expect(t.players[1]!.attackPenalty).toBe(2);
  E.act(t,'attack',hand(t,1,'SK-004'),0);expect(t.pending!.power).toBe(3);expect(t.players[1]!.attackPenalty).toBe(0);
});
it('攻撃が防がれたときは命中時効果を出さず、攻撃後の効果は出す', () => {
  const s=game();attack(s,'SK-086');E.defend(s,hand(s,1,'SK-178'));expect(s.players[0]!.attackBoost).toBe(0);
  const t=game();attack(t,'SK-097');E.defend(t,hand(t,1,'SK-178'));expect(t.players[0]!.hand).toHaveLength(1);
  const u=game();u.players[0]!.hp=20;attack(u,'SK-106');E.defend(u,hand(u,1,'SK-178'));expect(u.players[0]!.hp).toBe(22);
});
it('祓い清めの鎌・総祓いは一時加算を消し、減算は総祓いで消さない', () => {
  const s=game();s.players[1]!.attackBoost=3;attack(s,'SK-103');E.defend(s,[]);expect(s.players[1]!.attackBoost).toBe(0);
  const t=game();t.players.forEach(p=>{p.attackBoost=3;p.guardBoost=4;p.attackPenalty=2;});use(t,'SK-215');
  expect(t.players.every(p=>p.attackBoost===0&&p.guardBoost===0&&p.attackPenalty===2)).toBe(true);
});
it('灯籠の油・結び守り・染め札は次の対応する攻撃や防御にだけ使う', () => {
  const s=game();use(s,'SK-230');expect(s.players[0]!.attackBoost).toBe(3);
  const t=game();use(t,'SK-231');expect(t.players[0]!.guardBoost).toBe(4);
  const u=game();use(u,'SK-232',0,{element:'闇'});E.act(u,'pass');E.act(u,'pass');attack(u,'SK-004');
  expect(u.pending!.elements).toEqual(['闇']);expect(u.players[0]!.weaponElement).toBeNull();
});
it('売った札・交換した札を最後に使った並札として回収することはできない', () => {
  const s=game();use(s,'SK-236');E.act(s,'choose',[s.choice!.cards[0]!.uid]);expect(s.players[0]!.lastBasic).toBeNull();
  E.act(s,'pass');E.act(s,'pass');const ids=hand(s,0,'SK-229');const before=snapshot(s);
  expect(()=>E.act(s,'use',ids)).toThrow('回収');expect(snapshot(s)).toBe(before);
});
it('反射で攻撃者が退場した場合は、残りの攻撃対象へ進めない', () => {
  const s=game();s.players[0]!.hp=2;
  E.act(s,'attack',hand(s,0,'SK-105','SK-038','SK-038','SK-038'),1,{targets:[1,2]});
  E.defend(s,hand(s,1,'SK-179'));
  expect(s.players[0]!.hp).toBe(0);expect(s.players[2]!.hp).toBe(40);expect(s.pending).toBeNull();expect(s.queue).toEqual([]);
});
it('山札がなくなると捨て札を混ぜ、カードがどちらにもなければ補充を止める', () => {
  const s=game();s.deck=[];s.players[1]!.hand=[];
  s.discard=[{...E.playableCards[0]!,uid:++s.seq}];E.act(s,'pass');
  expect(s.players[1]!.hand.map(c=>c.id)).toEqual(['SK-001']);expect(s.discard).toEqual([]);
});
it('200通りのCPU対戦で全効果・選択を処理し、有限の手番で終了する', () => {
  for(let seed=1;seed<=200;seed++){
    let n=seed;const s=E.create(2+seed%5,()=>((n=(n*1664525+1013904223)>>>0)/4294967296));
    for(let steps=0;s.phase!=='over'&&steps<500;steps++){
      E.cpu(s);
      for(const p of s.players){expect(p.hp).toBeGreaterThanOrEqual(0);expect(p.hp).toBeLessThanOrEqual(60);expect(p.mp).toBeGreaterThanOrEqual(0);expect(p.mp).toBeLessThanOrEqual(20);expect(p.money).toBeGreaterThanOrEqual(0);expect(p.hand.length).toBeLessThanOrEqual(10);}
    }
    expect(s.phase).toBe('over');expect(s.turns).toBeLessThanOrEqual(80);
  }
});

import {expect,it} from 'vitest';
import * as E from '../src/services/shinpu/engine.js';
function game(){return E.create(2,()=>0);}
function hand(s:E.State,i:number,id:string){
 const definition=[...E.playableCards,...E.cards].find(c=>c.id===id)!;
 const card={...definition,uid:++s.seq};s.players[i]!.hand=[card];return[card.uid];
}
it('初期値を維持し、通常の回復でHP60・MP20を超えて増える',()=>{
 const hp=game();expect(hp.players[0]).toMatchObject({hp:60,mp:12,money:20});
 E.act(hp,'use',hand(hp,0,'SK-217'),0);expect(hp.players[0]!.hp).toBe(72);
 const mp=game();mp.players[0]!.mp=30;E.act(mp,'use',hand(mp,0,'SK-222'));expect(mp.players[0]!.mp).toBe(36);
});
it('高いHP/MPでも両替でき、霊銭も大きな値から増やせる',()=>{
 const s=game();s.players[0]!.hp=100;s.players[0]!.mp=100;s.players[0]!.money=1000000;
 E.act(s,'exchange',[],'hp');expect(s.players[0]!.hp).toBe(108);expect(s.players[0]!.money).toBe(999996);
 E.act(s,'pass');E.act(s,'exchange',[],'mp');expect(s.players[0]!.mp).toBe(104);
 E.act(s,'pass');E.act(s,'exchange',[],'coin');expect(s.players[0]!.money).toBe(999996);expect(s.players[0]!.mp).toBe(101);
});
it('HP/MP同時回復と召喚も上限で切り捨てず、召喚の表示値が一致する',()=>{
 const s=game();s.players[0]!.hp=100;s.players[0]!.mp=30;
 E.act(s,'use',hand(s,0,'SK-219'));expect(s.players[0]).toMatchObject({hp:105,mp:32});
 E.act(s,'pass');E.act(s,'use',hand(s,0,'summon'));expect(s.players[0]).toMatchObject({hp:115,mp:29});expect(s.summon?.healed).toBe(10);
});
it('吸収は高いHP/MPでも増え、相手のMPを0未満にしない',()=>{
 const s=game();s.players[0]!.hp=100;E.act(s,'attack',hand(s,0,'SK-091'),1);E.defend(s,[]);expect(s.players[0]!.hp).toBe(103);
 const m=game();m.players[0]!.mp=100;m.players[1]!.mp=1;E.act(m,'attack',hand(m,0,'SK-090'),1);E.defend(m,[]);expect(m.players[0]!.mp).toBe(102);expect(m.players[1]!.mp).toBe(0);
});
it('防御時のHP/MP回復も、初期値を超えた値へ加算する',()=>{
 for(const [id,key,expected] of [['SK-181','hp',103],['SK-183','mp',102]] as const){
  const s=game();s.players[1]!.hp=100;s.players[1]!.mp=100;E.act(s,'attack',hand(s,0,'SK-004'),1);E.defend(s,hand(s,1,id));expect(s.players[1]![key]).toBe(expected);
 }
});
it('回復対象が退場していれば、上限なしでも復活させず消費前に拒否する',()=>{
 const s=E.create(3,()=>0);s.players[1]!.hp=0;const ids=hand(s,0,'SK-217'),before=JSON.stringify(s);
 expect(()=>E.act(s,'use',ids,1)).toThrow();expect(JSON.stringify(s)).toBe(before);
});
it('満タン条件は初期HP60以上で働き、カードの追加威力3は維持する',()=>{
 for(const [hp,power] of [[59,5],[60,8],[72,8]]){const s=game();s.players[1]!.hp=hp!;E.act(s,'attack',hand(s,0,'SK-085'),1);expect(s.pending!.power).toBe(power);}
});
it('HPが初期値を超えても80手番で終了し、残りHPの最多と同点を判定する',()=>{
 for(const tied of [false,true]){const s=game();s.turns=80;s.players[0]!.hp=150;s.players[1]!.hp=tied?150:120;E.act(s,'pass');expect(s.phase).toBe('over');expect(s.winner).toBe(tied?-1:0);}
});
it('残HPを超えた実ダメージを、HP差分と区別して結果へ残す',()=>{
 const s=game();s.players[1]!.hp=2;E.act(s,'attack',hand(s,0,'SK-004'),1);E.defend(s,[]);
 expect(s.players[1]!.hp).toBe(0);expect(s.result).toMatchObject({defender:1,damage:5});expect(s.phase).toBe('over');
});
it('0ダメージの防御と、複数対象の各結果を別の番号で残す',()=>{
 const guarded=game();E.act(guarded,'attack',hand(guarded,0,'SK-004'),1);E.defend(guarded,hand(guarded,1,'SK-156'));expect(guarded.result?.damage).toBe(0);
 const s=E.create(3,()=>0),card=E.playableCards.find(c=>c.effect==='two_targets')!;
 s.players[0]!.mp=100;E.act(s,'attack',hand(s,0,card.id),1,{targets:[1,2]});E.defend(s,[]);const first=s.result!;
 E.defend(s,[]);expect(s.result!.id).not.toBe(first.id);expect([first.defender,s.result!.defender]).toEqual([1,2]);
});

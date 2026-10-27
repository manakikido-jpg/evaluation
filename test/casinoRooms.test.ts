import { describe,it,expect } from 'vitest';
import { cfg } from './helpers.js';
import { roomPreview,roomRng } from '../src/services/casino/roomPreview.js';
import { bjStart,bjStand,bjView,bjPayout } from '../src/services/casino/blackjack.js';
import { hlWays } from '../src/services/casino/highlow.js';
import { rouletteMultiplier,rouletteSpin } from '../src/services/casino/roulette.js';
const model=(params:string)=>roomPreview(new URLSearchParams(params),cfg.casino);
describe('固定サンプルの没入感試遊',()=>{
 it('同じURLは同じ出目と払戻で、0〜36の既存ルールを使う',()=>{
  const q='game=roulette&round=17&spin=1&bets=n7:100,red:50';
  expect(model(q)).toEqual(model(q));
  const m=model(q);if(m.game!=='roulette')throw Error();
  const n=rouletteSpin(roomRng(17));expect(m.number).toBe(n);expect(m.total).toBe(150);expect(m.paid).toBe(100*rouletteMultiplier('n7',n)+50*rouletteMultiplier('red',n));
 });
 it('ブラックジャックは既存の山札と判定で再現し、山札や伏せたカードを公開しない',()=>{
  let round=1;while(bjStart(roomRng(round)).phase!=='player')round++;
  const m=model(`game=blackjack&round=${round}`);if(m.game!=='blackjack')throw Error();expect(m.view.dealer).toHaveLength(1);expect(m.view.dealerHidden).toBe(true);expect(m.view).not.toHaveProperty('deck');
  const done=model(`game=blackjack&round=${round}&moves=stand`);if(done.game!=='blackjack')throw Error();const expected=bjStand(bjStart(roomRng(round)));expect(done.view).toEqual(bjView(expected));expect(done.paid).toBe(bjPayout(expected.result!,done.total));
 });
 it('ハイローのドローで倍率と連勝を保ち、受け取り前後を区別する',()=>{
  let found=false;
  for(let round=1;round<=200;round++){
   const initial=model(`game=highlow&round=${round}`);if(initial.game!=='highlow')throw Error();const guess=hlWays(initial.state.current,'high')>0?'high':'low';
   const after=model(`game=highlow&round=${round}&moves=${guess}`);if(after.game!=='highlow')throw Error();
   if(!after.state.lastDraw)continue;expect(after.state.steps).toBe(initial.state.steps);expect(after.state.mult).toBe(initial.state.mult);expect(after.paid).toBe(0);found=true;break;
  }
  expect(found).toBe(true);
 });
 it('長すぎる操作列・不正な金額・見本残高超過・選べない操作を拒否する',()=>{
  for(const q of ['game=unknown','round=1000001','bet=-1','bet=Infinity','game=highlow&moves=cashout','game=blackjack&moves=high','game=blackjack&moves='+Array(25).fill('hit').join(','),'game=roulette&spin=1&bets=red:99999999'])expect(()=>model(q)).toThrow();
 });
});

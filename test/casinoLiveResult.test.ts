import {describe,it,expect} from 'vitest';
import {lifePresentationResult} from '../src/web/views/casinoTables.js';
import type {LifePlayer} from '../src/services/casino/tables/life.js';
const person=(money:number):LifePlayer=>({position:35,money,salary:0,job:'見本',house:false,insured:false,family:0});
describe('実際の順位に合わせた演出',()=>{
 it('人生ゲームの同資産の同着を負け扱いにせず、観戦者も勝者にしない',()=>{
  const s={order:['a','b'],people:{a:person(1000),b:person(1000)}};
  expect(lifePresentationResult(s,'a')).toBe('draw');expect(lifePresentationResult(s,'b')).toBe('draw');expect(lifePresentationResult(s,'observer')).toBe('neutral');
  s.people.a.money=1001;expect(lifePresentationResult(s,'a')).toBe('win');expect(lifePresentationResult(s,'b')).toBe('lose');
 });
});

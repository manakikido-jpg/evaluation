import {describe,expect,it} from 'vitest';
import {life,lifeAutoChoice,lifeBoard,lifeForks,type LifeMinutes,type LifeState} from '../src/services/casino/tables/life.js';
import type {Ctx,Step} from '../src/services/casino/tables/types.js';
import {cfg} from './helpers.js';
const ctx:Ctx={now:1000000,cfg,rng:()=>0};
const who=(i:number)=>({id:String(i),name:`参加者${i}`});
function state(step:Step<LifeState>){if(!step.ok)throw Error(step.error);return step.state;}
function game(minutes:LifeMinutes=20){let s=state(life.create(who(0),{entry:'100',minutes:String(minutes)},ctx));s=state(life.join(s,who(1),{},ctx));s=state(life.act(s,'0',{action:'start'},ctx));s.pending=null;Object.values(s.people).forEach(p=>p.job='仕事');return s;}
function choose(s:LifeState,choice:string,rng=ctx.rng){return life.act(s,s.seats[s.turn!]!.id,{action:'choose',choice,nonce:String(s.nonce)},{...ctx,rng});}
function roll(s:LifeState,die:number){return life.act(s,s.seats[s.turn!]!.id,{action:'roll',nonce:String(s.nonce)},{...ctx,rng:()=>die-1});}

describe('人生ゲームの分かれ道・選択・切り札',()=>{
 it.each([20,40,60] as const)('%i分版では分かれ道を飛び越えず、選んだ道を保存する',minutes=>{
  let s=game(minutes);s.people['0']!.position=2;
  const rolled=roll(s,6);s=state(rolled);
  expect(s.people['0']!.position).toBe(4);expect(s.pending?.kind).toBe('fork');expect(s.lastRoll?.die).toBe(6);
  expect(lifeForks(s).every(n=>n+8<lifeBoard(s).length)).toBe(true);
  expect(choose(s,'invalid').ok).toBe(false);
  s=state(choose(s,'steady'));expect(s.people['0']).toMatchObject({fork:4,route:'steady'});expect(s.turn).toBe(1);
  expect(rolled.ok&&rolled.fx?.credits).toBeUndefined();
 });
 it('給料日に堅実は＋40G、挑戦は成功＋240G／失敗−120G。合流後は加算しない',()=>{
  for(const [route,rng,bonus] of [['steady',0,40],['venture',0,240],['venture',1,-120]] as const){
   let s=game();Object.assign(s.people['0']!,{position:5,fork:4,route});
   const step=life.act(s,'0',{action:'roll',nonce:'0'},{...ctx,rng:(n)=>n===6?0:rng});s=state(step);
   expect(s.people['0']!.money).toBe(1160+bonus);expect(step.ok&&step.fx?.credits).toBeUndefined();
   s.turn=0;s.people['0']!.position=17;const before=s.people['0']!.money;
   s=state(roll(s,1));expect(s.people['0']!.money).toBe(before+160);
  }
 });
 it('出目指定は持ち札を1枚消費し、二重押し・他人の番・不正な出目を拒否する',()=>{
  let s=game();const f={action:'card',card:'move',die:'6',nonce:'0'};
  for(const die of ['0','7','1.5','abc'])expect(life.act(s,'0',{...f,die},ctx).ok).toBe(false);
  expect(life.act(s,'1',f,ctx).ok).toBe(false);expect(s.people['0']!.cards).toHaveLength(3);
  s=state(life.act(s,'0',f,ctx));expect(s.people['0']!.cards).toEqual(['shield','retry']);
  expect(s.lastRoll).toMatchObject({die:6,to:4});expect(s.pending?.kind).toBe('fork');
  expect(life.act(s,'0',f,ctx).ok).toBe(false);expect(s.people['0']!.cards).toHaveLength(2);
  s=state(choose(s,'steady'));s.turn=0;
  expect(life.act(s,'0',{...f,nonce:String(s.nonce)},ctx).ok).toBe(false);
 });
 it('修理代は先に確定し、回避札は一度だけ戻す。保険ありなら40G',()=>{
  for(const insured of [false,true]){
   let s=game();s.people['0']!.position=8;s.people['0']!.insured=insured;
   s=state(roll(s,1));expect(s.pending).toMatchObject({kind:'accident',cost:insured?40:220});
   expect(s.people['0']!.money).toBe(insured?960:780);const nonce=s.nonce;
   s=state(choose(s,'shield'));expect(s.people['0']!.money).toBe(1000);expect(s.people['0']!.cards).not.toContain('shield');
   expect(life.act(s,'0',{action:'choose',choice:'shield',nonce:String(nonce)},ctx).ok).toBe(false);
  }
 });
 it('挑戦の失敗は直ちに−200G。再挑戦で成功なら損失を戻して＋500G、失敗の追加負担はない',()=>{
  for(const won of [true,false]){
   let s=game();s.people['0']!.position=2;s=state(roll(s,1));expect(s.pending).toMatchObject({kind:'event',event:'chance'});
   s=state(choose(s,'challenge',()=>1));expect(s.people['0']!.money).toBe(800);expect(s.pending?.kind).toBe('retry');
   s=state(choose(s,'retry',()=>won?0:1));expect(s.people['0']!.money).toBe(won?1500:800);
   expect(s.people['0']!.cards).not.toContain('retry');expect(s.pending).toBeNull();expect(s.turn).toBe(1);
  }
 });
 it('時間切れまで再挑戦を押さなくても失敗を帳消しにできない',()=>{
  let s=game();s.people['0']!.position=2;s=state(roll(s,1));s=state(choose(s,'challenge',()=>1));
  const ended=state(life.tick(s,{...ctx,now:s.endsAt!})!);
  expect(ended.people['0']!.money).toBe(800);expect(ended.order[0]).toBe('1');expect(ended.payouts[0]?.amount).toBe(200);
 });
 it('学習の費用・旅の費用・手札上限を守り、見送りも選べる',()=>{
  let s=game();s.people['0']!.position=4;s=state(roll(s,1));expect(s.pending?.event).toBe('learn');
  s.people['0']!.money=149;expect(choose(s,'learn').ok).toBe(false);expect(s.people['0']!.salary).toBe(160);
  s.people['0']!.money=150;s=state(choose(s,'learn'));expect(s.people['0']).toMatchObject({money:0,salary:200});
  s.turn=0;s.people['0']!.position=12;s.people['0']!.money=120;s=state(roll(s,1));expect(s.pending?.event).toBe('travel');
  s=state(choose(s,'trip',()=>2));expect(s.people['0']!.money).toBe(0);expect(s.people['0']!.cards).toHaveLength(4);
  s.turn=0;s.people['0']!.position=12;s.people['0']!.money=120;s.people['0']!.cards!.push('move');s=state(roll(s,1));
  expect(choose(s,'trip').ok).toBe(false);s=state(choose(s,'stay'));expect(s.people['0']!.money).toBe(160);expect(s.people['0']!.cards).toHaveLength(5);
 });
 it('昔の対戦中の卓では新しい分岐・札を強制せず、従来のイベントを進める',()=>{
  let s=game();delete s.strategy;delete s.people['0']!.cards;s.people['0']!.position=2;
  expect(lifeForks(s)).toEqual([]);s=state(roll(s,1));expect(s.people['0']!.money).toBe(700);expect(s.pending).toBeNull();
 });
 it('自動進行でも新しい選択で止まらず、切り札は勝手に使わない',()=>{
  let s=game();s.people['0']!.position=2;s=state(roll(s,1));expect(lifeAutoChoice(s)).toBe('safe');
  s=state(life.tick(s,{...ctx,now:s.deadline!})!);expect(s.people['0']!.money).toBe(1100);expect(s.people['0']!.cards).toHaveLength(3);
  s.turn=0;s.people['0']!.position=3;s=state(roll(s,1));expect(lifeAutoChoice(s)).toBe('steady');
  s=state(life.tick(s,{...ctx,now:s.deadline!})!);expect(s.people['0']!.route).toBe('steady');
 });
});

import {describe,it,expect} from 'vitest';
import {CASINO_GAMES} from '../src/config.js';
import {GAME_SCENES,scenePreview,sceneOutcome,SCENE_CUES} from '../src/services/casino/scenePreview.js';
import {legalMoves} from '../src/services/casino/othello.js';
import {bacDeal} from '../src/services/casino/baccarat.js';
import {roomRng} from '../src/services/casino/roomPreview.js';
import {judge} from '../src/services/casino/slots.js';
const preview=(q:string)=>scenePreview(new URLSearchParams(q));
describe('全ゲームの固定演出見本',()=>{
 it('実在する全19ゲームを漏れや重複なく持ち、4つの場面を用意する',()=>{
  expect(Object.keys(GAME_SCENES).sort()).toEqual([...CASINO_GAMES].sort());expect(CASINO_GAMES).toHaveLength(19);
  for(const game of CASINO_GAMES){const m=preview('game='+game);expect(m.game).toBe(game);expect(m.spec.steps).toHaveLength(4);expect(m.spec.name).toBeTruthy();expect(m.spec.note).toBeTruthy();}
 });
 it('同じ見本は同じカード・盤面・役を再現し、バカラとスロットは既存の判定を使う',()=>{
  for(const sample of [1,2,3]){const m=preview(`game=baccarat&sample=${sample}&stage=3`);expect(preview(`game=baccarat&sample=${sample}&stage=3`)).toEqual(m);expect(m.bac).toEqual(bacDeal(roomRng(sample)));expect(m.slots.role).toBe(judge(m.slots.stops).role);expect(new Set([...m.poker.hand,...m.poker.other,...m.poker.board]).size).toBe(9);}
 });
 it('オセロの終局見本は実際の合法手で最後まで進め、両者に置ける所がない',()=>{
  const m=preview('game=othello');expect(m.othello.positions[0]).toHaveLength(64);const last=m.othello.positions.at(-1)!;expect(legalMoves(last,'B')).toEqual([]);expect(legalMoves(last,'W')).toEqual([]);expect(m.othello.lastMoves.length+1).toBe(m.othello.positions.length);
 });
 it('全系統に期待・オープン・結果の言葉があり、負け・引分・装飾を勝ち扱いにしない',()=>{
  for(const game of CASINO_GAMES){const m=preview('game='+game);expect(SCENE_CUES[m.spec.family]).toHaveLength(4);expect(SCENE_CUES[m.spec.family].every(text=>text.length>0)).toBe(true);}
  expect(sceneOutcome(preview('game=slots&sample=1'))).toBe('win');expect(sceneOutcome(preview('game=slots&sample=2'))).toBe('lose');
  for(const game of ['atslot','mahjong','life','daifugo','babanuki'])expect(sceneOutcome(preview('game='+game))).toBe('demo');
  expect(sceneOutcome(preview('game=baccarat'))).toBe('neutral');expect(sceneOutcome(preview('game=chinchiro'))).toBe('neutral');
  const m=preview('game=blackjack');m.bj.result='push';expect(sceneOutcome(m)).toBe('draw');m.bj.result='bust';expect(sceneOutcome(m)).toBe('lose');
 });
 it('未定義のゲーム・場面・見本を拒否する',()=>{
  for(const query of ['game=unknown','game=../roulette','stage=4','stage=-1','stage=01','sample=0','sample=4','sample=1e2'])expect(()=>preview(query)).toThrow();
 });
});

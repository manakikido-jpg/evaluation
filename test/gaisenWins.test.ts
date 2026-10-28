import {describe,it,expect} from 'vitest';
import {newGaisen,scenario,lever,stop,type GaisenState,type Role} from '../src/services/casino/gaisen/engine.js';
import {freshFloor,trialView} from '../src/services/casino/gaisen/trial.js';

function round(s:GaisenState,role:Role,rng=()=>1){lever(s,rng,role);for(const i of [0,1,2])stop(s,i,rng);}
describe('神殿スロットの確定した当選通知',()=>{
 it('GODは最終STOPだけで通知し、開始済みを含む5セットを表示する',()=>{
  const s=newGaisen();lever(s,()=>1,'god');expect(s.winEvent).toBeNull();
  stop(s,0,()=>1);stop(s,1,()=>1);expect(s.winEvent).toBeNull();
  stop(s,2,()=>1);expect(s.winEvent).toEqual({kind:'god',added:5,set:1,ggGames:100,sggGames:0});
  expect(s.stocks).toBe(4);expect(s.balance).toBe(100120);
  const before=structuredClone(s);expect(()=>stop(s,2,()=>1)).toThrow();expect(s).toEqual(before);
 });
 it('GG中のGODでも現在のストックに関係なく追加5セットを通知する',()=>{
  const s=scenario(1,'god');round(s,'god');expect(s.winEvent?.kind).toBe('god');expect(s.winEvent?.added).toBe(5);expect(s.stocks).toBe(9);
 });
 it('天井のGG開始と、既存ストックからの継続開始を区別する',()=>{
  const s=scenario(1,'ceiling');round(s,'none');expect(s.winEvent).toEqual({kind:'gg',added:1,set:1,ggGames:100,sggGames:0});
  s.phase='gzone';s.zoneLeft=1;s.stocks=1;round(s,'none');expect(s.winEvent).toEqual({kind:'gg',added:0,set:2,ggGames:100,sggGames:0});
 });
 it('SGG突入と、SGG中の赤7による追加/16G再開を通知する',()=>{
  const s=newGaisen();round(s,'red7');expect(s.winEvent).toEqual({kind:'sgg',added:1,set:0,ggGames:0,sggGames:16});
  s.sggLeft=4;round(s,'red7');expect(s.winEvent).toEqual({kind:'stock',added:1,set:0,ggGames:0,sggGames:16});expect(s.lastPaid).toBe(0);
 });
 it('同じゲームの巻き戻しとEX上乗せを合計2セットで表示する',()=>{
  const s=scenario(1,'sgg');s.medusa=2;s.sggLeft=5;round(s,'rare',()=>0);
  expect(s.winEvent).toEqual({kind:'stock',added:2,set:0,ggGames:0,sggGames:16});expect(s.stocks).toBe(3);
 });
 it('G-STOPの7揃いをGODとせず、実際の5セット獲得として表示する',()=>{
  const s=scenario(1,'gstop');lever(s,()=>1,'none');s.pending!.group=['7','1','3','V','S'];for(const i of [0,1,2])stop(s,i,()=>0);
  expect(s.display).toEqual(['7','7','7']);expect(s.gods).toBe(0);expect(s.winEvent?.kind).toBe('gg');expect(s.winEvent?.added).toBe(5);
 });
 it('通常の払出・ハズレ・場面設定では当選演出を作らない',()=>{
  for(const role of ['none','replay','smallBell'] as const){const s=newGaisen();round(s,role);expect(s.winEvent).toBeNull();}
  for(const name of ['god','gg','sgg'] as const)expect(scenario(1,name).winEvent).toBeUndefined();
 });
 it('再表示は保存済みの結果を返すだけで、次のレバーでは消す',()=>{
  const f=freshFloor(0);f.machines[0]!.owner='test';const s=f.machines[0]!.state;round(s,'god');const before=structuredClone(f);
  expect(trialView(f,'test').own!.winEvent?.added).toBe(5);expect(f).toEqual(before);
  lever(s,()=>1,'none');expect(trialView(f,'test').own!.winEvent).toBeNull();
  delete s.winEvent;expect(trialView(f,'test').own!.winEvent).toBeNull();
 });
});

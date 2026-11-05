import {describe,it,expect} from 'vitest';
import {jsx} from 'hono/jsx';
import type {AdminSession} from '../src/db/schema.js';
import {freshFloor,trialView} from '../src/services/casino/gaisen/trial.js';
import {scenario,lever,stop,ORDERS} from '../src/services/casino/gaisen/engine.js';
import {GaisenTrial} from '../src/web/views/gaisenTrial.js';
const session={userId:'sample',username:'試遊係',level:'guji',pages:null,csrfToken:'test-only'} as AdminSession;
function fixture(){const floor=freshFloor(0,'trial-2');floor.machines[0]!.owner='sample';return {floor,machine:floor.machines[0]!,html:()=>jsx(GaisenTrial,{m:trialView(floor,'sample'),session,version:'trial-2'}).toString()};}
describe('神殿の筐体と操作案内',()=>{
 it('通常演出を版つきJS/空の装飾層として読み、前兆をGGの残りGと誤表示しない',async()=>{
  const f=fixture();f.machine.state=scenario(1,'omen','trial-2');f.machine.state.normalGames=321;const before=structuredClone(f.floor),html=await f.html();
  expect(html).toMatch(/gaisen-normal\.js\?v=[a-f0-9]{10}/);expect(html).toContain('class="gt-normal-effects" aria-hidden="true"');expect(html).toContain('通常累計 <b>321G</b>');expect(html).not.toMatch(/data-normal-cue=|data-normal-mood=/);expect(f.floor).toEqual(before);
 });
 it('診断は初期OFFの本人操作で、CSPを守って版つきのJSを読む',async()=>{
  const html=await fixture().html();
  expect(html).toMatch(/gaisen-diagnostics\.js\?v=[a-f0-9]{10}/);
  expect(html).toMatch(/data-gt-diagnostic-build="[a-f0-9]{10}"/);
  expect(html).toMatch(/data-gt-build="[a-f0-9]{10}"/);
  expect(html).toContain('data-gt-diagnostic-toggle="true" aria-pressed="false"');
  for(const control of ['toggle','clear','copy'])expect(html).toMatch(new RegExp(`type="button"[^>]*data-gt-diagnostic-${control}`));
  expect(html).toContain('data-gt-diagnostic-rows="true"></tbody>');
  expect(html).not.toMatch(/on(?:click|change)=|<script>|style=/);
 });
 it('操作卓の数字は現在の試遊ポイントと保存済み払出を表示し、装飾で状態を変えない',async()=>{
  const f=fixture();f.machine.state.balance=98765;f.machine.state.lastPaid=150;
  const before=structuredClone(f.floor),html=await f.html();
  expect(html).toContain('data-gt-credit="true">98,765</b>');expect(html).toContain('data-gt-payout="true">150</b>');
  expect(html).toContain('gt-lever-hardware');expect(html.match(/class="gt-stop-lamp"/g)).toHaveLength(3);
  expect(html).toContain('class="gt-apron" aria-hidden="true"');expect(html).toContain('class="gt-medal-tray" aria-hidden="true"');
  expect(html).toContain('gaisen-stage.js?v=');expect(html).not.toMatch(/data-transition=|data-light-stage=/);expect(html).not.toMatch(/on(?:click|keydown)=|<script>/);expect(f.floor).toEqual(before);
 });
 it('1,000万ポイント付近も省略せず表示し、桁の多い数字だけ縮める',async()=>{
  const f=fixture();f.machine.state.balance=10100000;
  const before=structuredClone(f.floor),html=await f.html();
  expect(html).toContain('class="gt-readout-wide" data-gt-credit="true">10,100,000</b>');
  expect(html).toContain('data-gt-payout="true">0</b>');expect(f.floor).toEqual(before);
 });
 it('通常の数字回転は役と独立した固定列で、停止すると公開済み数字へ置き換える',async()=>{
  const f=fixture();lever(f.machine.state,()=>1,'none');const before=structuredClone(f.floor);expect((await f.html()).match(/class="gt-number-cycle"/g)).toHaveLength(3);expect(f.floor).toEqual(before);stop(f.machine.state,0,()=>1);expect((await f.html()).match(/class="gt-number-cycle"/g)).toHaveLength(2);
 });
 it('GODは最終STOP後に液晶内へ表示し、未停止の役では告知しない',async()=>{
  const f=fixture();lever(f.machine.state,()=>1,'god');
  expect(await f.html()).not.toContain('data-gt-lcd-award');
  for(const i of [0,1]){stop(f.machine.state,i,()=>1);expect(await f.html()).not.toContain('data-gt-lcd-award');}
  stop(f.machine.state,2,()=>1);const before=structuredClone(f.floor),html=await f.html();
  expect(html).toContain('class="gt-lcd-award" data-gt-lcd-award="true" data-kind="god"');expect(html).not.toContain('data-win-stage');
  expect(html.indexOf('class="gt-display"')).toBeLessThan(html.indexOf('class="gt-reel-shelf"'));
  expect(html.indexOf('class="gt-reel-shelf"')).toBeLessThan(html.indexOf('class="gt-console"'));
  expect(f.floor).toEqual(before);
 });
 it('公開済みの区間から時間停止とEXを区別し、描画で進捗を変えない',async()=>{
  const f=fixture();
  for(const [name,scene] of [['normal','normal'],['gg','gg'],['gstop','gstop'],['sgg','sgg'],['medusa','medusa'],['sgg-ex','ex']] as const){
   f.machine.state=scenario(1,name,'trial-2');const before=structuredClone(f.floor),html=await f.html();
   expect(html).toContain(`data-scene="${scene}"`);expect(html).toContain('class="gt-lcd-hud"');expect(html).toContain('class="gt-scene-depth" aria-hidden="true"');expect(html).toContain('class="gt-win-flare" aria-hidden="true"');expect(html).not.toContain('data-win-stage');expect(html).toContain(`gaisen-media-${scene==='gg'?'award':'night'}-1600.webp?v=`);expect(f.floor).toEqual(before);
   expect(html).not.toContain('frontMode');expect(html).not.toContain('backMode');
  }
 });
 it('全押し順で次のSTOPを案内し、停止した位置だけを飛ばす',async()=>{
  for(const order of ORDERS){
   const f=fixture();f.machine.state=scenario(1,'gg','trial-2');lever(f.machine.state,()=>0,'bell');f.machine.state.pending!.order=[...order];
   for(const index of order){
    const html=await f.html();expect(html).toContain(`data-gt-key="stop-${index}" data-order="${order.indexOf(index)+1}" aria-label="${['左','中','右'][index]}STOP · 次の停止"`);
    expect(html).toContain(`data-gt-lcd-position="${index}" data-gt-lcd-next="true"`);
    expect(html.match(/data-gt-lcd-next="true"/g)).toHaveLength(1);
    expect(html).toContain('class="gt-lcd-navigation"');expect(html).not.toContain('class="gt-navi"');expect(html).not.toContain('gt-reel-cue');
    // ナビは案内。別の順に押せる従来の操作を禁止しない。
    expect((html.match(/class="gt-stop(?: is-next)?"[^>]*disabled/g)||[]).length).toBe(f.machine.state.pending!.stops.length);
    stop(f.machine.state,index,()=>1);
   }
   expect(await f.html()).toContain('レバーで次のゲームへ');expect(await f.html()).not.toContain('data-gt-lcd-navigation');
  }
 });
 it('G-STOPのHOLDでは中STOPだけ案内し、左右は停止済みを維持する',async()=>{
  const f=fixture();f.machine.state=scenario(1,'gstop','trial-2');f.machine.state.hold='V';lever(f.machine.state,()=>1,'none');
  const html=await f.html();expect(html).toContain('中STOP · 次の停止');expect(html).not.toContain('data-gt-lcd-navigation');expect(html).not.toContain('左STOP · 次の停止');expect(f.machine.state.pending!.stops).toEqual([0,2]);
 });
 it('未停止の役を背景で予告せず、音と表示の操作はPOSTしない',async()=>{
  const a=fixture(),b=fixture();lever(a.machine.state,()=>1,'god');lever(b.machine.state,()=>1,'none');
  expect(await a.html()).toEqual(await b.html());
  for(const control of ['data-gt-audio','data-gt-focus'])expect(await a.html()).toMatch(new RegExp(`type="button" ${control}`));
  expect(await a.html()).toContain('data-gt-volume');expect(await a.html()).not.toMatch(/on(?:click|change)=|<script>/);
 });
});

import {describe,it,expect} from 'vitest';
import {jsx} from 'hono/jsx';
import type {AdminSession} from '../src/db/schema.js';
import {freshFloor,trialView} from '../src/services/casino/gaisen/trial.js';
import {scenario,lever,stop,ORDERS} from '../src/services/casino/gaisen/engine.js';
import {GaisenTrial} from '../src/web/views/gaisenTrial.js';
const session={userId:'sample',username:'試遊係',level:'guji',pages:null,csrfToken:'test-only'} as AdminSession;
function fixture(){const floor=freshFloor(0,'trial-2');floor.machines[0]!.owner='sample';return {floor,machine:floor.machines[0]!,html:()=>jsx(GaisenTrial,{m:trialView(floor,'sample'),session,version:'trial-2'}).toString()};}
describe('神殿の筐体と操作案内',()=>{
 it('公開済みの区間から時間停止とEXを区別し、描画で進捗を変えない',async()=>{
  const f=fixture();
  for(const [name,scene] of [['normal','normal'],['gg','gg'],['gstop','gstop'],['medusa','medusa'],['sgg-ex','ex']] as const){
   f.machine.state=scenario(1,name,'trial-2');const before=structuredClone(f.floor),html=await f.html();
   expect(html).toContain(`data-scene="${scene}"`);expect(html).toContain('gaisen-media-night-1600.webp?v=');expect(f.floor).toEqual(before);
   expect(html).not.toContain('frontMode');expect(html).not.toContain('backMode');
  }
 });
 it('全押し順で次のSTOPを案内し、停止した位置だけを飛ばす',async()=>{
  for(const order of ORDERS){
   const f=fixture();f.machine.state=scenario(1,'gg','trial-2');lever(f.machine.state,()=>0,'bell');f.machine.state.pending!.order=[...order];
   for(const index of order){
    const html=await f.html();expect(html).toContain(`data-gt-key="stop-${index}" data-order="${order.indexOf(index)+1}" aria-label="${['左','中','右'][index]}STOP · 次の停止"`);
    // ナビは案内。別の順に押せる従来の操作を禁止しない。
    expect((html.match(/class="gt-stop(?: is-next)?"[^>]*disabled/g)||[]).length).toBe(f.machine.state.pending!.stops.length);
    stop(f.machine.state,index,()=>1);
   }
   expect(await f.html()).toContain('レバーで次のゲームへ');
  }
 });
 it('G-STOPのHOLDでは中STOPだけ案内し、左右は停止済みを維持する',async()=>{
  const f=fixture();f.machine.state=scenario(1,'gstop','trial-2');f.machine.state.hold='V';lever(f.machine.state,()=>1,'none');
  const html=await f.html();expect(html).toContain('中STOP · 次の停止');expect(html).not.toContain('左STOP · 次の停止');expect(f.machine.state.pending!.stops).toEqual([0,2]);
 });
 it('未停止の役を背景で予告せず、音と表示の操作はPOSTしない',async()=>{
  const a=fixture(),b=fixture();lever(a.machine.state,()=>1,'god');lever(b.machine.state,()=>1,'none');
  expect(await a.html()).toEqual(await b.html());
  for(const control of ['data-gt-audio','data-gt-focus'])expect(await a.html()).toMatch(new RegExp(`type="button" ${control}`));
  expect(await a.html()).toContain('data-gt-volume');expect(await a.html()).not.toMatch(/on(?:click|change)=|<script>/);
 });
});

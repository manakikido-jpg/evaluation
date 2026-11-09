import {afterEach,beforeEach,expect,it} from 'vitest';
import {makeDb,cfg,ROLE} from './helpers.js';
import type {Db} from '../src/db/client.js';
import {createWebApp} from '../src/web/app.js';
import {createMemberSession} from '../src/web/memberSessions.js';
import {recordJoin} from '../src/services/members.js';
import {addCoins,walletOf} from '../src/services/economy.js';
import {casinoGames,coinTx,settings} from '../src/db/schema.js';
const id='760000000000000001',clock=new Date('2026-11-09T04:00:00Z'),base='https://example.test';
let db:Db,close:()=>Promise<void>,token:string,app:ReturnType<typeof createWebApp>;
const headers=()=>({cookie:'sakura_casino='+token});
const makeApp=(enabled=true,roles:string[]|null=[ROLE.guji],now=clock)=>createWebApp({db,cfg:()=>({...cfg,casino:{...cfg.casino,enabled}}),api:{memberRoles:async()=>roles}as never,discord:{}as never,baseUrl:base,now:()=>now});
beforeEach(async()=>{({db,close}=await makeDb());const u={id,username:'fixture',displayName:'確認<用>',avatarUrl:null};await recordJoin(db,{...u,roleIds:[ROLE.guji],isBot:false,joinedAt:clock});await addCoins(db,id,5000,'adjust');token=await createMemberSession(db,u,clock);app=makeApp();});afterEach(async()=>close());
it('会員認証・会員再確認・カジノ停止を適用し、外から無料盤面を直接開けない',async()=>{
 expect((await app.request('/casino/pinball')).status).toBe(302);
 const off=await makeApp(false).request('/casino/pinball',{headers:headers()});expect(await off.text()).toContain('お休み');
 const stale=makeApp(true,null,new Date(clock.getTime()+3600000));const denied=await stale.request('/casino/pinball',{headers:headers()});expect(denied.status).toBe(302);expect(denied.headers.get('location')).toContain('not_member');
});
it('2種類の無料練習とCSP対応の外部素材を表示し、銭・戦績・設定へ書かない',async()=>{
 const before={coins:await db.select().from(coinTx),games:await db.select().from(casinoGames),settings:await db.select().from(settings)};
 const r=await app.request('/casino/pinball',{headers:headers()});expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toContain('no-store');const html=await r.text();
 for(const text of ['data-pinball','data-pb-mode="flipper"','data-pb-mode="plinko"','無料の練習','銭に交換できません','pinball-physics.js','pinball.js','pinball.css'])expect(html).toContain(text);
 expect(html).not.toMatch(/onclick=|style=/);expect(html).toContain('確認&lt;用&gt;');
 for(const file of ['pinball.js','pinball-physics.js','pinball.css'])expect((await app.request('/static/'+file)).status).toBe(200);
 // 得点の送信口を用意しない。改変した点数から銭を付けられない。
 const post=await app.request('/casino/pinball',{method:'POST',headers:headers(),body:new URLSearchParams({score:'999999',payout:'999999'})});expect(post.status).toBeGreaterThanOrEqual(400);
 expect((await walletOf(db,id)).balance).toBe(5000);expect(await db.select().from(coinTx)).toEqual(before.coins);expect(await db.select().from(casinoGames)).toEqual(before.games);expect(await db.select().from(settings)).toEqual(before.settings);
});
it('カジノの全体・ひとり用に入口を出し、対人卓の一覧へ混ぜない',async()=>{
 for(const group of ['all','solo']){const r=await app.request('/casino/hall?group='+group,{headers:headers()});expect(await r.text()).toContain('href="/casino/pinball"');}
 const table=await app.request('/casino/hall?group=table',{headers:headers()});expect(await table.text()).not.toContain('href="/casino/pinball"');
});

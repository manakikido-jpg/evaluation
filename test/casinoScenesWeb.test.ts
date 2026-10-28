import {beforeEach,afterEach,describe,it,expect} from 'vitest';
import {sql} from 'drizzle-orm';
import {makeDb,cfg,ROLE} from './helpers.js';
import type {Db} from '../src/db/client.js';
import {CASINO_GAMES} from '../src/config.js';
import {createWebApp} from '../src/web/app.js';
import {createSession} from '../src/web/sessions.js';
import {createMemberSession} from '../src/web/memberSessions.js';
import {recordJoin} from '../src/services/members.js';
import {addCoins,walletOf} from '../src/services/economy.js';
import {casinoGames,casinoTables,memberSessions} from '../src/db/schema.js';
const now=new Date('2026-10-28T09:00:00Z'),id='760000000000000002',user={id,username:'sample',displayName:'演出見本の運営',avatarUrl:null},path='/economy/casino-scenes';
let db:Db,close:()=>Promise<void>,app:ReturnType<typeof createWebApp>;
beforeEach(async()=>{({db,close}=await makeDb());await recordJoin(db,{...user,roleIds:[ROLE.guji],isBot:false,joinedAt:now});await addCoins(db,id,3210,'adjust');app=createWebApp({db,cfg:()=>cfg,api:{memberRoles:async()=>[ROLE.guji]} as never,discord:{guildChannels:async()=>[]} as never,baseUrl:'https://example.test',now:()=>now});});afterEach(async()=>{await close();});
const headers=(token:string)=>({cookie:'shamusho_session='+token});
describe('全ゲームの運営専用演出見本',()=>{
 it('未ログイン・一般会員・経済ページ権限のない運営は開けない',async()=>{
  expect((await app.request(path)).status).toBe(302);const member=await createMemberSession(db,user,now);expect((await app.request(path,{headers:{cookie:'sakura_casino='+member}})).status).toBe(302);const token=await createSession(db,user,{level:'shinshoku',pages:['members']},now);expect((await app.request(path,{headers:headers(token)})).status).toBe(403);
 });
 it('宮司と神職が全19ゲームの4場面とカタログを開け、POSTや実ゲームの操作先を持たない',async()=>{
  for(const level of ['guji','shinshoku']as const){const token=await createSession(db,user,{level,pages:['economy']},now);
   for(const game of CASINO_GAMES){const response=await app.request(path+'?game='+game+'&stage=3',{headers:headers(token)});expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');const text=await response.text();expect(text).toContain('data-casino-scenes');expect(text).toContain('data-scene-outcome=');expect(text).toContain('data-scene-play');expect(text).toContain('data-scene-skip');expect(text.match(/data-scene-cue="/g)).toHaveLength(4);expect(text.match(/data-scene-panel="\d"/g)).toHaveLength(4);expect(text).toContain('全19ゲーム');expect(text).toContain('固定された演出見本');expect(text).not.toContain('method="post"');expect(text).not.toContain('href="/casino/');expect(text).not.toContain('action="/casino/');expect(text).toContain('/static/casino-scenes.css?v=');}
  }
 });
 it('場面や見本を変えても財布・ゲーム・卓・会員セッションを変更しない',async()=>{
  const token=await createSession(db,user,{level:'guji',pages:null},now);const counts=()=>Promise.all([casinoGames,casinoTables,memberSessions].map(async table=>(await db.select({n:sql<number>`count(*)::int`}).from(table))[0]!.n)),before=await counts();
  for(const game of CASINO_GAMES)expect((await app.request(path+`?game=${game}&sample=2&stage=2`,{headers:headers(token)})).status).toBe(200);
  expect((await walletOf(db,id)).balance).toBe(3210);expect(await counts()).toEqual(before);expect((await app.request(path,{method:'POST',headers:headers(token)})).status).not.toBe(200);
 });
 it('不正な入力は400で返し、部屋の絵とCSSを版付きで配信する',async()=>{
  const token=await createSession(db,user,{level:'guji',pages:null},now);for(const query of ['game=missing','stage=8','sample=999'])expect((await app.request(path+'?'+query,{headers:headers(token)})).status).toBe(400);
  const css=await(await app.request('/static/casino-scenes.css')).text();for(const art of ['slots','salon','club']){expect(css).toMatch(new RegExp(`casino-room-${art}\\.webp\\?v=[a-f0-9]+`));expect((await app.request('/static/casino-room-'+art+'.webp')).headers.get('content-type')).toBe('image/webp');}
 });
});

import {beforeEach,afterEach,describe,it,expect} from 'vitest';
import {sql} from 'drizzle-orm';
import {makeDb,cfg,ROLE} from './helpers.js';
import type {Db} from '../src/db/client.js';
import {createWebApp} from '../src/web/app.js';
import {createSession,findSession} from '../src/web/sessions.js';
import {createMemberSession} from '../src/web/memberSessions.js';
import {recordJoin} from '../src/services/members.js';
import {addCoins,walletOf} from '../src/services/economy.js';
import {roomPreview} from '../src/services/casino/roomPreview.js';
import {rouletteMultiplier} from '../src/services/casino/roulette.js';
import {casinoGames,casinoTables,memberSessions} from '../src/db/schema.js';
const now=new Date('2026-10-28T03:00:00Z'),id='760000000000000001',user={id,username:'sample',displayName:'試遊の運営',avatarUrl:null},path='/economy/casino-test';
let db:Db,close:()=>Promise<void>,app:ReturnType<typeof createWebApp>;
beforeEach(async()=>{({db,close}=await makeDb());await recordJoin(db,{...user,roleIds:[ROLE.guji],isBot:false,joinedAt:now});await addCoins(db,id,3210,'adjust');app=createWebApp({db,cfg:()=>cfg,api:{memberRoles:async()=>[ROLE.guji]} as never,discord:{guildChannels:async()=>[]} as never,baseUrl:'https://example.test',now:()=>now});});afterEach(async()=>{await close();});
const headers=(token:string)=>({cookie:'shamusho_session='+token});
describe('運営だけのカジノ没入感試遊',()=>{
 it('一般セッションと経済権限のない運営を拒否する',async()=>{
  expect((await app.request(path)).status).toBe(302);const member=await createMemberSession(db,user,now);expect((await app.request(path+'?game=blackjack',{headers:{cookie:'sakura_casino='+member}})).status).toBe(302);
  const limited=await createSession(db,user,{level:'shinshoku',pages:['members']},now);expect((await app.request(path,{headers:headers(limited)})).status).toBe(403);
 });
 it('宮司・神職が社務所から3ゲームへ入れ、POST先や会員ログインを作らない',async()=>{
  for(const level of ['guji','shinshoku']as const){const token=await createSession(db,user,{level,pages:['economy']},now);for(const game of ['roulette','blackjack','highlow']){const r=await app.request(path+'?game='+game,{headers:headers(token)});expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toContain('no-store');const text=await r.text();expect(text).toContain('data-immersive-room="'+game+'"');expect(text).toContain('casino-rooms.css?v=');expect(text).not.toContain('method="post"');expect(text).not.toContain('action="/casino/');}expect(await (await app.request('/economy',{headers:headers(token)})).text()).toContain('href="/economy/casino-test"');}
 });
 it('試遊を繰り返しても残高・ゲーム・卓・会員セッションを変えない',async()=>{
  const token=await createSession(db,user,{level:'guji',pages:null},now);const count=()=>Promise.all([casinoGames,casinoTables,memberSessions].map(async table=>(await db.select({n:sql<number>`count(*)::int`}).from(table))[0]!.n));const before=await count();
  for(const query of ['game=roulette&round=5&spin=1&bets=red:100','game=blackjack','game=highlow','game=roulette&round=5&spin=1&bets=red:100'])expect((await app.request(path+'?'+query,{headers:headers(token)})).status).toBe(200);
  const session=(await findSession(db,token,now))!;expect((await app.request(path,{method:'POST',headers:headers(token),body:new URLSearchParams({_csrf:session.csrfToken,action:'spin'})})).status).toBe(404);expect((await walletOf(db,id)).balance).toBe(3210);expect(await count()).toEqual(before);
 });
 it('回転後もBETと円盤の対象を残し、当たりと出目を区別して同じ回への再BETを固定する',async()=>{
  const token=await createSession(db,user,{level:'guji',pages:null},now),query='game=roulette&round=17&spin=1&bets=n7:100,red:50';
  const m=roomPreview(new URLSearchParams(query),cfg.casino);if(m.game!=='roulette')throw Error();
  const text=await(await app.request(path+'?'+query,{headers:headers(token)})).text();
  expect(text).toContain('data-rb-settled="true"');expect(text).toContain('この回は終了しました');
  expect(text).toMatch(/data-rb-total="true">150<\/b>/);expect(text).toMatch(/data-rb-count="true">2<\/span>/);
  const pockets=[...text.matchAll(/<span class="([^"]*pk pk-[^"]*)" data-ir-pocket="(\d+)"/g)];
  expect(pockets).toHaveLength(37);
  for(const match of pockets){const cls=match[1]!,n=Number(match[2]);expect(cls.includes('ir-pocket-bet')).toBe(n===7||rouletteMultiplier('red',n)>0);expect(cls.includes('ir-pocket-result')).toBe(n===m.number);}
  expect(text).toContain('data-ir-payout="'+m.paid+'"');expect(text).toContain('data-ir-balance-before="4850"');
  expect(text).toMatch(/<button[^>]*placed[^>]*data-bet="n7"[^>]*disabled/);
 });
 it('境界BETの円盤対象も既存の判定と一致し、通常のカジノ部品には試遊の固定を強制しない',async()=>{
  const token=await createSession(db,user,{level:'guji',pages:null},now);
  const text=await(await app.request(path,{headers:headers(token)})).text();
  const cells=[...text.matchAll(/data-bet="([^"]+)" data-rb-covers="([^"]*)"/g)];expect(cells.length).toBeGreaterThan(100);
  for(const match of cells){const bet=match[1]!,covered=match[2]!;const expected=Array.from({length:37},(_,n)=>n).filter(n=>rouletteMultiplier(bet as Parameters<typeof rouletteMultiplier>[0],n)>0);expect(covered.split(',').map(Number)).toEqual(expected);}
  expect(text).not.toContain('data-rb-settled="true"');
 });
 it('不正な操作を400で返し、背景素材を軽量な版付き画像として配信する',async()=>{
  const token=await createSession(db,user,{level:'guji',pages:null},now);expect((await app.request(path+'?game=highlow&moves=cashout',{headers:headers(token)})).status).toBe(400);
  const css=await(await app.request('/static/casino-rooms.css')).text();expect(css).toMatch(/casino-room-roulette.webp\?v=[a-f0-9]+/);expect((await app.request('/static/casino-room-highlow.webp')).headers.get('content-type')).toBe('image/webp');
 });
});

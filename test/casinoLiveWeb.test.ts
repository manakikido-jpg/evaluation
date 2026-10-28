import {beforeEach,afterEach,describe,it,expect} from 'vitest';
import {eq} from 'drizzle-orm';
import {makeDb,cfg,ROLE} from './helpers.js';
import type {Db} from '../src/db/client.js';
import {CASINO_GAMES,TABLE_KINDS} from '../src/config.js';
import {createWebApp} from '../src/web/app.js';
import {createSession,findSession,deleteSession} from '../src/web/sessions.js';
import {createMemberSession,findMemberSession} from '../src/web/memberSessions.js';
import {recordJoin} from '../src/services/members.js';
import {addCoins,walletOf} from '../src/services/economy.js';
import {createTable} from '../src/services/casino/tables/service.js';
import {casinoGames} from '../src/db/schema.js';
const now=new Date('2026-10-28T12:00:00Z'),id='760000000000000001',user={id,username:'live',displayName:'実画面の運営',avatarUrl:null};
const config={...cfg,casino:{...cfg.casino,atOpen:true,games:[...CASINO_GAMES]}};
let db:Db,close:()=>Promise<void>,app:ReturnType<typeof createWebApp>,staff:string,member:string,csrf:string,staffCsrf:string,grantedRoles:string[];
const cookies=(s=staff,m=member,mode=true)=>`shamusho_session=${s}; sakura_casino=${m}${mode?'; sakura_casino_presentation=1':''}`;
beforeEach(async()=>{grantedRoles=[ROLE.guji,ROLE.sanpaisha];({db,close}=await makeDb());await recordJoin(db,{...user,roleIds:[ROLE.guji,ROLE.sanpaisha],isBot:false,joinedAt:now});await addCoins(db,id,50000,'adjust');staff=await createSession(db,user,{level:'guji',pages:['economy']},now);member=await createMemberSession(db,user,now);csrf=(await findMemberSession(db,member,now))!.csrfToken;staffCsrf=(await findSession(db,staff,now))!.csrfToken;app=createWebApp({db,cfg:()=>config,api:{memberRoles:async()=>grantedRoles} as never,discord:{} as never,baseUrl:'https://example.test',now:()=>now});});afterEach(async()=>{await close();});
const get=(path:string,cookie=cookies())=>app.request(path,{headers:{cookie}});
const post=(path:string,body:Record<string,string>,cookie=cookies())=>app.request(path,{method:'POST',headers:{cookie},body:new URLSearchParams(body)});
describe('運営が実ゲームの新デザインを確認',()=>{
 it('入口は銭が動くことを説明し、有効化には運営権限とCSRFが必要',async()=>{
  const before=(await walletOf(db,id)).balance;expect(await(await get('/economy/casino-live')).text()).toContain('実際の銭と戦績');
  expect((await post('/economy/casino-live/enable',{})).status).toBe(403);expect((await post('/economy/casino-live/enable',{_csrf:csrf},`sakura_casino=${member}`)).status).not.toBe(303);
  const result=await post('/economy/casino-live/enable',{_csrf:staffCsrf});expect(result.status).toBe(303);expect(result.headers.get('location')).toBe('/casino/hall');expect(result.headers.get('set-cookie')).toContain('sakura_casino_presentation=1');expect((await walletOf(db,id)).balance).toBe(before);expect(await db.select().from(casinoGames)).toHaveLength(0);
 });
 it('新しい表示は会員みんなに出し、「元の表示へ」を選んだ人だけ元の表示。「新しい表示にする」で戻せる',async()=>{
  const plain=`sakura_casino=${member}`;
  expect(await(await get('/casino/blackjack',plain)).text()).toContain('data-casino-immersive="true"');
  const old=await(await get('/casino/blackjack',plain+'; sakura_casino_presentation=0')).text();
  expect(old).not.toContain('data-casino-immersive="true"');expect(old).not.toContain('casino-live.css?v=');expect(old).toContain('新しい表示にする');
  expect((await post('/casino/presentation/enter',{},plain+'; sakura_casino_presentation=0')).status).toBe(403);
  const enter=await post('/casino/presentation/enter',{_csrf:csrf},plain+'; sakura_casino_presentation=0');expect(enter.status).toBe(303);expect(enter.headers.get('set-cookie')).toContain('sakura_casino_presentation=;');
 });
 it('単独ゲームと対人戦の実ルートへ接続し、POST先とCSRFを維持',async()=>{
  // スロット（通常・AT 機）は、新しい表示でももとの見た目のまま
  for(const game of ['slots','atslot']){const response=await get('/casino/'+game);expect(response.status).toBe(200);const text=await response.text();expect(text).not.toContain('data-casino-immersive="true"');expect(text).not.toContain('casino-live.css?v=');}
  for(const game of ['blackjack','highlow','baccarat','roulette','chinchiro','othello','versus']){const response=await get('/casino/'+game);expect(response.status).toBe(200);const text=await response.text();expect(text).toContain('data-casino-immersive="true"');expect(text).toContain(`data-ci-game="${game}"`);expect(text).toContain('casino-live.css?v=');expect(text).toContain('新しいカジノの表示');expect(text).not.toContain('data-scene-panel');expect(text).toContain(`value="${csrf}"`);}
 });
 it('全10種類の実際の卓とフラグメントを同じモードで表示する',async()=>{
  for(const [i,kind] of TABLE_KINDS.entries()){const host={id:String(760000000000000100n+BigInt(i)),name:'卓の見本'+i};await recordJoin(db,{...user,id:host.id,displayName:host.name,roleIds:[ROLE.sanpaisha],isBot:false,joinedAt:now});await addCoins(db,host.id,50000,'adjust');const made=await createTable(db,config,kind,host,{entry:'0',bb:'20',buyin:'1000',window:'2'},now);if(!('table'in made))throw Error(kind+':'+made.status);const response=await get('/casino/t/'+made.table.id);expect(response.status).toBe(200);const text=await response.text();expect(text).toContain(`data-ci-game="${kind}"`);expect(text).toContain('data-ci-enabled="true"');expect(text).toContain(`/casino/t/${made.table.id}/`);const frag=await(await get(`/casino/t/${made.table.id}/frag`)).text();expect(frag).toContain('data-ci-enabled="true"');expect(frag).toContain('data-ci-round=');}
 });
 it('実際のBETと精算は既存エンジンで一度だけ進み、表示切替は財布に影響しない',async()=>{
  const before=(await walletOf(db,id)).balance;const start=await post('/casino/blackjack',{_csrf:csrf,bet:'100'});expect(start.status).toBe(302);let [row]=await db.select().from(casinoGames).where(eq(casinoGames.memberId,id));expect(row).toBeDefined();
  expect((await walletOf(db,id)).balance).toBe(before-row!.bet+(row!.status==='done'?row!.payout:0));
  if(row!.status==='playing'){const body={_csrf:csrf,action:'stand',v:String(row!.version)};await post('/casino/blackjack/'+row!.id,body);[row]=await db.select().from(casinoGames).where(eq(casinoGames.memberId,id));const balance=(await walletOf(db,id)).balance;await post('/casino/blackjack/'+row!.id,body);expect((await walletOf(db,id)).balance).toBe(balance);}
  expect((await walletOf(db,id)).balance).toBe(before-row!.bet+row!.payout);const settled=(await walletOf(db,id)).balance;
  expect((await post('/casino/presentation/exit',{})).status).toBe(403);const exit=await post('/casino/presentation/exit',{_csrf:csrf});expect(exit.status).toBe(303);expect(exit.headers.get('set-cookie')).toContain('sakura_casino_presentation=0');expect((await walletOf(db,id)).balance).toBe(settled);
  const text=await(await get('/casino/blackjack',`sakura_casino=${member}; sakura_casino_presentation=0`)).text();expect(text).not.toContain('casino-live.css?v=');expect(text).toContain(`action="/casino/blackjack`);
 });
});

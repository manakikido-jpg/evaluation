import {randomUUID} from 'node:crypto';
import {afterEach,beforeEach,expect,it} from 'vitest';
import {eq} from 'drizzle-orm';
import {makeDb,cfg,ROLE} from './helpers.js';
import type {Db} from '../src/db/client.js';
import {createWebApp} from '../src/web/app.js';
import {createMemberSession,findMemberSession} from '../src/web/memberSessions.js';
import {createSession,findSession} from '../src/web/sessions.js';
import {recordJoin} from '../src/services/members.js';
import {addCoins,walletOf} from '../src/services/economy.js';
import {casinoGames,coinTx} from '../src/db/schema.js';
import {ARCADE_KINDS,type ArcadeKind} from '../src/domain/casinoArcade.js';
import {loadOverrides} from '../src/services/settings.js';
import {arcadeById,arcadeState} from '../src/services/casino/arcade.js';
const id='760000000000000001',other='760000000000000002',base='https://example.test';let db:Db,close:()=>Promise<void>,app:ReturnType<typeof createWebApp>,token:string,csrf:string,admin:string,adminCsrf:string,clock:Date;
const headers=(t=token)=>({cookie:'sakura_casino='+t,origin:base,'sec-fetch-site':'same-origin'});
const make=(c=cfg,roles:string[]|null=[ROLE.guji])=>createWebApp({db,cfg:()=>c,api:{memberRoles:async()=>roles}as never,discord:{guildRoles:async()=>[],guildChannels:async()=>[]}as never,baseUrl:base,now:()=>clock});
async function post(kind:ArcadeKind,values:Record<string,string|string[]>){const b=new URLSearchParams({_csrf:csrf,operationId:randomUUID(),action:'start',bet:'100'});for(const[k,v]of Object.entries(values)){b.delete(k);for(const item of Array.isArray(v)?v:[v])b.append(k,item);}return app.request('/casino/arcade/'+kind,{method:'POST',headers:headers(),body:b});}
beforeEach(async()=>{({db,close}=await makeDb());clock=new Date('2026-11-09T05:00:00Z');const u={id,username:'fixture',displayName:'確認<用>',avatarUrl:null};await recordJoin(db,{...u,roleIds:[ROLE.guji],isBot:false,joinedAt:clock});await addCoins(db,id,5000,'adjust');token=await createMemberSession(db,u,clock);csrf=(await findMemberSession(db,token,clock))!.csrfToken;admin=await createSession(db,u,{level:'guji',pages:['economy']},clock);adminCsrf=(await findSession(db,admin,clock))!.csrfToken;app=make();});afterEach(async()=>close());
it('台の全一覧/各画面/素材と、既存5系統への入口を公開し、認証とCSPを守る',async()=>{
 expect((await app.request('/casino/arcade')).status).toBe(302);const hub=await(await app.request('/casino/arcade',{headers:headers()})).text();for(const kind of ARCADE_KINDS){expect(hub).toContain('href="/casino/arcade/'+kind+'"');const r=await app.request('/casino/arcade/'+kind,{headers:headers()});expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toContain('no-store');const html=await r.text();expect(html).toContain('data-casino-arcade');expect(html).toContain('配当・確率は咲楽ノ宮版');expect(html).not.toMatch(/onclick=|style=/);expect(html).toContain('確認&lt;用&gt;');}
 for(const game of ['roulette','blackjack','slots','highlow','baccarat'])expect(hub).toContain('href="/casino/'+game+'"');for(const file of ['casino-arcade.css','casino-arcade.js'])expect((await app.request('/static/'+file)).status).toBe(200);expect((await app.request('/casino/arcade/no-such-game',{headers:headers()})).status).toBe(404);
});
it('CSRF不正では徴収せず、応答が途切れた開始の再送は同じ回を返す',async()=>{
 expect((await post('fortune',{_csrf:'bad'})).status).toBe(403);expect((await walletOf(db,id)).balance).toBe(5000);
 const operationId=randomUUID(),values={operationId,payout:'9999999',mult:'9999999'},one=await post('fortune',values),two=await post('fortune',values);expect(one.status).toBe(303);expect(two.headers.get('location')).toBe(one.headers.get('location'));const [r]=await db.select().from(casinoGames);expect(r!.payout).toBeLessThanOrEqual(300);expect((await walletOf(db,id)).balance).toBe(5000-100+r!.payout);expect(await db.select().from(coinTx).where(eq(coinTx.reason,'casino_bet'))).toHaveLength(1);
});
it('地雷/山札を返さず、偽の払戻額を使わず精算し、別アカウントの回を読ませない',async()=>{
 const started=await post('mines',{}),n=Number(new URL(started.headers.get('location')!,base).searchParams.get('round')),row=(await arcadeById(db,id,n))!,s=arcadeState(row),safe=Array.from({length:25},(_,i)=>i).find(i=>!s.hidden.mines.includes(i))!;
 const data=await(await app.request('/casino/arcade/round/'+n+'/state',{headers:headers()})).json()as any;expect(data.model.hidden).toBeUndefined();expect(data.model.deck).toBeUndefined();expect(data.model.board).toEqual(Array(25).fill('hidden'));
 const t=await createMemberSession(db,{id:other,username:'other',displayName:'別の確認',avatarUrl:null},clock);expect((await app.request('/casino/arcade/round/'+n+'/state',{headers:headers(t)})).status).toBe(404);
 expect((await post('mines',{action:'pick',id:String(n),version:'0',choice:String(safe)})).status).toBe(303);const operationId=randomUUID(),p={operationId,action:'collect',id:String(n),version:'1',payout:'9999999'};expect((await post('mines',p)).status).toBe(303);expect((await post('mines',p)).status).toBe(303);expect((await walletOf(db,id)).balance).toBe(5010);expect((await arcadeById(db,id,n))?.payout).toBe(110);
});
it('再起動後も同じ回を続け、ゲーム別休止後の受取は許可し、カジノ全体停止と会員再確認を守る',async()=>{
 const r=await post('tower',{}),n=Number(new URL(r.headers.get('location')!,base).searchParams.get('round')),original=(await arcadeById(db,id,n))!;app=make();const publicState=await(await app.request('/casino/arcade/round/'+n+'/state',{headers:headers()})).json()as any;expect(publicState.id).toBe(n);expect(publicState.version).toBe(0);expect(publicState.model.hidden).toBeUndefined();expect(await arcadeById(db,id,n)).toEqual(original);
 app=make({...cfg,casino:{...cfg.casino,games:[],arcadeGames:[]}});expect((await post('tower',{action:'giveup',id:String(n),version:'0'})).status).toBe(303);expect((await arcadeById(db,id,n))?.status).toBe('done');
 app=make({...cfg,casino:{...cfg.casino,enabled:false}});expect(await(await app.request('/casino/arcade',{headers:headers()})).text()).toContain('お休み');
 clock=new Date(+clock+3600000);app=make(cfg,null);expect((await app.request('/casino/arcade',{headers:headers()})).status).toBe(302);
});
it('宮司だけが新台の個別ON/OFFを保存し、従来フォームでは元の選択を保持する',async()=>{
 const settingsApp=make({...cfg,casino:{...cfg.casino,arcadeGames:['mines','crash']}}),h={cookie:'shamusho_session='+admin,origin:base,'sec-fetch-site':'same-origin'};
 const data=()=>new URLSearchParams({_csrf:adminCsrf,enabled:'yes',minBet:'10',maxBet:'1000',dailyBetLimit:'0',games:'arcade'});
 expect((await settingsApp.request('/economy/casino',{method:'POST',headers:h,body:data()})).headers.get('location')).toBe('/economy/casino?msg=saved');expect((await loadOverrides(db)).casino?.arcadeGames).toEqual(['mines','crash']);
 const b=data();b.set('arcadeGamesPresent','1');b.set('arcadeGames','keno');expect((await settingsApp.request('/economy/casino',{method:'POST',headers:h,body:b})).headers.get('location')).toBe('/economy/casino?msg=saved');expect((await loadOverrides(db)).casino?.arcadeGames).toEqual(['keno']);
 const denied=data();expect((await settingsApp.request('/economy/casino',{method:'POST',headers:headers(),body:denied})).status).toBeGreaterThanOrEqual(300);
});

it('一覧は11台の専用図柄と入口を持ち、盤面の操作を筐体の中に残す',async()=>{
 const hub=await(await app.request('/casino/arcade',{headers:headers()})).text();
 expect(hub.match(/class="ag-art"/g)).toHaveLength(11);expect(hub).toContain('今夜は、どの台へ。');
 const ids=[...hub.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);expect(new Set(ids).size).toBe(ids.length);
 const mines=await commandForMines();const response=await app.request('/casino/arcade/mines?round='+mines,{headers:headers()}),html=await response.text();
 expect(html).toContain('class="ag-machine"');expect(html).toContain('name="choice" value="24"');expect(html).toContain('aria-label="25番のマス hidden"');expect(html).not.toContain('💎');expect(html).not.toMatch(/onclick=|style=/);
 const keno=await(await app.request('/casino/arcade/keno',{headers:headers()})).text();expect(keno).toContain('name="picks" value="40"');
});
async function commandForMines(){const r=await post('mines',{});expect(r.status).toBe(303);return new URL(r.headers.get('location')!,base).searchParams.get('round')!;}

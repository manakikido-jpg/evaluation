import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { fortuneGamesSchema, type GuildConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { createWebApp } from '../src/web/app.js';
import { createMemberSession } from '../src/web/memberSessions.js';
import { createSession, findSession } from '../src/web/sessions.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { applyOverrides, loadOverrides } from '../src/services/settings.js';
import { buyScratch, ensureLotteryRound } from '../src/services/casino/fortune.js';
import type { DiscordApi } from '../src/web/discordApi.js';
import type { DiscordActions } from '../src/lib/discordRest.js';
import { cfg, makeDb, ROLE } from './helpers.js';
const A='760000000000000001',B='760000000000000002',BASE='https://test.example';
let api:DiscordApi;
let db:Db,close:()=>Promise<void>,app:ReturnType<typeof createWebApp>,current:GuildConfig,cookie:string,csrf:string,now:Date;
beforeEach(async()=>{
 ({db,close}=await makeDb());now=new Date('2026-10-17T03:00:00Z');
 current={...cfg,casino:{...cfg.casino,enabled:true},fortuneGames:fortuneGamesSchema.parse({enabled:true})};
 api={authorizeUrl:(state,redirect)=>`https://discord.com/oauth2/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirect)}`,exchangeCode:async()=>'',me:async()=>({id:A,username:'a',displayName:'あや',avatarUrl:null}),memberRoles:async()=>[ROLE.guji]};
 const base=current;
 app=createWebApp({db,cfg:()=>current,fileCfg:base,api,discord:{} as DiscordActions,baseUrl:BASE,now:()=>now,onSettingsSaved:async()=>{current=applyOverrides(base,await loadOverrides(db));}});
 cookie=await createMemberSession(db,{id:A,username:'a',displayName:'あや<b>',avatarUrl:null},now);
 await addCoins(db,A,5000,'admin_grant');
 const page=await get();const html=await page.text();csrf=/name="_csrf" value="([^"]+)"/.exec(html)![1]!;
});
afterEach(async()=>close());
const get=(path='/lottery')=>app.request(path,{headers:{cookie:'sakura_lottery='+cookie}});
const post=(path:string,body:Record<string,string>,extra:Record<string,string>={})=>app.request(path,{method:'POST',headers:{cookie:'sakura_lottery='+cookie,'content-type':'application/x-www-form-urlencoded',...extra},body:new URLSearchParams({_csrf:csrf,quote:String(current.fortuneGames.scratchPrice),...body})});
it('会員だけ購入でき、CSRF不足・価格偽装を許可しない',async()=>{
 expect(await (await app.request('/lottery')).text()).toContain('/lottery/auth');
 expect((await app.request('/lottery/scratch',{method:'POST'})).status).toBe(303);
 const id=randomUUID();
 expect((await post('/lottery/scratch',{nonce:id,_csrf:'bad'})).status).toBe(403);
 const buy=await post('/lottery/scratch',{nonce:id,price:'0',payout:'999999'});
 expect(buy.status).toBe(303);expect((await walletOf(db,A)).balance).toBe(4900);
 expect((await post('/lottery/scratch',{nonce:id})).headers.get('location')).toBe(buy.headers.get('location'));
 expect((await walletOf(db,A)).balance).toBe(4900);
 const html=await (await get('/lottery?ticket='+id)).text();
 expect(html).toContain('data-opened="no"');expect(html).not.toContain('999999');expect(html).toContain('fortune.js');
});
it('JSなしの開封とJSON開封は同じ結果で、他人の券は開けない',async()=>{
 const id=await buyScratch(db,A,randomUUID(),current.fortuneGames,()=>now,()=>9950);
 const result=await post(`/lottery/scratch/${id}/open`,{}, {accept:'application/json'});
 expect(result.status).toBe(200);expect(await result.json()).toMatchObject({payout:1000,balance:5900});
 expect((await post(`/lottery/scratch/${id}/open`,{})).status).toBe(303);
 expect((await walletOf(db,A)).balance).toBe(5900);
 expect(await (await get()).text()).toContain('払戻 1000');
 const b=await createMemberSession(db,{id:B,username:'b',displayName:'べに',avatarUrl:null},now);
 const previous=cookie;cookie=b;const html=await(await get()).text();const otherCsrf=/name="_csrf" value="([^"]+)"/.exec(html)![1]!;
 expect((await post(`/lottery/scratch/${id}/open`,{_csrf:otherCsrf},{accept:'application/json'})).status).toBe(400);cookie=previous;
});
it('カジノ全体と新規購入が休止しても、購入済みの券は開ける',async()=>{
 const id=await buyScratch(db,A,randomUUID(),current.fortuneGames,()=>now,()=>9950);
 current={...current,casino:{...current.casino,enabled:false},fortuneGames:{...current.fortuneGames,enabled:false}};
 expect((await get()).status).toBe(200);
 const opened=await post(`/lottery/scratch/${id}/open`,{},{accept:'application/json'});
 expect(opened.status).toBe(200);expect((await walletOf(db,A)).balance).toBe(5900);
});
it('宝くじはサーバー側の開催条件で購入し、再送しても1枚だけ',async()=>{
 const r=(await ensureLotteryRound(db,current.fortuneGames,now))!;
 const id=randomUUID();
 expect((await post('/lottery/tickets',{nonce:id,roundId:r.id,price:'0',bonus:'999999'})).status).toBe(303);
 await post('/lottery/tickets',{nonce:id,roundId:r.id});expect((await walletOf(db,A)).balance).toBe(4900);
 expect(await (await get()).text()).toContain('今回のあなたの番号：#1');
});
it('社務所の設定は宮司とページ権限・CSRFを確認し、他の設定を保つ',async()=>{
 const token=await createSession(db,{id:A,username:'a',displayName:'宮司',avatarUrl:null},{level:'guji',pages:null},now);
 const s=(await findSession(db,token,now))!;
 const headers={cookie:'shamusho_session='+token,'content-type':'application/x-www-form-urlencoded'};
 expect((await app.request('/economy/fortune',{headers})).status).toBe(200);
 expect((await app.request('/economy/fortune',{method:'POST',headers})).status).toBe(403);
 const form={_csrf:s.csrfToken,enabled:'yes',scratchPrice:'120',scratchDailyLimit:'3',lotteryPrice:'150',lotteryLimit:'7',lotteryReturnPct:'60',lotteryBonus:'1500'};
 expect((await app.request('/economy/fortune',{method:'POST',headers,body:new URLSearchParams(form)})).status).toBe(303);
 expect(current.fortuneGames.lotteryBonus).toBe(1500);expect(current.casino.enabled).toBe(true);
 expect((await app.request('/economy/fortune',{method:'POST',headers,body:new URLSearchParams({...form,lotteryBonus:'-1'})})).headers.get('location')).toContain('invalid');
 for(const access of [{level:'shinshoku' as const,pages:null},{level:'guji' as const,pages:['members' as const]}]){
  const t=await createSession(db,{id:A,username:'a',displayName:'運営',avatarUrl:null},access,now);const session=(await findSession(db,t,now))!;
  expect((await app.request('/economy/fortune',{method:'POST',headers:{...headers,cookie:'shamusho_session='+t},body:new URLSearchParams({...form,_csrf:session.csrfToken})})).status).toBe(403);
 }
});
it('会員画面は内容をエスケープし、CSPと静的アセットを保持する',async()=>{
 const page=await get();const html=await page.text();expect(html).toContain('あや&lt;b&gt;');expect(html).not.toContain('onclick=');expect(html).not.toContain('<script>');
 expect(page.headers.get('content-security-policy')).toContain("script-src 'self'");
 expect((await app.request('/static/fortune.js')).status).toBe(200);expect((await app.request('/static/fortune.css')).status).toBe(200);
});

it('価格変更前の画面からは引き落とさず、新しい価格を表示してから買う',async()=>{
 current={...current,fortuneGames:{...current.fortuneGames,scratchPrice:200}};
 const old=await post('/lottery/scratch',{nonce:randomUUID(),quote:'100'});
 expect(decodeURIComponent(old.headers.get('location')!)).toContain('値段が変わりました');
 expect((await walletOf(db,A)).balance).toBe(5000);
 expect(await(await get()).text()).toContain('1枚買う（200');
 expect((await post('/lottery/scratch',{nonce:randomUUID(),quote:'200'})).status).toBe(303);
 expect((await walletOf(db,A)).balance).toBe(4800);
});

it('専用認証から売り場へ戻り、カジノのCookieでは入場できない',async()=>{
 const entry=await app.request('/lottery',{headers:{cookie:'sakura_casino='+cookie}});
 const html=await entry.text();expect(html).toContain('/lottery/auth');expect(html).not.toContain('/casino/hall');
 const start=await app.request('/lottery/auth');
 const state=new URL(start.headers.get('location')!).searchParams.get('state')!;
 const stateCookie='sakura_lottery_state='+state;
 expect(start.headers.get('set-cookie')).toContain('Path=/casino/auth');
 const bad=await app.request('/casino/auth/callback?state=wrong&code=test',{headers:{cookie:stateCookie}});
 expect(bad.headers.get('set-cookie') ?? '').not.toContain('sakura_lottery=');
 const callback=await app.request('/casino/auth/callback?state='+state+'&code=test',{headers:{cookie:stateCookie}});
 expect(callback.headers.get('location')).toBe('/lottery');
 expect(callback.headers.get('set-cookie')).toContain('sakura_lottery=');expect(callback.headers.get('set-cookie')).toContain('Path=/lottery');
 expect((await post('/lottery/logout',{})).status).toBe(303);
 expect(await(await get()).text()).toContain('/lottery/auth');
});
it('カジノの休止に依存せず購入できる',async()=>{
 current={...current,casino:{...current.casino,enabled:false}};
 const html=await(await get()).text();expect(html).toContain('宝くじ売り場');expect(html).not.toContain('カジノ');
 expect((await post('/lottery/scratch',{nonce:randomUUID()})).status).toBe(303);
 expect((await walletOf(db,A)).balance).toBe(4900);
});
it('入場条件の失効とDiscord確認失敗では購入させない',async()=>{
 now=new Date(now.getTime()+11*60_000);api.memberRoles=async()=>{throw Error('offline');};
 expect((await post('/lottery/scratch',{nonce:randomUUID()})).status).toBe(503);
 expect((await walletOf(db,A)).balance).toBe(5000);
 api.memberRoles=async()=>null;
 expect((await post('/lottery/scratch',{nonce:randomUUID()})).status).toBe(303);
 expect((await walletOf(db,A)).balance).toBe(5000);
 expect(await(await get()).text()).toContain('/lottery/auth');
 const start=await app.request('/lottery/auth');const state=new URL(start.headers.get('location')!).searchParams.get('state')!;
 const denied=await app.request('/casino/auth/callback?state='+state+'&code=test',{headers:{cookie:'sakura_lottery_state='+state}});
 expect(denied.headers.get('set-cookie') ?? '').not.toContain('sakura_lottery=');
});
it('🎫 売り場のボタンのリンクで、ログインなしで入れる（1 回だけ・ほかのサイトからは入れない）',async()=>{
 const { createLoginLink } = await import('../src/services/casino/loginLinks.js');
 const token=await createLoginLink(db,{id:B,displayName:'びー',avatarUrl:null});
 expect(await (await app.request(`/lottery/link/${token}`)).text()).toContain('びー さんとして入ります');
 expect((await app.request(`/lottery/link/${token}`,{method:'POST',headers:{origin:'https://evil.example'}})).status).toBe(403);
 const ok=await app.request(`/lottery/link/${token}`,{method:'POST',headers:{origin:BASE}});
 expect(ok.status).toBe(303);expect(ok.headers.get('location')).toBe('/lottery');
 const set=ok.headers.get('set-cookie')!;expect(set).toContain('sakura_lottery=');
 const c=/sakura_lottery=([^;]+)/.exec(set)![1]!;
 expect(await (await app.request('/lottery',{headers:{cookie:'sakura_lottery='+c}})).text()).toContain('いまの残高');
 expect((await app.request(`/lottery/link/${token}`,{method:'POST',headers:{origin:BASE}})).headers.get('location')).toContain('/lottery?error=');
});
it('社務所の宝くじタブにスクラッチ収支と払戻額を出し、一般の売り場には出さない',async()=>{
 const {fortuneScratch}=await import('../src/db/schema.js');
 await db.insert(fortuneScratch).values({id:randomUUID(),memberId:A,day:'2026-10-17',price:100,payout:1000,createdAt:now,openedAt:now});
 const token=await createSession(db,{id:A,username:'a',displayName:'運営',avatarUrl:null},{level:'guji',pages:null},now);
 const res=await app.request('/economy/fortune?period=today',{headers:{cookie:'shamusho_session='+token}});
 expect(res.status).toBe(200);const html=await res.text();
 expect(html).toContain('差引回収額');expect(html).toContain('-900 銭');expect(html).toContain('1,000 銭');
 expect(html).toContain('確定利益ではありません');expect(html).toContain('今の価格での払戻例');
 expect(html).toContain('period=today#scratch-finances');expect(html).toContain('aria-current="page"');
 expect(html).not.toMatch(/onclick=|style=|<script>/);
 expect((await app.request('/economy/fortune')).status).toBe(302);
 expect(await(await get()).text()).not.toContain('差引回収額');
 const limited=await createSession(db,{id:B,username:'b',displayName:'限定',avatarUrl:null},{level:'shinshoku',pages:['members']},now);
 expect((await app.request('/economy/fortune',{headers:{cookie:'shamusho_session='+limited}})).status).toBe(403);
});

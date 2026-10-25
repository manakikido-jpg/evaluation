import { randomUUID } from 'node:crypto';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { marketListings,marketOrders,marketRequests,members } from '../src/db/schema.js';
import type { GuildConfig } from '../src/config.js';
import type { DiscordApi } from '../src/web/discordApi.js';
import type { DiscordActions,GuildChannel } from '../src/lib/discordRest.js';
import { createWebApp } from '../src/web/app.js';
import { createMemberSession,findMemberSession } from '../src/web/memberSessions.js';
import { createLoginLink,peekLoginLink } from '../src/services/casino/loginLinks.js';
import { createListing,makeOffer,refundOrder } from '../src/services/market.js';
import { addCoins,walletOf } from '../src/services/economy.js';
import { cfg,makeDb } from './helpers.js';
const A='700000000000000001',B='700000000000000002',C='700000000000000003',ROLE='710000000000000001',CHANNEL='720000000000000001',BASE='https://test.example';
const now=new Date('2026-10-25T12:00:00+09:00');
let db:Db,close:()=>Promise<void>,app:ReturnType<typeof createWebApp>,current:GuildConfig,api:DiscordApi,channels:GuildChannel[],roles:Map<string,string[]>,broken:boolean;
beforeEach(async()=>{
 ({db,close}=await makeDb());current={...cfg,channels:{...cfg.channels,market:CHANNEL},roles:{...cfg.roles,merchant:ROLE}};broken=false;
 roles=new Map([[A,[ROLE]],[B,[]],[C,[]]]);channels=[{id:CHANNEL,name:'市場',type:0,parent_id:null,position:0,permission_overwrites:[]}];
 await db.insert(members).values([A,B,C].map(id=>({id,username:id,displayName:id===A?'出品者':'メンバー',ageGroup:id===C?'minor':'adult'})));await addCoins(db,B,10000,'admin_grant');await addCoins(db,C,10000,'admin_grant');
 api={authorizeUrl:(state,redirect)=>'https://discord.com/oauth2/authorize?state='+state+'&redirect_uri='+encodeURIComponent(redirect),exchangeCode:vi.fn(async()=> 'access'),me:async()=>({id:B,username:'buyer',displayName:'買い手',avatarUrl:null}),memberRoles:async(_g,id)=>{if(broken)throw new Error('offline');return roles.get(id)??null;}};
 const discord={guildChannels:async()=>channels,guildRoles:async()=>[{id:cfg.guildId,name:'@everyone',position:0,managed:false,color:0,permissions:'66560'},{id:ROLE,name:'開業',position:1,managed:false,color:0,permissions:'0'}]} as unknown as DiscordActions;
 app=createWebApp({db,cfg:()=>current,api,discord,baseUrl:BASE,now:()=>now});
});
afterEach(async()=>close());
async function login(id=B){const token=await createMemberSession(db,{id,username:id,displayName:id===B?'買い手 <b>':'出品者',avatarUrl:null},now);return {token,csrf:(await findMemberSession(db,token,now))!.csrfToken};}
type Login=Awaited<ReturnType<typeof login>>;
const get=(s:Login,path='/marketplace')=>app.request(path,{headers:{cookie:'sakura_market='+s.token}});
const post=(s:Login,action:string,id:number,b:Record<string,string>={})=>app.request('/marketplace/actions/'+action+'/'+id,{method:'POST',headers:{cookie:'sakura_market='+s.token,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({_csrf:s.csrf,nonce:randomUUID(),...b})});
async function listing(category='illust',pricing:'fixed'|'offer'='fixed'){const r=await createListing(db,current,{id:A,roleIds:[ROLE]},{category,title:category==='call'?'非公開の通話タイトル':'見本イラスト',description:'説明 <script>alert(1)</script>',price:1000,pricing});if(r.status!=='ok')throw new Error(r.status);return r.listing;}
const terms={quote:'1000',feePercent:'10',days:'7',confirm:'yes'};
it('匿名には内容を見せず、会員は検索・分類・残高と出品の確認ができる。HTMLをエスケープする',async()=>{
 const l=await listing();const anon=await app.request('/marketplace');expect(await anon.text()).not.toContain('見本イラスト');
 const s=await login();const html=await(await get(s)).text();expect(html).toContain('見本イラスト');expect(html).toContain('10,000');expect(html).toContain('&lt;b&gt;');
 const detail=await(await get(s,'/marketplace/listings/'+l.id)).text();expect(detail).toContain('&lt;script&gt;');expect(detail).not.toContain('<script>alert');
 expect(await(await get(s,'/marketplace?q=存在しない')).text()).not.toContain('見本イラスト');
 expect((await get(s,'/marketplace/listings/not-a-number')).status).toBe(404);
});
it('在籍と市場の閲覧権限を毎回確認し、拒否・退会・Discord障害は取引させない',async()=>{
 const s=await login(),l=await listing();
 channels[0]!.permission_overwrites=[{id:B,type:1,allow:'0',deny:'1024'}];
 expect((await post(s,'listing-buy',l.id,terms)).status).toBe(403);expect((await walletOf(db,B)).balance).toBe(10000);
 channels[0]!.permission_overwrites=[];const next=await login();broken=true;expect((await get(next)).status).toBe(503);broken=false;expect((await get(next)).status).toBe(200);
 await db.update(members).set({leftAt:now}).where(eq(members.id,B));expect((await get(next)).status).toBe(403);
});
it('未成年には通話の一覧・詳細を出さず、直接POSTでも購入できない',async()=>{
 const l=await listing('call'),s=await login(C);
 expect(await(await get(s)).text()).not.toContain('非公開の通話タイトル');
 expect((await get(s,'/marketplace/listings/'+l.id)).status).toBe(404);
 expect((await post(s,'listing-buy',l.id,terms)).status).toBe(400);expect((await walletOf(db,C)).balance).toBe(10000);
});
it('CSRF・価格・条件の偽装を拒否し、同じ購入フォームは1回だけ。同じDBの取引を表示する',async()=>{
 const l=await listing(),s=await login(),nonce=randomUUID();
 expect((await post(s,'listing-buy',l.id,{...terms,_csrf:'bad'})).status).toBe(403);
 expect((await post(s,'listing-buy',l.id,{...terms,quote:'1'})).status).toBe(400);
 const r=await post(s,'listing-buy',l.id,{...terms,nonce}),path=r.headers.get('location')!;
 expect(r.status).toBe(303);expect((await post(s,'listing-buy',l.id,{...terms,nonce})).headers.get('location')).toBe(path);
 expect(await db.select().from(marketOrders)).toHaveLength(1);expect((await walletOf(db,B)).balance).toBe(9000);
 const html=await(await get(s,path)).text();expect(html).toContain('取引スレッドを準備中');expect(html).toContain('受け取った');
 const id=Number(path.split('/').at(-1));await refundOrder(db,id,'staff',now);expect(await(await get(s,path)).text()).toContain('返金済み');expect((await walletOf(db,B)).balance).toBe(10000);
});
it('出品は現在の開業権利を使い、投稿者を偽装できない。依頼は本人名で作る',async()=>{
 const b=await login(),data={category:'illust',title:'新しい出品',price:'1000',capacity:'0',sellerId:A,roleIds:ROLE};
 expect((await post(b,'listing-new',0,data)).status).toBe(400);
 const a=await login(A);roles.set(A,[]);expect((await post(a,'listing-new',0,data)).status).toBe(400);
 roles.set(A,[ROLE]);expect((await post(a,'listing-new',0,data)).status).toBe(303);
 expect((await post(b,'request-new',0,{category:'illust',title:'依頼を作成',budget:'1000',requesterId:A})).status).toBe(303);
 expect((await db.select().from(marketRequests))[0]?.requesterId).toBe(B);
});
it('価格提案は当事者だけに見せ、個別取引は他人のURLから見たり操作できない',async()=>{
 const offerListing=await listing('illust','offer');
 await makeOffer(db,offerListing.id,B,1000,'Bだけの秘密');await makeOffer(db,offerListing.id,C,1000,'Cだけの秘密');
 const b=await login(),c=await login(C),a=await login(A);
 const html=await(await get(b,'/marketplace/listings/'+offerListing.id)).text();expect(html).toContain('Bだけの秘密');expect(html).not.toContain('Cだけの秘密');
 const owner=await(await get(a,'/marketplace/listings/'+offerListing.id)).text();expect(owner).toContain('Bだけの秘密');expect(owner).toContain('Cだけの秘密');
 const fixed=await listing();const r=await post(b,'listing-buy',fixed.id,terms),path=r.headers.get('location')!,id=Number(path.split('/').at(-1));
 expect((await get(c,path)).status).toBe(404);expect((await post(c,'order-receive',id,{confirm:'yes'})).status).toBe(400);
 expect((await post(a,'order-receive',id,{confirm:'yes'})).status).toBe(400);
 expect((await post(b,'order-receive',id,{confirm:'yes'})).status).toBe(303);expect((await walletOf(db,A)).balance).toBe(900);
});
it('一度きりのDiscordリンクはGETで消費せず、別Originと二度利用を拒否する',async()=>{
 const token=await createLoginLink(db,{id:B,displayName:'買い手',avatarUrl:null},now);
 expect((await app.request('/marketplace/link/'+token)).status).toBe(200);expect(await peekLoginLink(db,token,now)).toBeDefined();
 expect((await app.request('/marketplace/link/'+token,{method:'POST',headers:{origin:'https://other.example'}})).status).toBe(403);
 const r=await app.request('/marketplace/link/'+token,{method:'POST',headers:{origin:BASE}});expect(r.status).toBe(303);expect(r.headers.get('set-cookie')).toContain('sakura_market=');
 expect((await app.request('/marketplace/link/'+token,{method:'POST',headers:{origin:BASE}})).status).toBe(400);
});
it('リンクの next は出品者のページだけ。ほかは市場の入口へ',async()=>{
 const t1=await createLoginLink(db,{id:B,displayName:'買い手',avatarUrl:null},now);
 expect(await (await app.request('/marketplace/link/'+t1+'?next=%2Fmarketplace%2Fseller')).text()).toContain('?next=%2Fmarketplace%2Fseller');
 const r1=await app.request('/marketplace/link/'+t1+'?next=%2Fmarketplace%2Fseller',{method:'POST',headers:{origin:BASE}});expect(r1.headers.get('location')).toBe('/marketplace/seller');
 const t2=await createLoginLink(db,{id:B,displayName:'買い手',avatarUrl:null},now);
 const r2=await app.request('/marketplace/link/'+t2+'?next=https%3A%2F%2Fevil.example',{method:'POST',headers:{origin:BASE}});expect(r2.headers.get('location')).toBe('/marketplace');
 const cookie=r1.headers.get('set-cookie')!.split(';')[0]!;
 const page=await app.request('/marketplace/seller',{headers:{cookie}});expect(page.status).toBe(200);expect(await page.text()).toContain('出品者のページ');
});
it('市場OAuthは既存のカジノcallbackを共用し、stateと在籍を検証して市場へ戻す',async()=>{
 const r=await app.request('/marketplace/auth'),url=new URL(r.headers.get('location')!),cookie=r.headers.get('set-cookie')!.split(';')[0]!;
 expect(url.searchParams.get('redirect_uri')).toBe(BASE+'/casino/auth/callback');
 const callback=await app.request('/casino/auth/callback?state='+url.searchParams.get('state')+'&code=good',{headers:{cookie}});
 expect(callback.headers.get('location')).toBe('/marketplace');expect(callback.headers.get('set-cookie')).toContain('sakura_market=');
 expect(api.exchangeCode).toHaveBeenCalledOnce();
});

it('40件ずつ次のページへ進め、検索文字の％や_をワイルドカードとして扱わない',async()=>{
 await db.insert(marketListings).values(Array.from({length:41},(_,i)=>({sellerId:A,category:'illust',title:'ページ用-'+String(i).padStart(3,'0'),price:1000})));
 const s=await login();const html=await(await get(s)).text();expect(html).toContain('ページ用-040');expect(html).not.toContain('ページ用-000');
 const next=/href="([^\"]*before=[^\"]+)"/.exec(html)![1]!.replaceAll('&amp;','&');
 expect(await(await get(s,next)).text()).toContain('ページ用-000');
 expect(await(await get(s,'/marketplace?q=%25')).text()).not.toContain('ページ用-');
 await db.insert(marketListings).values({sellerId:A,category:'illust',title:'割引50%_記号',price:1000});
 expect(await(await get(s,'/marketplace?q=%25_')).text()).toContain('割引50%_記号');
});

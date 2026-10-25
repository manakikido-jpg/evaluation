import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { makeDb, cfg } from './helpers.js';
import type { Db } from '../src/db/client.js';
import type { DiscordApi } from '../src/web/discordApi.js';
import { members, visitProfiles, visitPurchases } from '../src/db/schema.js';
import { mountVisit } from '../src/web/visit.js';
import { createWebApp } from '../src/web/app.js';
import { createMemberSession, findMemberSession } from '../src/web/memberSessions.js';
import { createLoginLink, peekLoginLink } from '../src/services/casino/loginLinks.js';
import { walletOf, addCoins } from '../src/services/economy.js';
const A='770000000000000001',B='770000000000000002',now=new Date('2026-10-25T12:00:00+09:00'),baseUrl='https://visit.test';
let db:Db,close:()=>Promise<void>,app:Hono<any>,api:DiscordApi,token:string,csrf:string,mode:'ok'|'left'|'error';
const user={id:A,username:'sakura',displayName:'桜 <script>',avatarUrl:null};
const req=(path:string,init:RequestInit={})=>app.request(baseUrl+path,{...init,headers:{cookie:'sakura_visit='+token,...init.headers}});
const post=(path:string,body:Record<string,string>|URLSearchParams)=>req(path,{method:'POST',body:body instanceof URLSearchParams?body:new URLSearchParams({_csrf:csrf,...body})});
beforeEach(async()=>{
 ({db,close}=await makeDb());await db.insert(members).values([user,{...user,id:B}].map(u=>({id:u.id,username:u.username,displayName:u.displayName})));
 await addCoins(db,A,10000,'admin_grant');mode='ok';api={memberRoles:async()=>{if(mode==='error')throw Error('429');return mode==='left'?null:[];},authorizeUrl:(s,r)=>'https://discord.test/?'+new URLSearchParams({state:s,redirect_uri:r}),exchangeCode:async()=> 'fake',me:async()=>user};
 app=new Hono();mountVisit(app,{db,api,cfg:()=>cfg,baseUrl,secure:true,now:()=>now});
 token=await createMemberSession(db,user,now);csrf=(await findMemberSession(db,token,now))!.csrfToken;
});
afterEach(async()=>close());
describe('参拝Web',()=>{
 it('実アプリからメンバー入口を開け、社務所ログインとは別で認証する',async()=>{
  const actual=createWebApp({db,cfg,api,baseUrl,now:()=>now,discord:{} as any});
  const anon=await actual.request(baseUrl+'/visit');expect(anon.status).toBe(200);expect(await anon.text()).toContain('Discordでログイン');
  const page=await actual.request(baseUrl+'/visit',{headers:{cookie:'sakura_visit='+token}});expect(page.status).toBe(200);const html=await page.text();expect(html).toContain('背景とフレームのお店');expect(html).toContain('桜 &lt;script&gt;');expect(html).not.toContain('<script>');
  const image=await actual.request(baseUrl+'/visit/card.png',{headers:{cookie:'sakura_visit='+token}});expect(image.headers.get('content-type')).toBe('image/png');expect(image.headers.get('cache-control')).toContain('no-store');
 });
 it('未認証や運営Cookieだけでは画像・購入を利用できない',async()=>{
  expect((await app.request(baseUrl+'/visit/card.png')).status).toBe(401);
  expect((await app.request(baseUrl+'/visit/buy',{method:'POST',body:new URLSearchParams({item:'sakura'}),headers:{cookie:'shamusho_session=admin'}})).status).toBe(401);
 });
 it('在籍の取得失敗は閉じ、退会ならセッションを失効する',async()=>{
  mode='error';expect((await req('/visit')).status).toBe(503);expect((await findMemberSession(db,token,now))).toBeDefined();
  mode='ok';expect((await req('/visit')).status).toBe(200);
  mode='left';expect((await req('/visit')).status).toBe(403);expect((await findMemberSession(db,token,now))).toBeUndefined();
 });
 it('CSRF・金額・確認を要求し、二重送信でも1回だけ、他人のIDを受け入れない',async()=>{
  expect((await post('/visit/buy',{item:'sakura',quote:'1500',confirm:'yes',_csrf:'bad'})).status).toBe(403);
  expect((await post('/visit/buy',{item:'sakura',quote:'1',confirm:'yes'})).status).toBe(400);
  expect((await post('/visit/buy',{item:'sakura',quote:'1500'})).status).toBe(400);
  for(let n=0;n<2;n++)expect((await post('/visit/buy',{item:'sakura',quote:'1500',confirm:'yes',memberId:B})).status).toBe(303);
  expect((await walletOf(db,A)).balance).toBe(8500);expect((await walletOf(db,B)).balance).toBe(0);
  expect((await db.select().from(visitPurchases))[0]!.memberId).toBe(A);
 });
 it('未所持品を試着しても保存しない・装備しない、購入後は何度でも無料で変更できる',async()=>{
  const preview=await req('/visit/card.png?preview=1&background=goldnight&frame=gold');expect(preview.status).toBe(200);expect((await preview.arrayBuffer()).byteLength).toBeGreaterThan(10000);
  const equip={background:'sakura',frame:'plain',title:'rank',publicStats:'yes',memberId:B};
  expect((await post('/visit/equip',equip)).status).toBe(400);
  await post('/visit/buy',{item:'sakura',quote:'1500',confirm:'yes'});
  expect((await post('/visit/equip',equip)).status).toBe(303);
  expect((await post('/visit/equip',{...equip,background:'paper'})).status).toBe(303);
  const [profile]=await db.select().from(visitProfiles).where(eq(visitProfiles.memberId,A));expect(profile).toMatchObject({background:'paper',publicStats:true});
  expect((await walletOf(db,A)).balance).toBe(8500);expect(await db.select().from(visitProfiles).where(eq(visitProfiles.memberId,B))).toHaveLength(0);
 });
 it('期限付き本人リンクはGETで消費せず、外部Originを拒否しPOSTで一度だけ消費する',async()=>{
  const link=await createLoginLink(db,user,now);const path='/visit/link/'+link;
  expect((await app.request(baseUrl+path)).status).toBe(200);expect(await peekLoginLink(db,link,now)).toBeDefined();
  expect((await app.request(baseUrl+path,{method:'POST',headers:{origin:'https://other.test'}})).status).toBe(403);
  const ok=await app.request(baseUrl+path,{method:'POST',headers:{origin:baseUrl}});expect(ok.status).toBe(303);expect(ok.headers.get('set-cookie')).toContain('Path=/visit');expect(ok.headers.get('set-cookie')).toContain('HttpOnly');expect(ok.headers.get('set-cookie')).toContain('Secure');
  expect((await app.request(baseUrl+path,{method:'POST'})).status).toBe(400);
  const expired=await createLoginLink(db,user,new Date(now.getTime()-11*60000));expect(await peekLoginLink(db,expired,now)).toBeUndefined();
 });
 it('既存の認証コールバックを自分のstateだけで使う',async()=>{
  const auth=await app.request(baseUrl+'/visit/auth');const state=new URL(auth.headers.get('location')!).searchParams.get('state')!;
  expect(new URL(auth.headers.get('location')!).searchParams.get('redirect_uri')).toBe(baseUrl+'/casino/auth/callback');
  expect((await app.request(baseUrl+'/casino/auth/callback?state=other&code=x',{headers:{cookie:'sakura_visit_state='+state}})).status).toBe(404);
  const ok=await app.request(baseUrl+'/casino/auth/callback?state='+state+'&code=x',{headers:{cookie:'sakura_visit_state='+state}});
  expect(ok.status).toBe(302);expect(ok.headers.get('location')).toBe('/visit');expect(ok.headers.get('set-cookie')).toContain('sakura_visit=');
 });
 it('公開設定を外せてログアウト後の購入や画像取得を拒否する',async()=>{
  expect((await post('/visit/equip',{background:'paper',frame:'plain',title:'rank',publicStats:'yes'})).status).toBe(303);
  expect((await post('/visit/equip',{background:'paper',frame:'plain',title:'rank'})).status).toBe(303);
  const [p]=await db.select().from(visitProfiles);expect(p!.publicStats).toBe(false);
  expect((await req('/visit/card.png?download=1&public=1')).headers.get('content-disposition')).toContain('attachment');
  expect((await post('/visit/logout',{})).status).toBe(303);expect((await req('/visit/card.png')).status).toBe(401);
 });
});

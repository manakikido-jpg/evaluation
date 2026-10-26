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
  const page=await actual.request(baseUrl+'/visit',{headers:{cookie:'sakura_visit='+token}});expect(page.status).toBe(200);const html=await page.text();expect(html).toContain('背景とフレームのお店');expect(html).toContain('初期設定は公開です');expect(html).toContain('/参拝プロフィール だけでカードをチャンネルへ表示できます');expect(html).toContain('桜 &lt;script&gt;');expect(html).not.toContain('<script>');
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

it('背景・フレームは運営が作って渡し、メンバーは作れない。渡した人だけ着せ替えでき、取り上げると標準に戻る',async()=>{
 const {saveWorkshopSettings,createStaffDesign,grantDesign,revokeDesign,staffDesigns}=await import('../src/services/visitWorkshop.js');
 const {visitData}=await import('../src/services/visitProfile.js');
 const sharp=(await import('sharp')).default;
 await saveWorkshopSettings(db,{enabled:true,licensePrice:5000},'admin');
 expect(await (await req('/visit')).text()).not.toContain('id="visit-workshop"');
 expect((await post('/visit/license',{quote:'5000',confirm:'yes'})).status).toBe(403);
 expect((await post('/visit/designs/x/submit',{price:'1000',rights:'yes'})).status).toBe(403);
 const image=await sharp({create:{width:1080,height:640,channels:3,background:'#0066aa'}}).png().toBuffer();
 const row=await createStaffDesign(db,'admin',{kind:'background',name:'運営の青',bytes:new Uint8Array(image)},now);
 const tokenB=await createMemberSession(db,{...user,id:B},now),sessionB=(await findMemberSession(db,tokenB,now))!;
 const asB=(path:string,init:RequestInit={})=>app.request(baseUrl+path,{...init,headers:{cookie:'sakura_visit='+tokenB,...init.headers}});
 expect((await asB('/visit/designs/'+row.id+'.png')).status).toBe(404);
 expect((await visitData(db,B,now)).owned).not.toContain(row.id);
 expect(await grantDesign(db,row.id,B,'admin',now)).toBe(true);
 expect(await grantDesign(db,row.id,B,'admin',now)).toBe(false);
 expect((await staffDesigns(db))[0]!.holders).toEqual([B]);
 expect((await asB('/visit/designs/'+row.id+'.png')).status).toBe(200);
 expect((await asB('/visit/designs/'+row.id+'.png')).headers.get('content-type')).toBe('image/png');
 const equipped=await asB('/visit/equip',{method:'POST',body:new URLSearchParams({_csrf:sessionB.csrfToken,background:row.id,frame:'plain',title:'rank',publicStats:'yes'})});expect(equipped.status).toBe(303);
 expect((await visitData(db,B,now)).profile.background).toBe(row.id);
 expect((await visitData(db,A,now)).owned).not.toContain(row.id);
 expect(await revokeDesign(db,row.id,B,'admin')).toBe(true);
 expect((await visitData(db,B,now)).profile.background).toBe('paper');
 expect((await asB('/visit/designs/'+row.id+'.png')).status).toBe(404);
});

it('最新の運営ロールだけで専用表示し、URL偽装や剥奪後に適用せず保存済み装いを保持する',async()=>{
 const {visitData}=await import('../src/services/visitProfile.js');const {renderVisitCard}=await import('../src/services/visitCard.js');
 const role='770000000000000099';const localCfg=structuredClone(cfg);localCfg.admin={...localCfg.admin,gujiRoleIds:[role],shinshokuRoleIds:[]};let roles=[role];
 api.memberRoles=async()=>roles;app=new Hono();mountVisit(app,{db,api,cfg:()=>localCfg,baseUrl,secure:true,now:()=>now});
 const html=await (await req('/visit')).text();expect(html).toContain('運営専用の「紅眼の金紋」');
 const d=await visitData(db,A,now);d.staffTheme=true;const actual=Buffer.from(await (await req('/visit/card.png?preview=1&background=snow&frame=plain')).arrayBuffer());expect(actual.equals(renderVisitCard(d,{privateView:true,preview:true}))).toBe(true);
 roles=[];const ordinary=Buffer.from(await (await req('/visit/card.png?staffTheme=1')).arrayBuffer());d.staffTheme=false;expect(ordinary.equals(renderVisitCard(d,{privateView:true}))).toBe(true);expect((await visitData(db,A,now)).profile.background).toBe('paper');expect(await (await req('/visit')).text()).not.toContain('運営専用の「紅眼の金紋」');
 roles=[role];api.memberRoles=async()=>{throw Error('offline');};expect((await req('/visit/card.png')).status).toBe(503);
});

it('着せ替え画面の全実績に同じ勲章の見本を表示し、実アプリから画像を配信する',async()=>{
 const html=await (await req('/visit')).text();for(const id of ['first','vc1','vc10','vc100','vc500','days7','days30','anniversary'])expect(html).toContain('/static/visit-badge-'+id+'.png?v=');
 const actual=createWebApp({db,cfg,api,baseUrl,now:()=>now,discord:{} as any});const img=await actual.request(baseUrl+'/static/visit-badge-vc1.png');expect(img.status).toBe(200);expect(img.headers.get('content-type')).toContain('image/png');expect((await img.arrayBuffer()).byteLength).toBeGreaterThan(1000);
 expect((await actual.request(baseUrl+'/static/visit-badge-unknown.png')).status).toBe(404);
});

it('運営専用の装いは現在のロールとCSRFで保存し、試着/他人指定/一般用設定とは分ける',async()=>{
 const {visitData}=await import('../src/services/visitProfile.js');const {renderVisitCard}=await import('../src/services/visitCard.js');
 const role='770000000000000099';const localCfg=structuredClone(cfg);localCfg.admin={...localCfg.admin,gujiRoleIds:[role],shinshokuRoleIds:[]};let roles=[role];api.memberRoles=async()=>roles;app=new Hono();mountVisit(app,{db,api,cfg:()=>localCfg,baseUrl,secure:true,now:()=>now});
 expect((await post('/visit/staff-style',{staffStyle:'blue-lantern',_csrf:'bad'})).status).toBe(403);expect((await post('/visit/staff-style',{staffStyle:'unknown'})).status).toBe(400);
 const preview=await req('/visit?staffStyle=blue-lantern');expect(await preview.text()).toContain('青夜の花灯り');expect((await visitData(db,A,now)).profile.staffStyle).toBe('crimson');
 const saved=await post('/visit/staff-style',{staffStyle:'blue-lantern',memberId:B});expect(saved.status).toBe(303);expect((await visitData(db,A,now)).profile.staffStyle).toBe('blue-lantern');expect((await visitData(db,B,now)).profile.staffStyle).toBe('crimson');
 const data=await visitData(db,A,now);data.staffTheme=true;expect(Buffer.from(await (await req('/visit/card.png?download=1')).arrayBuffer()).equals(renderVisitCard(data,{privateView:true}))).toBe(true);
 roles=[];expect((await post('/visit/staff-style',{staffStyle:'crimson'})).status).toBe(403);expect(await (await req('/visit')).text()).not.toContain('<h2>運営専用の装い</h2>');
 data.staffTheme=false;expect(Buffer.from(await (await req('/visit/card.png?preview=1&staffStyle=blue-lantern')).arrayBuffer()).equals(renderVisitCard(data,{privateView:true,preview:true}))).toBe(true);expect((await visitData(db,A,now)).profile.staffStyle).toBe('blue-lantern');
});

it('選択欄と保存ボタンを同じフォームで送り、試着を挟まず赤金/青銀を保存できる',async()=>{
 const {visitData}=await import('../src/services/visitProfile.js');const role='770000000000000099',localCfg=structuredClone(cfg);localCfg.admin={...localCfg.admin,gujiRoleIds:[role],shinshokuRoleIds:[]};let roles=[role];api.memberRoles=async()=>roles;app=new Hono();mountVisit(app,{db,api,cfg:()=>localCfg,baseUrl,secure:true,now:()=>now});
 const html=await (await req('/visit')).text();const saveForm=[...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].find(m=>m[2]!.includes('運営の装いを保存'))!;
 expect(saveForm).toBeDefined();expect(saveForm[1]).toContain('method="post"');expect(saveForm[1]).toContain('action="/visit/staff-style"');expect(saveForm[2]).toContain('<select name="staffStyle">');expect(saveForm[2]).not.toContain('type="hidden" name="staffStyle"');
 expect((await post('/visit/staff-style',{staffStyle:'blue-lantern',intent:'save'})).status).toBe(303);expect((await visitData(db,A,now)).profile.staffStyle).toBe('blue-lantern');
 const preview=await post('/visit/staff-style',{staffStyle:'crimson',intent:'preview',public:'1'});expect(preview.status).toBe(303);expect(preview.headers.get('location')).toBe('/visit?staffStyle=crimson&public=1');expect((await visitData(db,A,now)).profile.staffStyle).toBe('blue-lantern');
 expect((await post('/visit/staff-style',{staffStyle:'crimson',intent:'preview',_csrf:'bad'})).status).toBe(403);expect((await post('/visit/staff-style',{staffStyle:'unknown',intent:'preview'})).status).toBe(400);
 expect((await post('/visit/staff-style',{staffStyle:'crimson',intent:'save'})).status).toBe(303);expect((await visitData(db,A,now)).profile).toMatchObject({staffStyle:'crimson',background:'paper',frame:'plain'});
 roles=[];expect((await post('/visit/staff-style',{staffStyle:'blue-lantern',intent:'preview'})).status).toBe(403);
});


it('運営も一般用へ切り替えると一般用の着せ替えを使え、専用デザインを強制しない',async()=>{
 const {visitData}=await import('../src/services/visitProfile.js');const {renderVisitCard}=await import('../src/services/visitCard.js');
 const role='770000000000000099',localCfg=structuredClone(cfg);localCfg.admin={...localCfg.admin,gujiRoleIds:[role],shinshokuRoleIds:[]};api.memberRoles=async()=>[role];app=new Hono();mountVisit(app,{db,api,cfg:()=>localCfg,baseUrl,secure:true,now:()=>now});
 expect((await post('/visit/staff-style',{staffStyle:'general',intent:'save'})).status).toBe(303);expect((await post('/visit/equip',{background:'paper',frame:'plain',title:'rank',publicStats:'yes'})).status).toBe(303);
 const data=await visitData(db,A,now);expect(data.profile.staffStyle).toBe('general');const normal=renderVisitCard(data,{privateView:true});data.staffTheme=true;expect(renderVisitCard(data,{privateView:true}).equals(normal)).toBe(true);expect(Buffer.from(await (await req('/visit/card.png?download=1')).arrayBuffer()).equals(normal)).toBe(true);expect(await (await req('/visit')).text()).toContain('一般用の着せ替えで表示しています。');
});

it('紫苑の金桜は運営にだけ選択肢を出し、試着なし保存とカード反映ができる',async()=>{
 const {visitData}=await import('../src/services/visitProfile.js');const {renderVisitCard}=await import('../src/services/visitCard.js');
 expect(await (await req('/visit')).text()).not.toContain('紫苑の金桜');expect((await post('/visit/staff-style',{staffStyle:'purple-gold'})).status).toBe(403);
 const role='770000000000000099',localCfg=structuredClone(cfg);localCfg.admin={...localCfg.admin,gujiRoleIds:[role],shinshokuRoleIds:[]};let roles=[role];api.memberRoles=async()=>roles;app=new Hono();mountVisit(app,{db,api,cfg:()=>localCfg,baseUrl,secure:true,now:()=>now});
 expect(await (await req('/visit')).text()).toContain('紫苑の金桜');expect((await post('/visit/staff-style',{staffStyle:'purple-gold',_csrf:'bad'})).status).toBe(403);expect((await post('/visit/staff-style',{staffStyle:'purple-gold',intent:'save'})).status).toBe(303);
 const d=await visitData(db,A,now);d.staffTheme=true;expect(d.profile.staffStyle).toBe('purple-gold');expect(Buffer.from(await (await req('/visit/card.png?download=1')).arrayBuffer()).equals(renderVisitCard(d,{privateView:true}))).toBe(true);
 roles=[];expect((await post('/visit/staff-style',{staffStyle:'purple-gold'})).status).toBe(403);expect(await (await req('/visit')).text()).not.toContain('紫苑の金桜');d.staffTheme=false;expect(Buffer.from(await (await req('/visit/card.png')).arrayBuffer()).equals(renderVisitCard(d,{privateView:true}))).toBe(true);
});

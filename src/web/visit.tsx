import { mountBingo } from './bingo.js';
import { bodyLimit } from 'hono/body-limit';
import { buyCreatorLicense, createDesign, submitDesign, deletePrivateDesign, accessibleDesign, workshopData, DESIGN_INPUT_MAX } from '../services/visitWorkshop.js';
import type { Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { adminLevelOf, type GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { members, type MemberSession } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import type { DiscordApi } from './discordApi.js';
import { createMemberSession, findMemberSession, deleteMemberSession } from './memberSessions.js';
import { randomToken, safeEqual } from './sessions.js';
import { peekLoginLink, useLoginLink } from '../services/casino/loginLinks.js';
import { VISIT_STAFF_STYLES, buyVisitItem, saveVisitStaffStyle, saveVisitProfile, visitData, VisitError, type VisitData } from '../services/visitProfile.js';
import { renderVisitCard } from '../services/visitCard.js';
import { loadReceptionAvatar } from '../services/castReceptionImage.js';
import { walletOf } from '../services/economy.js';
import { VisitGate, VisitPage } from './views/visit.js';
type Deps={db:Db;api:DiscordApi;cfg:()=>GuildConfig;baseUrl:string;secure:boolean;now:()=>Date};
const COOKIE='sakura_visit',STATE='sakura_visit_state';
export function mountVisit(app:Hono<any>,d:Deps){
 mountBingo(app,d);
 app.use('/visit/designs',bodyLimit({maxSize:9*1024*1024,onError:c=>c.text('画像は8MBまでです。',413)}));
 const opts={path:'/visit',httpOnly:true,secure:d.secure,sameSite:'Lax' as const,maxAge:7*86400};
 const redirect=d.baseUrl+'/casino/auth/callback';
 const access=async(id:string)=>{
  const roles=await d.api.memberRoles(d.cfg().guildId,id);
  if(!roles)return false;
  const [m]=await d.db.select().from(members).where(eq(members.id,id));
  return m&&!m.isBot&&!m.leftAt ? {staffTheme:!!adminLevelOf(d.cfg(),roles)} : false;
 };
 const protect=(handler:(c:Context,s:MemberSession,data:VisitData)=>Response|Promise<Response>)=>async(c:Context)=>{
  c.header('Cache-Control','private, no-store');
  const session=await findMemberSession(d.db,getCookie(c,COOKIE)??'',d.now());
  if(!session)return c.req.method==='GET'&&!c.req.path.endsWith('.png')?c.html(<VisitGate/>):c.text('ログインが必要です。',401);
  let membership: false | {staffTheme:boolean};
  try{membership=await access(session.userId);if(!membership){await deleteMemberSession(d.db,session.id);deleteCookie(c,COOKIE,{path:'/visit'});return c.text('在籍中のメンバーだけが利用できます。',403);}}catch{return c.text('Discordの在籍を確認できません。少し待ってから開き直してください。',503);}
  if(c.req.method==='POST'){const b=await c.req.parseBody({all:true});if(!safeEqual(typeof b._csrf==='string'?b._csrf:'',session.csrfToken))return c.text('不正なリクエストです（CSRF）。',403);}
  const data=await visitData(d.db,session.userId,d.now(),{background:c.req.query('background'),frame:c.req.query('frame')});
  data.staffTheme=membership.staffTheme;
  return handler(c,session,data);
 };
 app.get('/visit/auth',c=>{const state=randomToken();setCookie(c,STATE,state,{...opts,path:'/casino/auth',maxAge:600});return c.redirect(d.api.authorizeUrl(state,redirect));});
 app.get('/casino/auth/callback',async(c,next)=>{
  const state=getCookie(c,STATE);if(!state||!safeEqual(state,c.req.query('state')??''))return next();
  deleteCookie(c,STATE,{path:'/casino/auth'});
  try{const code=c.req.query('code');if(!code)return c.html(<VisitGate error="認証をやり直してください。"/>,400);const user=await d.api.me(await d.api.exchangeCode(code,redirect));if(!await access(user.id))return c.html(<VisitGate error="在籍中のメンバーだけが利用できます。"/>,403);setCookie(c,COOKIE,await createMemberSession(d.db,user,d.now()),opts);return c.redirect('/visit');}
  catch{return c.html(<VisitGate error="Discord認証を確認できません。少し待ってからやり直してください。"/>,503);}
 });
 app.get('/visit/link/:token',async c=>{
  c.header('Cache-Control','private, no-store');c.header('Referrer-Policy','no-referrer');
  const user=await peekLoginLink(d.db,c.req.param('token'),d.now());
  return c.html(<VisitGate error={user?undefined:'リンクが期限切れか使用済みです。Discordから開き直してください。'} link={user?{name:user.displayName,action:'/visit/link/'+c.req.param('token')+(c.req.query('next')==='bingo'?'?next=bingo':'')}:undefined}/>);
 });
 app.post('/visit/link/:token',async c=>{
  c.header('Cache-Control','private, no-store');
  if(c.req.header('origin')&&c.req.header('origin')!==new URL(d.baseUrl).origin)return c.text('不正なリクエストです。',403);
  const user=await useLoginLink(d.db,c.req.param('token'),d.now());if(!user)return c.text('リンクが期限切れか使用済みです。',400);
  try{if(!await access(user.id))return c.text('在籍中のメンバーだけが利用できます。',403);}catch{return c.text('在籍を確認できません。Discordから開き直してください。',503);}
  setCookie(c,COOKIE,await createMemberSession(d.db,{id:user.id,username:user.displayName,displayName:user.displayName,avatarUrl:user.avatarUrl},d.now()),opts);
  return c.redirect(c.req.query('next')==='bingo'?'/visit/bingo':'/visit',303);
 });
 app.get('/visit',protect(async(c,s,data)=>c.html(<VisitPage data={data} csrf={s.csrfToken} balance={(await walletOf(d.db,s.userId)).balance} currency={d.cfg().economy.currencyName} previewBackground={c.req.query('background')} previewFrame={c.req.query('frame')} previewStaffStyle={c.req.query('staffStyle')} publicPreview={c.req.query('public')==='1'} message={c.req.query('msg')==='staff-saved'?'運営専用の装いを保存しました。':c.req.query('msg')==='license'?'制作権利を購入しました。':c.req.query('msg')==='created'?'作品を保存しました。試着してから着せ替えを保存してください。':c.req.query('msg')==='submitted'?'運営へ販売申請しました。':c.req.query('msg')==='deleted'?'作品を削除しました。':c.req.query('msg')==='saved'?'着せ替えと公開設定を保存しました。':c.req.query('msg')==='bought'?'購入しました。装備するには「着せ替えを保存」を押してください。':undefined}/>)));
 app.get('/visit/card.png',protect(async(c,_s,data)=>{
  const preview=c.req.query('preview')==='1';
  const avatar=data.member.avatarUrl?await loadReceptionAvatar(data.member.avatarUrl):undefined;
  const png=renderVisitCard(data,{privateView:c.req.query('public')!=='1',...(preview?{background:c.req.query('background'),frame:c.req.query('frame'),staffStyle:c.req.query('staffStyle'),preview:true}:{}),avatar});
  c.header('Content-Type','image/png');if(c.req.query('download')==='1')c.header('Content-Disposition','attachment; filename="sakura-profile.png"');
  return c.body(new Uint8Array(png));
 }));
 app.post('/visit/buy',protect(async(c,s)=>{
  const b=await c.req.parseBody();
  try{await buyVisitItem(d.db,s.userId,typeof b.item==='string'?b.item:'',Number(b.quote),b.confirm==='yes',d.now());return c.redirect('/visit?msg=bought',303);}
  catch(e){if(e instanceof VisitError)return c.html(<VisitGate error={e.message} back/>,400);throw e;}
 }));
 app.post('/visit/staff-style',protect(async(c,s,data)=>{
  if(!data.staffTheme)return c.text('宮司・神職だけが変更できます。',403);
  const body=await c.req.parseBody();
  if(body.intent==='preview'){
   const style=VISIT_STAFF_STYLES.find(s=>s.id===body.staffStyle);
   if(!style)return c.html(<VisitGate error="運営専用の装いを選んでください。" back/>,400);
   return c.redirect('/visit?'+new URLSearchParams({staffStyle:style.id,...(body.public==='1'?{public:'1'}:{})}).toString(),303);
  }
  try{await saveVisitStaffStyle(d.db,s.userId,typeof body.staffStyle==='string'?body.staffStyle:'',data.staffTheme,d.now());return c.redirect('/visit?msg=staff-saved',303);}
  catch(e){if(e instanceof VisitError)return c.html(<VisitGate error={e.message} back/>,400);throw e;}
 }));
 app.post('/visit/equip',protect(async(c,s)=>{
  const b=await c.req.parseBody({all:true});const str=(k:string)=>typeof b[k]==='string'?b[k] as string:'';
  const badges=Array.isArray(b.badges)?b.badges.filter((v):v is string=>typeof v==='string'):typeof b.badges==='string'?[b.badges]:[];
  try{await saveVisitProfile(d.db,s.userId,{background:str('background'),frame:str('frame'),title:str('title'),badges,publicStats:b.publicStats==='yes'},d.now());return c.redirect('/visit?msg=saved',303);}
  catch(e){if(e instanceof VisitError)return c.html(<VisitGate error={e.message} back/>,400);throw e;}
 }));
 const STAFF_ONLY='背景とフレームは、運営が作ってお渡しする形になりました。メンバーが新しく作ることはできません。';
 const workshopError=(c:Context,e:unknown)=>{if(e instanceof VisitError)return c.html(<VisitGate error={e.message} back/>,400);throw e;};
 app.post('/visit/license',protect(async c=>c.html(<VisitGate error={STAFF_ONLY} back/>,403)));
 app.post('/visit/designs',protect(async c=>c.html(<VisitGate error={STAFF_ONLY} back/>,403)));
 app.get('/visit/designs/:file',protect(async(c,s)=>{
  const file=c.req.param('file')??'';if(!file.endsWith('.png'))return c.notFound();const row=await accessibleDesign(d.db,file.slice(0,-4),s.userId);if(!row)return c.notFound();c.header('X-Content-Type-Options','nosniff');return c.body(new Uint8Array(row.data),200,{'Content-Type':'image/png'});
 }));
 app.post('/visit/designs/:id/submit',protect(async c=>c.html(<VisitGate error={STAFF_ONLY} back/>,403)));
 app.post('/visit/designs/:id/delete',protect(async(c,s)=>{try{await deletePrivateDesign(d.db,c.req.param('id')??'',s.userId);return c.redirect('/visit?msg=deleted#visit-workshop',303);}catch(e){return workshopError(c,e);}}));
 app.post('/visit/logout',protect(async(c,s)=>{await deleteMemberSession(d.db,s.id);deleteCookie(c,COOKIE,{path:'/visit'});return c.redirect('/visit',303);}));
}

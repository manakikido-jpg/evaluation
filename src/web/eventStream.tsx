import { bodyLimit } from 'hono/body-limit';
import type {Context,Hono} from 'hono';
import { getCookie,deleteCookie } from 'hono/cookie';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { members,type MemberSession } from '../db/schema.js';
import { adminLevelOf,type GuildConfig } from '../config.js';
import type { DiscordApi } from './discordApi.js';
import { findMemberSession,deleteMemberSession } from './memberSessions.js';
import { safeEqual } from './sessions.js';
import { changeStream,kickPublisher,mediaAllowed,mediaFile,privatePlaylist,publisherToken,publisherReady,streamEvent,streamOpen,validEventId,StreamError,type StreamConfig } from '../services/eventStream.js';
import { EventStreamGate,EventStreamPage } from './views/eventStream.js';
export type EventStreamDeps={db:Db;api:DiscordApi;cfg:()=>GuildConfig;now:()=>Date;config?:StreamConfig;fetcher?:typeof fetch};
export function mountEventStream(app:Hono<any>,d:EventStreamDeps){
 app.use('/event-stream/auth',bodyLimit({maxSize:8192,onError:c=>c.body(null,413)}));
 const fetcher=d.fetcher??fetch,membershipCache=new Map<string,{roles:string[];until:number}>();
 const pendingMembership=new Map<string,Promise<string[]|null>>(),activeMedia=new Map<string,number>();let totalMedia=0;
 const protect=(handler:(c:Context,s:MemberSession,staff:boolean)=>Promise<Response>|Response)=>async(c:Context)=>{
  c.header('Cache-Control','private, no-store');c.header('Referrer-Policy','no-referrer');
  const session=await findMemberSession(d.db,getCookie(c,'sakura_visit')??'',d.now());
  if(!session)return c.req.path==='/visit/event'?c.html(<EventStreamGate/>):c.json({error:'ログインが必要です。'},401);
  let roles:string[]|null;
  try{const cached=membershipCache.get(session.userId);if(c.req.method==='GET'&&cached&&cached.until>d.now().getTime())roles=cached.roles;
   else{
    let pending=c.req.method==='GET'?pendingMembership.get(session.userId):undefined;
    if(!pending){pending=d.api.memberRoles(d.cfg().guildId,session.userId);if(c.req.method==='GET')pendingMembership.set(session.userId,pending);}
    try{roles=await pending;}finally{if(pendingMembership.get(session.userId)===pending)pendingMembership.delete(session.userId);}
    membershipCache.delete(session.userId);if(roles){membershipCache.set(session.userId,{roles,until:d.now().getTime()+30000});if(membershipCache.size>2000)membershipCache.delete(membershipCache.keys().next().value!);}
   }}
  catch{membershipCache.delete(session.userId);return c.json({error:'在籍を確認できません。少し待って開き直してください。'},503);}
  const [member]=await d.db.select().from(members).where(eq(members.id,session.userId));
  if(!roles||!member||member.isBot||member.leftAt){await deleteMemberSession(d.db,session.id);deleteCookie(c,'sakura_visit',{path:'/visit'});return c.json({error:'在籍中のメンバーだけが視聴できます。'},403);}
  if(c.req.method==='POST'){const body=await c.req.parseBody();if(!safeEqual(typeof body._csrf==='string'?body._csrf:'',session.csrfToken))return c.json({error:'画面を開き直してください（CSRF）。'},403);}
  const level=adminLevelOf(d.cfg(),roles),staff=level==='guji'||level==='shinshoku';
  try{return await handler(c,session,staff);}catch(e){if(e instanceof StreamError)return c.json({error:e.message},409);throw e;}
 };
 const state=async(staff:boolean)=>{const event=await streamEvent(d.db);return {configured:!!d.config,staff,event:event?{...event,status:event.expiresAt<=d.now().getTime()?'closed':event.status}:null};};
 app.get('/visit/event',protect((c,s,staff)=>c.html(<EventStreamPage csrf={s.csrfToken} staff={staff}/>)));
 app.get('/visit/event/state',protect(async(c,_s,staff)=>c.json(await state(staff))));
 app.post('/visit/event/control',protect(async(c,s,staff)=>{
  if(!staff)return c.json({error:'宮司・神職だけが配信を操作できます。'},403);
  if(!d.config)return c.json({error:'配信基盤の接続設定がまだありません。'},503);
  const b=await c.req.parseBody(),action=b.action;
  if(action!=='create'&&action!=='start'&&action!=='stop')return c.json({error:'操作が正しくありません。'},400);
  if(action==='stop'&&b.confirm!=='yes')return c.json({error:'終了の確認を入れてください。'},400);
  const version=typeof b.version==='string'?Number(b.version):undefined;
  if(action!=='create'&&(!Number.isSafeInteger(version)||version!<0))return c.json({error:'画面を開き直してください。'},400);
  const previous=await streamEvent(d.db);
  if(action==='start'&&(!previous||!await publisherReady(d.config,previous.id,fetcher)))return c.json({error:'OBSの配信接続を先に始めてください。'},409);
  if(action==='create'&&previous&&!streamOpen(previous,d.now()))try{await kickPublisher(d.config,previous.id,fetcher);}catch{return c.json({error:'前の配信元を停止できません。OBSから停止してから、もう一度準備してください。'},503);}
  const event=await changeStream(d.db,{action,actorId:s.userId,id:typeof b.id==='string'?b.id:'',version,title:typeof b.title==='string'?b.title:'',notice:typeof b.notice==='string'?b.notice:''},d.now());
  let warning:string|undefined;
  if(action==='stop')try{await kickPublisher(d.config,event.id,fetcher);}catch{warning='視聴と新しい接続は停止済みです。OBS側でも配信を停止してください。';}
  return c.json({...await state(staff),warning});
 }));
 app.post('/visit/event/publisher',protect(async(c,_s,staff)=>{
  if(!staff)return c.json({error:'宮司・神職だけが配信鍵を表示できます。'},403);
  const event=await streamEvent(d.db);if(!d.config||!streamOpen(event,d.now()))return c.json({error:'配信の準備を先に行ってください。'},409);
  return c.json({server:d.config.ingestUrl,key:event!.id+'?user=publisher&pass='+publisherToken(event!,d.config.secret),expiresAt:event!.expiresAt});
 }));
 // MediaMTX専用。一般ログインでは許可しない。配信鍵/内部の資格情報を本文で照合する。
 app.post('/event-stream/auth',async c=>{
  c.header('Cache-Control','no-store');
  if(!d.config)return c.body(null,401);
  let body:unknown;try{body=await c.req.json();}catch{return c.body(null,401);}
  if(!body||typeof body!=='object')return c.body(null,401);
  const b=body as Record<string,unknown>;
  if(['action','path','user','password','protocol'].some(k=>b[k]!==undefined&&typeof b[k]!=='string'))return c.body(null,401);
  const ok=mediaAllowed(await streamEvent(d.db),d.config,b,d.now());return c.body(null,ok?204:401);
 });
 app.get('/visit/event/media/:id/:file',protect(async(c,session)=>{
  const id=c.req.param('id')!,file=c.req.param('file')!;
  if(!validEventId(id)||!mediaFile(file))return c.body(null,404);
  const event=await streamEvent(d.db);if(!d.config||!streamOpen(event,d.now(),true)||event!.id!==id)return c.body(null,403);
  const url=new URL(d.config.mediaUrl+'/event/'+id+'/'+file);
  for(const key of ['_HLS_msn','_HLS_part'] as const){const value=c.req.query(key);if(value!==undefined){if(!/^\d{1,12}$/.test(value))return c.body(null,400);url.searchParams.set(key,value);}}
  const skip=c.req.query('_HLS_skip');if(skip){if(skip!=='YES'&&skip!=='v2')return c.body(null,400);url.searchParams.set('_HLS_skip',skip);}
  const active=activeMedia.get(session.userId)??0;if(active>=8||totalMedia>=512)return c.body(null,429);
  activeMedia.set(session.userId,active+1);totalMedia++;let released=false,streaming=false;
  const release=()=>{if(released)return;released=true;totalMedia--;const left=(activeMedia.get(session.userId)??1)-1;if(left)activeMedia.set(session.userId,left);else activeMedia.delete(session.userId);};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);c.req.raw.signal.addEventListener('abort',()=>controller.abort(),{once:true});
  try{
   const headers:Record<string,string>={authorization:'Basic '+Buffer.from('bridge:'+d.config.secret).toString('base64')};
   const range=c.req.header('range');if(range&&/^bytes=\d{1,12}-\d{0,12}$/.test(range))headers.range=range;
   const upstream=await fetcher(url,{headers,redirect:'error',signal:controller.signal});
   if(!upstream.ok){await upstream.body?.cancel();clearTimeout(timer);return c.body(null,upstream.status===404?404:503);}
   const latest=await streamEvent(d.db);if(latest?.id!==id||!streamOpen(latest,d.now(),true)){await upstream.body?.cancel();clearTimeout(timer);return c.body(null,403);}
   const limit=file.endsWith('.m3u8')?262144:12*1024*1024;
   if(Number(upstream.headers.get('content-length'))>limit){await upstream.body?.cancel();clearTimeout(timer);return c.body(null,502);}
   if(file.endsWith('.m3u8')){
    const reader=upstream.body?.getReader();let size=0,text='';const decoder=new TextDecoder();
    if(!reader){clearTimeout(timer);return c.body(null,502);}
    while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new Error('manifest too large');}text+=decoder.decode(value,{stream:true});}
    clearTimeout(timer);return c.body(privatePlaylist(text+decoder.decode(),id),200,{'Content-Type':'application/vnd.apple.mpegurl'});
   }
   if(!upstream.body){clearTimeout(timer);return c.body(null,502);}
   const reader=upstream.body.getReader();let size=0;
   const body=new ReadableStream<Uint8Array>({async pull(out){try{const result=await reader.read();if(result.done){clearTimeout(timer);release();out.close();return;}size+=result.value.length;if(size>limit)throw new Error('segment too large');out.enqueue(result.value);}catch{clearTimeout(timer);release();controller.abort();await reader.cancel().catch(()=>{});out.error(new Error('映像の接続が切れました。'));}},async cancel(){clearTimeout(timer);release();controller.abort();await reader.cancel().catch(()=>{});}});
   const responseHeaders=new Headers({'Content-Type':file.endsWith('.ts')?'video/mp2t':'video/mp4','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
   for(const name of ['content-length','content-range','accept-ranges']){const value=upstream.headers.get(name);if(value)responseHeaders.set(name,value);}
   streaming=true;return new Response(body,{status:upstream.status===206?206:200,headers:responseHeaders});
  }catch{clearTimeout(timer);controller.abort();return c.body(null,502);}finally{if(!streaming)release();}
 }));
}

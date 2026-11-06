import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {eq} from 'drizzle-orm';
import {Hono} from 'hono';
import {makeDb,cfg,ROLE} from './helpers.js';
import type {Db} from '../src/db/client.js';
import type {DiscordApi} from '../src/web/discordApi.js';
import {members,auditLogs} from '../src/db/schema.js';
import {mountEventStream} from '../src/web/eventStream.js';
import {mountVisit} from '../src/web/visit.js';
import {createWebApp} from '../src/web/app.js';
import {createMemberSession,findMemberSession} from '../src/web/memberSessions.js';
import {createLoginLink} from '../src/services/casino/loginLinks.js';
import {changeStream,streamConfig,streamEvent,publisherToken} from '../src/services/eventStream.js';
const A='890000000000000111',B='890000000000000112',origin='https://stream.test',secret='test-only-stream-'.repeat(4),config=streamConfig({secret,ingestUrl:'rtmps://ingest.test:1936/event'})!;
let db:Db,close:()=>Promise<void>,app:Hono<any>,api:DiscordApi,now:Date,tokens:Record<string,string>,csrf:Record<string,string>,role:boolean,failed:boolean,left:boolean,upstream:ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(async()=>{
 ({db,close}=await makeDb());now=new Date('2026-11-07T00:00:00Z');role=true;failed=false;left=false;tokens={};csrf={};await db.insert(members).values([A,B].map(id=>({id,username:id,displayName:'参加者'})));
 api={memberRoles:async(_g,id)=>{if(failed)throw Error('offline');if(left)return null;return id===A&&role?[ROLE.guji]:[];},authorizeUrl:(state,uri)=>'https://discord.com/oauth2/authorize?state='+state+'&redirect_uri='+encodeURIComponent(uri),exchangeCode:async()=>'access',me:async()=>({id:B,username:'viewer',displayName:'視聴者',avatarUrl:null})};
 for(const id of [A,B]){tokens[id]=await createMemberSession(db,{id,username:id,displayName:'参加者',avatarUrl:null},now);csrf[id]=(await findMemberSession(db,tokens[id]!,now))!.csrfToken;}
 upstream=vi.fn<typeof fetch>(async(url)=>String(url).includes('/v3/')?Response.json({ready:true,source:null}):String(url).endsWith('.m3u8')?new Response('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\nstream.m3u8\nsegment0.mp4\n'):new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'video/mp4'}}));
 app=new Hono();mountEventStream(app,{db,api,cfg:()=>cfg,now:()=>now,config,fetcher:upstream});
});afterEach(async()=>close());
const get=(path='/visit/event/state',id=A)=>app.request(origin+path,{headers:{cookie:'sakura_visit='+tokens[id]}});
const post=(path:string,body:Record<string,string>,id=A)=>app.request(origin+'/visit/event/'+path,{method:'POST',headers:{cookie:'sakura_visit='+tokens[id],'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({_csrf:csrf[id]!,...body})});
async function event(){return changeStream(db,{action:'create',actorId:A,title:'配信 <script>',notice:'案内'},now);}
async function live(){const e=await event();return changeStream(db,{action:'start',actorId:A,id:e.id,version:0},now);}
it('匿名にはイベント/鍵/映像を渡さず、在籍中の会員だけが画面を開く',async()=>{
 const e=await live();expect(await(await app.request('/visit/event')).text()).toContain('Discordでログイン');expect((await app.request('/visit/event/state')).status).toBe(401);expect((await app.request('/visit/event/media/'+e.id+'/init.mp4')).status).toBe(401);expect((await get('/visit/event',B)).status).toBe(200);expect((await(await get(undefined,B)).json() as any).staff).toBe(false);expect((await get()).headers.get('cache-control')).toContain('no-store');
});
it('操作は毎回ロールを確認し、一般会員/CSRF/古い画面を拒否する',async()=>{
 expect((await post('control',{action:'create',title:'event'},B)).status).toBe(403);expect((await post('control',{action:'create',title:'event',_csrf:'bad'})).status).toBe(403);
 await get();role=false;expect((await post('control',{action:'create',title:'event'})).status).toBe(403);role=true;expect((await post('control',{action:'create',title:'event'})).status).toBe(200);const e=(await streamEvent(db))!;
 expect((await post('control',{action:'start',id:e.id,version:'0'})).status).toBe(200);expect((await post('control',{action:'stop',id:e.id,version:'0',confirm:'yes'})).status).toBe(409);expect((await post('control',{action:'stop',id:e.id,version:'1'})).status).toBe(400);
});
it('準備中の鍵は運営のPOSTだけで取得し、公開JSON/監査に含めない',async()=>{
 const e=await event();const pub=await(await post('publisher',{})).json() as any;expect(pub.server).toBe(config.ingestUrl);expect(pub.key).toContain(publisherToken(e,secret));expect((await post('publisher',{},B)).status).toBe(403);expect(await(await get()).text()).not.toContain(pub.key);expect(JSON.stringify(await db.select().from(auditLogs))).not.toContain(pub.key);expect((await get('/visit/event/media/'+e.id+'/init.mp4')).status).toBe(403);
});
it('配信サーバーへの認証は署名/内部資格情報を検証し、想定外アクションを拒否する',async()=>{
 const e=await event();const call=(b:unknown)=>app.request('/event-stream/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});
 expect((await call({action:'publish',user:'publisher',password:publisherToken(e,secret),protocol:'rtmp',path:'event/'+e.id})).status).toBe(204);expect((await call({action:'publish',user:'publisher',password:'wrong',protocol:'rtmp',path:'event/'+e.id})).status).toBe(401);expect((await call({action:'read',user:'any'})).status).toBe(401);expect((await call({action:{}})).status).toBe(401);expect((await call({payload:'x'.repeat(9000)})).status).toBe(413);
});
it('プレイリストと動画を内部取得し、資格情報・外部レスポンスヘッダーは漏らさない',async()=>{
 const e=await live();const r=await get('/visit/event/media/'+e.id+'/index.m3u8',B);expect(r.status).toBe(200);const text=await r.text();expect(text).toContain('/visit/event/media/'+e.id+'/init.mp4');expect(text).not.toContain(secret);expect(text).not.toContain(config.mediaUrl);expect(upstream.mock.calls[0]![0].toString()).toContain(config.mediaUrl+'/event/'+e.id+'/index.m3u8');
 const segment=await get('/visit/event/media/'+e.id+'/init.mp4',B);expect(segment.status).toBe(200);expect(segment.headers.get('content-type')).toBe('video/mp4');expect(new Uint8Array(await segment.arrayBuffer())).toEqual(new Uint8Array([1,2,3]));expect(segment.headers.get('cache-control')).toContain('no-store');
});
it('不正な参照/リダイレクト/巨大本文/任意クエリーを中継しない',async()=>{
 const e=await live(),path='/visit/event/media/'+e.id+'/';expect((await get(path+'file.key')).status).toBe(404);expect((await get(path+'index.m3u8?_HLS_msn=bad')).status).toBe(400);
 upstream.mockImplementation(async()=>new Response('#EXTM3U\nhttps://evil.test/private.mp4'));expect((await get(path+'index.m3u8')).status).toBe(502);
 upstream.mockImplementation(async()=>new Response('bad',{headers:{'content-length':'999999999'}}));expect((await get(path+'init.mp4')).status).toBe(502);
 upstream.mockImplementation(async()=>{throw Error('redirect');});expect((await get(path+'init.mp4')).status).toBe(502);
});
it('終了/期限切れ/別イベントは、元のURLを知っていても映像を返さない',async()=>{
 const e=await live(),path='/visit/event/media/'+e.id+'/init.mp4';expect((await get(path)).status).toBe(200);expect((await post('control',{action:'stop',id:e.id,version:'1',confirm:'yes'})).status).toBe(200);expect((await get(path)).status).toBe(403);expect((await post('publisher',{})).status).toBe(409);
 const next=await changeStream(db,{action:'create',actorId:A,title:'次'},now);await changeStream(db,{action:'start',actorId:A,id:next.id,version:0},now);expect((await get(path)).status).toBe(403);now=new Date(next.expiresAt);expect((await get('/visit/event/media/'+next.id+'/init.mp4')).status).toBe(403);expect((await(await get()).json() as any).event.status).toBe('closed');
});
it('退会/DB在籍取り消し/Discord障害では閉じ、GETの確認だけを30秒共有する',async()=>{
 const e=await live();let calls=0;api.memberRoles=async()=>{calls++;if(failed)throw Error('offline');return left?null:[];};await get(undefined,B);await get(undefined,B);expect(calls).toBe(1);failed=true;now=new Date(now.getTime()+31000);expect((await get('/visit/event/media/'+e.id+'/init.mp4',B)).status).toBe(503);failed=false;await db.update(members).set({leftAt:now}).where(eq(members.id,B));expect((await get(undefined,B)).status).toBe(403);
});
it('OBS未接続では開始せず、停止のAPI障害でも視聴は先に閉じる',async()=>{
 const e=await event();upstream.mockImplementation(async()=>new Response(null,{status:404}));expect((await post('control',{action:'start',id:e.id,version:'0'})).status).toBe(409);await changeStream(db,{action:'start',actorId:A,id:e.id,version:0},now);upstream.mockImplementation(async()=>new Response(null,{status:503}));const stop=await post('control',{action:'stop',id:e.id,version:'1',confirm:'yes'});expect(stop.status).toBe(200);expect((await stop.json() as any).warning).toContain('OBS');expect((await get('/visit/event/media/'+e.id+'/init.mp4')).status).toBe(403);
});
it('配信基盤未設定でも既存ページは動き、開始操作は失敗として案内する',async()=>{
 const off=new Hono();mountEventStream(off,{db,api,cfg:()=>cfg,now:()=>now});const response=await off.request('/visit/event/state',{headers:{cookie:'sakura_visit='+tokens[A]}});expect((await response.json() as any).configured).toBe(false);expect((await off.request('/visit/event/control',{method:'POST',headers:{cookie:'sakura_visit='+tokens[A],'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({_csrf:csrf[A]!,action:'create',title:'test'})})).status).toBe(503);
});
it('イベント用ログインリンクは視聴画面へ戻り、nextの外部URLは受け付けない',async()=>{
 const visit=new Hono();mountVisit(visit,{db,api,cfg:()=>cfg,baseUrl:origin,secure:true,now:()=>now,eventStream:config});const token=await createLoginLink(db,{id:B,displayName:'視聴者',avatarUrl:null},now);expect(await(await visit.request('/visit/link/'+token+'?next=event')).text()).toContain('?next=event');const response=await visit.request('/visit/link/'+token+'?next=event',{method:'POST',headers:{origin}});expect(response.headers.get('location')).toBe('/visit/event');
 const auth=await visit.request('/visit/auth?next=event');expect(auth.headers.get('set-cookie')).toContain('sakura_visit_next=event');
});
it('実アプリは外部JS/CSSだけを使い、CSPと静的ファイルを維持する',async()=>{
 const actual=createWebApp({db,cfg,api,discord:{} as any,baseUrl:origin,now:()=>now,eventStream:config});const response=await actual.request('/visit/event',{headers:{cookie:'sakura_visit='+tokens[A]}});const html=await response.text();expect(response.status).toBe(200);expect(html).toContain('event-hls.js?v=');expect(html).toContain('event-host');expect(html).not.toMatch(/onclick=|style=|<script>/);expect(response.headers.get('content-security-policy')).toContain("script-src 'self'");for(const name of ['event-stream.js','event-stream.css','event-hls.js'])expect((await actual.request('/static/'+name)).status).toBe(200);
});

it('同じ視聴者の同時映像取得を8本で抑え、取消後は枠を返す',async()=>{
 const e=await live(),path='/visit/event/media/'+e.id+'/init.mp4';upstream.mockImplementation(async()=>new Response(new ReadableStream<Uint8Array>({})));
 const responses=await Promise.all(Array.from({length:8},()=>get(path,B)));expect(responses.every(r=>r.status===200)).toBe(true);expect((await get(path,B)).status).toBe(429);
 await Promise.all(responses.map(r=>r.body!.cancel()));const next=await get(path,B);expect(next.status).toBe(200);await next.body!.cancel();
});

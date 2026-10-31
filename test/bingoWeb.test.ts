import {randomUUID} from 'node:crypto';
import {afterEach,beforeEach,expect,it} from 'vitest';
import {Hono} from 'hono';
import {makeDb,cfg,ROLE} from './helpers.js';
import type {Db} from '../src/db/client.js';
import type {DiscordApi} from '../src/web/discordApi.js';
import {members,bingoCards} from '../src/db/schema.js';
import {mountVisit} from '../src/web/visit.js';
import {createMemberSession,findMemberSession} from '../src/web/memberSessions.js';
import {createLoginLink} from '../src/services/casino/loginLinks.js';
import {createWebApp} from '../src/web/app.js';
const A='890000000000000001',B='890000000000000002',origin='https://bingo.test';let db:Db,close:()=>Promise<void>,app:Hono<any>,api:DiscordApi,now:Date,tokens:Record<string,string>,csrf:Record<string,string>,staff:boolean,mode:'ok'|'error'|'left';
beforeEach(async()=>{
 ({db,close}=await makeDb());now=new Date('2026-10-26T12:00:00Z');staff=true;mode='ok';tokens={};csrf={};await db.insert(members).values([A,B].map(id=>({id,username:id,displayName:'参加者 <script>'})));
 for(const id of [A,B]){tokens[id]=await createMemberSession(db,{id,username:id,displayName:id,avatarUrl:null},now);csrf[id]=(await findMemberSession(db,tokens[id]!,now))!.csrfToken;}
 api={memberRoles:async(_g:string,id:string)=>{if(mode==='error')throw Error('offline');if(mode==='left')return null;return id===A&&staff?[ROLE.guji]:[];}} as any;
 app=new Hono();mountVisit(app,{db,api,cfg:()=>cfg,baseUrl:origin,secure:true,now:()=>now});
});
afterEach(async()=>close());
const get=(path:string,id=A)=>app.request(origin+path,{headers:{cookie:'sakura_visit='+tokens[id]}});
const post=(path:string,body:Record<string,string>,id=A)=>app.request(origin+'/visit/bingo/'+path,{method:'POST',headers:{cookie:'sakura_visit='+tokens[id]},body:new URLSearchParams({_csrf:csrf[id]!,...body})});
const create=async()=>{const r=await post('create',{id:randomUUID(),title:'夜のビンゴ'});expect(r.status).toBe(200);return (await r.json()) as any;};
it('未認証の入口は案内、APIは401で、社務所cookieでは参加できない',async()=>{
 expect((await app.request(origin+'/visit/bingo')).status).toBe(200);expect(await (await app.request(origin+'/visit/bingo')).text()).toContain('/ビンゴ');expect((await app.request(origin+'/visit/bingo/state')).status).toBe(401);expect((await app.request(origin+'/visit/bingo/join',{method:'POST',headers:{cookie:'shamusho_session=fake'}})).status).toBe(401);
});
it('在籍確認失敗は503、退会は403でセッションを失効する',async()=>{
 mode='error';expect((await get('/visit/bingo/state')).status).toBe(503);expect(await findMemberSession(db,tokens[A]!,now)).toBeDefined();mode='left';expect((await get('/visit/bingo/state')).status).toBe(403);expect(await findMemberSession(db,tokens[A]!,now)).toBeUndefined();
});
it('作成・抽選は最新運営ロールとCSRFが必要で、個人カードの指定を受け入れない',async()=>{
 expect((await post('create',{id:randomUUID(),title:'偽装'},B)).status).toBe(403);expect((await post('create',{id:randomUUID(),title:'bad',_csrf:'bad'})).status).toBe(403);
 const state=await create(),id=state.event.id;const joined=await post('join',{id,memberId:A,numbers:'[1,2,3]'},B);expect(joined.status).toBe(200);const cards=await db.select().from(bingoCards);expect(cards).toHaveLength(1);expect(cards[0]!.memberId).toBe(B);expect(cards[0]!.numbers).toHaveLength(25);
 const lobby=await (await get('/visit/bingo/state')).json() as any;const active=await (await post('start',{id,version:String(lobby.event.version)})).json() as any;expect((await post('draw',{id,version:String(active.event.version)},B)).status).toBe(403);staff=false;expect((await post('draw',{id,version:String(active.event.version)})).status).toBe(403);
});
it('公開前の番号を含まず、時刻後に番号と自動マークを同期し再接続で維持する',async()=>{
 const state=await create(),id=state.event.id;await post('join',{id},B);const lobby=await (await get('/visit/bingo/state')).json() as any;const active=await (await post('start',{id,version:String(lobby.event.version)})).json() as any;
 const scheduled=await (await post('draw',{id,version:String(active.event.version)})).json() as any;expect(scheduled.event.draws).toEqual([]);expect(JSON.stringify(scheduled)).not.toContain('pendingNumber');expect(scheduled.card).toBeNull();now=new Date(now.getTime()+3000);
 const result=await (await get('/visit/bingo/state?id='+id,B)).json() as any;expect(result.event.draws).toHaveLength(1);const again=await (await get('/visit/bingo/state?id='+id,B)).json() as any;expect(again.card).toEqual(result.card);expect(result.card.marked[12]).toBe(true);expect((await post('claim',{id},B)).status).toBe(409);
});
it('本人用リンクはビンゴへ戻り、nextの任意URLへは転送しない',async()=>{
 const token=await createLoginLink(db,{id:B,displayName:'参加者',avatarUrl:null},now);const gate=await app.request(origin+'/visit/link/'+token+'?next=bingo');expect(await gate.text()).toContain('?next=bingo');const response=await app.request(origin+'/visit/link/'+token+'?next=bingo',{method:'POST',headers:{origin}});expect(response.status).toBe(303);expect(response.headers.get('location')).toBe('/visit/bingo');expect(response.headers.get('set-cookie')).toContain('Path=/visit');
 const other=await createLoginLink(db,{id:A,displayName:'参加者',avatarUrl:null},now);const safe=await app.request(origin+'/visit/link/'+other+'?next=https://evil.test',{method:'POST',headers:{origin}});expect(safe.headers.get('location')).toBe('/visit');
});
it('実アプリの画面は外部JS/CSSと左右の領域を持ち、静的素材を配信する',async()=>{
 const actual=createWebApp({db,cfg,api,baseUrl:origin,discord:{} as any,now:()=>now});const page=await actual.request(origin+'/visit/bingo',{headers:{cookie:'sakura_visit='+tokens[A]}});expect(page.status).toBe(200);const html=await page.text();expect(html).toContain('咲楽ノ宮 · 桜のビンゴ会');expect(html).toContain('id="b-card"');expect(html).toContain('id="b-numbers"');expect(html).toContain('/static/bingo.js?v=');expect(html).not.toContain('<script>');expect(html).not.toContain('onclick=');expect(html).not.toContain('style=');
 for(const file of ['bingo.js','bingo.css','bingo-shrine.jpg'])expect((await actual.request(origin+'/static/'+file)).status).toBe(200);
});

it('自動更新の在籍確認は短く共有し、操作時は必ずDiscordへ確認し直す',async()=>{
 let calls=0;api.memberRoles=async(_g:string,id:string)=>{calls++;return id===A&&staff?[ROLE.guji]:[];};
 await get('/visit/bingo/state');await get('/visit/bingo/state');expect(calls).toBe(1);staff=false;expect((await post('create',{id:randomUUID(),title:'権限は失効'})).status).toBe(403);expect(calls).toBe(2);expect((await (await get('/visit/bingo/state')).json() as any).staff).toBe(false);
 now=new Date(now.getTime()+31000);await get('/visit/bingo/state');expect(calls).toBe(3);
});
it('🎯 ビンゴを回せるロール（イベントメンバーなど）を持つ人は、作る・回すができる',async()=>{
 const {saveBingoHostRoles}=await import('../src/services/bingo.js');
 const EVENT='890000000000000777';
 api.memberRoles=async(_g:string,id:string)=>id===B?[EVENT]:[];
 expect((await post('create',{id:randomUUID(),title:'まだ'},B)).status).toBe(403);
 await saveBingoHostRoles(db,[EVENT,'bad'],A);
 const r=await post('create',{id:randomUUID(),title:'イベントのビンゴ'},B);expect(r.status).toBe(200);
 const state=await r.json() as any;expect(state.staff).toBe(true);
 await post('join',{id:state.event.id},A);
 const lobby=await (await get('/visit/bingo/state?id='+state.event.id,B)).json() as any;
 const active=await (await post('start',{id:state.event.id,version:String(lobby.event.version)},B)).json() as any;
 expect((await post('draw',{id:state.event.id,version:String(active.event.version)},B)).status).toBe(200);
});

import {beforeEach,afterEach,expect,it} from 'vitest';
import {eq} from 'drizzle-orm';
import {makeDb,cfg,ROLE} from './helpers.js';
import type {Db} from '../src/db/client.js';
import {kisekiTickets,coinTx} from '../src/db/schema.js';
import {recordJoin} from '../src/services/members.js';
import {addCoins,walletOf} from '../src/services/economy.js';
import {experienceState,setExperienceSales} from '../src/services/casino/kiseki/experience.js';
import {createMemberSession,findMemberSession} from '../src/web/memberSessions.js';
import {createSession,findSession} from '../src/web/sessions.js';
import {createWebApp} from '../src/web/app.js';
const A='760000000000000001',B='760000000000000002',base='https://example.test',path='/casino/god';
let db:Db,close:()=>Promise<void>,app:ReturnType<typeof createWebApp>,clock:Date,memberToken:string,csrf:string,adminToken:string,adminCsrf:string;
const h=(admin=false)=>({cookie:admin?'shamusho_session='+adminToken:'sakura_casino='+memberToken,origin:base,'sec-fetch-site':'same-origin'});
async function post(url:string,data:Record<string,string>,admin=false){return app.request(url,{method:'POST',headers:h(admin),body:new URLSearchParams({_csrf:admin?adminCsrf:csrf,...data})});}
beforeEach(async()=>{({db,close}=await makeDb());clock=new Date('2026-11-09T03:00:00Z');const u={id:A,username:'fixture',displayName:'架空<参加者>',avatarUrl:null};await recordJoin(db,{...u,roleIds:[ROLE.guji],isBot:false,joinedAt:clock});await addCoins(db,A,5000,'adjust');memberToken=await createMemberSession(db,u,clock);csrf=(await findMemberSession(db,memberToken,clock))!.csrfToken;adminToken=await createSession(db,u,{level:'guji',pages:['economy']},clock);adminCsrf=(await findSession(db,adminToken,clock))!.csrfToken;app=createWebApp({db,cfg:()=>cfg,api:{memberRoles:async()=>[ROLE.guji]}as never,discord:{}as never,baseUrl:base,now:()=>clock});});afterEach(async()=>close());
it('販売初期停止・カジノ入口の出し分け・宮司の開始/停止・会員認証とCSRFを守る',async()=>{
 const guest=await app.request(path);expect(guest.status).toBe(302);let hall=await(await app.request('/casino/hall',{headers:h()})).text();expect(hall).not.toContain('神域体験券');
 expect((await post('/economy/kiseki-experience',{enabled:'1'})).status).not.toBe(303);expect((await post('/economy/kiseki-experience',{enabled:'1',_csrf:'bad'},true)).status).toBe(403);expect((await post('/economy/kiseki-experience',{enabled:'1'},true)).status).toBe(303);
 hall=await(await app.request('/casino/hall',{headers:h()})).text();expect(hall).toContain('神域体験券');expect(hall).toContain(path);expect((await post(path+'/buy',{agree:'1',requestId:'request_000000000001',_csrf:'bad'})).status).toBe(403);expect((await walletOf(db,A)).balance).toBe(5000);
});
it('本人の購入・使用・実ゲームが動き、会員には運営操作や内部モードを表示しない',async()=>{
 await setExperienceSales(db,A,true,clock);const page=await app.request(path,{headers:h()});expect(page.headers.get('cache-control')).toContain('no-store');const html=await page.text();expect(html).toContain('1,500');expect(html).toContain('使用開始から連続60分');expect(html).not.toMatch(/onclick=|style=/);
 const buy={agree:'1',requestId:'request_000000000001'};expect((await post(path+'/buy',buy)).status).toBe(303);expect((await post(path+'/buy',buy)).status).toBe(303);expect((await walletOf(db,A)).balance).toBe(3500);const [t]=await db.select().from(kisekiTickets);expect((await post(path+'/start',{ticketId:t!.id})).status).toBe(303);
 let play=await(await app.request(path+'/play',{headers:h()})).text();expect(play).toContain('data-experience-clock');expect(play).toContain('action="/casino/god/play"');for(const forbidden of ['name="setting"','name="scenario"','/economy/gaisen','/economy/casino','omenAwards','normalMode'])expect(play).not.toContain(forbidden);
 for(const [action,index]of [['lever',''],['stop','0'],['stop','1'],['stop','2']]){const s=await experienceState(db,A,clock);const r=await post(path+'/play',{action:action!,index:index!,machine:'1',revision:String(s.view.revision)});expect(r.status).toBe(303);}
 expect((await walletOf(db,A)).balance).toBe(3500);expect(await db.select().from(coinTx).where(eq(coinTx.reason,'kiseki_ticket'))).toHaveLength(1);
 const guide=await(await app.request(path+'/play/guide',{headers:h()})).text();expect(guide).toContain('有効ラインは1本');expect(guide).toContain('href="/casino/god/play"');expect(guide).not.toContain('/economy/kiseki-trial');
});
it('期限後の新規操作と偽の運営操作・他人の券を拒否し、カジノ停止も適用する',async()=>{
 await setExperienceSales(db,A,true,clock);await post(path+'/buy',{agree:'1',requestId:'request_000000000001'});const [t]=await db.select().from(kisekiTickets);const u={id:B,username:'other',displayName:'架空',avatarUrl:null};const other=await createMemberSession(db,u,clock),s=(await findMemberSession(db,other,clock))!;const denied=await app.request(path+'/start',{method:'POST',headers:{...h(),cookie:'sakura_casino='+other},body:new URLSearchParams({_csrf:s.csrfToken,ticketId:t!.id})});expect(denied.status).toBe(403);
 await post(path+'/start',{ticketId:t!.id});let v=await experienceState(db,A,clock);expect((await post(path+'/play',{action:'scenario',scenario:'pgg',machine:'1',revision:String(v.view.revision)})).status).toBe(403);
 clock=new Date(clock.getTime()+3600000);v=await experienceState(db,A,clock);expect((await post(path+'/play',{action:'lever',machine:'1',revision:String(v.view.revision)})).status).toBe(403);expect((await walletOf(db,A)).balance).toBe(3500);
 const off=createWebApp({db,cfg:()=>({...cfg,casino:{...cfg.casino,enabled:false}}),api:{}as never,discord:{}as never,baseUrl:base,now:()=>clock});const closed=await off.request(path+'/buy',{method:'POST',headers:h(),body:new URLSearchParams({_csrf:csrf,agree:'1',requestId:'request_000000000002'})});expect(await closed.text()).toContain('お休み');expect(await db.select().from(kisekiTickets)).toHaveLength(1);
});
it('神職や経済権限のない宮司は販売状態を変更できない',async()=>{
 for(const access of [{level:'shinshoku' as const,pages:['economy' as const]},{level:'guji' as const,pages:['members' as const]}]){const t=await createSession(db,{id:A,username:'fixture',displayName:'架空',avatarUrl:null},access,clock),s=(await findSession(db,t,clock))!;const r=await app.request('/economy/kiseki-experience',{method:'POST',headers:{...h(),cookie:'shamusho_session='+t},body:new URLSearchParams({_csrf:s.csrfToken,enabled:'1'})});expect(r.status).toBe(403);}
});

import {beforeEach,afterEach,it,expect} from 'vitest';
import {makeDb,cfg,ROLE} from './helpers.js';
import type {Db} from '../src/db/client.js';
import {createWebApp} from '../src/web/app.js';
import {createSession,findSession} from '../src/web/sessions.js';
import {recordJoin} from '../src/services/members.js';
import {listEventLotteries,eventLotteryView,enterEventLottery} from '../src/services/eventLottery.js';
import {addCoins,walletOf} from '../src/services/economy.js';
const path='/economy/event-lottery',id='760000000000000001',now=new Date('2026-11-08T01:00:00Z'),channel='100000000000000001',user={id,username:'operator',displayName:'運営',avatarUrl:null};
let db:Db,close:()=>Promise<void>,app:ReturnType<typeof createWebApp>,token:string,csrf:string;
const headers=()=>({cookie:'shamusho_session='+token,origin:'https://example.test','sec-fetch-site':'same-origin'});
const post=(action:string,extra:Record<string,string>={})=>app.request(path,{method:'POST',headers:headers(),body:new URLSearchParams({_csrf:csrf,action,...extra})});
beforeEach(async()=>{({db,close}=await makeDb());await recordJoin(db,{...user,roleIds:[ROLE.guji],isBot:false,joinedAt:now});app=createWebApp({db,cfg:()=>cfg,api:{memberRoles:async()=>[ROLE.guji]}as never,discord:{guildChannels:async()=>[{id:channel,type:0,name:'event',parent_id:null,position:0}]}as never,baseUrl:'https://example.test',now:()=>now});token=await createSession(db,user,{level:'guji',pages:null},now);csrf=(await findSession(db,token,now))!.csrfToken;});afterEach(async()=>close());
const input={name:'11月8日',fee:'100',channelId:channel,resultChannelId:channel,name0:'特賞',count0:'1',coins0:'200',item0:'品物'};
it('宮司以外・経済ページ権限なし・CSRF不正を拒否する',async()=>{expect((await post('create',{...input,_csrf:'bad'})).status).toBe(403);for(const access of [{level:'shinshoku' as const,pages:null},{level:'guji' as const,pages:['home' as const]}]){token=await createSession(db,user,access,now);expect((await app.request(path,{headers:headers()})).status).toBe(403);}expect(await listEventLotteries(db)).toHaveLength(0);});
it('Webで作成/受付/締切/抽選/受け渡し/完了、通知未送信を管理する',async()=>{
 const r=await post('create',input);expect(r.status).toBe(303);const e=(await listEventLotteries(db))[0]!;let html=await(await app.request(path+'?event='+e.id,{headers:headers()})).text();expect(html).toContain('準備中');expect(html).toContain('event-lottery.js?v=');expect(html).not.toMatch(/onclick=|style=/);
 expect((await post('open',{eventId:e.id,version:'0'})).status).toBe(303);await addCoins(db,id,1000,'adjust');await enterEventLottery(db,e.id,id,'運営');await post('close',{eventId:e.id,version:'1'});const view=await eventLotteryView(db,e.id);const d=await post('draw',{eventId:e.id,version:'2',prizeId:view.event.prizes[0]!.id,operationId:'11111111-1111-4111-8111-111111111111'});expect(d.headers.get('location')).toContain('&draw=');expect((await walletOf(db,id)).balance).toBe(1100);const result=(await eventLotteryView(db,e.id)).results[0]!;await post('deliver',{eventId:e.id,drawId:result.id});await post('complete',{eventId:e.id,version:'3'});expect((await eventLotteryView(db,e.id)).event.state).toBe('completed');expect((await eventLotteryView(db,e.id)).results[0]!.delivered).toBe(true);
});
it('別サーバーのチャンネルや不正景品では作成せず、準備中だけ編集できる',async()=>{
 await post('create',{...input,channelId:'999999999999999999'});expect(await listEventLotteries(db)).toHaveLength(0);await post('create',{...input,count0:'0'});expect(await listEventLotteries(db)).toHaveLength(0);await post('create',input);const e=(await listEventLotteries(db))[0]!;await post('edit',{...input,eventId:e.id,version:'0',fee:'150'});expect((await eventLotteryView(db,e.id)).event.fee).toBe(150);await post('open',{eventId:e.id,version:'1'});await post('edit',{...input,eventId:e.id,version:'2',fee:'999'});expect((await eventLotteryView(db,e.id)).event.fee).toBe(150);
});

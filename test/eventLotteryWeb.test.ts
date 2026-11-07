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
 expect((await post('open',{eventId:e.id,version:'0'})).status).toBe(303);await addCoins(db,id,1000,'adjust');await enterEventLottery(db,e.id,id,'運営');await post('close',{eventId:e.id,version:'1'});const view=await eventLotteryView(db,e.id);const d=await post('draw',{eventId:e.id,version:'2',prizeId:view.event.prizes[0]!.id,operationId:'11111111-1111-4111-8111-111111111111'});expect(d.headers.get('location')).toContain('&draw=');expect((await walletOf(db,id)).balance).toBe(1100);const result=(await eventLotteryView(db,e.id)).results[0]!;const resultHtml=await(await app.request(path+'?event='+e.id+'&draw='+result.id,{headers:headers()})).text();expect(resultHtml).toMatch(/<article[^>]*data-el-history-at="[^"]+"[^>]*hidden/);await post('deliver',{eventId:e.id,drawId:result.id});await post('complete',{eventId:e.id,version:'3'});expect((await eventLotteryView(db,e.id)).event.state).toBe('completed');expect((await eventLotteryView(db,e.id)).results[0]!.delivered).toBe(true);
});
it('別サーバーのチャンネルや不正景品では作成せず、準備中だけ編集できる',async()=>{
 await post('create',{...input,channelId:'999999999999999999'});expect(await listEventLotteries(db)).toHaveLength(0);await post('create',{...input,count0:'0'});expect(await listEventLotteries(db)).toHaveLength(0);await post('create',input);const e=(await listEventLotteries(db))[0]!;await post('edit',{...input,eventId:e.id,version:'0',fee:'150'});expect((await eventLotteryView(db,e.id)).event.fee).toBe(150);await post('open',{eventId:e.id,version:'1'});await post('edit',{...input,eventId:e.id,version:'2',fee:'999'});expect((await eventLotteryView(db,e.id)).event.fee).toBe(150);
});

it('商品名と本数だけの景品6種と賞金3種を同じイベントへ保存できる',async()=>{
 const prizes:Record<string,string>={};for(let i=0;i<6;i++)Object.assign(prizes,{['name'+i]:'記念品'+(i+1),['count'+i]:String(i+1),['coins'+i]:'0',['item'+i]:''});
 for(let i=6;i<9;i++)Object.assign(prizes,{['name'+i]:'賞金'+i,['count'+i]:'2',['coins'+i]:String((i-5)*500),['item'+i]:''});
 const response=await post('create',{...input,fee:'300',...prizes});expect(response.headers.get('location')).not.toContain('e=invalid');
 const [e]=await listEventLotteries(db);expect(e!.prizes).toHaveLength(9);expect(e!.fee).toBe(300);
 for(const p of e!.prizes.slice(0,6))expect(p.item).toBe(p.name);for(const p of e!.prizes.slice(6))expect(p.item).toBe('');
});
it('品物名の補完は編集と当選/受け渡しにも残り、賞金0では銭を発行しない',async()=>{
 await post('create',{...input,name0:'商品券',coins0:'0',item0:''});const [e]=await listEventLotteries(db);
 await post('edit',{...input,eventId:e!.id,version:'0',name0:'記念品',coins0:'0',item0:'  '});expect((await eventLotteryView(db,e!.id)).event.prizes[0]!.item).toBe('記念品');
 await post('open',{eventId:e!.id,version:'1'});await addCoins(db,id,1000,'adjust');await enterEventLottery(db,e!.id,id,'運営');await post('close',{eventId:e!.id,version:'2'});const v=await eventLotteryView(db,e!.id);
 await post('draw',{eventId:e!.id,version:'3',prizeId:v.event.prizes[0]!.id,operationId:'22222222-2222-4222-8222-222222222222'});const [r]=(await eventLotteryView(db,e!.id)).results;expect(r!.item).toBe('記念品');expect(r!.coins).toBe(0);expect((await walletOf(db,id)).balance).toBe(900);
 await post('deliver',{eventId:e!.id,drawId:r!.id});expect((await eventLotteryView(db,e!.id)).results[0]!.delivered).toBe(true);
});
it('入力エラーは景品未設定/参加費/景品本数/チャンネルの項目を区別する',async()=>{
 const cases:Array<{values:Record<string,string>;message:string}>=[{values:{name0:''},message:'景品：名前を入れた景品を1種類以上'},{values:{fee:'0'},message:'参加費：1〜100,000,000銭の整数'},{values:{name0:'',name1:'特別賞',count1:'0',coins1:'0',item1:''},message:'景品「特別賞」：本数は1〜10,000の整数'},{values:{resultChannelId:'999999999999999999'},message:'結果発表チャンネル：このサーバーのテキストチャンネル'}];
 for(const c of cases){const r=await post('create',{...input,...c.values});expect(decodeURIComponent(r.headers.get('location')!)).toContain(c.message);}
 expect(await listEventLotteries(db)).toHaveLength(0);
 await post('create',input);const [e]=await listEventLotteries(db);const r=await post('edit',{...input,eventId:e!.id,version:'0',fee:'0'});expect(decodeURIComponent(r.headers.get('location')!)).toContain('参加費：');expect((await eventLotteryView(db,e!.id)).event.fee).toBe(100);
});

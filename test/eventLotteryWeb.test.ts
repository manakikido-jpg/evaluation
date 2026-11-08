import {beforeEach,afterEach,it,expect} from 'vitest';
import {makeDb,cfg,ROLE} from './helpers.js';
import type {Db} from '../src/db/client.js';
import {createWebApp} from '../src/web/app.js';
import {createSession,findSession} from '../src/web/sessions.js';
import {recordJoin} from '../src/services/members.js';
import {listEventLotteries,eventLotteryView,enterEventLottery} from '../src/services/eventLottery.js';
import {addCoins,walletOf} from '../src/services/economy.js';
import type {EventLotteryScreenState} from '../src/web/views/eventLotteryScreen.js';
const path='/economy/event-lottery',id='760000000000000001',now=new Date('2026-11-08T01:00:00Z'),channel='100000000000000001',user={id,username:'operator',displayName:'運営',avatarUrl:null};
let db:Db,close:()=>Promise<void>,app:ReturnType<typeof createWebApp>,token:string,csrf:string;
const headers=()=>({cookie:'shamusho_session='+token,origin:'https://example.test','sec-fetch-site':'same-origin'});
const post=(action:string,extra:Record<string,string>={})=>app.request(path,{method:'POST',headers:headers(),body:new URLSearchParams({_csrf:csrf,action,...extra})});
beforeEach(async()=>{({db,close}=await makeDb());await recordJoin(db,{...user,roleIds:[ROLE.guji],isBot:false,joinedAt:now});app=createWebApp({db,cfg:()=>cfg,api:{memberRoles:async()=>[ROLE.guji]}as never,discord:{guildChannels:async()=>[{id:channel,type:0,name:'event',parent_id:null,position:0}]}as never,baseUrl:'https://example.test',now:()=>now});token=await createSession(db,user,{level:'guji',pages:null},now);csrf=(await findSession(db,token,now))!.csrfToken;});afterEach(async()=>close());
const input={name:'11月8日',fee:'100',channelId:channel,resultChannelId:channel,name0:'特賞',count0:'1',coins0:'200',item0:'品物'};
it('宮司以外・経済ページ権限なし・CSRF不正を拒否する',async()=>{expect((await post('create',{...input,_csrf:'bad'})).status).toBe(403);for(const access of [{level:'shinshoku' as const,pages:null},{level:'guji' as const,pages:['home' as const]}]){token=await createSession(db,user,access,now);for(const query of ['', '?screen=1','?screen=data','?screen=demo'])expect((await app.request(path+query,{headers:headers()})).status).toBe(403);}expect(await listEventLotteries(db)).toHaveLength(0);});
it('Webで作成/受付/締切/抽選/受け渡し/完了、通知未送信を管理する',async()=>{
 const r=await post('create',input);expect(r.status).toBe(303);const e=(await listEventLotteries(db))[0]!;let html=await(await app.request(path+'?event='+e.id,{headers:headers()})).text();expect(html).toContain('準備中');expect(html).toContain('event-lottery.js?v=');expect(html).not.toMatch(/onclick=|style=/);
 expect((await post('open',{eventId:e.id,version:'0'})).status).toBe(303);expect((await post('refresh-panel',{eventId:e.id})).status).toBe(303);await addCoins(db,id,1000,'adjust');await enterEventLottery(db,e.id,id,'運営');await post('close',{eventId:e.id,version:'1'});const view=await eventLotteryView(db,e.id);const d=await post('draw',{eventId:e.id,version:'2',prizeId:view.event.prizes[0]!.id,operationId:'11111111-1111-4111-8111-111111111111'});expect(d.headers.get('location')).toContain('&draw=');expect((await walletOf(db,id)).balance).toBe(1100);const result=(await eventLotteryView(db,e.id)).results[0]!;const resultHtml=await(await app.request(path+'?event='+e.id+'&draw='+result.id,{headers:headers()})).text();expect(resultHtml).toMatch(/<article[^>]*data-el-history-at="[^"]+"[^>]*hidden/);await post('deliver',{eventId:e.id,drawId:result.id});await post('complete',{eventId:e.id,version:'3'});expect((await eventLotteryView(db,e.id)).event.state).toBe('completed');expect((await eventLotteryView(db,e.id)).results[0]!.delivered).toBe(true);
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

it('画面共有は運営情報と景品一覧を出さず、閲覧だけでは徴収・抽選を行わない',async()=>{
 await post('create',{...input,item0:'非公開の受け渡し指示'});const e=(await listEventLotteries(db))[0]!;
 await post('open',{eventId:e.id,version:'0'});await addCoins(db,id,1000,'adjust');await enterEventLottery(db,e.id,id,'非公開の参加者名');
 const before=await eventLotteryView(db,e.id),balance=await walletOf(db,id);
 const screen=path+'?event='+e.id+'&screen=';
 const page=await app.request(screen+'1',{headers:headers()}),html=await page.text();expect(page.status).toBe(200);expect(page.headers.get('cache-control')).toContain('no-store');expect(html).toContain('event-lottery-screen.js?v=');expect(html).toContain('ただいま参加受付中');
 for(const privateText of ['非公開の参加者名','非公開の受け渡し指示','特賞',csrf,channel,'回収総額','<form','onclick=','style='])expect(html).not.toContain(privateText);
 const state=await(await app.request(screen+'data',{headers:headers()})).json();expect(state).toEqual({name:input.name,state:'open',participants:1,winners:0,draw:null});
 expect(await eventLotteryView(db,e.id)).toEqual(before);expect(await walletOf(db,id)).toEqual(balance);
 for(const value of ['1','data'])expect((await app.request(path+'?event=missing&screen='+value,{headers:headers()})).status).toBe(404);
 expect((await app.request(screen+'data')).status).not.toBe(200);
});
it('共有用の状態とHTMLは3秒経つまで当選者を出さず、再読込でも同じ結果と賞金を保つ',async()=>{
 const start=now.getTime();try{
  await post('create',{...input,item0:'秘密の連絡先'});const e=(await listEventLotteries(db))[0]!;await post('open',{eventId:e.id,version:'0'});await addCoins(db,id,1000,'adjust');await enterEventLottery(db,e.id,id,'<当選者>');await post('close',{eventId:e.id,version:'1'});
  const v=await eventLotteryView(db,e.id);await post('draw',{eventId:e.id,version:'2',prizeId:v.event.prizes[0]!.id,operationId:'33333333-3333-4333-8333-333333333333'});
  const screen=path+'?event='+e.id+'&screen=',read=async()=>await(await app.request(screen+'data',{headers:headers()})).json() as EventLotteryScreenState;
  for(const elapsed of [0,2999]){now.setTime(start+elapsed);const data=await read();expect(data.winners).toBe(0);expect(data.draw).toEqual({id:'33333333-3333-4333-8333-333333333333',prize:'特賞',winner:null,coins:null});const html=await(await app.request(screen+'1',{headers:headers()})).text();expect(html).not.toContain('当選者');expect(html).toContain('data-stage="drawing"');}
  now.setTime(start+3000);const data=await read();expect(data.winners).toBe(1);expect(data.draw!.winner).toBe('<当選者>');expect(data.draw!.coins).toBe(200);expect(JSON.stringify(data)).not.toMatch(/秘密の連絡先|memberId|actorId|channelId/);
  const html=await(await app.request(screen+'1',{headers:headers()})).text();expect(html).toContain('&lt;当選者&gt;');expect(html).not.toContain('秘密の連絡先');expect(html).toContain('data-stage="winner"');expect(await read()).toEqual(data);expect((await walletOf(db,id)).balance).toBe(1100);expect((await eventLotteryView(db,e.id)).results).toHaveLength(1);
 }finally{now.setTime(start);}
});
it('共有画面は連続した当選を順番に取得でき、保持中の発表も変わらない',async()=>{
 const start=now.getTime();try{
  const other='760000000000000002';await recordJoin(db,{id:other,username:'second',displayName:'二人目',avatarUrl:null,roleIds:[],isBot:false,joinedAt:now});
  await post('create',{...input,count0:'2'});const e=(await listEventLotteries(db))[0]!;await post('open',{eventId:e.id,version:'0'});for(const p of [id,other]){await addCoins(db,p,1000,'adjust');await enterEventLottery(db,e.id,p,p===id?'一人目':'二人目');}await post('close',{eventId:e.id,version:'1'});
  let model=await eventLotteryView(db,e.id);await post('draw',{eventId:e.id,version:'2',prizeId:model.event.prizes[0]!.id,operationId:'44444444-4444-4444-8444-444444444444'});
  now.setTime(start+3100);await post('draw',{eventId:e.id,version:'3',prizeId:model.event.prizes[0]!.id,operationId:'55555555-5555-4555-8555-555555555555'});model=await eventLotteryView(db,e.id);
  const read=async(query:string)=>await(await app.request(path+'?event='+e.id+'&screen=data&'+query,{headers:headers()})).json() as EventLotteryScreenState;
  const first=await read('after=start');expect(first.draw!.id).toBe(model.results[0]!.id);expect(first.draw!.winner).toBe(model.results[0]!.displayName);
  expect((await read('focus='+first.draw!.id)).draw).toEqual(first.draw);
  const second=await read('after='+first.draw!.id);expect(second.draw!.id).toBe(model.results[1]!.id);expect(second.draw!.winner).toBeNull();
  now.setTime(start+6100);expect((await read('focus='+second.draw!.id)).draw!.winner).toBe(model.results[1]!.displayName);expect((await read('after='+second.draw!.id)).draw!.id).toBe(second.draw!.id);expect((await eventLotteryView(db,e.id)).results).toHaveLength(2);
 }finally{now.setTime(start);}
});

it('イベント未作成でもテスト抽選を開け、実イベントを指定しても架空データだけを使う',async()=>{
 const first=await app.request(path+'?screen=demo',{headers:headers()}),firstHtml=await first.text();expect(first.status).toBe(200);expect(firstHtml).toContain('テストモード');expect(firstHtml).toContain('data-demo="true"');expect(firstHtml).toContain('data-endpoint=""');expect(firstHtml).toContain('テストで1回引く');expect(firstHtml).toContain('最初に戻す');expect(await listEventLotteries(db)).toHaveLength(0);
 expect(await(await app.request(path,{headers:headers()})).text()).toContain('?screen=demo');
 await post('create',{...input,name:'実イベントの名前',name0:'実景品の名前',item0:'実景品の受け渡し先'});const e=(await listEventLotteries(db))[0]!;await post('open',{eventId:e.id,version:'0'});await addCoins(db,id,1000,'adjust');await enterEventLottery(db,e.id,id,'実参加者の名前');const before=await eventLotteryView(db,e.id),wallet=await walletOf(db,id);
 const r=await app.request(path+'?screen=demo&event='+e.id,{headers:headers()}),html=await r.text();expect(r.headers.get('cache-control')).toContain('no-store');for(const secret of ['実イベントの名前','実景品の名前','実景品の受け渡し先','実参加者の名前',csrf,channel,e.id,'<form','style=','onclick='])expect(html).not.toContain(secret);
 expect(await eventLotteryView(db,e.id)).toEqual(before);expect(await walletOf(db,id)).toEqual(wallet);expect((await app.request(path+'?screen=demo')).status).not.toBe(200);
});

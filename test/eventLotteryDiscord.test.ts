import {it,expect} from 'vitest';
import {eq} from 'drizzle-orm';
import {eventLotteryNotices} from '../src/db/schema.js';
import {DiscordHttpError,type MessageBody} from '../src/lib/discordRest.js';
import type {Interaction} from 'discord.js';
import {makeDb,cfg,ROLE} from './helpers.js';
import {recordJoin} from '../src/services/members.js';
import {addCoins,walletOf} from '../src/services/economy.js';
import {createEventLottery,changeEventLottery,eventLotteryView,refreshEventLotteryPanel,enterEventLottery,retryEventLotteryNotices} from '../src/services/eventLottery.js';
import {EventLotteryApp} from '../src/discord/eventLottery.js';
it('参加ボタンを本人限定で返答し、連打や別サーバーからの受付で二重徴収しない',async()=>{const {db,close}=await makeDb();try{
 const id='760000000000000001';await recordJoin(db,{id,username:'user',displayName:'参加者',avatarUrl:null,roleIds:[ROLE.guji],isBot:false,joinedAt:new Date()});await addCoins(db,id,1000,'adjust');
 const event=await createEventLottery(db,{name:'イベント',fee:100,channelId:'100000000000000001',resultChannelId:'100000000000000001',prizes:[{name:'賞',count:1,coins:100,item:''}]},'guji');await changeEventLottery(db,event,'guji',0,'open');
 let sends=0,edits=0;const app=new EventLotteryApp(db,()=>cfg,{sendMessage:async()=>{sends++;return {id:'notice'};},editMessage:async(_c,m,b)=>{edits++;expect(m).toBe('notice');expect(b.content).not.toContain('賞');}});const replies:{content:string}[]=[];const defers:unknown[]=[];
 const base={customId:'eventlottery:'+event,guildId:cfg.guildId,isButton:()=>true,inCachedGuild:()=>true,user:{id},member:{displayName:'参加者'},deferReply:async(b:unknown)=>{defers.push(b);},editReply:async(b:{content:string})=>{replies.push(b);}};
 await app.onInteraction(base as unknown as Interaction);await app.onInteraction(base as unknown as Interaction);expect(defers).toHaveLength(2);expect(defers[0]).toEqual({flags:64});expect(replies[0]!.content).toContain('100銭');expect(replies[1]!.content).toContain('参加済み');expect((await walletOf(db,id)).balance).toBe(900);expect((await eventLotteryView(db,event)).participants).toHaveLength(1);
 await app.onInteraction({...base,guildId:'another'} as unknown as Interaction);expect(defers).toHaveLength(2);await app.notify();await refreshEventLotteryPanel(db,event,'guji');await app.notify();expect(sends).toBe(1);expect(edits).toBe(2);
 }finally{close();}});

it('削除した受付投稿は同じイベントで復旧し、応答喪失の再送でも一投稿・一口を保つ',async()=>{
 const {db,close}=await makeDb();try{
  const user='760000000000000001';await recordJoin(db,{id:user,username:'user',displayName:'参加者',avatarUrl:null,roleIds:[ROLE.guji],isBot:false,joinedAt:new Date()});await addCoins(db,user,1000,'adjust');
  const event=await createEventLottery(db,{name:'催し',fee:100,channelId:'100000000000000001',resultChannelId:'100000000000000001',prizes:[{name:'非公開品',count:1,coins:100,item:''}]},'guji');await changeEventLottery(db,event,'guji',0,'open');await enterEventLottery(db,event,user,'参加者');
  await db.update(eventLotteryNotices).set({messageId:'deleted-panel',sentAt:new Date()}).where(eq(eventLotteryNotices.id,'panel:'+event));
  let posts=0,created=0,loseResponse=true;const nonces:string[]=[];const remote=new Map<string,string>();
  const app=new EventLotteryApp(db,()=>cfg,{editMessage:async(_c,m)=>{if(m==='deleted-panel')throw new DiscordHttpError('unknown message',404);expect(m).toBe('restored-panel');},sendMessage:async(_c,b:MessageBody)=>{
   posts++;expect(b.content).toContain('参加費：100銭');expect(b.content).not.toContain('非公開品');expect(JSON.stringify(b.components)).toContain('eventlottery:'+event);expect(b.enforce_nonce).toBe(true);nonces.push(b.nonce!);
   if(!remote.has(b.nonce!)){created++;remote.set(b.nonce!,'restored-panel');}if(loseResponse){loseResponse=false;throw Error('response lost');}return {id:remote.get(b.nonce!)!};
  }});
  await refreshEventLotteryPanel(db,event,'guji');await app.notify();let v=await eventLotteryView(db,event);expect(v.messages[0]!.error).not.toBeNull();expect(v.messages[0]!.messageId).toBe('deleted-panel');
  await retryEventLotteryNotices(db,event,'guji');await app.notify();v=await eventLotteryView(db,event);expect(v.messages[0]!.messageId).toBe('restored-panel');expect(v.messages[0]!.sentAt).not.toBeNull();expect(nonces[0]).toBe(nonces[1]);expect(created).toBe(1);
  await refreshEventLotteryPanel(db,event,'guji');await app.notify();expect(posts).toBe(2);expect(created).toBe(1);expect(await enterEventLottery(db,event,user,'参加者')).toContain('参加済み');expect((await walletOf(db,user)).balance).toBe(900);v=await eventLotteryView(db,event);expect(v.participants).toHaveLength(1);expect(v.collected).toBe(100);expect(v.results).toHaveLength(0);expect(v.event.state).toBe('open');
 }finally{await close();}
});
it('権限不足や通信失敗では削除とみなさず、新しい受付投稿を増やさない',async()=>{
 const {db,close}=await makeDb();try{
  const event=await createEventLottery(db,{name:'催し',fee:100,channelId:'100000000000000001',resultChannelId:'100000000000000001',prizes:[{name:'品物',count:1,coins:0,item:'品物'}]},'guji');await changeEventLottery(db,event,'guji',0,'open');await db.update(eventLotteryNotices).set({messageId:'existing-panel',sentAt:new Date()}).where(eq(eventLotteryNotices.id,'panel:'+event));let posts=0;
  for(const error of [new DiscordHttpError('forbidden',403),new DiscordHttpError('server error',500),new TypeError('offline')]){
   const app=new EventLotteryApp(db,()=>cfg,{sendMessage:async()=>{posts++;return {id:'unexpected'};},editMessage:async()=>{throw error;}});await refreshEventLotteryPanel(db,event,'guji');await app.notify();const v=await eventLotteryView(db,event);expect(v.messages[0]!.messageId).toBe('existing-panel');expect(v.messages[0]!.error).not.toBeNull();
  }
  expect(posts).toBe(0);
 }finally{await close();}
});

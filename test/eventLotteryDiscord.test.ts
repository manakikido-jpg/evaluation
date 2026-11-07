import {it,expect} from 'vitest';
import type {Interaction} from 'discord.js';
import {makeDb,cfg,ROLE} from './helpers.js';
import {recordJoin} from '../src/services/members.js';
import {addCoins,walletOf} from '../src/services/economy.js';
import {createEventLottery,changeEventLottery,eventLotteryView} from '../src/services/eventLottery.js';
import {EventLotteryApp} from '../src/discord/eventLottery.js';
it('参加ボタンを本人限定で返答し、連打や別サーバーからの受付で二重徴収しない',async()=>{const {db,close}=await makeDb();try{
 const id='760000000000000001';await recordJoin(db,{id,username:'user',displayName:'参加者',avatarUrl:null,roleIds:[ROLE.guji],isBot:false,joinedAt:new Date()});await addCoins(db,id,1000,'adjust');
 const event=await createEventLottery(db,{name:'イベント',fee:100,channelId:'100000000000000001',resultChannelId:'100000000000000001',prizes:[{name:'賞',count:1,coins:100,item:''}]},'guji');await changeEventLottery(db,event,'guji',0,'open');
 const app=new EventLotteryApp(db,()=>cfg,{sendMessage:async()=>({id:'notice'})});const replies:{content:string}[]=[];const defers:unknown[]=[];
 const base={customId:'eventlottery:'+event,guildId:cfg.guildId,isButton:()=>true,inCachedGuild:()=>true,user:{id},member:{displayName:'参加者'},deferReply:async(b:unknown)=>{defers.push(b);},editReply:async(b:{content:string})=>{replies.push(b);}};
 await app.onInteraction(base as unknown as Interaction);await app.onInteraction(base as unknown as Interaction);expect(defers).toHaveLength(2);expect(defers[0]).toEqual({flags:64});expect(replies[0]!.content).toContain('100銭');expect(replies[1]!.content).toContain('参加済み');expect((await walletOf(db,id)).balance).toBe(900);expect((await eventLotteryView(db,event)).participants).toHaveLength(1);
 await app.onInteraction({...base,guildId:'another'} as unknown as Interaction);expect(defers).toHaveLength(2);
 }finally{close();}});

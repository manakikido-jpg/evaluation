import { randomUUID } from 'node:crypto';
import { ChannelType,Collection,MessageFlags } from 'discord.js';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { marketListings,marketOrders,marketWebActions,members } from '../src/db/schema.js';
import { MarketApp } from '../src/discord/market.js';
import { panelMessage } from '../src/discord/panels.js';
import type { DiscordActions } from '../src/lib/discordRest.js';
import { createListing } from '../src/services/market.js';
import { executeMarketWeb } from '../src/services/marketWeb.js';
import { walletOf,addCoins } from '../src/services/economy.js';
import { peekLoginLink } from '../src/services/casino/loginLinks.js';
import { cfg as base,makeDb } from './helpers.js';
const A='700000000000000001',B='700000000000000002',ROLE='710000000000000001',CHANNEL='720000000000000001',BOT='790000000000000001';
const cfg={...base,channels:{...base.channels,market:CHANNEL},roles:{...base.roles,merchant:ROLE}},now=new Date('2026-10-25T12:00:00+09:00');
let db:Db,close:()=>Promise<void>,app:MarketApp,guild:any,channel:any,threads:Map<string,any>,messages:any[],failMember:boolean,dm:ReturnType<typeof vi.fn>,created:ReturnType<typeof vi.fn>;
beforeEach(async()=>{
 ({db,close}=await makeDb());await db.insert(members).values([A,B].map(id=>({id,username:id,displayName:id,ageGroup:'adult'})));await addCoins(db,B,5000,'admin_grant');
 threads=new Map();messages=[];failMember=false;dm=vi.fn().mockResolvedValue(true);
 const send=vi.fn(async(body:any)=>{const id=String(messages.length+1);messages.push({id,body});return {id};});
 created=vi.fn(async(options:any)=>{const id=String(730000000000000000n+BigInt(threads.size+1));const thread={id,name:options.name,type:options.type,ownerId:BOT,isSendable:()=>true,isThread:()=>true,members:{add:vi.fn(async(user:string)=>{if(failMember&&user===B)throw new Error('Missing Permissions');})},send};threads.set(id,thread);guild.channels.cache.set(id,thread);return thread;});
 channel={id:CHANNEL,name:'市場',type:ChannelType.GuildText,isTextBased:()=>true,isSendable:()=>true,send,messages:{edit:vi.fn(async()=>({})),fetch:async()=>new Collection()},threads:{create:created,fetchActive:async()=>({threads:new Collection([...threads])})}};
 guild={id:cfg.guildId,client:{user:{id:BOT}},channels:{cache:new Collection([[CHANNEL,channel]]),fetch:async(id:string)=>id===CHANNEL?channel:threads.get(id)}};
 app=new MarketApp(db,()=>cfg,{sendDm:dm,sendMessage:async()=>({id:'log'})} as unknown as DiscordActions,'https://test.example');app.attach(guild);
});
afterEach(async()=>close());
const command=(user:string,action:string,id:number,b:Record<string,string>={})=>executeMarketWeb(db,cfg,{id:user,roleIds:user===A?[ROLE]:[]},action,id,{nonce:randomUUID(),...b},now);
async function order(){const l=await createListing(db,cfg,{id:A,roleIds:[ROLE]},{category:'illust',title:'見本',description:'説明',price:1000});if(l.status!=='ok')throw new Error(l.status);const path=await command(B,'listing-buy',l.listing.id,{quote:'1000',feePercent:'10',days:'7',confirm:'yes'});return Number(path.split('/').at(-1));}
it('Web出品を市場に1回だけ掲載し、投稿番号と同期済みを保存する',async()=>{
 await command(A,'listing-new',0,{category:'illust',title:'Webで作った出品',price:'1000',capacity:'0'});
 await app.syncWebUpdates(now);expect(messages).toHaveLength(1);
 expect((await db.select().from(marketListings))[0]).toMatchObject({channelId:CHANNEL,messageId:'1'});
 expect(messages[0].body.allowedMentions).toEqual({parse:[]});
 expect((await db.select().from(marketWebActions))[0]?.syncStatus).toBe('done');
 await app.syncWebUpdates(now);expect(messages).toHaveLength(1);
});
it('📷 Web出品の見本の写真を、市場のカードに一緒に上げる',async()=>{
 const png=new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,13,0x49,0x48,0x44,0x52]);
 await executeMarketWeb(db,cfg,{id:A,roleIds:[ROLE]},'listing-new',0,{nonce:randomUUID(),category:'photo',title:'写真',price:'500',capacity:'0'},now,{type:'image/png',data:png});
 await app.syncWebUpdates(now);expect(messages).toHaveLength(1);
 expect(messages[0].body.files[0].name).toMatch(/^listing-\d+\.png$/);
 expect(JSON.stringify(messages[0].body.embeds)).toContain('attachment://listing-');
 expect((await db.select().from(marketListings))[0]?.imageUrl).toMatch(/^attachment:\/\/listing-/);
});
it('Web購入から非公開スレッドを作り、当事者だけを追加。同期を再実行しても再購入しない',async()=>{
 const id=await order();await app.syncWebUpdates(now);
 expect(created).toHaveBeenCalledOnce();expect(created.mock.calls[0]![0]).toMatchObject({type:ChannelType.PrivateThread,invitable:false});
 const [o]=await db.select().from(marketOrders).where(eq(marketOrders.id,id));const thread=threads.get(o!.threadId!)!;
 expect(thread.members.add.mock.calls.map((c:any)=>c[0])).toEqual([B,A]);
 expect((await walletOf(db,B)).balance).toBe(4000);expect(dm).toHaveBeenCalledOnce();
 await app.syncWebUpdates(now);expect(created).toHaveBeenCalledOnce();expect((await walletOf(db,B)).balance).toBe(4000);
});
it('メンバー追加が失敗してもスレッド番号を保持し、再試行で同じスレッドを完成させる',async()=>{
 const id=await order();failMember=true;await app.syncWebUpdates(now);
 const [o]=await db.select().from(marketOrders).where(eq(marketOrders.id,id));expect(o?.threadId).toBeTruthy();
 expect((await db.select().from(marketWebActions))[0]?.syncStatus).toBe('pending');
 failMember=false;await app.syncWebUpdates(now);expect(created).toHaveBeenCalledOnce();
 expect((await db.select().from(marketWebActions))[0]?.syncStatus).toBe('done');expect((await walletOf(db,B)).balance).toBe(4000);
});
it('市場パネルのWebボタンは本人だけに一度きりの入口を発行する',async()=>{
 expect(JSON.stringify(panelMessage('market'))).toContain('market:web');
 const i={customId:'market:web',guildId:cfg.guildId,user:{id:B,displayAvatarURL:()=>null},member:{displayName:'買い手'},inCachedGuild:()=>true,isChatInputCommand:()=>false,isButton:()=>true,isModalSubmit:()=>false,deferReply:vi.fn(),editReply:vi.fn(),reply:vi.fn(),isRepliable:()=>true};
 await app.onInteraction(i as never);expect(i.deferReply).toHaveBeenCalledWith({flags:MessageFlags.Ephemeral});
 const view=i.editReply.mock.calls[0]![0];const url=new URL(view.components[0].components[0].url);expect(url.pathname).toContain('/marketplace/link/');
 expect((await peekLoginLink(db,url.pathname.split('/').at(-1)!))?.id).toBe(B);
});
it('出品者のページのボタンと /市場 は、出品者のページへのリンクを出す',async()=>{
 expect(JSON.stringify(panelMessage('market'))).toContain('market:seller');
 const i={customId:'market:seller',guildId:cfg.guildId,user:{id:B,displayAvatarURL:()=>null},member:{displayName:'売り手'},inCachedGuild:()=>true,isChatInputCommand:()=>false,isButton:()=>true,isModalSubmit:()=>false,deferReply:vi.fn(),editReply:vi.fn(),reply:vi.fn(),isRepliable:()=>true};
 await app.onInteraction(i as never);
 const url=new URL(i.editReply.mock.calls[0]![0].components[0].components[0].url);expect(url.searchParams.get('next')).toBe('/marketplace/seller');
 const cmd={commandName:'ichiba',guildId:cfg.guildId,user:{id:B,displayAvatarURL:()=>null},member:{displayName:'売り手'},options:{getString:()=>null},inCachedGuild:()=>true,isChatInputCommand:()=>true,isButton:()=>false,isModalSubmit:()=>false,deferReply:vi.fn(),editReply:vi.fn(),reply:vi.fn()};
 await app.onInteraction(cmd as never);
 const top=new URL(cmd.editReply.mock.calls[0]![0].components[0].components[0].url);expect(top.searchParams.get('next')).toBeNull();
});

import {afterEach,beforeEach,expect,it} from 'vitest';
import {eq} from 'drizzle-orm';
import {cfg as base,makeDb} from './helpers.js';
import type {Db} from '../src/db/client.js';
import type {GuildConfig} from '../src/config.js';
import {members,tempVoice,coinTx} from '../src/db/schema.js';
import {addCoins,walletOf} from '../src/services/economy.js';
import {addTickets} from '../src/services/tickets.js';
import {roomAmountAt,roomAmountLabel,roomRateAt} from '../src/services/roomPricing.js';
import {startRoom,changeRoomKind,payEntry,hourlyPerPerson,roomPrice} from '../src/services/rooms.js';
import {createStayRoom,cleanupRooms,stayDayPrice,extendStayRoom,STAY_MS,type VoiceOps} from '../src/services/tempVoice.js';
import {stayRoomPanel} from '../src/discord/tempVoice.js';
import {coreTimeNoticeMessage} from '../src/services/coreTime.js';
import {applyOverrides,overridesSchema} from '../src/services/settings.js';
const OWNER='830000000000000001',FRIEND='830000000000000002',HUB='960000000000000001',HOURLY='960000000000000002',ROOM='961000000000000001';
const CORE=new Date('2026-11-13T12:00:00Z'),END=new Date('2026-11-13T14:00:00Z'),BEFORE=new Date(+CORE-1),at=(mins:number)=>new Date(+CORE+mins*60000);
const cfg:GuildConfig={...base,coreTime:{...base.coreTime,slots:[{day:5,start:'21:00',end:'23:00'}]},rooms:{...base.rooms,coreTimeMultiplier:3,once:{public:50,invite:200,secret:300},hourly:{public:100,invite:200,secret:300}},tempVoice:{hubs:[{channelId:HUB,name:'宿坊',plan:'once'},{channelId:HOURLY,name:'宵宮',plan:'hourly'}]}};
let db:Db,close:()=>Promise<void>;
beforeEach(async()=>{({db,close}=await makeDb());for(const id of [OWNER,FRIEND])await addCoins(db,id,100000,'adjust');});afterEach(async()=>close());
const open=(hubId:string)=>db.insert(tempVoice).values({channelId:ROOM,hubId,ownerId:OWNER,createdAt:CORE});
function fake(){let seq=0;const removed:string[]=[];const ops:VoiceOps={create:async()=>String(++seq),move:async()=>{},remove:async id=>{removed.push(id)},occupancy:()=>1};return{ops,removed,db,cfg};}
it('日本時間の開始を含み終了を含まない。通常時/枠なし/VIP/0銭は維持する',()=>{
 expect(roomRateAt(cfg,BEFORE)).toBe(1);expect(roomRateAt(cfg,CORE)).toBe(3);expect(roomRateAt(cfg,new Date(+END-1))).toBe(3);expect(roomRateAt(cfg,END)).toBe(1);
 expect(roomPrice(cfg,'once','public',CORE)).toBe(150);expect(roomPrice(cfg,'hourly','invite',CORE)).toBe(600);expect(roomPrice(cfg,'free','secret',CORE)).toBe(0);expect(roomPrice(cfg,'none','secret',CORE)).toBe(0);expect(roomAmountAt(cfg,0,CORE)).toBe(0);
 expect(roomAmountAt({...cfg,coreTime:{...cfg.coreTime,slots:[]}},100,CORE)).toBe(100);
});
it('宿坊の開始と種類の差額に同じ3倍を使う',async()=>{
 await open(HUB);expect(await startRoom(db,cfg,ROOM,CORE)).toMatchObject({charged:150});expect(await changeRoomKind(db,cfg,ROOM,'invite',CORE)).toMatchObject({charged:450});expect((await walletOf(db,OWNER)).balance).toBe(99400);
});
it('宵宮の払い済み分は値上げせず、次の更新から3倍。終了後は通常へ戻り、同時更新も1回',async()=>{
 await open(HOURLY);expect(await payEntry(db,cfg,ROOM,OWNER,at(-30))).toMatchObject({charged:100});const present=[{channelId:ROOM,memberIds:[OWNER]}];expect(await hourlyPerPerson(db,cfg,present,CORE)).toEqual([]);expect(await payEntry(db,cfg,ROOM,OWNER,CORE)).toEqual({status:'already',charged:0});
 const results=await Promise.all([hourlyPerPerson(db,cfg,present,at(30)),hourlyPerPerson(db,cfg,present,at(30))]);expect(results.flat().filter(r=>r.action==='paid')).toHaveLength(1);expect((await walletOf(db,OWNER)).balance).toBe(99600);
 expect(await hourlyPerPerson(db,cfg,present,END)).toMatchObject([{action:'paid',charged:100}]);expect((await walletOf(db,OWNER)).balance).toBe(99500);
});
it('奉納割引と半額券は3倍後に適用し、無料特典も維持する',async()=>{
 await open(HOURLY);await db.insert(members).values({id:OWNER,username:'fixture',displayName:'確認用',boostingSince:CORE});
 const half={...cfg,rooms:{...cfg.rooms,boosterDiscountPercent:50}};await addTickets(db,OWNER,'room_half_public',1);expect(await payEntry(db,half,ROOM,OWNER,CORE)).toMatchObject({charged:75,ticketKind:'room_half_public'});
 expect(await payEntry(db,cfg,ROOM,OWNER,at(60))).toEqual({status:'free',charged:0});expect((await walletOf(db,OWNER)).balance).toBe(99925);
});
it('無料券はコアタイムにも使え、半額券は端数を切り上げる',async()=>{
 await open(HOURLY);await addTickets(db,OWNER,'room_free_public',1);expect(await payEntry(db,cfg,ROOM,OWNER,CORE)).toMatchObject({charged:0,ticket:true});
 await addTickets(db,FRIEND,'room_half_public',1);expect(await payEntry(db,{...cfg,rooms:{...cfg.rooms,hourly:{...cfg.rooms.hourly,public:101}}},ROOM,FRIEND,CORE)).toMatchObject({charged:152});
});
it('購入宿の24時間/時間制の作成と時間更新に3倍を適用し、コアタイム終了後に戻す',async()=>{
 const ctx=fake();const day=await createStayRoom(ctx,{hubId:HUB,userId:OWNER,displayName:'確認'},CORE),hour=await createStayRoom(ctx,{hubId:HUB,userId:FRIEND,displayName:'確認',mode:'hourly'},CORE);expect(day).toMatchObject({status:'created',charged:9000});expect(hour).toMatchObject({status:'created',charged:900});
 await Promise.all([cleanupRooms(ctx,at(60)),cleanupRooms(ctx,at(60))]);expect((await walletOf(db,FRIEND)).balance).toBe(98200);await cleanupRooms(ctx,END);expect((await walletOf(db,FRIEND)).balance).toBe(97900);
});
it('1日延長の確認後にコアタイムへ入ったら料金変更として断り、同じ確認で二重延長しない',async()=>{
 const due=new Date(+CORE+STAY_MS);await db.insert(tempVoice).values({channelId:ROOM,hubId:HUB,ownerId:OWNER,keepUntil:due,createdAt:BEFORE});const input={channelId:ROOM,userId:OWNER,expectedUntil:+due,expectedPrice:await stayDayPrice(db,cfg,OWNER,BEFORE)};
 expect(input.expectedPrice).toBe(3000);expect(await extendStayRoom(db,cfg,input,CORE)).toEqual({status:'changed'});expect((await walletOf(db,OWNER)).balance).toBe(100000);
 const confirmed={...input,expectedPrice:9000};const r=await Promise.all([extendStayRoom(db,cfg,confirmed,CORE),extendStayRoom(db,cfg,confirmed,CORE)]);expect(r.filter(v=>v.status==='ok')).toHaveLength(1);expect((await walletOf(db,OWNER)).balance).toBe(91000);
});
it('3倍の残高が足りなければ徴収せず、購入宿も残さない',async()=>{
 const poor='830000000000000003';await addCoins(db,poor,8999,'adjust');const ctx=fake();expect(await createStayRoom(ctx,{hubId:HUB,userId:poor,displayName:'確認'},CORE)).toEqual({status:'insufficient',price:9000});expect(ctx.removed).toHaveLength(1);expect(await db.select().from(tempVoice)).toHaveLength(0);expect((await walletOf(db,poor)).balance).toBe(8999);expect(await db.select().from(coinTx).where(eq(coinTx.reason,'room'))).toHaveLength(0);
});
it('設定の既定3倍・任意倍率・1倍と、通常/コアタイム両方の案内を確認する',()=>{
 expect(base.rooms.coreTimeMultiplier).toBe(3);const changed=applyOverrides(cfg,overridesSchema.parse({rooms:{coreTimeMultiplier:5}}));expect(roomAmountAt(changed,100,CORE)).toBe(500);expect(applyOverrides(changed,overridesSchema.parse({rooms:{stayPrice:100}})).rooms.coreTimeMultiplier).toBe(5);expect(roomAmountAt(applyOverrides(cfg,overridesSchema.parse({rooms:{coreTimeMultiplier:1}})),100,CORE)).toBe(100);expect(overridesSchema.safeParse({rooms:{coreTimeMultiplier:0}}).success).toBe(false);
 expect(roomAmountLabel(cfg,300)).toContain('900');const panel=stayRoomPanel(cfg);expect(JSON.stringify(panel)).toContain('9,000');expect(JSON.stringify(panel)).toContain('コアタイム');for(const row of (JSON.parse(JSON.stringify(panel)) as {components:{components:{label?:string}[]}[]}).components)for(const c of row.components)if(c.label)expect(c.label.length).toBeLessThanOrEqual(80);
 const notice=coreTimeNoticeMessage({key:'test',kind:'soon',at:CORE,slot:cfg.coreTime.slots[0]!,date:'2026-11-13'},cfg);expect(JSON.stringify(notice)).toContain('3倍');
});

it('通常時間に払い済みの公開宿をそのまま選んでも、コアタイム差額を遡って取らない',async()=>{
 await open(HUB);expect(await startRoom(db,cfg,ROOM,BEFORE)).toMatchObject({charged:50});expect(await changeRoomKind(db,cfg,ROOM,'public',CORE)).toEqual({status:'ok',charged:0});expect((await walletOf(db,OWNER)).balance).toBe(99950);
});

it('割増のない古いパネルは先に案内を更新し、押し直したときだけ購入して実際の料金を返す',async()=>{
 const {Collection}=await import('discord.js'),{onStayRoomInteraction}=await import('../src/discord/tempVoice.js'),{vi}=await import('vitest');
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(CORE);
 try{
  const bot='830000000000000099',openStay=vi.fn(async()=>({status:'created',channelId:ROOM,keepUntil:at(60),charged:900})),replies:unknown[]=[];
  const message={flags:{has:()=>false},author:{id:bot},embeds:[{description:'**3,000 銭**'},{description:'**300 銭／1時間**'}],edit:vi.fn(async(p:{embeds:typeof message.embeds})=>{message.embeds=p.embeds;})};
  const i={inCachedGuild:()=>true,guildId:cfg.guildId,isChatInputCommand:()=>false,isButton:()=>true,customId:'stayroom:hourly',guild:{channels:{cache:new Collection([[HUB,{permissionsFor:()=>({has:()=>true})}]])}},member:{roles:{cache:new Collection()},displayName:'確認用'},user:{id:OWNER},client:{user:{id:bot}},message,deferReply:async()=>{},editReply:async(p:unknown)=>{replies.push(p)}};
  await onStayRoomInteraction({openStay}as never,()=>cfg,i as never);expect(openStay).not.toHaveBeenCalled();expect(String(replies.at(-1))).toContain('もう一度');
  await onStayRoomInteraction({openStay}as never,()=>cfg,i as never);expect(openStay).toHaveBeenCalledTimes(1);expect(JSON.stringify(replies.at(-1))).toContain('900');
 }finally{vi.useRealTimers();}
});

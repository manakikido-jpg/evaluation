import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { castSessions, members } from '../src/db/schema.js';
import { CastApp } from '../src/discord/cast.js';
import { CAST_DEFAULTS, saveCastConfig, loadCastConfig, saveReservationHub, getSession } from '../src/services/cast.js';
import { cfg, makeDb } from './helpers.js';
const MALE='990000000000000001',FEMALE='990000000000000002',HUB='990000000000000003',CAST='880000000000000001',CUSTOMER='880000000000000002',BOT='880000000000000003';
let db:Db, close:()=>Promise<void>;
beforeEach(async()=>{({db,close}=await makeDb());});
afterEach(async()=>{vi.useRealTimers();await close();});
async function session(){
 return (await db.insert(castSessions).values({castId:CAST,customerId:CUSTOMER,plan:'30',minutes:30,price:300,status:'reserved',startAt:new Date('2026-10-21T13:00:00Z')}).returning())[0]!;
}
function fixture(allowed=true){
 const add=vi.fn(async()=>undefined),remove=vi.fn(async()=>undefined);
 const threadCreate=vi.fn(async()=>({id:'990000000000000004',members:{add},delete:remove}));
 const hub={id:HUB,type:ChannelType.GuildText,threads:{create:threadCreate},permissionsFor:vi.fn(()=>({has:()=>allowed})),delete:vi.fn(async()=>undefined)};
 const cache=new Map<string,unknown>([[MALE,{id:MALE,type:ChannelType.GuildText,parentId:'990000000000000009',threads:{create:vi.fn()}}],[FEMALE,{id:FEMALE,type:ChannelType.GuildText,threads:{create:vi.fn()}}]]);
 const create=vi.fn(async()=>{cache.set(HUB,hub);return hub;});
 const guild={id:cfg.guildId,channels:{cache,fetch:vi.fn(async(id:string)=>cache.get(id)??null),create},members:{me:{id:BOT},fetch:vi.fn(async(id:string)=>({id}))}};
 const app=new CastApp(db,()=>cfg,{sendDm:vi.fn(async()=>true)} as never);app.attach(guild as never);
 return {hub,cache,create,threadCreate,add,remove,guild,app:app as unknown as {openThread(s:typeof castSessions.$inferSelect,name:string):Promise<{id:string}|undefined>;proposeAccept(i:unknown,id:number,at:number):Promise<void>}};
}
it('初回に男女共通のテキスト窓口を1つ作り、同時予約にも共有する',async()=>{
 await saveCastConfig(db,{...CAST_DEFAULTS,channelId:MALE,femaleChannelId:FEMALE},'staff');
 await db.insert(members).values({id:CAST,username:'cast',displayName:'桜ねこ'});
 const f=fixture(),s=await session(),second=await session();
 await Promise.all([f.app.openThread(s,'予約'),f.app.openThread(second,'予約')]);
 expect(f.create).toHaveBeenCalledOnce();expect((await loadCastConfig(db)).reservationChannelId).toBe(HUB);
 const request=f.create.mock.calls[0] as unknown as [{type:number;name:string;permissionOverwrites:{id:string;allow:bigint;deny?:bigint}[]}];
 expect(request[0]).toMatchObject({type:ChannelType.GuildText,name:'📅 キャスト予約'});
 const all=request[0].permissionOverwrites.find(p=>p.id===cfg.guildId)!;
 expect(all.allow & PermissionFlagsBits.SendMessagesInThreads).toBe(PermissionFlagsBits.SendMessagesInThreads);
 expect(all.deny! & PermissionFlagsBits.ManageThreads).toBe(PermissionFlagsBits.ManageThreads);
 expect(all.deny! & PermissionFlagsBits.CreatePublicThreads).toBe(PermissionFlagsBits.CreatePublicThreads);
 expect(f.threadCreate).toHaveBeenCalledWith(expect.objectContaining({name:`📅 予約｜桜ねこ｜10/21 22:00｜#${s.id}`,type:ChannelType.PrivateThread,invitable:false}));
 expect((await getSession(db,s.id))?.threadId).toBe('990000000000000004');
});
it('設定した予約先を使い、男女の一覧や既存の予約は変更しない',async()=>{
 await saveCastConfig(db,{...CAST_DEFAULTS,channelId:MALE,femaleChannelId:FEMALE,reservationChannelId:HUB},'staff');
 const f=fixture();f.cache.set(HUB,f.hub);const s=await session();
 await f.app.openThread(s,'📦 納品');expect(f.create).not.toHaveBeenCalled();expect(f.threadCreate).toHaveBeenCalledOnce();
 expect(f.threadCreate).toHaveBeenCalledWith(expect.objectContaining({name:expect.stringContaining('📦 納品｜')}));
 expect((await loadCastConfig(db)).channelId).toBe(MALE);
});
it('親を参加者が見られなければ作らず、一覧への代替作成もしない',async()=>{
 await saveCastConfig(db,{...CAST_DEFAULTS,channelId:MALE,reservationChannelId:HUB},'staff');
 const f=fixture(false);f.cache.set(HUB,f.hub);
 expect(await f.app.openThread(await session(),'予約')).toBeUndefined();expect(f.threadCreate).not.toHaveBeenCalled();expect(f.create).not.toHaveBeenCalled();
});
it('参加者の追加に失敗したお部屋は削除し、予約先を記録しない',async()=>{
 await saveCastConfig(db,{...CAST_DEFAULTS,reservationChannelId:HUB},'staff');
 const f=fixture();f.cache.set(HUB,f.hub);f.add.mockRejectedValueOnce(Error('join failed'));
 const s=await session();expect(await f.app.openThread(s,'予約')).toBeUndefined();expect(f.remove).toHaveBeenCalledOnce();expect((await getSession(db,s.id))?.threadId).toBeNull();
});
it('設定先が消えた場合やテキスト以外の場合は一覧へ戻さない',async()=>{
 await saveCastConfig(db,{...CAST_DEFAULTS,channelId:MALE,reservationChannelId:HUB},'staff');
 const f=fixture(),s=await session();expect(await f.app.openThread(s,'予約')).toBeUndefined();
 f.cache.set(HUB,{id:HUB,type:ChannelType.GuildForum});expect(await f.app.openThread(s,'予約')).toBeUndefined();expect(f.create).not.toHaveBeenCalled();
});
it('自動保存は同時に変更した料金設定や運営の指定先を上書きしない',async()=>{
 await saveCastConfig(db,{...CAST_DEFAULTS,feePercent:20,channelId:MALE},'staff');
 expect(await saveReservationHub(db,HUB)).toBe(HUB);expect(await loadCastConfig(db)).toMatchObject({feePercent:20,channelId:MALE,reservationChannelId:HUB});
 await saveCastConfig(db,{...(await loadCastConfig(db)),reservationChannelId:FEMALE},'staff');
 expect(await saveReservationHub(db,HUB)).toBe(FEMALE);
});

it('日時の変更が確定すると、スレッド名も新しい日本時間に合わせる',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
 const f=fixture(),s=await session();
 const setName=vi.fn(async()=>undefined);const id='990000000000000004';
 f.cache.set(id,{id,isThread:()=>true,setName});
 await db.update(castSessions).set({threadId:id}).where(eq(castSessions.id,s.id));
 await f.app.proposeAccept({user:{id:CUSTOMER},deferReply:vi.fn(),editReply:vi.fn()},s.id,new Date('2026-10-21T14:00:00Z').getTime()/1000);
 expect(setName).toHaveBeenCalledWith(`📅 予約｜キャスト｜10/21 23:00｜#${s.id}`);
});
it('窓口の作成権限がなければ公開や一覧へ切り替えない',async()=>{
 await saveCastConfig(db,{...CAST_DEFAULTS,channelId:MALE},'staff');
 const f=fixture();f.create.mockRejectedValueOnce(Error('Missing Permissions'));
 const s=await session();expect(await f.app.openThread(s,'予約')).toBeUndefined();
 expect(f.threadCreate).not.toHaveBeenCalled();expect((await loadCastConfig(db)).reservationChannelId).toBeUndefined();expect((await getSession(db,s.id))?.threadId).toBeNull();
});

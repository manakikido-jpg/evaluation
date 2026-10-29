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
 const app=new CastApp(db,()=>cfg,{sendDm:vi.fn(async()=>true),sendMessage:vi.fn(async()=>({id:'notice'}))} as never);app.attach(guild as never);
 return {hub,cache,create,threadCreate,add,remove,guild,app:app as unknown as {openThread(s:typeof castSessions.$inferSelect,name:string):Promise<{id:string}|undefined>;proposeAccept(i:unknown,proposalId:string):Promise<void>}};
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
it('📦 納品のスレッド名には、何を買ったか（メニューの名前）を出す',async()=>{
 await saveCastConfig(db,{...CAST_DEFAULTS,channelId:MALE,reservationChannelId:HUB},'staff');
 const f=fixture();f.cache.set(HUB,f.hub);
 const [s]=await db.insert(castSessions).values({castId:CAST,customerId:CUSTOMER,plan:'1',menuName:'ボイス<@x>',minutes:0,price:300,status:'ordered'}).returning();
 await f.app.openThread(s!,'📦 納品');
 expect(f.threadCreate).toHaveBeenCalledWith(expect.objectContaining({name:`📦 納品｜キャスト｜ボイスx｜#${s!.id}`}));
});
it('設定した予約先を使い、男女の一覧や既存の予約は変更しない',async()=>{
 await saveCastConfig(db,{...CAST_DEFAULTS,channelId:MALE,femaleChannelId:FEMALE,reservationChannelId:HUB},'staff');
 const f=fixture();f.cache.set(HUB,f.hub);const s=await session();
 await f.app.openThread(s,'📦 納品');expect(f.create).not.toHaveBeenCalled();expect(f.threadCreate).toHaveBeenCalledOnce();
 expect(f.threadCreate).toHaveBeenCalledWith(expect.objectContaining({name:expect.stringContaining('📦 納品｜')}));
 expect((await loadCastConfig(db)).channelId).toBe(MALE);
});
it('前に作った窓口の「スレッドの管理」を、宮司・神職と BOT のほかから外す（1回だけ）',async()=>{
 await saveCastConfig(db,{...CAST_DEFAULTS,channelId:MALE,reservationChannelId:HUB},'staff');
 const c={...cfg,admin:{...cfg.admin,gujiRoleIds:['770000000000000001'],shinshokuRoleIds:['770000000000000002']}} as typeof cfg;
 const edit=vi.fn(async()=>undefined);
 const ow=(id:string,manage:boolean)=>({id,allow:{has:(b:bigint)=>manage&&b===PermissionFlagsBits.ManageThreads}});
 const f=fixture();(f.hub as Record<string,unknown>).permissionOverwrites={edit,cache:new Map([['770000000000000001',ow('770000000000000001',true)],['770000000000000002',ow('770000000000000002',true)],['770000000000000003',ow('770000000000000003',true)],['770000000000000004',ow('770000000000000004',false)],[BOT,ow(BOT,true)]])};
 f.cache.set(HUB,f.hub);
 const app=new CastApp(db,()=>c,{sendDm:vi.fn(async()=>true),sendMessage:vi.fn(async()=>({id:'n'}))} as never);app.attach(f.guild as never);
 const a=app as unknown as {openThread(s:unknown,n:string):Promise<unknown>};
 await a.openThread(await session(),'予約');await a.openThread(await session(),'予約');
 expect(edit).toHaveBeenCalledOnce();expect(edit).toHaveBeenCalledWith('770000000000000003',{ManageThreads:null},expect.anything());
});
it('新しく作る窓口では、役職のロールに「スレッドの管理」を付けない',async()=>{
 await saveCastConfig(db,{...CAST_DEFAULTS,channelId:MALE},'staff');
 const f=fixture();await f.app.openThread(await session(),'予約');
 const req=f.create.mock.calls[0] as unknown as [{permissionOverwrites:{id:string;allow:bigint}[]}];
 const ranks=cfg.ranks.filter(r=>!r.auto).map(r=>r.roleId).filter(id=>!(cfg.admin?.gujiRoleIds??[]).includes(id)&&!(cfg.admin?.shinshokuRoleIds??[]).includes(id));
 expect(ranks.length).toBeGreaterThan(0);
 for(const id of ranks)expect(req[0].permissionOverwrites.find(p=>p.id===id)!.allow & PermissionFlagsBits.ManageThreads).toBe(0n);
});
const menuCreate=(f:ReturnType<typeof fixture>)=>(f.cache.get(MALE) as {threads:{create:ReturnType<typeof vi.fn>}}).threads.create;
it('親を参加者が見られなければ窓口には作らず、前と同じ一覧のチャンネルに非公開で作る（公開にはしない）',async()=>{
 await saveCastConfig(db,{...CAST_DEFAULTS,channelId:MALE,reservationChannelId:HUB},'staff');
 const f=fixture(false);f.cache.set(HUB,f.hub);
 await f.app.openThread(await session(),'予約');expect(f.threadCreate).not.toHaveBeenCalled();expect(f.create).not.toHaveBeenCalled();
 expect(menuCreate(f)).toHaveBeenCalledWith(expect.objectContaining({type:ChannelType.PrivateThread,invitable:false}));
});
it('参加者の追加に失敗したお部屋は削除し、予約先を記録しない',async()=>{
 await saveCastConfig(db,{...CAST_DEFAULTS,reservationChannelId:HUB},'staff');
 const f=fixture();f.cache.set(HUB,f.hub);f.add.mockRejectedValueOnce(Error('join failed'));
 const s=await session();expect(await f.app.openThread(s,'予約')).toBeUndefined();expect(f.remove).toHaveBeenCalledOnce();expect((await getSession(db,s.id))?.threadId).toBeNull();
});
it('設定先が消えた場合やテキスト以外の場合は、前と同じ一覧のチャンネルに非公開で作る（窓口は勝手に作り直さない）',async()=>{
 await saveCastConfig(db,{...CAST_DEFAULTS,channelId:MALE,reservationChannelId:HUB},'staff');
 const f=fixture(),s=await session();await f.app.openThread(s,'予約');
 f.cache.set(HUB,{id:HUB,type:ChannelType.GuildForum});await f.app.openThread(s,'予約');expect(f.create).not.toHaveBeenCalled();
 expect(menuCreate(f)).toHaveBeenCalledTimes(2);expect(menuCreate(f)).toHaveBeenCalledWith(expect.objectContaining({type:ChannelType.PrivateThread,invitable:false}));
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
 const { proposeSessionTime } = await import('../src/services/cast.js');
 const proposal = await proposeSessionTime(db,s.id,CAST,new Date('2026-10-21T14:00:00Z'));
 if(proposal.status !== 'ok') throw Error(proposal.status);
 await f.app.proposeAccept({user:{id:CUSTOMER},deferReply:vi.fn(),editReply:vi.fn()},proposal.proposal.id);
 expect(setName).toHaveBeenCalledWith(`✅ 確定｜キャスト｜10/21 23:00｜#${s.id}`);
});
it('窓口の作成権限がなければ、公開にはせず、前と同じ一覧のチャンネルに非公開で作って運営の記録に理由を知らせる',async()=>{
 await saveCastConfig(db,{...CAST_DEFAULTS,channelId:MALE},'staff');
 const f=fixture();f.create.mockRejectedValueOnce(Error('Missing Permissions'));
 const madeThread={id:'990000000000000005',members:{add:vi.fn(async()=>undefined)},delete:vi.fn()};
 menuCreate(f).mockResolvedValueOnce(madeThread);
 const s=await session();expect(await f.app.openThread(s,'予約')).toBe(madeThread);
 expect(f.threadCreate).not.toHaveBeenCalled();expect((await loadCastConfig(db)).reservationChannelId).toBeUndefined();
 expect(menuCreate(f)).toHaveBeenCalledWith(expect.objectContaining({type:ChannelType.PrivateThread,invitable:false}));
 expect((await getSession(db,s.id))?.threadId).toBe('990000000000000005');
 const sent=(f.app as unknown as {discord:{sendMessage:ReturnType<typeof vi.fn>}}).discord.sendMessage;
 if(cfg.channels.log) expect(JSON.stringify(sent.mock.calls)).toContain('理由');
});

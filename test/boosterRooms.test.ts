import { Collection } from 'discord.js';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/db/client.js';
import { members, tempVoice } from '../src/db/schema.js';
import { RoomApp } from '../src/discord/rooms.js';
import { TempVoiceApp } from '../src/discord/tempVoice.js';
import { canUseRoomFeatures, casinoRoleLimit, meetsUjiko, setPerkUjiko } from '../src/services/perkGate.js';
import { setEmaPromotion } from '../src/services/emaPromotion.js';
import { resetAllShuin } from '../src/services/shuin.js';
import { roomOf } from '../src/services/rooms.js';
import type { VoiceOps } from '../src/services/tempVoice.js';
import { cfg as base, makeDb, ROLE } from './helpers.js';

const OWNER='961000000000000001', BOOST='961000000000000002', OTHER='961000000000000003', UJIKO='961000000000000004';
const HUB='961000000000000005', ROOM='961000000000000006';
const cfg={...base,coreTime:{...base.coreTime,slots:[]},tempVoice:{hubs:[{channelId:HUB,name:'宿坊',plan:'once' as const}]}};
let db:Db, close:()=>Promise<void>;
beforeEach(async()=>{
  ({db,close}=await makeDb());
  await db.insert(members).values([
    {id:OWNER,username:'owner',displayName:'部屋主',roleIds:[ROLE.ujiko]},
    {id:BOOST,username:'boost',displayName:'奉納者',roleIds:[ROLE.sanpaisha],boostingSince:new Date()},
    {id:OTHER,username:'other',displayName:'参拝者',roleIds:[ROLE.sanpaisha]},
    {id:UJIKO,username:'ujiko',displayName:'氏子',roleIds:[ROLE.ujiko]},
  ]);
  await setPerkUjiko(db,true,OWNER);
});
afterEach(async()=>close());
const roles=(...ids:string[])=>({cache:new Collection(ids.map(id=>[id,{}]))});

// Discordへの接続・メッセージ送信はせず、部屋のDBと入口の実処理を通す。
function roomApp() {
  const closeRoom=vi.fn(async()=>{});
  const app=new RoomApp(db,()=>cfg,closeRoom);
  const apply=vi.fn(async()=>{}), notice=vi.fn(async()=>{});
  Object.assign(app,{apply,sendNotice:notice});
  const channel={id:ROOM,name:'宿',userLimit:0,isVoiceBased:()=>true,isTextBased:()=>true,send:vi.fn(async()=>{})};
  const memberMap=new Collection([BOOST,OTHER].map(id=>[id,{id,roles:roles(ROLE.sanpaisha),send:vi.fn(async()=>{})}]));
  const guild={id:cfg.guildId,channels:{cache:new Collection([[ROOM,channel]])},members:{cache:memberMap,fetch:vi.fn(async()=>undefined)}};
  Object.assign(app,{guild});
  return {app,apply,notice,closeRoom,channel,guild};
}

describe('奉納中は宿だけの階級条件を免除',()=>{
  it('奉納中の参拝者も利用できるが、位・カジノの条件は変えない',async()=>{
    expect(await canUseRoomFeatures(db,cfg,BOOST,[ROLE.sanpaisha])).toBe(true);
    expect(await canUseRoomFeatures(db,cfg,OTHER,[ROLE.sanpaisha])).toBe(false);
    expect(await canUseRoomFeatures(db,cfg,UJIKO,[ROLE.ujiko])).toBe(true);
    expect(meetsUjiko(cfg,[ROLE.sanpaisha])).toBe(false);
    await setEmaPromotion(db,true,OWNER);await resetAllShuin(db,OWNER);
    expect(await casinoRoleLimit(db,cfg,[ROLE.sanpaisha])).toEqual({limit:5000,who:'sanpaisha'});
  });
  it('奉納終了・退会後は利用条件を免除しない',async()=>{
    await db.update(members).set({boostingSince:null}).where(eq(members.id,BOOST));
    expect(await canUseRoomFeatures(db,cfg,BOOST,[ROLE.sanpaisha])).toBe(false);
    await db.update(members).set({boostingSince:new Date(),leftAt:new Date()}).where(eq(members.id,BOOST));
    expect(await canUseRoomFeatures(db,cfg,BOOST,[ROLE.sanpaisha])).toBe(false);
  });
  it.each(['day','hourly'] as const)('%s の宿を参拝者ブースターが実際に無料で作れる',async(mode)=>{
    const ops:VoiceOps={create:vi.fn(async()=>ROOM),move:vi.fn(),remove:vi.fn(),occupancy:()=>0};
    const app=new TempVoiceApp(db,()=>cfg);
    Object.assign(app,{ctx:{db,cfg,ops}});
    expect((await app.openStay(HUB,OTHER,'参拝者',mode,undefined,false,[ROLE.sanpaisha])).status).toBe('rank_too_low');
    const r=await app.openStay(HUB,BOOST,'奉納者',mode,undefined,false,[ROLE.sanpaisha]);
    expect(r).toMatchObject({status:'created',charged:0});
    expect((await roomOf(db,ROOM))?.ownerId).toBe(BOOST);
    expect((await app.openStay(HUB,BOOST,'奉納者',mode,undefined,false,[ROLE.sanpaisha,ROLE.yakudoshi])).status).toBe('yaku');
  });
  it.each([false,true])('通話入口・シクレからの作成でもブースターを閉め出さない（secret=%s）',async(secret)=>{
    await db.insert(tempVoice).values({channelId:ROOM,hubId:HUB,ownerId:BOOST});
    const f=roomApp();await f.app.onCreated(ROOM,BOOST,{secret});
    expect(f.closeRoom).not.toHaveBeenCalled();
    expect(f.notice).toHaveBeenCalledOnce();
    expect((await roomOf(db,ROOM))?.paid).toBe(0);
  });
  it('通話入口でも奉納していない参拝者は作れない',async()=>{
    await db.insert(tempVoice).values({channelId:ROOM,hubId:HUB,ownerId:OTHER});
    const f=roomApp();await f.app.onCreated(ROOM,OTHER);
    expect(f.closeRoom).toHaveBeenCalledWith(ROOM);
    expect(f.notice).not.toHaveBeenCalled();
  });
  it('シクレに招待される本人がブースターなら許可し、部屋主の奉納を他人に適用しない',async()=>{
    await setEmaPromotion(db,true,OWNER);await resetAllShuin(db,OWNER);
    await db.insert(tempVoice).values({channelId:ROOM,hubId:HUB,ownerId:BOOST,kind:'secret'});
    const f=roomApp();
    const reply=vi.fn(async()=>{}),editReply=vi.fn(async()=>{});
    const i={guildId:cfg.guildId,guild:f.guild,inCachedGuild:()=>true,
      isAutocomplete:()=>false,isChatInputCommand:()=>false,isButton:()=>false,isStringSelectMenu:()=>false,isModalSubmit:()=>false,
      isUserSelectMenu:()=>true,customId:'room:invitepick',channelId:ROOM,user:{id:BOOST},member:{roles:roles(ROLE.sanpaisha)},
      values:[OTHER,UJIKO,OWNER],users:new Collection(),
      members:new Collection([[OTHER,{roles:roles(ROLE.sanpaisha)}],[UJIKO,{roles:roles(ROLE.ujiko)}],[OWNER,{roles:roles(ROLE.ujiko)}]]),
      deferred:false,reply,editReply,deferUpdate:vi.fn(async()=>{i.deferred=true;})};
    // 部屋主を通常の氏子へ戻し、招待先を奉納者・氏子・参拝者にする。
    await db.update(tempVoice).set({ownerId:OWNER}).where(eq(tempVoice.channelId,ROOM));
    i.user.id=OWNER;i.values=[BOOST,UJIKO,OTHER];i.member.roles=roles(ROLE.ujiko);
    i.members.set(BOOST,{roles:roles(ROLE.sanpaisha)});
    await f.app.onInteraction(i as never);
    expect(i.deferUpdate).toHaveBeenCalledOnce();
    expect((await roomOf(db,ROOM))?.invited).toEqual([BOOST,UJIKO]);
    expect(reply).not.toHaveBeenCalled();expect(editReply).toHaveBeenCalled();
    // 部屋主自身が奉納していても、招待先の参拝者には適用しない。
    await db.update(tempVoice).set({ownerId:BOOST}).where(eq(tempVoice.channelId,ROOM));
    i.user.id=BOOST;i.member.roles=roles(ROLE.sanpaisha);i.values=[OTHER];i.deferred=false;
    await f.app.onInteraction(i as never);
    expect(editReply).toHaveBeenLastCalledWith(expect.objectContaining({content:expect.stringContaining('シクレに入れるのは')}));
    expect((await roomOf(db,ROOM))?.invited).toEqual([BOOST,UJIKO]);
    await db.update(tempVoice).set({ownerId:OWNER}).where(eq(tempVoice.channelId,ROOM));
    // 奉納者でも、他人の部屋の操作権はない。
    i.user.id=BOOST;i.member.roles=roles(ROLE.sanpaisha);i.deferred=false;
    await f.app.onInteraction(i as never);
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({content:'部屋の設定は、部屋を作った人と運営だけが使えます。'}));
  });
});

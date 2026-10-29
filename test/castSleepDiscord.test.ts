import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChannelType, type Guild, type Interaction, type VoiceState } from 'discord.js';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { castSessions } from '../src/db/schema.js';
import { CastApp, sessionMessage } from '../src/discord/cast.js';
import { CAST_DEFAULTS, getSession } from '../src/services/cast.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const CAST='880000000000000921', CUSTOMER='880000000000000922', ROOM='990000000000000921', THREAD='990000000000000922';
const START=new Date('2026-10-29T14:50:00Z'), NOW=new Date('2026-10-29T15:00:00Z');
let db:Db,close:()=>Promise<void>,id:number;
beforeEach(async()=>{
 ({db,close}=await makeDb()); vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(NOW);
 await addCoins(db,CUSTOMER,750,'adjust');
 const [s]=await db.insert(castSessions).values({castId:CAST,customerId:CUSTOMER,price:250,minutes:60,plan:'60',status:'active',startAt:START,startedAt:START,endsAt:new Date(START.getTime()+3600000),channelId:ROOM,threadId:THREAD}).returning();id=s!.id;
});
afterEach(async()=>{vi.restoreAllMocks();vi.useRealTimers();await close();});
function fixture(){
 const room={id:ROOM,type:ChannelType.GuildVoice,members:new Map([[CAST,{}],[CUSTOMER,{}]]),delete:vi.fn(async()=>undefined),send:vi.fn(async()=>({}))};
 const guild={id:cfg.guildId,available:true,client:{isReady:()=>true},channels:{cache:new Map([[ROOM,room]]),fetch:vi.fn(async()=>room)}};
 const discord={sendDm:vi.fn(async(_id:string,_text:string)=>true),sendMessage:vi.fn(async()=>({id:'notice'}))};
 const app=new CastApp(db,()=>cfg,discord as never);app.attach(guild as unknown as Guild);vi.spyOn(app,'refresh').mockImplementation(()=>undefined);
 const interaction=(customId:string,userId=CUSTOMER,channelId=ROOM,roles:string[]=[])=>({
  customId,guildId:cfg.guildId,channelId,user:{id:userId},member:{roles:{cache:new Map(roles.map(r=>[r,{}]))}},
  inCachedGuild:()=>true,isChatInputCommand:()=>false,isStringSelectMenu:()=>false,isUserSelectMenu:()=>false,isModalSubmit:()=>false,isButton:()=>true,isRepliable:()=>true,
  replied:false,deferred:false,deferReply:vi.fn(async()=>undefined),deferUpdate:vi.fn(async()=>undefined),reply:vi.fn(async()=>undefined),followUp:vi.fn(async()=>undefined),editReply:vi.fn(async(_body:unknown)=>undefined),
 });
 const preview=async()=>{const i=interaction(`cast:sleep:${id}`);await app.onInteraction(i as unknown as Interaction);return /cast:sleepconfirm:([a-f0-9-]+)/.exec(JSON.stringify(i.editReply.mock.calls))![1]!;};
 return {app,room,guild,discord,interaction,preview};
}
it('通話操作を2行に収め、寝落ち報告も延長・通報も落とさない',async()=>{
 const s=(await getSession(db,id))!;
 const body=sessionMessage(s,CAST_DEFAULTS,'銭');
 expect(body.components).toHaveLength(2);expect(body.components.every(r=>r.components.length<=5)).toBe(true);
 for(const key of ['cast:sleep:','cast:ext:','cast:report:','cast:end:'])expect(JSON.stringify(body)).toContain(key+id);
});
it('VCチャットでプレビュー→確定し、DM・スレッドに記録を残してから専用VCを消す',async()=>{
 const f=fixture(),quote=await f.preview();expect(f.room.delete).not.toHaveBeenCalled();
 expect((await walletOf(db,CUSTOMER)).balance).toBe(750);
 const i=f.interaction('cast:sleepconfirm:'+quote);await f.app.onInteraction(i as unknown as Interaction);
 expect(f.discord.sendDm).toHaveBeenCalledWith(CAST,expect.stringContaining('37銭'));
 expect(f.discord.sendDm).toHaveBeenCalledWith(CUSTOMER,expect.stringContaining('209銭'));
 expect(f.discord.sendMessage).toHaveBeenCalledWith(THREAD,expect.objectContaining({content:expect.stringContaining('日本時間'),allowed_mentions:{parse:[]}}));
 expect(f.room.delete).toHaveBeenCalledOnce();expect((await getSession(db,id))?.channelId).toBeNull();
 await f.app.onInteraction(i as unknown as Interaction);expect(f.room.delete).toHaveBeenCalledOnce();expect((await walletOf(db,CUSTOMER)).balance).toBe(959);
});
it.each(['active','disputed'] as const)('ほかの接客が%sで同じVCを使っているときは、その部屋を消さない',async status=>{
 const f=fixture();await db.insert(castSessions).values({castId:'880000000000000923',customerId:CUSTOMER,plan:'60',price:500,minutes:60,status,channelId:ROOM,deleteAt:null});
 await f.app.onInteraction(f.interaction('cast:sleepconfirm:'+await f.preview()) as unknown as Interaction);
 expect(f.room.delete).not.toHaveBeenCalled();expect((await getSession(db,id))?.status).toBe('done');
});
it('第三者・別チャンネルからの操作では精算せず、運営ロールを確認する',async()=>{
 const f=fixture();
 for(const [user,channel] of [['880000000000000923',ROOM],[CUSTOMER,'other-room']]){
  const i=f.interaction(`cast:sleep:${id}`,user,channel);await f.app.onInteraction(i as unknown as Interaction);expect(JSON.stringify(i.editReply.mock.calls)).not.toContain('cast:sleepconfirm:');
 }
 const staff=f.interaction(`cast:sleep:${id}`,'880000000000000923',ROOM,[ROLE.shinshoku]);await f.app.onInteraction(staff as unknown as Interaction);expect(JSON.stringify(staff.editReply.mock.calls)).toContain('cast:sleepconfirm:');
 expect((await getSession(db,id))?.status).toBe('active');expect(f.room.delete).not.toHaveBeenCalled();
});
it('返金失敗ではVCを消さず、取引も元に戻る',async()=>{
 const f=fixture(),quote=await f.preview();
 await db.execute(sql.raw("CREATE FUNCTION fail_sleep_discord() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason='cast_refund' THEN RAISE EXCEPTION 'refund failed'; END IF; RETURN NEW; END $$"));
 await db.execute(sql.raw('CREATE TRIGGER fail_sleep_discord BEFORE INSERT ON coin_tx FOR EACH ROW EXECUTE FUNCTION fail_sleep_discord()'));
 await f.app.onInteraction(f.interaction('cast:sleepconfirm:'+quote) as unknown as Interaction);
 expect(f.room.delete).not.toHaveBeenCalled();expect(f.discord.sendDm).not.toHaveBeenCalled();expect((await getSession(db,id))?.status).toBe('active');expect((await walletOf(db,CUSTOMER)).balance).toBe(750);
});
it('お客様が来ていないときは、キャストから寝落ち精算して本数を増やせない',async()=>{
 const f=fixture();f.room.members.delete(CUSTOMER);
 const i=f.interaction(`cast:sleep:${id}`,CAST);await f.app.onInteraction(i as unknown as Interaction);
 expect(JSON.stringify(i.editReply.mock.calls)).toContain('お客様の入室');expect((await getSession(db,id))?.status).toBe('active');expect(f.room.delete).not.toHaveBeenCalled();
});
it('削除失敗は精算を繰り返さずtickで再試行する。DM失敗でも精算記録を残す',async()=>{
 const f=fixture();f.room.delete.mockRejectedValueOnce(Error('missing permission'));f.discord.sendDm.mockRejectedValue(Error('DM closed'));
 await f.app.onInteraction(f.interaction('cast:sleepconfirm:'+await f.preview()) as unknown as Interaction);
 expect((await getSession(db,id))?.channelId).toBe(ROOM);expect((await walletOf(db,CUSTOMER)).balance).toBe(959);
 await f.app.tick(NOW);expect(f.room.delete).toHaveBeenCalledTimes(2);expect((await getSession(db,id))?.channelId).toBeNull();expect((await walletOf(db,CUSTOMER)).balance).toBe(959);
});
it('VCの入退室イベントを保存し、再接続で欠席判定を保留する',async()=>{
 const f=fixture();f.room.members.delete(CUSTOMER);
 const state=(channelId:string|null)=>({guild:f.guild,id:CUSTOMER,channelId}) as unknown as VoiceState;
 await f.app.onVoiceStateUpdate(state(ROOM),state(null));
 expect((await getSession(db,id))?.attendance?.customerJoinedAt).toBe(NOW.toISOString());
 // 退出イベントにも「そこにいた」という事実がある。後から空室を観測しても消さない。
 await db.update(castSessions).set({attendance:{epoch:'old',checkedAt:NOW.toISOString(),uncertain:false,castJoinedAt:START.toISOString(),customerJoinedAt:null,castPresent:true,customerPresent:false}}).where(eq(castSessions.id,id));
 f.app.invalidateAttendance();vi.setSystemTime(new Date(START.getTime()+3600000));await f.app.tick(new Date());
 expect((await getSession(db,id))?.status).toBe('disputed');expect((await walletOf(db,CAST)).balance).toBe(0);expect(f.room.delete).not.toHaveBeenCalled();
 expect(JSON.stringify(f.discord.sendMessage.mock.calls)).toContain('入室履歴を確認できません');
});

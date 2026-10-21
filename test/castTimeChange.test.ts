import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { castSessions, castTimeChanges } from '../src/db/schema.js';
import { proposeSessionTime, acceptSessionTime, changeableReservations, castTick, CAST_DEFAULTS } from '../src/services/cast.js';
import { walletOf } from '../src/services/economy.js';
import { CastApp } from '../src/discord/cast.js';
import { cfg, makeDb } from './helpers.js';
const CAST='880000000000000001',CUSTOMER='880000000000000002',OTHER='880000000000000003';
const NOW=new Date('2026-10-21T03:00:00Z'),OLD=new Date('2026-10-21T05:00:00Z'),NEXT=new Date('2026-10-21T06:00:00Z'),THREAD='990000000000000001';
let db:Db,close:()=>Promise<void>,s:typeof castSessions.$inferSelect;
beforeEach(async()=>{({db,close}=await makeDb());s=(await db.insert(castSessions).values({castId:CAST,customerId:CUSTOMER,plan:'30',minutes:30,price:300,status:'accepted',startAt:OLD,threadId:THREAD}).returning())[0]!;});
afterEach(async()=>{vi.useRealTimers();await close();});
const propose=(by=CAST,at=NEXT)=>proposeSessionTime(db,s.id,by,at,'',NOW);
async function quote(by=CAST,at=NEXT){const q=await propose(by,at);if(q.status!=='ok')throw Error(q.status);return q.proposal;}
it.each([CAST,CUSTOMER])('どちらも提案でき、相手の承認前は日時と銭を変えない: %s',async by=>{
 const p=await quote(by);expect(p.approveBy).toBe(by===CAST?CUSTOMER:CAST);
 expect((await db.select().from(castSessions))[0]!.startAt).toEqual(OLD);
 expect((await acceptSessionTime(db,p.id,by,NOW)).status).toBe('not_receiver');
 expect((await acceptSessionTime(db,p.id,OTHER,NOW)).status).toBe('not_receiver');
 const r=await acceptSessionTime(db,p.id,p.approveBy,NOW);expect(r.status).toBe('ok');
 expect((await db.select().from(castSessions))[0]).toMatchObject({startAt:NEXT,minutes:30,price:300,status:'accepted'});
 expect((await walletOf(db,CUSTOMER)).balance).toBe(0);expect((await walletOf(db,CAST)).balance).toBe(0);
});
it('変更前の通知済み状態を戻し、新しい日時の1時間前と10分前に知らせる',async()=>{
 await db.update(castSessions).set({reminded:2}).where(eq(castSessions.id,s.id));
 const p=await quote();expect((await acceptSessionTime(db,p.id,CUSTOMER,NOW)).status).toBe('ok');
 expect((await castTick(db,CAST_DEFAULTS,new Date(NEXT.getTime()-61*60000))).remind).toEqual([]);
 const hour=await castTick(db,CAST_DEFAULTS,new Date(NEXT.getTime()-60*60000));
 expect(hour.remind).toEqual([expect.objectContaining({session:expect.objectContaining({id:s.id}),stage:'hour'})]);
 expect(hour.started).toEqual([]);
 const soon=await castTick(db,CAST_DEFAULTS,new Date(NEXT.getTime()-10*60000));
 expect(soon.remind).toEqual([expect.objectContaining({session:expect.objectContaining({id:s.id}),stage:'soon'})]);
 expect((await castTick(db,CAST_DEFAULTS,new Date(NEXT.getTime()-9*60000))).remind).toEqual([]);
});
it('第三者・開始後・終了済み・同じ時刻・期限切れを拒否する',async()=>{
 expect((await propose(OTHER)).status).toBe('not_member');expect((await propose(CAST,OLD)).status).toBe('bad_time');
 const p=await quote();expect((await acceptSessionTime(db,p.id,CUSTOMER,OLD)).status).toBe('expired');
 await db.update(castSessions).set({status:'active'}).where(eq(castSessions.id,s.id));
 expect((await propose()).status).toBe('not_found');
 expect((await acceptSessionTime(db,p.id,CUSTOMER,NOW)).status).toBe('not_found');
});
it('同じ提案の同時承認は1回だけ、ほかの古い提案も失効する',async()=>{
 const a=await quote(),b=await quote(CUSTOMER,new Date(NEXT.getTime()+3600000));
 const results=await Promise.all([acceptSessionTime(db,a.id,CUSTOMER,NOW),acceptSessionTime(db,a.id,CUSTOMER,NOW)]);
 expect(results.filter(r=>r.status==='ok')).toHaveLength(1);expect(results.filter(r=>r.status==='already')).toHaveLength(1);
 expect((await acceptSessionTime(db,b.id,CAST,NOW)).status).toBe('expired');
});
it('提案後に別の予約が入れば、承認時に重複を再確認する',async()=>{
 const p=await quote();await db.insert(castSessions).values({castId:CAST,customerId:OTHER,plan:'30',minutes:30,price:300,status:'accepted',startAt:NEXT});
 expect((await acceptSessionTime(db,p.id,CUSTOMER,NOW)).status).toBe('overlap');
 expect((await db.select().from(castSessions).where(eq(castSessions.id,s.id)))[0]!.startAt).toEqual(OLD);
});
it('変更と提案の確定は同じトランザクションで、DB失敗時は元の日時を保つ',async()=>{
 const p=await quote();
 await db.execute(sql`CREATE FUNCTION fail_time_change() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test failure'; END; $$ LANGUAGE plpgsql`);
 await db.execute(sql`CREATE TRIGGER fail_time_change BEFORE UPDATE ON cast_time_changes FOR EACH ROW EXECUTE FUNCTION fail_time_change()`);
 await expect(acceptSessionTime(db,p.id,CUSTOMER,NOW)).rejects.toThrow();
 expect((await db.select().from(castSessions))[0]!.startAt).toEqual(OLD);expect((await db.select().from(castTimeChanges))[0]!.acceptedAt).toBeNull();
});
it('予約一覧は本人の開始前の予約だけを返す',async()=>{
 expect(await changeableReservations(db,OTHER,NOW)).toEqual([]);
 expect(await changeableReservations(db,CUSTOMER,NOW)).toHaveLength(1);expect(await changeableReservations(db,CAST,NOW)).toHaveLength(1);
 expect(await changeableReservations(db,CUSTOMER,OLD)).toEqual([]);
});
it('お客の提案は公開の操作元でなく予約のお部屋へ送り、自己承認は止める',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(NOW);
 const sendMessage=vi.fn(async(_channelId:string,_body:unknown)=>({id:'notice'})),sendDm=vi.fn(async()=>true);
 const app=new CastApp(db,()=>cfg,{sendMessage,sendDm} as never);app.attach({id:cfg.guildId,channels:{cache:new Map(),fetch:vi.fn(async()=>null)}} as never);
 const modal={guildId:cfg.guildId,user:{id:CUSTOMER},deferReply:vi.fn(),editReply:vi.fn(),fields:{getTextInputValue:(k:string)=>k==='when'?'10/21 15:00':'相談'},reply:vi.fn()};
 await (app as unknown as {proposeSubmit(i:unknown,id:number):Promise<void>}).proposeSubmit(modal,s.id);
 expect(sendMessage.mock.calls[0]![0]).toBe(THREAD);expect(JSON.stringify(sendMessage.mock.calls[0])).toContain('cast:timeok:');expect(modal.reply).not.toHaveBeenCalled();expect(modal.deferReply).toHaveBeenCalled();
 const p=(await db.select().from(castTimeChanges))[0]!;
 const editReply=vi.fn();await (app as unknown as {proposeAccept(i:unknown,id:string):Promise<void>}).proposeAccept({user:{id:CUSTOMER},guildId:cfg.guildId,deferReply:vi.fn(),editReply},p.id);
 expect(JSON.stringify(editReply.mock.calls)).toContain('自分の提案');
});
it('予約スレッドと受け付け済みDMにも日時変更の入口を出す',async()=>{
 const app=new CastApp(db,()=>cfg,{} as never) as unknown as {reserveMessage(s:typeof castSessions.$inferSelect):unknown;castDmMessage(s:typeof castSessions.$inferSelect):unknown};
 expect(JSON.stringify(app.reserveMessage(s))).toContain(`cast:propose:${s.id}`);expect(JSON.stringify(app.castDmMessage(s))).toContain(`cast:propose:${s.id}`);
 const active={...s,status:'active' as const};expect(JSON.stringify(app.reserveMessage(active))).not.toContain('cast:propose:');
});

it('一覧の入口は本人向けに返し、相手への無断変更ボタンを出さない',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(NOW);
 const app=new CastApp(db,()=>cfg,{} as never) as unknown as {changePicker(i:unknown,page:number):Promise<void>};
 const deferReply=vi.fn(),editReply=vi.fn();await app.changePicker({user:{id:CUSTOMER},deferReply,editReply},0);
 expect(deferReply).toHaveBeenCalledWith(expect.objectContaining({flags:expect.any(Number)}));expect(JSON.stringify(editReply.mock.calls)).toContain('cast:changesel');expect(JSON.stringify(editReply.mock.calls)).not.toContain('cast:timeok:');
});
it('別経路で日時が変わった提案も古いものとして止める',async()=>{
 const p=await quote();await db.update(castSessions).set({startAt:new Date(OLD.getTime()+1800000)}).where(eq(castSessions.id,s.id));
 expect((await acceptSessionTime(db,p.id,CUSTOMER,NOW)).status).toBe('stale');
});

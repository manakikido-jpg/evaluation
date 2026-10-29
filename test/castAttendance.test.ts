import { afterEach,beforeEach,expect,it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { castSessions } from '../src/db/schema.js';
import { observeCastAttendance,recordCastVoice,markCastAttendanceUncertain } from '../src/services/castAttendance.js';
import { CAST_DEFAULTS,castTick,castStats,castStatement,getSession,reportNoShow,resolveSession } from '../src/services/cast.js';
import { castLeaderboard } from '../src/services/castLeaderboard.js';
import { castRanking,castTop } from '../src/services/castRank.js';
import { castBreakdown } from '../src/services/castProfit.js';
import { walletOf,addCoins } from '../src/services/economy.js';
import { makeDb } from './helpers.js';
const CAST='880000000000000911',CUSTOMER='880000000000000912',ROOM='990000000000000911',START=new Date('2026-10-30T01:00:00Z'),END=new Date('2026-10-30T01:30:00Z'),MONTH=new Date('2026-09-30T15:00:00Z');
const at=(minutes:number)=>new Date(START.getTime()+minutes*60000);
let db:Db,close:()=>Promise<void>,id:number;
beforeEach(async()=>{
 ({db,close}=await makeDb());await addCoins(db,CUSTOMER,750,'adjust');
 const [s]=await db.insert(castSessions).values({castId:CAST,customerId:CUSTOMER,plan:'30',price:250,minutes:30,startAt:START,startedAt:START,endsAt:END,status:'active',channelId:ROOM}).returning();id=s!.id;
});afterEach(async()=>close());
const observe=(minutes:number,members:string[],epoch='run1',starting=false)=>observeCastAttendance(db,id,{epoch,members,starting},at(minutes));
const heartbeat=async(members:string[])=>{for(let m=1;m<=30;m++)await observe(m,members);};
it('お客様が一度も来ない予約は欠席料金を払い、本数・客数・順位には加算しない',async()=>{
 await observe(0,[CAST],'run1',true);await heartbeat([CAST]);
 const result=await castTick(db,CAST_DEFAULTS,END);expect(result.finished[0]?.status).toBe('noshow_customer');
 expect((await walletOf(db,CAST)).balance).toBe(113);expect((await walletOf(db,CUSTOMER)).balance).toBe(875);
 expect((await castStats(db,MONTH))[0]).toMatchObject({count:0,earned:113});expect((await castRanking(db,MONTH))[0]).toMatchObject({count:0,customers:0,repeaters:0});expect(await castTop(db,MONTH)).toEqual([]);
 expect((await castLeaderboard(db,END)).rows).toEqual([{castId:CAST,count:0,revenue:125}]);expect((await castBreakdown(db,MONTH,at(31)))[0]).toMatchObject({done:0,sales:125});
 const statement=await castStatement(db,CAST,MONTH,at(31));expect(statement.total).toBe(113);expect(statement.rows[0]?.label).toContain('指名本数対象外');
 await castTick(db,CAST_DEFAULTS,at(31));expect((await walletOf(db,CAST)).balance).toBe(113);
});
it('一度入室してから退出したお客様は欠席にしない。手動の欠席申告も拒否',async()=>{
 await observe(0,[CAST],'run1',true);
 await recordCastVoice(db,ROOM,'run1',[CAST,CUSTOMER],CUSTOMER,at(1));
 await heartbeat([CAST]);
 expect((await reportNoShow(db,CAST_DEFAULTS,id,CAST,at(30))).status).toBe('attended');
 const result=await castTick(db,CAST_DEFAULTS,END);expect(result.finished[0]?.status).toBe('done');expect((await castStats(db,MONTH))[0]?.count).toBe(1);
});
it('BOT再起動・観測漏れは欠席と断定せず運営確認。通常の完了に混ぜない',async()=>{
 await observe(0,[CAST],'run1',true);await observe(30,[CAST],'run2');
 const result=await castTick(db,CAST_DEFAULTS,END);expect(result.finished[0]).toMatchObject({status:'disputed',decidedBy:'attendance_review',paid:0,deleteAt:null});
 expect((await walletOf(db,CUSTOMER)).balance).toBe(750);expect(await castStats(db,MONTH)).toEqual([]);
 const settled=await resolveSession(db,CAST_DEFAULTS,id,'noshow_customer','staff',at(31));expect(settled).toMatchObject({status:'noshow_customer',paid:113});expect((await castStats(db,MONTH))[0]?.count).toBe(0);
 expect(await resolveSession(db,CAST_DEFAULTS,id,'pay','staff',at(32))).toBeUndefined();
});
it('キャストだけが来なかった予約は全額返金する',async()=>{
 await observe(0,[CUSTOMER],'run1',true);await heartbeat([CUSTOMER]);
 expect((await castTick(db,CAST_DEFAULTS,END)).finished[0]?.status).toBe('noshow_cast');expect((await walletOf(db,CUSTOMER)).balance).toBe(1000);expect((await walletOf(db,CAST)).balance).toBe(0);
});
it('旧予約の未追跡データを勝手に欠席へ変えず、終了済みの履歴も変えない',async()=>{
 expect((await castTick(db,CAST_DEFAULTS,END)).finished[0]?.status).toBe('done');
 await observe(31,[CAST]);expect((await getSession(db,id))?.attendance).toBeNull();
});
it('期限後に初めて入ったキャストを、時間内に待機していた証拠にしない',async()=>{
 await observe(0,[],'run1',true);await heartbeat([]);await observe(31,[CAST]);
 expect((await castTick(db,CAST_DEFAULTS,at(31))).finished[0]?.status).toBe('disputed');
});
it('観測できなかった新規VCを未追跡のまま通常完了にせず、手動申告も運営確認に回す',async()=>{
 await markCastAttendanceUncertain(db,id,START);
 await observe(15,[CAST]);
 expect((await reportNoShow(db,CAST_DEFAULTS,id,CAST,at(15))).status).toBe('review');
 expect((await getSession(db,id))?.status).toBe('disputed');
 expect((await walletOf(db,CAST)).balance).toBe(0);
 expect((await walletOf(db,CUSTOMER)).balance).toBe(750);
});

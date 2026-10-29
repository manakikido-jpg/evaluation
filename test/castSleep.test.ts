import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { castSessions, castSleepReports } from '../src/db/schema.js';
import { CAST_DEFAULTS, finishSession, getSession, declineExtension } from '../src/services/cast.js';
import { prepareCastSleep, confirmCastSleep, sleepCalculation, castSleepReceipt } from '../src/services/castSleep.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { castLeaderboard } from '../src/services/castLeaderboard.js';
import { castBreakdown, castProfit } from '../src/services/castProfit.js';
import { makeDb } from './helpers.js';

const CAST='880000000000000901', CUSTOMER='880000000000000902', ROOM='990000000000000901';
const START=new Date('2026-10-29T14:50:00Z'), TEN=new Date('2026-10-29T15:00:00Z'), END=new Date('2026-10-29T15:50:00Z');
const actor={id:CUSTOMER,channelId:ROOM,staff:false,present:true,castPresent:true,customerPresent:true};
let db:Db,close:()=>Promise<void>,id:number;
beforeEach(async()=>{
 ({db,close}=await makeDb());
 await addCoins(db,CUSTOMER,750,'adjust');
 const [s]=await db.insert(castSessions).values({castId:CAST,customerId:CUSTOMER,plan:'60',minutes:60,price:250,status:'active',channelId:ROOM,startedAt:START,endsAt:END,startAt:START}).returning();id=s!.id;
});
afterEach(async()=>close());

describe('キャストの寝落ち報告・按分と返金',()=>{
 it('確認前は動かさず、60分250銭の10分は41銭・受取37銭・返金209銭。日本時間で記録',async()=>{
  const q=await prepareCastSleep(db,CAST_DEFAULTS,id,actor,TEN);
  expect(q.calculation).toMatchObject({charge:41,pay:37,fee:4,refund:209,elapsedMs:600000,durationMs:3600000});
  expect((await walletOf(db,CUSTOMER)).balance).toBe(750);
  const result=await confirmCastSleep(db,CAST_DEFAULTS,q.id,actor,new Date(TEN.getTime()+5000));
  expect(result.session.status).toBe('done');expect(result.session.closedAt).toEqual(TEN);expect(result.session.endsAt).toEqual(TEN);
  expect((await walletOf(db,CAST)).balance).toBe(37);expect((await walletOf(db,CUSTOMER)).balance).toBe(959);
  const receipt=castSleepReceipt(result.report,'銭');expect(receipt).toContain('2026/10/30 0:00:00');expect(receipt).toContain('10分0秒');expect(receipt).toContain('209銭');
  await expect(confirmCastSleep(db,CAST_DEFAULTS,q.id,actor,new Date(TEN.getTime()+6000))).rejects.toThrow('精算済み');
  expect(await finishSession(db,CAST_DEFAULTS,id,'system',END)).toBeUndefined();
  expect((await walletOf(db,CUSTOMER)).balance).toBe(959);
  const stats=await castLeaderboard(db,new Date(TEN.getTime()+10000));expect(stats.rows).toEqual([{castId:CAST,count:1,revenue:41}]);
  const profit=await castProfit(db,TEN,new Date(TEN.getTime()+60000));expect(profit.sessions).toMatchObject({sales:250,refunds:209,toCasts:37,fees:4});
  const breakdown=await castBreakdown(db,TEN,new Date(TEN.getTime()+60000));expect(breakdown[0]).toMatchObject({done:1,sales:41});
 });
 it('複数の確認があっても、確定できるのは1つだけ',async()=>{
  const a=await prepareCastSleep(db,CAST_DEFAULTS,id,actor,TEN),b=await prepareCastSleep(db,CAST_DEFAULTS,id,{...actor,id:CAST},TEN);
  await confirmCastSleep(db,CAST_DEFAULTS,a.id,actor,TEN);
  await expect(confirmCastSleep(db,CAST_DEFAULTS,b.id,{...actor,id:CAST},TEN)).rejects.toThrow('終了');
  expect((await walletOf(db,CAST)).balance).toBe(37);
 });
 it('一度も来ていないお客様の予約を、寝落ち精算で指名本数にできない',async()=>{
  await expect(prepareCastSleep(db,CAST_DEFAULTS,id,{...actor,id:CAST,customerPresent:false},TEN)).rejects.toThrow('お客様の入室');
  expect((await getSession(db,id))?.status).toBe('active');expect((await walletOf(db,CAST)).balance).toBe(0);
 });
 it.each([
  {...actor,id:'880000000000000903'}, {...actor,channelId:'990000000000000999'}, {...actor,present:false}, {...actor,castPresent:false},
 ])('第三者・別VC・不在の報告を拒否する：%j',async a=>{
  await expect(prepareCastSleep(db,CAST_DEFAULTS,id,a,TEN)).rejects.toThrow();expect((await db.select().from(castSleepReports))).toHaveLength(0);
 });
 it('運営は当事者でなくても利用できるが、確認は報告者本人だけ',async()=>{
  const staff={...actor,id:'880000000000000903',staff:true,present:false};
  const q=await prepareCastSleep(db,CAST_DEFAULTS,id,staff,TEN);
  await expect(confirmCastSleep(db,CAST_DEFAULTS,q.id,actor,TEN)).rejects.toThrow('利用できません');
  const r=await confirmCastSleep(db,CAST_DEFAULTS,q.id,staff,TEN);expect(r.session.paid).toBe(37);
 });
 it('確認期限・手数料変更・延長後の古い金額を拒否する',async()=>{
  const q=await prepareCastSleep(db,CAST_DEFAULTS,id,actor,TEN);
  await expect(confirmCastSleep(db,CAST_DEFAULTS,q.id,actor,new Date(TEN.getTime()+90000))).rejects.toThrow('期限');
  await expect(confirmCastSleep(db,{...CAST_DEFAULTS,feePercent:20},q.id,actor,TEN)).rejects.toThrow('変わりました');
  await db.update(castSessions).set({price:500,extensions:1,endsAt:new Date(END.getTime()+1800000)}).where(eq(castSessions.id,id));
  await expect(confirmCastSleep(db,CAST_DEFAULTS,q.id,actor,TEN)).rejects.toThrow('変わりました');
  expect((await getSession(db,id))?.status).toBe('active');expect((await walletOf(db,CUSTOMER)).balance).toBe(750);
 });
 it('時間フリー・時間外は自動按分しない',async()=>{
  await expect(prepareCastSleep(db,CAST_DEFAULTS,id,actor,END)).rejects.toThrow('時間外');
  await db.update(castSessions).set({plan:'free:custom',minutes:0}).where(eq(castSessions.id,id));
  await expect(prepareCastSleep(db,CAST_DEFAULTS,id,actor,TEN)).rejects.toThrow('時間で割れない');
 });
 it('秒単位の利用・ゼロ・延長込み・高額も保存額を超えず、端数だけ切り捨てる',()=>{
  const s={price:250,startedAt:START,endsAt:END};
  expect(sleepCalculation(s,CAST_DEFAULTS,START)).toMatchObject({charge:0,refund:250,pay:0});
  expect(sleepCalculation(s,CAST_DEFAULTS,new Date(START.getTime()+630000)).charge).toBe(43);
  expect(sleepCalculation(s,CAST_DEFAULTS,new Date(END.getTime()+60000))).toMatchObject({charge:250,refund:0});
  expect(sleepCalculation({...s,price:375,endsAt:new Date(END.getTime()+1800000)},CAST_DEFAULTS,new Date(START.getTime()+2700000)).charge).toBe(187);
  expect(sleepCalculation({...s,price:2_000_000_000},CAST_DEFAULTS,new Date(START.getTime()+1800000)).charge).toBe(1_000_000_000);
 });
 it('返金の書き込みに失敗したら、振込・状態・精算印もすべて戻す',async()=>{
  const q=await prepareCastSleep(db,CAST_DEFAULTS,id,actor,TEN);
  await db.execute(sql.raw("CREATE FUNCTION fail_sleep_refund() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason = 'cast_refund' THEN RAISE EXCEPTION 'refund failed'; END IF; RETURN NEW; END $$"));
  await db.execute(sql.raw('CREATE TRIGGER fail_sleep_refund BEFORE INSERT ON coin_tx FOR EACH ROW EXECUTE FUNCTION fail_sleep_refund()'));
  await expect(confirmCastSleep(db,CAST_DEFAULTS,q.id,actor,TEN)).rejects.toThrow();
  expect((await walletOf(db,CAST)).balance).toBe(0);expect((await walletOf(db,CUSTOMER)).balance).toBe(750);expect((await getSession(db,id))?.status).toBe('active');
  expect((await db.select().from(castSleepReports))[0]!.settledAt).toBeNull();
 });
 it('断った延長の返金を、寝落ち精算の売上から二重に引かない',async()=>{
  await db.update(castSessions).set({price:375,minutes:90,endsAt:new Date(END.getTime()+1800000),extensions:1,extensionPrice:125}).where(eq(castSessions.id,id));
  expect((await declineExtension(db,id,CAST,1,TEN)).status).toBe('ok');
  const q=await prepareCastSleep(db,CAST_DEFAULTS,id,actor,TEN);await confirmCastSleep(db,CAST_DEFAULTS,q.id,actor,TEN);
  expect((await castLeaderboard(db,TEN)).rows[0]).toMatchObject({revenue:41});
  expect((await castBreakdown(db,TEN,new Date(TEN.getTime()+60000)))[0]?.sales).toBe(41);
  expect((await castProfit(db,TEN,new Date(TEN.getTime()+60000))).sessions).toMatchObject({sales:375,refunds:334,toCasts:37,fees:4});
 });
});

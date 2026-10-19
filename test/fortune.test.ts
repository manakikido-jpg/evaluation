import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, count, eq, sql } from 'drizzle-orm';
import { fortuneGamesSchema } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { coinTx, fortuneRounds, fortuneScratch, fortuneTickets } from '../src/db/schema.js';
import { buyLottery, buyScratch, ensureLotteryRound, fortuneState, jstDay, nextLotteryDraw, projectedPrize, revealScratch, settleLotteries, SCRATCH_PRIZES } from '../src/services/casino/fortune.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { makeDb } from './helpers.js';
let db: Db, close: () => Promise<void>;
const a = '760000000000000001', b = '760000000000000002';
const cfg = fortuneGamesSchema.parse({ enabled: true });
let now: Date;
const clock = () => now;
beforeEach(async () => { ({ db, close } = await makeDb());now = new Date('2026-10-17T03:00:00Z');await addCoins(db,a,10000,'admin_grant');await addCoins(db,b,10000,'admin_grant'); });
afterEach(async () => close());
describe('普段のスクラッチ', () => {
  it('確率と還元率を固定し、JSTの0時と日曜21時を境界にする', () => {
    expect(SCRATCH_PRIZES.reduce((s,p)=>s+p.weight,0)).toBe(10000);
    expect(SCRATCH_PRIZES.reduce((s,p)=>s+p.weight*p.multiplier,0)/10000).toBe(.715);
    expect(jstDay(new Date('2026-10-18T14:59:59Z'))).toBe('2026-10-18');
    expect(jstDay(new Date('2026-10-18T15:00:00Z'))).toBe('2026-10-19');
    for(const [at,draw] of [['2026-10-18T11:59:59Z','2026-10-18T12:00:00Z'],['2026-10-18T12:00:00Z','2026-10-25T12:00:00Z'],['2026-10-19T00:00:00Z','2026-10-25T12:00:00Z']]) expect(nextLotteryDraw(new Date(at!)).getTime()).toBe(new Date(draw!).getTime());
  });
  it.each([[0,0],[5499,0],[5500,100],[8499,100],[8500,200],[9699,200],[9700,500],[9949,500],[9950,1000],[9999,1000]])('抽選境界 %i の払戻は %i',async(draw,payout)=>{
    const id=await buyScratch(db,a,randomUUID(),cfg,clock,()=>draw);
    expect((await fortuneState(db,a,cfg,now)).scratches[0]!.payout).toBeNull();
    expect((await walletOf(db,a)).balance).toBe(9900);
    expect((await revealScratch(db,a,id,clock)).payout).toBe(payout);
    expect((await walletOf(db,a)).balance).toBe(9900+payout);
  });
  it('同じ購入番号と別番号の同時送信でも未開封は1枚、同時開封も入金は1回',async()=>{
    const nonce=randomUUID();
    const ids=await Promise.all([buyScratch(db,a,nonce,cfg,clock,()=>9999),buyScratch(db,a,nonce,cfg,clock),buyScratch(db,a,randomUUID(),cfg,clock)]);
    expect(new Set(ids).size).toBe(1);
    await Promise.all(ids.map(id=>revealScratch(db,a,id,clock)));
    expect((await walletOf(db,a)).balance).toBe(10900);
    expect((await db.select().from(coinTx).where(eq(coinTx.reason,'scratch_prize')))).toHaveLength(1);
    await expect(revealScratch(db,b,ids[0]!,clock)).rejects.toThrow('見つかりません');
    await expect(buyScratch(db,b,nonce,cfg,clock)).rejects.toThrow('購入番号');
  });
  it('購入上限・JSTの日付更新・設定の休止後も未開封を精算できる',async()=>{
    const small={...cfg,scratchDailyLimit:1};
    const id=await buyScratch(db,a,randomUUID(),small,clock,()=>9950);
    await revealScratch(db,a,id,clock);
    await expect(buyScratch(db,a,randomUUID(),small,clock)).rejects.toThrow('購入上限');
    now=new Date('2026-10-17T15:00:00Z');
    const next=await buyScratch(db,a,randomUUID(),small,clock,()=>9950);
    await expect(buyScratch(db,b,randomUUID(),{...cfg,enabled:false},clock)).rejects.toThrow('お休み');
    expect((await revealScratch(db,a,next,clock)).payout).toBe(1000);
  });
  it('抽選エラー・残高不足は券も支出も残さない',async()=>{
    await expect(buyScratch(db,a,randomUUID(),cfg,clock,()=>10000)).rejects.toThrow();
    await expect(buyScratch(db,'empty',randomUUID(),cfg,clock)).rejects.toThrow('足りません');
    expect(await db.select().from(fortuneScratch)).toHaveLength(0);
    expect((await walletOf(db,a)).balance).toBe(10000);
    await expect(buyScratch(db,a,'bad',cfg,clock)).rejects.toThrow('購入番号');
  });
});
describe('日曜21時の宝くじ',()=>{
  it('開催条件を固定し、同じ券の再送と同時抽選でも支出・賞金は1回',async()=>{
    const round=(await ensureLotteryRound(db,cfg,now))!;
    const nonce=randomUUID();
    await Promise.all([buyLottery(db,a,nonce,round.id,cfg,clock),buyLottery(db,a,nonce,round.id,cfg,clock),buyLottery(db,b,randomUUID(),round.id,cfg,clock)]);
    const r=(await ensureLotteryRound(db,{...cfg,lotteryPrice:500,lotteryBonus:9999},now))!;
    expect(r.price).toBe(100);expect(r.bonus).toBe(1000);expect(r.sold).toBe(2);expect(projectedPrize(r)).toBe(1140);
    now=round.drawAt;
    await Promise.all([settleLotteries(db,now,()=>0),settleLotteries(db,now,()=>1)]);
    const result=(await db.select().from(fortuneRounds))[0]!;
    expect(result.settledAt).not.toBeNull();expect(result.payout).toBe(1140);
    const balances=(await walletOf(db,a)).balance+(await walletOf(db,b)).balance;
    expect(balances).toBe(20000-200+1140);
    expect(await db.select().from(coinTx).where(eq(coinTx.reason,'lottery_prize'))).toHaveLength(1);
    expect(await db.select().from(fortuneTickets)).toHaveLength(2);
  });
  it('締切前は精算せず、締切ちょうどの購入を拒否し、販売ゼロなら賞金なし',async()=>{
    const r=(await ensureLotteryRound(db,cfg,now))!;
    await settleLotteries(db,new Date(r.drawAt.getTime()-1),()=>0);
    expect((await db.select().from(fortuneRounds))[0]!.settledAt).toBeNull();
    now=r.drawAt;
    await expect(buyLottery(db,a,randomUUID(),r.id,cfg,clock)).rejects.toThrow('終わりました');
    await settleLotteries(db,now,()=>{throw Error('販売ゼロでは抽選しない');});
    expect((await db.select().from(fortuneRounds))[0]!.payout).toBe(0);
    expect((await walletOf(db,a)).balance).toBe(10000);
    expect(await db.select().from(coinTx).where(eq(coinTx.reason,'lottery_prize'))).toHaveLength(0);
  });
  it('購入上限・他人の番号・休止・残高不足を拒否し、繰越処理で複数週を回収する',async()=>{
    const r=(await ensureLotteryRound(db,{...cfg,lotteryLimit:1},now))!;
    const id=randomUUID();await buyLottery(db,a,id,r.id,cfg,clock);
    await expect(buyLottery(db,a,randomUUID(),r.id,cfg,clock)).rejects.toThrow('購入上限');
    await expect(buyLottery(db,b,id,r.id,cfg,clock)).rejects.toThrow('購入番号');
    await expect(buyLottery(db,b,randomUUID(),r.id,{...cfg,enabled:false},clock)).rejects.toThrow('お休み');
    await expect(buyLottery(db,'empty',randomUUID(),r.id,cfg,clock)).rejects.toThrow('足りません');
    now=new Date('2026-10-25T03:00:00Z');const next=(await ensureLotteryRound(db,cfg,now))!;
    await buyLottery(db,a,randomUUID(),next.id,cfg,clock);
    now=new Date('2026-11-01T12:00:00Z');await settleLotteries(db,now,()=>0);await settleLotteries(db,now,()=>0);
    expect((await db.select().from(fortuneRounds)).every(r=>r.settledAt)).toBe(true);
    expect(await db.select().from(coinTx).where(eq(coinTx.reason,'lottery_prize'))).toHaveLength(2);
  });
  it('同時購入でも1人の上限を超えず、番号と支出が対応する',async()=>{
    const r=(await ensureLotteryRound(db,{...cfg,lotteryLimit:2},now))!;
    const requests=await Promise.allSettled(Array.from({length:5},()=>buyLottery(db,a,randomUUID(),r.id,cfg,clock)));
    expect(requests.filter(r=>r.status==='fulfilled')).toHaveLength(2);
    expect((await walletOf(db,a)).balance).toBe(9800);
    expect((await db.select().from(fortuneTickets)).map(t=>t.number).sort()).toEqual([1,2]);
    expect(await db.select().from(coinTx).where(eq(coinTx.reason,'lottery_buy'))).toHaveLength(2);
  });
  it('入金後の保存失敗も全てロールバックし、再実行できる',async()=>{
    const r=(await ensureLotteryRound(db,cfg,now))!;await buyLottery(db,a,randomUUID(),r.id,cfg,clock);
    await db.execute(sql`CREATE OR REPLACE FUNCTION fortune_test_fail() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test failure'; END; $$ LANGUAGE plpgsql`);
    await db.execute(sql`CREATE TRIGGER fortune_test_fail BEFORE UPDATE ON fortune_rounds FOR EACH ROW EXECUTE FUNCTION fortune_test_fail()`);
    await expect(settleLotteries(db,r.drawAt,()=>0)).rejects.toThrow();
    expect((await walletOf(db,a)).balance).toBe(9900);
    expect(await db.select().from(coinTx).where(eq(coinTx.reason,'lottery_prize'))).toHaveLength(0);
    await db.execute(sql`DROP TRIGGER fortune_test_fail ON fortune_rounds`);
    await settleLotteries(db,r.drawAt,()=>0);expect((await walletOf(db,a)).balance).toBe(10970);
  });
});

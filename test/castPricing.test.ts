import {afterEach,beforeEach,expect,it} from 'vitest';
import {eq} from 'drizzle-orm';
import {cfg,makeDb} from './helpers.js';
import type {Db} from '../src/db/client.js';
import {castSessions,castChargeQuotes,casts} from '../src/db/schema.js';
import {CAST_DEFAULTS,applyCast,setCastStatus,addMenuItem,addOption,getCast,requestSession,castMultiplierAt,castPriceLock,loadCastConfig,saveCastConfig,type CastConfig} from '../src/services/cast.js';
import {prepareCastCharge,confirmCastCharge,requestPrice} from '../src/services/castPricing.js';
import {addCoins,walletOf} from '../src/services/economy.js';
const CAST='881000000000000001',USER='881000000000000002',OTHER='881000000000000003';
const now=new Date('2026-10-02T11:00:00Z'),peak=new Date('2026-10-02T12:00:00Z'); // 金曜20時・21時JST
const c:CastConfig={...CAST_DEFAULTS,coreTime:{...cfg.coreTime,slots:[{day:5,start:'21:00',end:'23:00'}]}};
let db:Db,close:()=>Promise<void>;
beforeEach(async()=>{({db,close}=await makeDb());await applyCast(db,c,{id:CAST,adult:true},{bio:'こんにちは',tags:[],price30:300,price60:500,priceNight:2000,minorOk:true},now);await setCastStatus(db,CAST,'active','staff',now);await addCoins(db,USER,100000,'adjust');});
afterEach(async()=>{await close();});
it('日本時間の開始を含み終了を含まない。空枠と1倍は通常、端数切り上げ',()=>{
 expect(castMultiplierAt(c,new Date(peak.getTime()-1))).toBe(1);expect(castMultiplierAt(c,peak)).toBe(3);
 expect(castMultiplierAt(c,new Date('2026-10-02T14:00:00Z'))).toBe(1);
 expect(castMultiplierAt({...c,coreTime:{...c.coreTime!,slots:[]}},peak)).toBe(1);
 expect(castPriceLock({...c,coreTimeMultiplier:1.25},101,51,peak)).toMatchObject({price:127,extensionPrice:64});
});
it('初期倍率3、設定を保存しても実行時の時間帯を設定JSONへ書き込まない',async()=>{
 expect((await loadCastConfig(db)).coreTimeMultiplier).toBe(3);
 await saveCastConfig(db,{...c,coreTimeMultiplier:2.5},'staff');
 expect(await loadCastConfig(db)).toMatchObject({coreTimeMultiplier:2.5});expect((await loadCastConfig(db)).coreTime).toBeUndefined();
});
it('予約を作った時刻ではなく開始時刻で判定し、オプションも3倍',async()=>{
 await addOption(db,c,CAST,{name:'歌',price:100});const options=[(await getCast(db,CAST))!.options[0]!.id];
 const q=await prepareCastCharge(db,c,USER,{route:'reserve',requests:[{castId:CAST,plan:'30',startAt:peak.toISOString(),options}]},now);
 expect(q.prices[0]).toMatchObject({base:400,price:1200});expect((await walletOf(db,USER)).balance).toBe(100000);
 const paid=await confirmCastCharge(db,{...c,coreTimeMultiplier:5},q.id,USER,true,now);
 expect(paid.sessions[0]).toMatchObject({price:1200,optionPrice:300,baseExtensionPrice:300});
 expect((await walletOf(db,USER)).balance).toBe(98800);
});
it('期限内の同時再送は1回だけ引き落とし。第三者・期限切れは支払えない',async()=>{
 const q=await prepareCastCharge(db,c,USER,{route:'reserve',requests:[{castId:CAST,plan:'30',startAt:peak.toISOString()}]},now);
 await expect(confirmCastCharge(db,c,q.id,OTHER,true,now)).rejects.toThrow('本人');
 const results=await Promise.all([confirmCastCharge(db,c,q.id,USER,true,now),confirmCastCharge(db,c,q.id,USER,true,now)]);
 expect(results.filter(r=>r.fresh)).toHaveLength(1);expect((await walletOf(db,USER)).balance).toBe(99100);
 const expired=await prepareCastCharge(db,c,USER,{route:'reserve',requests:[{castId:CAST,plan:'30',startAt:peak.toISOString()}]},now);
 await expect(confirmCastCharge(db,c,expired.id,USER,true,new Date(now.getTime()+300000))).rejects.toThrow('5分');
});
it('メニュー変更・残高不足の失敗では請求と確定印を残さない',async()=>{
 const q=await prepareCastCharge(db,c,USER,{route:'reserve',requests:[{castId:CAST,plan:'30',startAt:peak.toISOString()}]},now);
 await db.update(casts).set({price30:999}).where(eq(casts.memberId,CAST));
 await expect(confirmCastCharge(db,c,q.id,USER,true,now)).rejects.toThrow('no_plan');
 expect((await db.select().from(castChargeQuotes))[0]!.consumedAt).toBeNull();expect((await walletOf(db,USER)).balance).toBe(100000);
});
it('納品・ガチャ・相談の通話と納品・寝落ちも同じ倍率',async()=>{
 await addMenuItem(db,c,CAST,{name:'納品',note:'',minutes:0,price:200,night:false,delivery:true,gacha:['A','B']});
 await addMenuItem(db,c,CAST,{name:'相談',note:'',minutes:0,price:0,night:false,consult:true});
 const menu=(await getCast(db,CAST))!.menu,delivery=menu.find(m=>m.delivery)!,consult=menu.find(m=>m.consult)!;
 expect((await requestPrice(db,c,{castId:CAST,plan:delivery.id},peak)).price).toBe(600);
 expect((await requestPrice(db,c,{castId:CAST,plan:consult.id,quote:{minutes:0,price:700,delivery:true}},peak)).price).toBe(2100);
 expect((await requestPrice(db,c,{castId:CAST,plan:consult.id,startAt:peak.toISOString(),quote:{minutes:30,price:800}},now)).price).toBe(2400);
 const night=menu.find(m=>m.night)!;expect((await requestPrice(db,c,{castId:CAST,plan:night.id,startAt:peak.toISOString()},now)).price).toBe(night.price*3);
 const q=await prepareCastCharge(db,c,USER,{route:'delivery',requests:[{castId:CAST,plan:delivery.id}]},peak);
 const paid=await confirmCastCharge(db,c,q.id,USER,true,peak);expect(paid.sessions[0]!.price).toBe(600);expect(paid.sessions[0]!.menuName).toMatch(/納品：[AB]/);
});
it('延長開始で判定し、割増予約でも通常延長単価を3倍にする（9倍にしない）',async()=>{
 const r=await requestSession(db,c,{castId:CAST,customerId:USER,customerAdult:true,plan:'30',startAt:peak},now);if(r.status!=='ok')throw Error(r.status);
 await db.update(castSessions).set({status:'active',startedAt:peak,endsAt:new Date(peak.getTime()+1800000)}).where(eq(castSessions.id,r.session.id));
 const q=await prepareCastCharge(db,c,USER,{route:'extend',requests:[],sessionId:r.session.id,expectedExtensions:0},peak);
 expect(q.prices[0]).toMatchObject({base:300,price:900});
 expect((await confirmCastCharge(db,c,q.id,USER,true,peak)).sessions[0]).toMatchObject({price:1800,extensions:1,baseExtensionPrice:300});
});
it('既存予約は設定変更で再計算しない。通常時間帯への延長は通常価格',async()=>{
 const [s]=await db.insert(castSessions).values({castId:CAST,customerId:USER,plan:'30',minutes:30,price:300,status:'active',startedAt:peak,endsAt:new Date('2026-10-02T14:00:00Z')}).returning();
 const q=await prepareCastCharge(db,c,USER,{route:'extend',requests:[],sessionId:s!.id,expectedExtensions:0},peak);
 expect(q.prices[0]).toMatchObject({base:300,price:300});expect((await confirmCastCharge(db,c,q.id,USER,true,peak)).sessions[0]!.price).toBe(600);
});
it('まとめ予約の1人が失敗したら全員分の支払いと予約をロールバックする',async()=>{
 await applyCast(db,c,{id:OTHER,adult:true},{bio:'こんにちは',tags:[],price30:300,price60:500,priceNight:2000,minorOk:true},now);await setCastStatus(db,OTHER,'active','staff',now);
 const q=await prepareCastCharge(db,c,USER,{route:'group',requests:[CAST,OTHER].map(castId=>({castId,plan:'30',startAt:peak.toISOString(),groupKey:'test-group'}))},now);
 await setCastStatus(db,OTHER,'paused','staff',now);
 await expect(confirmCastCharge(db,c,q.id,USER,true,now)).rejects.toThrow();
 expect(await db.select().from(castSessions)).toHaveLength(0);expect((await walletOf(db,USER)).balance).toBe(100000);
});

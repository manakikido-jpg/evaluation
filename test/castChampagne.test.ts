import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { ChannelType, type Interaction } from 'discord.js';
import type { Db } from '../src/db/client.js';
import { castChampagnes, castSessions, coinTx } from '../src/db/schema.js';
import { CHAMPAGNES, prepareChampagne, buyChampagne, announceChampagne } from '../src/services/castChampagne.js';
import { champagnePreview, champagneAnimation } from '../src/services/castChampagneImage.js';
import { castStats, castStatement, saveCastConfig, CAST_DEFAULTS, finishSession } from '../src/services/cast.js';
import { addCoins, spendWithin, walletOf } from '../src/services/economy.js';
import { CastApp, sessionMessage } from '../src/discord/cast.js';
import { cfg, makeDb } from './helpers.js';
const CUSTOMER='880000000000000001',CAST='880000000000000002',OTHER='880000000000000003',ROOM='990000000000000001';
const NOW=new Date('2026-10-20T03:00:00Z');
let db:Db,close:()=>Promise<void>,session:typeof castSessions.$inferSelect;
const party={customerId:CUSTOMER,channelId:ROOM},here=()=>true,clock=()=>NOW;
beforeEach(async()=>{
 ({db,close}=await makeDb());
 const [s]=await db.insert(castSessions).values({castId:CAST,customerId:CUSTOMER,channelId:ROOM,plan:'30',minutes:30,price:300,status:'active',startedAt:NOW,endsAt:new Date(NOW.getTime()+30*60000)}).returning();session=s!;
 await addCoins(db,CUSTOMER,50000,'admin_grant');
});
afterEach(async()=>{vi.useRealTimers();await close();});
const quote=(b='sakura')=>prepareChampagne(db,session.id,b,party,here,clock);
it('合意した5種類の価格・配分で入金し、通話時間や予約代を変えない',async()=>{
 expect(CHAMPAGNES.map(b=>[b.name,b.price])).toEqual([['桜のしずく',500],['月夜の泡',1000],['白銀のきらめき',3000],['咲楽ロゼ',5000],['宵桜の祝杯',10000]]);
 for(const b of CHAMPAGNES){const q=await quote(b.id);expect(q.price).toBe(b.price);await buyChampagne(db,q.id,party,here,clock);}
 expect((await walletOf(db,CUSTOMER)).balance).toBe(30500);expect((await walletOf(db,CAST)).balance).toBe(17550);
 expect((await db.select().from(castSessions))[0]).toMatchObject({price:300,endsAt:session.endsAt,extensions:0,status:'active'});
 expect((await castStats(db,new Date(0),CAST))[0]).toMatchObject({count:0,earned:17550});
 const statement=await castStatement(db,CAST,new Date(0),new Date('2027-01-01'));expect(statement.total).toBe(17550);expect(statement.count).toBe(5);expect(statement.rows[0]!.label).toContain('🍾');
});
it('確認だけでは課金せず、同じ購入の同時確定は支払・受取とも1回だけ',async()=>{
 const q=await quote();expect((await walletOf(db,CUSTOMER)).balance).toBe(50000);
 const results=await Promise.all([buyChampagne(db,q.id,party,here,clock),buyChampagne(db,q.id,party,here,clock)]);
 expect(results.filter(r=>r.fresh)).toHaveLength(1);expect((await walletOf(db,CUSTOMER)).balance).toBe(49500);expect((await walletOf(db,CAST)).balance).toBe(450);
 const txs=await db.select().from(coinTx);expect(txs.filter(t=>t.reason==='champagne_pay')).toHaveLength(1);expect(txs.filter(t=>t.reason==='champagne_reward')).toHaveLength(1);
});
it('キャスト本人・第三者・別部屋・片方不在の購入を拒否する',async()=>{
 await expect(prepareChampagne(db,session.id,'sakura',{...party,customerId:CAST},here,clock)).rejects.toThrow('お客');
 await expect(prepareChampagne(db,session.id,'bad',party,here,clock)).rejects.toThrow('ボトル');
 const q=await quote();
 for(const who of [{...party,customerId:OTHER},{...party,channelId:'else'}])await expect(buyChampagne(db,q.id,who,here,clock)).rejects.toThrow('確認');
 await expect(buyChampagne(db,q.id,party,()=>false,clock)).rejects.toThrow('両方');expect((await walletOf(db,CUSTOMER)).balance).toBe(50000);
});
it('終了・期限切れ・予約中・通報中は引き落とさず、5分で確認を失効する',async()=>{
 const q=await quote();await expect(buyChampagne(db,q.id,party,here,()=>new Date(NOW.getTime()+5*60000))).rejects.toThrow('期限');
 for(const status of ['reserved','accepted','disputed','done'] as const){await db.update(castSessions).set({status}).where(eq(castSessions.id,session.id));await expect(buyChampagne(db,q.id,party,here,clock)).rejects.toThrow('通話中');}
 expect((await walletOf(db,CUSTOMER)).balance).toBe(50000);
});
it('確認後の手数料変更は表示済みの配分を変えず、次の確認から適用する',async()=>{
 const q=await quote();await saveCastConfig(db,{...CAST_DEFAULTS,feePercent:20},'staff');
 await buyChampagne(db,q.id,party,here,clock);expect((await walletOf(db,CAST)).balance).toBe(450);
 const next=await quote();expect(next.fee).toBe(100);
});
it('入金後に失敗すれば支払・購入確定も戻し、再試行できる',async()=>{
 const q=await quote();
 await db.execute(sql`CREATE FUNCTION fail_champagne() RETURNS trigger AS $$ BEGIN IF NEW.reason='champagne_reward' THEN RAISE EXCEPTION 'credit unavailable'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
 await db.execute(sql`CREATE TRIGGER fail_champagne BEFORE INSERT ON coin_tx FOR EACH ROW EXECUTE FUNCTION fail_champagne()`);
 await expect(buyChampagne(db,q.id,party,here,clock)).rejects.toThrow();expect((await walletOf(db,CUSTOMER)).balance).toBe(50000);expect((await walletOf(db,CAST)).balance).toBe(0);
 expect((await db.select().from(castChampagnes))[0]!.paidAt).toBeNull();
 await db.execute(sql`DROP TRIGGER fail_champagne ON coin_tx`);await buyChampagne(db,q.id,party,here,clock);expect((await walletOf(db,CAST)).balance).toBe(450);
});
it('古い成功ボタンは終了後も再課金しない',async()=>{
 const q=await quote();await buyChampagne(db,q.id,party,here,clock);
 await db.update(castSessions).set({status:'done'}).where(eq(castSessions.id,session.id));
 const repeat=await buyChampagne(db,q.id,party,()=>false,()=>new Date('2027-01-01'));expect(repeat.fresh).toBe(false);expect(repeat.balance).toBe(49500);
});
it('残高不足では確定せず、同じ未購入ボトルの選び直しは同じ確認を返す',async()=>{
 const [a,b]=await Promise.all([quote(),quote()]);expect(a.id).toBe(b.id);
 await spendWithin(db,CUSTOMER,49501,'admin_take');await expect(buyChampagne(db,a.id,party,here,clock)).rejects.toThrow('足りません');expect((await walletOf(db,CUSTOMER)).balance).toBe(499);
 expect((await db.select().from(castChampagnes))[0]!.paidAt).toBeNull();
});
it('開栓表示の同時実行と再試行は購入と独立し、追加課金しない',async()=>{
 const q=await quote();await buyChampagne(db,q.id,party,here,clock);
 const send=vi.fn(async()=> 'message-1');await Promise.all([announceChampagne(db,q.id,CUSTOMER,send),announceChampagne(db,q.id,CUSTOMER,send)]);expect(send).toHaveBeenCalledOnce();
 const q2=await quote('moon');await buyChampagne(db,q2.id,party,here,clock);await expect(announceChampagne(db,q2.id,CUSTOMER,async()=>{throw Error('network');})).rejects.toThrow();
 expect((await buyChampagne(db,q2.id,party,here,clock)).fresh).toBe(false);await announceChampagne(db,q2.id,CUSTOMER,send);expect((await walletOf(db,CUSTOMER)).balance).toBe(48500);
 await expect(announceChampagne(db,q2.id,OTHER,send)).rejects.toThrow();
});
it('通話終了との競合は購入済みか拒否のどちらかにそろい、通話代と重複しない',async()=>{
 const q=await quote();const result=await Promise.allSettled([buyChampagne(db,q.id,party,here,clock),finishSession(db,CAST_DEFAULTS,session.id,'system',new Date(NOW.getTime()+31*60000))]);
 const paid=result[0]!.status==='fulfilled';expect((await walletOf(db,CUSTOMER)).balance).toBe(50000-(paid?500:0));expect((await walletOf(db,CAST)).balance).toBe(270+(paid?450:0));
});
it('5種類のプレビューと8フレームの開栓GIFを描く',async()=>{
 for(const b of CHAMPAGNES){expect(await sharp(champagnePreview(b.id)).metadata()).toMatchObject({width:720,height:420,format:'png'});const gif=await champagneAnimation(b.id);expect(gif.length).toBeLessThan(2*1024*1024);expect(await sharp(gif,{animated:true}).metadata()).toMatchObject({width:720,pageHeight:420,pages:8,format:'gif'});}
},30000);
it('通話の5つ目の操作から選択・確認・乾杯し、同時確定でも投稿と入金は1回だけ',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(NOW);
 expect(JSON.stringify(sessionMessage(session,CAST_DEFAULTS,'銭'))).toContain(`cast:champagne:${session.id}`);
 const sendMessage=vi.fn(async()=>({id:'notice-1'}));const states=new Map([[CUSTOMER,{channelId:ROOM}],[CAST,{channelId:ROOM}]]);
 const app=new CastApp(db,()=>cfg,{sendMessage} as never);app.attach({id:cfg.guildId,voiceStates:{cache:states},channels:{cache:new Map([[ROOM,{id:ROOM,type:ChannelType.GuildVoice}]])}} as never);
 function interaction(customId:string,select=false){return {customId,guildId:cfg.guildId,channelId:ROOM,user:{id:CUSTOMER},inCachedGuild:()=>true,isStringSelectMenu:()=>select,isUserSelectMenu:()=>false,isModalSubmit:()=>false,isButton:()=>!select,isRepliable:()=>true,values:['sakura'],deferReply:vi.fn(),deferUpdate:vi.fn(),editReply:vi.fn(),followUp:vi.fn()};}
 const menu=interaction(`cast:champagne:${session.id}`);await app.onInteraction(menu as unknown as Interaction);expect(JSON.stringify(menu.editReply.mock.calls)).toContain('桜のしずく');
 const select=interaction(`cast:champagnesel:${session.id}`,true);await app.onInteraction(select as unknown as Interaction);expect(JSON.stringify(select.editReply.mock.calls)).toContain('キャスト受取 450');
 const [q]=await db.select().from(castChampagnes);const one=interaction(`cast:champagnebuy:${q!.id}`),two=interaction(`cast:champagnebuy:${q!.id}`);
 await Promise.all([app.onInteraction(one as unknown as Interaction),app.onInteraction(two as unknown as Interaction)]);
 expect(sendMessage).toHaveBeenCalledOnce();expect((await walletOf(db,CUSTOMER)).balance).toBe(49500);expect((await walletOf(db,CAST)).balance).toBe(450);
 const payload=sendMessage.mock.calls[0] as unknown as [string,{nonce:string;enforce_nonce:boolean;allowed_mentions:unknown}];expect(payload[0]).toBe(ROOM);expect(payload[1].nonce.length).toBeLessThanOrEqual(25);expect(payload[1].enforce_nonce).toBe(true);expect(payload[1].allowed_mentions).toEqual({parse:[]});
 const moon=interaction(`cast:champagnesel:${session.id}`,true);moon.values=['moon'];await app.onInteraction(moon as unknown as Interaction);
 const q2=(await db.select().from(castChampagnes)).find(p=>p.bottle==='moon')!;
 sendMessage.mockRejectedValueOnce(new Error('network unavailable'));
 const failed=interaction(`cast:champagnebuy:${q2.id}`);await app.onInteraction(failed as unknown as Interaction);expect(JSON.stringify(failed.editReply.mock.calls)).toContain('開栓表示を確認・再試行');
 const retry=interaction(`cast:champagnebuy:${q2.id}`);await app.onInteraction(retry as unknown as Interaction);expect(JSON.stringify(retry.editReply.mock.calls)).toContain('追加の支払いはありません');
 expect((await walletOf(db,CUSTOMER)).balance).toBe(48500);expect((await walletOf(db,CAST)).balance).toBe(1350);expect(sendMessage).toHaveBeenCalledTimes(3);
 states.delete(CAST);const absent=interaction(`cast:champagne:${session.id}`);await app.onInteraction(absent as unknown as Interaction);expect(JSON.stringify(absent.editReply.mock.calls)).toContain('両方');

});

import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {eq} from 'drizzle-orm';
import {makeDb} from './helpers.js';
import type {Db} from '../src/db/client.js';
import {members,eventLotteries,eventLotteryDraws,coinTx,eventLotteryNotices} from '../src/db/schema.js';
import {addCoins,walletOf} from '../src/services/economy.js';
import * as economy from '../src/services/economy.js';
import {createEventLottery,eventLotteryView,enterEventLottery,changeEventLottery,drawEventLottery,markEventDelivered,sendEventLotteryNotices,retryEventLotteryNotices,refreshEventLotteryPanel} from '../src/services/eventLottery.js';
let db:Db,close:()=>Promise<void>,id:string;const now=new Date('2026-11-08T04:00:00Z');
beforeEach(async()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now);({db,close}=await makeDb());for(const id of ['a','b','c']){await db.insert(members).values({id,username:id,displayName:id});await addCoins(db,id,1000,'adjust');}id=await createEventLottery(db,{name:'イベント',fee:100,channelId:'100000000000000001',resultChannelId:'100000000000000002',prizes:[{name:'景品',count:2,coins:200,item:'品物'}]},'guji');});afterEach(async()=>{vi.useRealTimers();await close();});
const state=()=>eventLotteryView(db,id);const action=async(a:string)=>changeEventLottery(db,id,'guji',(await state()).event.version,a);
async function draw(op=randomUUID(),at=now){const e=(await state()).event;return drawEventLottery(db,id,e.prizes[0]!.id,'guji',e.version,op,at,()=>0);}
it('受付/銭/一人一口/残高不足を原子的に扱い、受付後は登録内容を変えない',async()=>{
 await expect(enterEventLottery(db,id,'a','A')).rejects.toThrow('受付中');await action('open');await enterEventLottery(db,id,'a','A');await enterEventLottery(db,id,'a','A');expect((await walletOf(db,'a')).balance).toBe(900);await db.insert(members).values({id:'poor',username:'poor',displayName:'poor'});await expect(enterEventLottery(db,id,'poor','poor')).rejects.toThrow('足りません');expect((await state()).participants).toHaveLength(1);await action('close');await expect(enterEventLottery(db,id,'b','B')).rejects.toThrow('受付中');
});
it('中止で全額一度だけ返金し、再操作でも銭は増えない',async()=>{await action('open');await enterEventLottery(db,id,'a','A');await enterEventLottery(db,id,'b','B');await action('cancel');expect((await walletOf(db,'a')).balance).toBe(1000);expect((await state()).refunded).toBe(200);await expect(action('cancel')).rejects.toThrow();expect((await walletOf(db,'b')).balance).toBe(1000);});
it('一人ずつ当選、同じ操作IDで賞金を重複付与せず、再開と受け渡しを保つ',async()=>{await action('open');for(const p of ['a','b','c'])await enterEventLottery(db,id,p,p);await action('close');const e=(await state()).event,op=randomUUID();const first=await draw(op);expect((await walletOf(db,first.memberId)).balance).toBe(1100);const again=await drawEventLottery(db,id,e.prizes[0]!.id,'guji',e.version,op,now,()=>0);expect(again.id).toBe(first.id);expect((await walletOf(db,first.memberId)).balance).toBe(1100);await expect(action('cancel')).rejects.toThrow();await expect(action('complete')).rejects.toThrow();await draw(randomUUID(),new Date(now.getTime()+4000));expect(new Set((await state()).results.map(r=>r.memberId)).size).toBe(2);await expect(draw(randomUUID(),new Date(now.getTime()+8000))).rejects.toThrow('残って');await markEventDelivered(db,id,first.id,'guji');expect((await state()).results[0]!.delivered).toBe(true);await action('complete');});
it('別操作IDでも古い版からの抽選は次を引かず、対象者ゼロを処理する',async()=>{await action('open');await action('close');await expect(draw()).rejects.toThrow('対象者');await action('complete');});
it('通知失敗でも当選と賞金を保ち、3秒後の通知だけ再送する',async()=>{await action('open');await enterEventLottery(db,id,'a','A');await action('close');await draw();let calls=0;await sendEventLotteryNotices(db,async()=>{calls++;throw Error('down');},new Date(now.getTime()+10000));expect((await state()).results).toHaveLength(1);expect((await walletOf(db,'a')).balance).toBe(1100);await retryEventLotteryNotices(db,id,'guji');await sendEventLotteryNotices(db,async(_channel,body)=>{expect(body.allowed_mentions).toEqual({parse:[]});return {id:'message'};},new Date('2027-01-01'));expect((await state()).messages.every(n=>n.sentAt)).toBe(true);await sendEventLotteryNotices(db,async()=>{throw Error('must not resend');},new Date('2027-01-01'));expect(calls).toBeGreaterThan(0);});
it('残数があっても残る参加者が退出済みなら完了できる',async()=>{await action('open');await enterEventLottery(db,id,'a','A');await enterEventLottery(db,id,'b','B');await action('close');await draw();await db.update(members).set({leftAt:now}).where(eq(members.id,'b'));await action('complete');});
it('同時参加と同じ版の同時抽選でも二重徴収・二重抽選しない',async()=>{await action('open');await Promise.all([enterEventLottery(db,id,'a','A'),enterEventLottery(db,id,'a','A')]);expect((await walletOf(db,'a')).balance).toBe(900);await enterEventLottery(db,id,'b','B');await action('close');const e=(await state()).event;const rs=await Promise.allSettled([drawEventLottery(db,id,e.prizes[0]!.id,'guji',e.version,randomUUID(),now,()=>0),drawEventLottery(db,id,e.prizes[0]!.id,'guji',e.version,randomUUID(),now,()=>0)]);expect(rs.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await state()).results).toHaveLength(1);});
it('制限アカウントや退出者は受付・抽選に入らない',async()=>{const {setStaffAlt}=await import('../src/services/staffAlts.js');await action('open');await setStaffAlt(db,'c',true,'operator','operator','test');await expect(enterEventLottery(db,id,'c','C')).rejects.toThrow('アカウント');await db.update(members).set({leftAt:now}).where(eq(members.id,'b'));await expect(enterEventLottery(db,id,'b','B')).rejects.toThrow('アカウント');await expect(enterEventLottery(db,id,'missing','M')).rejects.toThrow('アカウント');});
it('発表を3秒待ち、再送も同じnonceで通知し、賞金をやり直さない',async()=>{await action('open');await enterEventLottery(db,id,'a','A');await action('close');const drawn=await draw();await retryEventLotteryNotices(db,id,'operator');await sendEventLotteryNotices(db,async()=>({id:'panel'}),new Date(now.getTime()+2000));expect((await state()).messages.find(n=>n.id===drawn.id)!.sentAt).toBeNull();const nonces:unknown[]=[];await sendEventLotteryNotices(db,async(_c,b)=>{nonces.push(b.nonce);throw Error('network');},new Date(now.getTime()+4000));await retryEventLotteryNotices(db,id,'operator');await sendEventLotteryNotices(db,async(_c,b)=>{nonces.push(b.nonce);expect(b.enforce_nonce).toBe(true);return {id:'result'};},new Date('2027-01-01'));expect(nonces).toHaveLength(2);expect(nonces[0]).toBe(nonces[1]);expect((await walletOf(db,'a')).balance).toBe(1100);});

it('返金の事前検査後に制限へ変わり銭APIが入金を省略したら、中止全体を戻す',async()=>{
 await action('open');for(const p of ['a','b'])await enterEventLottery(db,id,p,p);
 const {setStaffAlt}=await import('../src/services/staffAlts.js');const realAdd=economy.addCoins;
 // 検査と入金の間に制限変更が確定した順序を再現する。入金API自体は実物を使う。
 const spy=vi.spyOn(economy,'addCoins').mockImplementation(async(tx,memberId,amount,reason,detail)=>{
  if(reason==='event_refund'&&memberId==='b')await setStaffAlt(tx,'b',true,'operator');
  return realAdd(tx,memberId,amount,reason,detail);
 });
 try{await expect(action('cancel')).rejects.toThrow('返金を確認できません');}finally{spy.mockRestore();}
 const v=await state();expect(v.event.state).toBe('open');expect(v.refunded).toBe(0);expect(v.participants.every(p=>!p.refunded)).toBe(true);
 expect((await walletOf(db,'a')).balance).toBe(900);expect((await walletOf(db,'b')).balance).toBe(900);
 expect(await db.select().from(coinTx).where(eq(coinTx.reason,'event_refund'))).toHaveLength(0);
 await action('cancel');expect((await state()).refunded).toBe(200);expect((await walletOf(db,'b')).balance).toBe(1000);
});
it('景品説明が長くても受付でき、受付パネルへ景品を載せない',async()=>{
 const secret='非公開の景品';const longId=await createEventLottery(db,{name:'催し',fee:100,channelId:'100000000000000001',resultChannelId:'100000000000000002',prizes:Array.from({length:10},(_,i)=>({name:secret+i,count:1,coins:200,item:'秘'.repeat(210)}))},'guji');
 await changeEventLottery(db,longId,'guji',0,'open');const v=await eventLotteryView(db,longId);expect(v.event.state).toBe('open');expect(v.event.prizes).toHaveLength(10);expect(v.event.prizes[0]!.item).toHaveLength(210);
 const body=v.messages[0]!.body as {content:string;components:unknown[]};expect(body.content).toContain('催し');expect(body.content).toContain('参加費：100銭');expect(JSON.stringify(body)).not.toContain(secret);expect(JSON.stringify(body)).not.toContain('200銭');expect(JSON.stringify(body)).not.toContain('秘');expect(body.components).toHaveLength(1);
 await enterEventLottery(db,longId,'a','A');expect((await walletOf(db,'a')).balance).toBe(900);
});
it('旧版の景品付き送信待ちパネルも失敗/再送時に景品を隠す',async()=>{
 await action('open');const n=(await state()).messages[0]!;const old={...n.body,content:'催し\n参加費：100銭\n景品：非公開品×2（200銭＋秘密の受け渡し）'};await db.update(eventLotteryNotices).set({body:old}).where(eq(eventLotteryNotices.id,n.id));
 const received:Record<string,unknown>[]=[];await sendEventLotteryNotices(db,async(_c,b)=>{received.push(b);throw Error('down');},now);await retryEventLotteryNotices(db,id,'guji');await sendEventLotteryNotices(db,async(_c,b)=>{received.push(b);return {id:'panel'};},now,async(_c,_m,b)=>{received.push(b);});
 expect(received).toHaveLength(3);for(const b of received){expect(JSON.stringify(b)).not.toMatch(/非公開品|秘密の受け渡し|200銭/);expect(String(b.content)).toContain('参加費：100銭');}
 expect((await state()).messages[0]!.sentAt).not.toBeNull();
});
it('公開済みパネルは同じ投稿を更新し、更新失敗の再送でも投稿/徴収を重複しない',async()=>{
 await action('open');await enterEventLottery(db,id,'a','A');await sendEventLotteryNotices(db,async()=>({id:'existing-panel'}),now,async()=>{});await refreshEventLotteryPanel(db,id,'guji');let sends=0,edits=0;
 const send=async()=>{sends++;return {id:'duplicate'};};await sendEventLotteryNotices(db,send,now,async()=>{edits++;throw Error('down');});let v=await state();expect(v.messages[0]!.messageId).toBe('existing-panel');expect(v.messages[0]!.sentAt).toBeNull();
 await retryEventLotteryNotices(db,id,'guji');await sendEventLotteryNotices(db,send,now,async(_c,m,b)=>{edits++;expect(m).toBe('existing-panel');expect(String(b.content)).not.toContain('景品');});
 expect(sends).toBe(0);expect(edits).toBe(2);v=await state();expect(v.messages[0]!.sentAt).not.toBeNull();expect(v.participants).toHaveLength(1);expect(v.results).toHaveLength(0);expect((await walletOf(db,'a')).balance).toBe(900);
 await action('close');await expect(refreshEventLotteryPanel(db,id,'guji')).rejects.toThrow('受付中');
});

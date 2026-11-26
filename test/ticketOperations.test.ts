import {beforeEach,afterEach,describe,it,expect} from 'vitest';
import {eq,and} from 'drizzle-orm';
import type {Db} from '../src/db/client.js';
import {makeDb} from './helpers.js';
import {loadTicketConfig,saveTicketConfig,openTicket,getTicket,setQuote,payQuote,setTicketChannel} from '../src/services/supportTickets.js';
import {addCoins,walletOf} from '../src/services/economy.js';
import {ticketOperations,ticketNotices,ticketEvents,supportTickets} from '../src/db/schema.js';
import * as op from '../src/services/ticketOperations.js';
const U='870000000000000101',S='870000000000000102',S2='870000000000000103',A='870000000000000104',R='870000000000000201';
const user={id:U,roles:[],admin:false},staff={id:S,roles:[R],admin:false},other={id:S2,roles:[R],admin:false},admin={id:A,roles:[],admin:true};
const T=new Date('2026-11-26T00:00:00Z'),H=3600000;
let db:Db,close:()=>Promise<void>;
beforeEach(async()=>{({db,close}=await makeDb());const c=await loadTicketConfig(db);await saveTicketConfig(db,{...c,types:c.types.map(t=>({...t,roleIds:[R]}))},A);});
afterEach(async()=>close());
async function create(body='内容',requestId='one',urgent=false){const c=await loadTicketConfig(db);const r=await openTicket(db,c,{openerId:U,typeKey:'inquiry',answers:[{q:'内容',a:body}],managed:true,requestId,urgent},T);if(r.status!=='ok')throw new Error(r.status);return r.ticket.id;}
async function notices(){return db.select().from(ticketNotices);}
async function resolve(id:number){await op.claimOperation(db,id,staff,T);await op.requestResolution(db,id,staff,'対応内容と結果',new Date(+T+H));await op.confirmResolution(db,id,user,new Date(+T+2*H));}

describe('チケット運用',()=>{
 it('期限は共通＋種類別で受付時に固定し、設定変更が既存案件へ及ばない',async()=>{
  const c=await loadTicketConfig(db);await saveTicketConfig(db,{...c,workflow:{firstReplyHours:12},types:c.types.map(t=>t.key==='inquiry'?{...t,workflow:{userCloseHours:240}}:t)},A);
  const id=await create();expect((await op.operationOf(db,id))!.policy).toMatchObject({firstReplyHours:12,userCloseHours:240,retentionDays:180});
  await saveTicketConfig(db,{...c,workflow:{firstReplyHours:2}},A);expect((await op.operationOf(db,id))!.policy.firstReplyHours).toBe(12);
 });
 it('同じ作成IDは1件、同じ種類の別件は新規。旧方式の1種類1件は維持',async()=>{
  const id=await create();const c=await loadTicketConfig(db);
  const repeated=await openTicket(db,c,{openerId:U,typeKey:'soudan',answers:[{q:'別',a:'違う'}],managed:true,requestId:'one'},T);
  expect(repeated.status).toBe('already');if(repeated.status==='already')expect(repeated.ticket.id).toBe(id);
  const next=await create('別の内容','two');expect(next).not.toBe(id);
  expect((await openTicket(db,c,{openerId:U,typeKey:'inquiry',answers:[{q:'内容',a:'legacy'}]},T)).status).toBe('already');
 });
 it('主担当の同時取得は1人だけ。本人の自己担当を拒否する',async()=>{
  const id=await create();await expect(op.claimOperation(db,id,{...user,roles:[R],admin:true},T)).rejects.toThrow();
  const results=await Promise.allSettled([op.claimOperation(db,id,staff,T),op.claimOperation(db,id,other,T)]);
  expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect([S,S2]).toContain((await getTicket(db,id))!.assigneeId);
 });
 it('引き継ぎは承諾まで旧担当を維持。別の人の承諾や一般担当者の強制変更は拒否',async()=>{
  const id=await create();await op.claimOperation(db,id,staff,T);await op.requestHandoff(db,id,staff,S2,'交代',T);
  expect((await getTicket(db,id))!.assigneeId).toBe(S);expect((await notices()).some(n=>n.kind==='handoff_request')).toBe(true);
  await expect(op.acceptHandoff(db,id,staff,T)).rejects.toThrow();await expect(op.requestHandoff(db,id,staff,S2,'強制',T,true)).rejects.toThrow();
  await op.acceptHandoff(db,id,other,T);expect((await getTicket(db,id))!.assigneeId).toBe(S2);
 });
 it('宮司・神職の担当変更は理由必須。当事者を指定すると担当から外れ、判断・内部表示も不可',async()=>{
  const id=await create();await op.claimOperation(db,id,staff,T);
  await expect(op.requestHandoff(db,id,admin,S2,'',T,true)).rejects.toThrow();
  await op.requestHandoff(db,id,admin,S2,'不在のため',T,true);expect((await getTicket(db,id))!.assigneeId).toBe(S2);
  await op.setTicketSubjects(db,id,admin,[S2],'対象者のため',T);
  expect((await getTicket(db,id))!.assigneeId).toBeNull();expect((await op.operationOf(db,id))!.state).toBe('unassigned');
  await expect(op.ticketContext(db,id,other)).rejects.toThrow();
 });
 it('自動受付・内部メモは初回返信にならず、24h/48hは各1回だけ通知登録する',async()=>{
  const id=await create();await op.claimOperation(db,id,staff,T);await op.addOperationMessage(db,id,staff,'内部',true,new Date(+T+H));
  expect((await op.operationOf(db,id))!.firstReplyAt).toBeNull();
  await op.scheduleTicketNotices(db,new Date(+T+48*H));await op.scheduleTicketNotices(db,new Date(+T+49*H));
  expect((await notices()).filter(n=>n.kind==='first')).toHaveLength(1);expect((await notices()).filter(n=>n.kind==='escalate')).toHaveLength(1);
  await op.addOperationMessage(db,id,staff,'お待たせしました',false,new Date(+T+50*H));
  expect(await op.noticeStillNeeded(db,(await notices()).find(n=>n.kind==='first')!)).toBe(false);
 });
 it('返信待ちは3日で確認、回答後は対応中に戻り古い通知を送らない',async()=>{
  const id=await create();await op.claimOperation(db,id,staff,T);await op.addOperationMessage(db,id,staff,'質問',false,T);await op.setOperationState(db,id,staff,'user_wait',T);
  await op.scheduleTicketNotices(db,new Date(+T+72*H));const reminder=(await notices()).find(n=>n.kind==='user_reminder')!;expect(reminder).toBeDefined();
  await op.addOperationMessage(db,id,user,'回答',false,new Date(+T+73*H));expect((await op.operationOf(db,id))!.state).toBe('active');expect(await op.noticeStillNeeded(db,reminder)).toBe(false);
  await op.scheduleTicketNotices(db,new Date(+T+168*H));expect((await getTicket(db,id))!.status).toBe('open');
 });
 it('過去の返信の取り込みで、後から始めた返信待ちや進捗時刻を巻き戻さない',async()=>{
  const id=await create();await op.claimOperation(db,id,staff,T);await op.setOperationState(db,id,staff,'user_wait',new Date(+T+3*H));
  await op.addOperationMessage(db,id,user,'以前の返信',false,new Date(+T+H));
  const o=(await op.operationOf(db,id))!;expect(o.state).toBe('user_wait');expect(+o.progressAt).toBe(+T+3*H);
 });
 it('返信なし7日で自動終了。運営内確認待ちは自動終了しない',async()=>{
  const id=await create();await op.claimOperation(db,id,staff,T);await op.setOperationState(db,id,staff,'user_wait',T);
  await op.scheduleTicketNotices(db,new Date(+T+168*H));expect((await getTicket(db,id))!.closeReason).toBe('no_reply');
  const otherId=await create('他','two');await op.claimOperation(db,otherId,staff,T);await op.setOperationState(db,otherId,staff,'internal_wait',T);
  await op.scheduleTicketNotices(db,new Date(+T+30*24*H));expect((await getTicket(db,otherId))!.status).toBe('open');
 });
 it('Discordの返信確認に失敗した場合は自動終了を保留できる',async()=>{
  const id=await create();await op.claimOperation(db,id,staff,T);await op.setOperationState(db,id,staff,'user_wait',T);
  await op.scheduleTicketNotices(db,new Date(+T+168*H),async()=>false);expect((await getTicket(db,id))!.status).toBe('open');
 });
 it('預り銭がある依頼は自動終了せず、手動完了の返金は1回だけ',async()=>{
  const id=await create();await addCoins(db,U,100,'adjust');await setQuote(db,id,S,50,'期限');expect((await payQuote(db,id,U,50)).status).toBe('ok');
  await op.claimOperation(db,id,staff,T);await op.setOperationState(db,id,staff,'user_wait',T);await op.scheduleTicketNotices(db,new Date(+T+168*H));expect((await getTicket(db,id))!.status).toBe('open');
  await op.requestResolution(db,id,staff,'取りやめに合意',T);await op.confirmResolution(db,id,user,T);
  await op.closeOperation(db,id,staff,T);await op.closeOperation(db,id,staff,T);expect((await walletOf(db,U)).balance).toBe(100);
 });
 it('要約と相談者確認なしの完了を拒否。内部メモは公開transcriptに入れない',async()=>{
  const id=await create();await op.claimOperation(db,id,staff,T);await expect(op.closeOperation(db,id,staff,T)).rejects.toThrow();
  await op.addOperationMessage(db,id,staff,'秘密の内部確認',true,T);await op.requestResolution(db,id,staff,'解決案',T);
  await expect(op.confirmResolution(db,id,staff,T)).rejects.toThrow();await op.confirmResolution(db,id,user,T);await op.closeOperation(db,id,staff,T);
  expect((await getTicket(db,id))!.transcript).not.toContain('秘密の内部確認');expect((await getTicket(db,id))!.closeReason).toBe('resolved');
 });
 it('本人は内部メモを書けず、補助担当は状態変更・完了できない',async()=>{
  const id=await create();await op.claimOperation(db,id,staff,T);
  await expect(op.addOperationMessage(db,id,user,'秘密',true,T)).rejects.toThrow();await expect(op.setOperationState(db,id,other,'user_wait',T)).rejects.toThrow();
 });
 it('再開は担当を決め直し、履歴と受付時設定を維持。古いサイクルの通知は無効',async()=>{
  const id=await create();await resolve(id);await op.closeOperation(db,id,staff,new Date(+T+3*H));const old=(await notices())[0]!;
  const c=await loadTicketConfig(db);await saveTicketConfig(db,{...c,workflow:{firstReplyHours:10}},A);
  const later=new Date(+T+24*H);await op.reopenOperation(db,id,user,later);
  const o=(await op.operationOf(db,id))!;expect(o).toMatchObject({state:'unassigned',cycle:1,firstReplyAt:null});expect(+o.openedAt).toBe(+later);expect(o.policy.firstReplyHours).toBe(24);
  expect((await getTicket(db,id))!.assigneeId).toBeNull();expect(await op.noticeStillNeeded(db,old)).toBe(false);
  expect((await db.select().from(ticketEvents).where(eq(ticketEvents.ticketId,id))).some(e=>e.kind==='confirmed')).toBe(true);
 });
 it('緊急の通知は1回。解除して再指定した場合は新しい通知を登録できる',async()=>{
  const id=await create('内容','one',true);await op.scheduleTicketNotices(db,T);expect((await notices()).filter(n=>n.kind==='urgent')).toHaveLength(1);
  await op.setTicketUrgency(db,id,user,false,T);await op.setTicketUrgency(db,id,user,true,T);await op.scheduleTicketNotices(db,T);
  expect((await notices()).filter(n=>n.kind==='urgent')).toHaveLength(2);
 });
 it('通知リースで二重取得を防ぎ、失敗は5分後に再試行する',async()=>{
  await create('内容','one',true);const [a,b]=await Promise.all([op.takeTicketNotice(db,T),op.takeTicketNotice(db,T)]);expect([a,b].filter(Boolean)).toHaveLength(1);
  const n=(a??b)!;await op.finishTicketNotice(db,n.id,false,T);expect(await op.takeTicketNotice(db,new Date(+T+H/60))).toBeUndefined();
  const retry=await op.takeTicketNotice(db,new Date(+T+5*H/60));expect(retry!.id).toBe(n.id);await op.finishTicketNotice(db,n.id,true,new Date(+T+5*H/60));expect(await op.takeTicketNotice(db,new Date(+T+H))).toBeUndefined();
 });
 it('保存延長と期限到達の削除。期限切れ後は閲覧・再開できない',async()=>{
  const id=await create();await resolve(id);await op.closeOperation(db,id,staff,T);
  await expect(op.extendTicketRetention(db,id,staff,10,T)).rejects.toThrow();await op.extendTicketRetention(db,id,admin,10,T);
  expect(await op.purgeExpiredTickets(db,new Date(+T+180*24*H))).toBe(0);
  await op.purgeExpiredTickets(db,new Date(+T+191*24*H));await expect(op.ticketContext(db,id,user)).rejects.toThrow();await expect(op.reopenOperation(db,id,user)).rejects.toThrow();
  expect((await getTicket(db,id))!.transcript).toBeNull();expect((await db.select().from(ticketEvents).where(eq(ticketEvents.ticketId,id)))).toHaveLength(0);
 });
});

it('主担当の強制割当で未対応を解除し、人が書いた対応結果は初回返信に数える',async()=>{
 const id=await create();await op.requestHandoff(db,id,admin,S,'担当の割当',T,true);expect((await op.operationOf(db,id))!.state).toBe('active');
 await op.requestResolution(db,id,staff,'本人へ対応結果を案内',new Date(+T+H));expect((await op.operationOf(db,id))!.firstReplyAt).toEqual(new Date(+T+H));
});

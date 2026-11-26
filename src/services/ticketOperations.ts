import { and, asc, eq, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { supportTickets, ticketOperations, ticketEvents, ticketNotices } from '../db/schema.js';
import { TICKET_STATE_LABELS, type TicketWorkflowState } from '../domain/ticketPolicy.js';
import { closeTicket, loadTicketConfig, ticketTypeOf } from './supportTickets.js';
export type TicketActor = { id: string; roles: string[]; admin: boolean };
export class TicketOperationError extends Error { constructor(message: string, public status: 400|403|404|409 = 400) { super(message); } }
export async function operationOf(db: Db, id: number) { return (await db.select().from(ticketOperations).where(eq(ticketOperations.ticketId,id)))[0]; }
export async function ticketContext(db: Db, id: number, actor: TicketActor) {
  if(!Number.isSafeInteger(id)||id<1)throw new TicketOperationError('チケットが見つかりません。',404);
  const [ticket, op, conf] = await Promise.all([db.select().from(supportTickets).where(eq(supportTickets.id,id)).then(r=>r[0]),operationOf(db,id),loadTicketConfig(db)]);
  if (!ticket || !op || op.expiredAt) throw new TicketOperationError('チケットが見つかりません。',404);
  const owner=actor.id===ticket.openerId, involved=owner || op.subjectIds.includes(actor.id);
  const roles=ticketTypeOf(conf,ticket.typeKey)?.roleIds ?? op.roleIds;
  const staff=!involved && (actor.admin || actor.roles.some(r=>roles.includes(r)));
  if (!owner && !staff) throw new TicketOperationError('チケットが見つかりません。',404);
  return {ticket,op,owner,staff,admin:actor.admin&&!involved,manager:staff&&(actor.admin||ticket.assigneeId===actor.id)};
}
export async function recordTicketEvent(db: Db,id:number,actorId:string,kind:string,body:string,internal=false,dedupe?:string,now=new Date()) {
  return (await db.insert(ticketEvents).values({ticketId:id,actorId,kind,body:body.slice(0,16000),internal,dedupe,createdAt:now}).onConflictDoNothing().returning())[0];
}
export async function notice(db:Db,id:number,key:string,kind:string,target:'user'|'owner'|'admin'|'channel',body:string,now=new Date()) {
  const o=await operationOf(db,id);if(!o||o.expiredAt)return;
  await db.insert(ticketNotices).values({ticketId:id,cycle:o.cycle,dedupe:key,kind,target,body,nextTryAt:now}).onConflictDoNothing();
}
async function change<T>(db:Db,id:number,actor:TicketActor,fn:(tx:Db,c:Awaited<ReturnType<typeof ticketContext>>)=>Promise<T>) {
  return db.transaction(async tx=>{
    await tx.select().from(supportTickets).where(eq(supportTickets.id,id)).for('update');
    await tx.select().from(ticketOperations).where(eq(ticketOperations.ticketId,id)).for('update');
    return fn(tx as unknown as Db,await ticketContext(tx as unknown as Db,id,actor));
  });
}
export async function claimOperation(db:Db,id:number,actor:TicketActor,now=new Date()) {
  return change(db,id,actor,async(tx,c)=>{
    if(!c.staff)throw new TicketOperationError('担当権限が必要です。',403);
    if(c.ticket.status!=='open')throw new TicketOperationError('完了しています。',409);
    if(c.ticket.assigneeId&&c.ticket.assigneeId!==actor.id)throw new TicketOperationError('担当済みです。引き継ぎ依頼・承諾を使ってください。',409);
    if(c.ticket.assigneeId===actor.id)return;
    await tx.update(supportTickets).set({assigneeId:actor.id}).where(eq(supportTickets.id,id));
    await tx.update(ticketOperations).set({state:'active',stateAt:now,progressAt:now}).where(eq(ticketOperations.ticketId,id));
    await recordTicketEvent(tx,id,actor.id,'claim','主担当を決定しました。',false,undefined,now);
    await notice(tx,id,`${c.op.cycle}:claim:${actor.id}`,'update','user','主担当が決まりました。',now);
  });
}
export async function setOperationState(db:Db,id:number,actor:TicketActor,state:TicketWorkflowState,now=new Date()) {
  return change(db,id,actor,async(tx,c)=>{
    if(!c.manager)throw new TicketOperationError('主担当・宮司・神職だけが状態を変えられます。',403);
    if(c.ticket.status!=='open'||!['active','user_wait','internal_wait'].includes(state))throw new TicketOperationError('この状態には変更できません。',409);
    if(state===c.op.state)return;
    await tx.update(ticketOperations).set({state,stateAt:now,progressAt:now,closeSummary:null,resolutionConfirmedAt:null}).where(eq(ticketOperations.ticketId,id));
    await recordTicketEvent(tx,id,actor.id,'state',`状態を「${TICKET_STATE_LABELS[state]}」に変更しました。`,false,undefined,now);
    await notice(tx,id,`state:${now.toISOString()}`,'update','user','チケットの状態が更新されました。',now);
  });
}
export async function addOperationMessage(db:Db,id:number,actor:TicketActor,body:string,internal:boolean,now=new Date(),dedupe?:string) {
  if(!body.trim()||body.length>8000)throw new TicketOperationError('本文は1〜8,000文字にしてください。');
  return change(db,id,actor,async(tx,c)=>{
    if(c.ticket.status!=='open')throw new TicketOperationError('完了しています。先に再開してください。',409);
    if(internal&&!c.staff)throw new TicketOperationError('内部メモは運営だけが記録できます。',403);
    const event=await recordTicketEvent(tx,id,actor.id,internal?'note':'message',body,internal,dedupe,now);if(!event)return;
    const userReply=c.owner&&!internal;
    await tx.update(ticketOperations).set({progressAt:new Date(Math.max(+now,+c.op.progressAt)),...(c.staff&&!internal?{firstReplyAt:c.op.firstReplyAt?new Date(Math.min(+c.op.firstReplyAt,+now)):now}:{}),...(userReply&&c.op.state==='user_wait'&&now>=c.op.stateAt?{state:'active' as const,stateAt:now,closeSummary:null,resolutionConfirmedAt:null}:{})}).where(eq(ticketOperations.ticketId,id));
    if(!internal)await tx.update(supportTickets).set(userReply?{lastUserAt:new Date(Math.max(+now,c.ticket.lastUserAt?+c.ticket.lastUserAt:0)),idleWarnedAt:null}:{lastStaffAt:new Date(Math.max(+now,c.ticket.lastStaffAt?+c.ticket.lastStaffAt:0))}).where(eq(supportTickets.id,id));
    const alert=now>=c.op.progressAt||userReply&&c.op.state==='user_wait'&&now>=c.op.stateAt;
    if(userReply&&alert)await notice(tx,id,`reply:${event.id}`,'update','owner','相談者から返信がありました。',now);
    else if(!internal&&alert)await notice(tx,id,`reply:${event.id}`,'update','user','チケットに返信がありました。',now);
    return event;
  });
}
export async function requestHandoff(db:Db,id:number,actor:TicketActor,to:string,reason:string,now=new Date(),force=false) {
  if(!/^\d{17,20}$/.test(to)||!reason.trim())throw new TicketOperationError('引き継ぎ先と理由が必要です。');
  return change(db,id,actor,async(tx,c)=>{
    if(!c.manager||force&&!c.admin)throw new TicketOperationError('担当変更の権限が必要です。',403);
    if(c.ticket.status!=='open'||c.op.subjectIds.includes(to)||to===c.ticket.openerId)throw new TicketOperationError('その人は担当にできません。');
    if(force)await tx.update(supportTickets).set({assigneeId:to}).where(eq(supportTickets.id,id));
    await tx.update(ticketOperations).set({handoffTo:force?null:to,handoffBy:force?null:actor.id,handoffReason:force?null:reason.slice(0,1000),progressAt:now,...(force&&c.op.state==='unassigned'?{state:'active' as const,stateAt:now}:{})}).where(eq(ticketOperations.ticketId,id));
    await recordTicketEvent(tx,id,actor.id,force?'handoff_force':'handoff_request',`引き継ぎ先: ${to}\n理由: ${reason}`,true,undefined,now);
    if(!force)await notice(tx,id,`handoff_request:${now.toISOString()}`,'handoff_request','owner','主担当の引き継ぎ依頼があります。管理画面から承諾してください。',now);
    if(force)await notice(tx,id,`handoff:${now.toISOString()}`,'update','user','主担当が変更されました。',now);
  });
}
export async function acceptHandoff(db:Db,id:number,actor:TicketActor,now=new Date()) {
  return change(db,id,actor,async(tx,c)=>{
    if(!c.staff||c.op.handoffTo!==actor.id||c.ticket.status!=='open')throw new TicketOperationError('引き継ぎ対象ではありません。',403);
    await tx.update(supportTickets).set({assigneeId:actor.id}).where(eq(supportTickets.id,id));
    await tx.update(ticketOperations).set({handoffTo:null,handoffBy:null,handoffReason:null,progressAt:now,...(c.op.state==='unassigned'?{state:'active' as const,stateAt:now}:{})}).where(eq(ticketOperations.ticketId,id));
    await recordTicketEvent(tx,id,actor.id,'handoff_accept','引き継ぎを承諾しました。',false,undefined,now);
    await notice(tx,id,`handoff:${now.toISOString()}`,'update','user','主担当が変更されました。',now);
  });
}
export async function requestResolution(db:Db,id:number,actor:TicketActor,summary:string,now=new Date()) {
  if(!summary.trim())throw new TicketOperationError('対応内容・結果を記録してください。');
  return change(db,id,actor,async(tx,c)=>{
    if(!c.manager||c.ticket.status!=='open')throw new TicketOperationError('権限がありません。',403);
    await tx.update(ticketOperations).set({state:'user_wait',stateAt:now,progressAt:now,firstReplyAt:c.op.firstReplyAt??now,closeSummary:summary.slice(0,8000),resolutionConfirmedAt:null}).where(eq(ticketOperations.ticketId,id));
    await recordTicketEvent(tx,id,actor.id,'resolution',summary,false,undefined,now);
    await notice(tx,id,`resolution:${now.toISOString()}`,'update','user','対応結果をご確認ください。解決した場合は「解決しました」を押してください。',now);
  });
}
export async function confirmResolution(db:Db,id:number,actor:TicketActor,now=new Date()) {
  return change(db,id,actor,async(tx,c)=>{
    if(!c.owner||!c.op.closeSummary||c.op.state!=='user_wait'||c.ticket.status!=='open')throw new TicketOperationError('解決確認の対象ではありません。',403);
    await tx.update(ticketOperations).set({resolutionConfirmedAt:now,progressAt:now,state:'active',stateAt:now}).where(eq(ticketOperations.ticketId,id));
    await recordTicketEvent(tx,id,actor.id,'confirmed','相談者が解決を確認しました。',false,undefined,now);
    await notice(tx,id,`confirmed:${now.toISOString()}`,'update','owner','相談者が解決を確認しました。完了操作をしてください。',now);
  });
}
export async function closeOperation(db:Db,id:number,actor:TicketActor|undefined,now=new Date()) {
  return db.transaction(async tx=>{
    const [t]=await tx.select().from(supportTickets).where(eq(supportTickets.id,id)).for('update');
    const o=await operationOf(tx as unknown as Db,id);if(!t||!o||t.status!=='open')return false;
    const auto=!actor;
    if(auto){if(o.state!=='user_wait'||+now-+o.stateAt<o.policy.userCloseHours*3600000||t.escrow>0)return false;}
    else{const c=await ticketContext(tx as unknown as Db,id,actor);if(!c.manager)throw new TicketOperationError('主担当・宮司・神職だけが完了にできます。',403);if(!o.closeSummary||!o.resolutionConfirmedAt)throw new TicketOperationError('対応内容と相談者の解決確認が必要です。');}
    const events=await tx.select().from(ticketEvents).where(and(eq(ticketEvents.ticketId,id),eq(ticketEvents.internal,false))).orderBy(asc(ticketEvents.id));
    const transcript=events.map(e=>`[${e.createdAt.toISOString()}] ${e.actorId}: ${e.body}`).join('\n');
    await closeTicket(tx as unknown as Db,id,actor?.id??'system',auto?'no_reply':'resolved',transcript,now);
    if(t.closeReason)await recordTicketEvent(tx as unknown as Db,id,actor?.id??'system','prior_result',t.closeReason,true,undefined,now);
    await tx.update(supportTickets).set({closeReason:auto?'no_reply':'resolved'}).where(eq(supportTickets.id,id));
    await tx.update(ticketOperations).set({state:'closed',stateAt:now,archiveComplete:false,archiveCursor:null,retainUntil:new Date(+now+o.policy.retentionDays*86400000),cleanupChannelId:t.channelId}).where(eq(ticketOperations.ticketId,id));
    if(t.channelId)await recordTicketEvent(tx as unknown as Db,id,'system','channel_archive',JSON.stringify({id:t.channelId,cursor:null,complete:false}),true,`archive:${t.channelId}`,now);
    await recordTicketEvent(tx as unknown as Db,id,actor?.id??'system','closed',auto?'返信がなく終了しました。':'解決して完了しました。',false,undefined,now);
    await notice(tx as unknown as Db,id,`${o.cycle}:closed`,'update','user','チケットが完了しました。履歴から確認・再開できます。',now);return true;
  });
}
export async function reopenOperation(db:Db,id:number,actor:TicketActor,now=new Date()) {
  return change(db,id,actor,async(tx,c)=>{
    if(!c.owner&&!c.manager)throw new TicketOperationError('再開の権限が必要です。',403);
    if(c.ticket.status!=='closed')throw new TicketOperationError('すでに対応中です。',409);
    await tx.update(supportTickets).set({status:'open',channelId:null,assigneeId:null,closedAt:null,closedBy:null,closeReason:null,rating:null,lastStaffAt:null,lastUserAt:now,staleNotifiedAt:null,idleWarnedAt:null,quotePrice:null,quoteDeadline:null,quoteBy:null}).where(eq(supportTickets.id,id));
    await tx.update(ticketOperations).set({state:'unassigned',stateAt:now,progressAt:now,openedAt:now,cycle:c.op.cycle+1,firstReplyAt:null,retainUntil:null,closeSummary:null,resolutionConfirmedAt:null,handoffTo:null,handoffBy:null,handoffReason:null}).where(eq(ticketOperations.ticketId,id));
    await recordTicketEvent(tx,id,actor.id,'reopened','同じ案件を再開しました。担当を決め直します。',false,undefined,now);
    await notice(tx,id,`${c.op.cycle+1}:reopened`,'update','owner','チケットが再開されました。',now);
  });
}
export async function setTicketUrgency(db:Db,id:number,actor:TicketActor,urgent:boolean,now=new Date()) {
  return change(db,id,actor,async(tx,c)=>{
    if(c.ticket.status!=='open')throw new TicketOperationError('完了しています。');if(c.op.urgent===urgent)return;
    await tx.update(ticketOperations).set({urgent,urgencyVersion:c.op.urgencyVersion+1}).where(eq(ticketOperations.ticketId,id));
    await recordTicketEvent(tx,id,actor.id,'urgency',urgent?'緊急の安全問題として受け付けました。':'緊急度を通常に変更しました。',false,undefined,now);
    if(urgent)await notice(tx,id,`${c.op.cycle}:urgent:${c.op.urgencyVersion+1}`,'urgent','admin','緊急の安全問題が届いています。',now);
  });
}
export async function setTicketSubjects(db:Db,id:number,actor:TicketActor,ids:string[],reason:string,now=new Date()) {
  ids=[...new Set(ids)];
  return change(db,id,actor,async(tx,c)=>{
    if(!c.admin||!reason.trim()||ids.length>20||ids.some(x=>!/^\d{17,20}$/.test(x)))throw new TicketOperationError('宮司・神職が対象者と理由を指定してください。',403);
    await tx.update(ticketOperations).set({subjectIds:ids,progressAt:now,handoffTo:null}).where(eq(ticketOperations.ticketId,id));
    if(c.ticket.assigneeId&&ids.includes(c.ticket.assigneeId)){
      await tx.update(supportTickets).set({assigneeId:null}).where(eq(supportTickets.id,id));
      if(c.ticket.status==='open')await tx.update(ticketOperations).set({state:'unassigned',stateAt:now,closeSummary:null,resolutionConfirmedAt:null}).where(eq(ticketOperations.ticketId,id));
    }
    await recordTicketEvent(tx,id,actor.id,'conflict',`当事者の担当・判断・運営向け表示を除外: ${ids.join(',')}\n${reason}`,true,undefined,now);
    await notice(tx,id,`conflict:${now.toISOString()}`,'update','admin','当事者の除外を更新しました。主担当をご確認ください。',now);
  });
}
export async function extendTicketRetention(db:Db,id:number,actor:TicketActor,days:number,now=new Date()) {
  return change(db,id,actor,async(tx,c)=>{
    if(!c.admin)throw new TicketOperationError('宮司・神職だけが保存を延長できます。',403);
    if(!Number.isInteger(days)||days<1||days>3650||!c.op.retainUntil)throw new TicketOperationError('延長日数を確認してください。');
    await tx.update(ticketOperations).set({retainUntil:new Date(Math.max(+c.op.retainUntil,+now)+days*86400000)}).where(eq(ticketOperations.ticketId,id));
    await recordTicketEvent(tx,id,actor.id,'retention',`保存を${days}日延長しました。`,true,undefined,now);
  });
}
export async function scheduleTicketNotices(db:Db,now=new Date(), canAutoClose?:(id:number)=>Promise<boolean>) {
  const rows=await db.select().from(ticketOperations).innerJoin(supportTickets,eq(ticketOperations.ticketId,supportTickets.id)).where(and(eq(supportTickets.status,'open'),isNull(ticketOperations.expiredAt)));
  for(const {ticket_operations:o,support_tickets:t} of rows){
    const queue=(key:string,kind:string,target:'user'|'owner'|'admin',body:string)=>notice(db,t.id,key,kind,target,body,now);
    if(o.urgent)await queue(`${o.cycle}:urgent:${o.urgencyVersion}`,'urgent','admin','緊急の安全問題が届いています。');
    if(!o.firstReplyAt){
      if(+now-+o.openedAt>=o.policy.firstReminderHours*3600000)await queue(`${o.cycle}:first`,'first','owner','運営の初回返信がまだありません。');
      if(+now-+o.openedAt>=o.policy.escalationHours*3600000)await queue(`${o.cycle}:escalate`,'escalate','admin','初回返信がないチケットを確認してください。');
    }
    if(o.state==='user_wait'){
      if(+now-+o.stateAt>=o.policy.userCloseHours*3600000&&t.escrow===0&&(!canAutoClose||await canAutoClose(t.id)))await closeOperation(db,t.id,undefined,now);
      else if(+now-+o.stateAt>=o.policy.userReminderHours*3600000)await queue(`${o.cycle}:user:${o.stateAt.toISOString()}`,'user_reminder','user','お返事をお待ちしています。返信がない場合は設定された期限に終了します。');
    }
    if(['active','internal_wait'].includes(o.state)){
      const hours=o.state==='active'?o.policy.activeReminderHours:o.policy.internalReminderHours;
      if(+now-+o.progressAt>=hours*3600000)await queue(`${o.cycle}:progress:${o.progressAt.toISOString()}`,'progress','owner','進捗をご確認ください。自動完了にはしません。');
    }
  }
}
export async function noticeStillNeeded(db:Db,n:typeof ticketNotices.$inferSelect) {
  const o=await operationOf(db,n.ticketId);if(!o||o.expiredAt||o.cycle!==n.cycle)return false;
  if(['first','escalate'].includes(n.kind))return !o.firstReplyAt&&n.dedupe.startsWith(`${o.cycle}:`)&&o.state!=='closed';
  if(n.kind==='user_reminder')return o.state==='user_wait'&&n.dedupe===`${o.cycle}:user:${o.stateAt.toISOString()}`;
  if(n.kind==='progress')return ['active','internal_wait'].includes(o.state)&&n.dedupe===`${o.cycle}:progress:${o.progressAt.toISOString()}`;
  if(n.kind==='urgent')return o.urgent&&o.state!=='closed'&&n.dedupe===`${o.cycle}:urgent:${o.urgencyVersion}`;
  if(n.kind==='handoff_request')return !!o.handoffTo&&o.state!=='closed';return true;
}
export async function takeTicketNotice(db:Db,now=new Date()) {
  return db.transaction(async tx=>{
    const [n]=await tx.select().from(ticketNotices).where(and(isNull(ticketNotices.sentAt),lte(ticketNotices.nextTryAt,now),or(isNull(ticketNotices.leaseUntil),lt(ticketNotices.leaseUntil,now)))).orderBy(asc(ticketNotices.id)).limit(1).for('update',{skipLocked:true});
    if(!n)return;await tx.update(ticketNotices).set({leaseUntil:new Date(+now+120000),attempts:n.attempts+1}).where(eq(ticketNotices.id,n.id));return n;
  });
}
export async function finishTicketNotice(db:Db,id:number,sent:boolean,now=new Date()) {
  await db.update(ticketNotices).set(sent?{sentAt:now,leaseUntil:null}:{nextTryAt:new Date(+now+300000),leaseUntil:null}).where(eq(ticketNotices.id,id));
}
export async function purgeExpiredTickets(db:Db,now=new Date()) {
  const expired=await db.select().from(ticketOperations).where(and(eq(ticketOperations.state,'closed'),isNull(ticketOperations.expiredAt),lte(ticketOperations.retainUntil,now)));
  for(const o of expired)await db.transaction(async tx=>{
    await tx.select().from(supportTickets).where(eq(supportTickets.id,o.ticketId)).for('update');
    const [current]=await tx.select().from(ticketOperations).where(eq(ticketOperations.ticketId,o.ticketId)).for('update');
    if(!current||current.state!=='closed'||current.expiredAt||!current.retainUntil||current.retainUntil>now)return;
    await tx.update(ticketOperations).set({expiredAt:now,closeSummary:null,subjectIds:[],handoffReason:null}).where(eq(ticketOperations.ticketId,o.ticketId));
    await tx.delete(ticketEvents).where(and(eq(ticketEvents.ticketId,o.ticketId),sql`${ticketEvents.kind} <> 'channel_archive'`));await tx.delete(ticketNotices).where(eq(ticketNotices.ticketId,o.ticketId));
    await tx.update(supportTickets).set({answers:[],transcript:null,closeReason:'expired',members:[]}).where(eq(supportTickets.id,o.ticketId));
  });return expired.length;
}

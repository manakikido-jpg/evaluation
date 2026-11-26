import { ChannelType, OverwriteType, PermissionFlagsBits, type Guild, type Interaction, type Message } from 'discord.js';
import { and, asc, eq, isNull, ne, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import type { GuildConfig } from '../config.js';
import { adminLevelOf } from '../config.js';
import type { DiscordActions, MessageBody } from '../lib/discordRest.js';
import { supportTickets, ticketOperations, ticketEvents, ticketAttachments, type SupportTicket, type TicketOperation } from '../db/schema.js';
import { createLoginLink } from '../services/casino/loginLinks.js';
import { getTicket, loadTicketConfig, ticketTypeOf, ticketChannelName, type TicketType } from '../services/supportTickets.js';
import * as ops from '../services/ticketOperations.js';
import { registerTicketFile, saveNextTicketFile, purgeTicketFiles, cleanupTicketFileOrphans } from '../services/ticketFiles.js';
import { logger } from '../lib/logger.js';
import { TICKET_STATE_LABELS } from '../domain/ticketPolicy.js';
export class TicketOperationRuntime {
 private guild?:Guild; private busy=false;
 constructor(private db:Db,private cfg:()=>GuildConfig,private discord:DiscordActions,private baseUrl?:string,private makeIntro?:(t:SupportTicket,type:TicketType,op:TicketOperation)=>MessageBody,private contentAvailable=true){}
 attach(guild:Guild){this.guild=guild;}
 private admins(){const c=this.cfg();return [...new Set([...(c.admin?.gujiRoleIds??[]),...(c.admin?.shinshokuRoleIds??[]),...c.ranks.filter(r=>['guji','shinshoku'].includes(r.key)).map(r=>r.roleId)])];}
 async actor(id:string):Promise<ops.TicketActor>{
  const m=await this.guild?.members.fetch({user:id,force:true}).catch(()=>undefined);if(!m)throw new ops.TicketOperationError('在籍を確認できません。',403);const roles=[...m.roles.cache.keys()];
  // 前の受付と同じく、サーバーの持ち主と Discord の「管理者」権限の人も運営として扱う（宮司・神職のロールがなくても）
  const boss=this.guild?.ownerId===id||Boolean(m.permissions?.has?.(PermissionFlagsBits.Administrator));
  return {id,roles,admin:!!adminLevelOf(this.cfg(),roles)||boss};
 }
 async historyLink(i:Interaction & {user:{id:string}}){
  if(!i.isRepliable())return;await i.deferReply(i.inGuild()?{flags:64}:{});
  if(!this.baseUrl)return void await i.editReply('WEB_BASE_URLを設定してください。');
  const user=i.user;const token=await createLoginLink(this.db,{id:user.id,displayName:user.globalName??user.username,avatarUrl:null});
  await i.editReply({content:'チケットの管理・履歴を開けます（10分・1回限り。ほかの人に渡さないでください）。',components:[{type:1,components:[{type:2,style:5,label:'チケットを開く',url:`${this.baseUrl}/support/link/${token}`}]}]});
 }
 async handle(i:Interaction):Promise<boolean>{
  if(!('customId'in i)||!i.customId.startsWith('tk:')||i.inGuild()&&i.guildId!==this.cfg().guildId)return false;
  const [,action,raw]=i.customId.split(':');
  if(action==='history'&&i.isButton()){await this.historyLink(i);return true;}
  if(!i.inCachedGuild()||!raw||!/^\d+$/.test(raw))return false;
  const id=Number(raw),op=await ops.operationOf(this.db,id);if(!op)return false;
  if(['add','addsel'].includes(action??'')){
   if(i.isRepliable())await i.reply({content:'閲覧範囲は種類ごとの担当ロールで管理します。追加が必要な場合は宮司・神職へご相談ください。',flags:64});return true;
  }
  if(['close','claim','urgent'].includes(action??'')&&i.isButton()){
   if(action==='close'){await this.historyLink(i);return true;}
   await i.deferReply({flags:64});
   const actor=await this.actor(i.user.id);
   if(action==='claim'){await ops.claimOperation(this.db,id,actor);await i.editReply('主担当として受け付けました。状態変更・内部メモ・完了は「管理・履歴」から操作できます。');}
   else{await ops.setTicketUrgency(this.db,id,actor,!op.urgent);await i.editReply('緊急度を更新しました。');}
   await this.tick();return true;
  }
  if(['hire','quote','quoteform','deliver'].includes(action??'')){
   const c=await ops.ticketContext(this.db,id,await this.actor(i.user.id));if(!c.manager)throw new ops.TicketOperationError('主担当・宮司・神職だけが操作できます。',403);
  }
  return false;
 }
 async started(id:number,answers:{q:string;a:string}[]){await ops.recordTicketEvent(this.db,id,'system','receipt',answers.map(x=>`【${x.q}】${x.a}`).join('\n'),false,'receipt:0');await this.tick();}
 private async storeHistorical(m:Message,ticketId:number){
  if(m.system)return true;
  const body=m.content||m.embeds[0]?.description||m.embeds[0]?.title||(m.attachments.size?'（添付資料）':m.stickers?.size?'（スタンプ）':'');
  if(!body&&m.author.bot)return true;
  if(!body){await ops.recordTicketEvent(this.db,ticketId,m.author.id,'missing_content',m.id,true,`missing:${m.id}`);return false;}
  const original=(await this.db.select().from(ticketEvents).where(and(eq(ticketEvents.ticketId,ticketId),eq(ticketEvents.dedupe,`discord:${m.id}`))))[0];
  if(original&&original.body!==body)await ops.recordTicketEvent(this.db,ticketId,m.author.id,'message_edit',body,false,`edit:${m.id}:${m.editedTimestamp??0}`,m.editedAt??m.createdAt);
  else await ops.recordTicketEvent(this.db,ticketId,m.author.id,'message',body,false,`discord:${m.id}`,m.createdAt);
  await this.db.delete(ticketEvents).where(and(eq(ticketEvents.ticketId,ticketId),eq(ticketEvents.dedupe,`missing:${m.id}`)));
  for(const a of m.attachments.values()){
   try{await registerTicketFile(this.db,ticketId,m.author.id,{sourceId:a.id,messageId:m.id,sourceChannelId:m.channelId,url:a.url,name:a.name,size:a.size,contentType:a.contentType,archive:true});}
   catch{await ops.recordTicketEvent(this.db,ticketId,'system','file_limit',`添付「${a.name.slice(0,200)}」は保存上限のため未保存です。`,false,`limit:${a.id}`);await ops.notice(this.db,ticketId,`limit:${a.id}`,'update','user','添付の保存上限を超えています。圧縮・分割するか運営へご相談ください。');}
  }
  return true;
 }
 async capture(m:Message){
  const t=await this.db.select().from(supportTickets).where(and(eq(supportTickets.channelId,m.channelId),eq(supportTickets.status,'open'))).then(r=>r[0]);
  if(!t||!await ops.operationOf(this.db,t.id))return false;if(m.author.bot||m.system)return true;
  const body=m.content||(m.attachments.size?'（添付資料）':m.stickers?.size?'（スタンプ）':'');
  if(!body){await this.storeHistorical(m,t.id);await ops.notice(this.db,t.id,'missing_content','update','owner','Discord本文を取得できません。Message Content設定を確認し、Webでの返信をご案内ください。');return true;}
  const actor=t.openerId===m.author.id?{id:m.author.id,roles:[],admin:false}:await this.actor(m.author.id);
  await ops.addOperationMessage(this.db,t.id,actor,body,false,m.createdAt,`discord:${m.id}`);
  await this.storeHistorical(m,t.id);return true;
 }
 private async syncRecent(){
  if(!this.guild)return;
  const rows=await this.db.select({id:supportTickets.id,channelId:supportTickets.channelId}).from(supportTickets).innerJoin(ticketOperations,eq(ticketOperations.ticketId,supportTickets.id)).where(eq(supportTickets.status,'open'));
  for(const t of rows){
   if(!t.channelId)continue;
   try{const ch=await this.guild.channels.fetch(t.channelId);if(ch?.type!==ChannelType.GuildText)continue;
    const batch=await ch.messages.fetch({limit:100});
    const keys=[...batch.keys()].map(id=>`discord:${id}`);
    const known=new Set(keys.length?(await this.db.select({key:ticketEvents.dedupe}).from(ticketEvents).where(and(eq(ticketEvents.ticketId,t.id),inArray(ticketEvents.dedupe,keys)))).map(e=>e.key):[]);
    for(const m of [...batch.values()].sort((a,b)=>+a.createdAt-+b.createdAt)){
     if(!known.has(`discord:${m.id}`)&&!m.author.bot&&!m.system)await this.capture(m).catch(()=>this.storeHistorical(m,t.id));
    }
   }catch{logger.warn({ticketId:t.id},'ticket recent history pending');}
  }
 }
 private async canAutoClose(id:number){
  const t=await getTicket(this.db,id),o=await ops.operationOf(this.db,id);if(!t||!o)return false;
  if(!t.channelId)return true; // Webだけで会話している案件はDBの返信時刻が根拠。
  try{
   const ch=await this.guild?.channels.fetch(t.channelId);if(ch?.type!==ChannelType.GuildText)return false;
   let before:string|undefined;
   for(let n=0;n<5;n++){
    const batch=await ch.messages.fetch({limit:100,...(before?{before}:{})});
    for(const m of batch.values())if(!m.author.bot&&m.author.id===t.openerId&&m.createdAt>o.stateAt){await this.capture(m);return false;}
    if(batch.size<100||batch.last()!.createdAt<=o.stateAt)return true;
    before=batch.last()!.id;
   }
  }catch{}
  await ops.notice(this.db,id,`close_check:${o.stateAt.toISOString()}`,'update','owner','Discordの返信確認ができないため、自動完了を保留しています。');return false;
 }
 async ensureChannels(){
  const guild=this.guild;if(!guild)return;
  const conf=await loadTicketConfig(this.db);
  const rows=await this.db.select().from(ticketOperations).innerJoin(supportTickets,eq(ticketOperations.ticketId,supportTickets.id)).where(and(eq(supportTickets.status,'open'),isNull(ticketOperations.expiredAt)));
  for(const {ticket_operations:o,support_tickets:t} of rows){
   if(!t.channelId)try{await this.db.transaction(async tx=>{
    const [fresh]=await tx.select().from(supportTickets).where(eq(supportTickets.id,t.id)).for('update');if(!fresh||fresh.channelId||fresh.status!=='open')return;
    const type=ticketTypeOf(conf,t.typeKey);if(!type)return;
    const currentOp=await ops.operationOf(tx as unknown as Db,t.id);if(!currentOp||currentOp.expiredAt)return;
    const topic=`support-ticket:${t.id}:${currentOp.cycle}`;
    let ch=guild.channels.cache.find(c=>c.type===ChannelType.GuildText&&c.topic===topic);
    const WRITE=PermissionFlagsBits.SendMessages|PermissionFlagsBits.AttachFiles;
    const SEE=PermissionFlagsBits.ViewChannel|PermissionFlagsBits.ReadMessageHistory|PermissionFlagsBits.EmbedLinks|(this.contentAvailable?WRITE:0n);
    const READONLY=this.contentAvailable?0n:WRITE;
    if(!ch)ch=await guild.channels.create({name:ticketChannelName(type,t.id),type:ChannelType.GuildText,topic,...(type.categoryId??conf.categoryId?{parent:type.categoryId??conf.categoryId}:{}),permissionOverwrites:[{id:guild.id,type:OverwriteType.Role,deny:PermissionFlagsBits.ViewChannel|READONLY},{id:t.openerId,type:OverwriteType.Member,allow:SEE,deny:READONLY},...[...new Set([...type.roleIds,...this.admins()])].filter(id=>guild.roles.cache.has(id)&&id!==guild.id).map(id=>({id,type:OverwriteType.Role,allow:SEE,deny:READONLY})),...currentOp.subjectIds.filter(id=>id!==t.openerId&&id!==guild.members.me?.id).map(id=>({id,type:OverwriteType.Member,deny:PermissionFlagsBits.ViewChannel|WRITE})),...(guild.members.me?[{id:guild.members.me.id,type:OverwriteType.Member,allow:SEE|WRITE|PermissionFlagsBits.ManageChannels|PermissionFlagsBits.ManageMessages}]:[])],reason:`チケット #${t.id}`});
    await tx.update(supportTickets).set({channelId:ch.id}).where(eq(supportTickets.id,t.id));
   });}
   catch{logger.warn({ticketId:t.id},'managed ticket channel pending');continue;}
   const current=await getTicket(this.db,t.id),type=ticketTypeOf(conf,t.typeKey);
   if(current?.channelId&&type)await this.syncPermissions(current,type,o).catch(()=>logger.warn({ticketId:t.id},'ticket permissions pending'));
   if(current?.channelId&&type&&this.makeIntro)await this.intro(t.id,this.makeIntro(current,type,o)).catch(()=>undefined);
  }
 }
 async syncPermissions(t:SupportTicket,type:TicketType,o:TicketOperation){
  const guild=this.guild;if(!guild||!t.channelId)return;
  const ch=await guild.channels.fetch(t.channelId);if(ch?.type!==ChannelType.GuildText)return;
  const WRITE=PermissionFlagsBits.SendMessages|PermissionFlagsBits.AttachFiles;
  const SEE=PermissionFlagsBits.ViewChannel|PermissionFlagsBits.ReadMessageHistory|PermissionFlagsBits.EmbedLinks|(this.contentAvailable?WRITE:0n);
  const deny=this.contentAvailable?0n:WRITE;
  const desired=[{id:guild.id,type:OverwriteType.Role,allow:0n,deny:PermissionFlagsBits.ViewChannel|deny},
   {id:t.openerId,type:OverwriteType.Member,allow:SEE,deny},
   ...[...new Set([...type.roleIds,...this.admins()])].filter(id=>guild.roles.cache.has(id)&&id!==guild.id).map(id=>({id,type:OverwriteType.Role,allow:SEE,deny})),
   ...o.subjectIds.filter(id=>id!==t.openerId&&id!==guild.members.me?.id).map(id=>({id,type:OverwriteType.Member,allow:0n,deny:PermissionFlagsBits.ViewChannel|WRITE})),
   ...(guild.members.me?[{id:guild.members.me.id,type:OverwriteType.Member,allow:SEE|WRITE|PermissionFlagsBits.ManageChannels|PermissionFlagsBits.ManageMessages,deny:0n}]:[])];
  if(desired.length!==ch.permissionOverwrites.cache.size||desired.some(w=>{const p=ch.permissionOverwrites.cache.get(w.id);return !p||p.type!==w.type||p.allow.bitfield!==w.allow||p.deny.bitfield!==w.deny;}))await ch.permissionOverwrites.set(desired,'チケットの種類・当事者・返信方法に合わせる');
 }
 async intro(id:number,body:MessageBody){
  const t=await getTicket(this.db,id),op=await ops.operationOf(this.db,id);if(!t?.channelId||!op)return;
  const key=`intro:${op.cycle}`;
  const exists=(await this.db.select().from(ticketEvents).where(and(eq(ticketEvents.ticketId,id),eq(ticketEvents.dedupe,key))))[0];if(exists)return;
  const sent=await this.discord.sendMessage(t.channelId,body);
  await ops.recordTicketEvent(this.db,id,'system','intro_sent',sent.id,true,key);
 }
 private async deliverNotices(now:Date){
  const conf=await loadTicketConfig(this.db);
  for(let n=0;n<20;n++){
   const notice=await ops.takeTicketNotice(this.db,now);if(!notice)break;
   try{
    if(!await ops.noticeStillNeeded(this.db,notice)){await ops.finishTicketNotice(this.db,notice.id,true,now);continue;}
    const t=await getTicket(this.db,notice.ticketId),o=await ops.operationOf(this.db,notice.ticketId);if(!t||!o)continue;
    const url=`${this.baseUrl??''}/support/${t.id}`;
    if(notice.target==='user'){
     let delivered=false;
     if(t.channelId){try{await this.discord.sendMessage(t.channelId,{content:`<@${t.openerId}> ${notice.body}\n${url}`,allowed_mentions:{users:[t.openerId],parse:[]}});delivered=true;}catch{}}
     const dm=await this.discord.sendDm(t.openerId,`チケット #${t.id} に更新があります。\n${url}`).catch(()=>false);
     if(!delivered&&!dm)throw new Error('notify failed');
    }else{
     const roles=notice.target==='admin'?this.admins():(ticketTypeOf(conf,t.typeKey)?.roleIds??o.roleIds);
     const owner=notice.kind==='handoff_request'?o.handoffTo:notice.target==='owner'?t.assigneeId:null;
     const log=conf.logChannelId??this.cfg().channels.log;if(!log)throw new Error('no log channel');
     await this.discord.sendMessage(log,{content:`${owner?`<@${owner}>`:roles.map(r=>`<@&${r}>`).join(' ')}\nチケット #${t.id}: ${notice.body}\n${url}`,allowed_mentions:{parse:[],...(owner?{users:[owner]}:{roles})}});
    }
    await ops.finishTicketNotice(this.db,notice.id,true,now);
   }catch{await ops.finishTicketNotice(this.db,notice.id,false,now);}
  }
 }
 private async cleanupChannels(){
  if(!this.guild)return;
  const archives=await this.db.select().from(ticketEvents).where(eq(ticketEvents.kind,'channel_archive')).limit(50);
  for(const event of archives){
   try{
    const o=await ops.operationOf(this.db,event.ticketId);if(!o)continue;
    const a=JSON.parse(event.body) as {id:string;cursor:string|null;complete:boolean;head?:string|null};
    const active=await getTicket(this.db,event.ticketId);if(active?.status==='open'&&active.channelId===a.id)continue;
    const ch=await this.guild.channels.fetch(a.id).catch((e:{code?:number})=>{if(e.code===10003)return null;throw e;});
    if(ch&&ch.type!==ChannelType.GuildText)continue;
    if(ch&&!o.expiredAt){
     // 完了した元チャンネルは読み取り専用にし、バックアップ中の新規投稿を防ぐ。
     for(const overwrite of ch.permissionOverwrites.cache.values())if(overwrite.id!==this.guild.members.me?.id&&!overwrite.deny.has(PermissionFlagsBits.SendMessages))await ch.permissionOverwrites.edit(overwrite.id,{SendMessages:false},{type:overwrite.type,reason:'チケット完了・履歴保存中'});
     if(!a.complete){
      const batch=await ch.messages.fetch({limit:100,...(a.cursor?{before:a.cursor}:{})});
      if(a.head===undefined)a.head=batch.first()?.id??null;
      let readable=true;
      for(const m of batch.values())if(!await this.storeHistorical(m,event.ticketId))readable=false;
      if(!readable){await ops.notice(this.db,event.ticketId,'archive_content','update','owner','本文を取得できないため、元チャンネルの削除を保留しています。Message Content設定を確認してください。');continue;}
      a.cursor=batch.last()?.id??a.cursor;a.complete=batch.size<100;
      await this.db.update(ticketEvents).set({body:JSON.stringify(a)}).where(eq(ticketEvents.id,event.id));
      if(!a.complete)continue;
     }
     const pending=await this.db.select().from(ticketAttachments).where(and(eq(ticketAttachments.ticketId,event.ticketId),ne(ticketAttachments.status,'ready'))).limit(1);if(pending.length)continue;
     const latest=await ch.messages.fetch({limit:1});
     if((latest.first()?.id??null)!==a.head){await this.db.update(ticketEvents).set({body:JSON.stringify({id:a.id,cursor:null,complete:false})}).where(eq(ticketEvents.id,event.id));continue;}
     const lines=await this.db.select().from(ticketEvents).where(and(eq(ticketEvents.ticketId,event.ticketId),eq(ticketEvents.internal,false))).orderBy(asc(ticketEvents.createdAt),asc(ticketEvents.id));
     await this.db.update(supportTickets).set({transcript:lines.map(e=>`[${e.createdAt.toISOString()}] ${e.actorId}: ${e.body}`).join('\n').slice(0,500000)}).where(eq(supportTickets.id,event.ticketId));
    }
    if(ch)await ch.delete('チケット完了・履歴保存済み');
    if(o.expiredAt)await this.db.delete(ticketEvents).where(eq(ticketEvents.id,event.id));
    else await this.db.update(ticketEvents).set({kind:'channel_archived',body:'元チャンネルの履歴保存・整理が完了しました。'}).where(eq(ticketEvents.id,event.id));
    await this.db.update(ticketOperations).set({cleanupChannelId:null}).where(and(eq(ticketOperations.ticketId,event.ticketId),eq(ticketOperations.cleanupChannelId,a.id)));
   }catch{logger.warn({ticketId:event.ticketId},'managed ticket channel cleanup pending');}
  }
 }
 async flushNotices(now=new Date()){await this.deliverNotices(now);}
 async tick(now=new Date()){
  if(this.busy)return;this.busy=true;
  try{await this.ensureChannels();await this.syncRecent();await ops.scheduleTicketNotices(this.db,now,id=>this.canAutoClose(id));await this.deliverNotices(now);for(let n=0;n<2;n++)await saveNextTicketFile(this.db,now,{refreshUrl:async f=>{const t=await getTicket(this.db,f.ticketId);if(!f.messageId||!f.sourceChannelId&&!t?.channelId)return;const ch=await this.guild?.channels.fetch(f.sourceChannelId??t!.channelId!);if(ch?.type!==ChannelType.GuildText)return;return (await ch.messages.fetch({message:f.messageId,force:true})).attachments.get(f.sourceId)?.url;}});await ops.purgeExpiredTickets(this.db,now);await purgeTicketFiles(this.db);await cleanupTicketFileOrphans(this.db,undefined,now);await this.cleanupChannels();}
  finally{this.busy=false;}
 }
}

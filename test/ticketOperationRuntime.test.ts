import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {Collection,ChannelType,PermissionsBitField,PermissionFlagsBits,OverwriteType,type Guild,type Message} from 'discord.js';
import {eq} from 'drizzle-orm';
import {makeDb,cfg,ROLE} from './helpers.js';
import type {Db} from '../src/db/client.js';
import type {DiscordActions} from '../src/lib/discordRest.js';
import {TicketOperationRuntime} from '../src/discord/ticketOperationRuntime.js';
import {loadTicketConfig,saveTicketConfig,openTicket,setTicketChannel,getTicket} from '../src/services/supportTickets.js';
import {ticketNotices,ticketEvents} from '../src/db/schema.js';
import * as op from '../src/services/ticketOperations.js';
const U='870000000000000101',S='870000000000000102',B='870000000000000199',R='870000000000000201',C='870000000000000301',T=new Date('2026-11-26T00:00:00Z');
const staff={id:S,roles:[R],admin:false},user={id:U,roles:[],admin:false};
let db:Db,close:()=>Promise<void>,id:number,rt:TicketOperationRuntime,guild:Guild,ch:any,sent:{channel:string;body:any}[],dmResult:boolean,sendFail:boolean;
const msg=(mid:string,body:string,author=U,at=T)=>({id:mid,content:body,author:{id:author,bot:author===B},system:false,channelId:C,createdAt:at,embeds:[],attachments:new Collection(),stickers:new Collection(),editedAt:null,editedTimestamp:null}) as unknown as Message;
beforeEach(async()=>{({db,close}=await makeDb());const conf=await loadTicketConfig(db);await saveTicketConfig(db,{...conf,logChannelId:'870000000000000399',types:conf.types.map(t=>({...t,roleIds:[R]}))},S);const r=await openTicket(db,await loadTicketConfig(db),{openerId:U,typeKey:'inquiry',answers:[{q:'内容',a:'テスト'}],managed:true},T);if(r.status!=='ok')throw Error();id=r.ticket.id;await setTicketChannel(db,id,C);sent=[];dmResult=true;sendFail=false;
 ch={id:C,type:ChannelType.GuildText,topic:`support-ticket:${id}`,messages:{fetch:vi.fn(async()=>new Collection())},delete:vi.fn(async()=>{}),permissionOverwrites:{cache:new Collection(),set:vi.fn(async()=>{}),edit:vi.fn(async()=>{})}};
 const g={id:cfg.guildId,roles:{cache:new Collection([[R,{id:R}],[ROLE.guji,{id:ROLE.guji}]])},channels:{cache:new Collection([[C,ch]]),fetch:vi.fn(async(cid:string)=>cid===C?ch:null),create:vi.fn(async()=>ch)},members:{me:{id:B},fetch:vi.fn(async({user:id}:{user:string})=>({roles:{cache:new Collection(id===S?[[R,{id:R}]]:[])}}))}};guild=g as unknown as Guild;
 const discord={sendMessage:async(channel:string,body:any)=>{if(sendFail)throw Error();sent.push({channel,body});return {id:'notice'};},sendDm:async()=>dmResult} as unknown as DiscordActions;
 rt=new TicketOperationRuntime(db,()=>cfg,discord,'https://example.test');rt.attach(guild);
});
afterEach(async()=>close());
it('Discordの人の返信だけを初回返信に数え、相談者の返信で待機を解除する',async()=>{await op.claimOperation(db,id,staff,T);await rt.capture(msg('staff','人の返信',S,new Date(+T+1000)));expect((await op.operationOf(db,id))!.firstReplyAt).toEqual(new Date(+T+1000));await op.setOperationState(db,id,staff,'user_wait',new Date(+T+2000));await rt.capture(msg('user','返事',U,new Date(+T+3000)));expect((await op.operationOf(db,id))!.state).toBe('active');});
it('本文が取れない投稿は初回返信にせず、確認待ちの記録を残す',async()=>{await rt.capture(msg('missing','',S));expect((await op.operationOf(db,id))!.firstReplyAt).toBeNull();expect((await db.select().from(ticketEvents)).some(e=>e.kind==='missing_content')).toBe(true);});
it('DM失敗でもチケット内に届けば通知済み。内容をDMへ渡さない',async()=>{dmResult=false;await op.notice(db,id,'test','update','user','更新しました',T);await rt.flushNotices(T);expect((await db.select().from(ticketNotices))[0]!.sentAt).toEqual(T);expect(sent[0]!.body.allowed_mentions.parse).toEqual([]);});
it('通知失敗は未送信を維持し、5分後に再試行する',async()=>{sendFail=true;dmResult=false;await op.notice(db,id,'test','update','user','更新',T);await rt.flushNotices(T);expect((await db.select().from(ticketNotices))[0]!.sentAt).toBeNull();sendFail=false;await rt.flushNotices(new Date(+T+300001));expect((await db.select().from(ticketNotices))[0]!.sentAt).not.toBeNull();});
it('当事者をDiscordの閲覧からも除外し、本文取得OFFなら通知専用にする',async()=>{const context=await op.ticketContext(db,id,staff);const conf=await loadTicketConfig(db);rt=new TicketOperationRuntime(db,()=>cfg,{} as DiscordActions,undefined,undefined,false);rt.attach(guild);await rt.syncPermissions(context.ticket,conf.types[0]!,{...context.op,subjectIds:[S]});const rows=ch.permissionOverwrites.set.mock.calls[0][0] as {id:string;allow:bigint;deny:bigint}[];expect(rows.find(r=>r.id===S)!.deny&PermissionFlagsBits.ViewChannel).toBe(PermissionFlagsBits.ViewChannel);expect(rows.find(r=>r.id===U)!.allow&PermissionFlagsBits.SendMessages).toBe(0n);expect(rows.find(r=>r.id===B)!.allow&PermissionFlagsBits.SendMessages).toBe(PermissionFlagsBits.SendMessages);});
it('案内は各再開ごとに1回だけ送る',async()=>{await rt.intro(id,{content:'案内',allowed_mentions:{parse:[]}});await rt.intro(id,{content:'案内',allowed_mentions:{parse:[]}});expect(sent).toHaveLength(1);});
it('停止中に来た相談者の返信を取り込み、自動終了を止める',async()=>{await op.claimOperation(db,id,staff,T);await op.setOperationState(db,id,staff,'user_wait',T);const reply=msg('new','停止中の返信',U,new Date(+T+1000));ch.messages.fetch.mockResolvedValue(new Collection([[reply.id,reply]]));await rt.tick(new Date(+T+8*86400000));expect((await getTicket(db,id))!.status).toBe('open');expect((await op.operationOf(db,id))!.state).toBe('active');});
it('完了時は履歴保存後に元チャンネルを削除し、内部メモは文字起こしへ混ぜない',async()=>{await op.claimOperation(db,id,staff,T);await op.addOperationMessage(db,id,staff,'内部だけ',true,T);await op.requestResolution(db,id,staff,'対応ずみ',T);await op.confirmResolution(db,id,user,T);await op.closeOperation(db,id,staff,T);await rt.tick(T);expect(ch.delete).toHaveBeenCalledTimes(1);const ticket=(await getTicket(db,id))!;expect(ticket.transcript).not.toContain('内部だけ');expect((await db.select().from(ticketEvents)).some(e=>e.kind==='channel_archived')).toBe(true);});
it('読み取れない履歴があれば、元チャンネルを勝手に消さない',async()=>{await op.claimOperation(db,id,staff,T);await op.requestResolution(db,id,staff,'対応ずみ',T);await op.confirmResolution(db,id,user,T);await op.closeOperation(db,id,staff,T);ch.messages.fetch.mockResolvedValue(new Collection([['missing',msg('missing','')]]));await rt.tick(T);expect(ch.delete).not.toHaveBeenCalled();});

it('再開は別のチャンネルを作り、旧チャンネルの整理で新しい部屋を消さない',async()=>{
 await op.claimOperation(db,id,staff,T);await op.requestResolution(db,id,staff,'解決',T);await op.confirmResolution(db,id,user,T);await op.closeOperation(db,id,staff,T);await op.reopenOperation(db,id,user,T);
 const next={...ch,id:'870000000000000302',topic:`support-ticket:${id}:1`,delete:vi.fn(async()=>{})};
 (guild.channels.create as any).mockResolvedValue(next);(guild.channels.fetch as any).mockImplementation(async(cid:string)=>cid===C?ch:next);
 await rt.tick(T);expect(guild.channels.create).toHaveBeenCalled();expect((await getTicket(db,id))!.channelId).toBe(next.id);expect(ch.delete).toHaveBeenCalledTimes(1);expect(next.delete).not.toHaveBeenCalled();
});

it('開いた本人は担当できず、理由を伝える。ロールがなくてもサーバーの持ち主は運営として担当できる',async()=>{
 await expect(op.claimOperation(db,id,user,T)).rejects.toThrow('ご自身が開いたチケットは担当できません');
 const O='870000000000000150';
 (guild as any).ownerId=O;
 const actor=await rt.actor(O);
 expect(actor.admin).toBe(true);
 await op.claimOperation(db,id,actor,T);
 expect((await getTicket(db,id))!.assigneeId).toBe(O);
});

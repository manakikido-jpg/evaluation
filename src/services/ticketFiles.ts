import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm, stat, readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { and, asc, eq, isNotNull, lte, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { supportTickets, ticketAttachments, ticketOperations } from '../db/schema.js';
import { operationOf, ticketContext, recordTicketEvent, notice, TicketOperationError, type TicketActor } from './ticketOperations.js';
const MB=1024*1024;
export const ticketFileRoot=()=>resolve(process.env.TICKET_DATA_DIR??'/data/recordings/ticket-attachments');
function filePath(key:string,root=ticketFileRoot()){if(!/^[0-9a-f-]{36}$/.test(key))throw new Error('Invalid storage key');return join(root,key);}
export function validTicketAttachmentUrl(value:string){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&['cdn.discordapp.com','media.discordapp.net','cdn.discordapp.net'].includes(u.hostname);}catch{return false;}}
export async function registerTicketFile(db:Db,ticketId:number,actorId:string,input:{sourceId:string;url:string;name:string;size:number;contentType?:string|null;messageId?:string;sourceChannelId?:string;archive?:boolean},now=new Date()){
 if(!validTicketAttachmentUrl(input.url)||!Number.isSafeInteger(input.size)||input.size<0)throw new TicketOperationError('添付ファイルを確認してください。');
 return db.transaction(async tx=>{
  const [t]=await tx.select().from(supportTickets).where(eq(supportTickets.id,ticketId)).for('update');
  const op=await operationOf(tx as unknown as Db,ticketId);if(!op||op.expiredAt||(t?.status!=='open'&&!input.archive))return;
  const [existing]=await tx.select().from(ticketAttachments).where(and(eq(ticketAttachments.ticketId,ticketId),eq(ticketAttachments.sourceId,input.sourceId)));if(existing)return existing;
  const [sum]=await tx.select({bytes:sql<number>`coalesce(sum(${ticketAttachments.size}),0)::bigint`}).from(ticketAttachments).where(eq(ticketAttachments.ticketId,ticketId));
  if(input.size>op.policy.fileMaxMB*MB||Number(sum?.bytes??0)+input.size>op.policy.ticketMaxMB*MB)throw new TicketOperationError('添付の保存上限を超えています。圧縮・分割するか、運営にご相談ください。');
  return (await tx.insert(ticketAttachments).values({ticketId,sourceId:input.sourceId,messageId:input.messageId,sourceChannelId:input.sourceChannelId,sourceUrl:input.url,name:input.name.slice(0,200),size:input.size,contentType:(input.contentType??'application/octet-stream').slice(0,100),storageKey:randomUUID(),nextTryAt:input.sourceId.startsWith('upload:')?new Date(+now+120000):now}).returning())[0];
 });
}
export async function saveNextTicketFile(db:Db,now=new Date(),opts:{root?:string;fetcher?:typeof fetch;refreshUrl?:(row:typeof ticketAttachments.$inferSelect)=>Promise<string|undefined>}={}){
 const row=await db.transaction(async tx=>{
  const [f]=await tx.select().from(ticketAttachments).where(and(ne(ticketAttachments.status,'ready'),lte(ticketAttachments.nextTryAt,now))).orderBy(asc(ticketAttachments.id)).limit(1).for('update',{skipLocked:true});
  if(!f)return;await tx.update(ticketAttachments).set({nextTryAt:new Date(+now+120000),attempts:f.attempts+1}).where(eq(ticketAttachments.id,f.id));return f;
 });
 if(!row)return false;
 const root=resolve(opts.root??ticketFileRoot()),path=filePath(row.storageKey,root),temp=path+'.'+randomUUID()+'.tmp';
 let handle:Awaited<ReturnType<typeof open>>|undefined;
 try{
  const op=await operationOf(db,row.ticketId);if(!op||op.expiredAt){await db.delete(ticketAttachments).where(eq(ticketAttachments.id,row.id));return true;}
  await mkdir(root,{recursive:true,mode:0o700});
  const exists=await stat(path).catch(()=>undefined);
  if(!exists&&row.sourceId.startsWith('upload:')&&row.attempts>0){
   await db.delete(ticketAttachments).where(eq(ticketAttachments.id,row.id));
   await recordTicketEvent(db,row.ticketId,'system','upload_interrupted','中断したWeb添付の容量予約を解除しました。同じファイルを選び直してください。',false,`interrupted:${row.id}`,now);
   await notice(db,row.ticketId,`upload_interrupted:${row.id}`,'update','user','Webの添付が中断しています。同じファイルを選び直してください。',now);return true;
  }
  if(!exists||exists.size!==row.size){
   const url=row.attempts>0&&opts.refreshUrl?await opts.refreshUrl(row)??row.sourceUrl:row.sourceUrl;
   if(!url||!validTicketAttachmentUrl(url))throw new Error('Invalid attachment source');
   const res=await (opts.fetcher??fetch)(url,{redirect:'error',signal:AbortSignal.timeout(30000)});
   if(!res.ok||!res.body)throw new Error('Download failed');
   const declared=res.headers.get('content-length');if(declared&&Number(declared)>row.size)throw new Error('Attachment size mismatch');
   handle=await open(temp,'wx',0o600);let bytes=0;
   const reader=res.body.getReader();
   try{while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>row.size||bytes>op.policy.fileMaxMB*MB)throw new Error('Attachment too large');await handle.write(chunk.value);}}
   finally{await reader.cancel().catch(()=>undefined);}
   if(bytes!==row.size)throw new Error('Attachment size mismatch');
   await handle.close();handle=undefined;await rename(temp,path);
  }
  await db.update(ticketAttachments).set({status:'ready',error:null,sourceUrl:null}).where(eq(ticketAttachments.id,row.id));
 }catch{
  await handle?.close().catch(()=>undefined);await rm(temp,{force:true}).catch(()=>undefined);
  await db.update(ticketAttachments).set({status:'failed',error:'ファイルを保存できませんでした。再試行します。',nextTryAt:new Date(+now+300000)}).where(eq(ticketAttachments.id,row.id));
  await notice(db,row.ticketId,`file_error:${row.id}`,'update','owner','添付資料の保存に失敗しました。元のチケットを閉じる前に確認してください。',now);
 }
 return true;
}
export async function readTicketFile(row:typeof ticketAttachments.$inferSelect,root=ticketFileRoot()){
 if(row.status!=='ready')return;return readFile(filePath(row.storageKey,root)).catch(()=>undefined);
}
export async function purgeTicketFiles(db:Db,root=ticketFileRoot()){
 const rows=await db.select({file:ticketAttachments}).from(ticketAttachments).innerJoin(ticketOperations,eq(ticketAttachments.ticketId,ticketOperations.ticketId)).where(isNotNull(ticketOperations.expiredAt));
 for(const {file} of rows){await rm(filePath(file.storageKey,root),{force:true});await db.delete(ticketAttachments).where(eq(ticketAttachments.id,file.id));}
 return rows.length;
}

/** Webからのアップロードも、同じ容量予約と保存権限を使う。 */
export async function uploadTicketFile(db:Db,ticketId:number,actorId:string,file:File,root=ticketFileRoot(),now=new Date()){
 const sourceId=`upload:${randomUUID()}`;
 const row=await registerTicketFile(db,ticketId,actorId,{sourceId,url:'https://cdn.discordapp.com/web-upload',name:file.name,size:file.size,contentType:file.type},now);
 if(!row)throw new TicketOperationError('完了したチケットには添付できません。');
 await db.update(ticketAttachments).set({sourceUrl:null}).where(eq(ticketAttachments.id,row.id));
 try{
  const data=new Uint8Array(await file.arrayBuffer());
  if(data.byteLength!==row.size)throw new Error('size mismatch');
  await mkdir(root,{recursive:true,mode:0o700});
  await import('node:fs/promises').then(fs=>fs.writeFile(filePath(row.storageKey,root),data,{mode:0o600,flag:'wx'}));
  await db.update(ticketAttachments).set({status:'ready',sourceUrl:null,error:null}).where(eq(ticketAttachments.id,row.id));
  await recordTicketEvent(db,ticketId,actorId,'attachment',`添付資料: ${file.name.slice(0,200)}`,false,sourceId,now);
  return row.id;
 }catch{
  await rm(filePath(row.storageKey,root),{force:true}).catch(()=>undefined);
  await db.delete(ticketAttachments).where(eq(ticketAttachments.id,row.id));
  throw new TicketOperationError('添付を保存できませんでした。もう一度お試しください。');
 }
}

/** 失敗した保存だけを再試行する。元の証拠や保存済みファイルは削除しない。 */
export async function retryTicketFile(db:Db,ticketId:number,fileId:number,actor:TicketActor,now=new Date()){
 if(!Number.isSafeInteger(fileId)||fileId<1)throw new TicketOperationError('ファイルを確認してください。');
 const c=await ticketContext(db,ticketId,actor);if(!c.owner&&!c.manager)throw new TicketOperationError('相談者・主担当・宮司・神職の操作です。',403);
 const [row]=await db.select().from(ticketAttachments).where(and(eq(ticketAttachments.ticketId,ticketId),eq(ticketAttachments.id,fileId)));
 if(!row||row.status==='ready')throw new TicketOperationError('保存に失敗したファイルを選んでください。');
 if(row.sourceId.startsWith('upload:'))throw new TicketOperationError('Webの添付は、同じファイルを選び直してアップロードしてください。');
 await db.update(ticketAttachments).set({nextTryAt:now,status:'pending',error:null}).where(eq(ticketAttachments.id,fileId));
 await recordTicketEvent(db,ticketId,actor.id,'file_retry','添付資料の保存を再試行します。',true,undefined,now);
}
/** 中断した一時ファイルと、DBにない保存ファイルだけを24時間後に整理する。 */
export async function cleanupTicketFileOrphans(db:Db,root=ticketFileRoot(),now=new Date()){
 const rows=await db.select({key:ticketAttachments.storageKey}).from(ticketAttachments);const keys=new Set(rows.map(r=>r.key));
 const names=await readdir(root).catch(()=>[]);let removed=0;
 for(const name of names){if(!/^[0-9a-f-]{36}(\.[0-9a-f-]{36}\.tmp)?$/.test(name)||keys.has(name))continue;
  const path=join(root,name),info=await stat(path).catch(()=>undefined);if(info?.isFile()&&+now-info.mtimeMs>86400000){await rm(path,{force:true});removed++;}
 }
 return removed;
}

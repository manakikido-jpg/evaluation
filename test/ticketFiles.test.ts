import {beforeEach,afterEach,it,expect} from 'vitest';
import {mkdtemp,rm,writeFile,readFile,utimes,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {eq} from 'drizzle-orm';
import type {Db} from '../src/db/client.js';
import {makeDb} from './helpers.js';
import {loadTicketConfig,openTicket} from '../src/services/supportTickets.js';
import {ticketAttachments,ticketOperations} from '../src/db/schema.js';
import * as f from '../src/services/ticketFiles.js';
const U='870000000000000101',T=new Date('2026-11-26T00:00:00Z');
let db:Db,close:()=>Promise<void>,root:string,id:number;
beforeEach(async()=>{({db,close}=await makeDb());root=await mkdtemp(join(tmpdir(),'ticket-file-'));const c=await loadTicketConfig(db);const r=await openTicket(db,c,{openerId:U,typeKey:'inquiry',answers:[{q:'内容',a:'相談'}],managed:true},T);if(r.status!=='ok')throw Error();id=r.ticket.id;});
afterEach(async()=>{await close();await rm(root,{recursive:true,force:true});});
const reg=(sourceId='one',size=3,url='https://cdn.discordapp.com/attachments/file')=>f.registerTicketFile(db,id,U,{sourceId,size,url,name:'../../証拠.txt',messageId:'message',sourceChannelId:'channel'},T);
it('添付URLはDiscordのHTTPSだけ。認証・偽装ホスト・ローカル・リダイレクトを許さない',async()=>{
 for(const url of ['http://cdn.discordapp.com/a','https://cdn.discordapp.com.evil/a','https://user:pass@cdn.discordapp.com/a','https://127.0.0.1/a','https://cdn.discordapp.com:444/a'])expect(f.validTicketAttachmentUrl(url)).toBe(false);
 expect(f.validTicketAttachmentUrl('https://media.discordapp.net/a')).toBe(true);await expect(reg('bad',3,'http://localhost/a')).rejects.toThrow();
 let redirect='';await reg();await f.saveNextTicketFile(db,T,{root,fetcher:async(_u,init)=>{redirect=String(init?.redirect);return new Response('abc');}});expect(redirect).toBe('error');
});
it('容量の予約は同時でも上限以内。重複IDは1件だけ',async()=>{
 await db.update(ticketOperations).set({policy:{...(await import('../src/services/ticketOperations.js').then(m=>m.operationOf(db,id)))!.policy,fileMaxMB:1,ticketMaxMB:1}}).where(eq(ticketOperations.ticketId,id));
 const results=await Promise.allSettled([reg('a',700000),reg('b',700000)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 const first=(await db.select().from(ticketAttachments))[0]!;expect((await reg(first.sourceId,first.size))!.id).toBe(first.id);await expect(reg('large',1048577)).rejects.toThrow();
});
it('ダウンロードの実バイト数を確認し、安全な名前で保存する',async()=>{
 const row=(await reg())!;await f.saveNextTicketFile(db,T,{root,fetcher:async()=>new Response('abc')});const saved=(await db.select().from(ticketAttachments))[0]!;
 expect(saved.status).toBe('ready');expect(saved.sourceUrl).toBeNull();expect((await f.readTicketFile(saved,root))!.toString()).toBe('abc');expect(await readdir(root)).toEqual([row.storageKey]);
});
it('大きすぎる本文は途中で止め、一時ファイルを残さず再試行する',async()=>{
 await reg();await f.saveNextTicketFile(db,T,{root,fetcher:async()=>new Response('abcd')});let row=(await db.select().from(ticketAttachments))[0]!;expect(row.status).toBe('failed');expect(await readdir(root)).toEqual([]);
 expect(await f.saveNextTicketFile(db,new Date(+T+1000),{root})).toBe(false);
 let url='';await f.saveNextTicketFile(db,new Date(+T+300001),{root,refreshUrl:async()=> 'https://cdn.discordapp.com/fresh',fetcher:async u=>{url=String(u);return new Response('abc');}});row=(await db.select().from(ticketAttachments))[0]!;expect(row.status).toBe('ready');expect(url).toContain('/fresh');
});
it('本文が短い場合も未保存として扱う',async()=>{await reg();await f.saveNextTicketFile(db,T,{root,fetcher:async()=>new Response('ab')});expect((await db.select().from(ticketAttachments))[0]!.status).toBe('failed');});
it('Webのアップロードも同じ保存先・上限を使い、実名をパスにしない',async()=>{
 const fileId=await f.uploadTicketFile(db,id,U,new File(['abc'],'../../写真.html',{type:'text/html'}),root,T);const row=(await db.select().from(ticketAttachments))[0]!;expect(row.id).toBe(fileId);expect(row.name).toBe('../../写真.html');expect((await f.readTicketFile(row,root))!.toString()).toBe('abc');expect(await readdir(root)).toEqual([row.storageKey]);
});
it('期限切れの資料は実体も消す',async()=>{await reg();await f.saveNextTicketFile(db,T,{root,fetcher:async()=>new Response('abc')});await db.update(ticketOperations).set({expiredAt:T}).where(eq(ticketOperations.ticketId,id));expect(await f.purgeTicketFiles(db,root)).toBe(1);expect(await readdir(root)).toEqual([]);expect(await reg('expired')).toBeUndefined();});
it('24時間以内の書込みは守り、古い孤立ファイルだけを整理する',async()=>{
 const key='12345678-1234-1234-1234-123456789abc';await writeFile(join(root,key),'old');await utimes(join(root,key),new Date(+T-2*86400000),new Date(+T-2*86400000));await writeFile(join(root,'keep.txt'),'keep');expect(await f.cleanupTicketFileOrphans(db,root,T)).toBe(1);expect(await readFile(join(root,'keep.txt'),'utf8')).toBe('keep');
});

it('中断したWeb添付は再試行後に予約を解除し、再アップロードできる',async()=>{
 await f.registerTicketFile(db,id,U,{sourceId:'upload:interrupted',url:'https://cdn.discordapp.com/web-upload',name:'資料',size:3},T);
 expect(await f.saveNextTicketFile(db,T,{root})).toBe(false);
 await f.saveNextTicketFile(db,new Date(+T+120001),{root,fetcher:async()=>new Response('error',{status:404})});
 await f.saveNextTicketFile(db,new Date(+T+420002),{root});expect(await db.select().from(ticketAttachments)).toEqual([]);
 expect(await f.uploadTicketFile(db,id,U,new File(['abc'],'再送.txt'),root,T)).toBeGreaterThan(0);
});

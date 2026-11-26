import {beforeEach,afterEach,expect,it} from 'vitest';
import {eq} from 'drizzle-orm';
import {makeDb,cfg} from './helpers.js';
import type {Db} from '../src/db/client.js';
import {auditLogs,settings} from '../src/db/schema.js';
import {betaTesters,changeBetaTester,isBetaTester} from '../src/services/shinpu/beta.js';
const A='770000000000000001',B='770000000000000002',OP='770000000000000099';
let db:Db,close:()=>Promise<void>;
beforeEach(async()=>{({db,close}=await makeDb());});afterEach(async()=>close());
const change=(userId:string,add=true,guildId=cfg.guildId)=>changeBetaTester(db,{userId,add,guildId,actorId:OP});
it('招待は既定で空。在籍確認とは別に、登録したIDだけを許可する',async()=>{
 expect(await betaTesters(db,cfg.guildId)).toEqual([]);expect(await isBetaTester(db,cfg.guildId,A)).toBe(false);
 expect(await change(A)).toBe('added');expect(await isBetaTester(db,cfg.guildId,A)).toBe(true);expect(await isBetaTester(db,cfg.guildId,B)).toBe(false);
 const freshRead=await betaTesters(db,cfg.guildId);expect(freshRead).toMatchObject([{userId:A,addedBy:OP}]);
});
it('同時登録と同じIDの連打でも、対象と監査を重複させない',async()=>{
 const results=await Promise.all([change(A),change(B),change(A)]);expect(results.filter(r=>r==='added')).toHaveLength(2);expect(results.filter(r=>r==='already')).toHaveLength(1);
 expect((await betaTesters(db,cfg.guildId)).map(t=>t.userId).sort()).toEqual([A,B]);
 expect(await db.select().from(auditLogs).where(eq(auditLogs.action,'shinpu.beta.invite'))).toHaveLength(2);
 const removed=await Promise.all([change(A,false),change(A,false)]);expect(removed.sort()).toEqual(['missing','removed']);expect(await isBetaTester(db,cfg.guildId,A)).toBe(false);
 expect((await betaTesters(db,cfg.guildId)).map(t=>t.userId)).toEqual([B]);expect(await db.select().from(auditLogs).where(eq(auditLogs.action,'shinpu.beta.remove'))).toHaveLength(1);
});
it('別のサーバーと他の設定を変更せず、入力不正を保存しない',async()=>{
 await db.insert(settings).values({key:'unrelated',value:{keep:true},updatedBy:OP});await change(A);
 expect(await isBetaTester(db,'900000000000000999',A)).toBe(false);await expect(change('bad-id')).rejects.toThrow();
 expect((await db.select().from(settings).where(eq(settings.key,'unrelated')))[0]!.value).toEqual({keep:true});expect(await betaTesters(db,cfg.guildId)).toHaveLength(1);
});
it('壊れた招待データを全員許可として扱わない',async()=>{
 await db.insert(settings).values({key:`shinpu.beta:${cfg.guildId}`,value:{testers:'everyone'},updatedBy:OP});
 await expect(isBetaTester(db,cfg.guildId,A)).rejects.toThrow();
});
it('登録上限でも既存の招待と他の設定を保持する',async()=>{
 const testers=Array.from({length:200},(_,i)=>({userId:'78000000000000'+String(i).padStart(4,'0'),addedBy:OP,addedAt:new Date().toISOString()}));
 await db.insert(settings).values({key:`shinpu.beta:${cfg.guildId}`,value:{testers},updatedBy:OP});
 expect(await change(A)).toBe('full');expect(await betaTesters(db,cfg.guildId)).toHaveLength(200);expect(await isBetaTester(db,cfg.guildId,A)).toBe(false);
});

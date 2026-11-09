import {setStaffAlt} from '../src/services/staffAlts.js';
import {lobbyResumes} from '../src/services/casino/lobby.js';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {eq} from 'drizzle-orm';
import {makeDb,cfg,ROLE} from './helpers.js';
import type {Db} from '../src/db/client.js';
import {casinoGames,casinoArcadeRequests,coinTx,auditLogs} from '../src/db/schema.js';
import {recordJoin} from '../src/services/members.js';
import {addCoins,walletOf} from '../src/services/economy.js';
import * as audits from '../src/services/audit.js';
import {commandArcade,arcadeById,arcadeRound,type ArcadeCommand} from '../src/services/casino/arcade.js';
import {actBlackjack,actHighLow,aimSlots,actOthello} from '../src/services/casino/casino.js';
const id='760000000000000001',other='760000000000000002',now=new Date('2026-11-09T05:00:00Z'),last=(n:number)=>n-1;
let db:Db,close:()=>Promise<void>,seq=0;
const command=(change:Partial<ArcadeCommand>={}):ArcadeCommand=>({operationId:'arcade_request_'+String(++seq).padStart(12,'0'),kind:'fortune',action:'start',bet:100,...change});
beforeEach(async()=>{({db,close}=await makeDb());seq=0;for(const uid of [id,other]){await recordJoin(db,{id:uid,username:'fixture',displayName:'確認用',avatarUrl:null,roleIds:[ROLE.guji],isBot:false,joinedAt:now});await addCoins(db,uid,5000,'adjust');}});afterEach(async()=>{vi.restoreAllMocks();await close();});
it('同じ開始IDの連打・並行実行でも、投入/払戻/履歴/監査は1回だけ',async()=>{
 const op=command();let draws=0;const results=await Promise.all([0,1,2,3].map(()=>commandArcade(db,cfg,id,op,now,n=>{draws++;return n-1;})));expect(new Set(results.map(r=>r.id)).size).toBe(1);expect(draws).toBe(1);expect((await walletOf(db,id)).balance).toBe(5200);expect(await db.select().from(casinoGames)).toHaveLength(1);expect(await db.select().from(casinoArcadeRequests)).toHaveLength(1);expect(await db.select().from(coinTx).where(eq(coinTx.reason,'casino_bet'))).toHaveLength(1);expect(await db.select().from(coinTx).where(eq(coinTx.reason,'casino_win'))).toHaveLength(1);expect(await db.select().from(auditLogs).where(eq(auditLogs.action,'casino.arcade.finish'))).toHaveLength(1);
 await expect(commandArcade(db,cfg,id,{...op,bet:200},now,last)).rejects.toThrow('内容が変わって');expect((await walletOf(db,id)).balance).toBe(5200);
});
it('マス選択と受取はversionで排他し、別nonceの同時受取でも二重付与しない',async()=>{
 const start=await commandArcade(db,cfg,id,command({kind:'mines'}),now,last);expect((await walletOf(db,id)).balance).toBe(4900);
 const picked=await commandArcade(db,cfg,id,command({kind:'mines',action:'pick',bet:undefined,id:start.id,version:0,choice:24}),now,last);expect(picked.version).toBe(1);
 const operations=[0,1].map(()=>commandArcade(db,cfg,id,command({kind:'mines',action:'collect',bet:undefined,id:start.id,version:1}),now,last));const result=await Promise.allSettled(operations);expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await walletOf(db,id)).balance).toBe(5010);expect(await db.select().from(coinTx).where(eq(coinTx.reason,'casino_win'))).toHaveLength(1);
});
it('進行中/賭け制限/ゲーム停止/同一秒の新規開始を確認し、休止後も保存分を精算できる',async()=>{
 const s=await commandArcade(db,cfg,id,command({kind:'mines'}),now,last);await expect(commandArcade(db,cfg,id,command(),now,last)).rejects.toThrow('進行中');
 const picked=await commandArcade(db,cfg,id,command({kind:'mines',action:'pick',bet:undefined,id:s.id,version:0,choice:24}),now,last);
 const off={...cfg,casino:{...cfg.casino,games:[],arcadeGames:[]}};
 const done=await commandArcade(db,off,id,command({kind:'mines',action:'collect',bet:undefined,id:s.id,version:picked.version}),now,last);expect(done.payout).toBe(110);
 await expect(commandArcade(db,cfg,id,command(),now,last)).rejects.toThrow('1秒');await expect(commandArcade(db,off,id,command(),new Date(+now+2000),last)).rejects.toThrow();
 const capped={...cfg,casino:{...cfg.casino,dailyBetLimit:100}};await expect(commandArcade(db,capped,id,command(),new Date(+now+2000),last)).rejects.toThrow('今日');expect((await walletOf(db,id)).balance).toBe(5010);
});
it('非公開状態はDBだけに残し、他人の回と別ゲームへのID差替えを拒否する',async()=>{
 const s=await commandArcade(db,cfg,id,command({kind:'mines'}),now,last),view=arcadeRound(s,now);expect(view.model.board?.every(v=>v==='hidden')).toBe(true);expect(view.model).not.toHaveProperty('hidden');expect(await arcadeById(db,other,s.id)).toBeUndefined();
 await expect(commandArcade(db,cfg,other,command({kind:'mines',action:'pick',id:s.id,version:0,choice:24}),now,last)).rejects.toThrow('見つかりません');
 for(const result of [await actBlackjack(db,cfg,s.id,id,'hit',now),await actHighLow(db,s.id,id,'cashout',last,now),await aimSlots(db,s.id,id,'assist',now),await actOthello(db,s.id,id,'resign',last,now)])expect(result.status).toBe('invalid');
 expect(await arcadeById(db,id,s.id)).toEqual(s);expect((await walletOf(db,id)).balance).toBe(4900);expect((await walletOf(db,other)).balance).toBe(5000);
});
it('監査保存に失敗した場合は、徴収/払戻/ゲーム/操作IDを全てロールバックする',async()=>{
 vi.spyOn(audits,'audit').mockRejectedValueOnce(Error('fixture audit failure'));await expect(commandArcade(db,cfg,id,command(),now,last)).rejects.toThrow('fixture audit');expect((await walletOf(db,id)).balance).toBe(5000);expect(await db.select().from(casinoGames)).toHaveLength(0);expect(await db.select().from(casinoArcadeRequests)).toHaveLength(0);expect(await db.select().from(coinTx).where(eq(coinTx.reason,'casino_bet'))).toHaveLength(0);expect(await db.select().from(coinTx).where(eq(coinTx.reason,'casino_win'))).toHaveLength(0);
});
it('受取失敗後に同じ操作IDで再開しても、1回だけ払戻す',async()=>{
 const s=await commandArcade(db,cfg,id,command({kind:'mines'}),now,last);await commandArcade(db,cfg,id,command({kind:'mines',action:'pick',id:s.id,version:0,choice:24}),now,last);const op=command({kind:'mines',action:'collect',id:s.id,version:1});vi.spyOn(audits,'audit').mockRejectedValueOnce(Error('fixture interrupted'));await expect(commandArcade(db,cfg,id,op,now,last)).rejects.toThrow();expect((await walletOf(db,id)).balance).toBe(4900);expect((await arcadeById(db,id,s.id))?.status).toBe('playing');vi.restoreAllMocks();await commandArcade(db,cfg,id,op,now,last);await commandArcade(db,cfg,id,op,now,last);expect((await walletOf(db,id)).balance).toBe(5010);
});

it('サブアカウントの投入を拒否し、公開停止中でも保存分への入口を残す',async()=>{
 await setStaffAlt(db,other,true,id,'','fixture',now);await expect(commandArcade(db,cfg,other,command(),now,last)).rejects.toThrow('このアカウント');expect(await db.select().from(casinoGames)).toHaveLength(0);
 const r=await commandArcade(db,cfg,id,command({kind:'mines'}),now,last);expect(await lobbyResumes(db,id,[])).toEqual([{game:'arcade',id:r.id}]);
});

import {randomUUID} from 'node:crypto';
import {afterEach,beforeEach,expect,it} from 'vitest';
import {eq} from 'drizzle-orm';
import {makeDb} from './helpers.js';
import type {Db} from '../src/db/client.js';
import {members,bingoEvents,bingoCards,coinTx} from '../src/db/schema.js';
import {makeBingoCard,bingoProgress,createBingo,joinBingo,controlBingo,bingoState,claimBingo} from '../src/services/bingo.js';
const A='880000000000000001',B='880000000000000002',C='880000000000000003',base=new Date('2026-10-26T10:00:00Z');
let db:Db,close:()=>Promise<void>;
beforeEach(async()=>{({db,close}=await makeDb());await db.insert(members).values([A,B,C].map((id,i)=>({id,username:'bingo'+i,displayName:'参加者'+i})));});
afterEach(async()=>close());
const create=(id:string=randomUUID(),now=base)=>createBingo(db,{id,title:'秋のビンゴ',actorId:A,staff:true},now);
const start=async(id:string)=>{const e=(await bingoState(db,A,id,base)).event!;return controlBingo(db,{id,actorId:A,staff:true,action:'start',version:e.version},base);};
const known=()=>Array.from({length:25},(_,i)=>i===12?0:(i%5)*15+Math.floor(i/5)+1);
it('カードは5列の範囲を守り、中央FREE・残り24番号が重複しない',()=>{
 for(let n=0;n<40;n++){const card=makeBingoCard();expect(card).toHaveLength(25);expect(card[12]).toBe(0);expect(new Set(card).size).toBe(25);card.forEach((v,i)=>{if(i!==12){expect(v).toBeGreaterThanOrEqual(i%5*15+1);expect(v).toBeLessThanOrEqual(i%5*15+15);}});}
});
it('縦横斜め・FREEを含むリーチと複数ラインの成立抽選を計算する',()=>{
 const c=known(),row=c.slice(10,15).filter(Boolean);const p=bingoProgress(c,row.slice(0,3));expect(p.lines).toBe(0);expect(p.reachNumbers).toContain(row[3]);expect(p.marked[12]).toBe(true);
 expect(bingoProgress(c,row)).toMatchObject({lines:1,bingoAt:4});const draws=[...c.slice(0,5),...c.slice(5,10)];expect(bingoProgress(c,draws)).toMatchObject({lines:2,bingoAt:5,doubleAt:10});
 expect(bingoProgress(c,[c[0]!,c[6]!,c[18]!,c[24]!]).lines).toBe(1);
});
it('作成は運営のみ・再送は同じイベント・同時に受付できるのは1つ',async()=>{
 await expect(createBingo(db,{id:randomUUID(),title:'イベント',actorId:B,staff:false},base)).rejects.toThrow('宮司');
 const id=randomUUID();const results=await Promise.allSettled([create(id),create()]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);const [e]=await db.select().from(bingoEvents);expect((await create(e!.id)).id).toBe(e!.id);expect((await db.select().from(bingoEvents)).length).toBe(1);
 await expect(createBingo(db,{id:e!.id,title:'横取り',actorId:B,staff:true},base)).rejects.toThrow();
});
it('参加は1枚だけで再読込/再送でも維持し、開始後の新規参加はできない',async()=>{
 const e=await create();const cards=await Promise.all([joinBingo(db,e.id,A,base),joinBingo(db,e.id,A,base)]);expect(cards[0]!.numbers).toEqual(cards[1]!.numbers);expect((await db.select().from(bingoCards)).length).toBe(1);await start(e.id);
 expect((await joinBingo(db,e.id,A,base)).numbers).toEqual(cards[0]!.numbers);await expect(joinBingo(db,e.id,B,base)).rejects.toThrow('終了');expect((await bingoState(db,A,e.id,base)).card!.numbers).toEqual(cards[0]!.numbers);
});
it('抽選は3秒後に1回だけ公開し、古い版/同時クリックで追加抽選しない',async()=>{
 const e=await create();await joinBingo(db,e.id,A,base);const active=await start(e.id);const input={id:e.id,actorId:A,staff:true,action:'draw' as const,version:active.version};
 const attempts=await Promise.allSettled([controlBingo(db,input,base),controlBingo(db,input,base)]);expect(attempts.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 const before=await bingoState(db,A,e.id,new Date(base.getTime()+2999));expect(before.event!.draws).toEqual([]);expect(before.event!.revealAt).toBe(base.getTime()+3000);expect(JSON.stringify(before)).not.toContain('pendingNumber');
 const [a,b]=await Promise.all([bingoState(db,A,e.id,new Date(base.getTime()+3000)),bingoState(db,B,e.id,new Date(base.getTime()+3000))]);expect(a.event!.draws).toHaveLength(1);expect(a.event!.draws).toEqual(b.event!.draws);expect(a.event!.version).toBe(b.event!.version);expect(b.card).toBeNull();await expect(controlBingo(db,input,new Date(base.getTime()+4000))).rejects.toThrow('更新');
});
it('75番号を重複せず抽選し、抽選枠が尽きても増やさない',async()=>{
 const e=await create();await joinBingo(db,e.id,A,base);await start(e.id);let now=base,state=await bingoState(db,A,e.id,now);
 for(let i=0;i<75;i++){await controlBingo(db,{id:e.id,actorId:A,staff:true,action:'draw',version:state.event!.version},now);now=new Date(now.getTime()+3000);state=await bingoState(db,A,e.id,now);}
 expect(new Set(state.event!.draws).size).toBe(75);expect([...state.event!.draws].sort((a,b)=>a-b)).toEqual(Array.from({length:75},(_,i)=>i+1));expect(state.card!.lines).toBe(12);await expect(controlBingo(db,{id:e.id,actorId:A,staff:true,action:'draw',version:state.event!.version},now)).rejects.toThrow('すべて');
});
it('同じ抽選の成立者は申告時刻に関係なく同着で、未成立申告や二重申告を防ぐ',async()=>{
 const e=await create();await joinBingo(db,e.id,A,base);await joinBingo(db,e.id,B,base);await start(e.id);await expect(claimBingo(db,e.id,A,base)).rejects.toThrow('まだ');
 await db.update(bingoCards).set({numbers:known()}).where(eq(bingoCards.eventId,e.id));const row=known().slice(0,5);await db.update(bingoEvents).set({draws:row.slice(0,4),pendingNumber:row[4],revealAt:base}).where(eq(bingoEvents.id,e.id));
 const result=await bingoState(db,A,e.id,base);expect(result.event!.summary.winners.map(w=>w.rank)).toEqual([1,1]);expect(result.event!.summary.winners.map(w=>w.at)).toEqual([5,5]);
 await Promise.all([claimBingo(db,e.id,B,base),claimBingo(db,e.id,B,base)]);await claimBingo(db,e.id,A,new Date(base.getTime()+10000));const final=await bingoState(db,A,e.id,base);expect(final.event!.summary.winners.every(w=>w.rank===1&&w.claimed)).toBe(true);await expect(claimBingo(db,e.id,C,base)).rejects.toThrow();expect(await db.select().from(coinTx)).toHaveLength(0);
});
it('抽選中の終了を防ぎ、確認して終了後もカードと結果を残し次の受付を優先する',async()=>{
 const e=await create();await joinBingo(db,e.id,A,base);const active=await start(e.id);await expect(controlBingo(db,{id:e.id,actorId:A,staff:true,action:'close',version:active.version},base)).rejects.toThrow('確認');
 const pending=await controlBingo(db,{id:e.id,actorId:A,staff:true,action:'draw',version:active.version},base);await expect(controlBingo(db,{id:e.id,actorId:A,staff:true,action:'close',version:pending.version,confirm:true},base)).rejects.toThrow('結果');
 const ready=await bingoState(db,A,e.id,new Date(base.getTime()+3000));await controlBingo(db,{id:e.id,actorId:A,staff:true,action:'close',version:ready.event!.version,confirm:true},new Date(base.getTime()+3000));expect((await bingoState(db,A,e.id,base)).card).not.toBeNull();const next=await create(randomUUID(),new Date(base.getTime()-10000));expect((await bingoState(db,A,undefined,base)).event!.id).toBe(next.id);
});
it('個人のカードだけを返し、他人のカード情報を含めない',async()=>{
 const e=await create();const a=await joinBingo(db,e.id,A,base),b=await joinBingo(db,e.id,B,base);const state=await bingoState(db,A,e.id,base);expect(state.card!.numbers).toEqual(a.numbers);expect(state.card!.numbers).not.toEqual(b.numbers);expect(state.event!.summary).toEqual({participants:2,reaches:0,winners:[]});expect(Object.keys(state.event!)).not.toContain('pendingNumber');
});

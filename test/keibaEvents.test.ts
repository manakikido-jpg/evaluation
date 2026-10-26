import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import {eq} from 'drizzle-orm';
import type {Db} from '../src/db/client.js';
import {cfg,makeDb} from './helpers.js';
import {saveEvent,enterEvent,eventTick,eventScores,claimEvent,cancelEvent,equipEventSilk,type EventInput} from '../src/services/casino/keibaEvents.js';
import {keibaEvents,keibaEntries,keibaEventRewards,keibaEventEntries,casinoTables,keibaHorses} from '../src/db/schema.js';
import {addHorse} from '../src/services/casino/keibaStable.js';
import {seeded} from '../src/services/casino/keiba.js';
import type {KbState} from '../src/services/casino/tables/keiba.js';
import {pollTable} from '../src/services/casino/tables/service.js';
const A='760000000000000001',B='760000000000000002',C='760000000000000003',now=new Date('2026-10-27T00:00:00Z');
const input=(kind:EventInput['kind']='league'):EventInput=>({name:'秋の咲楽杯',kind,startsAt:new Date(now.getTime()+3600000),endsAt:new Date(now.getTime()+86400000),rules:{dist:1600,surface:0,maxStarts:100,minWins:0,maxWins:100,points:[10,7,5,3,2,1,0,0],rewardTitle:'秋の記念',rewardColor:'#d4af37',rewardPlaces:1}});
let db:Db,close:()=>Promise<void>;
beforeEach(async()=>{({db,close}=await makeDb());});afterEach(async()=>{await close();});
const horse=async(owner:string,n:string)=> (await addHorse(db,n,seeded(n.length*77),owner))!;
async function newEvent(kind:EventInput['kind']='league'){const i=input(kind);expect(await saveEvent(db,i,A,now)).toBe(true);return (await db.select().from(keibaEvents))[0]!;}
async function record(h:{id:number;name:string;ownerId:string|null},e:Awaited<ReturnType<typeof newEvent>>,pos=1,at=new Date(e.startsAt.getTime()+10000)){await db.insert(keibaEntries).values({horseId:h.id,horseName:h.name,ownerId:h.ownerId,race:'条件レース',cls:0,dist:1600,surface:0,field:8,no:1,pop:1,odds:20,pos,time:'1:30.0',at});}
describe('大会の条件と記念報酬',()=>{
 it('不正な設定・開始後の編集・他人の馬・条件外登録を拒否する',async()=>{expect(await saveEvent(db,{...input(),endsAt:now},A,now)).toBe(false);expect(await saveEvent(db,input(),A,now,NaN)).toBe(false);expect(await enterEvent(db,NaN,1,A,'',now)).toBe(false);expect(await cancelEvent(db,1.5,now)).toBe(false);const e=await newEvent('rookie'),h=await horse(A,'新馬');expect(await enterEvent(db,e.id,h.id,B,'',now)).toBe(false);expect(await enterEvent(db,e.id,h.id,A,'',now)).toBe(true);await db.update(keibaHorses).set({starts:1}).where(eq(keibaHorses.id,h.id));expect(await enterEvent(db,e.id,h.id,A,'',now)).toBe(false);expect(await saveEvent(db,input(),A,e.startsAt,e.id)).toBe(false);expect(await enterEvent(db,e.id,h.id,A,'',e.startsAt)).toBe(false);});
 it('期間・距離・所有者を確認し、同点を同順位にし、報酬は同時受取でも1つ',async()=>{const e=await newEvent(),a=await horse(A,'さくら'),b=await horse(B,'つき');await enterEvent(db,e.id,a.id,A,'',now);await enterEvent(db,e.id,b.id,B,'',now);await record(a,e);await record(b,e);await record(a,e,1,new Date(e.startsAt.getTime()-1));await record({...a,ownerId:C},e);await record(a,e,1,e.endsAt);await db.insert(keibaEntries).values({horseId:a.id,horseName:a.name,ownerId:A,race:'対象外',cls:0,dist:2400,surface:0,field:8,no:1,pop:1,odds:20,pos:1,time:'2:30.0',at:new Date(e.startsAt.getTime()+1000)});const scores=await eventScores(db,e.id);expect(scores.map(s=>s.rank)).toEqual([1,1]);expect(scores.map(s=>s.points)).toEqual([10,10]);expect(await claimEvent(db,e.id,A,e.startsAt)).toBe(false);await Promise.all([claimEvent(db,e.id,A,e.endsAt),claimEvent(db,e.id,A,e.endsAt),claimEvent(db,e.id,B,e.endsAt)]);expect(await db.select().from(keibaEventRewards)).toHaveLength(2);expect(await equipEventSilk(db,e.id,C)).toBe(false);expect(await equipEventSilk(db,e.id,A)).toBe(true);});
 it('チーム名を登録し、チーム全体の得点と参加者を集計する',async()=>{const e=await newEvent('team'),a=await horse(A,'あお'),b=await horse(B,'あか');expect(await enterEvent(db,e.id,a.id,A,'',now)).toBe(false);await enterEvent(db,e.id,a.id,A,'桜組',now);expect(await enterEvent(db,e.id,a.id,A,'別の組',now)).toBe(false);await enterEvent(db,e.id,b.id,B,'桜組',now);await record(a,e,1);await record(b,e,2);const scores=await eventScores(db,e.id);expect(scores[0]!.points).toBe(17);expect(scores[0]!.members.sort()).toEqual([A,B]);});
 it('単発大会は専用卓だけを数え、二重起動で卓を増やさず、出走確定後は変更しない',async()=>{const e=await newEvent('season');for(let i=0;i<4;i++){const h=await horse(i%2?B:A,'出走'+i);await enterEvent(db,e.id,h.id,h.ownerId!,'',now);}
 const opening=new Date(e.startsAt.getTime()-5*60000);await Promise.all([eventTick(db,cfg,opening),eventTick(db,cfg,opening)]);const [saved]=await db.select().from(keibaEvents).where(eq(keibaEvents.id,e.id));expect(saved!.tableId).toBeTruthy();const tables=await db.select().from(casinoTables);expect(tables).toHaveLength(1);expect(await cancelEvent(db,e.id,opening)).toBe(false);expect(await saveEvent(db,input(),A,opening,e.id)).toBe(false);
 const s=tables[0]!.state as KbState;expect(s.race.surface).toBe(0);expect(s.race.dist).toBe(1600);expect(s.horses).toHaveLength(4);await pollTable(db,cfg,tables[0]!.id,new Date(e.startsAt.getTime()+1));await pollTable(db,cfg,tables[0]!.id,new Date(e.startsAt.getTime()+120000));const results=await eventScores(db,e.id);expect(results.reduce((n,r)=>n+r.runs,0)).toBe(4);const records=await db.select().from(keibaEntries);expect(records.reduce((n,r)=>n+r.prize,0)).toBeLessThanOrEqual(100);
 });
 it('運営の編集と出走確定が重なっても、古い設定の卓を新設定へ紐づけない',async()=>{
  const e=await newEvent('season');for(let i=0;i<4;i++){const h=await horse(A,'並行'+i);await enterEvent(db,e.id,h.id,A,'',now);}const opening=new Date(e.startsAt.getTime()-300000),changed={...input('season'),name:'変更後の杯',startsAt:new Date(e.startsAt.getTime()+3600000)};
  const [ok]=await Promise.all([saveEvent(db,changed,A,opening,e.id),eventTick(db,cfg,opening)]);const [saved]=await db.select().from(keibaEvents).where(eq(keibaEvents.id,e.id));
  if(saved!.tableId){expect(ok).toBe(false);const [t]=await db.select().from(casinoTables).where(eq(casinoTables.id,saved!.tableId));expect((t!.state as KbState).race.name).toContain(saved!.name);}else{expect(ok).toBe(true);expect(saved!.name).toBe('変更後の杯');}
 });

});

import {afterEach,beforeEach,expect,it} from 'vitest';
import {and,eq,sql} from 'drizzle-orm';
import {makeDb,ROLE} from './helpers.js';
import type {Db} from '../src/db/client.js';
import {coinTx,kisekiTickets,settings} from '../src/db/schema.js';
import {recordJoin} from '../src/services/members.js';
import {addCoins,spendCoins,walletOf} from '../src/services/economy.js';
import {setStaffAlt} from '../src/services/staffAlts.js';
import {buyExperience,startExperience,playExperience,experienceState,experienceSales,setExperienceSales,experienceTotals,EXPERIENCE_FLOOR_KEY} from '../src/services/casino/kiseki/experience.js';
import {readTrial,TRIAL_KEY,type Floor} from '../src/services/casino/kiseki/trial.js';
import {scenario,lever} from '../src/services/casino/kiseki/engine.js';
const A='760000000000000001',B='760000000000000002',now=new Date('2026-11-09T03:00:00Z'),last=(n:number)=>n-1;
let db:Db,close:()=>Promise<void>;
beforeEach(async()=>{({db,close}=await makeDb());for(const id of [A,B]){await recordJoin(db,{id,username:'fixture',displayName:'架空',avatarUrl:null,roleIds:[ROLE.sanpaisha],isBot:false,joinedAt:now});await addCoins(db,id,5000,'adjust');}});afterEach(async()=>close());
async function ticket(id=A,key='request_000000000001'){await setExperienceSales(db,A,true,now);return buyExperience(db,id,key,now);}
async function action(name:string,at=now,index?:number,id=A){const s=await experienceState(db,id,at);await playExperience(db,id,'架空',{action:name,machine:s.view.own?.id??1,revision:s.view.revision,index},at,last);}
async function setFloor(fn:(f:Floor)=>void){const [r]=await db.select().from(settings).where(eq(settings.key,EXPERIENCE_FLOOR_KEY));const f=r!.value as Floor;fn(f);await db.update(settings).set({value:f}).where(eq(settings.key,EXPERIENCE_FLOOR_KEY));}
it('初期販売停止、購入時だけ1500銭を消費し、同一購入IDの再送では再徴収しない',async()=>{
 expect(await experienceSales(db)).toBe(false);await expect(buyExperience(db,A,'request_000000000001',now)).rejects.toThrow('お休み');
 const t=await ticket();const retry=await buyExperience(db,A,t.requestId,now);expect(retry.id).toBe(t.id);expect((await walletOf(db,A)).balance).toBe(3500);expect((await walletOf(db,B)).balance).toBe(5000);
 expect(await db.select().from(coinTx).where(eq(coinTx.reason,'kiseki_ticket'))).toHaveLength(1);expect(await db.select().from(kisekiTickets)).toHaveLength(1);expect(await experienceTotals(db)).toMatchObject({count:1,started:0});
 await setExperienceSales(db,A,false,now);expect((await buyExperience(db,A,t.requestId,now)).id).toBe(t.id);
});
it('残高不足・サブアカウント・不正IDは券も徴収も作らず、他人の券は使えない',async()=>{
 await setExperienceSales(db,A,true,now);
 await expect(buyExperience(db,A,'bad',now)).rejects.toThrow('開き直し');await spendCoins(db,A,4900,'adjust');await expect(buyExperience(db,A,'request_000000000001',now)).rejects.toThrow('足りません');expect(await db.select().from(kisekiTickets)).toHaveLength(0);
 const t=await ticket(B);await expect(startExperience(db,A,'架空',t.id,now)).rejects.toThrow('自分');await setStaffAlt(db,B,true,A);await expect(buyExperience(db,B,'request_000000000002',now)).rejects.toThrow('アカウント');await expect(startExperience(db,B,'架空',t.id,now)).rejects.toThrow('アカウント');
 expect(await db.select().from(coinTx).where(eq(coinTx.reason,'kiseki_ticket'))).toHaveLength(1);
});
it('購入から時間を消費せず、使用開始で空席に着席し、再開始で延長しない',async()=>{
 const t=await ticket(),later=new Date(now.getTime()+86400000);expect((await experienceState(db,A,later)).unused).toHaveLength(1);
 const a=await startExperience(db,A,'架空',t.id,later);expect(a.endsAt!.getTime()-a.startedAt!.getTime()).toBe(3600000);expect((await experienceState(db,A,later)).view.own).not.toBeNull();
 expect((await startExperience(db,A,'架空',t.id,new Date(later.getTime()+10000))).endsAt).toEqual(a.endsAt);const next=await buyExperience(db,A,'request_000000000002',later);await expect(startExperience(db,A,'架空',next.id,later)).rejects.toThrow('使用中');expect((await experienceState(db,A,later)).unused).toHaveLength(1);
});
it('満席なら券を使わず、販売停止後も購入済みの券と利用中の残時間を守る',async()=>{
 const t=await ticket();await setFloor(f=>{f.machines.forEach((m,i)=>{m.owner='other'+i;m.lastAction=now.getTime();});});
 // 他人にも有効な時間がある状態で満席にする。
 for(let i=0;i<5;i++)await db.insert(kisekiTickets).values({id:'other_ticket_'+i,memberId:'other'+i,requestId:'other_request_'+i,price:1500,seconds:3600,createdAt:now,startedAt:now,endsAt:new Date(now.getTime()+3600000)});
 await expect(startExperience(db,A,'架空',t.id,now)).rejects.toThrow('満席');expect((await experienceState(db,A,now)).unused).toHaveLength(1);
 await setFloor(f=>{f.machines[0]!.owner=null;});await setExperienceSales(db,A,false,now);await startExperience(db,A,'架空',t.id,now);await action('lever');expect((await experienceState(db,A,now)).active!.id).toBe(t.id);await expect(buyExperience(db,A,'request_000000000002',now)).rejects.toThrow('お休み');
});
it('期限境界で新規回転を拒否し、回転中のSTOP完了とボーナス保存・次券再開を守る',async()=>{
 const t=await ticket();await startExperience(db,A,'架空',t.id,now);await setFloor(f=>{const m=f.machines[0]!;m.state=scenario(1,'gg');m.lastAction=now.getTime()+3599000;lever(m.state,last,'god',true);});
 const end=new Date(now.getTime()+3600000);await expect(action('lever',end)).rejects.toThrow('体験時間');for(const i of [0,1,2])await action('stop',end,i);
 const s=await experienceState(db,A,end);expect(s.active).toBeNull();expect(s.view.own).toBeNull();expect(s.view.saved).toBe(true);expect(s.view.points).toBe(100120);expect(s.result).toMatchObject({paid:150,winEvent:{kind:'god'}});
 const n=await buyExperience(db,A,'request_000000000002',end);await startExperience(db,A,'架空',n.id,end);const resumed=(await experienceState(db,A,end)).view.own!;expect(resumed.resumed).toBe(true);expect(resumed.phase).toBe('pgg');expect(resumed.lastPaid).toBe(150);expect((await walletOf(db,A)).balance).toBe(2000);
});
it('期限直前は回転でき、期限後の離席と閲覧で時計を延長せず、未回転の続きも保存する',async()=>{
 const t=await ticket();await startExperience(db,A,'架空',t.id,now);const before=new Date(now.getTime()+3599999);await setFloor(f=>{f.machines[0]!.lastAction=before.getTime();});await action('lever',before);const end=new Date(now.getTime()+3600000);const s=await experienceState(db,A,end);expect(s.active).toBeNull();expect(s.view.own!.spinning).toBe(true);await expect(action('refill',end)).rejects.toThrow('体験時間');
 // 長い離席で回転途中が本人保存へ移っても、追加券なしで停止だけ再開できる。
 const idle=new Date(end.getTime()+600001);const paused=await experienceState(db,A,idle);expect(paused.finishSaved).toBe(true);await action('seat',idle);for(const i of [0,1,2])await action('stop',idle,i);expect((await experienceState(db,A,idle)).view.own).toBeNull();
});
it('設定・場面変更・他人の操作・古いrevisionを拒否し、運営無料試遊の保存を変えない',async()=>{
 const free=await readTrial(db,now),t=await ticket();await startExperience(db,A,'架空',t.id,now);await expect(action('scenario')).rejects.toThrow('利用できません');await expect(action('setting')).rejects.toThrow('利用できません');const s=await experienceState(db,A,now);
 await expect(playExperience(db,A,'架空',{action:'lever',machine:1,revision:s.view.revision-1},now)).rejects.toThrow('更新');await expect(playExperience(db,B,'架空',{action:'stop',machine:1,revision:s.view.revision,index:0},now)).rejects.toThrow();
 await action('lever');for(const i of [0,1,2])await action('stop',now,i);expect(await readTrial(db,now)).toEqual(free);expect(await db.select().from(settings).where(eq(settings.key,TRIAL_KEY))).toHaveLength(0);expect((await walletOf(db,A)).balance).toBe(3500);
});
it('購入の同時再送でも一意制約と排他で1券・1徴収になり、別の操作IDなら別購入できる',async()=>{
 await setExperienceSales(db,A,true,now);const result=await Promise.all([buyExperience(db,A,'request_000000000001',now),buyExperience(db,A,'request_000000000001',now)]);expect(result[0].id).toBe(result[1].id);expect((await walletOf(db,A)).balance).toBe(3500);
 await buyExperience(db,A,'request_000000000002',now);expect((await walletOf(db,A)).balance).toBe(2000);expect(await db.select().from(kisekiTickets).where(eq(kisekiTickets.memberId,A))).toHaveLength(2);
});

it('券保存の途中でDBが失敗しても引落しと履歴を丸ごと戻す',async()=>{
 await setExperienceSales(db,A,true,now);
 await db.execute(sql`create function reject_fixture_ticket() returns trigger language plpgsql as $$ begin raise exception 'fixture ticket save failed'; end $$`);
 await db.execute(sql`create trigger fixture_ticket_failure before insert on kiseki_tickets for each row execute function reject_fixture_ticket()`);
 await expect(buyExperience(db,A,'request_000000000001',now)).rejects.toThrow();expect((await walletOf(db,A)).balance).toBe(5000);expect(await db.select().from(kisekiTickets)).toHaveLength(0);expect(await db.select().from(coinTx).where(eq(coinTx.reason,'kiseki_ticket'))).toHaveLength(0);
});

it('別の体験者の操作は妨げず、同じ本人の古い操作だけを拒否する',async()=>{
 const a=await ticket(),b=await ticket(B);await startExperience(db,A,'架空A',a.id,now);await startExperience(db,B,'架空B',b.id,now);
 const va=(await experienceState(db,A,now)).view,vb=(await experienceState(db,B,now)).view;
 await playExperience(db,A,'架空A',{action:'lever',machine:va.own!.id,revision:va.revision},now,last);
 await playExperience(db,B,'架空B',{action:'lever',machine:vb.own!.id,revision:vb.revision},now,last);
 await expect(playExperience(db,A,'架空A',{action:'stop',machine:va.own!.id,revision:va.revision,index:0},now,last)).rejects.toThrow('表示が更新');
 expect((await experienceState(db,A,now)).view.own!.spinning).toBe(true);expect((await experienceState(db,B,now)).view.own!.spinning).toBe(true);
});

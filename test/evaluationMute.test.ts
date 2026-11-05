import {afterEach,beforeEach,expect,it} from 'vitest';
import {eq} from 'drizzle-orm';
import type {Db} from '../src/db/client.js';
import {members,shuin,voiceUsage,voiceChannels,evaluationTimeDeductions,auditLogs} from '../src/db/schema.js';
import {recordPresence} from '../src/services/voiceUsage.js';
import {isEvaluationUnmuted} from '../src/domain/voiceEvaluation.js';
import {ujikoEvaluation,evaluationCsv} from '../src/services/ujikoEvaluation.js';
import {evaluationDeductionPage,saveEvaluationDeduction} from '../src/services/evaluationDeductions.js';
import {cfg,makeDb,ROLE} from './helpers.js';
const A='860000000000000001',B='860000000000000002',ENG='960000000000000001',OTHER='960000000000000002',ACTOR='860000000000000099';
const now=new Date('2026-11-07T03:00:00Z'),filter={q:'',status:'all' as const};let db:Db,close:()=>Promise<void>;
beforeEach(async()=>{({db,close}=await makeDb());await db.insert(members).values([A,B].map(id=>({id,username:id,displayName:id,roleIds:[ROLE.sanpaisha]})));await db.insert(voiceChannels).values([{channelId:ENG,name:'縁側１'},{channelId:OTHER,name:'宿坊'}]);});afterEach(async()=>close());
const deduction=(minutes:number,expectedMinutes=0)=>({memberId:A,date:'2026-11-05',channelId:ENG,minutes,expectedMinutes,expectedUpdatedAt:expectedMinutes?now.toISOString():'',reason:'本人の記録と突き合わせて確認'});
async function past(){await db.insert(voiceUsage).values({memberId:A,date:'2026-11-05',channelId:ENG,minutes:1200});await db.insert(shuin).values(Array.from({length:40},(_,i)=>({giverId:String(870000000000000000n+BigInt(i)),receiverId:A,weight:1,giverRank:'ujiko'})));}

it('本人/サーバーのマイク・スピーカーをすべて除外し、状態不明も非ミュートと断定しない',()=>{
 const clear={mute:false,deaf:false,selfMute:false,serverMute:false,selfDeaf:false,serverDeaf:false};expect(isEvaluationUnmuted(clear)).toBe(true);
 for(const key of Object.keys(clear))expect(isEvaluationUnmuted({...clear,[key]:true})).toBe(false);
 expect(isEvaluationUnmuted({})).toBe(false);expect(isEvaluationUnmuted({deaf:false})).toBe(false);
 expect(isEvaluationUnmuted({mute:null,deaf:null,selfMute:false,serverMute:false,selfDeaf:false,serverDeaf:false})).toBe(true);
});
it('原本の滞在は保持し、参拝者で非ミュートの縁側時間だけを新しい評価へ加算する',async()=>{
 const room={id:ENG,name:'縁側１',categoryId:null,categoryName:null,memberIds:[A,B],sanpaishaMemberIds:[A,B]};
 await recordPresence(db,[{...room,evaluationEligibleMemberIds:[A]}],now);
 await recordPresence(db,[{...room,evaluationEligibleMemberIds:[]}],now);
 await recordPresence(db,[{...room,sanpaishaMemberIds:[],evaluationEligibleMemberIds:[A,B]}],now);
 const rows=await db.select().from(voiceUsage);expect(rows.find(r=>r.memberId===A)).toMatchObject({minutes:3,rankRecordedMinutes:3,sanpaishaMinutes:2,evaluationRecordedMinutes:2,evaluationEligibleMinutes:1});
 const data=await ujikoEvaluation(db,cfg,filter,now);expect(data.rows.find(r=>r.memberId===A)).toMatchObject({minutes:1,confirmedMinutes:1,pastMinutes:0,excludedMinutes:1});expect(data.rows.find(r=>r.memberId===B)).toMatchObject({minutes:0,excludedMinutes:2});
 await recordPresence(db,[{...room,id:OTHER,name:'宿坊',evaluationEligibleMemberIds:[A,B]}],now);expect((await ujikoEvaluation(db,cfg,filter,now)).rows.find(r=>r.memberId===A)?.minutes).toBe(1);
});
it('過去の役職確認済み記録を、ミュート確認済みに書き換えず過去取込として残す',async()=>{
 await db.insert(voiceUsage).values({memberId:A,date:'2026-11-06',channelId:ENG,minutes:1300,rankRecordedMinutes:1200,sanpaishaMinutes:1200});
 const before=await db.select().from(voiceUsage),row=(await ujikoEvaluation(db,cfg,filter,now)).rows.find(r=>r.memberId===A)!;
 expect(row).toMatchObject({minutes:1300,confirmedMinutes:0,pastMinutes:1300,deductedMinutes:0,excludedMinutes:0});expect(await db.select().from(voiceUsage)).toEqual(before);
});
it('根拠付き控除を順位/不足時間/CSVへ反映し、原本と御朱印を変更しない',async()=>{
 await past();const original=await db.select().from(voiceUsage);await saveEvaluationDeduction(db,cfg,deduction(60),ACTOR,now);
 const data=await ujikoEvaluation(db,cfg,filter,now),a=data.rows.find(r=>r.memberId===A)!;expect(a).toMatchObject({minutes:1140,pastMinutes:1140,deductedMinutes:60,remainingMinutes:60,achieved:false,shuinCount:40});
 expect(evaluationCsv(data)).toContain('過去の控除（分）');expect(await db.select().from(voiceUsage)).toEqual(original);expect(await db.select().from(shuin)).toHaveLength(40);
 expect((await evaluationDeductionPage(db,cfg,A,1,now)).rows[0]).toMatchObject({legacy:1200,deducted:60});
 const logs=await db.select().from(auditLogs);expect(logs).toHaveLength(1);expect(logs[0]).toMatchObject({actorId:ACTOR,targetId:A,action:'evaluation.time_deduction',detail:{before:0,after:60}});
});
it('同じ分数を再保存しても二重に引かず、古い画面を拒否し、0分への訂正も監査する',async()=>{
 await past();await saveEvaluationDeduction(db,cfg,deduction(60),ACTOR,now);
 await expect(saveEvaluationDeduction(db,cfg,deduction(60),ACTOR,now)).rejects.toMatchObject({status:409});
 await saveEvaluationDeduction(db,cfg,deduction(60,60),ACTOR,now);expect(await db.select().from(auditLogs)).toHaveLength(1);
 await saveEvaluationDeduction(db,cfg,{...deduction(0,60),reason:'証拠の取り違えを確認したため取消'},ACTOR,now);
 expect((await ujikoEvaluation(db,cfg,filter,now)).rows.find(r=>r.memberId===A)).toMatchObject({minutes:1200,deductedMinutes:0,achieved:true});expect(await db.select().from(auditLogs)).toHaveLength(2);
});
it('過大・負数・少数・未来・不正日付・根拠なし・対象外の控除を拒否する',async()=>{
 await past();for(const change of [{minutes:1201},{minutes:-1},{minutes:1.5},{date:'2026-11-08'},{date:'2026-02-30'},{reason:' '},{channelId:OTHER},{memberId:'bad'}])await expect(saveEvaluationDeduction(db,cfg,{...deduction(1),...change},ACTOR,now)).rejects.toThrow();
 expect(await db.select().from(evaluationTimeDeductions)).toHaveLength(0);expect(await db.select().from(auditLogs)).toHaveLength(0);
});
it('選択を外した部屋の控除を引かず、同名の過去IDをまとめても1回だけ控除する',async()=>{
 await past();const old='960000000000000003';await db.insert(voiceChannels).values({channelId:old,name:'🌸 縁側１'});await db.insert(voiceUsage).values({memberId:A,date:'2026-11-05',channelId:old,minutes:100});
 await saveEvaluationDeduction(db,cfg,{...deduction(20),channelId:old},ACTOR,now);
 expect((await ujikoEvaluation(db,cfg,{...filter,channelIds:[]},now)).rows.find(r=>r.memberId===A)).toMatchObject({minutes:0,deductedMinutes:0});
 expect((await ujikoEvaluation(db,cfg,{...filter,channelIds:[ENG,old,old]},now)).rows.find(r=>r.memberId===A)).toMatchObject({minutes:1280,deductedMinutes:20});
});
it('新しい非ミュート確認済み時間を過去控除に回さず、DBの計測制約も守る',async()=>{
 await db.insert(voiceUsage).values({memberId:A,date:'2026-11-06',channelId:ENG,minutes:1300,rankRecordedMinutes:1300,sanpaishaMinutes:1300,evaluationRecordedMinutes:1200,evaluationEligibleMinutes:1100});
 await expect(saveEvaluationDeduction(db,cfg,{...deduction(101),date:'2026-11-06'},ACTOR,now)).rejects.toThrow();
 await saveEvaluationDeduction(db,cfg,{...deduction(100),date:'2026-11-06'},ACTOR,now);
 expect((await ujikoEvaluation(db,cfg,filter,now)).rows.find(r=>r.memberId===A)).toMatchObject({minutes:1100,confirmedMinutes:1100,pastMinutes:0,excludedMinutes:100,deductedMinutes:100});
 await expect(db.update(voiceUsage).set({evaluationEligibleMinutes:1201}).where(eq(voiceUsage.memberId,A))).rejects.toThrow();
});
it('過去控除で20時間を下回ると、御朱印が多くても両条件達成者より後へ並ぶ',async()=>{
 await past();await db.insert(shuin).values([{giverId:'870000000000000099',receiverId:A,weight:1,giverRank:'ujiko'},...Array.from({length:40},(_,i)=>({giverId:String(880000000000000000n+BigInt(i)),receiverId:B,weight:1,giverRank:'ujiko'}))]);
 await db.insert(voiceUsage).values({memberId:B,date:'2026-11-05',channelId:ENG,minutes:1200});
 expect((await ujikoEvaluation(db,cfg,filter,now)).rows.map(r=>r.memberId)).toEqual([A,B]);
 await saveEvaluationDeduction(db,cfg,deduction(1),ACTOR,now);
 const data=await ujikoEvaluation(db,cfg,filter,now);expect(data.rows.map(r=>[r.memberId,r.rank,r.achieved])).toEqual([[B,1,true],[A,2,false]]);expect(data.rows[1]!.remainingMinutes).toBe(1);
});
it('同じ元記録への同時控除も一方だけ保存し、二重控除しない',async()=>{
 await past();const results=await Promise.allSettled([saveEvaluationDeduction(db,cfg,deduction(60),ACTOR,now),saveEvaluationDeduction(db,cfg,deduction(90),ACTOR,now)]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
 const rows=await db.select().from(evaluationTimeDeductions);expect(rows).toHaveLength(1);expect([60,90]).toContain(rows[0]!.minutes);expect(await db.select().from(auditLogs)).toHaveLength(1);
});
it('控除を0へ戻しても、古い0分の画面から取消済みの控除を復活させない',async()=>{
 await past();await saveEvaluationDeduction(db,cfg,deduction(60),ACTOR,now);await saveEvaluationDeduction(db,cfg,{...deduction(0,60),reason:'根拠が誤っていたので取消'},ACTOR,now);
 await expect(saveEvaluationDeduction(db,cfg,deduction(60),ACTOR,now)).rejects.toMatchObject({status:409});
 const current=(await db.select().from(evaluationTimeDeductions))[0]!;expect(current.updatedAt.getTime()).toBeGreaterThan(now.getTime());
 await saveEvaluationDeduction(db,cfg,{...deduction(30),expectedUpdatedAt:current.updatedAt.toISOString(),reason:'新しい根拠で30分と再確認'},ACTOR,now);
 expect((await ujikoEvaluation(db,cfg,filter,now)).rows.find(r=>r.memberId===A)?.deductedMinutes).toBe(30);
});

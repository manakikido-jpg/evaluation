import {and,desc,eq,inArray,lte,sql} from 'drizzle-orm';
import type {GuildConfig} from '../config.js';
import type {Db} from '../db/client.js';
import {evaluationTimeDeductions,voiceUsage,voiceChannels,members} from '../db/schema.js';
import {ujikoEvaluation,legacyEvaluationMinutesSql} from './ujikoEvaluation.js';
import {jstDate} from './activity.js';
import {audit} from './audit.js';

export class EvaluationDeductionError extends Error {
  constructor(message:string,public status:400|404|409=400){super(message);}
}
export async function evaluationDeductionPage(db:Db,cfg:GuildConfig,memberId:string,page:number,now=new Date()){
  const data=await ujikoEvaluation(db,cfg,{q:memberId,status:'all'},now);
  const member=data.rows.find(r=>r.memberId===memberId);
  if(!member)throw new EvaluationDeductionError('対象の参拝者が見つかりません。',404);
  const ids=data.channels.flatMap(c=>c.ids);
  const all=ids.length?await db.select({date:voiceUsage.date,channelId:voiceUsage.channelId,name:voiceChannels.name,
    legacy:legacyEvaluationMinutesSql.as('legacy'),deducted:sql<number>`coalesce(${evaluationTimeDeductions.minutes},0)`,reason:evaluationTimeDeductions.reason,updatedAt:evaluationTimeDeductions.updatedAt})
    .from(voiceUsage).innerJoin(voiceChannels,eq(voiceChannels.channelId,voiceUsage.channelId))
    .leftJoin(evaluationTimeDeductions,and(eq(evaluationTimeDeductions.memberId,voiceUsage.memberId),eq(evaluationTimeDeductions.date,voiceUsage.date),eq(evaluationTimeDeductions.channelId,voiceUsage.channelId)))
    .where(and(eq(voiceUsage.memberId,memberId),lte(voiceUsage.date,jstDate(now)),sql`${legacyEvaluationMinutesSql}>0`,inArray(voiceUsage.channelId,ids)))
    .orderBy(desc(voiceUsage.date),voiceUsage.channelId):[];
  const pages=Math.max(1,Math.ceil(all.length/20)),current=Math.min(page,pages);
  return {member,rows:all.slice((current-1)*20,current*20),page:current,pages,total:all.length};
}
export type EvaluationDeductionData=Awaited<ReturnType<typeof evaluationDeductionPage>>;
export type DeductionInput={memberId:string;date:string;channelId:string;minutes:number;expectedMinutes:number;expectedUpdatedAt?:string;reason:string};

/** 控除は差分を足すのではなく、その日/部屋の合計を置き換える。原本は更新しない。 */
export async function saveEvaluationDeduction(db:Db,cfg:GuildConfig,input:DeductionInput,actorId:string,now=new Date()){
  const date=new Date(input.date+'T00:00:00Z');
  if(!/^\d{17,20}$/.test(input.memberId)||!/^\d{17,20}$/.test(input.channelId)||!/^\d{4}-\d{2}-\d{2}$/.test(input.date)||
    !Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==input.date||input.date>jstDate(now)||
    ![input.minutes,input.expectedMinutes].every(v=>Number.isSafeInteger(v)&&v>=0&&v<=2147483647)||input.reason.trim().length<2||input.reason.trim().length>300)
    throw new EvaluationDeductionError('対象・日付・分数と、2〜300文字の根拠を確認してください。');
  await db.transaction(async tx=>{
    // メンバー/元記録をロックし、同じ控除の二重更新と同時観測に直列化する。
    const [target]=await tx.select().from(members).where(eq(members.id,input.memberId)).for('update');
    if(!target)throw new EvaluationDeductionError('対象者が見つかりません。',404);
    const data=await ujikoEvaluation(tx,cfg,{q:input.memberId,status:'all'},now);
    if(!data.rows.some(r=>r.memberId===input.memberId)||!data.channels.some(c=>c.ids.includes(input.channelId)))
      throw new EvaluationDeductionError('対象の参拝者・縁側を確認してください。');
    const condition=and(eq(voiceUsage.memberId,input.memberId),eq(voiceUsage.date,input.date),eq(voiceUsage.channelId,input.channelId));
    const [usage]=await tx.select({legacy:legacyEvaluationMinutesSql.as('legacy')}).from(voiceUsage).where(condition).for('update');
    if(!usage||input.minutes>usage.legacy)throw new EvaluationDeductionError('控除は、その日・縁側の過去取込時間以内にしてください。');
    const key=and(eq(evaluationTimeDeductions.memberId,input.memberId),eq(evaluationTimeDeductions.date,input.date),eq(evaluationTimeDeductions.channelId,input.channelId));
    const [old]=await tx.select().from(evaluationTimeDeductions).where(key);
    if((old?.minutes??0)!==input.expectedMinutes||(old?.updatedAt.toISOString()??'')!==(input.expectedUpdatedAt??''))throw new EvaluationDeductionError('別の操作で控除が更新されました。再読み込みして確認してください。',409);
    const reason=input.reason.trim();
    const updatedAt=new Date(Math.max(now.getTime(),(old?.updatedAt.getTime()??-1)+1));
    if(old?.minutes===input.minutes&&old.reason===reason)return;
    await tx.insert(evaluationTimeDeductions).values({memberId:input.memberId,date:input.date,channelId:input.channelId,minutes:input.minutes,reason,updatedBy:actorId,updatedAt})
      .onConflictDoUpdate({target:[evaluationTimeDeductions.memberId,evaluationTimeDeductions.date,evaluationTimeDeductions.channelId],set:{minutes:input.minutes,reason,updatedBy:actorId,updatedAt}});
    await audit(tx,{actorId,targetId:input.memberId,action:'evaluation.time_deduction',via:'web',detail:{date:input.date,channelId:input.channelId,before:old?.minutes??0,after:input.minutes,reason}});
  });
}

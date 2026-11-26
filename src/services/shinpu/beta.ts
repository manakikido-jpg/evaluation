import {eq,sql} from 'drizzle-orm';
import {z} from 'zod';
import type {Db} from '../../db/client.js';
import {settings} from '../../db/schema.js';
import {audit} from '../audit.js';
export const betaUserId=z.string().regex(/^\d{17,20}$/);
const betaSchema=z.object({testers:z.array(z.object({
  userId:betaUserId,addedBy:z.string(),addedAt:z.string().datetime(),
})).max(200)});
const keyOf=(guildId:string)=>`shinpu.beta:${guildId}`;
/** 招待対象だけを既存settingsへ保存する。運営権限や実残高は変更しない。 */
export async function betaTesters(db:Db,guildId:string){
  const [row]=await db.select().from(settings).where(eq(settings.key,keyOf(guildId)));
  return row?betaSchema.parse(row.value).testers:[];
}
export async function isBetaTester(db:Db,guildId:string,userId:string){
  return (await betaTesters(db,guildId)).some(t=>t.userId===userId);
}
export async function changeBetaTester(db:Db,input:{guildId:string;userId:string;actorId:string;add:boolean},now=new Date()){
  const userId=betaUserId.parse(input.userId),key=keyOf(input.guildId);
  return db.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
    const testers=await betaTesters(tx,input.guildId),exists=testers.some(t=>t.userId===userId);
    if(input.add&&exists)return 'already' as const;
    if(!input.add&&!exists)return 'missing' as const;
    if(input.add&&testers.length>=200)return 'full' as const;
    const next=input.add?[...testers,{userId,addedBy:input.actorId,addedAt:now.toISOString()}]:testers.filter(t=>t.userId!==userId);
    await tx.insert(settings).values({key,value:{testers:next},updatedBy:input.actorId,updatedAt:now})
      .onConflictDoUpdate({target:settings.key,set:{value:{testers:next},updatedBy:input.actorId,updatedAt:now}});
    await audit(tx,{actorId:input.actorId,targetId:userId,action:input.add?'shinpu.beta.invite':'shinpu.beta.remove',via:'web',detail:{guildId:input.guildId}});
    return input.add?'added' as const:'removed' as const;
  });
}

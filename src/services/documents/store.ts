import { randomUUID } from 'node:crypto';
import { and,desc,eq,sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { minutesDocuments } from '../../db/schema.js';
import { audit } from '../audit.js';
import { checkedBody,DocumentError,emptyDocument,sourceSchema } from './model.js';
export class DocumentStore {
  constructor(private db:Db,private guild:string,private now:()=>Date=()=>new Date()){}
  list(){return this.db.select({id:minutesDocuments.id,title:minutesDocuments.title,status:minutesDocuments.status,revision:minutesDocuments.revision,updatedAt:minutesDocuments.updatedAt}).from(minutesDocuments).where(eq(minutesDocuments.guildId,this.guild)).orderBy(desc(minutesDocuments.updatedAt)).limit(100);}
  async get(id:string){
    const where=and(eq(minutesDocuments.id,id),eq(minutesDocuments.guildId,this.guild));
    // Webが再起動して処理が失われても、2分後には再試行できる。完了も予約IDで照合する。
    await this.db.update(minutesDocuments).set({status:'failed',generationId:null,revision:sql`${minutesDocuments.revision}+1`,updatedAt:this.now()}).where(and(where,eq(minutesDocuments.status,'generating'),sql`${minutesDocuments.generationStartedAt} < ${new Date(this.now().getTime()-120000)}`));
    const [row]=await this.db.select().from(minutesDocuments).where(where);
    if(!row)throw new DocumentError('資料が見つかりません。',404);return row;
  }
  async create(input:unknown,by:string){
    const got=sourceSchema.safeParse(input);if(!got.success)throw new DocumentError('題名・議事録・文字数を確認してください。議事録は20,000文字までです。');
    return this.db.transaction(async tx=>{
      const [row]=await tx.insert(minutesDocuments).values({id:randomUUID(),guildId:this.guild,...got.data,body:emptyDocument(),createdBy:by,updatedBy:by,createdAt:this.now(),updatedAt:this.now()}).onConflictDoNothing().returning();
      if(row){await audit(tx,{actorId:by,action:'document.create',detail:{id:row.id},via:'web'});return row;}
      const [old]=await tx.select().from(minutesDocuments).where(and(eq(minutesDocuments.guildId,this.guild),eq(minutesDocuments.nonce,got.data.nonce)));return old!;
    });
  }
  async createAudio(input:unknown,by:string){
    const got=sourceSchema.omit({source:true}).safeParse(input);if(!got.success)throw new DocumentError('題名と作成用の番号を確認してください。');
    return this.db.transaction(async tx=>{
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'minutes.audio:'+this.guild}))`);
      const [existing]=await tx.select().from(minutesDocuments).where(and(eq(minutesDocuments.guildId,this.guild),eq(minutesDocuments.nonce,got.data.nonce)));
      if(existing)return {doc:existing,created:false};
      const pending=await tx.select({id:minutesDocuments.id}).from(minutesDocuments).where(and(eq(minutesDocuments.guildId,this.guild),eq(minutesDocuments.status,'generating'),sql`${minutesDocuments.generationStartedAt} > ${new Date(this.now().getTime()-120000)}`));
      if(pending.length)throw new DocumentError('ほかの資料を作成中です。完了してから音声を送ってください。',429);
      const [row]=await tx.insert(minutesDocuments).values({id:randomUUID(),guildId:this.guild,...got.data,source:'',body:emptyDocument(),status:'generating',generationId:randomUUID(),generationStartedAt:this.now(),createdBy:by,updatedBy:by,createdAt:this.now(),updatedAt:this.now()}).returning();
      await audit(tx,{actorId:by,action:'document.audio.start',detail:{id:row!.id},via:'web'});return {doc:row!,created:true};
    });
  }
  async transcript(id:string,generationId:string,source:string,by:string){
    if(!source.trim()||source.length>20000)throw new DocumentError('文字起こしが空か20,000文字を超えています。音声を分けてください。');
    return this.db.transaction(async tx=>{
      const [row]=await tx.update(minutesDocuments).set({source,generationStartedAt:this.now(),updatedAt:this.now(),revision:sql`${minutesDocuments.revision}+1`}).where(and(eq(minutesDocuments.id,id),eq(minutesDocuments.guildId,this.guild),eq(minutesDocuments.generationId,generationId),eq(minutesDocuments.status,'generating'))).returning();
      if(!row)throw new DocumentError('音声処理の有効時間が過ぎました。',409);
      await audit(tx,{actorId:by,action:'document.audio.transcribed',detail:{id},via:'web'});return row;
    });
  }
  async save(id:string,revision:number,title:string,body:unknown,by:string){
    const old=await this.get(id),parsed=checkedBody(body,old.source);
    if(!Number.isSafeInteger(revision)||revision<1||!title.trim()||title.length>120)throw new DocumentError('題名と更新番号を確認してください。');
    return this.db.transaction(async tx=>{
      const [row]=await tx.update(minutesDocuments).set({title:title.trim(),body:parsed,revision:sql`${minutesDocuments.revision}+1`,status:'draft',updatedBy:by,updatedAt:this.now()}).where(and(eq(minutesDocuments.id,id),eq(minutesDocuments.guildId,this.guild),eq(minutesDocuments.revision,revision),sql`${minutesDocuments.status} <> 'generating'`)).returning();
      if(!row)throw new DocumentError('ほかの人が更新したか、作成処理中です。入力を控えてから最新版を開いてください。',409);
      await audit(tx,{actorId:by,action:'document.save',detail:{id,revision:row.revision},via:'web'});return row;
    });
  }
  async reserve(id:string,revision:number,by:string,mode:'headings'|'ai'){
    if(!Number.isSafeInteger(revision)||revision<1)throw new DocumentError('更新番号を確認してください。');
    await this.get(id);const generationId=randomUUID();
    return this.db.transaction(async tx=>{
      const [row]=await tx.update(minutesDocuments).set({status:'generating',generationId,generationStartedAt:this.now(),updatedBy:by,updatedAt:this.now(),revision:sql`${minutesDocuments.revision}+1`}).where(and(eq(minutesDocuments.id,id),eq(minutesDocuments.guildId,this.guild),eq(minutesDocuments.revision,revision),sql`${minutesDocuments.status} <> 'generating'`)).returning();
      if(!row)throw new DocumentError('ほかの人が更新したか、すでに作成中です。最新版を開いてください。',409);
      await audit(tx,{actorId:by,action:'document.generate.start',detail:{id,revision:row.revision,mode},via:'web'});return row;
    });
  }
  async complete(id:string,generationId:string,result:unknown,by:string){
    const old=await this.get(id),body=checkedBody(result,old.source,true);
    return this.db.transaction(async tx=>{
      const [row]=await tx.update(minutesDocuments).set({body,status:'draft',generationId:null,generatedAt:this.now(),updatedAt:this.now(),revision:sql`${minutesDocuments.revision}+1`}).where(and(eq(minutesDocuments.id,id),eq(minutesDocuments.guildId,this.guild),eq(minutesDocuments.generationId,generationId),eq(minutesDocuments.status,'generating'))).returning();
      if(!row)throw new DocumentError('作成の有効時間が過ぎました。最新版を確認してください。',409);
      await audit(tx,{actorId:by,action:'document.generate.complete',detail:{id,revision:row.revision},via:'web'});return row;
    });
  }
  async fail(id:string,generationId:string,by:string){
    await this.db.transaction(async tx=>{
      const [row]=await tx.update(minutesDocuments).set({status:'failed',generationId:null,updatedAt:this.now(),revision:sql`${minutesDocuments.revision}+1`}).where(and(eq(minutesDocuments.id,id),eq(minutesDocuments.guildId,this.guild),eq(minutesDocuments.generationId,generationId))).returning();
      if(row)await audit(tx,{actorId:by,action:'document.generate.failed',detail:{id},via:'web'});
    });
  }
}

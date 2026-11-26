import {and,eq,lte,sql} from 'drizzle-orm';
import type {Db} from '../../db/client.js';
import {shinpuSavedRooms} from '../../db/schema.js';
import {ShinpuRooms,type Move,type Tester} from './rooms.js';
export class ShinpuStorageError extends Error {constructor(){super('対戦の保存・読み込みができません。少し待って再接続してください。');}}
/** DBを正とし、各操作で保存を確定してから公開ビューを返す。Webが複数でも同じ排他を使う。 */
export class SavedShinpuRooms {
  constructor(private db:Db,private guildId:string,private clock:()=>number=Date.now,private rng:()=>number=Math.random){}
  private async transaction<T>(fn:(tx:Db)=>Promise<T>):Promise<T>{
    return this.db.transaction(async tx=>{
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'shinpu.rooms:'+this.guildId}))`);
      await tx.delete(shinpuSavedRooms).where(and(eq(shinpuSavedRooms.guildId,this.guildId),lte(shinpuSavedRooms.expiresAt,new Date(this.clock()))));
      return fn(tx);
    });
  }
  async list(user?:string){
    try{return await this.transaction(async tx=>{
      const rows=await tx.select({id:shinpuSavedRooms.id,seats:shinpuSavedRooms.seats,summary:shinpuSavedRooms.summary}).from(shinpuSavedRooms).where(eq(shinpuSavedRooms.guildId,this.guildId));
      return rows.map(r=>({id:r.id,mine:r.seats.some(p=>p.id===user),...r.summary}));
    });}catch{throw new ShinpuStorageError();}
  }
  private async run<T>(id:string|undefined,user:string,kind:'create'|'join'|'other',op:(rooms:ShinpuRooms)=>T):Promise<T>{
    let ruleError:unknown;
    try{return await this.transaction(async tx=>{
      const engine=new ShinpuRooms(this.clock,this.rng);
      let oldRevision:number|undefined;
      if(id){
        const [row]=await tx.select().from(shinpuSavedRooms).where(and(eq(shinpuSavedRooms.id,id),eq(shinpuSavedRooms.guildId,this.guildId)));
        if(!row){ruleError=Error('部屋がありません。保存期限切れの可能性があります。');throw ruleError;}
        if(row.format!==1||row.snapshot.id!==id||row.snapshot.revision!==row.revision)throw new ShinpuStorageError();
        engine.restore(row.snapshot);oldRevision=row.revision;
      }
      if(kind==='create'||kind==='join'){
        const occupied=await tx.select({id:shinpuSavedRooms.id}).from(shinpuSavedRooms).where(and(eq(shinpuSavedRooms.guildId,this.guildId),sql`${shinpuSavedRooms.seats} @> ${JSON.stringify([{id:user}])}::jsonb`));
        if(occupied.some(r=>r.id!==id)){ruleError=Error('いまの部屋を退出してから参加してください。');throw ruleError;}
        if(kind==='create'){
          const all=await tx.select({id:shinpuSavedRooms.id}).from(shinpuSavedRooms).where(eq(shinpuSavedRooms.guildId,this.guildId));
          if(all.length>=50){ruleError=Error('部屋がいっぱいです。');throw ruleError;}
        }
      }
      let result:T;try{result=op(engine);}catch(e){ruleError=e;throw e;}
      const roomId=id??(result as {roomId:string}).roomId,snapshot=engine.snapshot(roomId);
      if(!snapshot)await tx.delete(shinpuSavedRooms).where(and(eq(shinpuSavedRooms.id,roomId),eq(shinpuSavedRooms.guildId,this.guildId)));
      else if(oldRevision!==snapshot.revision){
        const seats=snapshot.seats.filter((p):p is Tester=>!!p);
        const summary={name:seats.find(p=>p.id===snapshot.owner)?.name??'運営',capacity:snapshot.capacity,players:seats.length,status:snapshot.state?.phase==='over'?'終了':snapshot.state?'対戦中':'参加受付中'};
        const values={id:roomId,guildId:this.guildId,format:1,revision:snapshot.revision,seats,summary,snapshot,expiresAt:new Date(snapshot.expires),updatedAt:new Date(this.clock())};
        await tx.insert(shinpuSavedRooms).values(values).onConflictDoUpdate({target:shinpuSavedRooms.id,set:values});
      }
      return result;
    });}catch(e){if(e===ruleError)throw e;throw new ShinpuStorageError();}
  }
  create(user:Tester,capacity:number){return this.run(undefined,user.id,'create',r=>r.create(user,capacity));}
  join(id:string,user:Tester){return this.run(id,user.id,'join',r=>r.join(id,user));}
  view(id:string,user:string){return this.run(id,user,'other',r=>r.view(id,user));}
  start(id:string,user:string,revision:number){return this.run(id,user,'other',r=>r.start(id,user,revision));}
  move(id:string,user:string,move:Move){return this.run(id,user,'other',r=>r.move(id,user,move));}
  leave(id:string,user:string){return this.run(id,user,'other',r=>r.leave(id,user));}
  preview(id:string,user:string,move:Move){return this.run(id,user,'other',r=>r.preview(id,user,move));}
  rematch(id:string,user:string,revision:number){return this.run(id,user,'other',r=>r.rematch(id,user,revision));}
}

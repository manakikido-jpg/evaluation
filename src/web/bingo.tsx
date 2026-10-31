import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { getCookie, deleteCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { members, type MemberSession } from '../db/schema.js';
import { adminLevelOf, type GuildConfig } from '../config.js';
import type { DiscordApi } from './discordApi.js';
import { findMemberSession, deleteMemberSession } from './memberSessions.js';
import { safeEqual } from './sessions.js';
import { bingoHostRoles, bingoState, createBingo, joinBingo, controlBingo, claimBingo, BingoError } from '../services/bingo.js';
import { BingoPage, BingoGate } from './views/bingo.js';
type Deps={db:Db;api:DiscordApi;cfg:()=>GuildConfig;now:()=>Date};
export function mountBingo(app:Hono<any>,d:Deps){
 const membershipCache=new Map<string,{roles:string[];expires:number}>();
 app.use('/visit/bingo/*',bodyLimit({maxSize:8192,onError:c=>c.json({error:'入力が長すぎます。'},413)}));
 const protect=(handler:(c:Context,s:MemberSession,staff:boolean)=>Promise<Response>|Response)=>async(c:Context)=>{
  c.header('Cache-Control','private, no-store');
  const session=await findMemberSession(d.db,getCookie(c,'sakura_visit')??'',d.now());
  if(!session)return c.req.path==='/visit/bingo'?c.html(<BingoGate/>):c.json({error:'ログインが必要です。Discordの/ビンゴから開き直してください。'},401);
  let roles:string[]|null;
  try{
   const cached=membershipCache.get(session.userId);
   if(c.req.method==='GET'&&cached&&cached.expires>d.now().getTime())roles=cached.roles;
   else{roles=await d.api.memberRoles(d.cfg().guildId,session.userId);if(roles){membershipCache.set(session.userId,{roles,expires:d.now().getTime()+30000});if(membershipCache.size>2000)membershipCache.delete(membershipCache.keys().next().value!);}else membershipCache.delete(session.userId);}
  }catch{membershipCache.delete(session.userId);return c.json({error:'在籍の確認に失敗しました。少し待ってください。'},503);}
  const [member]=await d.db.select().from(members).where(eq(members.id,session.userId));
  if(!roles||!member||member.isBot||member.leftAt){await deleteMemberSession(d.db,session.id);deleteCookie(c,'sakura_visit',{path:'/visit'});return c.json({error:'在籍中のメンバーだけが利用できます。'},403);}
  if(c.req.method==='POST'){const body=await c.req.parseBody({all:true});if(!safeEqual(typeof body._csrf==='string'?body._csrf:'',session.csrfToken))return c.json({error:'画面を開き直して操作してください（CSRF）。'},403);}
  const hosts=await bingoHostRoles(d.db);
  try{return await handler(c,session,!!adminLevelOf(d.cfg(),roles)||roles.some(r=>hosts.includes(r)));}catch(e){if(e instanceof BingoError)return c.json({error:e.message},409);throw e;}
 };
 const state=async(id:string|undefined,s:MemberSession,staff:boolean)=>({...await bingoState(d.db,s.userId,id,d.now()),staff});
 app.get('/visit/bingo',protect((c,s,staff)=>c.html(<BingoPage csrf={s.csrfToken} staff={staff} createId={randomUUID()}/>)));
 app.get('/visit/bingo/state',protect(async(c,s,staff)=>c.json(await state(c.req.query('id'),s,staff))));
 app.post('/visit/bingo/create',protect(async(c,s,staff)=>{if(!staff)return c.json({error:'宮司・神職とビンゴの担当だけが操作できます。'},403);const b=await c.req.parseBody();const event=await createBingo(d.db,{id:typeof b.id==='string'?b.id:'',title:typeof b.title==='string'?b.title:'',actorId:s.userId,staff},d.now());return c.json(await state(event.id,s,staff));}));
 for(const action of ['join','claim','start','draw','close'] as const)app.post('/visit/bingo/'+action,protect(async(c,s,staff)=>{
  const b=await c.req.parseBody();const id=typeof b.id==='string'?b.id:'';if(!/^[0-9a-f-]{36}$/i.test(id))return c.json({error:'イベントを開き直してください。'},400);
  if(action==='join')await joinBingo(d.db,id,s.userId,d.now());
  else if(action==='claim')await claimBingo(d.db,id,s.userId,d.now());
  else{if(!staff)return c.json({error:'宮司・神職とビンゴの担当だけが操作できます。'},403);const version=typeof b.version==='string'?Number(b.version):NaN;if(!Number.isSafeInteger(version)||version<0)return c.json({error:'最新の画面で操作してください。'},400);await controlBingo(d.db,{id,actorId:s.userId,staff,action,version,confirm:b.confirm==='yes'},d.now());}
  return c.json(await state(id,s,staff));
 }));
}

import { createHmac, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';
import { audit } from './audit.js';
import { safeEqual } from '../web/sessions.js';

const KEY='event_stream';
export const EVENT_DURATION_MS=6*60*60*1000;
export type StreamEvent={id:string;title:string;notice:string;version:number;status:'ready'|'live'|'closed';expiresAt:number};
export type StreamConfig={secret:string;mediaUrl:string;apiUrl:string;ingestUrl:string};
export class StreamError extends Error{}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validEventId(id:string){return uuid.test(id);}
function parse(value:unknown):StreamEvent|null{
 if(!value||typeof value!=='object')return null;
 const e=value as StreamEvent;
 return validEventId(e.id)&&typeof e.title==='string'&&typeof e.notice==='string'&&Number.isSafeInteger(e.version)&&e.version>=0&&['ready','live','closed'].includes(e.status)&&Number.isSafeInteger(e.expiresAt)?e:null;
}
export async function streamEvent(db:Db):Promise<StreamEvent|null>{const [row]=await db.select().from(settings).where(eq(settings.key,KEY));return parse(row?.value);}
export function streamOpen(e:StreamEvent|null,now:Date,view=false){return !!e&&e.expiresAt>now.getTime()&&(view?e.status==='live':e.status!=='closed');}
export async function changeStream(db:Db,input:{action:'create'|'start'|'stop';actorId:string;id?:string;version?:number;title?:string;notice?:string;via?:'web'|'system'},now:Date){
 return db.transaction(async tx=>{
  await tx.insert(settings).values({key:KEY,value:{},updatedBy:input.actorId}).onConflictDoNothing();
  const [row]=await tx.select().from(settings).where(eq(settings.key,KEY)).for('update');
  const current=parse(row?.value);let next:StreamEvent;
  if(input.action==='create'){
   if(streamOpen(current,now))throw new StreamError('前のイベントを終了してから準備してください。');
   const title=(input.title??'').trim(),notice=(input.notice??'').trim();
   if(!title||title.length>80||notice.length>300)throw new StreamError('イベント名は80文字、案内は300文字までです。');
   next={id:randomUUID(),title,notice,version:0,status:'ready',expiresAt:now.getTime()+EVENT_DURATION_MS};
  }else{
   if(!current||current.id!==input.id||current.version!==input.version)throw new StreamError('別の操作がありました。最新の画面を開いてください。');
   if(input.action==='start'&&(!streamOpen(current,now)||current.status!=='ready'))throw new StreamError('このイベントは開始できません。新しく準備してください。');
   next={...current,version:current.version+1,status:input.action==='start'?'live':'closed'};
  }
  await tx.update(settings).set({value:next,updatedBy:input.actorId,updatedAt:now}).where(eq(settings.key,KEY));
  await audit(tx,{actorId:input.actorId,action:'event_stream.'+input.action,detail:{id:next.id,version:next.version},via:input.via??'web'});
  return next;
 });
}
/** 配信鍵はDBや監査に保存しない。イベントと期限を署名し、終了後は認証を拒否する。 */
export function publisherToken(e:StreamEvent,secret:string){const value=e.id+'.'+e.expiresAt;return value+'.'+createHmac('sha256',secret).update('event-publish:'+value).digest('base64url');}
export function mediaAllowed(e:StreamEvent|null,config:StreamConfig,input:{action?:string;path?:string;user?:string;password?:string;protocol?:string},now:Date){
 if(input.user==='bridge'&&safeEqual(input.password??'',config.secret))return input.action==='api'||(input.action==='read'&&input.protocol==='hls'&&input.path==='event/'+e?.id&&streamOpen(e,now,true));
 return input.action==='publish'&&input.protocol==='rtmp'&&input.user==='publisher'&&input.path==='event/'+e?.id&&streamOpen(e,now)&&safeEqual(input.password??'',publisherToken(e!,config.secret));
}
export function streamConfig(input:{secret?:string;mediaUrl?:string;apiUrl?:string;ingestUrl?:string}):StreamConfig|undefined{
 if(!input.secret||input.secret.length<43||!input.ingestUrl)return;
 try{
  const ingest=new URL(input.ingestUrl),media=new URL(input.mediaUrl??'http://event-media:8888'),api=new URL(input.apiUrl??'http://event-media:9997');
  if(ingest.protocol!=='rtmps:'||ingest.username||ingest.password||ingest.search||ingest.hash||ingest.pathname!=='/event')return;
  for(const url of [media,api])if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/')return;
  return {secret:input.secret,mediaUrl:media.origin,apiUrl:api.origin,ingestUrl:ingest.href};
 }catch{return;}
}
export function mediaFile(name:string){return /^[A-Za-z0-9_-]{1,160}\.(?:m3u8|mp4|ts)$/.test(name);}
/** 外部URLや別イベントへの参照を認証付き経路へ混ぜない。 */
export function privatePlaylist(text:string,eventId:string){
 if(text.length>262144||!text.startsWith('#EXTM3U'))throw new StreamError('映像の一覧を読み取れません。');
 const rewrite=(value:string)=>{
  if(!mediaFile(value))throw new StreamError('映像の参照先が正しくありません。');
  return '/visit/event/media/'+eventId+'/'+value;
 };
 return text.split('\n').map(line=>line.startsWith('#')?line.replace(/URI="([^"]*)"/g,(_all,value:string)=>'URI="'+rewrite(value)+'"'):line.trim()?rewrite(line.trim()):line).join('\n');
}
export async function publisherReady(config:StreamConfig,eventId:string,fetcher:typeof fetch=fetch){
 const response=await fetcher(config.apiUrl+'/v3/paths/get/event/'+eventId,{headers:{authorization:'Basic '+Buffer.from('bridge:'+config.secret).toString('base64')},redirect:'error',signal:AbortSignal.timeout(4000)});
 if(response.status===404)return false;
 if(!response.ok)throw new StreamError('配信サーバーの状態を確認できません。');
 const value=await response.json() as {ready?:boolean};return value.ready===true;
}
export async function kickPublisher(config:StreamConfig,eventId:string,fetcher:typeof fetch=fetch){
 const auth='Basic '+Buffer.from('bridge:'+config.secret).toString('base64');
 const response=await fetcher(config.apiUrl+'/v3/paths/get/event/'+eventId,{headers:{authorization:auth},redirect:'error',signal:AbortSignal.timeout(4000)});
 if(response.status===404)return;
 if(!response.ok)throw new StreamError('配信元の接続を切れません。OBSから配信を停止してください。');
 const value=await response.json() as {source?:{type?:string;id?:string}};
 if(value.source?.type!=='rtmpConn'||!value.source.id||!validEventId(value.source.id))return;
 const kick=await fetcher(config.apiUrl+'/v3/rtmpconns/kick/'+value.source.id,{method:'POST',headers:{authorization:auth},redirect:'error',signal:AbortSignal.timeout(4000)});
 if(!kick.ok&&kick.status!==404)throw new StreamError('OBSから配信を停止してください。');
}

import {afterEach,beforeEach,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {eq} from 'drizzle-orm';
import {makeDb} from './helpers.js';
import type {Db} from '../src/db/client.js';
import {auditLogs,settings} from '../src/db/schema.js';
import {changeStream,streamEvent,streamOpen,publisherToken,mediaAllowed,streamConfig,privatePlaylist,mediaFile,kickPublisher,EVENT_DURATION_MS} from '../src/services/eventStream.js';
let db:Db,close:()=>Promise<void>;const now=new Date('2026-11-07T00:00:00Z'),secret='test-only-'.repeat(8),config=streamConfig({secret,ingestUrl:'rtmps://stream.test:1936/event'})!;
beforeEach(async()=>{({db,close}=await makeDb());});afterEach(async()=>close());
const create=()=>changeStream(db,{action:'create',actorId:'host',title:'イベント',notice:'案内'},now);
it('同時の準備は一つだけで、状態と監査を同じ取引に保存する',async()=>{
 const result=await Promise.allSettled([create(),create()]);expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);const e=await streamEvent(db);expect(e?.status).toBe('ready');expect((await db.select().from(auditLogs))).toHaveLength(1);expect(e!.expiresAt).toBe(now.getTime()+EVENT_DURATION_MS);
});
it('古い画面と二重開始を拒否し、終了したイベントを再開しない',async()=>{
 const e=await create();const live=await changeStream(db,{action:'start',actorId:'host',id:e.id,version:0},now);expect(live.status).toBe('live');await expect(changeStream(db,{action:'stop',actorId:'host',id:e.id,version:0},now)).rejects.toThrow('最新');await changeStream(db,{action:'stop',actorId:'host',id:e.id,version:1},now);await expect(changeStream(db,{action:'start',actorId:'host',id:e.id,version:2},now)).rejects.toThrow('開始できません');const next=await create();expect(next.id).not.toBe(e.id);
});
it('配信鍵はイベント/期限/秘密に結び付き、終了・期限後・別イベントでは使えない',async()=>{
 const e=await create(),token=publisherToken(e,secret),req={action:'publish',protocol:'rtmp',path:'event/'+e.id,user:'publisher',password:token};expect(mediaAllowed(e,config,req,now)).toBe(true);expect(mediaAllowed(e,config,{...req,path:'event/'+randomUUID()},now)).toBe(false);expect(mediaAllowed(e,{...config,secret:secret+'x'},req,now)).toBe(false);expect(mediaAllowed(e,config,{...req,password:token+'x'},now)).toBe(false);expect(mediaAllowed(e,config,req,new Date(e.expiresAt))).toBe(false);expect(mediaAllowed({...e,status:'closed'},config,req,now)).toBe(false);expect(streamOpen(e,new Date(e.expiresAt))).toBe(false);
 expect(JSON.stringify(await db.select().from(settings))).not.toContain(token);expect(JSON.stringify(await db.select().from(auditLogs))).not.toContain(token);
});
it('公開readは拒否し、内部の資格情報もliveのHLSとAPIだけに限定する',async()=>{
 const e=await create(),base={user:'bridge',password:secret,path:'event/'+e.id,protocol:'hls',action:'read'};expect(mediaAllowed(e,config,base,now)).toBe(false);expect(mediaAllowed({...e,status:'live'},config,base,now)).toBe(true);for(const changes of [{user:'any'},{password:''},{protocol:'rtsp'},{path:'other'},{action:'playback'}])expect(mediaAllowed({...e,status:'live'},config,{...base,...changes},now)).toBe(false);expect(mediaAllowed(e,config,{user:'bridge',password:secret,action:'api'},now)).toBe(true);
});
it('配信先はRTMPSに限定し、内部URLの認証/クエリー/パスを拒否する',()=>{
 expect(config.mediaUrl).toBe('http://event-media:8888');expect(streamConfig({secret,ingestUrl:'rtmp://stream.test/event'})).toBeUndefined();expect(streamConfig({secret:'short',ingestUrl:'rtmps://stream.test/event'})).toBeUndefined();for(const mediaUrl of ['file:///etc/passwd','http://user:pass@host/','http://host/?token=x','http://host/another'])expect(streamConfig({secret,ingestUrl:'rtmps://stream.test/event',mediaUrl})).toBeUndefined();
});
it('プレイリストの全参照を同じ認証経路に直し、外部/相対移動/任意ファイルを拒否する',()=>{
 const id=randomUUID();const value=privatePlaylist('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-PART:DURATION=0.5,URI="part0.mp4"\nstream.m3u8\nsegment0.mp4\n',id);expect(value.match(new RegExp('/visit/event/media/'+id+'/','g'))).toHaveLength(4);
 for(const value of ['https://other.test/a.mp4','../init.mp4','/event/another/a.mp4','init.mp4?secret=x','x.key'])expect(()=>privatePlaylist('#EXTM3U\n'+value,id)).toThrow();expect(mediaFile('%2e%2e.mp4')).toBe(false);
});
it('停止はそのイベントのRTMP接続だけを切り、APIの失敗や別のsourceを扱う',async()=>{
 const id=randomUUID(),conn=randomUUID(),calls:string[]=[];await kickPublisher(config,id,async(url,opts)=>{calls.push(String(url));expect(opts?.headers).toHaveProperty('authorization');return calls.length===1?Response.json({source:{type:'rtmpConn',id:conn}}):new Response(null,{status:200});});expect(calls).toEqual([config.apiUrl+'/v3/paths/get/event/'+id,config.apiUrl+'/v3/rtmpconns/kick/'+conn]);await expect(kickPublisher(config,id,async()=>new Response(null,{status:503}))).rejects.toThrow();await expect(kickPublisher(config,id,async()=>new Response(null,{status:404}))).resolves.toBeUndefined();
});

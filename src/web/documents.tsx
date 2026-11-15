import { checkAudio,type DocumentTranscriber } from '../services/documents/audio.js';
import { logger } from '../lib/logger.js';
import { Hono } from 'hono';
import type { SessionView } from './views/layout.js';
import type { Db } from '../db/client.js';
import { getMeeting } from '../services/meetings.js';
import { DocumentStore } from '../services/documents/store.js';
import { DOCUMENT_ROOT as ROOT,DocumentError } from '../services/documents/model.js';
import { organizeHeadings,type DocumentAI } from '../services/documents/generate.js';
import { documentHtml,documentWord,shareMarkdown,DOCUMENT_CSP } from '../services/documents/export.js';
import { DocumentEditPage,DocumentNewPage,DocumentsPage } from './views/documents.js';
type Env={Variables:{session:SessionView}};
export function mountDocuments(app:Hono<Env>,db:Db,guild:()=>string,now:()=>Date,ai?:DocumentAI,audio?:DocumentTranscriber){
 const routes=new Hono<Env>();
 routes.onError((e,c)=>e instanceof DocumentError?c.json({error:e.message},e.status):c.json({error:'資料の読み込み・保存ができませんでした。入力を控え、少し待って試してください。'},503));
 const store=()=>new DocumentStore(db,guild(),now);
 const idOf=(s:string|undefined)=>{if(!/^[a-f0-9-]{36}$/.test(s??''))throw new DocumentError('資料が見つかりません。',404);return s!;};
 routes.use(ROOT+'*',async(c,next)=>{c.header('Cache-Control','private, no-store');try{await next();}catch(e){if(e instanceof DocumentError)return c.json({error:e.message},e.status);return c.json({error:'資料の読み込み・保存ができませんでした。入力を控え、少し待って試してください。'},503);}});
 routes.get(ROOT,async c=>c.html(<DocumentsPage session={c.get('session')} rows={await store().list()}/>));
 routes.get(ROOT+'/new',async c=>{
   const session=c.get('session');if(session.level!=='guji'&&session.writePages!=null&&!session.writePages.includes('minutes'))throw new DocumentError('議事録の操作権限が必要です。',403);
   let title='',source='';const meetingId=c.req.query('meeting');
   if(meetingId){if(!/^[1-9]\d*$/.test(meetingId))throw new DocumentError('議事録を確認してください。');const found=await getMeeting(db,Number(meetingId));if(!found)throw new DocumentError('議事録が見つかりません。',404);title=found.meeting.title;source=`議題\n${found.meeting.agenda}\n\n話したこと\n${found.meeting.notes}\n\n決定事項\n${found.meeting.decisions}\n\n次の作業\n${found.todos.map(x=>`${x.doneAt?'済：':''}${x.body}${x.assigneeId?`（担当ID：${x.assigneeId}）`:''}${x.due?`（期限：${x.due}）`:''}`).join('\n')}`;}
   const copy=c.req.query('copy');if(copy){const doc=await store().get(idOf(copy));title=doc.title;source=doc.source;}
   return c.html(<DocumentNewPage session={c.get('session')} title={title} source={source} audioReady={!!ai&&!!audio} audioModel={audio?.model}/>);
 });
 routes.post(ROOT+'/audio',async c=>{
   if(!audio||!ai)throw new DocumentError('音声とAIの連携が未設定です。運営で設定してから利用してください。');
   const b=await c.req.parseBody();if(b.consent!=='yes')throw new DocumentError('音声と文字起こしをAIへ送信することを確認してください。');checkAudio(b.audio);
   const s=store(),by=c.get('session').userId,{doc,created}=await s.createAudio({title:b.title,nonce:b.nonce},by);
   if(created){
     const file=b.audio;
     // 画面を先に返す。音声はこの処理の間だけ保持し、DB/ファイルへは保存しない。
     void (async()=>{try{const text=await audio.transcribe(file);const row=await s.transcript(doc.id,doc.generationId!,text,by);const body=await ai.generate(row.title,text);await s.complete(doc.id,doc.generationId!,body,by);}catch{await s.fail(doc.id,doc.generationId!,by);}})().catch(()=>logger.warn({documentId:doc.id},'document audio job did not complete'));
   }
   return c.redirect(ROOT+'/'+doc.id,303);
 });
 routes.post(ROOT,async c=>{const b=await c.req.parseBody();const doc=await store().create({title:b.title,source:b.source,nonce:b.nonce},c.get('session').userId);return c.redirect(ROOT+'/'+doc.id,303);});
 routes.get(ROOT+'/:id',async c=>c.html(<DocumentEditPage session={c.get('session')} doc={await store().get(idOf(c.req.param('id')))} aiModel={ai?.model}/>));
 routes.get(ROOT+'/:id/data',async c=>c.json(await store().get(idOf(c.req.param('id')))));
 routes.post(ROOT+'/:id/save',async c=>{const b=await c.req.parseBody();let body;try{body=JSON.parse(String(b.body));}catch{throw new DocumentError('資料の内容を確認してください。');}return c.json(await store().save(idOf(c.req.param('id')),Number(b.revision),String(b.title??''),body,c.get('session').userId));});
 routes.post(ROOT+'/:id/generate',async c=>{
   const b=await c.req.parseBody(),mode=b.mode;if(mode!=='headings'&&mode!=='ai')throw new DocumentError('整理方法を選んでください。');
   if(mode==='ai'&&(!ai||b.consent!=='yes'))throw new DocumentError(ai?'AIへの送信内容を確認してください。':'AI連携は未設定です。見出しから整理を選べます。',400);
   const by=c.get('session').userId,s=store();if(!(await s.get(idOf(c.req.param('id')))).source)throw new DocumentError('文字起こしがありません。音声を選び直して作成してください。');const row=await s.reserve(idOf(c.req.param('id')),Number(b.revision),by,mode);
   try{const body=mode==='ai'?await ai!.generate(row.title,row.source):organizeHeadings(row.source);return c.json(await s.complete(row.id,row.generationId!,body,by));}
   catch(e){await s.fail(row.id,row.generationId!,by);if(e instanceof DocumentError)throw e;throw new DocumentError('下書きを作れませんでした。以前の本文は残しています。',503);}
 });
 for(const format of ['html','md','docx','print'] as const){
   routes.get(ROOT+'/:id/'+(format==='print'?'print':'export.'+format),async c=>{
     const doc=await store().get(idOf(c.req.param('id'))),filename='minutes-document-'+doc.id;
     if(format!=='print')c.header('Content-Disposition',`attachment; filename="${filename}.${format}"`);
     if(format==='md')return c.body(shareMarkdown(doc.title,doc.body),200,{'Content-Type':'text/markdown; charset=utf-8'});
     if(format==='docx')return c.body(new Uint8Array(documentWord(doc.title,doc.body,now())),200,{'Content-Type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
     // 単体の共有資料。スクリプトや外部通信は使わず、資料の装飾だけを許可する。
     c.header('Content-Security-Policy',DOCUMENT_CSP);
     return c.html(documentHtml(doc.title,doc.body));
   });
 }
 app.route('/',routes);
}

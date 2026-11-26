import type { Context, Hono } from 'hono';
import type { Child } from 'hono/jsx';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { and, asc, desc, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { adminLevelOf, type GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { supportTickets, ticketOperations, ticketEvents, ticketAttachments } from '../db/schema.js';
import { TICKET_POLICY_LABELS, TICKET_STATE_LABELS, ticketPolicySchema, effectiveTicketPolicy, type TicketPolicy } from '../domain/ticketPolicy.js';
import * as ops from '../services/ticketOperations.js';
import { loadTicketConfig, saveTicketConfig, ticketTypeOf, openTicket } from '../services/supportTickets.js';
import { readTicketFile, uploadTicketFile, retryTicketFile } from '../services/ticketFiles.js';
import { audit } from '../services/audit.js';
import { randomToken, safeEqual, findSession, deleteSession } from './sessions.js';
import { createMemberSession, findMemberSession, deleteMemberSession, MEMBER_SESSION_DAYS } from './memberSessions.js';
import { peekLoginLink, useLoginLink } from '../services/casino/loginLinks.js';
import type { DiscordApi } from './discordApi.js';
const COOKIE='sakura_support', STATE='sakura_support_state';

function Shell(p:{title:string;children:Child;csrf?:string;admin?:boolean}){return <html lang="ja"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>{p.title}｜咲楽ノ宮</title><link rel="stylesheet" href="/static/ticket-operations.css"/></head><body><header><div class="stack"><strong>⛩ 咲楽ノ宮 チケット</strong><a href="/support">対応中</a><a href="/support?history=1">完了履歴</a>{p.admin&&<a href="/support/settings">運用設定</a>}</div></header><main><h1>{p.title}</h1>{p.children}</main></body></html>;}
function Csrf(p:{value:string}){return <input type="hidden" name="_csrf" value={p.value}/>;}
type Deps={db:Db;api:DiscordApi;cfg:()=>GuildConfig;baseUrl:string;secure:boolean;now:()=>Date;fileRoot?:string};
export function mountTicketOperations(app:Hono<any>,d:Deps){
 const {db,api}=d,redirectUri=`${d.baseUrl}/casino/auth/callback`;
 const cookie={httpOnly:true,secure:d.secure,sameSite:'Lax' as const,path:'/support',maxAge:MEMBER_SESSION_DAYS*86400};
 const authPage=(error?:string,link?:{name:string;action:string})=><Shell title="チケットにログイン"><div class="card">{error&&<p role="alert">{error}</p>}<p>サーバーのメンバーなら、階級やカジノの利用資格に関係なく自分のチケットを確認できます。</p>{link?<form method="post" action={link.action}><p>{link.name} さんとして入ります。</p><button>チケットを開く</button></form>:<a href="/support/auth">Discordでログイン</a>}</div></Shell>;
 app.get('/support/auth',c=>{const state=randomToken();setCookie(c,STATE,state,{...cookie,path:'/casino/auth',maxAge:600});return c.redirect(api.authorizeUrl(state,redirectUri));});
 // 既存の登録済みOAuthコールバックを共有し、他機能の認証とはstateを分ける。
 app.get('/casino/auth/callback',async(c,next)=>{
  const state=getCookie(c,STATE);if(!state||!safeEqual(state,c.req.query('state')??''))return next();deleteCookie(c,STATE,{path:'/casino/auth'});
  try{const code=c.req.query('code');if(!code)throw new Error('missing code');const user=await api.me(await api.exchangeCode(code,redirectUri));if(!await api.memberRoles(d.cfg().guildId,user.id))return c.html(authPage('在籍を確認できません。'),403);setCookie(c,COOKIE,await createMemberSession(db,user,d.now()),cookie);return c.redirect('/support',303);}catch{return c.html(authPage('Discord認証を確認できません。時間をおいてお試しください。'),503);}
 });
 app.get('/support/link/:token',async c=>{c.header('Cache-Control','private, no-store');const u=await peekLoginLink(db,c.req.param('token'),d.now());return c.html(authPage(u?undefined:'リンクは使用済みか期限切れです。Discordの「管理・履歴」から開き直してください。',u?{name:u.displayName,action:`/support/link/${c.req.param('token')}`}:undefined));});
 app.post('/support/link/:token',async c=>{
  const origin=c.req.header('origin');if(origin&&origin!==new URL(d.baseUrl).origin)return c.text('不正なリクエストです。',403);
  const candidate=await peekLoginLink(db,c.req.param('token'),d.now());if(!candidate)return c.html(authPage('リンクが期限切れか使用済みです。'),400);
  try{if(!await api.memberRoles(d.cfg().guildId,candidate.id))return c.text('在籍を確認できません。',403);}catch{return c.text('Discordに接続できません。再度お試しください。',503);}
  const user=await useLoginLink(db,c.req.param('token'),d.now());if(!user)return c.text('リンクは使用済みです。',409);
  setCookie(c,COOKIE,await createMemberSession(db,{...user,username:user.displayName},d.now()),cookie);return c.redirect('/support',303);
 });
 const secure=(handler:(c:Context,a:ops.TicketActor,csrf:string)=>Promise<Response>)=>async(c:Context)=>{
  c.header('Cache-Control','private, no-store');c.header('X-Content-Type-Options','nosniff');
  const member=await findMemberSession(db,getCookie(c,COOKIE)??'',d.now()),adminSession=member?undefined:await findSession(db,getCookie(c,'shamusho_session')??'',d.now());
  const session=member??adminSession;if(!session)return c.html(authPage(),401);
  let roles:string[]|null;try{roles=await api.memberRoles(d.cfg().guildId,session.userId);}catch{return c.text('Discordの在籍・権限を確認できません。少し待ってから開き直してください。',503);}
  if(!roles)return c.text('このサーバーのメンバーだけが利用できます。',403);
  if(c.req.method==='POST'){const b=await c.req.parseBody();if(!safeEqual(typeof b._csrf==='string'?b._csrf:'',session.csrfToken))return c.text('不正なリクエストです（CSRF）。',403);}
  const resource=c.req.param('id'),fileId=c.req.param('fileId');
  if([resource,fileId].some(v=>v!==undefined&&(!/^\d+$/.test(v)||!Number.isSafeInteger(Number(v))||Number(v)<1)))return c.notFound();
  try{return await handler(c,{id:session.userId,roles,admin:!!adminLevelOf(d.cfg(),roles)},session.csrfToken);}
  catch(e){if(e instanceof ops.TicketOperationError)return c.html(<Shell title="操作をご確認ください"><div class="card"><p role="alert">{e.message}</p><a href="/support">チケット一覧へ</a></div></Shell>,e.status);throw e;}
 };
 app.post('/support/logout',secure(async(c,_a)=>{const session=await findMemberSession(db,getCookie(c,COOKIE)??'',d.now());if(session)await deleteMemberSession(db,session.id);const adminSession=await findSession(db,getCookie(c,'shamusho_session')??'',d.now());if(adminSession)await deleteSession(db,adminSession.id);deleteCookie(c,'shamusho_session',{path:'/'});deleteCookie(c,COOKIE,{path:'/support'});return c.redirect('/support',303);}));
 app.get('/support',secure(async(c,a,csrf)=>{
  const conf=await loadTicketConfig(db),history=c.req.query('history')==='1';
  const allTypes=conf.types.map(t=>t.key),allowed=conf.types.filter(t=>t.roleIds.some(r=>a.roles.includes(r))).map(t=>t.key);
  const fallback=a.roles.length?sql`${ticketOperations.roleIds} && ARRAY[${sql.join(a.roles.map(r=>sql`${r}`),sql`, `)}]::text[]`:sql`false`;
  const permission=or(eq(supportTickets.openerId,a.id),and(sql`not (${a.id} = any(${ticketOperations.subjectIds}))`,a.admin?sql`true`:or(allowed.length?inArray(supportTickets.typeKey,allowed):sql`false`,and(allTypes.length?notInArray(supportTickets.typeKey,allTypes):sql`true`,fallback))));
  const page=Math.max(0,Math.min(1000,Math.floor(Number(c.req.query('page'))||0)));
  const rows=await db.select().from(ticketOperations).innerJoin(supportTickets,eq(ticketOperations.ticketId,supportTickets.id)).where(and(isNull(ticketOperations.expiredAt),eq(supportTickets.status,history?'closed':'open'),permission)).orderBy(desc(ticketOperations.urgent),sql`(${ticketOperations.firstReplyAt} is null and ${ticketOperations.openedAt} + (${ticketOperations.policy}->>'firstReminderHours')::int * interval '1 hour' <= ${d.now().toISOString()}::timestamptz) desc`,history?desc(supportTickets.closedAt):asc(ticketOperations.openedAt)).limit(51).offset(page*50);
  return c.html(<Shell title={history?'完了履歴':'チケット対応'} admin={a.admin}><div class="stack"><p class="muted">閲覧権限のある案件だけを表示します。</p><form method="post" action="/support/logout"><Csrf value={csrf}/><button class="secondary">ログアウト</button></form></div><div class="card table"><table><thead><tr><th>受付</th><th>種類</th><th>状態</th><th>主担当</th><th>期限・目安</th></tr></thead><tbody>{rows.slice(0,50).map(({support_tickets:t,ticket_operations:o})=><tr><td><a href={`/support/${t.id}`}>#{t.id}</a>{o.urgent&&<span class="badge urgent">緊急</span>}</td><td>{o.typeLabel}</td><td>{TICKET_STATE_LABELS[o.state]}</td><td>{t.assigneeId??'未担当'}</td><td>{o.state==='closed'?o.retainUntil?.toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}):(!o.firstReplyAt?new Date(+o.openedAt+o.policy.firstReplyHours*3600000):o.state==='user_wait'?new Date(+o.stateAt+o.policy.userCloseHours*3600000):new Date(+o.progressAt+(o.state==='internal_wait'?o.policy.internalReminderHours:o.policy.activeReminderHours)*3600000)).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}</td></tr>)}</tbody></table>{!rows.length&&<p>該当するチケットはありません。</p>}{page>0&&<a href={`/support?history=${history?1:0}&page=${page-1}`}>前のページ</a>} {rows.length>50&&<a href={`/support?history=${history?1:0}&page=${page+1}`}>次のページ</a>}</div><details class="card"><summary>新しいお問い合わせ・相談・通報</summary><form method="post" action="/support/new"><Csrf value={csrf}/><input type="hidden" name="requestId" value={randomUUID()}/><label>種類<select name="typeKey">{conf.types.filter(t=>t.enabled&&t.kind==='normal').map(t=><option value={t.key}>{t.label}</option>)}</select></label><label>内容<textarea name="body" required maxlength={4000}/></label><label>希望する対応・日時・場所・相手など（任意）<textarea name="details" maxlength={4000}/></label><label><input type="checkbox" name="urgent" value="1"/> 緊急の安全問題（荒らし・脅迫・個人情報の流出など）</label><p class="muted">証拠の画像・ファイルは受付後に追加できます。</p><button>受け付ける</button></form></details></Shell>);
 }));
 app.post('/support/new',secure(async(c,a)=>{
  const b=await c.req.parseBody(),conf=await loadTicketConfig(db),type=ticketTypeOf(conf,String(b.typeKey??''));if(!type||type.kind!=='normal')throw new ops.TicketOperationError('種類を確認してください。');
  const answers=[{q:'相談・通報の内容',a:String(b.body??'')},{q:'追加情報',a:String(b.details??'')}];
  if(!answers[0]!.a.trim())throw new ops.TicketOperationError('内容を入力してください。');
  const r=await openTicket(db,conf,{typeKey:type.key,openerId:a.id,answers,managed:true,requestId:String(b.requestId??randomUUID()),urgent:b.urgent==='1'},d.now());if(r.status!=='ok'&&r.status!=='already')throw new ops.TicketOperationError('受付できませんでした。');
  if(r.status==='ok')await audit(db,{actorId:a.id,action:'ticket.open',detail:{ticketId:r.ticket.id,type:type.key,workflow:true},via:'web'});
  if(r.status==='ok')await ops.recordTicketEvent(db,r.ticket.id,a.id,'receipt',answers.map(x=>`【${x.q}】${x.a}`).join('\n'),false,'receipt:0',d.now());
  return c.redirect(`/support/${r.ticket.id}`,303);
 }));
 app.get('/support/settings',secure(async(c,a,csrf)=>{
  if(!a.admin)throw new ops.TicketOperationError('宮司・神職だけが変更できます。',403);
  const conf=await loadTicketConfig(db),defaults=effectiveTicketPolicy(conf.workflow);
  return c.html(<Shell title="チケット運用設定" admin><p>変更は新規受付から適用します。対応中は受付時の設定を維持します。</p>{[{key:'',label:'共通設定',values:defaults},...conf.types.filter(t=>t.kind==='normal').map(t=>({key:t.key,label:t.label,values:t.workflow??{}}))].map(group=><details class="card" open={!group.key}><summary>{group.label}</summary><form method="post" action="/support/settings"><Csrf value={csrf}/><input type="hidden" name="typeKey" value={group.key}/><div class="grid">{(Object.keys(TICKET_POLICY_LABELS) as (keyof TicketPolicy)[]).map(key=><label>{TICKET_POLICY_LABELS[key]}<input type="number" name={key} min="1" value={group.values[key]??''} placeholder={group.key?'共通設定を使う':undefined} required={!group.key}/></label>)}</div><button>保存する</button></form></details>)}</Shell>);
 }));
 app.post('/support/settings',secure(async(c,a)=>{
  if(!a.admin)throw new ops.TicketOperationError('宮司・神職だけが変更できます。',403);
  const b=await c.req.parseBody(),typeKey=String(b.typeKey??''),conf=await loadTicketConfig(db);const values:Partial<TicketPolicy>={};
  for(const key of Object.keys(TICKET_POLICY_LABELS) as (keyof TicketPolicy)[]){const raw=b[key];if(typeof raw==='string'&&raw.trim())values[key]=Number(raw);}
  try{if(typeKey){const t=ticketTypeOf(conf,typeKey);if(!t||t.kind!=='normal')throw new Error();effectiveTicketPolicy(conf.workflow,values);conf.types=conf.types.map(t=>t.key===typeKey?{...t,workflow:values}:t);}else{const checked=ticketPolicySchema.parse(values);for(const t of conf.types)effectiveTicketPolicy(checked,t.workflow);conf.workflow=checked;}}catch{throw new ops.TicketOperationError('日数・容量と、通知から終了までの順序を確認してください。');}
  await saveTicketConfig(db,conf,a.id);await audit(db,{actorId:a.id,action:'ticket.workflow_settings',detail:{typeKey,values},via:'web'});return c.redirect('/support/settings',303);
 }));
 app.get('/support/:id',secure(async(c,a,csrf)=>{
  const id=Number(c.req.param('id')),ctx=await ops.ticketContext(db,id,a),{ticket:t,op:o}=ctx;
  const [events,files]=await Promise.all([db.select().from(ticketEvents).where(and(eq(ticketEvents.ticketId,id),ctx.staff?undefined:eq(ticketEvents.internal,false))).orderBy(asc(ticketEvents.createdAt),asc(ticketEvents.id)),db.select().from(ticketAttachments).where(eq(ticketAttachments.ticketId,id))]);
  const form=(action:string,children:Child)=><form method="post" action={`/support/${id}/action`}><Csrf value={csrf}/><input type="hidden" name="action" value={action}/>{children}</form>;
  return c.html(<Shell title={`#${id} ${o.typeLabel}`} admin={a.admin}><div class="card"><div class="stack"><span class="badge">{TICKET_STATE_LABELS[o.state]}</span>{o.urgent&&<span class="badge urgent">緊急</span>}<span>主担当: {t.assigneeId??'未担当'}</span></div>{t.channelId&&t.status==='open'&&<p><a href={`https://discord.com/channels/${d.cfg().guildId}/${t.channelId}`}>Discordのチケットを開く</a></p>}<p class="small muted">初回返信目安 {o.policy.firstReplyHours}時間／返信待ち確認 {o.policy.userReminderHours/24}日／返信なし終了 {o.policy.userCloseHours/24}日。自動受付は運営の初回返信に数えません。</p>{o.retainUntil&&<p>保存期限: {o.retainUntil.toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}</p>}</div>
   {t.status==='open'?<>
    {ctx.staff&&!t.assigneeId&&form('claim',<button>担当する</button>)}
    {o.handoffTo===a.id&&ctx.staff&&form('accept',<button>引き継ぎを承諾する</button>)}
    <section class="card"><h2>返信する</h2>{form('reply',<><input type="hidden" name="requestId" value={randomUUID()}/><label>チケットに公開する返信<textarea required name="body" maxlength={8000}/></label><button>返信を送る</button></>)}</section>
    <section class="card"><h2>画像・ファイル</h2><form method="post" enctype="multipart/form-data" action={`/support/${id}/upload`}><Csrf value={csrf}/><label>添付資料（1つ{ o.policy.fileMaxMB }MB、合計{ o.policy.ticketMaxMB }MBまで）<input type="file" name="file" required/></label><button>保存する</button></form></section>
    {ctx.staff&&<section class="card note"><h2>運営専用の内部メモ</h2><p>相談者には表示されません。通常の返信と取り違えないでください。</p>{form('note',<><input type="hidden" name="requestId" value={randomUUID()}/><label>内部メモ<textarea required name="body" maxlength={8000}/></label><button class="secondary">内部メモを保存</button></>)}</section>}
    {ctx.manager&&<section class="card"><h2>対応の管理</h2>{form('state',<div class="stack"><select name="state">{(['active','user_wait','internal_wait'] as const).map(s=><option value={s} selected={o.state===s}>{TICKET_STATE_LABELS[s]}</option>)}</select><button>状態を変更</button></div>)}{form('resolution',<><label>対応内容・結果<textarea name="summary" required maxlength={8000}/></label><button>相談者に解決確認を依頼</button></>)}{o.resolutionConfirmedAt&&form('close',<><p>相談者が解決を確認しました。</p><button>解決して完了</button></>)}<details><summary>主担当を引き継ぐ</summary>{form('handoff',<><label>次の担当者のDiscord ID<input name="to" pattern="[0-9]{17,20}" required/></label><label>理由<textarea name="reason" required/></label><button>引き継ぎを依頼</button>{ctx.admin&&<button name="force" value="1" class="secondary">宮司・神職として担当を変更</button>}</>)}</details></section>}
    {ctx.owner&&o.closeSummary&&o.state==='user_wait'&&<section class="card"><h2>解決の確認</h2><div class="message">{o.closeSummary}</div>{form('confirm',<button>この内容で解決しました</button>)}</section>}
    <details class="card"><summary>緊急度の変更</summary>{form('urgency',<><input type="hidden" name="urgent" value={o.urgent?'0':'1'}/><button>{o.urgent?'通常に変更':'緊急の安全問題として知らせる'}</button></>)}</details>
   </>:<section class="card"><p>{t.closeReason==='no_reply'?'返信がなく終了しました。':'解決して完了しました。'}</p>{(ctx.owner||ctx.manager)&&form('reopen',<button>同じ案件を再開する</button>)}{ctx.admin&&form('extend',<><label>保存を延長する日数<input type="number" name="days" min="1" max="3650" value="180" required/></label><button>保存を延長</button></>)}</section>}
   {ctx.admin&&<details class="card"><summary>当事者を担当・判断から除外する</summary>{form('subjects',<><label>当事者のDiscord ID（空白または改行区切り）<textarea name="ids">{o.subjectIds.join('\n')}</textarea></label><label>理由<textarea name="reason" required/></label><button>当事者の設定を保存</button></>)}</details>}
   <section class="card"><h2>保存した添付</h2>{files.map(f=><div class="card">{f.status==='ready'?<a href={`/support/${id}/files/${f.id}`}>{f.name}</a>:<span>{f.name}：{f.status==='pending'?'保存待ち':'保存に失敗・再試行待ち'}</span>}（{f.size.toLocaleString()}バイト）{f.status!=='ready'&&(ctx.owner||ctx.manager)&&form('file_retry',<><input type="hidden" name="fileId" value={f.id}/><button class="secondary">保存を再試行</button></>)}</div>)}</section>
   <section class="card"><h2>対応履歴</h2>{events.map(e=><article class={e.internal?'card note':'card'}><div class="small muted">{e.internal?'運営専用 · ':''}{e.createdAt.toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})} · {e.actorId==='system'?'システム':e.actorId}</div><div class="message">{e.body}</div></article>)}</section>
  </Shell>);
 }));
 app.post('/support/:id/action',secure(async(c,a)=>{
  const id=Number(c.req.param('id')),b=await c.req.parseBody(),action=String(b.action??'');const context=await ops.ticketContext(db,id,a);const now=d.now();
  if(action==='claim')await ops.claimOperation(db,id,a,now);
  else if(action==='state')await ops.setOperationState(db,id,a,String(b.state) as keyof typeof TICKET_STATE_LABELS,now);
  else if(action==='reply'||action==='note'){if(!/^[a-f0-9-]{36}$/.test(String(b.requestId??'')))throw new ops.TicketOperationError('ページを開き直してください。');await ops.addOperationMessage(db,id,a,String(b.body??''),action==='note',now,`web:${b.requestId}`);}
  else if(action==='handoff'){
   if(!context.manager)throw new ops.TicketOperationError('主担当・宮司・神職の操作です。',403);
   const to=String(b.to??''),roles=await api.memberRoles(d.cfg().guildId,to);if(!roles)throw new ops.TicketOperationError('引き継ぎ先の在籍を確認してください。');
   const target=await ops.ticketContext(db,id,{id:to,roles,admin:!!adminLevelOf(d.cfg(),roles)});if(!target.staff)throw new ops.TicketOperationError('引き継ぎ先に担当権限がありません。');
   await ops.requestHandoff(db,id,a,to,String(b.reason??''),now,b.force==='1');
  }else if(action==='accept')await ops.acceptHandoff(db,id,a,now);
  else if(action==='resolution')await ops.requestResolution(db,id,a,String(b.summary??''),now);
  else if(action==='confirm')await ops.confirmResolution(db,id,a,now);
  else if(action==='close')await ops.closeOperation(db,id,a,now);
  else if(action==='reopen')await ops.reopenOperation(db,id,a,now);
  else if(action==='urgency')await ops.setTicketUrgency(db,id,a,b.urgent==='1',now);
  else if(action==='subjects')await ops.setTicketSubjects(db,id,a,String(b.ids??'').split(/[\s,]+/).filter(Boolean),String(b.reason??''),now);
  else if(action==='file_retry')await retryTicketFile(db,id,Number(b.fileId),a,now);
  else if(action==='extend')await ops.extendTicketRetention(db,id,a,Number(b.days),now);
  else throw new ops.TicketOperationError('操作を確認してください。');
  await audit(db,{actorId:a.id,targetId:String(id),action:`ticket.workflow.${action}`,via:'web'});return c.redirect(`/support/${id}`,303);
 }));
 app.post('/support/:id/upload',secure(async(c,a)=>{
  const id=Number(c.req.param('id')),ctx=await ops.ticketContext(db,id,a);if(ctx.ticket.status!=='open')throw new ops.TicketOperationError('完了しています。');
  const b=await c.req.parseBody(),file=b.file;if(!(file instanceof File))throw new ops.TicketOperationError('添付ファイルを選んでください。');
  const fileId=await uploadTicketFile(db,id,a.id,file,d.fileRoot,d.now());await audit(db,{actorId:a.id,targetId:String(id),action:'ticket.attachment',detail:{fileId},via:'web'});return c.redirect(`/support/${id}`,303);
 }));
 app.get('/support/:id/files/:fileId',secure(async(c,a)=>{
  const id=Number(c.req.param('id'));await ops.ticketContext(db,id,a);
  const [row]=await db.select().from(ticketAttachments).where(and(eq(ticketAttachments.id,Number(c.req.param('fileId'))),eq(ticketAttachments.ticketId,id)));if(!row)return c.notFound();
  const data=await readTicketFile(row,d.fileRoot);if(!data)return c.notFound();
  return c.body(new Uint8Array(data),200,{'content-type':'application/octet-stream','content-disposition':`attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(Buffer.from(row.name,'utf8').toString('utf8')).replace(/'/g,'%27')}`,'cache-control':'private, no-store','x-content-type-options':'nosniff'});
 }));
}

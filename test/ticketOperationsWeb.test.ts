import {beforeEach,afterEach,it,expect} from 'vitest';
import {Hono} from 'hono';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Db} from '../src/db/client.js';
import {makeDb,cfg,ROLE} from './helpers.js';
import {mountTicketOperations} from '../src/web/ticketOperations.js';
import {createMemberSession,findMemberSession} from '../src/web/memberSessions.js';
import {createLoginLink} from '../src/services/casino/loginLinks.js';
import {loadTicketConfig,saveTicketConfig,openTicket} from '../src/services/supportTickets.js';
import * as ops from '../src/services/ticketOperations.js';
import {uploadTicketFile} from '../src/services/ticketFiles.js';
const U='870000000000000101',S='870000000000000102',A='870000000000000103',X='870000000000000104',R='870000000000000201',T=new Date('2026-11-26T00:00:00Z');
let db:Db,close:()=>Promise<void>,app:Hono,root:string,id:number,roles:Map<string,string[]>,tokens:Map<string,{token:string;csrf:string}>,apiDown:boolean;
beforeEach(async()=>{({db,close}=await makeDb());root=await mkdtemp(join(tmpdir(),'ticket-web-'));roles=new Map([[U,[]],[S,[R]],[A,[ROLE.guji]],[X,[]]]);tokens=new Map();apiDown=false;
 const conf=await loadTicketConfig(db);await saveTicketConfig(db,{...conf,types:conf.types.map(t=>({...t,roleIds:[R]}))},A);
 const r=await openTicket(db,await loadTicketConfig(db),{openerId:U,typeKey:'inquiry',answers:[{q:'内容',a:'公開相談'}],managed:true},T);if(r.status!=='ok')throw Error();id=r.ticket.id;
 app=new Hono();mountTicketOperations(app,{db,cfg:()=>cfg,baseUrl:'https://example.test',secure:false,now:()=>T,fileRoot:root,api:{authorizeUrl:(s,r)=>`https://discord.example/auth?state=${s}&redirect=${encodeURIComponent(r)}`,exchangeCode:async()=> 'access',me:async()=>({id:U,username:'user',displayName:'user',avatarUrl:null}),memberRoles:async(_g,u)=>{if(apiDown)throw Error();return roles.get(u)??null;}}});
 for(const u of [U,S,A,X]){const token=await createMemberSession(db,{id:u,username:u,displayName:u,avatarUrl:null},T);tokens.set(u,{token,csrf:(await findMemberSession(db,token,T))!.csrfToken});}
});
afterEach(async()=>{await close();await rm(root,{recursive:true,force:true});});
const req=(path:string,u=U,data?:Record<string,string>)=>app.request(path,{method:data?'POST':'GET',headers:{cookie:`sakura_support=${tokens.get(u)!.token}`},...(data?{body:new URLSearchParams({_csrf:tokens.get(u)!.csrf,...data})}:{})});
const action=(a:string,u=U,data:Record<string,string>={})=>req(`/support/${id}/action`,u,{action:a,...data});
it('カジノ資格なしで自分のチケットを開ける。未ログインは認証案内',async()=>{expect((await req(`/support/${id}`)).status).toBe(200);expect((await app.request('/support')).status).toBe(401);});
it('内部メモは担当ロールだけ。相談者や無関係な人へ漏れない',async()=>{await ops.addOperationMessage(db,id,{id:S,roles:[R],admin:false},'非公開のメモ',true,T);expect(await (await req(`/support/${id}`,U)).text()).not.toContain('非公開のメモ');expect(await (await req(`/support/${id}`,S)).text()).toContain('非公開のメモ');expect((await req(`/support/${id}`,X)).status).toBe(404);expect(await (await req('/support',X)).text()).not.toContain(`href="/support/${id}"`);});
it('CSRFなし・違うトークンは拒否して、担当を変更しない',async()=>{expect((await action('claim',S,{_csrf:'wrong'})).status).toBe(403);expect((await ops.ticketContext(db,id,{id:S,roles:[R],admin:false})).ticket.assigneeId).toBeNull();});
it('ロール剥奪・退出・Discord障害時は、古い権限を使わない',async()=>{expect((await req(`/support/${id}`,S)).status).toBe(200);roles.set(S,[]);expect((await req(`/support/${id}`,S)).status).toBe(404);roles.delete(S);expect((await req('/support',S)).status).toBe(403);apiDown=true;expect((await req('/support',A)).status).toBe(503);});
it('当事者の担当は除外し、一覧からも隠す',async()=>{await ops.setTicketSubjects(db,id,{id:A,roles:[],admin:true},[S],'当事者',T);expect((await req(`/support/${id}`,S)).status).toBe(404);expect(await (await req('/support',S)).text()).not.toContain(`href="/support/${id}"`);});
it('主担当だけが進行し、相談者の確認後に完了・履歴・再開できる',async()=>{expect((await action('claim',S)).status).toBe(303);expect((await action('resolution',S,{summary:'対応ずみ'})).status).toBe(303);expect((await action('close',S)).status).toBe(400);expect((await action('confirm')).status).toBe(303);expect((await action('close',S)).status).toBe(303);expect(await (await req('/support?history=1')).text()).toContain(`href="/support/${id}"`);expect((await action('reopen')).status).toBe(303);expect((await ops.operationOf(db,id))!.state).toBe('unassigned');});
it('設定変更は宮司・神職だけ。既存の期限は固定、矛盾する期限は拒否',async()=>{const p=(await ops.operationOf(db,id))!.policy;const values=Object.fromEntries(Object.entries(p).map(([k,v])=>[k,String(v)]));expect((await req('/support/settings',S,values)).status).toBe(403);expect((await req('/support/settings',A,{...values,userCloseHours:'50'})).status).toBe(400);expect((await req('/support/settings',A,{...values,firstReplyHours:'12'})).status).toBe(303);expect((await ops.operationOf(db,id))!.policy.firstReplyHours).toBe(24);});
it('ファイルは同じ案件の権限が必要。HTMLでもダウンロードとして返す',async()=>{const fid=await uploadTicketFile(db,id,U,new File(['<script>test</script>'],'証拠.html',{type:'text/html'}),root,T);const path=`/support/${id}/files/${fid}`;expect((await req(path,X)).status).toBe(404);const res=await req(path);expect(res.status).toBe(200);expect(res.headers.get('content-type')).toBe('application/octet-stream');expect(res.headers.get('content-disposition')).toContain('attachment;');expect(res.headers.get('cache-control')).toContain('no-store');expect((await req(`/support/${id}/files/9999`)).status).toBe(404);expect((await req('/support/NaN')).status).toBe(404);});
it('同じ送信IDの受付・返信は二重処理しない。別件は作成できる',async()=>{const data={typeKey:'inquiry',body:'別の相談',requestId:randomUUID()};const first=await req('/support/new',U,data),second=await req('/support/new',U,data);expect(first.headers.get('location')).toBe(second.headers.get('location'));expect(first.headers.get('location')).not.toBe(`/support/${id}`);const reply={body:'返信内容',requestId:randomUUID()};expect((await action('reply',U,reply)).status).toBe(303);expect((await action('reply',U,reply)).status).toBe(303);});
it('個人リンクは他サイトからの送信を拒否し、1回しか使えない',async()=>{const token=await createLoginLink(db,{id:U,displayName:'user',avatarUrl:null},T),path=`/support/link/${token}`;expect((await app.request(path,{method:'POST',headers:{origin:'https://evil.test'}})).status).toBe(403);expect((await app.request(path,{method:'POST',headers:{origin:'https://example.test'}})).status).toBe(303);expect((await app.request(path,{method:'POST'})).status).toBe(400);});
it('共通OAuthコールバックは自分のstateだけ処理し、他機能へは渡す',async()=>{const res=await app.request('/support/auth'),state=new URL(res.headers.get('location')!).searchParams.get('state')!;expect(res.headers.get('set-cookie')).toContain('Path=/casino/auth');const cookie=`sakura_support_state=${state}`;expect((await app.request(`/casino/auth/callback?state=other&code=x`,{headers:{cookie}})).status).toBe(404);const done=await app.request(`/casino/auth/callback?state=${state}&code=x`,{headers:{cookie}});expect(done.status).toBe(303);expect(done.headers.get('set-cookie')).toContain('sakura_support=');});
it('画面はCSP対応の外部CSSを使い、インラインの実行属性を持たない',async()=>{const html=await (await req('/support')).text();expect(html).toContain('/static/ticket-operations.css');expect(html).not.toMatch(/<style|style=|onclick=|<script/);});

it('ログアウト後は同じメンバーセッションを再利用できない',async()=>{expect((await req('/support/logout',U,{})).status).toBe(303);expect((await req('/support',U)).status).toBe(401);});

it('通常以外の旧方式には期限設定を表示せず、無効なファイルIDも安全に拒否する',async()=>{
 const html=await (await req('/support/settings',A)).text();expect(html).not.toContain('役職の希望（面接）');
 expect((await req('/support/settings',A,{typeKey:'role',firstReplyHours:'12'})).status).toBe(400);
 expect((await req('/support?page=0.01',U)).status).toBe(200);expect((await action('file_retry',U,{fileId:'NaN'})).status).toBe(400);
});

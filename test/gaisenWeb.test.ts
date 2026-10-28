import {beforeEach,afterEach,describe,it,expect} from 'vitest';
import {eq,sql} from 'drizzle-orm';
import {makeDb,cfg,ROLE} from './helpers.js';
import type {Db} from '../src/db/client.js';
import {createWebApp} from '../src/web/app.js';
import {createSession,findSession} from '../src/web/sessions.js';
import {recordJoin} from '../src/services/members.js';
import {addCoins,walletOf} from '../src/services/economy.js';
import {casinoGames,casinoTables,memberSessions,settings} from '../src/db/schema.js';
import {readTrial,TRIAL_KEY,type TrialFloor} from '../src/services/casino/gaisen/trial.js';
const now=new Date('2026-10-28T03:00:00Z'),id='760000000000000001',user={id,username:'sample',displayName:'試遊の運営',avatarUrl:null},path='/economy/gaisen-trial';
let db:Db,close:()=>Promise<void>,app:ReturnType<typeof createWebApp>,token:string,csrf:string;
const headers=(t=token)=>({cookie:'shamusho_session='+t});
beforeEach(async()=>{({db,close}=await makeDb());await recordJoin(db,{...user,roleIds:[ROLE.guji],isBot:false,joinedAt:now});await addCoins(db,id,3210,'adjust');app=createWebApp({db,cfg:()=>cfg,api:{memberRoles:async()=>[ROLE.guji]}as never,discord:{guildChannels:async()=>[]}as never,baseUrl:'https://example.test',now:()=>now});token=await createSession(db,user,{level:'guji',pages:null},now);csrf=(await findSession(db,token,now))!.csrfToken;});afterEach(async()=>close());
async function post(action:string,machine=1,more:Record<string,string>={}){const f=await readTrial(db,now);return app.request(path,{method:'POST',headers:headers(),body:new URLSearchParams({_csrf:csrf,revision:String(f.revision),machine:String(machine),action,...more})});}
describe('運営用の神殿スロット無料試遊',()=>{
 it('運営ログイン・経済権限・CSRFを必要としGETで状態を書かない',async()=>{expect((await app.request(path)).status).toBe(302);const limited=await createSession(db,user,{level:'shinshoku',pages:['members']},now);expect((await app.request(path,{headers:headers(limited)})).status).toBe(403);expect((await app.request(path,{method:'POST',headers:headers(),body:new URLSearchParams({action:'seat',machine:'1',revision:'0'})})).status).toBe(403);const r=await app.request(path,{headers:headers()});expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toContain('no-store');expect(await db.select().from(settings).where(eq(settings.key,TRIAL_KEY))).toHaveLength(0);});
 it('本人だけレバー/STOPを操作でき、古い版の再送では課金/上乗せを繰り返さない',async()=>{
  expect((await post('seat')).status).toBe(303);const v=(await readTrial(db,now)).revision;expect((await post('lever')).status).toBe(303);const balance=(await readTrial(db,now)).machines[0]!.state.balance;
  const retry=await post('lever',1,{revision:String(v)});expect(retry.status).toBe(409);expect((await readTrial(db,now)).machines[0]!.state.balance).toBe(balance);
  const other={...user,id:'760000000000000002'},t=await createSession(db,other,{level:'shinshoku',pages:['economy']},now),s=(await findSession(db,t,now))!;
  const r=await app.request(path,{method:'POST',headers:headers(t),body:new URLSearchParams({_csrf:s.csrfToken,revision:String((await readTrial(db,now)).revision),action:'stop',machine:'1',index:'0'})});expect(r.status).toBe(403);
  for(const i of [0,1,2])expect((await post('stop',1,{index:String(i)})).status).toBe(303);
  expect((await readTrial(db,now)).machines[0]!.state.pending).toBeNull();
 });
 it('永続化した区間と停止位置を別のWebインスタンスから再表示する',async()=>{await post('seat');await post('scenario',1,{scenario:'gstop'});await post('lever');await post('stop',1,{index:'0'});const next=createWebApp({db,cfg:()=>cfg,api:{memberRoles:async()=>[ROLE.guji]}as never,discord:{guildChannels:async()=>[]}as never,baseUrl:'https://example.test',now:()=>now});const html=await(await next.request(path,{headers:headers()})).text();expect(html).toContain('data-phase="gstop"');expect(html).toContain('左STOP</button>');expect(html).toContain('gaisen-trial.js?v=');expect(html).not.toContain('name="role"');expect((await readTrial(db,now)).machines[0]!.state.pending!.stops).toEqual([0]);});
 it('自然抽選と場面確認を区別し、全ルートで実残高・ゲーム・卓・会員セッションを書かない',async()=>{
  const count=()=>Promise.all([casinoGames,casinoTables,memberSessions].map(async t=>(await db.select({n:sql<number>`count(*)::int`}).from(t))[0]!.n));const before=await count();await post('seat');await post('scenario',1,{scenario:'god'});await post('leave');await post('seat',2);await post('lever',2);for(const index of [0,1,2])await post('stop',2,{index:String(index)});await post('refill',2);await post('setting',3,{setting:'6'});expect((await walletOf(db,id)).balance).toBe(3210);expect(await count()).toEqual(before);const html=await(await app.request(path,{headers:headers()})).text();expect(html).toContain('抽選の一部は暫定');expect(html).toContain('本人の保存分を再開中');expect((await db.select().from(settings)).map(r=>r.key)).toContain(TRIAL_KEY);
 });
 it('ボーナス終了で設定予約を反映し、期限後は他人の権利を台に残さない',async()=>{
  await post('seat');await post('scenario',1,{scenario:'gg'});await post('setting',1,{setting:'4'});
  const f=await readTrial(db,now),m=f.machines[0]!;m.state.phase='gzone';m.state.zoneLeft=1;m.state.stocks=0;m.state.pending=null;
  await db.update(settings).set({value:f}).where(eq(settings.key,TRIAL_KEY));await post('lever');
  const [r]=await db.select().from(settings).where(eq(settings.key,TRIAL_KEY));const forced=r!.value as TrialFloor;forced.machines[0]!.state.pending!.role='none';await db.update(settings).set({value:forced}).where(eq(settings.key,TRIAL_KEY));
  for(const index of [0,1,2])await post('stop',1,{index:String(index)});expect((await readTrial(db,now)).machines[0]!.state.setting).toBe(4);
 });
});

it('同じ版からの同時レバーを1回に制限し、失敗操作をロールバックする',async()=>{
 await post('seat');const f=await readTrial(db,now);const revision=String(f.revision);
 const responses=await Promise.all([post('lever',1,{revision}),post('lever',1,{revision})]);expect(responses.map(r=>r.status).sort()).toEqual([303,409]);expect((await readTrial(db,now)).machines[0]!.state.balance).toBe(99970);
});

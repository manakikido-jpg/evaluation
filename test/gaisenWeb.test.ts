import {beforeEach,afterEach,describe,it,expect} from 'vitest';
import {eq,sql} from 'drizzle-orm';
import {makeDb,cfg,ROLE} from './helpers.js';
import type {Db} from '../src/db/client.js';
import {createWebApp} from '../src/web/app.js';
import {createSession,findSession} from '../src/web/sessions.js';
import {recordJoin} from '../src/services/members.js';
import {addCoins,walletOf} from '../src/services/economy.js';
import {casinoGames,casinoTables,memberSessions,settings} from '../src/db/schema.js';
import {readTrial,TRIAL_KEY,TRIAL_V2_KEY,type TrialFloor} from '../src/services/casino/gaisen/trial.js';
const now=new Date('2026-10-28T03:00:00Z'),id='760000000000000001',user={id,username:'sample',displayName:'試遊の運営',avatarUrl:null},path='/economy/gaisen-trial';
let db:Db,close:()=>Promise<void>,app:ReturnType<typeof createWebApp>,token:string,csrf:string;
const headers=(t=token)=>({cookie:'shamusho_session='+t});
beforeEach(async()=>{({db,close}=await makeDb());await recordJoin(db,{...user,roleIds:[ROLE.guji],isBot:false,joinedAt:now});await addCoins(db,id,3210,'adjust');app=createWebApp({db,cfg:()=>cfg,api:{memberRoles:async()=>[ROLE.guji]}as never,discord:{guildChannels:async()=>[]}as never,baseUrl:'https://example.test',now:()=>now});token=await createSession(db,user,{level:'guji',pages:null},now);csrf=(await findSession(db,token,now))!.csrfToken;});afterEach(async()=>close());
async function post(action:string,machine=1,more:Record<string,string>={}){const f=await readTrial(db,now);return app.request(path,{method:'POST',headers:headers(),body:new URLSearchParams({_csrf:csrf,revision:String(f.revision),machine:String(machine),action,...more})});}
describe('運営用の神殿スロット無料試遊',()=>{
 it('JSの保存成功は新旧どちらもHTMLを直接返し、通常フォームは303を維持する',async()=>{
  for(const [url,version] of [[path,'trial-1'],['/economy/gaisen-trial-v2','trial-2']] as const){
   const update=async(action:string,extra:Record<string,string>={})=>app.request(url,{method:'POST',headers:{...headers(),'X-Gaisen-Update':'1'},body:new URLSearchParams({_csrf:csrf,machine:'1',revision:String((await readTrial(db,now,version)).revision),action,...extra})});
   const seat=await update('seat');expect(seat.status).toBe(200);expect(seat.headers.get('location')).toBeNull();expect(seat.headers.get('cache-control')).toContain('no-store');expect(seat.headers.get('content-type')).toContain('text/html');
   let html=await seat.text();expect(html).toContain('data-gaisen-trial');expect(html).toContain('data-revision="1"');expect(html).not.toContain('frontMode');
   const lever=await update('lever');expect(lever.status).toBe(200);html=await lever.text();expect(html).toContain('data-spinning="true"');
   for(const index of ['0','1','2']){const r=await update('stop',{index});expect(r.status).toBe(200);html=await r.text();}
   expect(html).toContain('data-spinning="false"');expect((await readTrial(db,now,version)).machines[0]!.state.pending).toBeNull();
   const f=await readTrial(db,now,version);const normal=await app.request(url,{method:'POST',headers:headers(),body:new URLSearchParams({_csrf:csrf,machine:'1',revision:String(f.revision),action:'leave'})});expect(normal.status).toBe(303);expect(normal.headers.get('location')).toBe(url);
  }
  expect((await walletOf(db,id)).balance).toBe(3210);
 });
 it('画面更新ヘッダーでも認証/経済権限/CSRF/所有者/同時操作を迂回できない',async()=>{
  for(const [url,version] of [[path,'trial-1'],['/economy/gaisen-trial-v2','trial-2']] as const){
   const body=(action:string,revision='0')=>new URLSearchParams({_csrf:csrf,machine:'1',revision,action});
   expect((await app.request(url,{method:'POST',headers:{'X-Gaisen-Update':'1'},body:body('seat')})).status).toBe(302);
   const limited=await createSession(db,user,{level:'shinshoku',pages:['members']},now);
   expect((await app.request(url,{method:'POST',headers:{...headers(limited),'X-Gaisen-Update':'1'},body:body('seat')})).status).toBe(403);
   expect((await app.request(url,{method:'POST',headers:{...headers(),'X-Gaisen-Update':'1'},body:new URLSearchParams({action:'seat',machine:'1',revision:'0'})})).status).toBe(403);
   expect((await app.request(url,{method:'POST',headers:{...headers(),'X-Gaisen-Update':'1'},body:body('seat')})).status).toBe(200);
   const other={...user,id:'760000000000000002'},t=await createSession(db,other,{level:'shinshoku',pages:['economy']},now),s=(await findSession(db,t,now))!;
   expect((await app.request(url,{method:'POST',headers:{...headers(t),'X-Gaisen-Update':'1'},body:new URLSearchParams({_csrf:s.csrfToken,machine:'1',revision:'1',action:'lever'})})).status).toBe(403);
   const rev=String((await readTrial(db,now,version)).revision);
   const replies=await Promise.all([1,2].map(()=>app.request(url,{method:'POST',headers:{...headers(),'X-Gaisen-Update':'1'},body:body('lever',rev)})));expect(replies.map(r=>r.status).sort()).toEqual([200,409]);
   const html=await replies.find(r=>r.status===409)!.text();expect(html).toContain('data-gaisen-trial');expect((await readTrial(db,now,version)).machines[0]!.state.balance).toBe(99970);
  }
  expect((await walletOf(db,id)).balance).toBe(3210);
 });
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

describe('新版の神殿スロットの入口と保存領域',()=>{
 const v2='/economy/gaisen-trial-v2';
 async function postV2(action:string,extra:Record<string,string>={}){
  const f=await readTrial(db,now,'trial-2');
  return app.request(v2,{method:'POST',headers:headers(),body:new URLSearchParams({_csrf:csrf,revision:String(f.revision),machine:'1',action,...extra})});
 }
 it('新しい場面と設定抽選を保存し、GET/同時再送で引き直さず内部情報を隠す',async()=>{
  await postV2('seat');
  for(const scene of ['heaven','back-high','gstop-high'])expect((await postV2('scenario',{scenario:scene})).status).toBe(303);
  let html=await(await app.request(v2,{headers:headers()})).text();
  expect(html).toContain('GG中のG-STOP（鏡高確）');
  await postV2('scenario',{scenario:'omen'});
  const revision=String((await readTrial(db,now,'trial-2')).revision);
  const responses=await Promise.all([postV2('setting',{setting:'6',revision}),postV2('setting',{setting:'6',revision})]);
  expect(responses.map(r=>r.status).sort()).toEqual([303,409]);
  const saved=(await readTrial(db,now,'trial-2')).machines[0]!.reservedReset;
  expect(saved).toBeDefined();
  for(let i=0;i<2;i++)html=await(await app.request(v2,{headers:headers()})).text();
  expect((await readTrial(db,now,'trial-2')).machines[0]!.reservedReset).toEqual(saved);
  for(const field of ['frontMode','backMode','bonusLoops','reservedReset','ceilingLimit','holdGroup'])expect(html).not.toContain(field);
  await postV2('leave');
  expect((await readTrial(db,now,'trial-2')).machines[0]!.state).toMatchObject({setting:6,frontMode:saved!.front,ceilingLimit:saved!.ceiling});
  expect((await walletOf(db,id)).balance).toBe(3210);
 });
 it('救済は最終STOPで一度だけ保存し、別台再開でも内部条件を公開しない',async()=>{
  await postV2('seat');await postV2('scenario',{scenario:'sgg'});await postV2('lever');
  let f=await readTrial(db,now,'trial-2');const s=f.machines[0]!.state;
  s.sggLeft=1;s.sggRescueEligible=true;s.pending!.role='replay';s.pending!.model={flag:'blue',missUnits:0};
  await db.update(settings).set({value:f}).where(eq(settings.key,TRIAL_V2_KEY));
  await postV2('stop',{index:'0'});await postV2('stop',{index:'1'});
  const revision=String((await readTrial(db,now,'trial-2')).revision);
  const responses=await Promise.all([postV2('stop',{index:'2',revision}),postV2('stop',{index:'2',revision})]);
  expect(responses.map(r=>r.status).sort()).toEqual([303,409]);
  f=await readTrial(db,now,'trial-2');const result=f.machines[0]!.state;
  expect(result).toMatchObject({sggRescueEligible:false,sets:1,stocks:0});expect(result.sggLoops).toHaveLength(1);
  expect([50,75]).toContain(result.sggLoops![0]);
  await postV2('leave');await postV2('seat',{machine:'2'});
  expect((await readTrial(db,now,'trial-2')).machines[1]!.state.sggLoops).toEqual(result.sggLoops);
  const html=await(await app.request(v2,{headers:headers()})).text();
  expect(html).not.toContain('sggLoops');expect(html).not.toContain('sggRescueEligible');
  expect((await walletOf(db,id)).balance).toBe(3210);
 });
 it('メデューサとEXの確認場面・無限の保存と同時STOPをWebで扱い、実財布を変えない',async()=>{
  await postV2('seat');await postV2('scenario',{scenario:'medusa'});
  let html=await(await app.request(v2,{headers:headers()})).text();expect(html).toContain('時間停止10G');expect(html).toContain('value="sgg-ex"');
  let f=await readTrial(db,now,'trial-2');f.machines[0]!.state.medusa=0;f.machines[0]!.state.medusaInfinite=true;f.machines[0]!.state.medusaDeferred=true;
  await db.update(settings).set({value:f}).where(eq(settings.key,TRIAL_V2_KEY));
  await postV2('leave');await postV2('seat',{machine:'2'});await postV2('lever',{machine:'2'});
  f=await readTrial(db,now,'trial-2');const s=f.machines[1]!.state;s.pending!.role='red7';s.pending!.model={flag:'red',missUnits:0};
  await db.update(settings).set({value:f}).where(eq(settings.key,TRIAL_V2_KEY));
  html=await(await app.request(v2,{headers:headers()})).text();expect(html).toContain('時間停止（巻き戻しまで）');expect(html).not.toContain('medusaDeferred');
  await postV2('stop',{machine:'2',index:'2'});await postV2('stop',{machine:'2',index:'1'});
  const revision=String((await readTrial(db,now,'trial-2')).revision);
  const responses=await Promise.all([postV2('stop',{machine:'2',index:'0',revision}),postV2('stop',{machine:'2',index:'0',revision})]);
  expect(responses.map(r=>r.status).sort()).toEqual([303,409]);
  expect((await readTrial(db,now,'trial-2')).machines[1]!.state).toMatchObject({stocks:2,sggLeft:16,medusaInfinite:false,medusaDeferred:true,ex:true});
  expect((await walletOf(db,id)).balance).toBe(3210);
  const old=await(await app.request(path,{headers:headers()})).text();expect(old).not.toContain('value="sgg-ex"');expect(old).not.toContain('value="medusa"');
 });
 it('天井直前から24G前兆へ進み、二重STOP・別台再開でも天井権利を一度だけ保全する',async()=>{
  await postV2('seat');await postV2('scenario',{scenario:'ceiling'});await postV2('lever');
  let f=await readTrial(db,now,'trial-2');let s=f.machines[0]!.state;
  s.pending!.role='replay';s.pending!.model={flag:'yellowReplay',missUnits:0};
  await db.update(settings).set({value:f}).where(eq(settings.key,TRIAL_V2_KEY));
  await postV2('stop',{index:'0'});await postV2('stop',{index:'1'});
  const revision=String((await readTrial(db,now,'trial-2')).revision);
  const responses=await Promise.all([postV2('stop',{index:'2',revision}),postV2('stop',{index:'2',revision})]);
  expect(responses.map(r=>r.status).sort()).toEqual([303,409]);
  f=await readTrial(db,now,'trial-2');s=f.machines[0]!.state;
  expect(s).toMatchObject({phase:'omen',ceilingStocks:1,ceilingLeft:24,normalGames:1480,sets:0});
  // ループの率は別の境界テストで検証。この経路は保存済み落選後の状態に固定する。
  s.ceilingLoop=0;await db.update(settings).set({value:f}).where(eq(settings.key,TRIAL_V2_KEY));
  await postV2('leave');await postV2('seat',{machine:'2'});await postV2('lever',{machine:'2'});
  f=await readTrial(db,now,'trial-2');s=f.machines[1]!.state;
  expect(s).toMatchObject({ceilingStocks:1,ceilingLeft:24,setting:1});
  s.pending!.role='god';s.pending!.model={flag:'god',missUnits:0};
  await db.update(settings).set({value:f}).where(eq(settings.key,TRIAL_V2_KEY));
  for(const index of ['0','1','2'])await postV2('stop',{machine:'2',index});
  expect((await readTrial(db,now,'trial-2')).machines[1]!.state).toMatchObject({phase:'gg',sets:1,stocks:5,ceilingStocks:0});
  const html=await(await app.request(v2,{headers:headers()})).text();
  for(const field of ['ceilingLoop','ceilingStocks','ceilingHit','ceilingLeft'])expect(html).not.toContain(field);
  expect((await walletOf(db,id)).balance).toBe(3210);
 });
 it('前兆の場面確認を保存し、別台再開後のGODと二重STOPでも確定権利を守る',async()=>{
  await postV2('seat');expect((await postV2('scenario',{scenario:'omen'})).status).toBe(303);
  const html=await(await app.request(v2,{headers:headers()})).text();
  expect(html).toContain('前兆（当選済み）');expect(html).toContain('data-phase="omen"');expect(html).not.toContain('omenStocks');
  await postV2('leave');await postV2('seat',{machine:'2'});await postV2('lever',{machine:'2'});
  const f=await readTrial(db,now,'trial-2'),s=f.machines[1]!.state;
  expect(s).toMatchObject({omenStocks:1,omen:5,setting:1,sample:true});
  s.pending!.role='god';s.pending!.model={flag:'god',missUnits:0};await db.update(settings).set({value:f}).where(eq(settings.key,TRIAL_V2_KEY));
  await postV2('stop',{machine:'2',index:'0'});await postV2('stop',{machine:'2',index:'1'});
  const revision=String((await readTrial(db,now,'trial-2')).revision);
  const responses=await Promise.all([postV2('stop',{machine:'2',index:'2',revision}),postV2('stop',{machine:'2',index:'2',revision})]);
  expect(responses.map(r=>r.status).sort()).toEqual([303,409]);
  expect((await readTrial(db,now,'trial-2')).machines[1]!.state).toMatchObject({phase:'gg',stocks:5,sets:1,omenStocks:0,firsts:1});
  expect((await walletOf(db,id)).balance).toBe(3210);
 });
 it('新版にも運営・経済権限・CSRFが必要で、表示だけでは保存しない',async()=>{
  expect((await app.request(v2)).status).toBe(302);
  for(const access of [{level:'shinshoku',pages:['members']},{level:'member',pages:['economy']}] as const){
   const t=await createSession(db,user,access as never,now);expect((await app.request(v2,{headers:headers(t)})).status).toBe(403);
  }
  expect((await app.request(v2,{method:'POST',headers:headers(),body:new URLSearchParams({action:'seat',machine:'1',revision:'0'})})).status).toBe(403);
  const r=await app.request(v2,{headers:headers()}),html=await r.text();expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toContain('no-store');
  expect(html).toContain('新版：区間別の抽選・払出');expect(html).toContain('action="'+v2+'"');expect(html).not.toContain('action="'+path+'"');
  expect(await db.select().from(settings).where(eq(settings.key,TRIAL_V2_KEY))).toHaveLength(0);
 });
 it('旧版の回転途中・保存分を保持し、新版だけ進め、再送で二重払いせず実財布を変えない',async()=>{
  await post('seat');await post('scenario',1,{scenario:'sgg'});await post('lever');await post('stop',1,{index:'0'});
  const legacy=(await db.select().from(settings).where(eq(settings.key,TRIAL_KEY)))[0]!;
  const count=()=>Promise.all([casinoGames,casinoTables,memberSessions].map(async t=>(await db.select({n:sql<number>`count(*)::int`}).from(t))[0]!.n)),before=await count();
  expect((await postV2('seat',{version:'trial-1'})).status).toBe(303);await postV2('scenario',{scenario:'sgg'});await postV2('lever');
  const f=await readTrial(db,now,'trial-2'),p=f.machines[0]!.state.pending!;
  // 本番の乱数には触れず、保存済み抽選をDBからの再開テスト用に固定。
  p.role='red7';p.order=[2,1,0];p.model={flag:'reverseRed',missUnits:0};await db.update(settings).set({value:f}).where(eq(settings.key,TRIAL_V2_KEY));
  await postV2('stop',{index:'2'});await postV2('stop',{index:'1'});
  const rev=String((await readTrial(db,now,'trial-2')).revision);
  const responses=await Promise.all([postV2('stop',{index:'0',revision:rev}),postV2('stop',{index:'0',revision:rev})]);expect(responses.map(r=>r.status).sort()).toEqual([303,409]);
  const result=await readTrial(db,now,'trial-2');expect(result.machines[0]!.state.version).toBe('trial-2');expect(result.machines[0]!.state.lastPaid).toBe(30);expect(result.machines[0]!.state.stocks).toBe(2);
  const html=await(await app.request(v2,{headers:headers()})).text();expect(html).toContain('赤7成立');expect(html).toContain('リプレイ · 30ポイント返却');expect(html).toContain('直近5ゲームの小役履歴');expect(html).toContain('gt-history-red');expect(result.machines[0]!.state.symbolHistory).toEqual(['red']);
  await postV2('leave');await postV2('seat',{machine:'2'});expect((await readTrial(db,now,'trial-2')).machines[1]!.state.version).toBe('trial-2');
  expect((await db.select().from(settings).where(eq(settings.key,TRIAL_KEY)))[0]).toEqual(legacy);
  expect((await walletOf(db,id)).balance).toBe(3210);expect(await count()).toEqual(before);
 });
});

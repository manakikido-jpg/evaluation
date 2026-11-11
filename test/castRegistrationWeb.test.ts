import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {eq} from 'drizzle-orm';
import {cfg,makeDb,ROLE} from './helpers.js';
import {createWebApp} from '../src/web/app.js';
import {createSession,findSession} from '../src/web/sessions.js';
import {recordJoin} from '../src/services/members.js';
import {members} from '../src/db/schema.js';
import {getCast,loadCastConfig,registerCast,saveCastConfig} from '../src/services/cast.js';
import {listAudit} from '../src/services/audit.js';
const BASE='https://office.example',STAFF='770000000000000001',A='770000000000000002',B='770000000000000003';
let db:Awaited<ReturnType<typeof makeDb>>['db'],close:()=>Promise<void>,app:ReturnType<typeof createWebApp>,token:string,csrf:string,dmOk:boolean,actions:string[];
const now=new Date('2026-11-11T03:00:00Z');
beforeEach(async()=>{
 ({db,close}=await makeDb());actions=[];dmOk=true;
 for(const id of [A,B]){await recordJoin(db,{id,username:'user'+id,displayName:'同じ名前',avatarUrl:null,roleIds:[ROLE.ujiko],isBot:false,joinedAt:now});await db.update(members).set({ageGroup:'adult'}).where(eq(members.id,id));}
 token=await createSession(db,{id:STAFF,username:'operator',displayName:'検証運営',avatarUrl:null},{level:'guji',pages:['cast']},now);csrf=(await findSession(db,token,now))!.csrfToken;
 app=createWebApp({db,cfg,baseUrl:BASE,now:()=>now,api:{memberRoles:async()=>[ROLE.guji]} as never,discord:{guildRoles:async()=>[],guildChannels:async()=>[],sendDm:async()=>{actions.push('dm');return dmOk;},addRole:async()=>{actions.push('role');}} as never});
});
afterEach(async()=>{await close();});
const get=()=>app.request(BASE+'/cast',{headers:{Cookie:'shamusho_session='+token}});
const post=(data:Record<string,string>,csrfToken=csrf)=>app.request(BASE+'/cast/register',{method:'POST',headers:{Cookie:'shamusho_session='+token,Origin:BASE,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({_csrf:csrfToken,member:A,bio:'紹介を残す',tags:'雑談、ゲーム',useTemplate:'no',menuName:'雑談',menuNote:'説明を残す',menuMinutes:'30',menuPrice:'300',...data})});
describe('キャスト登録の入力と復旧',()=>{
 it('同名でもIDを別々に選べ、テンプレがないと個別が初期選択',async()=>{
  await saveCastConfig(db,{...await loadCastConfig(db),menuTemplate:[]},STAFF);
  const html=await(await get()).text();expect(html).toContain(`value="${A}"`);expect(html).toContain(`value="${B}"`);expect(html).toContain('ID: '+A);expect(html).toMatch(/name="useTemplate" value="no" checked/);expect(html).toContain('cast-register.js');expect(html).toContain('data-office-inplace=""');expect(html).toMatch(/id="cast-register" data-native-submit/);
 });
 it('入力エラーは422で内容を安全に残し、登録や通知をしない',async()=>{
  const r=await post({menuPrice:'0',bio:'<script>残す</script>',menuGacha:'声A\n声B'});expect(r.status).toBe(422);const html=await r.text();expect(html).toContain('&lt;script&gt;残す&lt;/script&gt;');expect(html).toContain('value="0"');expect(html).toContain('説明を残す');expect(html).toContain('声A\n声B');expect(html).toContain('role="alert"');expect(await getCast(db,A)).toBeUndefined();expect(actions).toEqual([]);
 });
 it('同名の文字列を送っても勝手に本人を決めず、IDで正常登録',async()=>{
  expect((await post({member:'同じ名前'})).status).toBe(422);expect((await post({member:B})).headers.get('location')).toBe('/cast?msg=registered');expect(await getCast(db,A)).toBeUndefined();expect(await getCast(db,B)).toMatchObject({status:'active'});
 });
 it('未成年・退会・空テンプレをサーバーで拒否',async()=>{
  await db.update(members).set({ageGroup:'minor'}).where(eq(members.id,A));expect((await post({})).status).toBe(422);
  await db.update(members).set({leftAt:now}).where(eq(members.id,B));expect((await post({member:B})).status).toBe(422);
  await saveCastConfig(db,{...await loadCastConfig(db),menuTemplate:[]},STAFF);
  await db.update(members).set({ageGroup:'adult'}).where(eq(members.id,A));expect((await post({useTemplate:'yes',tplPicked:'yes'})).status).toBe(422);expect(actions).toEqual([]);
 });
 it('CSRFなしと経済以外の閲覧専用権限は登録できない',async()=>{
  expect((await post({},'wrong')).status).toBe(403);
  token=await createSession(db,{id:STAFF,username:'operator',displayName:'検証運営',avatarUrl:null},{level:'shinshoku',pages:['cast'],writePages:[]},now);csrf=(await findSession(db,token,now))!.csrfToken;
  expect((await post({})).status).toBe(403);expect(await getCast(db,A)).toBeUndefined();
 });
 it('同時登録は1回だけ保存して監査・DMも1件',async()=>{
  const responses=await Promise.all([post({}),post({})]);expect(responses.map(r=>r.status).sort()).toEqual([302,422]);expect(actions.filter(a=>a==='dm')).toHaveLength(1);expect(await listAudit(db,{action:'cast.register'})).toHaveLength(1);
 });
 it('DM失敗でも登録は保持し、成功したと誤表示しない',async()=>{
  dmOk=false;expect((await post({})).headers.get('location')).toBe('/cast?msg=registered_partial');expect(await getCast(db,A)).toMatchObject({status:'active'});expect((await post({})).status).toBe(422);expect(actions).toEqual(['dm']);
 });
 it('ロール付与に失敗しても登録を保持し、通知の一部失敗を知らせる',async()=>{
  await saveCastConfig(db,{...await loadCastConfig(db),roleId:'780000000000000005'},STAFF);
  app=createWebApp({db,cfg,baseUrl:BASE,now:()=>now,api:{memberRoles:async()=>[ROLE.guji]} as never,discord:{guildRoles:async()=>[],guildChannels:async()=>[],addRole:async()=>{throw new Error('fixture permission failure');},sendDm:async()=>true} as never});
  expect((await post({})).headers.get('location')).toBe('/cast?msg=registered_partial');expect(await getCast(db,A)).toMatchObject({status:'active'});
 });
 it('同時の異なる初期メニューで先に登録したメニューを上書きしない',async()=>{
  const conf=await loadCastConfig(db);const profile={bio:'',tags:[],minorOk:true};
  const results=await Promise.all(['最初A','最初B'].map(name=>registerCast(db,conf,{id:A,adult:true},profile,{name,note:'',minutes:30,price:300,night:false},STAFF,now)));
  expect(results.map(r=>r.status).sort()).toEqual(['already','ok']);expect((await getCast(db,A))?.menu).toHaveLength(1);
 });
});

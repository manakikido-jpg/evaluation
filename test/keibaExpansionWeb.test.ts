import {afterEach,beforeEach,describe,it,expect} from 'vitest';
import {makeDb,cfg,ROLE} from './helpers.js';
import type {Db} from '../src/db/client.js';
import {createWebApp} from '../src/web/app.js';
import {createMemberSession,findMemberSession} from '../src/web/memberSessions.js';
import {createSession,findSession} from '../src/web/sessions.js';
import {recordJoin} from '../src/services/members.js';
import {addCoins,walletOf} from '../src/services/economy.js';
import {addHorse} from '../src/services/casino/keibaStable.js';
import {createTable} from '../src/services/casino/tables/service.js';
import {eq} from 'drizzle-orm';
import {keibaEvents,keibaHorses} from '../src/db/schema.js';
const A='760000000000000001',B='760000000000000002',now=new Date('2026-10-27T00:00:00Z');let db:Db,close:()=>Promise<void>,app:ReturnType<typeof createWebApp>,cookie:string,csrf:string,admin:string,adminCsrf:string;
beforeEach(async()=>{({db,close}=await makeDb());await recordJoin(db,{id:A,username:'sample',displayName:'さくら',avatarUrl:null,roleIds:[ROLE.guji],isBot:false,joinedAt:now});await addCoins(db,A,5000,'adjust');const token=await createMemberSession(db,{id:A,username:'sample',displayName:'さくら',avatarUrl:null},now);cookie='sakura_casino='+token;csrf=(await findMemberSession(db,token,now))!.csrfToken;admin=await createSession(db,{id:A,username:'sample',displayName:'さくら',avatarUrl:null},{level:'guji',pages:null},now);adminCsrf=(await findSession(db,admin,now))!.csrfToken;app=createWebApp({db,cfg:()=>cfg,api:{memberRoles:async()=>[ROLE.guji]} as never,discord:{} as never,baseUrl:'https://example.test',now:()=>now});});afterEach(async()=>{await close();});
const post=(path:string,values:Record<string,string|string[]>,headers={cookie})=>{const body=new URLSearchParams();for(const [k,v]of Object.entries(values))for(const x of Array.isArray(v)?v:[v])body.append(k,x);return app.request(path,{method:'POST',headers,body});};
describe('育成/馬券/大会画面',()=>{
 it('レースと馬主の画面で現在の保証条件と日額上限を説明する',async()=>{
  const t=await createTable(db,cfg,'keiba',{id:A,name:'さくら'},{window:'2'},now);
  if(t.status!=='ok'||!('table'in t))throw Error('create');
  for(const path of [`/casino/t/${t.table.id}`,'/casino/keiba/stable']){
   const response=await app.request(path,{headers:{cookie}});
   expect(response.status).toBe(200);
   const html=await response.text();
   expect(html).toContain('ほかの人の賭けは不要');
   expect(html).toContain('必ず2倍もらえる意味ではありません');
   expect(html).toContain('1日1,000まで（日本時間0時区切り）');
   if(path.includes('/t/'))expect(html).toContain('1 着賞金の目安');
  }
 });
 it('認証とCSRFが必要で、他人の育成やスキルを変更できない',async()=>{const h=(await addHorse(db, '育成の馬',undefined,B))!;expect((await app.request('/casino/keiba/club')).status).toBe(302);expect((await post(`/casino/keiba/club/${h.id}/train`,{kind:'start'})).status).toBe(403);const res=await post(`/casino/keiba/club/${h.id}/skills`,{_csrf:csrf,skills:'dash'});expect(res.headers.get('location')).toContain('saved=0');const [saved]=await db.select().from(keibaHorses).where(eq(keibaHorses.id,h.id));expect(saved!.development.skills).toEqual([]);});
 it('候補/点数/合計を確認し、確認した買い目だけを購入する',async()=>{const t=await createTable(db,cfg,'keiba',{id:A,name:'さくら'},{window:'2'},now);if(t.status!=='ok'||!('table'in t))throw Error('create');const path=`/casino/keiba/tickets/${t.table.id}`;const page=await app.request(path+'?type=exacta&mode=formation&p1=1&p2=2&p2=3&amount=50',{headers:{cookie}});const html=await page.text();expect(html).toContain('2点 × 50銭 ＝ 合計 100銭');expect(html).toContain('1&gt;2');expect(html).toContain('name="v"');expect((await walletOf(db,A)).balance).toBe(5000);const body={_csrf:csrf,action:'bets',mode:'formation',type:'exacta',p1:'1',p2:['2','3'],bet:'50',v:String(t.table.version),raceKey:String((t.table.state as any).race.n)};await post(`/casino/t/${t.table.id}/act`,body);await post(`/casino/t/${t.table.id}/act`,body);expect((await walletOf(db,A)).balance).toBe(4900);});
 it('育成・収支・大会・リプレイの入口が開け、非公開の他人の収支を表示しない',async()=>{await addHorse(db,'自分の馬',undefined,A);for(const path of ['/casino/keiba/club','/casino/keiba/events','/casino/keiba/replays']){const r=await app.request(path,{headers:{cookie}});expect(r.status).toBe(200);const html=await r.text();expect(html).toContain('keiba-club.css?v=');expect(html).toContain('aria-label="競馬のメニュー"');expect(html).toContain('href="/casino/keiba/stable"');expect(html).toContain('keiba-theme.css?v=');}expect((await app.request(`/casino/keiba/owners/${B}`,{headers:{cookie}})).status).toBe(200);expect((await app.request('/static/keiba-club.css')).status).toBe(200);});
});
describe('大会の社務所設定',()=>{
 it('宮司とCSRFだけを許可し、設定と履歴を保存できる',async()=>{expect((await app.request('/keiba-events')).headers.get('location')).toBe('/login');const other=await createSession(db,{id:B,username:'staff',displayName:'神職',avatarUrl:null},{level:'shinshoku',pages:null},now);expect((await app.request('/keiba-events',{headers:{cookie:'shamusho_session='+other}})).status).toBe(403);const values={name:'秋の大会',kind:'league',startsAt:'2026-10-28T21:00',endsAt:'2026-10-29T21:00',dist:'1600',surface:'0',maxStarts:'100',minWins:'0',maxWins:'100',points:'10,7,5,3,2,1,0,0',rewardTitle:'秋の記念',rewardColor:'#d4af37',rewardPlaces:'3'};expect((await post('/keiba-events/save',values,{cookie:'shamusho_session='+admin})).status).toBe(403);const r=await post('/keiba-events/save',{...values,_csrf:adminCsrf},{cookie:'shamusho_session='+admin});expect(r.headers.get('location')).toContain('saved=1');const all=await db.select().from(keibaEvents);expect(all).toHaveLength(1);expect(all[0]!.startsAt.toISOString()).toBe('2026-10-28T12:00:00.000Z');});
});

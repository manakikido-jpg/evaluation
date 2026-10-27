import { broadcastFixture } from './keibaBroadcastFixture.js';
import { eq } from 'drizzle-orm';
import { coinTx, casinoTables, keibaHorses } from '../src/db/schema.js';
import { afterEach,beforeEach,describe,expect,it } from 'vitest';
import { count } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { cfg,makeDb,ROLE } from './helpers.js';
import { createWebApp } from '../src/web/app.js';
import { createMemberSession } from '../src/web/memberSessions.js';
import { recordJoin } from '../src/services/members.js';
import { addCoins,walletOf } from '../src/services/economy.js';
const USER='760000000000000001';let db:Db,close:()=>Promise<void>,app:ReturnType<typeof createWebApp>,cookie:string,current=cfg;let now:Date;
beforeEach(async()=>{
 ({db,close}=await makeDb());current=cfg;now=new Date('2026-10-27T03:00:00Z');
 await recordJoin(db,{id:USER,username:'sample',displayName:'sample',avatarUrl:null,roleIds:[ROLE.sanpaisha],isBot:false,joinedAt:now});await addCoins(db,USER,1000,'adjust');
 const token=await createMemberSession(db,{id:USER,username:'sample',displayName:'sample',avatarUrl:null},now);cookie=`sakura_casino=${token}`;
 app=createWebApp({db,cfg:()=>current,api:{memberRoles:async()=>[ROLE.sanpaisha]} as never,discord:{} as never,baseUrl:'https://example.test',now:()=>now});
});afterEach(async()=>{await close();});
describe('映像試作の入口',()=>{
 it('ログインが必要で、競馬停止中は入れない',async()=>{
  expect((await app.request('/casino/keiba/preview')).status).toBe(302);
  current={...cfg,casino:{...cfg.casino,games:cfg.casino.games.filter(k=>k!=='keiba')}};
  expect((await app.request('/casino/keiba/preview',{headers:{cookie}})).headers.get('location')).toBe('/casino?e=game_off');
 });
 it('サンプルであることと操作を表示し、閲覧で銭/レース/実馬を動かさない',async()=>{
  const snapshot=()=>Promise.all([db.select({n:count()}).from(coinTx),db.select({n:count()}).from(casinoTables),db.select({n:count()}).from(keibaHorses)]);
  const before=await snapshot();
  const response=await app.request('/casino/keiba/preview',{headers:{cookie}}),html=await response.text();expect(response.status).toBe(200);
  expect(html).toContain('サンプルレース／馬券なし');expect(html).toContain('data-keiba-preview');expect(html).toContain('data-kr-goal');expect(html).not.toContain('data-kr-camera="mine"');expect(html).toContain('keiba-preview.js?v=');expect(html).not.toMatch(/onclick=|<script>(?!<)/);
  const after=await snapshot();expect(after).toEqual(before);expect((await walletOf(db,USER)).balance).toBe(1000);
 });
 it('モジュールを同じ配信元から版付きで読み込める',async()=>{
  for(const file of ['keiba-preview.js','keiba-replay.js','keiba-horse.js','keiba-preview.css']){const r=await app.request('/static/'+file);expect(r.status).toBe(200);expect(r.headers.get('content-type')).toContain(file.endsWith('.css')?'text/css':'text/javascript');if(file==='keiba-preview.js'){const body=await r.text();expect(body).toMatch(/keiba-replay\.js\?v=[a-f0-9]{10}/);expect(body).toMatch(/keiba-horse\.js\?v=[a-f0-9]{10}/);}}
 });
});

describe('実レース観戦の入口と更新',()=>{
 async function raceTable(){const {racing}=broadcastFixture();const [t]=await db.insert(casinoTables).values({kind:'keiba',hostId:USER,state:racing,seatIds:[USER],dueAt:new Date(racing.deadline)}).returning();return {t:t!,s:racing,key:`${racing.race.n}:${racing.run!.start}`};}
 it('ログイン/競馬有効/卓の種類/走行とレース番号を確認する',async()=>{
  const {t,s,key}=await raceTable();
  expect((await app.request(`/casino/keiba/watch/${t.id}`)).status).toBe(302);
  expect((await app.request(`/casino/keiba/watch/${t.id}/state?race=${encodeURIComponent(key)}`)).status).toBe(302);
  expect((await app.request(`/casino/keiba/watch/${t.id}?race=wrong`,{headers:{cookie}})).headers.get('location')).toBe(`/casino/t/${t.id}`);
  expect((await app.request(`/casino/keiba/watch/${t.id}/state?race=wrong`,{headers:{cookie}})).status).toBe(409);
  await db.update(casinoTables).set({kind:'poker'}).where(eq(casinoTables.id,t.id));
  expect((await app.request(`/casino/keiba/watch/${t.id}/state?race=${encodeURIComponent(key)}`,{headers:{cookie}})).status).toBe(404);
  await db.update(casinoTables).set({kind:'keiba',state:s}).where(eq(casinoTables.id,t.id));
  current={...cfg,casino:{...cfg.casino,games:cfg.casino.games.filter(k=>k!=='keiba')}};
  expect((await app.request(`/casino/keiba/watch/${t.id}/state?race=${encodeURIComponent(key)}`,{headers:{cookie}})).status).toBe(403);
 });
 it('実際の出走馬を表示し、並行更新でも通常の確定を一度だけ行う',async()=>{
  const {t,s,key}=await raceTable();s.tickets=[{memberId:USER,name:'sample',t:'win',key:String(s.run!.order[0]),amount:100}];s.real=100;await db.update(casinoTables).set({state:s}).where(eq(casinoTables.id,t.id));const path=`/casino/keiba/watch/${t.id}`;
  const response=await app.request(path,{headers:{cookie}}),body=await response.text();
  expect(response.headers.get('cache-control')).toContain('no-store');expect(body).toContain(s.horses[0]!.name);expect(body).toContain('馬券・払戻を確認する');expect(body).not.toContain('サンプルレース／馬券なし');
  // 🎥 馬券を買った馬を追うカメラ（自分の馬）がはじめから選ばれる
  expect(body).toContain('data-kr-camera="mine" aria-pressed="true"');
  expect(body).toContain(`&quot;follow&quot;:[${s.run!.order[0]}]`);
  const url=path+'/state?race='+encodeURIComponent(key);
  const before=await walletOf(db,USER);
  const early=await (await app.request(url,{headers:{cookie}})).json() as any;expect(early.live.confirmed).toBe(false);expect(early.results).toEqual([]);
  now=new Date(s.deadline+1);
  const results=await Promise.all([app.request(url,{headers:{cookie}}),app.request(url,{headers:{cookie}})]);
  for(const r of results){expect(r.status).toBe(200);const d=await r.json() as any;expect(d.live.confirmed).toBe(true);expect(d.results.map((r:any)=>r.no)).toEqual(s.run!.order);}
  const [saved]=await db.select().from(casinoTables).where(eq(casinoTables.id,t.id));expect((saved!.state as any).phase).toBe('result');expect((saved!.state as any).history.filter((r:any)=>r.n===s.race.n)).toHaveLength(1);
  const paid=(saved!.state as any).tickets[0].payout;expect(paid).toBeGreaterThan(0);expect((await walletOf(db,USER)).balance).toBe(before.balance+paid);
  const credits=await db.select().from(coinTx).where(eq(coinTx.memberId,USER));expect(credits.filter(r=>r.reason==='casino_win')).toHaveLength(1);
  // 次のレースのデータを前の観戦画面へ返さない。
  await db.update(casinoTables).set({state:{...s,race:{...s.race,n:s.race.n+1}}}).where(eq(casinoTables.id,t.id));
  expect((await app.request(url,{headers:{cookie}})).status).toBe(409);
 });
});

describe('通常の卓で新しい映像へ切り替える',()=>{
 it('受付中は購入、発走後と断片更新は同じ卓に3Dを表示し、馬券・払戻を保つ',async()=>{
  const {betting,racing}=broadcastFixture();const ticket={memberId:USER,name:'sample',t:'win' as const,key:'1',amount:10};betting.tickets=[ticket];racing.tickets=[ticket];betting.real=10;racing.real=10;now=new Date(racing.run!.start+1000);
  const [t]=await db.insert(casinoTables).values({kind:'keiba',hostId:USER,state:betting,seatIds:[USER],dueAt:new Date(betting.deadline)}).returning();
  const get=async(path:string)=>(await app.request(path,{headers:{cookie}})).text();
  const before=await get(`/casino/t/${t!.id}`);expect(before).toContain('馬券を買う');expect(before).not.toContain('kr-embedded');
  await db.update(casinoTables).set({state:racing,dueAt:new Date(racing.deadline)}).where(eq(casinoTables.id,t!.id));
  for(const path of [`/casino/t/${t!.id}`,`/casino/t/${t!.id}/frag`]){const html=await get(path);expect(html).toContain('kr-embedded');expect(html).toContain('data-keiba-module');expect(html).not.toContain('class="kb-canvas"');expect(html).toContain('あなたの馬券');expect(html).toContain('data-kr-quality');}
  now=new Date(racing.deadline+1);const result=await get(`/casino/t/${t!.id}`);expect(result).toContain('kr-embedded');expect(result).toContain('確定結果');expect(result).toContain('あなたの馬券');
 });
});

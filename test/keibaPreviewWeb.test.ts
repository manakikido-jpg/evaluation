import { coinTx, casinoTables, keibaHorses } from '../src/db/schema.js';
import { afterEach,beforeEach,describe,expect,it } from 'vitest';
import { count } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { cfg,makeDb,ROLE } from './helpers.js';
import { createWebApp } from '../src/web/app.js';
import { createMemberSession } from '../src/web/memberSessions.js';
import { recordJoin } from '../src/services/members.js';
import { addCoins,walletOf } from '../src/services/economy.js';
const USER='760000000000000001';let db:Db,close:()=>Promise<void>,app:ReturnType<typeof createWebApp>,cookie:string,current=cfg;
beforeEach(async()=>{
 ({db,close}=await makeDb());current=cfg;const now=new Date('2026-10-27T03:00:00Z');
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
  expect(html).toContain('サンプルレース／馬券なし');expect(html).toContain('data-keiba-preview');expect(html).toContain('data-kr-goal');expect(html).toContain('keiba-preview.js?v=');expect(html).not.toMatch(/onclick=|<script>(?!<)/);
  const after=await snapshot();expect(after).toEqual(before);expect((await walletOf(db,USER)).balance).toBe(1000);
 });
 it('モジュールを同じ配信元から版付きで読み込める',async()=>{
  for(const file of ['keiba-preview.js','keiba-replay.js','keiba-horse.js','keiba-preview.css']){const r=await app.request('/static/'+file);expect(r.status).toBe(200);expect(r.headers.get('content-type')).toContain(file.endsWith('.css')?'text/css':'text/javascript');if(file==='keiba-preview.js'){const body=await r.text();expect(body).toMatch(/keiba-replay\.js\?v=[a-f0-9]{10}/);expect(body).toMatch(/keiba-horse\.js\?v=[a-f0-9]{10}/);}}
 });
});

import { randomUUID } from 'node:crypto';
import { afterEach,beforeEach,expect,it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { members } from '../src/db/schema.js';
import { createWebApp } from '../src/web/app.js';
import { createSession,findSession } from '../src/web/sessions.js';
import type { DiscordActions } from '../src/lib/discordRest.js';
import type { DiscordApi } from '../src/web/discordApi.js';
import { buyKoban,sendKoban } from '../src/services/koban.js';
import { addCoins } from '../src/services/economy.js';
import { listItems,seedDefaultItems } from '../src/services/shop.js';
import { cfg,makeDb } from './helpers.js';
const A='700000000000000001',B='700000000000000002';let db:Db,close:()=>Promise<void>,app:ReturnType<typeof createWebApp>;const now=new Date('2026-10-25T12:00:00+09:00');
beforeEach(async()=>{({db,close}=await makeDb());await seedDefaultItems(db,{colors:[],titles:[]});await db.insert(members).values([A,B].map(id=>({id,username:id,displayName:'メンバー'})));await addCoins(db,A,10000,'admin_grant');app=createWebApp({db,cfg,api:{} as DiscordApi,discord:{guildChannels:async()=>[],guildRoles:async()=>[]} as unknown as DiscordActions,baseUrl:'https://test.example',now:()=>now});});
afterEach(async()=>close());
async function session(level:'guji'|'shinshoku'){const token=await createSession(db,{id:A,username:'a',displayName:'運営',avatarUrl:null},{level,pages:null},now);return {token,csrf:(await findSession(db,token,now))!.csrfToken};}
it('管理画面のSHOPに累計の販売数・売上・手数料・未送付額面を表示し、通常メンバーへ公開しない',async()=>{
 const item=(await listItems(db)).find(i=>i.kind==='koban_1000')!;const sent=await buyKoban(db,A,item.id,randomUUID());await buyKoban(db,A,item.id,randomUUID());await sendKoban(db,A,sent.receipt.id,B);
 expect((await app.request('/shop')).status).toBe(302);const staff=await session('shinshoku');expect((await app.request('/shop',{headers:{cookie:'shamusho_session='+staff.token}})).status).toBe(403);
 const guji=await session('guji');const res=await app.request('/shop',{headers:{cookie:'shamusho_session='+guji.token}});expect(res.status).toBe(200);const html=await res.text();
 expect(html).toContain('小判の販売・手数料（累計）');expect(html).toContain('3,000銭');expect(html).toContain('1,000銭');expect(html).toContain('2枚');expect(html).toContain('未送付の額面');
});
it('管理画面から価格を偽装して保存しても150％固定。CSRFも必須',async()=>{
 const item=(await listItems(db)).find(i=>i.kind==='koban_1000')!,s=await session('guji');
 const post=(csrf:string)=>app.request('/shop/items/'+item.id,{method:'POST',headers:{cookie:'shamusho_session='+s.token,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({_csrf:csrf,name:item.name,price:'1',enabled:'yes',boosterOnly:'yes'})});
 expect((await post('bad')).status).toBe(403);expect((await post(s.csrf)).status).toBe(302);
 expect((await listItems(db)).find(i=>i.id===item.id)).toMatchObject({price:1500,boosterOnly:false});
});

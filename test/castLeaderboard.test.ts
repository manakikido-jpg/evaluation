import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { castSessions, castChampagnes, coinTx, settings } from '../src/db/schema.js';
import { castLeaderboard, setRankingHidden, rankingHidden } from '../src/services/castLeaderboard.js';
import { castTop } from '../src/services/castRank.js';
import { castLeaderboardBody, refreshCastLeaderboard } from '../src/discord/castLeaderboard.js';
import { DiscordHttpError } from '../src/lib/discordRest.js';
import { makeDb } from './helpers.js';
let db:Db,close:()=>Promise<void>;
const A='880000000000000001',B='880000000000000002',U='880000000000000003',CH='990000000000000001',NEXT='990000000000000002';
const NOW=new Date('2026-10-22T03:00:00Z');
beforeEach(async()=>{({db,close}=await makeDb());});afterEach(async()=>close());
async function session(castId=A,extra:Partial<typeof castSessions.$inferInsert>={}){return(await db.insert(castSessions).values({castId,customerId:U,plan:'30',minutes:30,price:1000,paid:900,status:'done',closedAt:NOW,...extra}).returning())[0]!;}
const fake=()=>({sendMessage:vi.fn(async()=>({id:'message-1'})),editMessage:vi.fn(async()=>{}),deleteMessage:vi.fn(async()=>{})});
it('本数は完了通話、売上は返金を除く通常と納品＋支払済みシャンパンの手数料前を使う',async()=>{
 const a=await session(),b=await session(B,{price:1000,paid:450});
 await db.insert(coinTx).values({memberId:U,amount:500,reason:'cast_refund',detail:{sessionId:b.id,early:true}});
 await session(A,{plan:'dlv:voice',price:2000,paid:1800});await session(A,{status:'canceled',price:5000,paid:4500});
 await session(A,{closedAt:new Date('2026-09-30T14:59:59Z')});
 await session(A,{closedAt:new Date('2026-10-31T15:00:00Z')});
 await db.insert(castChampagnes).values([{id:'paid',sessionId:b.id,customerId:U,castId:B,channelId:CH,bottle:'x',bottleName:'ボトル',price:5000,fee:1500,expiresAt:NOW,paidAt:NOW},{id:'pending',sessionId:a.id,customerId:U,castId:A,channelId:CH,bottle:'x',bottleName:'ボトル',price:99999,fee:0,expiresAt:NOW,paidAt:null}]);
 const data=await castLeaderboard(db,NOW);expect(data.month).toBe('2026-10');
 expect(data.rows.find(r=>r.castId===A)).toMatchObject({count:1,revenue:3000});
 expect(data.rows.find(r=>r.castId===B)).toMatchObject({count:1,revenue:5500});
 expect((await castLeaderboard(db,new Date('2026-10-31T15:00:00Z'))).month).toBe('2026-11');
});
it('🙈 名前を消したキャストは、ランキングと上位（表彰）に出さない。戻すとまた出る',async()=>{
 await session();await session(B);
 await setRankingHidden(db,A,true,U);await setRankingHidden(db,A,true,U);
 expect([...await rankingHidden(db)]).toEqual([A]);
 expect((await castLeaderboard(db,NOW)).rows.map(r=>r.castId)).toEqual([B]);
 expect((await castTop(db,new Date('2026-09-30T15:00:00Z'))).map(r=>r.castId)).toEqual([B]);
 await setRankingHidden(db,A,false,U);
 expect((await castLeaderboard(db,NOW)).rows.map(r=>r.castId).sort()).toEqual([A,B].sort());
});
it('本数と売上を別々に並べ、同順位・長い名前・通知なし・空月を扱う',()=>{
 const rows=[{castId:A,count:2,revenue:100},{castId:B,count:2,revenue:200},{castId:U,count:1,revenue:300}];
 const body=castLeaderboardBody('2026-10',rows,new Map([[A,'@everyone\n<@123> **名前**'],[B,'B'],[U,'C']]),'銭');
 const fields=body.embeds![0]!.fields!;
 expect(fields[0]!.value.match(/🥇/g)).toHaveLength(2);expect(fields[0]!.value).toContain('🥉');
 expect(fields[1]!.value.indexOf('C')).toBeLessThan(fields[1]!.value.indexOf('B'));
 expect(JSON.stringify(body)).not.toContain('@everyone');expect(body.allowed_mentions).toEqual({parse:[]});
 const big=castLeaderboardBody('2026-10',Array.from({length:20},(_,i)=>({castId:String(i),count:i+1,revenue:(i+1)*100})),new Map(Array.from({length:20},(_,i)=>[String(i),'名'.repeat(100)])),'銭'.repeat(100));
 expect(big.embeds![0]!.fields!.every(f=>f.value.length<=1024)).toBe(true);
 expect(castLeaderboardBody('2026-11',[],new Map(),'銭').embeds![0]!.fields![0]!.value).toContain('まだありません');
});
it('同時投稿でも1枚、実績変更は編集、変更なしは省略し5分後に存在確認する',async()=>{
 await session();const api=fake();
 await Promise.all([refreshCastLeaderboard(db,api,'銭',{channelId:CH,now:NOW}),refreshCastLeaderboard(db,api,'銭',{channelId:CH,now:NOW})]);
 expect(api.sendMessage).toHaveBeenCalledTimes(1);
 api.editMessage.mockClear();await refreshCastLeaderboard(db,api,'銭',{now:new Date(NOW.getTime()+60000)});expect(api.editMessage).not.toHaveBeenCalled();
 await session(B);await refreshCastLeaderboard(db,api,'銭',{now:new Date(NOW.getTime()+120000)});expect(api.editMessage).toHaveBeenCalledTimes(1);
 await refreshCastLeaderboard(db,api,'銭',{now:new Date(NOW.getTime()+420000)});expect(api.editMessage).toHaveBeenCalledTimes(2);
 const [saved]=await db.select().from(settings).where(eq(settings.key,'cast.live-ranking'));expect(saved!.value).toMatchObject({channelId:CH,messageId:'message-1'});
});
it('消された投稿だけ作り直し、一時障害や権限不足では重複投稿せず元の保存先を残す',async()=>{
 const api=fake();await refreshCastLeaderboard(db,api,'銭',{channelId:CH,now:NOW});
 for(const code of [403,429,503]){api.editMessage.mockRejectedValueOnce(new DiscordHttpError('failed',code));await expect(refreshCastLeaderboard(db,api,'銭',{force:true,now:NOW})).rejects.toThrow('failed');}
 expect(api.sendMessage).toHaveBeenCalledTimes(1);
 api.editMessage.mockRejectedValueOnce(new DiscordHttpError('missing',404));await refreshCastLeaderboard(db,api,'銭',{force:true,now:NOW});expect(api.sendMessage).toHaveBeenCalledTimes(2);
 api.sendMessage.mockRejectedValueOnce(Error('cannot post'));
 await expect(refreshCastLeaderboard(db,api,'銭',{channelId:NEXT,now:NOW})).rejects.toThrow();expect(api.deleteMessage).not.toHaveBeenCalled();
 const [saved]=await db.select().from(settings).where(eq(settings.key,'cast.live-ranking'));expect(saved!.value).toMatchObject({channelId:CH});
});
it('月が変わると空の新月へ更新し、配置変更は成功後に古い投稿を消す',async()=>{
 await session();const api=fake();await refreshCastLeaderboard(db,api,'銭',{channelId:CH,now:NOW});
 await refreshCastLeaderboard(db,api,'銭',{now:new Date('2026-10-31T15:00:00Z')});expect(JSON.stringify(api.editMessage.mock.calls)).toContain('2026-11');
 await refreshCastLeaderboard(db,api,'銭',{channelId:NEXT,now:NOW});expect(api.deleteMessage).toHaveBeenCalledWith(CH,'message-1');
});
it('コマンドは運営だけが配置でき、一般のランキングボタンも同じ二つの順位を返す',async()=>{
 const {CastApp}=await import('../src/discord/cast.js');const {cfg,ROLE}=await import('./helpers.js');
 const api=fake(),app=new CastApp(db,()=>cfg,api as never);
 const make=(staff:boolean)=>({commandName:'panel',isChatInputCommand:()=>true,inCachedGuild:()=>true,guildId:cfg.guildId,channelId:CH,channel:{isSendable:()=>true},member:{roles:{cache:new Map(staff?[[ROLE.guji,{}]]:[])}},options:{getSubcommand:()=> 'cast-ranking'},user:{id:U},deferReply:vi.fn(),editReply:vi.fn()});
 await app.onInteraction(make(false) as never);expect(api.sendMessage).not.toHaveBeenCalled();
 await app.onInteraction(make(true) as never);expect(api.sendMessage).toHaveBeenCalledTimes(1);
 const i={deferReply:vi.fn(),editReply:vi.fn()};
 await (app as unknown as {ranking(i:unknown):Promise<void>}).ranking(i);
 expect(JSON.stringify(i.editReply.mock.calls)).toContain('指名本数ランキング');expect(JSON.stringify(i.editReply.mock.calls)).toContain('売上ランキング');
});
it('社務所の配置は認証・CSRF・サーバー内チャンネルを確かめる',async()=>{
 const {createWebApp}=await import('../src/web/app.js');const {createSession,findSession}=await import('../src/web/sessions.js');const {cfg,ROLE}=await import('./helpers.js');
 const api=fake();const app=createWebApp({db,cfg,api:{memberRoles:async()=>[ROLE.guji]} as never,discord:{...api,guildChannels:async()=>[{id:CH,name:'ランキング',type:0,position:0,parent_id:null}]} as never,baseUrl:'https://test.example',now:()=>NOW});
 expect((await app.request('/cast/ranking-panel',{method:'POST'})).status).toBe(302);
 const token=await createSession(db,{id:U,username:'staff',displayName:'staff',avatarUrl:null},{level:'guji',pages:null},NOW),s=(await findSession(db,token,NOW))!;
 const post=(data:Record<string,string>)=>app.request('/cast/ranking-panel',{method:'POST',headers:{cookie:'shamusho_session='+token,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(data)});
 expect((await post({channelId:CH})).status).toBe(403);
 expect((await post({_csrf:s.csrfToken,channelId:NEXT})).headers.get('location')).toContain('ranking_failed');expect(api.sendMessage).not.toHaveBeenCalled();
 expect((await post({_csrf:s.csrfToken,channelId:CH})).headers.get('location')).toContain('ranking_posted');expect(api.sendMessage).toHaveBeenCalledTimes(1);
 const {loadCastConfig,saveCastConfig}=await import('../src/services/cast.js');
 await saveCastConfig(db,{...await loadCastConfig(db),feePercent:20},U);
 expect((await db.select().from(settings).where(eq(settings.key,'cast.live-ranking')))[0]!.value).toMatchObject({channelId:CH});
});
it('毎分の処理から実績を反映し、再起動後は保存された同じ投稿を確かめる',async()=>{
 const {CastApp}=await import('../src/discord/cast.js');const {cfg}=await import('./helpers.js');
 const api=fake();await session();await refreshCastLeaderboard(db,api,'銭',{channelId:CH,now:NOW});
 const app=new CastApp(db,()=>cfg,api as never);app.attach({channels:{cache:new Map()}} as never);
 await app.tick(NOW);expect(api.editMessage).toHaveBeenCalledTimes(1);
 api.editMessage.mockClear();await app.tick(new Date(NOW.getTime()+60000));expect(api.editMessage).not.toHaveBeenCalled();
 await session();await app.tick(new Date(NOW.getTime()+120000));expect(api.editMessage).toHaveBeenCalledTimes(1);
 expect(JSON.stringify(api.editMessage.mock.calls)).toContain('2本');expect(api.sendMessage).toHaveBeenCalledTimes(1);
});

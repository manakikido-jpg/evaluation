import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { makeDb } from './helpers.js';
import type { Db } from '../src/db/client.js';
import { members, visitDaily, visitPurchases, visitProfiles, visitBadges, coinTx } from '../src/db/schema.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { buyVisitItem, eligibleVisitMembers, recordVisitMinute, saveVisitProfile, visitData, visitRank } from '../src/services/visitProfile.js';
import { renderVisitCard, visitCardSvg } from '../src/services/visitCard.js';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
const A='760000000000000001',B='760000000000000002',C='760000000000000003';
const now=new Date('2026-10-25T12:00:00+09:00');
let db:Db,close:()=>Promise<void>;
beforeEach(async()=>{({db,close}=await makeDb());await db.insert(members).values([A,B,C].map(id=>({id,username:id,displayName:id===A?'桜と月 <script>':'参拝者',joinedAt:new Date('2025-10-25T12:00:00+09:00')})));await addCoins(db,A,10000,'admin_grant');});
afterEach(async()=>close());
describe('参拝の記録',()=>{
 it('2人条件、ミュート、BOT、離席、カテゴリ、除外VCを守る',()=>{
  const m=(id:string,extra={})=>({id,bot:false,serverMute:false,deaf:false,...extra});
  const ch=(name:string,people:ReturnType<typeof m>[],extra={})=>({id:name,name,members:people,...extra});
  expect(eligibleVisitMembers([ch('雑談',[m(A),m(B)]),ch('ひとり',[m(C),m('bot',{bot:true})])],new Set())).toEqual([A,B]);
  for(const change of [{serverMute:true},{deaf:true}])expect(eligibleVisitMembers([ch('雑談',[m(A),m(B,change)])],new Set())).toEqual([]);
  for(const name of ['奥の院','離席用','AFK'])expect(eligibleVisitMembers([ch(name,[m(A),m(B)])],new Set())).toEqual([]);
  expect(eligibleVisitMembers([ch('通話',[m(A),m(B)],{categoryName:'離席用'})],new Set())).toEqual([]);
  expect(eligibleVisitMembers([ch('雑談',[m(A),m(B)])],new Set(['雑談']))).toEqual([]);
 });
 it('同じ分の同時記録・重複IDは1回、過去の再送と停止時間を加算しない',async()=>{
  await Promise.all([recordVisitMinute(db,[A,A,B],now),recordVisitMinute(db,[A,B],now)]);
  await recordVisitMinute(db,[A],new Date(now.getTime()-60000));
  await recordVisitMinute(db,[A],new Date(now.getTime()+3600000));
  const a=await visitData(db,A,now);expect(a.minutes).toBe(2);expect(a.activeDays).toBe(0);
  expect((await visitData(db,B,now)).minutes).toBe(1);
 });
 it('日本時間の日付と今月を分け、既存の活動記録から移入しない',async()=>{
  await recordVisitMinute(db,[A],new Date('2026-09-30T14:59:00Z'));
  await recordVisitMinute(db,[A],new Date('2026-09-30T15:00:00Z'));
  const rows=await db.select().from(visitDaily);expect(rows.map(r=>r.date).sort()).toEqual(['2026-09-30','2026-10-01']);
  const d=await visitData(db,A,now);expect(d.minutes).toBe(2);expect(d.monthMinutes).toBe(1);
 });
 it('退会・BOT・未知のIDは数えない',async()=>{
  await db.update(members).set({leftAt:now}).where(eq(members.id,B));await db.update(members).set({isBot:true}).where(eq(members.id,C));
  await recordVisitMinute(db,[A,B,C,'missing'],now);expect(await db.select().from(visitDaily)).toHaveLength(1);
  await expect(visitData(db,B,now)).rejects.toThrow('在籍');
 });
 it('ランクの境界と最高位を正しく計算する',()=>{
  expect(visitRank(59).level).toBe(1);expect(visitRank(60).name).toBe('参拝者');expect(visitRank(600).name).toBe('顔なじみ');expect(visitRank(60000).next).toBeNull();
 });
 it('100時間・活動日数・1周年の実績は一度だけ獲得し限定装備を開く',async()=>{
  await db.insert(visitDaily).values(Array.from({length:7},(_,i)=>({memberId:A,date:'2026-10-'+String(i+1).padStart(2,'0'),minutes:900,lastMinute:i})));
  const d=await visitData(db,A,now);expect(d.minutes).toBe(6300);expect(d.activeDays).toBe(7);expect(d.owned).toContain('century');
  expect(d.badges.map(b=>b.badgeId)).toEqual(expect.arrayContaining(['vc100','days7','anniversary']));
  await visitData(db,A,now);expect(await db.select().from(visitBadges)).toHaveLength(d.badges.length);
  expect((await visitData(db,B,now)).badges).toHaveLength(0);
 });
});
describe('購入・装備・公開',()=>{
 it('同時の二重購入は1回だけ課金し、再送や別商品の購入でも装備・ランクを勝手に変えない',async()=>{
  const results=await Promise.all([buyVisitItem(db,A,'sakura',1500,true,now),buyVisitItem(db,A,'sakura',1500,true,now)]);
  expect(results.sort()).toEqual(['bought','owned']);expect((await walletOf(db,A)).balance).toBe(8500);
  expect(await db.select().from(visitPurchases)).toHaveLength(1);
  await buyVisitItem(db,A,'gold',3500,true,now);const d=await visitData(db,A,now);expect(d.rank.level).toBe(1);expect(d.profile.background).toBe('paper');
  expect((await db.select().from(coinTx).where(eq(coinTx.reason,'shop')))).toHaveLength(2);
 });
 it('金額改ざん・未確認・不足・実績限定品・退会者の購入を拒否する',async()=>{
  for(const args of [['sakura',1,true],['sakura',1500,false],['century',0,true],['unknown',1500,true]] as const)await expect(buyVisitItem(db,A,args[0],args[1],args[2],now)).rejects.toThrow();
  await expect(buyVisitItem(db,B,'sakura',1500,true,now)).rejects.toThrow('足り');
  await db.update(members).set({leftAt:now}).where(eq(members.id,A));await expect(buyVisitItem(db,A,'sakura',1500,true,now)).rejects.toThrow('在籍');
  expect((await walletOf(db,A)).balance).toBe(10000);expect(await db.select().from(visitPurchases)).toHaveLength(0);
 });
 it('購入記録の書込み失敗なら銭・監査も戻る',async()=>{
  await db.execute(sql`alter table visit_purchases add constraint injected_failure check (price < 1000)`);
  await expect(buyVisitItem(db,A,'sakura',1500,true,now)).rejects.toThrow();expect((await walletOf(db,A)).balance).toBe(10000);expect(await db.select().from(coinTx).where(eq(coinTx.reason,'shop'))).toHaveLength(0);
 });
 it('所持装備だけ選べ、獲得したバッジを5つまで保存、未獲得や重複を拒否する',async()=>{
  const input={background:'sakura',frame:'plain',title:'rank',badges:[],publicStats:true};
  await expect(saveVisitProfile(db,A,input,now)).rejects.toThrow('持って');await buyVisitItem(db,A,'sakura',1500,true,now);
  await recordVisitMinute(db,[A],now);await saveVisitProfile(db,A,{...input,title:'first',badges:['first']},now);
  const d=await visitData(db,A,now);expect(d.profile).toMatchObject({...input,title:'first',badges:['first']});
  for(const badges of [['first','first'],['vc100'],Array(6).fill('first')])await expect(saveVisitProfile(db,A,{...input,badges},now)).rejects.toThrow();
  await expect(saveVisitProfile(db,A,{...input,title:'vc100'},now)).rejects.toThrow('称号');
  await expect(saveVisitProfile(db,A,{...input,frame:'sakura'},now)).rejects.toThrow('持って');
 });
 it('公開用の非公開カードはランク・通話・実績を隠し、名前をエスケープする',async()=>{
  await recordVisitMinute(db,[A],now);
  await visitData(db,A,now);await saveVisitProfile(db,A,{background:'paper',frame:'plain',title:'rank',badges:[],publicStats:false},now);
  const d=await visitData(db,A,now);
  const pub=visitCardSvg(d);expect(pub).toContain('活動記録は非公開');expect(pub).not.toContain('累計通話');expect(pub).not.toContain('Lv.');expect(pub).not.toContain('<script>');expect(pub).toContain('&lt;script&gt;');
  expect(visitCardSvg(d,{privateView:true})).toContain('累計通話');
  await saveVisitProfile(db,A,{background:'paper',frame:'plain',title:'rank',badges:['first'],publicStats:true},now);
  expect(visitCardSvg(await visitData(db,A,now))).toContain('はじめの一歩');
 });
 it('背景と透過フレームを別々に替えられ、PNGをBase64にしても4MiB以内に収める',async()=>{
  const d=await visitData(db,A,now);
  const original=renderVisitCard(d,{privateView:true,background:'moon',frame:'crescent'});
  const bg=renderVisitCard(d,{privateView:true,background:'sakura',frame:'crescent'});
  const frame=renderVisitCard(d,{privateView:true,background:'moon',frame:'gold'});
  expect(original.equals(bg)).toBe(false);expect(original.equals(frame)).toBe(false);
  for(const png of [original,bg,frame])expect(Math.ceil(png.length/3)*4).toBeLessThan(4194304);
  expect(visitCardSvg(d,{background:'../../unknown',frame:'../../unknown'})).not.toContain('https://');
 });
 it('細縁は上下左右の画像端に接し、外周へ透明な余白を残さない',async()=>{
  const png=renderVisitCard(await visitData(db,A,now),{privateView:true,background:'moon',frame:'plain'});
  for(const [left,top] of [[540,0],[540,639],[0,320],[1079,320]]){
   const pixel=await sharp(png).ensureAlpha().extract({left:left!,top:top!,width:1,height:1}).raw().toBuffer();
   expect(pixel[3]).toBe(255);expect(pixel[0]).toBeGreaterThan(pixel[1]!);expect(pixel[1]).toBeGreaterThan(pixel[2]!);
  }
 });
 it('実配布する4フレームは透過PNGで、中央を覆わない',async()=>{
  for(const id of ['petal','crescent','gold','century']){
   const path=fileURLToPath(new URL('../assets/visit/frame-'+id+'.png',import.meta.url));
   expect(await sharp(path).metadata()).toMatchObject({format:'png',width:1080,height:640,hasAlpha:true});
   const center=await sharp(path).extract({left:540,top:320,width:1,height:1}).raw().toBuffer();
   expect(center[3]).toBe(0);
  }
 });
 it('どの試着もPNGとして描画でき、未所持の試着は保存・課金しない',async()=>{
  const d=await visitData(db,A,now);const png=renderVisitCard(d,{privateView:true,background:'goldnight',frame:'gold',preview:true});const meta=await sharp(png).metadata();expect(meta).toMatchObject({format:'png',width:1080,height:640});
  expect((await visitData(db,A,now)).profile.background).toBe('paper');expect((await walletOf(db,A)).balance).toBe(10000);
 });
});

it('初期設定は公開で、既存プロフィールの移行後に本人が非公開へ戻しても再公開しない',async()=>{
 const data=await visitData(db,A,now);expect(data.profile.publicStats).toBe(true);expect(visitCardSvg(data)).toContain('累計通話');
 await db.update(visitProfiles).set({publicStats:false}).where(eq(visitProfiles.memberId,A));
 const migration=await readFile(new URL('../drizzle/0134_quiet_cable.sql',import.meta.url),'utf8');
 for(const statement of migration.split('--> statement-breakpoint'))if(statement.trim())await db.execute(sql.raw(statement));
 expect((await visitData(db,A,now)).profile.publicStats).toBe(true);
 expect((await visitData(db,B,now)).profile.publicStats).toBe(true);
 await saveVisitProfile(db,A,{background:'paper',frame:'plain',title:'rank',badges:[],publicStats:false},now);
 for(let n=0;n<2;n++)expect((await visitData(db,A,now)).profile.publicStats).toBe(false);
 expect(visitCardSvg(await visitData(db,A,now))).not.toContain('累計通話');
});

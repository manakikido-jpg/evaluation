import { VisitError } from './visitErrors.js';
export { VisitError } from './visitErrors.js';
import { customCatalog, buyCustomDesign } from './visitWorkshop.js';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { activityDaily, members, visitDaily, visitProfiles, visitPurchases, visitBadges, visitDesigns } from '../db/schema.js';
import { jstDate } from './activity.js';
import { spendWithin } from './economy.js';
import { audit } from './audit.js';

export const VISIT_STAFF_STYLES = [
  {id:'crimson',name:'紅眼の金紋'},
  {id:'blue-lantern',name:'青夜の花灯り'},
  {id:'purple-gold',name:'紫苑の金桜'},
  {id:'general',name:'一般用の着せ替えを使う'},
] as const;
export const visitStaffStyle=(value:string|undefined)=>VISIT_STAFF_STYLES.find(s=>s.id===value)??VISIT_STAFF_STYLES[0];

export const VISIT_RANKS = [
  { name: '旅人', minutes: 0 }, { name: '参拝者', minutes: 60 },
  { name: '顔なじみ', minutes: 600 }, { name: '常連', minutes: 3000 },
  { name: '名士', minutes: 12000 }, { name: '語り部', minutes: 30000 },
  { name: '咲楽の灯', minutes: 60000 },
] as const;
export const VISIT_ITEMS = [
  { id: 'paper', kind: 'background', name: '白桜の和紙', price: 0, colors: ['#f3ebe1','#dfb3bd'], badge: null },
  { id: 'sakura', kind: 'background', name: '桜の宵', price: 1500, colors: ['#341c42','#ab567f'], badge: null },
  { id: 'moon', kind: 'background', name: '月夜の神社', price: 2500, colors: ['#0c1d3d','#355a80'], badge: null },
  { id: 'snow', kind: 'background', name: '雪明かり', price: 2000, colors: ['#d8e9ef','#7e9cae'], badge: null },
  { id: 'goldnight', kind: 'background', name: '金箔の夜桜', price: 5000, colors: ['#141b22','#70542e'], badge: null },
  { id: 'plain', kind: 'frame', name: '細縁', price: 0, colors: ['#c7aa7b','#c7aa7b'], badge: null },
  { id: 'petal', kind: 'frame', name: '桜結び', price: 1000, colors: ['#f2b3c6','#d183a3'], badge: null },
  { id: 'crescent', kind: 'frame', name: '月の輪', price: 2000, colors: ['#d7e3ff','#8ba9d8'], badge: null },
  { id: 'gold', kind: 'frame', name: '金糸の飾り縁', price: 3500, colors: ['#f8de9c','#bd8b38'], badge: null },
  { id: 'century', kind: 'frame', name: '百時間の縁', price: 0, colors: ['#a7dfd2','#e9d89a'], badge: 'vc100' },
] as const;
export const VISIT_BADGES = [
  { id: 'first', name: 'はじめの一歩', detail: '対象の通話を1分', minutes: 1, days: 0 },
  { id: 'vc1', name: 'ひと時のご縁', detail: '通話1時間', minutes: 60, days: 0 },
  { id: 'vc10', name: '縁側の顔なじみ', detail: '通話10時間', minutes: 600, days: 0 },
  { id: 'vc100', name: '百時間の語らい', detail: '通話100時間・限定フレーム', minutes: 6000, days: 0 },
  { id: 'vc500', name: '夜桜の語り手', detail: '通話500時間', minutes: 30000, days: 0 },
  { id: 'days7', name: '七日の足あと', detail: '10分以上の活動を7日', minutes: 0, days: 7 },
  { id: 'days30', name: '三十日のご縁', detail: '10分以上の活動を30日', minutes: 0, days: 30 },
  { id: 'anniversary', name: '参拝一周年', detail: '参加から1年・対象通話1分以上', minutes: 1, days: 0 },
] as const;
export type VisitChannel = { id:string; name:string; categoryName?:string|null; members:{id:string;bot:boolean;serverMute:boolean;deaf:boolean}[] };
export function eligibleVisitMembers(channels:VisitChannel[],excluded:ReadonlySet<string>):string[]{
  const ids=new Set<string>();
  for(const c of channels){
    if(excluded.has(c.id)||/奥の院|離席|AFK/i.test(c.name+' '+(c.categoryName??'')))continue;
    const people=c.members.filter(m=>!m.bot&&!m.serverMute&&!m.deaf);
    if(people.length>=2)for(const m of people)ids.add(m.id);
  }
  return [...ids];
}
/** 1分の観測につき1回。停止中を埋めず、同時・再実行も増やさない。 */
export async function recordVisitMinute(db:Db,ids:string[],now=new Date()){
  if(!ids.length)return;
  const minute=Math.floor(now.getTime()/60000),date=jstDate(now);
  const active=await db.select({id:members.id}).from(members).where(and(inArray(members.id,[...new Set(ids)]),eq(members.isBot,false),sql`${members.leftAt} is null`)).orderBy(asc(members.id));
  if(!active.length)return;
  await db.insert(visitDaily).values(active.map(m=>({memberId:m.id,date,minutes:1,lastMinute:minute}))).onConflictDoUpdate({
    target:[visitDaily.memberId,visitDaily.date],
    set:{minutes:sql`${visitDaily.minutes}+1`,lastMinute:minute},
    setWhere:sql`${visitDaily.lastMinute} < ${minute}`,
  });
}
export function visitRank(minutes:number){
  const i=VISIT_RANKS.reduce((n,r,index)=>minutes>=r.minutes?index:n,0);
  return {level:i+1,...VISIT_RANKS[i]!,next:VISIT_RANKS[i+1]??null};
}
export async function visitData(db:Db,id:string,now=new Date(),preview?:{background?:string;frame?:string}){
  const [member]=await db.select().from(members).where(eq(members.id,id));
  if(!member||member.leftAt||member.isBot)throw new VisitError('在籍中のメンバーだけが利用できます。');
  await db.insert(visitProfiles).values({memberId:id}).onConflictDoNothing();
  const [profile]=await db.select().from(visitProfiles).where(eq(visitProfiles.memberId,id));
  // 参拝プロフィールを始める前の通話の時間（毎日の活動の記録）も数える。同じ日は多いほうだけ（二重に数えない）
  const [visit,activity]=await Promise.all([db.select().from(visitDaily).where(eq(visitDaily.memberId,id)),db.select({date:activityDaily.date,minutes:activityDaily.vcMinutes}).from(activityDaily).where(eq(activityDaily.memberId,id))]);
  const byDate=new Map<string,number>();
  for(const r of [...visit,...activity])byDate.set(r.date,Math.max(byDate.get(r.date)??0,r.minutes));
  const days=[...byDate].map(([date,minutes])=>({date,minutes}));
  const minutes=days.reduce((n,r)=>n+r.minutes,0),activeDays=days.filter(r=>r.minutes>=10).length;
  const month=jstDate(now).slice(0,7),monthMinutes=days.filter(r=>r.date.startsWith(month)).reduce((n,r)=>n+r.minutes,0);
  const earned=VISIT_BADGES.filter(b=>minutes>=b.minutes&&activeDays>=b.days&&(b.id!=='anniversary'||!!member.joinedAt&&now.getTime()-member.joinedAt.getTime()>=365*86400000));
  if(earned.length)await db.insert(visitBadges).values(earned.map(b=>({memberId:id,badgeId:b.id,earnedAt:now}))).onConflictDoNothing();
  const badges=await db.select().from(visitBadges).where(eq(visitBadges.memberId,id));
  const purchases=await db.select().from(visitPurchases).where(eq(visitPurchases.memberId,id));
  const owned:string[]=VISIT_ITEMS.filter(item=>item.badge?badges.some(b=>b.badgeId===item.badge):item.price===0||purchases.some(p=>p.itemId===item.id)).map(i=>i.id);
  const custom=await customCatalog(db,id,purchases.map(p=>p.itemId));
  const catalog=[...VISIT_ITEMS,...custom];
  owned.push(...custom.filter(i=>i.creatorId===id||purchases.some(p=>p.itemId===i.id)).map(i=>i.id));
  const selected=[...new Set([profile!.background,profile!.frame,preview?.background,preview?.frame].filter((v):v is string=>!!v&&custom.some(i=>i.id===v)))];
  const images=selected.length?await db.select({id:visitDesigns.id,data:visitDesigns.data}).from(visitDesigns).where(inArray(visitDesigns.id,selected)):[];
  const art:Record<string,string>=Object.fromEntries(images.map(i=>[i.id,Buffer.from(i.data).toString('base64')]));
  return {staffTheme:false,member,profile:profile!,minutes,monthMinutes,activeDays,rank:visitRank(minutes),badges,purchases,owned,catalog,art};
}
export type VisitData=Awaited<ReturnType<typeof visitData>>;
export async function buyVisitItem(db:Db,id:string,itemId:string,quote:number,confirmed:boolean,now=new Date()){
  if(itemId.startsWith('design_'))return buyCustomDesign(db,id,itemId,quote,confirmed,now);
  const item=VISIT_ITEMS.find(i=>i.id===itemId);
  if(!item||item.price<=0||item.badge||quote!==item.price||!confirmed)throw new VisitError('商品・金額を確認してから購入してください。');
  return db.transaction(async tx=>{
    const [m]=await tx.select().from(members).where(eq(members.id,id)).for('update');
    if(!m||m.leftAt||m.isBot)throw new VisitError('在籍を確認できません。');
    const [old]=await tx.select().from(visitPurchases).where(and(eq(visitPurchases.memberId,id),eq(visitPurchases.itemId,itemId)));
    if(old)return 'owned' as const;
    if(!await spendWithin(tx,id,item.price,'shop',{kind:'visit_cosmetic',itemId}))throw new VisitError('銭が足りません。');
    await tx.insert(visitPurchases).values({memberId:id,itemId,price:item.price,createdAt:now});
    await audit(tx,{actorId:id,action:'visit.buy',detail:{itemId,price:item.price},via:'web'});
    return 'bought' as const;
  });
}
export async function saveVisitProfile(db:Db,id:string,input:{background:string;frame:string;title:string;badges:string[];publicStats:boolean},now=new Date()){
  return db.transaction(async tx=>{
    const [m]=await tx.select().from(members).where(eq(members.id,id)).for('update');
    if(!m||m.leftAt||m.isBot)throw new VisitError('在籍を確認できません。');
    const data=await visitData(tx,id,now);
    for(const kind of ['background','frame'] as const)if(!data.catalog.some(i=>i.id===input[kind]&&i.kind===kind&&data.owned.includes(i.id)))throw new VisitError('持っている背景・フレームを選んでください。');
    if(input.title!=='rank'&&input.title!==''&&!data.badges.some(b=>b.badgeId===input.title))throw new VisitError('獲得した称号を選んでください。');
    if(input.badges.length>5||new Set(input.badges).size!==input.badges.length||input.badges.some(id=>!data.badges.some(b=>b.badgeId===id)))throw new VisitError('獲得したバッジから5個まで選んでください。');
    await tx.update(visitProfiles).set(input).where(eq(visitProfiles.memberId,id));
    await audit(tx,{actorId:id,action:'visit.equip',detail:{...input},via:'web'});
  });
}

/** 最新ロールを確認したWeb入口からのみ保存する。一般用の設定は触らない。 */
export async function saveVisitStaffStyle(db:Db,id:string,style:string,verifiedStaff:boolean,now=new Date()) {
  if(!verifiedStaff||!VISIT_STAFF_STYLES.some(s=>s.id===style))throw new VisitError('運営専用の装いを選んでください。');
  await db.transaction(async tx=>{
    const [m]=await tx.select().from(members).where(eq(members.id,id)).for('update');
    if(!m||m.leftAt||m.isBot)throw new VisitError('在籍を確認できません。');
    await tx.insert(visitProfiles).values({memberId:id,staffStyle:style}).onConflictDoUpdate({target:visitProfiles.memberId,set:{staffStyle:style}});
    await audit(tx,{actorId:id,action:'visit.staffStyle',detail:{style},via:'web'});
  });
}

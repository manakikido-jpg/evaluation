import type { Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { and, desc, eq, ilike, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { marketBids, marketListingImages, marketListings, marketOffers, marketOrders, marketRequests, members } from '../db/schema.js';
import { detectImage } from '../services/notices.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { effectivePermissions } from '../services/permissionCheck.js';
import * as market from '../services/market.js';
import { executeMarketWeb, MarketWebError } from '../services/marketWeb.js';
import { walletOf } from '../services/economy.js';
import { buyRole, priceOf, refund } from '../services/shop.js';
import { createMemberSession, deleteMemberSession, findMemberSession } from './memberSessions.js';
import { randomToken, safeEqual } from './sessions.js';
import { peekLoginLink, useLoginLink } from '../services/casino/loginLinks.js';
import type { DiscordApi } from './discordApi.js';
import { MarketAuthPage, MarketCreatePage, MarketListingPage, MarketListPage, MarketOrderPage, MarketOrdersPage, MarketRequestPage, MarketSellerPage, type MarketMe } from './views/marketplace.js';
/** 写真の大きさの上限 */
export const MARKET_IMAGE_MAX=8*1024*1024;
const COOKIE='sakura_market',STATE='sakura_market_state';
type Deps={db:Db;cfg:()=>GuildConfig;discord:DiscordActions;api:DiscordApi;baseUrl:string;secure:boolean;now:()=>Date};
export function mountMarketplace(app:Hono<any>,d:Deps){
 const {db,api}=d;const cookie={httpOnly:true,secure:d.secure,sameSite:'Lax' as const,path:'/marketplace',maxAge:7*86400};
 const redirectUri=d.baseUrl+'/casino/auth/callback';
 /** サーバー在籍と市場の閲覧権限を毎回再確認。ロール・権限を取得できないときは閉じる。 */
 const access=async(id:string)=>{
  const cfg=d.cfg();const [roles,channels,guildRoles]=await Promise.all([api.memberRoles(cfg.guildId,id),d.discord.guildChannels(cfg.guildId),d.discord.guildRoles(cfg.guildId)]);
  if(!roles)return undefined;
  const ch=channels.find(c=>c.id===cfg.channels.market&&c.type===0);
  if(!ch||!Array.isArray(ch.permission_overwrites)||!guildRoles.some(r=>r.id===cfg.guildId)||guildRoles.some(r=>!/^\d+$/.test(r.permissions??'')))throw new Error('market permission snapshot incomplete');
  const perms=effectivePermissions(ch,guildRoles,cfg.guildId,roles,id);
  if(!perms.view||!perms.history)return undefined;
  const [member]=await db.select().from(members).where(eq(members.id,id));
  if(!member||member.leftAt||member.isBot)return undefined;
  return {roles,member};
 };
 const protectedPage=(handler:(c:Context,me:MarketMe)=>Response|Promise<Response>)=>async(c:Context)=>{
  const session=await findMemberSession(db,getCookie(c,COOKIE)??'',d.now());
  if(!session){return c.req.method==='GET'?c.html(<MarketAuthPage error="Discordでログインして市場に入ってください。"/>):c.redirect('/marketplace',303);}
  let fresh;try{fresh=await access(session.userId);}catch{return c.text('Discordの在籍と市場の権限を確認できません。少し待ってから開き直してください。',503);}
  if(!fresh){await deleteMemberSession(db,session.id);deleteCookie(c,COOKIE,{path:'/marketplace'});return c.text('このサーバーの市場を見られるメンバーだけが利用できます。',403);}
  if(c.req.method==='POST'){const b=await c.req.parseBody();if(!safeEqual(typeof b._csrf==='string'?b._csrf:'',session.csrfToken))return c.text('不正なリクエストです（CSRF）。',403);}
  return handler(c,{session,roles:fresh.roles,member:fresh.member,balance:(await walletOf(db,session.userId)).balance,cfg:d.cfg()});
 };
 /** ログインのあとに開くページ（市場の中だけ） */
 const nextOf=(v:string|undefined)=>v==='/marketplace/seller'?v:'/marketplace';
 app.get('/marketplace/auth',c=>{const state=randomToken();setCookie(c,STATE,state,{...cookie,path:'/casino/auth',maxAge:600});return c.redirect(api.authorizeUrl(state,redirectUri));});
 app.get('/casino/auth/callback',async(c,next)=>{
  const state=getCookie(c,STATE);if(!state||!safeEqual(state,c.req.query('state')??''))return next();
  deleteCookie(c,STATE,{path:'/casino/auth'});
  try{const code=c.req.query('code');if(!code)throw new Error('code missing');const user=await api.me(await api.exchangeCode(code,redirectUri));if(!await access(user.id))return c.html(<MarketAuthPage error="サーバーの市場を見られるメンバーだけが利用できます。"/> ,403);setCookie(c,COOKIE,await createMemberSession(db,user,d.now()),cookie);return c.redirect('/marketplace');}
  catch{return c.html(<MarketAuthPage error="Discord認証を確認できません。少し待ってからログインし直してください。"/>,503);}
 });
 app.get('/marketplace/link/:token',async c=>{const user=await peekLoginLink(db,c.req.param('token'),d.now());return c.html(<MarketAuthPage error={user?undefined:'リンクが期限切れか使用済みです。Discordの市場から開き直してください。'} link={user?{name:user.displayName,action:`/marketplace/link/${c.req.param('token')}${nextOf(c.req.query('next'))!=='/marketplace'?'?next='+encodeURIComponent(nextOf(c.req.query('next'))):''}`}:undefined}/>);});
 app.post('/marketplace/link/:token',async c=>{
  if(c.req.header('origin')&&c.req.header('origin')!==new URL(d.baseUrl).origin)return c.text('不正なリクエストです。',403);
  const user=await useLoginLink(db,c.req.param('token'),d.now());if(!user)return c.text('リンクが期限切れか使用済みです。',400);
  try{if(!await access(user.id))return c.text('市場の閲覧権限が必要です。',403);}catch{return c.text('Discordの確認に失敗しました。市場からリンクを開き直してください。',503);}
  setCookie(c,COOKIE,await createMemberSession(db,{id:user.id,username:user.displayName,displayName:user.displayName,avatarUrl:user.avatarUrl},d.now()),cookie);return c.redirect(nextOf(c.req.query('next')),303);
 });
 app.post('/marketplace/logout',protectedPage(async(c,me)=>{await deleteMemberSession(db,me.session.id);deleteCookie(c,COOKIE,{path:'/marketplace'});return c.redirect('/marketplace',303);}));
 const names=async(ids:string[])=>new Map((ids.length?await db.select({id:members.id,name:members.displayName}).from(members).where(inArray(members.id,[...new Set(ids)])):[]).map(m=>[m.id,m.name]));
 const resourceId=(c:Context)=>{const n=Number(c.req.param('id'));return Number.isSafeInteger(n)&&n>0?n:0;};
 const cursor=(c:Context)=>{const n=Number(c.req.query('before'));return Number.isSafeInteger(n)&&n>0?n:undefined;};
 const escapeLike=(value:string)=>value.replace(/[\\%_]/g,c=>'\\'+c);
 /** 市場Web で写真を付けた出品の番号 */
 const imagesOf=async(ids:number[])=>new Set((ids.length?await db.select({id:marketListingImages.listingId}).from(marketListingImages).where(inArray(marketListingImages.listingId,ids)):[]).map(r=>r.id));
 const age=(category:string,me:MarketMe)=>category!=='call'||me.member.ageGroup==='adult';
 app.get('/marketplace',protectedPage(async(c,me)=>{
  const q=(c.req.query('q')??'').slice(0,60),category=c.req.query('category'),mine=c.req.query('mine')==='1',kind=c.req.query('kind')==='requests'?'requests':'listings';
  const cat=market.isMarketCategory(category)?category:undefined,before=cursor(c);
  let listings=kind==='listings'?await db.select({row:marketListings,name:members.displayName}).from(marketListings).innerJoin(members,eq(members.id,marketListings.sellerId)).where(and(mine?eq(marketListings.sellerId,me.session.userId):eq(marketListings.status,'open'),before?lt(marketListings.id,before):undefined,me.member.ageGroup==='adult'?undefined:ne(marketListings.category,'call'),cat?eq(marketListings.category,cat):undefined,q?ilike(marketListings.title,'%'+escapeLike(q)+'%'):undefined,eq(members.isBot,false),isNull(members.leftAt))).orderBy(desc(marketListings.id)).limit(41):[];
  let requests=kind==='requests'?await db.select({row:marketRequests,name:members.displayName}).from(marketRequests).innerJoin(members,eq(members.id,marketRequests.requesterId)).where(and(mine?eq(marketRequests.requesterId,me.session.userId):eq(marketRequests.status,'open'),before?lt(marketRequests.id,before):undefined,me.member.ageGroup==='adult'?undefined:ne(marketRequests.category,'call'),cat?eq(marketRequests.category,cat):undefined,q?ilike(marketRequests.title,'%'+escapeLike(q)+'%'):undefined,eq(members.isBot,false),isNull(members.leftAt))).orderBy(desc(marketRequests.id)).limit(41):[];
  const rows=kind==='requests'?requests:listings;
  const nextHref=rows.length>40?'/marketplace?'+new URLSearchParams({kind,q,...(cat?{category:cat}:{}),...(mine?{mine:'1'}:{}),before:String(rows[39]!.row.id)}).toString():undefined;
  listings=listings.slice(0,40);requests=requests.slice(0,40);
  return c.html(<MarketListPage images={await imagesOf(listings.map(l=>l.row.id))} me={me} listings={listings} requests={requests} kind={kind} q={q} category={cat} mine={mine} nextHref={nextHref}/>);
 }));
 app.get('/marketplace/new',protectedPage(async(c,me)=>{
  const license=(await market.marketLicenseAccess(db,me.cfg,{id:me.session.userId,roleIds:me.roles},d.now())).allowed;
  const item=license?undefined:await market.marketLicenseItem(db);
  const booster=me.member.boostingSince!==null;
  const shop=item&&(!item.boosterOnly||booster)?{name:item.name,emoji:item.emoji,price:priceOf(item,me.cfg.economy,booster),days:item.durationDays}:undefined;
  return c.html(<MarketCreatePage me={me} request={c.req.query('kind')==='request'} license={license} shop={shop} notice={c.req.query('license')}/>);
 }));
 app.get('/marketplace/listings/:id',protectedPage(async(c,me)=>{
  const listing=await market.getListing(db,resourceId(c));if(!listing||!age(listing.category,me))return c.notFound();
  const offers=await db.select().from(marketOffers).where(and(eq(marketOffers.listingId,listing.id),listing.sellerId===me.session.userId?undefined:eq(marketOffers.buyerId,me.session.userId))).orderBy(desc(marketOffers.id)).limit(25);
  return c.html(<MarketListingPage images={await imagesOf([listing.id])} me={me} listing={listing} offers={offers} names={await names([listing.sellerId,...offers.map(o=>o.buyerId)])} rating={await market.sellerRating(db,listing.sellerId)} reviews={await market.recentReviews(db,listing.sellerId)} active={await market.activeOrders(db,listing.id)} message={c.req.query('msg')==='offer_insufficient'?'買い手の残高が足りないため、この価格提案は見送りになりました。':undefined}/>);
 }));
 app.get('/marketplace/listings/:id/image',protectedPage(async(c,me)=>{
  const listing=await market.getListing(db,resourceId(c));if(!listing||!age(listing.category,me))return c.notFound();
  const [img]=await db.select().from(marketListingImages).where(eq(marketListingImages.listingId,listing.id));if(!img)return c.notFound();
  return c.body(new Uint8Array(img.data),200,{'content-type':img.contentType,'x-content-type-options':'nosniff','cache-control':'private, max-age=3600'});
 }));
 app.get('/marketplace/requests/:id',protectedPage(async(c,me)=>{
  const request=await market.getRequest(db,resourceId(c));if(!request||!age(request.category,me))return c.notFound();
  const bids=await db.select().from(marketBids).where(and(eq(marketBids.requestId,request.id),request.requesterId===me.session.userId?undefined:eq(marketBids.sellerId,me.session.userId))).orderBy(desc(marketBids.id)).limit(25);
  return c.html(<MarketRequestPage me={me} request={request} bids={bids} names={await names([request.requesterId,...bids.map(b=>b.sellerId)])} license={(await market.marketLicenseAccess(db,me.cfg,{id:me.session.userId,roleIds:me.roles},d.now())).allowed}/>);
 }));
 app.get('/marketplace/orders',protectedPage(async(c,me)=>{const before=cursor(c);const all=await db.select().from(marketOrders).where(and(or(eq(marketOrders.buyerId,me.session.userId),eq(marketOrders.sellerId,me.session.userId)),before?lt(marketOrders.id,before):undefined)).orderBy(desc(marketOrders.id)).limit(41);const nextHref=all.length>40?'/marketplace/orders?before='+all[39]!.id:undefined;const orders=all.slice(0,40);const titles=new Map(await Promise.all(orders.map(async o=>[o.id,(await market.orderInfo(db,o)).title] as const)));return c.html(<MarketOrdersPage me={me} orders={orders} titles={titles} nextHref={nextHref}/>);}));
 app.get('/marketplace/orders/:id',protectedPage(async(c,me)=>{const order=await market.getOrder(db,resourceId(c));if(!order||(order.buyerId!==me.session.userId&&order.sellerId!==me.session.userId))return c.notFound();return c.html(<MarketOrderPage me={me} order={order} info={await market.orderInfo(db,order)} names={await names([order.buyerId,order.sellerId])} now={d.now()}/>);}));
 app.get('/marketplace/seller',protectedPage(async(c,me)=>{
  const id=me.session.userId;
  const listings=await db.select().from(marketListings).where(and(eq(marketListings.sellerId,id),eq(marketListings.status,'open'))).orderBy(desc(marketListings.id)).limit(40);
  const offers=await db.select().from(marketOffers).where(and(eq(marketOffers.sellerId,id),eq(marketOffers.status,'pending'))).orderBy(desc(marketOffers.id)).limit(40);
  const orders=await db.select().from(marketOrders).where(and(eq(marketOrders.sellerId,id),inArray(marketOrders.status,['paid','disputed']))).orderBy(desc(marketOrders.id)).limit(40);
  const [sum]=await db.select({v:sql<number>`coalesce(sum(${marketOrders.price}),0)::float8`}).from(marketOrders).where(and(eq(marketOrders.sellerId,id),eq(marketOrders.status,'completed')));
  const titles=new Map(await Promise.all(orders.map(async o=>[o.id,(await market.orderInfo(db,o)).title] as const)));
  return c.html(<MarketSellerPage me={me} listings={listings} offers={offers} orders={orders} titles={titles} names={await names([...offers.map(o=>o.buyerId),...orders.map(o=>o.buyerId)])} earned={sum?.v??0}/>);
 }));
 // 🏪 開業権利を市場の Web で受ける（授与所と同じ値段・同じ記録。ロールを付けられなければ銭を戻す）
 app.post('/marketplace/license',protectedPage(async(c,me)=>{
  const back=(msg:string)=>c.redirect('/marketplace/new?license='+msg,303);
  if((await market.marketLicenseAccess(db,me.cfg,{id:me.session.userId,roleIds:me.roles},d.now())).allowed)return back('owned');
  const item=await market.marketLicenseItem(db);
  if(!item)return back('unavailable');
  const booster=me.member.boostingSince!==null;
  if(item.boosterOnly&&!booster)return back('booster');
  const b=await c.req.parseBody();const price=priceOf(item,me.cfg.economy,booster);
  if(Number(b.quote)!==price||b.confirm!=='yes')return back('changed');
  const r=await buyRole(db,item,me.session.userId,d.now(),price);
  if(r.status==='insufficient')return back('poor');
  if(r.status==='owned')return back('owned');
  if(r.status!=='ok')return back('unavailable');
  try{await d.discord.addRole(me.cfg.guildId,me.session.userId,item.roleId!,`授与品: ${item.name}（市場のWeb）`);}
  catch{await refund(db,r.purchase);return back('role_failed');}
  return back('ok');
 }));
 app.post('/marketplace/actions/:action/:id',protectedPage(async(c,me)=>{
  const raw=await c.req.parseBody();const b=Object.fromEntries(Object.entries(raw).filter(([,v])=>typeof v==='string')) as Record<string,string>;
  const id=resourceId(c);if(!Number.isSafeInteger(id)||id<0)return c.text('対象を確認してください。',400);
  // 📷 出品の見本の写真（出品するときだけ。8MB まで・画像だけ）
  const file=c.req.param('action')==='listing-new'&&raw.image instanceof File&&raw.image.size>0?raw.image:undefined;
  let image:{type:string;data:Uint8Array}|undefined;
  if(file){if(file.size>MARKET_IMAGE_MAX)return c.html(<MarketAuthPage error="写真は8MBまでにしてください。" back="/marketplace/new"/>,400);const data=new Uint8Array(await file.arrayBuffer());const kind=detectImage(data);if(!kind)return c.html(<MarketAuthPage error="写真は png・jpg・gif・webp にしてください。" back="/marketplace/new"/>,400);image={type:kind.type,data};}
  try{
   return c.redirect(await executeMarketWeb(db,me.cfg,{id:me.session.userId,roleIds:me.roles},c.req.param('action')!,id,b,d.now(),image),303);
  }
  catch(err){if(err instanceof MarketWebError)return c.html(<MarketAuthPage error={err.message} back="/marketplace"/>,400);throw err;}
 }));
}

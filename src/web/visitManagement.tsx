import type {Context,Hono} from 'hono';
import type {Db} from '../db/client.js';
import {eq} from 'drizzle-orm';
import {visitDesigns,type AdminSession} from '../db/schema.js';
import {createStaffDesign,grantDesign,revokeDesign,staffDesigns,designMetadata,loadWorkshopSettings,reviewDesign,saveWorkshopSettings} from '../services/visitWorkshop.js';
import {visitRevenue} from '../services/visitRevenue.js';
import {VisitError} from '../services/visitErrors.js';
import {monthKey,monthOf,parseMonth} from '../services/castRank.js';
import {namesOf} from '../services/members.js';
import {fulfillOrder,listOrders,orderImage,orderImageIds,refuseOrder} from '../services/visitOrders.js';
import {VisitManagementPage} from './views/visitManagement.js';
/** /shopのログイン/CSRF/宮司ガードを登録した後に呼ぶ。各処理でも宮司を確認する。 */
export function mountVisitManagement(app:Hono<any>,d:{db:Db;now:()=>Date;currency:()=>string}){
 const protect=(fn:(c:Context,s:AdminSession)=>Response|Promise<Response>)=>async(c:Context)=>{const s=c.get('session') as AdminSession|undefined;if(s?.level!=='guji')return c.text('宮司のみできる操作です。',403);c.header('Cache-Control','private, no-store');return fn(c,s);};
 app.get('/shop/visit',protect(async(c,s)=>{
  const start=parseMonth(c.req.query('month'))??monthOf(d.now()),end=monthOf(start,1);
  const [monthly,total,settings,designs,staff]=await Promise.all([visitRevenue(d.db,start,end),visitRevenue(d.db),loadWorkshopSettings(d.db),designMetadata(d.db),staffDesigns(d.db)]);
  const orders=await listOrders(d.db);const orderImages=await orderImageIds(d.db,orders.map(o=>o.id));
  return c.html(<VisitManagementPage session={s} month={monthKey(start)} monthly={monthly} total={total} settings={settings} designs={designs} staff={staff} orders={orders} orderImages={orderImages} names={await namesOf(d.db,[...designs.map(r=>r.creatorId),...staff.flatMap(r=>r.holders),...orders.map(o=>o.memberId)])} currency={d.currency()} message={({saved:'保存しました。',granted:'渡しました。',revoked:'取り上げました。',created:'運営の作品を作りました。',done:'作って渡しました。',refused:'お断りして、銭を返しました。'} as Record<string,string>)[c.req.query('msg')??'']}/>);
 }));
 app.post('/shop/visit/settings',protect(async(c,s)=>{const b=await c.req.parseBody();try{await saveWorkshopSettings(d.db,{enabled:b.enabled==='yes',licensePrice:Number(b.licensePrice)},s.userId);return c.redirect('/shop/visit?msg=saved',303);}catch(e){if(e instanceof VisitError)return c.text(e.message,400);throw e;}}));
 app.get('/shop/visit/designs/:file',protect(async c=>{const file=c.req.param('file')??'';if(!file.endsWith('.png'))return c.notFound();const [row]=await d.db.select({data:visitDesigns.data,status:visitDesigns.status}).from(visitDesigns).where(eq(visitDesigns.id,file.slice(0,-4)));if(!row||row.status==='private')return c.notFound();c.header('X-Content-Type-Options','nosniff');return c.body(new Uint8Array(row.data),200,{'Content-Type':'image/png'});}));
 app.post('/shop/visit/designs/:id/review',protect(async(c,s)=>{const b=await c.req.parseBody();if(!['approve','reject','withdraw'].includes(String(b.decision)))return c.text('操作を選んでください。',400);try{await reviewDesign(d.db,c.req.param('id')??'',s.userId,b.decision as 'approve'|'reject'|'withdraw',typeof b.note==='string'?b.note:'',d.now());return c.redirect('/shop/visit?msg=saved',303);}catch(e){if(e instanceof VisitError)return c.text(e.message,400);throw e;}}));
 const err=(c:Context,e:unknown)=>{if(e instanceof VisitError)return c.text(e.message,400);throw e;};
 app.post('/shop/visit/staff-designs',protect(async(c,s)=>{const b=await c.req.parseBody();const file=b.image;if(!(file instanceof File)||!file.size||file.size>8*1024*1024)return c.text('8MBまでの画像を選んでください。',400);try{await createStaffDesign(d.db,s.userId,{kind:String(b.kind??''),name:String(b.name??''),bytes:new Uint8Array(await file.arrayBuffer())},d.now());return c.redirect('/shop/visit?msg=created#staff-designs',303);}catch(e){return err(c,e);}}));
 app.post('/shop/visit/staff-designs/:id/grant',protect(async(c,s)=>{const b=await c.req.parseBody();const ids=String(b.memberIds??'').split(/[\s,、]+/).filter(Boolean);if(!ids.length||ids.some(x=>!/^\d{17,20}$/.test(x)))return c.text('メンバーIDを入れてください。',400);try{for(const id of ids)await grantDesign(d.db,c.req.param('id')??'',id,s.userId,d.now());return c.redirect('/shop/visit?msg=granted#staff-designs',303);}catch(e){return err(c,e);}}));
 app.post('/shop/visit/staff-designs/:id/revoke',protect(async(c,s)=>{const b=await c.req.parseBody();try{await revokeDesign(d.db,c.req.param('id')??'',String(b.memberId??''),s.userId);return c.redirect('/shop/visit?msg=revoked#staff-designs',303);}catch(e){return err(c,e);}}));
 app.get('/shop/visit/order-images/:id',protect(async c=>{const row=await orderImage(d.db,Number(c.req.param('id')));if(!row)return c.notFound();c.header('X-Content-Type-Options','nosniff');return c.body(new Uint8Array(row.data),200,{'Content-Type':row.contentType});}));
 const orderId=(c:Context)=>Number(c.req.param('id'));
 app.post('/shop/visit/orders/:id/done',protect(async(c,s)=>{const b=await c.req.parseBody();const file=b.image;if(!(file instanceof File)||!file.size||file.size>8*1024*1024)return c.text('8MBまでの画像を選んでください。',400);try{await fulfillOrder(d.db,orderId(c),s.userId,{name:String(b.name??''),bytes:new Uint8Array(await file.arrayBuffer())},d.now());return c.redirect('/shop/visit?msg=done#visit-orders',303);}catch(e){return err(c,e);}}));
 app.post('/shop/visit/orders/:id/refuse',protect(async(c,s)=>{const b=await c.req.parseBody();try{await refuseOrder(d.db,orderId(c),s.userId,String(b.note??''),d.now());return c.redirect('/shop/visit?msg=refused#visit-orders',303);}catch(e){return err(c,e);}}));
}

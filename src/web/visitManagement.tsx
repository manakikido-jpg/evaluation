import type {Context,Hono} from 'hono';
import type {Db} from '../db/client.js';
import {eq} from 'drizzle-orm';
import {visitDesigns,type AdminSession} from '../db/schema.js';
import {designMetadata,loadWorkshopSettings,reviewDesign,saveWorkshopSettings} from '../services/visitWorkshop.js';
import {visitRevenue} from '../services/visitRevenue.js';
import {VisitError} from '../services/visitErrors.js';
import {monthKey,monthOf,parseMonth} from '../services/castRank.js';
import {namesOf} from '../services/members.js';
import {VisitManagementPage} from './views/visitManagement.js';
/** /shopのログイン/CSRF/宮司ガードを登録した後に呼ぶ。各処理でも宮司を確認する。 */
export function mountVisitManagement(app:Hono<any>,d:{db:Db;now:()=>Date;currency:()=>string}){
 const protect=(fn:(c:Context,s:AdminSession)=>Response|Promise<Response>)=>async(c:Context)=>{const s=c.get('session') as AdminSession|undefined;if(s?.level!=='guji')return c.text('宮司のみできる操作です。',403);c.header('Cache-Control','private, no-store');return fn(c,s);};
 app.get('/shop/visit',protect(async(c,s)=>{
  const start=parseMonth(c.req.query('month'))??monthOf(d.now()),end=monthOf(start,1);
  const [monthly,total,settings,designs]=await Promise.all([visitRevenue(d.db,start,end),visitRevenue(d.db),loadWorkshopSettings(d.db),designMetadata(d.db)]);
  return c.html(<VisitManagementPage session={s} month={monthKey(start)} monthly={monthly} total={total} settings={settings} designs={designs} names={await namesOf(d.db,designs.map(r=>r.creatorId))} currency={d.currency()} message={c.req.query('msg')==='saved'?'保存しました。':undefined}/>);
 }));
 app.post('/shop/visit/settings',protect(async(c,s)=>{const b=await c.req.parseBody();try{await saveWorkshopSettings(d.db,{enabled:b.enabled==='yes',licensePrice:Number(b.licensePrice)},s.userId);return c.redirect('/shop/visit?msg=saved',303);}catch(e){if(e instanceof VisitError)return c.text(e.message,400);throw e;}}));
 app.get('/shop/visit/designs/:file',protect(async c=>{const file=c.req.param('file')??'';if(!file.endsWith('.png'))return c.notFound();const [row]=await d.db.select({data:visitDesigns.data,status:visitDesigns.status}).from(visitDesigns).where(eq(visitDesigns.id,file.slice(0,-4)));if(!row||row.status==='private')return c.notFound();c.header('X-Content-Type-Options','nosniff');return c.body(new Uint8Array(row.data),200,{'Content-Type':'image/png'});}));
 app.post('/shop/visit/designs/:id/review',protect(async(c,s)=>{const b=await c.req.parseBody();if(!['approve','reject','withdraw'].includes(String(b.decision)))return c.text('操作を選んでください。',400);try{await reviewDesign(d.db,c.req.param('id')??'',s.userId,b.decision as 'approve'|'reject'|'withdraw',typeof b.note==='string'?b.note:'',d.now());return c.redirect('/shop/visit?msg=saved',303);}catch(e){if(e instanceof VisitError)return c.text(e.message,400);throw e;}}));
}

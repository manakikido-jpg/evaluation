import {experienceSales,setExperienceSales,experienceTotals} from '../services/casino/kiseki/experience.js';
import {KisekiExperienceAdmin} from './views/kisekiExperience.js';
import type {Hono,Context} from 'hono';
import type {Db} from '../db/client.js';
import type {AdminSession} from '../db/schema.js';
import {readTrial,writeTrial,trialView,KisekiError} from '../services/casino/kiseki/trial.js';
import {KisekiTrial,KisekiGuide,PATH} from './views/kisekiTrial.js';
type Env={Variables:{session:AdminSession}};
export function mountKisekiTrial(app:Hono<Env>,db:Db,now:()=>Date){
 const allowed=(c:Context<Env>)=>{const s=c.get('session');return ['guji','shinshoku'].includes(s.level)&&(!s.pages||s.pages.includes('economy'));};
 const adminAllowed=(c:Context<Env>)=>c.get('session').level==='guji'&&allowed(c);
 app.get('/economy/kiseki-experience',async c=>{if(!adminAllowed(c))return c.text('経済のページ権限がある宮司だけ操作できます。',403);c.header('Cache-Control','private, no-store');return c.html(<KisekiExperienceAdmin session={c.get('session')} enabled={await experienceSales(db)} totals={await experienceTotals(db)}/>);});
 app.post('/economy/kiseki-experience',async c=>{if(!adminAllowed(c))return c.text('経済のページ権限がある宮司だけ操作できます。',403);const b=await c.req.parseBody();if(!['0','1'].includes(String(b.enabled)))return c.text('販売状態を選び直してください。',400);await setExperienceSales(db,c.get('session').userId,b.enabled==='1',now());return c.redirect('/economy/kiseki-experience',303);});
 app.get(PATH+'/guide',c=>{if(!allowed(c))return c.text('経済のページ権限がある運営だけ確認できます。',403);c.header('Cache-Control','private, no-store');return c.html(<KisekiGuide session={c.get('session')}/>);});
 app.get(PATH,async c=>{if(!allowed(c))return c.text('経済のページ権限がある運営だけ確認できます。',403);c.header('Cache-Control','private, no-store');const s=c.get('session');return c.html(<KisekiTrial m={trialView(await readTrial(db,now()),s.userId)} session={s}/>);});
 app.post(PATH,async c=>{if(!allowed(c))return c.text('経済のページ権限がある運営だけ確認できます。',403);c.header('Cache-Control','private, no-store');const b=await c.req.parseBody(),s=c.get('session');
  try{await writeTrial(db,s.userId,s.username,{action:String(b.action??''),machine:Number(b.machine),revision:Number(b.revision),index:Number(b.index),setting:Number(b.setting),scenario:String(b.scenario??''),control:String(b.control??''),position:b.position===undefined?undefined:/^(?:[0-9]|1[0-9])$/.test(String(b.position))?Number(b.position):NaN},now());
   if(c.req.header('X-Gaisen-Update')==='1')return c.html(<KisekiTrial m={trialView(await readTrial(db,now()),s.userId)} session={s}/>);
   return c.redirect(PATH,303);
  }catch(e){if(!(e instanceof KisekiError))throw e;return c.html(<KisekiTrial m={trialView(await readTrial(db,now()),s.userId)} session={s} error={e.message}/>,e.status);}
 });
}

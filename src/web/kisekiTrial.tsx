import type {Hono,Context} from 'hono';
import type {Db} from '../db/client.js';
import type {AdminSession} from '../db/schema.js';
import {readTrial,writeTrial,trialView,KisekiError} from '../services/casino/kiseki/trial.js';
import {KisekiTrial,KisekiGuide,PATH} from './views/kisekiTrial.js';
type Env={Variables:{session:AdminSession}};
export function mountKisekiTrial(app:Hono<Env>,db:Db,now:()=>Date){
 const allowed=(c:Context<Env>)=>{const s=c.get('session');return ['guji','shinshoku'].includes(s.level)&&(!s.pages||s.pages.includes('economy'));};
 app.get(PATH+'/guide',c=>{if(!allowed(c))return c.text('経済のページ権限がある運営だけ確認できます。',403);c.header('Cache-Control','private, no-store');return c.html(<KisekiGuide session={c.get('session')}/>);});
 app.get(PATH,async c=>{if(!allowed(c))return c.text('経済のページ権限がある運営だけ確認できます。',403);c.header('Cache-Control','private, no-store');const s=c.get('session');return c.html(<KisekiTrial m={trialView(await readTrial(db,now()),s.userId)} session={s}/>);});
 app.post(PATH,async c=>{if(!allowed(c))return c.text('経済のページ権限がある運営だけ確認できます。',403);c.header('Cache-Control','private, no-store');const b=await c.req.parseBody(),s=c.get('session');
  try{await writeTrial(db,s.userId,s.username,{action:String(b.action??''),machine:Number(b.machine),revision:Number(b.revision),index:Number(b.index),setting:Number(b.setting),scenario:String(b.scenario??'')},now());
   if(c.req.header('X-Gaisen-Update')==='1')return c.html(<KisekiTrial m={trialView(await readTrial(db,now()),s.userId)} session={s}/>);
   return c.redirect(PATH,303);
  }catch(e){if(!(e instanceof KisekiError))throw e;return c.html(<KisekiTrial m={trialView(await readTrial(db,now()),s.userId)} session={s} error={e.message}/>,e.status);}
 });
}

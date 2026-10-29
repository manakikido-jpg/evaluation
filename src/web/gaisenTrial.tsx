import type {Context,Hono} from 'hono';
import type {Db} from '../db/client.js';
import type {AdminSession} from '../db/schema.js';
import {GaisenTrial} from './views/gaisenTrial.js';
import {readTrial,trialView,writeTrial,TrialError} from '../services/casino/gaisen/trial.js';
import type {RuleVersion} from '../services/casino/gaisen/engine.js';
type Env={Variables:{session:AdminSession}};
/** 呼び出し側で運営認証とPOSTのCSRFを通す。 */
export function mountGaisenTrial(app:Hono<Env>,db:Db,now:()=>Date,version:RuleVersion='trial-1'){
 const PATH=version==='trial-2'?'/economy/gaisen-trial-v2':'/economy/gaisen-trial';
 const allowed=(c:Context<Env>)=>{const s=c.get('session');return ['guji','shinshoku'].includes(s.level)&&(!s.pages||s.pages.includes('economy'));};
 app.get(PATH,async c=>{if(!allowed(c))return c.text('経済のページ権限がある運営だけ確認できます。',403);c.header('Cache-Control','private, no-store');const s=c.get('session');return c.html(<GaisenTrial m={trialView(await readTrial(db,now(),version),s.userId)} session={s} version={version}/>);});
 app.post(PATH,async c=>{
  if(!allowed(c))return c.text('経済のページ権限がある運営だけ確認できます。',403);c.header('Cache-Control','private, no-store');
  const b=await c.req.parseBody(),s=c.get('session');
  try{await writeTrial(db,s.userId,s.username,{action:String(b.action??''),machine:Number(b.machine),revision:Number(b.revision),index:Number(b.index),setting:Number(b.setting),scenario:String(b.scenario??'')},now(),undefined,version);return c.redirect(PATH,303);}
  catch(e){if(!(e instanceof TrialError))throw e;return c.html(<GaisenTrial m={trialView(await readTrial(db,now(),version),s.userId)} session={s} version={version} error={e.message}/>,e.status);}
 });
}

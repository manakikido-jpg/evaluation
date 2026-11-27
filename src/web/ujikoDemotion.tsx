import type {Hono,Context} from 'hono';
import {eq,inArray} from 'drizzle-orm';
import type {Db} from '../db/client.js';
import {members,type AdminSession} from '../db/schema.js';
import {adminLevelOf,type GuildConfig} from '../config.js';
import type {DiscordApi} from './discordApi.js';
import type {DiscordActions} from '../lib/discordRest.js';
import {Layout} from './views/layout.js';
import * as op from '../services/ujikoDemotion.js';
const BASE='/evaluation/ujiko-demotion';
export function mountUjikoDemotion(app:Hono<any>,d:{db:Db;cfg:()=>GuildConfig;api:DiscordApi;discord:DiscordActions;now:()=>Date}){
 const {db}=d;
 const secure=(fn:(c:Context,s:AdminSession)=>Promise<Response>)=>async(c:Context)=>{
  const s=c.get('session') as AdminSession;if(!s)return c.text('ログインしてください。',401);
  let roles:string[]|null;try{roles=await d.api.memberRoles(d.cfg().guildId,s.userId);}catch{return c.text('権限を確認できません。時間をおいて再度お試しください。',503);}
  if(!roles||adminLevelOf(d.cfg(),roles)!=='guji')return c.text('宮司だけが操作できます。',403);
  try{return await fn(c,s);}catch(e){if(e instanceof op.DemotionError)return c.html(<Layout session={s} title="氏子の見直し" nav="evaluation"><h1>氏子の見直し</h1><p role="alert">{e.message}</p><a href={BASE}>一覧へ戻る</a></Layout>,400);throw e;}
 };
 const csrf=(s:AdminSession)=><input type="hidden" name="_csrf" value={s.csrfToken}/>;
 app.get(BASE,secure(async(c,s)=>{
  const [jobs,holds]=await Promise.all([op.demotionJobs(db),op.promotionHolds(db)]);
  return c.html(<Layout session={s} title="氏子をリストで見直す" nav="evaluation"><h1>氏子をリストで見直す</h1><p><a href="/evaluation">評価へ戻る</a></p><p>現在の最上位が氏子の人だけ、参拝者へ変更します。ご縁・絵馬・銭・ほかのロールは残します。運営が解除するまで自動昇格は保留します。</p><section class="card"><form method="post" action={`${BASE}/preview`}>{csrf(s)}<label>DiscordのユーザーID（1人1行・200人まで。メンションも使えます）<textarea name="ids" required rows={10} maxlength={20000}/></label><label>変更の理由<input name="reason" required maxlength={500}/></label><button>対象を確認する（まだ変更しません）</button></form></section>
  <section class="card"><h2>確認・実行の履歴</h2>{jobs.map(j=><p><a href={`${BASE}/${j.id}`}>{new Date(j.at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}・{({preview:'確認待ち',queued:'実行待ち',running:'処理中',finished:'終了'})[j.state]}・{j.entries.length}人</a></p>)}</section>
  <section class="card"><h2>自動昇格を保留している人（{holds.length}人）</h2><p>解除してもすぐには氏子になりません。次の自動判定から、通常の昇格条件で確認します。</p>{holds.map(h=><details><summary>{h.id}・{h.reason}</summary><form method="post" action={`${BASE}/release`}>{csrf(s)}<input type="hidden" name="memberId" value={h.id}/><label>解除の理由<input name="reason" required maxlength={500}/></label><label><input type="checkbox" name="confirm" value="yes" required/>自動昇格の保留を解除する対象を確認しました</label><button>この人の保留を解除する</button></form></details>)}</section></Layout>);
 }));
 app.post(`${BASE}/preview`,secure(async(c,s)=>{
  const b=await c.req.parseBody(),parsed=op.parseDemotionIds(String(b.ids??''));
  const people=await db.select().from(members).where(inArray(members.id,parsed.ids)),map=new Map(people.map(m=>[m.id,m]));
  const roles=await d.discord.guildRoles(d.cfg().guildId);const adminRoles=new Set(roles.filter(r=>(BigInt(r.permissions??'0')&8n)!==0n).map(r=>r.id));
  const j=await op.previewDemotion(db,d.cfg(),parsed.ids,s.userId,String(b.reason??''),{fetch:async id=>{const r=await d.api.memberRoles(d.cfg().guildId,id);const m=map.get(id);return r?{id,name:m?.displayName??id,roles:r,bot:m?.isBot??false,protected:r.some(x=>adminRoles.has(x))}:null;}},d.now());
  return c.redirect(`${BASE}/${j.id}`,303);
 }));
 app.get(`${BASE}/:id`,secure(async(c,s)=>{
  const j=await op.demotionJob(db,(c.req.param('id')??''));if(!j)return c.notFound();
  const count=j.entries.filter(e=>e.eligible).length;
  return c.html(<Layout session={s} title="氏子の見直し・対象確認" nav="evaluation"><h1>氏子の見直し・対象確認</h1><p><a href={BASE}>一覧へ戻る</a>・<a href={`${BASE}/${j.id}`}>結果を更新する</a></p><p>理由：{j.reason}</p><p>状態：{({preview:'確認待ち',queued:'実行待ち',running:'処理中',finished:'終了'})[j.state]}。対象{count}人、成功{j.entries.filter(e=>e.status==='done').length}人、失敗{j.entries.filter(e=>e.status==='failed').length}人。</p><p>BOTが少しずつ処理します。実行時にも在籍・最新の役職を確認し、変わっていた人は除外します。</p><div class="table-wrap"><table><thead><tr><th>対象</th><th>ID</th><th>結果・確認内容</th></tr></thead><tbody>{j.entries.map(e=><tr><td>{e.name}</td><td>{e.id}</td><td>{e.note}</td></tr>)}</tbody></table></div>
  {j.state==='preview'&&j.by===s.userId&&<form method="post" action={`${BASE}/${j.id}/apply`}>{csrf(s)}<p>対象の氏子を参拝者に戻し、自動昇格を保留します。ほかの人やポイントは変更しません。</p><label><input type="checkbox" name="confirm" value="yes" required/>対象者と変更内容を確認しました</label><button disabled={!count}>確認した{count}人を変更する</button></form>}
  {j.state==='finished'&&j.entries.some(e=>e.status==='failed')&&<form method="post" action={`${BASE}/${j.id}/retry`}>{csrf(s)}<button>失敗した人だけ再試行する</button></form>}</Layout>);
 }));
 app.post(`${BASE}/:id/apply`,secure(async(c,s)=>{const b=await c.req.parseBody();if(b.confirm!=='yes')throw new op.DemotionError('対象と内容を確認してチェックしてください。');await op.queueDemotion(db,(c.req.param('id')??''),s.userId,d.now());return c.redirect(`${BASE}/${(c.req.param('id')??'')}`,303);}));
 app.post(`${BASE}/:id/retry`,secure(async(c,s)=>{await op.retryDemotion(db,(c.req.param('id')??''),s.userId,d.now());return c.redirect(`${BASE}/${(c.req.param('id')??'')}`,303);}));
 app.post(`${BASE}/release`,secure(async(c,s)=>{const b=await c.req.parseBody();if(b.confirm!=='yes'||!/^\d{17,20}$/.test(String(b.memberId??'')))throw new op.DemotionError('対象を確認してください。');await op.releasePromotionHold(db,String(b.memberId),s.userId,String(b.reason??''),d.now());return c.redirect(BASE,303);}));
}

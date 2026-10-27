import {KeibaTestPage} from './keibaTest.js';
import {balanceScenarios} from '../services/casino/keibaBalance.js';
import type {GuildConfig} from '../config.js';
import type {Hono,Context} from 'hono';
import type {Db} from '../db/client.js';
import type {AdminSession} from '../db/schema.js';
import {Layout} from './views/layout.js';
import {assetUrl} from './assets.js';
import {EVENT_KINDS,events,saveEvent,cancelEvent} from '../services/casino/keibaEvents.js';
import {KB_DISTANCES} from '../services/casino/keiba.js';
import {KB_OUTFIT_COLORS} from '../services/casino/keibaOutfit.js';
import {audit} from '../services/audit.js';
/** requireAdmin/requireCsrfを登録してから呼ぶ。大会の管理は宮司だけ。 */
export function mountKeibaAdmin(app:Hono<any>,d:{db:Db;now:()=>Date;cfg:()=>GuildConfig}){
 app.get('/economy/keiba-test', (c) => {
   const session = c.get('session') as AdminSession | undefined;
   if (!session || !['guji', 'shinshoku'].includes(session.level) || session.pages && !session.pages.includes('economy')) return c.text('経済のページ権限がある運営だけ確認できます。', 403);
   c.header('Cache-Control', 'private, no-store');
   return c.html(<KeibaTestPage session={session} cfg={d.cfg()} now={d.now()} phase={c.req.query('phase')} follow={c.req.query('follow')}/>);
 });
 const guard=(fn:(c:Context,s:AdminSession)=>Response|Promise<Response>)=>async(c:Context)=>{const s=c.get('session') as AdminSession|undefined;if(s?.level!=='guji')return c.text('宮司だけ変更できます。',403);c.header('Cache-Control','private, no-store');return fn(c,s);};
 app.get('/keiba-events',guard(async(c,s)=>{
  const all=await events(d.db),old=all.find(e=>e.id===Number(c.req.query('edit')));
  const date=(v:Date|undefined)=>v?new Date(v.getTime()+9*3600000).toISOString().slice(0,16):'';
  return c.html(<Layout title="競馬の大会管理" nav="casino" session={s}><link rel="stylesheet" href={assetUrl('keiba-club.css')}/><div class="kc-admin"><h1>🏆 競馬の大会管理</h1><p>時刻は日本時間。開始後・出走馬確定後は編集できません。新しい銭の報酬はありません。単発の大会は10分前から出走馬を確定し、4頭未満なら発走しません。最大8頭、馬ID順です。既存の賞金設定を使います。</p><p><a href="/economy/casino">カジノ管理へ戻る</a></p>{c.req.query('saved')&&<p role="status">{c.req.query('saved')==='1'?'保存しました。':'保存できませんでした。日時・条件・入力を確認してください。'}</p>}
 <form method="post" action="/keiba-events/save"><input type="hidden" name="_csrf" value={s.csrfToken}/><input type="hidden" name="id" value={old?.id??''}/><label>大会名<input name="name" maxlength={30} value={old?.name??''} required/></label><label>種類<select name="kind">{Object.entries(EVENT_KINDS).map(([k,v])=><option value={k} selected={old?.kind===k}>{v}</option>)}</select></label><label>開始（日本時間）<input name="startsAt" type="datetime-local" value={date(old?.startsAt)} required/></label><label>終了（日本時間・最大366日）<input name="endsAt" type="datetime-local" value={date(old?.endsAt)} required/></label><label>対象距離<select name="dist">{KB_DISTANCES.map(n=><option value={n} selected={(old?.rules.dist??1600)===n}>{n}m</option>)}</select></label><label>対象馬場<select name="surface">{[[-1,'どちらも'],[0,'芝'],[1,'ダート']].map(([v,l])=><option value={v} selected={(old?.rules.surface??-1)===v}>{l}</option>)}</select></label><label>登録・発走時の出走回数上限<input name="maxStarts" type="number" min={0} max={100000} value={old?.rules.maxStarts??100000} required/></label><label>最低勝数<input name="minWins" type="number" min={0} max={10000} value={old?.rules.minWins??0} required/></label><label>最大勝数<input name="maxWins" type="number" min={0} max={10000} value={old?.rules.maxWins??10000} required/></label><label>1〜8着の得点（カンマ区切り、各0〜100）<input name="points" value={old?.rules.points.join(',')??'10,7,5,3,2,1,0,0'} required/></label><label>記念称号<input name="rewardTitle" maxlength={30} value={old?.rules.rewardTitle??''} required/></label><label>記念の勝負服の色<select name="rewardColor">{Object.entries(KB_OUTFIT_COLORS).map(([v,l])=><option value={v} selected={old?.rules.rewardColor===v}>{l}</option>)}</select></label><label>何位まで報酬を渡すか（同点含む）<input name="rewardPlaces" type="number" min={1} max={100} value={old?.rules.rewardPlaces??3} required/></label><button>大会を保存する</button></form>
 <h2>現在の賞金設定での収支試算</h2><p>固定の新馬1600mレース。馬主の日額枠は未使用、全馬を同じ馬主が所有し、共同所有の場合は2人で半分ずつ持つ前提です。毎回同じ条件の試算で、実際の収益を保証しません。実際の銭・馬・レースは動きません。差引は投票額−馬券払戻−馬主配当です。</p><table><thead><tr><th>条件</th><th>投票</th><th>馬券払戻</th><th>馬主配当</th><th>差引</th></tr></thead><tbody>{balanceScenarios(d.cfg()).map(r=><tr><td>{r.name}</td><td>{r.bet}</td><td>{r.betPaid}</td><td>{r.ownerPaid}</td><td>{r.net}</td></tr>)}</tbody></table><p>料金・保証額・手数料は既存の設定を維持しています。変更する場合は試算を確認して決めます。</p><h2>設定済みの大会</h2><ul>{all.map(e=><li>{e.name} {e.startsAt.toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})} {e.cancelled?'中止':''} <a href={`/keiba-events?edit=${e.id}`}>編集</a><form method="post" action={`/keiba-events/${e.id}/cancel`}><input type="hidden" name="_csrf" value={s.csrfToken}/><button>開始・出走確定前に中止する</button></form></li>)}</ul></div></Layout>);
 }));
 app.post('/keiba-events/save',guard(async(c,s)=>{const b=await c.req.parseBody();const rules={dist:Number(b.dist),surface:Number(b.surface),maxStarts:Number(b.maxStarts),minWins:Number(b.minWins),maxWins:Number(b.maxWins),points:String(b.points??'').split(',').map(Number),rewardTitle:String(b.rewardTitle??''),rewardColor:String(b.rewardColor??''),rewardPlaces:Number(b.rewardPlaces)};const date=(v:unknown)=>/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(v))?new Date(String(v)+':00+09:00'):new Date(NaN);const id=b.id?Number(b.id):undefined;const ok=await saveEvent(d.db,{name:b.name,kind:b.kind,startsAt:date(b.startsAt),endsAt:date(b.endsAt),rules},s.userId,d.now(),id);if(ok)await audit(d.db,{actorId:s.userId,action:'keiba.event.save',detail:{eventId:id,name:b.name},via:'web'});return c.redirect('/keiba-events?saved='+(ok?1:0),303);}));
 app.post('/keiba-events/:id/cancel',guard(async(c,s)=>{const id=Number(c.req.param('id')),ok=await cancelEvent(d.db,id,d.now());if(ok)await audit(d.db,{actorId:s.userId,action:'keiba.event.cancel',detail:{eventId:id},via:'web'});return c.redirect('/keiba-events?saved='+(ok?1:0),303);}));
}

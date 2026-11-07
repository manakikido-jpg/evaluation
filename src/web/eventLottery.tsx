import type {Hono} from 'hono';
import {randomUUID} from 'node:crypto';
import type {Db} from '../db/client.js';
import type {AdminSession} from '../db/schema.js';
import type {GuildChannel} from '../lib/discordRest.js';
import {Layout} from './views/layout.js';
import {assetUrl} from './assets.js';
import {createEventLottery,editEventLottery,eventLotteryView,listEventLotteries,changeEventLottery,drawEventLottery,markEventDelivered,retryEventLotteryNotices,refreshEventLotteryPanel,EventLotteryError} from '../services/eventLottery.js';
type Env={Variables:{session:AdminSession}};
const PATH='/economy/event-lottery';
const states:Record<string,string>={draft:'準備中',open:'受付中',closed:'受付終了',completed:'完了',cancelled:'中止'};
export function mountEventLottery(app:Hono<Env>,db:Db,channels:()=>Promise<GuildChannel[]>,now:()=>Date){
 app.use(PATH,async(c,next)=>{const s=c.get('session');if(s.level!=='guji'||s.pages&&!s.pages.includes('economy'))return c.text('経済ページ権限のある宮司だけ操作できます。',403);c.header('Cache-Control','private, no-store');await next();});
 app.get(PATH,async c=>{
  const s=c.get('session'),id=c.req.query('event');
  const list=await listEventLotteries(db);let model:Awaited<ReturnType<typeof eventLotteryView>>|undefined;try{if(id)model=await eventLotteryView(db,id);}catch{return c.text('イベントがありません。',404);}
  const field=(name:string,value:string|number)=><input type="hidden" name={name} value={String(value)}/>;
  const form=(action:string,label:string,extra:Record<string,string>={})=><form method="post" action={PATH}>{field('_csrf',s.csrfToken)}{field('eventId',id!)}{field('version',model!.event.version)}{field('action',action)}{Object.entries(extra).map(([k,v])=>field(k,v))}<button type="submit">{label}</button></form>;
  const result=model?.results.find(r=>r.id===c.req.query('draw'));
  return c.html(<Layout title="イベントくじ" session={s} nav="economy"><link rel="stylesheet" href={assetUrl('event-lottery.css')}/><script src={assetUrl('event-lottery.js')} defer/><h1>🎟 イベントくじ</h1><p>Discordで参加費を集め、受付終了後に景品ごとの当選者を一人ずつ引きます。賞金は管理者発行です。</p><p class={c.req.query('message')?'flash warn':undefined} role={c.req.query('message')?'alert':'status'}>{c.req.query('message')}</p><nav>{list.map(e=><p><a href={PATH+'?event='+e.id}>{e.name} · {states[e.state]}</a></p>)}</nav>
  {(!model||model.event.state==='draft'&&c.req.query('edit')==='1')?<section class="card"><h2>イベントを作る</h2><form method="post" action={PATH}>{field('_csrf',s.csrfToken)}{field('action',model?'edit':'create')}{model&&<>{field('eventId',model.event.id)}{field('version',model.event.version)}</>}<label>イベント名<input name="name" maxlength={100} value={model?.event.name??''} required/></label><label>参加費（銭）<input name="fee" type="number" min={1} max={100000000} value={model?.event.fee} required/></label><label>受付チャンネルのID<input name="channelId" value={model?.event.channelId} pattern="[0-9]{17,20}" required/></label><label>結果発表チャンネルのID<input name="resultChannelId" value={model?.event.resultChannelId} pattern="[0-9]{17,20}" required/></label><p>Discordでチャンネルを右クリックしてIDをコピーします。BOTが投稿できるチャンネルを指定してください。</p><h3>景品</h3><p>景品を1種類以上入れてください。使わない行は名前を空欄にします。銭以外の景品は名前と本数だけで登録できます。賞金が0銭で受け渡し内容が空欄なら、景品名を品物名として保存します。銭と品物を組み合わせる場合は、賞金と品物の両方を入力してください。受付開始後は変更できません。</p>{Array.from({length:10},(_,i)=><fieldset><legend>景品{i+1}</legend><label>名前<input name={'name'+i} value={model?.event.prizes[i]?.name??''} maxlength={100}/></label><label>本数<input name={'count'+i} type="number" min={1} max={10000} value={model?.event.prizes[i]?.count??1}/></label><label>1人分の賞金（銭）<input name={'coins'+i} type="number" min={0} max={100000000} value={model?.event.prizes[i]?.coins??0}/></label><label>品物・受け渡し内容（任意）<input name={'item'+i} value={model?.event.prizes[i]?.item??''} maxlength={500}/></label></fieldset>)}<button>準備中として保存</button></form></section>:<>
  <section class="card"><h2>{model.event.name} · {states[model.event.state]}</h2><p>参加費 {model.event.fee.toLocaleString()}銭 · 参加 {model.participants.length}人 · 回収総額 {model.collected.toLocaleString()}銭 · 返金 {model.refunded.toLocaleString()}銭</p><p>1人1口・1人1当選。落選時の返金はありません。抽選前の中止では全額返金します。</p>{model.event.state==='draft'&&<a href={PATH+'?event='+id+'&edit=1'}>受付内容・景品を変更する</a>}<div class="el-actions">{model.event.state==='draft'&&form('open','受付開始・Discordへ案内')}{model.event.state==='open'&&form('close','受付を締め切る')}{['draft','open','closed'].includes(model.event.state)&&!model.results.length&&form('cancel','中止して全額返金')}{model.event.state==='closed'&&form('complete','抽選を完了する')}</div></section>
  {result&&<section class="el-stage" data-el-result data-el-id={result.id} data-el-at={result.createdAt.getTime()+3000} data-el-names={JSON.stringify(model.participants.filter(p=>!p.refunded).map(p=>p.displayName))}><h2>{result.prizeName}</h2><p data-el-spinner aria-hidden="true">抽選結果</p><div data-el-winner><strong>{result.displayName} さん</strong><p>{result.coins.toLocaleString()}銭 {result.item}</p></div><p>この当選は保存済みです。読み直しても変わりません。</p></section>}
  <section class="card"><h2>景品と残数</h2>{model.event.prizes.map(p=>{const left=p.count-model!.results.filter(r=>r.prizeId===p.id).length;return <article><h3>{p.name} · 残り{left}/{p.count}</h3><p>{p.coins.toLocaleString()}銭 {p.item}</p>{model!.event.state==='closed'&&left>0&&form('draw','この景品の当選者を引く',{prizeId:p.id,operationId:randomUUID()})}</article>;})}</section>
  <section class="card"><h2>当選・受け渡し履歴</h2>{model.results.map(r=><article data-el-history-at={r.createdAt.getTime()+3000} hidden={r.createdAt.getTime()+3000>now().getTime()}><h3>{r.prizeName}：{r.displayName} さん</h3><p>{r.coins.toLocaleString()}銭 {r.item} · {r.createdAt.toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}</p>{r.item&&(r.delivered?<p>受け渡し済み</p>:form('deliver','受け渡し済みにする',{drawId:r.id}))}</article>)}</section>
  <section class="card"><h2>参加者</h2><ul>{model.participants.map(p=><li>{p.displayName} · {p.paid.toLocaleString()}銭 {p.refunded?'返金済み':''}</li>)}</ul></section>
  <section class="card"><h2>Discordへの送信</h2><p>受付パネルには景品を載せません。既に出した受付パネルは、更新すると同じ投稿から景品を外せます。</p>{model.event.state==='open'&&form('refresh-panel','受付パネルを更新')}{model.messages.map(n=><p>{n.id.startsWith('panel:')?'受付案内':n.id.startsWith('state:')?'受付状態':'当選発表'}：{n.sentAt?'送信済み':n.error??'送信待ち'}（試行{n.attempts}回）</p>)}{form('retry','未送信の通知を再送')}</section><a href={PATH}>別のイベントを作る</a></> }</Layout>);
 });
 app.post(PATH,async c=>{const b=await c.req.parseBody(),s=c.get('session');let id=String(b.eventId??'');try{
  const action=String(b.action??'');let draw='';
  if(action==='create'||action==='edit'){
   const cs=await channels();for(const key of ['channelId','resultChannelId'])if(!cs.some(ch=>ch.id===String(b[key])&&[0,5].includes(ch.type)))throw new EventLotteryError((key==='channelId'?'受付チャンネル':'結果発表チャンネル')+'：このサーバーのテキストチャンネルを指定してください。');
   const input={name:b.name,fee:b.fee,channelId:b.channelId,resultChannelId:b.resultChannelId,prizes:Array.from({length:10},(_,i)=>({name:b['name'+i],count:b['count'+i],coins:b['coins'+i],item:b['item'+i]??''})).filter(p=>String(p.name??'').trim())};if(action==='create')id=await createEventLottery(db,input,s.userId);else await editEventLottery(db,id,input,s.userId,Number(b.version));
  }else if(action==='draw'){const r=await drawEventLottery(db,id,String(b.prizeId),s.userId,Number(b.version),String(b.operationId),now());draw=r.id;}
  else if(action==='deliver')await markEventDelivered(db,id,String(b.drawId),s.userId);
  else if(action==='refresh-panel')await refreshEventLotteryPanel(db,id,s.userId);
  else if(action==='retry')await retryEventLotteryNotices(db,id,s.userId);
  else await changeEventLottery(db,id,s.userId,Number(b.version),action);
  return c.redirect(PATH+'?event='+id+(draw?'&draw='+draw:''),303);
 }catch(e){if(!(e instanceof EventLotteryError))throw e;return c.redirect(PATH+'?'+(id?'event='+id+'&':'')+'e=invalid&message='+encodeURIComponent(e.message),303);}});
}

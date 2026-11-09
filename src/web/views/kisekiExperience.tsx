import {CasinoLayout,type CasinoMe} from './casino.js';
import {Layout} from './layout.js';
import type {AdminSession} from '../../db/schema.js';
import {EXPERIENCE_PRICE,type ExperienceState} from '../../services/casino/kiseki/experience.js';
import {assetUrl} from '../assets.js';
const fmt=(n:number)=>n.toLocaleString('ja-JP');
export function KisekiExperience({me,state,requestId,error,message}:{me:CasinoMe;state:ExperienceState;requestId:string;error?:string;message?:string}){
 const csrf=<input type="hidden" name="_csrf" value={me.session.csrfToken}/>;
 return <CasinoLayout title="神域体験券 · GOD先行体験" me={me}><link rel="stylesheet" href={assetUrl('kiseki-experience.css')}/><section class="ke-pass"><p>開発中のプレリリース版</p><h1>神域体験券</h1><p>GOD先行体験 · <strong>60分 / {fmt(EXPERIENCE_PRICE)}銭</strong></p><p>使用開始から連続60分。ブラウザーを閉じている間も時間は進みます。</p>
 {error&&<p class="c-error" role="alert">{error}</p>}{message&&<p class="c-msg" role="status">{message}</p>}
 {!state.active&&state.result&&<section><h2>最後のゲームの結果</h2><p>{state.result.message}</p><p>戻り {fmt(state.result.paid)}試遊ポイント。続きは本人用に保存しています。</p></section>}
 {state.active&&<section><h2>体験中</h2><p>利用期限：{state.active.endsAt!.toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}（日本時間）</p><p>残り約{Math.ceil((state.active.endsAt!.getTime()-state.now)/60000)}分</p><a class="c-btn" href="/casino/god/play">体験の続きを開く</a></section>}
 {!state.active&&(state.view.own?.spinning||state.finishSaved)&&<section><h2>停止待ちのゲームがあります</h2><a class="c-btn" href="/casino/god/play">回転中のSTOPを完了する</a></section>}
 <section><h2>体験券を購入</h2><p>現在の残高：{fmt(me.balance)} {me.coin.name}</p><p>購入時に1,500銭を消費します。券は使うまで時間を消費しません。試遊ポイントは銭に交換できません。</p>{state.enabled?<form method="post" action="/casino/god/buy">{csrf}<input type="hidden" name="requestId" value={requestId}/><label><input type="checkbox" name="agree" value="1" required/>開発中の試遊版・料金・利用時間・換金不可を確認しました</label><button class="c-btn" disabled={me.balance<EXPERIENCE_PRICE}>1,500銭で体験券を1枚購入</button></form>:<p>ただいま体験券の販売はお休み中です。購入済みの券は使用できます。</p>}</section>
 <section><h2>未使用の体験券：{state.unused.length}枚</h2>{state.unused.map(t=><form method="post" action="/casino/god/start">{csrf}<input type="hidden" name="ticketId" value={t.id}/><span>{t.createdAt.toLocaleDateString('ja-JP',{timeZone:'Asia/Tokyo'})}購入 </span><button class="c-btn" disabled={!!state.active}>この券で60分の体験を始める</button></form>)}<p>開始時に空き台を確保します。満席の場合は券を使用せず、空くまで待てます。</p></section>
 <section><h2>遊び方と保存</h2><p>遊技は専用の試遊ポイントを使います。不足時は体験時間内に補充できます。勝敗による銭の増減はありません。</p><p>時間切れでは新しい回転を開始できません。回転中の1ゲームは最後まで停止でき、残りのボーナスは本人用に保存されます。次の券で続きを再開できます。</p><p>画像・音は独自制作、抽選の一部は仮仕様です。実機と同じ動作や出玉を保証する版ではありません。</p></section>
 <details><summary>購入・利用履歴（最新30件）</summary><ul>{state.history.map(t=><li>{t.createdAt.toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})} · {fmt(t.price)}銭 · {t.endsAt?t.endsAt.getTime()>state.now?'使用中':'利用済み':'未使用'}</li>)}</ul></details><a href="/casino/hall">カジノに戻る</a></section></CasinoLayout>;
}
export function KisekiExperienceAdmin({session,enabled,totals}:{session:AdminSession;enabled:boolean;totals:{count:number;coins:number;started:number}}){return <Layout title="神域体験券の販売" nav="casino" session={session}><h1>神域体験券 · GOD先行体験</h1><p>1枚1,500銭・使用開始から60分。料金は消費し、運営個人へ送金しません。換金不可。</p><p>販売：{enabled?'受付中':'停止中'} / 購入{totals.count}枚 / 使用開始{totals.started}枚 / 回収{fmt(Number(totals.coins))}銭</p><form method="post"><input type="hidden" name="_csrf" value={session.csrfToken}/><input type="hidden" name="enabled" value={enabled?'0':'1'}/><button>{enabled?'新規販売を止める':'新規販売を始める'}</button></form><p>販売停止は新しい購入だけを止めます。購入済みの券と利用中の残り時間は維持します。カジノ全体を止めると先行体験も利用できなくなり、時計は進みます。</p><p><a href="/casino/god">会員向け購入ページ</a> · <a href="/economy/kiseki-trial">運営用の無料試遊</a></p></Layout>;}

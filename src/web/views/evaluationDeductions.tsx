import type {AdminSession} from '../../db/schema.js';
import type {EvaluationDeductionData} from '../../services/evaluationDeductions.js';
import {fmtMinutes} from '../../services/voiceUsage.js';
import {Layout} from './layout.js';

export function EvaluationDeductionsPage({session,data,error,saved}:{session:AdminSession;data:EvaluationDeductionData;error?:string;saved?:boolean}){
  const url=(page:number)=>'/evaluation/corrections?'+new URLSearchParams({member:data.member.memberId,page:String(page)});
  return <Layout title="評価の過去時間の控除" nav="evaluation" session={session}><div class="evaluation-page evaluation-corrections">
    <h1>{data.member.name}さんの過去時間の控除</h1>
    <p><a href="/evaluation">評価へ戻る</a></p>
    <section class="card"><p>ミュートしていたと確認できた時間だけを入力してください。過去のミュート状態は時刻・部屋ごとに保存されておらず、自動では復元できません。根拠が不明な時間を推測で控除しないでください。</p>
      <p>その日・縁側の<strong>控除する合計分数</strong>を保存します。再度保存しても二重に引きません。0分に戻す場合も理由を残します。原本の滞在記録・報酬・役職は変更しません。</p></section>
    {error&&<p class="notice" role="alert">{error}</p>}{saved&&<p class="notice" role="status">控除を保存しました。評価とCSVにも反映します。</p>}
    <p>{data.total}件 ／ {data.page} / {data.pages}ページ</p>
    {data.rows.length?data.rows.map(row=><section class="card">
      <h2>{row.date} ／ {row.name}</h2><p>部屋ID：{row.channelId}<br/>過去取込（控除前）：{fmtMinutes(row.legacy)} ／ 現在の控除：{fmtMinutes(row.deducted)}</p>
      <form class="field" method="post" action="/evaluation/corrections">
        <input type="hidden" name="_csrf" value={session.csrfToken}/><input type="hidden" name="member" value={data.member.memberId}/>
        <input type="hidden" name="date" value={row.date}/><input type="hidden" name="channel" value={row.channelId}/>
        <input type="hidden" name="expected" value={row.deducted}/><input type="hidden" name="expectedAt" value={row.updatedAt?.toISOString()??''}/><input type="hidden" name="page" value={data.page}/>
        <label class="field">控除する合計分数 <input type="number" name="minutes" min="0" max={row.legacy} step="1" value={row.deducted} required/></label>
        <label class="field">確認した根拠 <textarea name="reason" minLength={2} maxLength={300} required>{row.reason??''}</textarea></label>
        <button type="submit">この日・縁側の控除を保存</button>
      </form>
    </section>):<p>控除対象となる過去取込記録はありません。</p>}
    <nav aria-label="過去控除のページ">{data.page>1&&<a href={url(data.page-1)}>前へ</a>}{' '}{data.page<data.pages&&<a href={url(data.page+1)}>次へ</a>}</nav>
  </div></Layout>;
}

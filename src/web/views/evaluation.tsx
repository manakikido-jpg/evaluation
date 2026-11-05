import { EVALUATION_START_LABEL } from '../../domain/ujikoEvaluation.js';
import type { AdminSession } from '../../db/schema.js';
import type { EvaluationData, EvaluationFilter } from '../../services/ujikoEvaluation.js';
import { fmtMinutes } from '../../services/voiceUsage.js';
import { Layout } from './layout.js';

export function evaluationQuery(filter: EvaluationFilter, selectedIds: string[], page?: number): string {
  const query = new URLSearchParams({ scope: '1', q: filter.q, status: filter.status });
  for (const id of selectedIds) query.append('channel', id);
  if (page && page > 1) query.set('page', String(page));
  return query.toString();
}

export function EvaluationPage({ session, data, filter, page }: {
  session: AdminSession; data: EvaluationData; filter: EvaluationFilter; page: number;
}) {
  const pageSize = 100, pages = Math.max(1, Math.ceil(data.rows.length / pageSize));
  const current = Math.min(page, pages), rows = data.rows.slice((current - 1) * pageSize, current * pageSize);
  return <Layout title="評価" nav="evaluation" session={session} wide>
    <div class="evaluation-page"><h1>氏子への評価</h1>
    <section class="card">
      <h2>御朱印40個 ＋ 参拝者として縁側に20時間</h2><p><strong>縁側時間の集計開始：{EVALUATION_START_LABEL}</strong></p>
      <p>対象は在籍中の参拝者です。両方を満たした人を先に、御朱印が多い順、同数なら対象の縁側時間が長い順に並べます。同じ条件なら同順位です。</p>
      <p><strong>対象 {data.total}名 ／ 両条件達成 {data.achieved}名 ／ 未達成 {data.total - data.achieved}名</strong>（検索・達成状況の絞り込み前）</p>
      <details><summary>時間と御朱印の数え方</summary><p class="note">御朱印は取り消し分を除く個数です。重み付きの「ご縁」や特別ご縁は含めません。御朱印は今までの累計、時間は集計開始以降かつ機能反映後の記録から、その時点の格が参拝者で、名前に「縁側」がある通話にいた分を累計します。BOT・AFKは除き、1人でも数えます。最上位の格が氏子以上・神職などのときは加算しません。</p><p class="note">この一覧は運営の確認用です。既存の自動昇格ルールは変更しません。</p></details>
      <p class="notice"><strong>集計開始前・過去の役職が分からない時間は参考だけです。</strong>20時間の判定や順位には足しません。</p>
    </section>
    <section class="card">
      <h2>順位と達成状況</h2>
      <form method="get" action="/evaluation" class="filters evaluation-filters">
        <input type="hidden" name="scope" value="1"/>
        <label>名前・ユーザー名・ID <input type="search" name="q" value={filter.q} maxLength={100}/></label>
        <label>達成状況 <select name="status"><option value="all" selected={filter.status === 'all'}>すべて</option><option value="met" selected={filter.status === 'met'}>両条件達成</option><option value="unmet" selected={filter.status === 'unmet'}>未達成</option></select></label>
        <fieldset><legend>対象の縁側</legend>
          {data.channels.length ? data.channels.map(c => <label><input type="checkbox" name="channel" value={c.id} checked={data.selectedIds.includes(c.id)}/> {c.name}{c.renamed ? '（過去の縁側記録あり）' : ''} </label>) : <p>縁側の記録がまだありません。BOTが記録すると表示されます。</p>}
        </fieldset>
        <button type="submit">集計する</button> <a href="/evaluation">絞り込みを戻す</a>
      </form>
      {!data.selectedIds.length && <p role="status">対象の縁側が未選択のため、条件に使う時間は0分です。</p>}
      <p>{data.rows.length}名を表示対象にしています。 <a href={'/evaluation/export.csv?' + evaluationQuery(filter, data.selectedIds)}>この条件の順位表をCSVで保存</a></p>
      <p class="table-scroll-hint">スマホでは表を横に動かせます。絞り込んでも全体での順位を保ちます。</p>
      <div class="admin-table-scroll" tabIndex={0} role="region" aria-label="氏子条件の評価順位表">
        <table><caption>御朱印40個以上と、確認済みの参拝者の縁側時間1,200分以上で判定</caption>
          <thead><tr><th scope="col">順位</th><th scope="col">参拝者</th><th scope="col">御朱印</th><th scope="col">参拝者の縁側時間</th><th scope="col">達成状況</th><th scope="col">過去の参考時間</th></tr></thead>
          <tbody>{rows.length ? rows.map(r => <tr>
            <td>{r.rank}位</td><th scope="row"><a href={'/members/' + r.memberId}>{r.name}</a><br/><small>@{r.username}</small></th>
            <td><strong>{r.shuinCount}個 / 40個</strong><br/><small>{r.remainingShuin ? `あと${r.remainingShuin}個` : '達成'}</small></td>
            <td><strong>{fmtMinutes(r.minutes)} / 20時間</strong><br/><small>{r.remainingMinutes ? `あと${fmtMinutes(r.remainingMinutes)}` : '達成'}</small></td>
            <td>{r.achieved ? <strong>両条件達成</strong> : '未達成'}</td><td>{fmtMinutes(r.referenceMinutes)}<br/><small>開始前・役職不明・条件に含めない</small></td>
          </tr>) : <tr><td colSpan={6}>{data.total ? 'この条件に合う参拝者はいません。' : '対象の参拝者がいません。メンバーと役職の同期状態をご確認ください。'}</td></tr>}</tbody>
        </table>
      </div>
      <nav aria-label="評価順位表のページ"><p>{current} / {pages}ページ
        {current > 1 && <> <a href={'/evaluation?' + evaluationQuery(filter, data.selectedIds, current - 1)}>前へ</a></>}
        {current < pages && <> <a href={'/evaluation?' + evaluationQuery(filter, data.selectedIds, current + 1)}>次へ</a></>}
      </p></nav>
    </section>
  </div></Layout>;
}

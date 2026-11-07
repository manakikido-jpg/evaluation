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
      <h2>ご縁40 ＋ 縁側の合計20時間</h2><p><strong>参拝者時間の計測開始：{EVALUATION_START_LABEL}から</strong><br/>ミュート除外に対応した反映後の分は、マイク・スピーカーの両方が非ミュートと確認できた時間だけを加算します。過去分は控除後の合計を使います。</p>
      <p>対象は在籍中の参拝者です。両方を満たした人を先に、ご縁が多い順、同数なら過去分を含む縁側の合計時間が長い順に並べます。同じ条件なら同順位です。</p>
      <p><strong>対象 {data.total}名 ／ 両条件達成 {data.achieved}名 ／ 未達成 {data.total - data.achieved}名</strong>（検索・達成状況の絞り込み前）</p>
      <details><summary>時間とご縁の数え方</summary><p class="note">ご縁は、取り消し分を除く御朱印の重みの合計（参拝者が押すと +1、氏子が押すと +2 など）に、運営が付けた特別ご縁を足した数です。メンバーのページの「ご縁」と同じです。「頂いた朱印」の個数（人数）は、条件ではなく参考に出しています。ご縁は今までの累計です。時間は、既存の縁側記録を過去取込として加え、11月6日0時以降かつ機能反映後は、その時点の格が参拝者で、名前に「縁側」がある通話にいた分を記録します。新しい評価用計測では本人/サーバーのマイク・スピーカーミュートを除外し、状態不明も非ミュートとはみなしません。BOT・AFKは除き、1人でも数えます。確認済み計測では、最上位の格が氏子以上・神職などの時間は加算しません。</p><p class="note">参拝者から氏子以上への自動昇格にも、御朱印40個と控除後20時間が必要です。自動判定は全縁側が対象で、この一覧の絞り込みには連動しません。時間が最後の条件なら毎分の確認で判定します。既に氏子以上の人を自動で降格しません。</p></details>
      <p class="notice"><strong>過去の縁側時間も20時間の判定・順位に加えています。</strong>過去の役職またはミュート状態を確認できない分は「過去取込」です。ミュート履歴がないため自動控除はできません。宮司が根拠を確認できた分だけ、日付・縁側を指定して控除できます。</p>
    </section>
    <section class="card">
      <h2>順位と達成状況</h2>
      <form method="get" action="/evaluation" class="filters evaluation-filters">
        <input type="hidden" name="scope" value="1"/>
        <label>名前・ユーザー名・ID <input type="search" name="q" value={filter.q} maxLength={100}/></label>
        <label>達成状況 <select name="status"><option value="all" selected={filter.status === 'all'}>すべて</option><option value="met" selected={filter.status === 'met'}>両条件達成</option><option value="unmet" selected={filter.status === 'unmet'}>未達成</option></select></label>
        <details class="evaluation-targets"><summary>対象の縁側（{data.selectedIds.length} / {data.channels.length}件を選択）</summary>
          <p class="note">自動で作り直された部屋などの履歴は、同じカテゴリ・同じ名前ごとにまとめて合算しています。部屋の番号やカテゴリが違うものは分けています。</p>
          <fieldset><legend>集計する縁側を選ぶ</legend>
            {data.channels.length ? data.channels.map(c => <label><input type="checkbox" name="channel" value={c.id} checked={data.selectedIds.includes(c.id)}/><span>{c.name}{c.renamed ? '（過去の縁側記録あり）' : ''}<br/><small>{c.categoryName}{c.ids.length > 1 ? ` ／ ${c.ids.length}件の部屋記録を合算` : ''}</small></span></label>) : <p>縁側の記録がまだありません。BOTが記録すると表示されます。</p>}
          </fieldset>
        </details>
        <button type="submit">集計する</button> <a href="/evaluation">絞り込みを戻す</a>
      </form>
      {!data.selectedIds.length && <p role="status">対象の縁側が未選択のため、条件に使う時間は0分です。</p>}
      <p>{data.rows.length}名を表示対象にしています。 <a href={'/evaluation/export.csv?' + evaluationQuery(filter, data.selectedIds)}>この条件の順位表をCSVで保存</a></p>
      <p class="table-scroll-hint">スマホでは表を横に動かせます。絞り込んでも全体での順位を保ちます。</p>
      <div class="admin-table-scroll" tabIndex={0} role="region" aria-label="氏子条件の評価順位表">
        <table><caption>ご縁40以上と、過去分を含む縁側の合計1,200分以上で判定</caption>
          <thead><tr><th scope="col">順位</th><th scope="col">参拝者</th><th scope="col">ご縁</th><th scope="col">縁側の合計時間</th><th scope="col">達成状況</th><th scope="col">時間の内訳</th></tr></thead>
          <tbody>{rows.length ? rows.map(r => <tr>
            <td>{r.rank}位</td><th scope="row"><a href={'/members/' + r.memberId}>{r.name}</a><br/><small>@{r.username}</small>{session.level==='guji'&&<><br/><a href={'/evaluation/corrections?member='+r.memberId}>過去時間の控除</a></>}</th>
            <td><strong>{r.goen} / 40</strong><br/><small>{r.remainingGoen ? `あと${r.remainingGoen}` : '達成'}（朱印 {r.shuinCount} 個）</small></td>
            <td><strong>{fmtMinutes(r.minutes)} / 20時間</strong><br/><small>{r.remainingMinutes ? `あと${fmtMinutes(r.remainingMinutes)}` : '達成'}</small></td>
            <td>{r.achieved ? <strong>両条件達成</strong> : '未達成'}</td><td>過去取込 {fmtMinutes(r.pastMinutes)}<br/>非ミュート確認済み {fmtMinutes(r.confirmedMinutes)}<br/>ミュート等の除外 {fmtMinutes(r.excludedMinutes)}<br/>過去控除 {fmtMinutes(r.deductedMinutes)}<br/><small>過去分の役職またはミュートは未確認</small></td>
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

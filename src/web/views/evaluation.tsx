import { EVALUATION_START_LABEL } from '../../domain/ujikoEvaluation.js';
import type { AdminSession } from '../../db/schema.js';
import type { EvaluationData, EvaluationFilter } from '../../services/ujikoEvaluation.js';
import { fmtMinutes } from '../../services/voiceUsage.js';
import { UJIKO_RATING_ITEMS } from '../../services/ujikoRating.js';
import { EMA_DEFAULT_THRESHOLDS, sewayakuRuleText, ujikoRuleText, type EmaThresholdCounts } from '../../domain/ema.js';
import type { SewayakuElection } from '../../db/schema.js';
import { Layout } from './layout.js';

const fmtJstDay = (d: Date) => d.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short' });

export function evaluationQuery(filter: EvaluationFilter, selectedIds: string[], page?: number): string {
  const query = new URLSearchParams({ scope: '1', q: filter.q, status: filter.status });
  for (const id of selectedIds) query.append('channel', id);
  if (page && page > 1) query.set('page', String(page));
  return query.toString();
}

export function EvaluationPage({ session, data, filter, page, emaPromotion = false, keepWarnings = [], names, saved, resetFlash, resetUndoable, perkUjiko = false, perkFlash, goenPerksText = '', goenPerksFlash, emaThresholds = EMA_DEFAULT_THRESHOLDS, emaThresholdsFlash, ujikoWeek, sewayaku }: {
  session: AdminSession; data: EvaluationData; filter: EvaluationFilter; page: number;
  emaPromotion?: boolean; keepWarnings?: { id: string; count: number }[]; names?: Map<string, string>; saved?: string;
  resetFlash?: string; resetUndoable?: { at: Date; remaining: number; specialRemaining: number };
  perkUjiko?: boolean; perkFlash?: string;
  goenPerksText?: string; goenPerksFlash?: string;
  emaThresholds?: EmaThresholdCounts; emaThresholdsFlash?: string;
  ujikoWeek?: { week: string; active: number; required: number };
  sewayaku?: { active: (SewayakuElection & { votes: number | null })[]; recent: SewayakuElection[]; names: Map<string, string> };
}) {
  const pageSize = 100, pages = Math.max(1, Math.ceil(data.rows.length / pageSize));
  const current = Math.min(page, pages), rows = data.rows.slice((current - 1) * pageSize, current * pageSize);
  const nameOf = (id: string) => names?.get(id) ?? id;
  // 参拝者→氏子の決まり（毎週きまる数）
  const ujikoRule = `お参り期間中に氏子の票を毎週きまる数（${ujikoRuleText(emaThresholds)}）・招待で${emaThresholds.inviteSubstituteMax}つまで補える`;
  return <Layout title="評価" nav="evaluation" session={session} wide>
    <div class="evaluation-page"><h1>氏子への評価</h1>
    {saved === 'on' && <p class="flash ok" role="status">🎐 絵馬での昇格に切り替えました。これからは参拝者は{ujikoRule}で氏子になります。</p>}
    {saved === 'off' && <p class="flash ok" role="status">従来（ご縁40＋縁側20時間）に戻しました。</p>}
    {saved === 'confirm' && <p class="flash warn" role="alert">「切り替えてよい」にチェックを入れてから押してください。</p>}
    {session.level === 'guji' && <section class="card">
      <h2>🎐 絵馬での昇格（新制度③・⑧）</h2>
      <p>いまの昇格のきまり：{emaPromotion
        ? <strong>絵馬で昇格（参拝者は{ujikoRule}で氏子・氏子以降も絵馬で）</strong>
        : <strong>従来どおり（下の ご縁40＋縁側20時間）</strong>}。どちらでも自動降格はせず、今いる人は据え置きです。</p>
      <form method="post" action="/evaluation/ema-promotion" class="ema-promotion-form">
        <input type="hidden" name="_csrf" value={session.csrfToken}/>
        <input type="hidden" name="on" value={emaPromotion ? '0' : '1'}/>
        <label><input type="checkbox" name="confirm" value="yes"/> 切り替えてよい</label>
        <button type="submit">{emaPromotion ? '従来（ご縁40＋縁側20時間）に戻す' : '絵馬での昇格に切り替える'}</button>
      </form>
      <p class="note">絵馬での昇格に切り替えると、昇格は全部<strong>絵馬</strong>で決まり、ご縁・縁側時間は使いません（参拝者→氏子は{ujikoRule}／氏子→世話役は{sewayakuRuleText(emaThresholds)}／世話役→総代は総代の票{emaThresholds.sodaiPromote}枚）。数は下の「絵馬の枚数」で変えられます。切り替える前に、絵馬が十分にたまっているか下の「維持の注意」で確かめてください。</p>
      <details><summary>維持の注意：有効な絵馬が{emaThresholds.ujikoKeep}枚未満の氏子（{keepWarnings.length} 人）</summary>
        <p class="note">自動では降格しません。運営が手で判断するための一覧です（絵馬の少ない順）。</p>
        {keepWarnings.length
          ? <ul>{keepWarnings.slice(0, 100).map((w) => <li><a href={'/members/' + w.id}>{nameOf(w.id)}</a> … 絵馬 {w.count} 枚</li>)}{keepWarnings.length > 100 && <li>ほか {keepWarnings.length - 100} 人</li>}</ul>
          : <p>{emaThresholds.ujikoKeep}枚未満の氏子はいません。</p>}
      </details>
    </section>}
    {session.level === 'guji' && <section class="card">
      <h2>🔄 新制度の切替：ご縁のリセット</h2>
      {resetFlash === 'done' && <p class="flash ok" role="status">全員のご縁（結び）と ✨ 特別ご縁を 0 に戻しました。押した直後なら、下の「元に戻す」で戻せます。</p>}
      {resetFlash === 'undone' && <p class="flash ok" role="status">直前のリセットを元に戻しました。</p>}
      {resetFlash === 'none' && <p class="flash warn" role="alert">元に戻せるリセットがありません。</p>}
      {resetFlash === 'confirm' && <p class="flash warn" role="alert">確認のため「リセット」と入力し、チェックを入れてから押してください。</p>}
      {resetFlash === 'need_ema' && <p class="flash warn" role="alert">先に上の「🎐 絵馬での昇格」を ON にしてください（ご縁を0にすると、従来のご縁での昇格が止まってしまうため）。</p>}
      <p>新制度を始めるときに、<strong>全員のご縁（結び＝朱印）と ✨ 特別ご縁をいっせいに 0 に戻します</strong>。みんな同じところから結び直せます。<strong>役職は変えません</strong>（自動降格なし・今いる氏子は据え置き）。</p>
      <p class="note">※「🎐 絵馬での昇格」が ON のときだけ押せます（ご縁を0にしても昇格が止まらないように）。デプロイでは勝手に消えません。押すのは一度、新制度を始める合図のときだけにしてください。</p>
      {resetUndoable && <form method="post" action="/evaluation/goen-reset-undo">
        <input type="hidden" name="_csrf" value={session.csrfToken}/>
        <p role="status">直前のリセットは、まだ元に戻せます（結び {resetUndoable.remaining} 件・特別ご縁 {resetUndoable.specialRemaining} 件）。</p>
        <button type="submit">直前のリセットを元に戻す</button>
      </form>}
      <form method="post" action="/evaluation/goen-reset" class="goen-reset-form">
        <input type="hidden" name="_csrf" value={session.csrfToken}/>
        <label>確認のため「リセット」と入力 <input type="text" name="phrase" autocomplete="off" placeholder="リセット"/></label>
        <label><input type="checkbox" name="confirm" value="yes"/> 全員のご縁と特別ご縁を 0 に戻してよい</label>
        <button type="submit">全員のご縁をリセットして新制度を始める</button>
      </form>
    </section>}
    {session.level === 'guji' && <section class="card">
      <h2>🎁 特典のゲート：カジノ・宿を氏子から（新制度⑤）</h2>
      {perkFlash === 'on' && <p class="flash ok" role="status">🍃 カジノ・宿を「氏子以上だけ」にしました。</p>}
      {perkFlash === 'off' && <p class="flash ok" role="status">カジノ・宿を「参拝者から」（今までどおり）に戻しました。</p>}
      {perkFlash === 'confirm' && <p class="flash warn" role="alert">「切り替えてよい」にチェックを入れてから押してください。</p>}
      <p>いまのきまり：{perkUjiko
        ? <strong>氏子以上だけ（カジノ・宿）</strong>
        : <strong>参拝者から（今までどおり）</strong>}。</p>
      <form method="post" action="/evaluation/perk-ujiko" class="perk-ujiko-form">
        <input type="hidden" name="_csrf" value={session.csrfToken}/>
        <input type="hidden" name="on" value={perkUjiko ? '0' : '1'}/>
        <label><input type="checkbox" name="confirm" value="yes"/> 切り替えてよい</label>
        <button type="submit">{perkUjiko ? '参拝者から（今までどおり）に戻す' : 'カジノ・宿を氏子以上だけにする'}</button>
      </form>
      <p class="note">ONにすると、カジノは氏子以上の方だけが入れます（参拝者は「氏子になると入れます」と案内）。宿（宿坊など部屋代のかかる部屋）を氏子からにする分は準備中です。</p>
    </section>}
    {session.level === 'guji' && <section class="card">
      <h2>🎁 ご縁の節目特典（新制度⑦：称号・ごほうび・解放）</h2>
      {goenPerksFlash === 'saved' && <p class="flash ok" role="status">ご縁の節目特典を保存しました。</p>}
      {goenPerksFlash === 'invalid' && <p class="flash warn" role="alert">書き方を確認してください（1行＝「ご縁 銭 ロールID（任意） 称号名（任意）」）。</p>}
      <p>ご縁（出会った人の数）が節目に届いたら、銭や称号（飾りのロール）をあげます。「🎐 絵馬での昇格」が ON のときだけ効きます（1人・節目ごとに1回）。</p>
      <form method="post" action="/evaluation/goen-perks" class="goen-perks-form">
        <input type="hidden" name="_csrf" value={session.csrfToken}/>
        <label>節目（1行に1つ：<strong>ご縁 銭 [ロールID] [称号名]</strong>）
          <textarea name="perks" rows={6} spellcheck={false}>{goenPerksText}</textarea>
        </label>
        <button type="submit">ご縁の節目特典を保存</button>
      </form>
      <p class="note">例：「25 500」＝ご縁25で500銭。「100 2000 123456789012345678 ご縁上手」＝ご縁100で2000銭＋そのロール（称号）を付ける。ロールIDと称号名は省けます。銭だけなら「ご縁 銭」。ロールは宮司がロールのIDを入れたときだけ付きます。</p>
      <p class="note">🔓 <strong>解放</strong>にも使えます：そのロールに「限定チャンネルを見る」などの権限を付けておくと、節目に届いた人にそのチャンネルや機能が開きます（例：「200 0 ロールID 縁結びの間」＝ご縁200で限定チャンネル『縁結びの間』が開く。銭は 0 でもかまいません）。称号名のところが、届いたときのお知らせに出る名前になります。</p>
    </section>}
    {session.level === 'guji' && <section class="card">
      <h2>🎐 絵馬の枚数（新制度③・⑧）</h2>
      {emaThresholdsFlash === 'saved' && <p class="flash ok" role="status">絵馬の枚数を保存しました。</p>}
      {emaThresholdsFlash === 'invalid' && <p class="flash warn" role="alert">決められた範囲の数で入れてください（割合は1〜100%、時間は1〜168時間、最低は1〜100枚、招待の補いは0〜20、維持は0〜100、世話役・総代は1〜100）。</p>}
      <p>昇格・維持に要る絵馬（票）の枚数です。「🎐 絵馬での昇格」が ON のときに効きます。変えると次の見回り（1分ほど）から新しい枚数で判定します。</p>
      {ujikoWeek && <p class="ujiko-week"><strong>今週（{ujikoWeek.week} からの週）の参拝者→氏子：絵馬 {ujikoWeek.required} 枚</strong>（前の7日間に縁側に{Math.round(emaThresholds.ujikoActiveMinutes / 60 * 10) / 10}時間以上いた氏子以上 {ujikoWeek.active} 人 × {emaThresholds.ujikoPercent}%・切り上げ・最低{emaThresholds.ujikoMin}枚）。この週にお参り期間が始まった人は、ずっとこの数です。</p>}
      <form method="post" action="/evaluation/ema-thresholds" class="ema-thresholds-form">
        <input type="hidden" name="_csrf" value={session.csrfToken}/>
        <label>参拝者→氏子：縁側にいた氏子以上の人数の何%か<input type="number" name="ujikoPercent" min={1} max={100} value={emaThresholds.ujikoPercent}/></label>
        <label>参拝者→氏子：数える氏子以上の、前の7日間の縁側の時間（時間）<input type="number" name="ujikoActiveHours" min={1} max={168} value={Math.max(1, Math.round(emaThresholds.ujikoActiveMinutes / 60))}/></label>
        <label>参拝者→氏子：いちばん少ないときの枚数<input type="number" name="ujikoMin" min={1} max={100} value={emaThresholds.ujikoMin}/></label>
        <label>参拝者→氏子：招待で補える数（招待した人が参拝者になったら1つ）<input type="number" name="inviteSubstituteMax" min={0} max={20} value={emaThresholds.inviteSubstituteMax}/></label>
        <label>氏子の維持（これ未満で注意・0で注意なし）<input type="number" name="ujikoKeep" min={0} max={100} value={emaThresholds.ujikoKeep}/></label>
        <label>氏子→世話役：投票できる人の何%を超えたら昇格<input type="number" name="sewayakuVotePercent" min={1} max={100} value={emaThresholds.sewayakuVotePercent}/></label>
        <label>氏子→世話役：投票できる人（氏子・世話役・総代）の、直近30日の縁側の時間（時間・これを超える）<input type="number" name="sewayakuVoterHours" min={0} max={720} value={Math.round(emaThresholds.sewayakuVoterMinutes / 60)}/></label>
        <label>氏子→世話役：候補になる、氏子になってからの縁側の時間（時間）<input type="number" name="sewayakuCandidateHours" min={0} max={9999} value={Math.round(emaThresholds.sewayakuCandidateMinutes / 60)}/></label>
        <label>氏子→世話役：候補になる、氏子をつづけた月数<input type="number" name="sewayakuCandidateMonths" min={0} max={60} value={emaThresholds.sewayakuCandidateMonths}/></label>
        <label>氏子→世話役：落ちたあと、もう一度候補になる縁側の時間（時間）<input type="number" name="sewayakuRetryHours" min={0} max={9999} value={Math.round(emaThresholds.sewayakuRetryMinutes / 60)}/></label>
        <label>氏子→世話役：投票できる人がこれより少ない選挙は不成立（人）<input type="number" name="sewayakuMinVoters" min={1} max={1000} value={emaThresholds.sewayakuMinVoters}/></label>
        <label>世話役→総代（総代の票）<input type="number" name="sodaiPromote" min={1} max={100} value={emaThresholds.sodaiPromote}/></label>
        <button type="submit">絵馬の枚数を保存</button>
      </form>
      <p class="note">票の種類は贈る人と相手の役職で自動で決まります（参拝者・氏子へは氏子以上が「氏子の票」、世話役へは総代＋運営が「総代の票」）。総代の票は失効しません（氏子の票だけ30日で失効）。氏子→世話役は絵馬ではなく選挙です。自動降格はしません。</p>
    </section>}
    {session.level === 'guji' && sewayaku && <section class="card">
      <h2>🗳 世話役の選挙（候補ごと・匿名）</h2>
      <p>{sewayakuRuleText(emaThresholds)}。「🎐 絵馬での昇格」が ON のときだけ動きます。だれが投票したかは、どこにも出しません。</p>
      {sewayaku.active.length
        ? <ul>{sewayaku.active.map((e) => <li>
            <a href={'/members/' + e.candidateId}>{sewayaku.names.get(e.candidateId) ?? e.candidateId}</a> … {fmtJstDay(e.startsAt)}〜{fmtJstDay(new Date(e.endsAt.getTime() - 1))}
            {e.status === 'scheduled' ? '（これから）' : `（投票中：${e.votes ?? 0} 票／投票できる人 ${e.voterIds?.length ?? 0} 人・昇格には ${Math.floor((e.voterIds?.length ?? 0) * emaThresholds.sewayakuVotePercent / 100) + 1} 票）`}
          </li>)}</ul>
        : <p>いま決まっている選挙はありません。</p>}
      {sewayaku.recent.length > 0 && <details><summary>最近の結果（{sewayaku.recent.length} 件）</summary>
        <ul>{sewayaku.recent.map((e) => <li><a href={'/members/' + e.candidateId}>{sewayaku.names.get(e.candidateId) ?? e.candidateId}</a> … {fmtJstDay(e.startsAt)}〜 {e.status === 'passed' ? '世話役に昇格' : e.status === 'cancelled' ? '取りやめ（候補でなくなった）' : '届かず'}{e.status !== 'cancelled' ? `（${e.votes ?? 0} 票／${e.voterIds?.length ?? 0} 人）` : ''}</li>)}</ul>
      </details>}
    </section>}
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
    {session.level === 'guji' && <section class="card">
      <h2>氏子を5段階で評価するシート（宮司だけ）</h2>
      <p>今いる氏子の一覧をエクセル（.xlsx）で取り出せます。項目ごとに ★1〜5（1〜5の数）を書き込むと、<strong>平均が自動で出ます</strong>。この順位表とは別の、手で付ける評価用です。</p>
      <p class="note">はじめの項目は「{UJIKO_RATING_ITEMS.join('・')}」です。エクセルで列の名前を変えたり、増やし・減らししてかまいません（平均の列はF〜J列の平均を出しています）。名前・IDは参考です。この一覧は宮司だけがダウンロードできます。</p>
      <p><a href="/evaluation/rating-sheet.xlsx">氏子の評価シートをエクセルで保存</a></p>
    </section>}
  </div></Layout>;
}

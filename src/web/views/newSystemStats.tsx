import type { AdminSession } from '../../db/schema.js';
import type { Bucket, NewSystemStats, RankSplit } from '../../services/newSystemStats.js';
import { Layout } from './layout.js';

/**
 * 📐 新制度の検証（社務所Web の「推移」→「📐 新制度の検証」）。
 * 絵馬の必要数・条件・お守りの時間の肌感を、実データで見る（読むだけ・名前は浮上ランキングのみ）。
 * 今あるデータの限界はラベルで明示する（docs/new-system-design.md の Push C で正確化）。
 */

const n = (x: number) => Math.round(x).toLocaleString('ja-JP');
const one = (x: number) => x.toLocaleString('ja-JP', { maximumFractionDigits: 1 });
const hrs = (min: number) => (min / 60).toLocaleString('ja-JP', { maximumFractionDigits: 1 });
const md = (d: string) => d.slice(5).replace('-', '/');
const DAY_OPTIONS = [7, 14, 30, 90] as const;
const PCTS = [5, 10, 15, 20] as const;

function BucketTable(props: { caption: string; head: string; rows: Bucket[] }) {
  const total = props.rows.reduce((a, b) => a + b.count, 0);
  return (
    <div class="admin-table-scroll" tabIndex={0} role="region" aria-label={props.caption}>
      <table>
        <caption>{props.caption}</caption>
        <thead><tr><th scope="col">{props.head}</th><th scope="col">人数</th><th scope="col">割合</th></tr></thead>
        <tbody>
          {props.rows.map((r) => (
            <tr><th scope="row">{r.label}</th><td>{n(r.count)}</td><td>{total ? one((r.count / total) * 100) : '0'}%</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function avgSplit(rows: { active: RankSplit }[]): RankSplit {
  if (!rows.length) return { sanpaisha: 0, ujikoPlus: 0 };
  const s = rows.reduce((a, r) => ({ sanpaisha: a.sanpaisha + r.active.sanpaisha, ujikoPlus: a.ujikoPlus + r.active.ujikoPlus }), { sanpaisha: 0, ujikoPlus: 0 });
  return { sanpaisha: s.sanpaisha / rows.length, ujikoPlus: s.ujikoPlus / rows.length };
}

export function NewSystemStatsPage(props: { session: AdminSession; d: NewSystemStats }) {
  const d = props.d;
  const avgW = avgSplit(d.engawaWeekly);
  const avgM = avgSplit(d.engawaMonthly);
  return (
    <Layout title="新制度の検証" session={props.session} nav="stats">
      <h1>📐 新制度の検証</h1>
      <nav class="tabs stats-views" aria-label="見るもの">
        <a href="/stats?view=overview">📈 全体</a>
        <a href="/stats?view=gender">👫 男女</a>
        <a href="/stats?view=active">🌙 浮上・時間帯</a>
        <a href="/stats/report">📋 レポート</a>
        <a href="/stats/new-system" class="on" aria-current="page">📐 新制度の検証</a>
      </nav>
      <p class="note">
        {d.from.replaceAll('-', '/')}〜{d.today.replaceAll('-', '/')}（{d.days} 日）。開くたびに今の数字で作り直します。新制度の数字（絵馬の必要数・条件・お守り）を決めるための肌感です。
        役職は<strong>今の役職</strong>で分けます（過去にさかのぼった役職ではない近似）。
      </p>
      <p class="notice">
        ⚠️ 今のデータの限界：縁側の浮上時間は<strong>参拝者＝ミュート除外・氏子以上＝全時間</strong>。2人の同席（絵馬の条件）は<strong>全VC・ミュート込み</strong>（縁側だけ・ミュート除外にはできない）。時間帯の絞りは<strong>全VC</strong>（縁側だけにできない）。正確版は記録を足してこれから（docs/new-system-design.md）。
      </p>

      <form method="get" action="/stats/new-system" class="filters">
        <label>期間
          <select name="days">
            {DAY_OPTIONS.map((x) => (
              <option value={x} selected={x === d.days}>{x} 日</option>
            ))}
          </select>
        </label>
        <label>縁側に「◯分以上」<input type="number" name="min" value={d.activeMin} min={1} max={1440} /></label>
        <label>時間帯（開始・JST）<input type="number" name="hourFrom" value={d.hourFrom} min={0} max={23} /></label>
        <label>時間帯（終わり・この時は含まない。0時は24）<input type="number" name="hourTo" value={d.hourTo} min={1} max={24} /></label>
        <button type="submit">この条件で見る</button>
      </form>
      <p class="note">在籍（今の役職）：参拝者 {n(d.baseCount.sanpaisha)}人／氏子以上 {n(d.baseCount.ujikoPlus)}人。</p>

      <section class="card">
        <h2>🎐 絵馬の必要数（縁側アクティブ人数 × ◯%）</h2>
        <p class="note">縁側に <strong>{n(d.activeMin)}分以上</strong>いた人数（週ごと・月ごと）。参拝者はミュート除外・氏子以上は全時間。</p>
        <div class="admin-table-scroll" tabIndex={0} role="region" aria-label="縁側アクティブ人数（週）">
          <table>
            <caption>週ごと（{n(d.activeMin)}分以上）</caption>
            <thead><tr><th scope="col">週（月曜〜）</th><th scope="col">参拝者</th><th scope="col">氏子以上</th></tr></thead>
            <tbody>
              {d.engawaWeekly.length ? d.engawaWeekly.map((w) => (
                <tr><th scope="row">{md(w.bucket)}〜</th><td>{n(w.active.sanpaisha)}</td><td>{n(w.active.ujikoPlus)}</td></tr>
              )) : <tr><td colSpan={3}>縁側の記録がありません。</td></tr>}
            </tbody>
          </table>
        </div>
        <div class="admin-table-scroll" tabIndex={0} role="region" aria-label="縁側アクティブ人数（月）">
          <table>
            <caption>月ごと（{n(d.activeMin)}分以上）</caption>
            <thead><tr><th scope="col">月</th><th scope="col">参拝者</th><th scope="col">氏子以上</th></tr></thead>
            <tbody>
              {d.engawaMonthly.length ? d.engawaMonthly.map((w) => (
                <tr><th scope="row">{w.bucket.slice(0, 7).replace('-', '/')}</th><td>{n(w.active.sanpaisha)}</td><td>{n(w.active.ujikoPlus)}</td></tr>
              )) : <tr><td colSpan={3}>縁側の記録がありません。</td></tr>}
            </tbody>
          </table>
        </div>
        <h3>必要数の目安（週の平均アクティブ × ◯%）</h3>
        <div class="admin-table-scroll" tabIndex={0} role="region" aria-label="必要数の目安">
          <table>
            <thead><tr><th scope="col">母数（週平均）</th>{PCTS.map((p) => <th scope="col">×{p}%</th>)}</tr></thead>
            <tbody>
              <tr><th scope="row">氏子以上 {one(avgW.ujikoPlus)}人</th>{PCTS.map((p) => <td>{one((avgW.ujikoPlus * p) / 100)}</td>)}</tr>
              <tr><th scope="row">参拝者 {one(avgW.sanpaisha)}人</th>{PCTS.map((p) => <td>{one((avgW.sanpaisha * p) / 100)}</td>)}</tr>
            </tbody>
          </table>
        </div>
        <p class="note">月平均：氏子以上 {one(avgM.ujikoPlus)}人／参拝者 {one(avgM.sanpaisha)}人。「絵馬◯枚で昇格」を、この母数の何％にするかの目安にどうぞ。</p>
      </section>

      <section class="card">
        <h2>🕘 時間帯（全VC）に {n(d.activeMin)}分以上いた人（期間計）</h2>
        <p class="note">⚠️ これは<strong>全VC</strong>です（縁側だけに分けられません）。{n(d.hourFrom)}時〜{d.hourTo === 24 ? '0' : n(d.hourTo)}時に、全VCで {n(d.activeMin)}分以上いた人。</p>
        <p>参拝者 <strong>{n(d.hourActive.sanpaisha)}人</strong>／氏子以上 <strong>{n(d.hourActive.ujikoPlus)}人</strong></p>
      </section>

      <section class="card">
        <h2>🤝 絵馬を贈れる条件（同じ人と◯分・◯日いっしょ）</h2>
        <p class="note">⚠️ <strong>全VC・ミュート込み</strong>（縁側だけ・ミュート除外にはできません）。たたき台は「違う日3日以上＋合計180分（3時間）以上」。</p>
        <div class="admin-table-scroll" tabIndex={0} role="region" aria-label="合計時間ごとの組数">
          <table>
            <caption>合計◯分以上いっしょの「組」と「人」（期間計）</caption>
            <thead><tr><th scope="col">合計時間</th><th scope="col">当てはまる組</th><th scope="col">うち違う日3日以上</th><th scope="col">当てはまる人</th></tr></thead>
            <tbody>
              {d.pairByMins.map((r) => (
                <tr><th scope="row">{hrs(r.mins)}時間（{n(r.mins)}分）以上</th><td>{n(r.pairs)}組</td><td>{n(r.pairsWith3days)}組</td><td>{n(r.people)}人</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div class="admin-table-scroll" tabIndex={0} role="region" aria-label="違う日数ごとの組数">
          <table>
            <caption>違う日◯日以上いっしょの「組」（合計180分以上）</caption>
            <thead><tr><th scope="col">違う日</th><th scope="col">当てはまる組</th></tr></thead>
            <tbody>
              {d.pairByDays.map((r) => (
                <tr><th scope="row">{n(r.days)}日以上</th><td>{n(r.pairs)}組</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <h2>🛡 お守りを買える時間の目安（縁側の浮上）</h2>
        <div class="admin-table-scroll" tabIndex={0} role="region" aria-label="縁側の浮上率（週）">
          <table>
            <caption>縁側の浮上率（週ごと）＝縁側に出た人数 ÷ 在籍 {n(d.baseCount.sanpaisha + d.baseCount.ujikoPlus)}人</caption>
            <thead><tr><th scope="col">週（月曜〜）</th><th scope="col">縁側に出た人</th><th scope="col">浮上率</th></tr></thead>
            <tbody>
              {d.surfaceWeekly.length ? d.surfaceWeekly.map((w) => (
                <tr><th scope="row">{md(w.bucket)}〜</th><td>{n(w.active)}人</td><td>{one(w.rate)}%</td></tr>
              )) : <tr><td colSpan={3}>縁側の記録がありません。</td></tr>}
            </tbody>
          </table>
        </div>
        <div class="admin-table-scroll" tabIndex={0} role="region" aria-label="◯時間以上いた人数">
          <table>
            <caption>期間中に縁側へ◯時間以上いた人数</caption>
            <thead><tr><th scope="col">縁側の合計</th><th scope="col">人数</th></tr></thead>
            <tbody>
              {d.surfaceHours.map((r) => (
                <tr><th scope="row">{n(r.hours)}時間以上</th><td>{n(r.people)}人</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div class="admin-table-scroll" tabIndex={0} role="region" aria-label="縁側の浮上時間ランキング">
          <table>
            <caption>縁側の浮上時間ランキング（期間計・上位20）</caption>
            <thead><tr><th scope="col">順位</th><th scope="col">名前</th><th scope="col">縁側の合計</th></tr></thead>
            <tbody>
              {d.surfaceTop.length ? d.surfaceTop.map((r, i) => (
                <tr><td>{i + 1}位</td><th scope="row"><a href={'/members/' + r.memberId}>{r.name}</a></th><td>{hrs(r.minutes)}時間（{n(r.minutes)}分）</td></tr>
              )) : <tr><td colSpan={3}>縁側の記録がありません。</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <h2>⬆️ 昇格の割合が現実的か（参拝者化から14日以内）</h2>
        <p class="note">⚠️ <strong>全VC・ミュート込み</strong>。期間内に参拝者になった <strong>{n(d.promoteReality.sample)}人</strong>が、最初の14日で顔を合わせた<strong>氏子以上</strong>の人数。平均 <strong>{one(d.promoteReality.avgPartners)}人</strong>。「絵馬5枚で昇格」が現実的かの目安（14日以内に会える氏子以上の数）。</p>
        <BucketTable caption="14日以内に顔を合わせた氏子以上の人数（参拝者ごと）" head="会った氏子以上" rows={d.promoteReality.metPartners} />
        <BucketTable caption="相手1人ごとの同席時間（参拝者×氏子以上の組）" head="同席の合計時間" rows={d.promoteReality.pairMinutes} />
        <BucketTable caption="相手1人ごとの同席日数（参拝者×氏子以上の組）" head="違う日の数" rows={d.promoteReality.pairDays} />
      </section>

      <section class="card">
        <h2>🔁 維持の割合が現実的か（氏子が会う参拝者）</h2>
        <p class="note">⚠️ <strong>全VC・ミュート込み</strong>。期間に、氏子ちょうど <strong>{n(d.keepReality.sample)}人</strong>が同席した<strong>参拝者</strong>の人数。平均 <strong>{one(d.keepReality.avgPartners)}人</strong>。維持（絵馬3枚）が現実的かの目安。</p>
        <BucketTable caption="同席した参拝者の人数（氏子ごと）" head="同席した参拝者" rows={d.keepReality.metSanpaisha} />
        <BucketTable caption="相手1人ごとの同席時間（氏子×参拝者の組）" head="同席の合計時間" rows={d.keepReality.pairMinutes} />
      </section>

      <section class="card">
        <h2>⏳ 評価期間の延長の上限（参拝者→氏子までの日数）</h2>
        <p class="note">これまでに氏子になった <strong>{n(d.promoteDays.sample)}人</strong>が、参拝者になってから氏子になるまでにかかった日数（お参り期間の記録）。中央値 <strong>{n(d.promoteDays.median)}日</strong>／9割の人が <strong>{n(d.promoteDays.p90)}日</strong>以内／最長 <strong>{n(d.promoteDays.max)}日</strong>。延長の上限を決める目安にどうぞ。</p>
        <BucketTable caption="参拝者→氏子までの日数" head="かかった日数" rows={d.promoteDays.buckets} />
      </section>
    </Layout>
  );
}

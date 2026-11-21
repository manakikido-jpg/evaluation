import type { AdminSession } from '../../db/schema.js';
import type { Bucket, NewSystemStats, RankSplit } from '../../services/newSystemStats.js';
import { EMA_DAY_THRESHOLDS, EMA_MIN_THRESHOLDS } from '../../services/newSystemStats.js';
import { Layout } from './layout.js';

/**
 * 📐 新制度の検証（社務所Web の「推移」→「📐 新制度の検証」）。読むだけ。
 * 今あるデータの限界はラベルで明示（docs/new-system-design.md）。
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
        <tbody>{props.rows.map((r) => <tr><th scope="row">{r.label}</th><td>{n(r.count)}</td><td>{total ? one((r.count / total) * 100) : '0'}%</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function EmaGrid(props: { caption: string; grid: number[][] }) {
  return (
    <div class="admin-table-scroll" tabIndex={0} role="region" aria-label={props.caption}>
      <table>
        <caption>{props.caption}</caption>
        <thead><tr><th scope="col">1日に◯分以上 ＼ 日数</th>{EMA_DAY_THRESHOLDS.map((d) => <th scope="col">{d}日以上</th>)}</tr></thead>
        <tbody>
          {EMA_MIN_THRESHOLDS.map((min, i) => (
            <tr><th scope="row">{n(min)}分以上いた日</th>{EMA_DAY_THRESHOLDS.map((_, j) => <td>{n(props.grid[i]?.[j] ?? 0)}組</td>)}</tr>
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
  const srcLabel = d.src === 'engawa' ? '縁側・ミュート除外（2026-11-19〜）' : '全VC・ミュート込み（今すぐ）';
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
      <p class="note">{d.from.replaceAll('-', '/')}〜{d.today.replaceAll('-', '/')}（{d.days} 日）。開くたびに今の数字で作り直します。役職は<strong>今の役職</strong>で分けます（近似）。</p>
      <p class="notice">
        ⚠️ データの限界：縁側の浮上は<strong>参拝者＝ミュート除外・氏子以上＝全時間</strong>。2人の同席（絵馬の条件・昇格・維持）は、下の「同席のデータ源」で<strong>全VC・ミュート込み（今すぐ見られる）</strong>か<strong>縁側・ミュート除外（2026-11-19から記録・これからたまる）</strong>を選べます。
      </p>

      <form method="get" action="/stats/new-system" class="filters">
        <label>期間<select name="days">{DAY_OPTIONS.map((x) => <option value={x} selected={x === d.days}>{x} 日</option>)}</select></label>
        <label>同席のデータ源
          <select name="src">
            <option value="vc" selected={d.src === 'vc'}>全VC・ミュート込み（今すぐ）</option>
            <option value="engawa" selected={d.src === 'engawa'}>縁側・ミュート除外（たまり中）</option>
          </select>
        </label>
        <label>縁側に「◯分以上」<input type="number" name="min" value={d.activeMin} min={1} max={1440} /></label>
        <label>時間帯（開始・JST）<input type="number" name="hourFrom" value={d.hourFrom} min={0} max={23} /></label>
        <label>時間帯（終わり・0時は24）<input type="number" name="hourTo" value={d.hourTo} min={1} max={24} /></label>
        <button type="submit">この条件で見る</button>
      </form>
      <p class="note">在籍（今の役職）：参拝者 {n(d.baseCount.sanpaisha)}人／氏子以上 {n(d.baseCount.ujikoPlus)}人。</p>

      <section class="card">
        <h2>🎐 絵馬の必要数（縁側アクティブ人数 × ◯%）</h2>
        <p class="note">縁側に <strong>{n(d.activeMin)}分以上</strong>いた人数（週・月）。参拝者はミュート除外・氏子以上は全時間。</p>
        <div class="admin-table-scroll" tabIndex={0} role="region" aria-label="縁側アクティブ人数（週）">
          <table><caption>週ごと（{n(d.activeMin)}分以上）</caption>
            <thead><tr><th scope="col">週（月〜）</th><th scope="col">参拝者</th><th scope="col">氏子以上</th></tr></thead>
            <tbody>{d.engawaWeekly.length ? d.engawaWeekly.map((w) => <tr><th scope="row">{md(w.bucket)}〜</th><td>{n(w.active.sanpaisha)}</td><td>{n(w.active.ujikoPlus)}</td></tr>) : <tr><td colSpan={3}>記録がありません。</td></tr>}</tbody>
          </table>
        </div>
        <div class="admin-table-scroll" tabIndex={0} role="region" aria-label="縁側アクティブ人数（月）">
          <table><caption>月ごと（{n(d.activeMin)}分以上）</caption>
            <thead><tr><th scope="col">月</th><th scope="col">参拝者</th><th scope="col">氏子以上</th></tr></thead>
            <tbody>{d.engawaMonthly.length ? d.engawaMonthly.map((w) => <tr><th scope="row">{w.bucket.slice(0, 7).replace('-', '/')}</th><td>{n(w.active.sanpaisha)}</td><td>{n(w.active.ujikoPlus)}</td></tr>) : <tr><td colSpan={3}>記録がありません。</td></tr>}</tbody>
          </table>
        </div>
        <h3>必要数の目安（週の平均アクティブ × ◯%）</h3>
        <div class="admin-table-scroll" tabIndex={0} role="region" aria-label="必要数の目安">
          <table><thead><tr><th scope="col">母数（週平均）</th>{PCTS.map((p) => <th scope="col">×{p}%</th>)}</tr></thead>
            <tbody>
              <tr><th scope="row">氏子以上 {one(avgW.ujikoPlus)}人</th>{PCTS.map((p) => <td>{one((avgW.ujikoPlus * p) / 100)}</td>)}</tr>
              <tr><th scope="row">参拝者 {one(avgW.sanpaisha)}人</th>{PCTS.map((p) => <td>{one((avgW.sanpaisha * p) / 100)}</td>)}</tr>
            </tbody>
          </table>
        </div>
        <p class="note">月平均：氏子以上 {one(avgM.ujikoPlus)}人／参拝者 {one(avgM.sanpaisha)}人。</p>
        <h3>🕘 時間帯×縁側×ミュート除外（{n(d.hourFrom)}時〜{d.hourTo === 24 ? '0' : n(d.hourTo)}時に {n(d.activeMin)}分以上）</h3>
        <p class="note">⚠️ 2026-11-19から記録。まだ数字が少なく、これからたまります。</p>
        <p>参拝者 <strong>{n(d.hourActive.sanpaisha)}人</strong>／氏子以上 <strong>{n(d.hourActive.ujikoPlus)}人</strong></p>
      </section>

      <section class="card">
        <h2>🤝 絵馬を贈れる条件（氏子以上×参拝者の組）</h2>
        <p class="note">同じ組が「1日に◯分以上いた日」を◯日以上もつ組の数。たたき台は「1日◯分以上が3日以上」など。データ源：<strong>{srcLabel}</strong>。{d.days > 92 && <>（同席の集計は<strong>最大92日分</strong>です）</>}</p>
        {d.src === 'engawa' && <p class="note">⚠️ 縁側・ミュート除外は2026-11-19から記録。今は数字が少なめで、これからたまります。</p>}
        <EmaGrid caption={`1日◯分以上いた日が◯日以上ある組の数（${srcLabel}）`} grid={d.emaGrid} />
      </section>

      <section class="card">
        <h2>⬆️ 昇格の割合が現実的か（参拝者化から14日以内）</h2>
        <p class="note">データ源：<strong>{srcLabel}</strong>。期間内に参拝者になり14日たった <strong>{n(d.promoteReality.sample)}人</strong>が、最初の14日で顔を合わせた氏子以上。平均 <strong>{one(d.promoteReality.avgPartners)}人</strong>。</p>
        <BucketTable caption="14日以内に顔を合わせた氏子以上の人数（参拝者ごと）" head="会った氏子以上" rows={d.promoteReality.metPartners} />
        <BucketTable caption="相手1人ごとの同席時間（参拝者×氏子以上の組）" head="同席の合計時間" rows={d.promoteReality.pairMinutes} />
        <BucketTable caption="相手1人ごとの同席日数（参拝者×氏子以上の組）" head="違う日の数" rows={d.promoteReality.pairDays} />
      </section>

      <section class="card">
        <h2>🔁 維持の割合が現実的か（月ごと・氏子が会う参拝者）</h2>
        <p class="note">データ源：<strong>{srcLabel}</strong>。各月、氏子ちょうど1人あたりが同席した参拝者の人数。</p>
        {d.keepMonthly.map((mo) => (
          <>
            <p><strong>{mo.month.replace('-', '/')}</strong>：対象の氏子 {n(mo.sample)}人・平均 {one(mo.avgPartners)}人の参拝者と同席</p>
            <BucketTable caption={`${mo.month.replace('-', '/')} 同席した参拝者の人数（氏子ごと）`} head="同席した参拝者" rows={mo.metSanpaisha} />
          </>
        ))}
        <BucketTable caption="相手1人ごとの同席時間（氏子×参拝者の組・期間計）" head="同席の合計時間" rows={d.keepPairMinutes} />
        <BucketTable caption="相手1人ごとの同席日数（氏子×参拝者の組・期間計）" head="違う日の数" rows={d.keepPairDays} />
      </section>

      <section class="card">
        <h2>⏳ 評価期間の延長の上限（参拝者→氏子までの日数）</h2>
        <p class="note">期間内に氏子になった <strong>{n(d.promoteDays.sample)}人</strong>。中央値 <strong>{n(d.promoteDays.median)}日</strong>／9割が <strong>{n(d.promoteDays.p90)}日</strong>以内／最長 <strong>{n(d.promoteDays.max)}日</strong>。</p>
        <BucketTable caption="参拝者→氏子までの日数" head="かかった日数" rows={d.promoteDays.buckets} />
      </section>

      <section class="card">
        <h2>🛡 お守りを買える時間の目安（縁側の浮上）</h2>
        <div class="admin-table-scroll" tabIndex={0} role="region" aria-label="週ごとの浮上（何日来たか）">
          <table><caption>週ごと（月〜日）：縁側に来た人数と、来た人の平均日数</caption>
            <thead><tr><th scope="col">週（月〜）</th><th scope="col">来た人数</th><th scope="col">来た人の平均日数</th></tr></thead>
            <tbody>{d.surfaceWeekly.length ? d.surfaceWeekly.map((w) => <tr><th scope="row">{md(w.bucket)}〜</th><td>{n(w.came)}人</td><td>{one(w.avgDays)}日</td></tr>) : <tr><td colSpan={3}>記録がありません。</td></tr>}</tbody>
          </table>
        </div>
        <BucketTable caption="1週間に縁側へ来た日数の分布（人×週）" head="週に来た日数" rows={d.surfaceDaysCame} />
        <div class="admin-table-scroll" tabIndex={0} role="region" aria-label="◯時間以上いた人数">
          <table><caption>期間中に縁側へ◯時間以上いた人数</caption>
            <thead><tr><th scope="col">縁側の合計</th><th scope="col">人数</th></tr></thead>
            <tbody>{d.surfaceHours.map((r) => <tr><th scope="row">{n(r.hours)}時間以上</th><td>{n(r.people)}人</td></tr>)}</tbody>
          </table>
        </div>
        <h3>週ごとの縁側の浮上時間ランキング（上位10）</h3>
        {d.surfaceWeekly.length ? [...d.surfaceWeekly].reverse().map((w) => (
          <details>
            <summary>{md(w.bucket)}〜 の週（{n(w.came)}人）</summary>
            <div class="admin-table-scroll" tabIndex={0} role="region" aria-label={`${md(w.bucket)}の浮上ランキング`}>
              <table>
                <thead><tr><th scope="col">順位</th><th scope="col">名前</th><th scope="col">縁側の合計</th></tr></thead>
                <tbody>{w.top.length ? w.top.map((r, i) => <tr><td>{i + 1}位</td><th scope="row"><a href={'/members/' + r.memberId}>{r.name}</a></th><td>{hrs(r.minutes)}時間（{n(r.minutes)}分）</td></tr>) : <tr><td colSpan={3}>記録がありません。</td></tr>}</tbody>
              </table>
            </div>
          </details>
        )) : <p class="note">記録がありません。</p>}
      </section>
    </Layout>
  );
}

import type { AdminSession } from '../../db/schema.js';
import { TREND_RANGES, type TrendBucket, type TrendRange } from '../../services/stats.js';
import { ColumnChart, LineChart } from './charts.js';
import { Layout } from './layout.js';

const fmt = (n: number) => n.toLocaleString('ja-JP');
const hours = (min: number) => (min / 60).toLocaleString('ja-JP', { maximumFractionDigits: 1 });
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '±0');

export function StatsPage(props: { session: AdminSession; range: TrendRange; buckets: TrendBucket[] }) {
  const b = props.buckets;
  const points = b.map((x) => ({ label: x.label, title: x.title }));
  const joined = b.reduce((n, x) => n + x.joined, 0);
  const left = b.reduce((n, x) => n + x.left, 0);
  const now = b.at(-1)?.members ?? 0;
  const per = TREND_RANGES[props.range].unit === 'day' ? '1 日ごと' : TREND_RANGES[props.range].unit === 'week' ? '1 週ごと' : '1 か月ごと';
  return (
    <Layout title="推移" session={props.session} nav="stats">
      <h1>推移</h1>
      <nav class="tabs" aria-label="期間">
        {(Object.keys(TREND_RANGES) as TrendRange[]).map((r) => (
          <a href={`/stats?range=${r}`} class={r === props.range ? 'on' : ''} aria-current={r === props.range ? 'page' : undefined}>
            {TREND_RANGES[r].label}
          </a>
        ))}
      </nav>

      <div class="stats">
        <div class="stat">
          <div class="label">今の人数</div>
          <div class="value">
            {fmt(now)}
            <small>人</small>
          </div>
        </div>
        <div class="stat">
          <div class="label">この期間に入った</div>
          <div class="value">
            {fmt(joined)}
            <small>人</small>
          </div>
        </div>
        <div class="stat">
          <div class="label">この期間に抜けた</div>
          <div class="value">
            {fmt(left)}
            <small>人</small>
          </div>
        </div>
        <div class="stat">
          <div class="label">増減</div>
          <div class="value">
            {signed(joined - left)}
            <small>人</small>
          </div>
        </div>
      </div>

      <section class="card">
        <h2>サーバーにいる人数</h2>
        <p class="note">各区切りの最後の日の終わりの人数です（BOT を除く。入り直した人は最後に入った日で数えます）。</p>
        <LineChart points={points} values={b.map((x) => x.members)} unit="人" label="サーバーにいる人数の推移" />
      </section>

      <section class="card">
        <h2>入った人・抜けた人（{per}）</h2>
        <ColumnChart
          points={points}
          up={{ name: '入った', values: b.map((x) => x.joined) }}
          down={{ name: '抜けた', values: b.map((x) => x.left) }}
          unit="人"
          label="入った人（上）と抜けた人（下）"
        />
      </section>

      <section class="card">
          <h2>朱印（{per}）</h2>
          <ColumnChart points={points} up={{ name: '朱印', values: b.map((x) => x.shuin) }} unit="件" label="押された朱印の数" />
        </section>
        <section class="card">
          <h2>通話（{per}・時間）</h2>
          <ColumnChart points={points} up={{ name: '通話', values: b.map((x) => x.vcMinutes / 60) }} unit="時間" label="みんなの通話時間の合計" format={(v) => v.toLocaleString('ja-JP', { maximumFractionDigits: 1 })} />
        </section>

      <section class="card">
        <h2>発言（{per}）</h2>
        <ColumnChart points={points} up={{ name: '発言', values: b.map((x) => x.messages) }} unit="件" label="メッセージの数" />
      </section>

      <details class="card">
        <summary>表で見る</summary>
        <div class="table-wrap">
          <table class="compact">
            <thead>
              <tr>
                <th>期間</th>
                <th class="num">人数</th>
                <th class="num">入った</th>
                <th class="num">抜けた</th>
                <th class="num">朱印</th>
                <th class="num">発言</th>
                <th class="num">通話（時間）</th>
              </tr>
            </thead>
            <tbody>
              {[...b].reverse().map((x) => (
                <tr>
                  <td>{x.title}</td>
                  <td class="num">{fmt(x.members)}</td>
                  <td class="num">{fmt(x.joined)}</td>
                  <td class="num">{fmt(x.left)}</td>
                  <td class="num">{fmt(x.shuin)}</td>
                  <td class="num">{fmt(x.messages)}</td>
                  <td class="num">{hours(x.vcMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Layout>
  );
}

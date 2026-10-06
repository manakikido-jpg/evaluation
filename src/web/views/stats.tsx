import type { AdminSession } from '../../db/schema.js';
import { femaleShare, totalOf, type ActivityStats, type GenderBucket, type GenderNow, type SexCount } from '../../services/genderStats.js';
import { TREND_RANGES, type TrendBucket, type TrendRange, type TrendUnit } from '../../services/stats.js';
import { ColumnChart, Heatmap, LineChart, MultiLineChart, ShareBars, StackedColumnChart } from './charts.js';
import { Layout } from './layout.js';

const fmt = (n: number) => n.toLocaleString('ja-JP');
const hours = (min: number) => (min / 60).toLocaleString('ja-JP', { maximumFractionDigits: 1 });
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '±0');

export type StatsView = 'overview' | 'gender' | 'active';
const VIEWS: [StatsView, string][] = [
  ['overview', '📈 全体'],
  ['gender', '👫 男女'],
  ['active', '🌙 浮上・時間帯'],
];
export const isStatsView = (v: unknown): v is StatsView => VIEWS.some(([k]) => k === v);

/** 前の期間とくらべた増減（▲▼ と文字で。色だけにしない） */
function Delta(props: { now: number; before: number | undefined; label?: string; unit?: string; format?: (n: number) => string }) {
  if (props.before === undefined) return null;
  const d = props.now - props.before;
  const f = props.format ?? fmt;
  const text = d === 0 ? '±0' : `${d > 0 ? '+' : '−'}${f(Math.abs(d))}`;
  return (
    <span class={`delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}`}>
      {props.label ?? '前の期間より'} {text}
      {props.unit ?? ''}
    </span>
  );
}

/** 7 日の平均（はじめの 6 日は出さない） */
export const ma7 = (values: number[]): (number | null)[] => values.map((_, i) => (i < 6 ? null : Math.round((values.slice(i - 6, i + 1).reduce((a, b) => a + b, 0) / 7) * 10) / 10));
const AVG_NAME = '7 日の平均';

/** 前の期間（同じ長さ）の合計 */
export type StatsPrev = {
  overview?: { members: number; joined: number; left: number; shuin: number; messages: number; vcMinutes: number };
  gender?: { members: SexCount; joined: SexCount };
  active?: { people: number; vcMinutes: number; messages: number };
};

export function StatsPage(props: {
  session: AdminSession;
  /** custom: 日付で選んだ期間 */
  range: TrendRange | 'custom';
  span: { from: string; to: string };
  unit: TrendUnit;
  view?: StatsView;
  buckets: TrendBucket[];
  gender?: GenderBucket[];
  genderNow?: GenderNow;
  activity?: ActivityStats;
  prev?: StatsPrev;
  /** 選べるいちばん古い日（日付で選ぶ欄の min） */
  minDate?: string;
  today?: string;
}) {
  const view = props.view ?? 'overview';
  const b = props.buckets;
  const points = b.map((x) => ({ label: x.label, title: x.title }));
  const joined = b.reduce((n, x) => n + x.joined, 0);
  const left = b.reduce((n, x) => n + x.left, 0);
  const now = b.at(-1)?.members ?? 0;
  const per = props.unit === 'day' ? '1 日ごと' : props.unit === 'week' ? '1 週ごと' : '1 か月ごと';
  const daily = props.unit === 'day';
  const pv = props.prev?.overview;
  const q = props.range === 'custom' ? `from=${props.span.from}&to=${props.span.to}` : `range=${props.range}`;
  return (
    <Layout title="推移" session={props.session} nav="stats" scripts={['charts.js']}>
      <h1>📈 推移</h1>
      <nav class="tabs" aria-label="期間">
        {(Object.keys(TREND_RANGES) as TrendRange[]).map((r) => (
          <a href={`/stats?range=${r}&view=${view}`} class={r === props.range ? 'on' : ''} aria-current={r === props.range ? 'page' : undefined}>
            {TREND_RANGES[r].label}
          </a>
        ))}
      </nav>
      <form method="get" action="/stats" class="span-form">
        <input type="hidden" name="view" value={view} />
        <span>📅 日付で選ぶ:</span>
        <input type="date" name="from" value={props.span.from} min={props.minDate} max={props.today} aria-label="はじめの日" required />
        〜
        <input type="date" name="to" value={props.span.to} min={props.minDate} max={props.today} aria-label="おわりの日" required />
        <button type="submit" class={props.range === 'custom' ? 'ok' : ''}>
          表示
        </button>
        <small class="note">
          {props.span.from.replaceAll('-', '/')}〜{props.span.to.replaceAll('-', '/')}（{per}）。45 日までは 1 日ごと・200 日までは 1 週ごと・それより長いと 1 か月ごと
        </small>
      </form>
      <nav class="tabs stats-views" aria-label="見るもの">
        {VIEWS.map(([k, label]) => (
          <a href={`/stats?${q}&view=${k}`} class={k === view ? 'on' : ''} aria-current={k === view ? 'page' : undefined}>
            {label}
          </a>
        ))}
      </nav>
      {view === 'gender' && props.gender && props.genderNow && <GenderSections buckets={props.gender} now={props.genderNow} per={per} daily={daily} prev={props.prev?.gender} />}
      {view === 'active' && props.activity && <ActiveSections a={props.activity} per={per} daily={daily} prev={props.prev?.active} />}
      {view === 'overview' && (
        <>

      <div class="stats">
        <div class="stat">
          <div class="label">{props.range === 'custom' ? '期間のおわりの人数' : '今の人数'}</div>
          <div class="value">
            {fmt(now)}
            <small>人</small>
          </div>
          <Delta now={now} before={pv?.members} label="期間のはじめより" unit="人" />
        </div>
        <div class="stat">
          <div class="label">この期間に入った</div>
          <div class="value">
            {fmt(joined)}
            <small>人</small>
          </div>
          <Delta now={joined} before={pv?.joined} unit="人" />
        </div>
        <div class="stat">
          <div class="label">この期間に抜けた</div>
          <div class="value">
            {fmt(left)}
            <small>人</small>
          </div>
          <Delta now={left} before={pv?.left} unit="人" />
        </div>
        <div class="stat">
          <div class="label">増減</div>
          <div class="value">
            {signed(joined - left)}
            <small>人</small>
          </div>
          <Delta now={joined - left} before={pv ? pv.joined - pv.left : undefined} unit="人" />
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
          avg={daily ? { name: `入った人の${AVG_NAME}`, values: ma7(b.map((x) => x.joined)) } : undefined}
        />
      </section>

      <section class="card">
          <h2>朱印（{per}）</h2>
          <ColumnChart points={points} up={{ name: '朱印', values: b.map((x) => x.shuin) }} unit="件" label="押された朱印の数" avg={daily ? { name: AVG_NAME, values: ma7(b.map((x) => x.shuin)) } : undefined} />
        </section>
        <section class="card">
          <h2>通話（{per}・時間）</h2>
          <ColumnChart
            points={points}
            up={{ name: '通話', values: b.map((x) => x.vcMinutes / 60) }}
            unit="時間"
            label="みんなの通話時間の合計"
            format={(v) => v.toLocaleString('ja-JP', { maximumFractionDigits: 1 })}
            avg={daily ? { name: AVG_NAME, values: ma7(b.map((x) => x.vcMinutes / 60)) } : undefined}
          />
        </section>

      <section class="card">
        <h2>発言（{per}）</h2>
        <ColumnChart points={points} up={{ name: '発言', values: b.map((x) => x.messages) }} unit="件" label="メッセージの数" avg={daily ? { name: AVG_NAME, values: ma7(b.map((x) => x.messages)) } : undefined} />
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
        </>
      )}
    </Layout>
  );
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');
const SEX_PARTS = (c: SexCount) => [
  { name: '男性', cls: 's2' as const, value: c.male },
  { name: '女性', cls: 's1' as const, value: c.female },
  { name: '不明', cls: 's3' as const, value: c.unknown },
];
const sum = (list: SexCount[]): SexCount => list.reduce((a, c) => ({ male: a.male + c.male, female: a.female + c.female, unknown: a.unknown + c.unknown }), { male: 0, female: 0, unknown: 0 });
const oneDecimal = (v: number) => v.toLocaleString('ja-JP', { maximumFractionDigits: 1 });

/** 👫 男女（今の割合・位や年齢ごと・入った人／抜けた人の男女・割合の推移・定着） */
function GenderSections(props: { buckets: GenderBucket[]; now: GenderNow; per: string; daily: boolean; prev?: { members: SexCount; joined: SexCount } }) {
  const b = props.buckets;
  const nw = props.now;
  const points = b.map((x) => ({ label: x.label, title: x.title }));
  const joined = sum(b.map((x) => x.joined));
  const left = sum(b.map((x) => x.left));
  const all = nw.all;
  const share = femaleShare(all);
  const daily = props.per === '1 日ごと';
  return (
    <>
      <h2 class="section-title" id="gender">
        👫 男女の割合
      </h2>
      <p class="note">性別は、男性・女性のロール → なければ入鯖申請の答え → どちらもなければ「不明」で数えます。抜けた人は抜けたときのロールで数えます。割合（%）は性別の分かる人のうちの女性の割合です。</p>
      <div class="stats">
        <div class="stat">
          <div class="label">今いる男性</div>
          <div class="value">
            {fmt(all.male)}
            <small>人（{pct(all.male, totalOf(all))}）</small>
          </div>
          <Delta now={b.at(-1)?.members.male ?? all.male} before={props.prev?.members.male} label="期間のはじめより" unit="人" />
        </div>
        <div class="stat">
          <div class="label">今いる女性</div>
          <div class="value">
            {fmt(all.female)}
            <small>人（{pct(all.female, totalOf(all))}）</small>
          </div>
          <Delta now={b.at(-1)?.members.female ?? all.female} before={props.prev?.members.female} label="期間のはじめより" unit="人" />
        </div>
        <div class="stat">
          <div class="label">不明</div>
          <div class="value">
            {fmt(all.unknown)}
            <small>人</small>
          </div>
        </div>
        <div class="stat">
          <div class="label">男女比（男:女）</div>
          <div class="value">{share === null ? '—' : `${Math.round(100 - share)}:${Math.round(share)}`}</div>
        </div>
      </div>

      <section class="card">
        <h2>男女の割合（くらべる）</h2>
        <ShareBars
          label="男女の割合"
          rows={[
            { name: '今いる人', parts: SEX_PARTS(all) },
            { name: '最近 7 日に来た人', parts: SEX_PARTS(nw.active7) },
            { name: 'この期間に入った', parts: SEX_PARTS(joined) },
            { name: 'この期間に抜けた', parts: SEX_PARTS(left) },
          ]}
        />
        <p class="note">「最近 7 日に来た人」は、7 日以内に発言・通話した人です。</p>
      </section>

      <section class="card">
        <h2>入った人の男女（{props.per}）</h2>
        <StackedColumnChart
          points={points}
          series={[
            { name: '男性', cls: 's2', values: b.map((x) => x.joined.male) },
            { name: '女性', cls: 's1', values: b.map((x) => x.joined.female) },
            { name: '不明', cls: 's3', values: b.map((x) => x.joined.unknown) },
          ]}
          unit="人"
          label="入った人の男女"
          avg={props.daily ? { name: AVG_NAME, values: ma7(b.map((x) => totalOf(x.joined))) } : undefined}
        />
      </section>

      <section class="card">
        <h2>抜けた人の男女（{props.per}）</h2>
        <StackedColumnChart
          points={points}
          series={[
            { name: '男性', cls: 's2', values: b.map((x) => x.left.male) },
            { name: '女性', cls: 's1', values: b.map((x) => x.left.female) },
            { name: '不明', cls: 's3', values: b.map((x) => x.left.unknown) },
          ]}
          unit="人"
          label="抜けた人の男女"
        />
      </section>

      <section class="card">
        <h2>いる人数の男女の推移</h2>
        <MultiLineChart
          points={points}
          series={[
            { name: '男性', cls: 's2', values: b.map((x) => x.members.male) },
            { name: '女性', cls: 's1', values: b.map((x) => x.members.female) },
            { name: '不明', cls: 's3', values: b.map((x) => x.members.unknown) },
          ]}
          unit="人"
          label="サーバーにいる男性・女性・不明の人数の推移"
        />
      </section>

      <section class="card">
        <h2>女性の割合の推移（%）</h2>
        <MultiLineChart
          points={points}
          max={100}
          format={oneDecimal}
          series={[
            { name: 'いる人', cls: 's1', values: b.map((x) => femaleShare(x.members)) },
            { name: daily ? '入った人（その日までの 7 日）' : 'その区切りに入った人', cls: 's2', values: b.map((_, i) => femaleShare(daily ? sum(b.slice(Math.max(0, i - 6), i + 1).map((x) => x.joined)) : b[i]!.joined)) },
          ]}
          unit="%"
          label="女性の割合の推移"
        />
        <p class="note">
          {daily ? '1 日ごとだと人数が少なくて上下しやすいので、入った人はその日までの 7 日分を合わせた割合です。' : ''}入った人がいない区切り・性別の分かる人がいない区切りは線を切っています。
        </p>
      </section>

      <section class="card">
        <h2>位・年齢ごとの男女</h2>
        <ShareBars label="位ごとの男女" rows={nw.byRank.map((r) => ({ name: r.name, parts: SEX_PARTS(r.count) }))} />
        <ShareBars label="年齢ごとの男女" rows={nw.byAge.map((r) => ({ name: r.name, parts: SEX_PARTS(r.count) }))} />
      </section>

      <section class="card">
        <h2>定着（入った人のうち、今もいる人）</h2>
        <div class="table-wrap">
          <table class="compact">
            <thead>
              <tr>
                <th>入った時期</th>
                <th class="num">男性</th>
                <th class="num">女性</th>
                <th class="num">不明</th>
                <th class="num">全体</th>
              </tr>
            </thead>
            <tbody>
              {nw.stay.map((s) => (
                <tr>
                  <td>最近 {s.days} 日</td>
                  {(['male', 'female', 'unknown'] as const).map((k) => (
                    <td class="num">
                      {fmt(s.stayed[k])}/{fmt(s.joined[k])} 人<br />
                      <b>{pct(s.stayed[k], s.joined[k])}</b>
                    </td>
                  ))}
                  <td class="num">
                    {fmt(totalOf(s.stayed))}/{fmt(totalOf(s.joined))} 人<br />
                    <b>{pct(totalOf(s.stayed), totalOf(s.joined))}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <details class="card">
        <summary>男女の表で見る</summary>
        <div class="table-wrap">
          <table class="compact">
            <thead>
              <tr>
                <th>期間</th>
                <th class="num">いる 男/女/不明</th>
                <th class="num">女性の割合</th>
                <th class="num">入った 男/女/不明</th>
                <th class="num">入った女性の割合</th>
                <th class="num">抜けた 男/女/不明</th>
              </tr>
            </thead>
            <tbody>
              {[...b].reverse().map((x) => {
                const a = femaleShare(x.members);
                const j = femaleShare(x.joined);
                return (
                  <tr>
                    <td>{x.title}</td>
                    <td class="num">
                      {fmt(x.members.male)}/{fmt(x.members.female)}/{fmt(x.members.unknown)}
                    </td>
                    <td class="num">{a === null ? '—' : `${oneDecimal(a)}%`}</td>
                    <td class="num">
                      {fmt(x.joined.male)}/{fmt(x.joined.female)}/{fmt(x.joined.unknown)}
                    </td>
                    <td class="num">{j === null ? '—' : `${oneDecimal(j)}%`}</td>
                    <td class="num">
                      {fmt(x.left.male)}/{fmt(x.left.female)}/{fmt(x.left.unknown)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

/** 🌙 浮上（発言・通話）の男女と時間帯 */
function ActiveSections(props: { a: ActivityStats; per: string; daily: boolean; prev?: { people: number; vcMinutes: number; messages: number } }) {
  const { a } = props;
  const b = a.buckets;
  const points = b.map((x) => ({ label: x.label, title: x.title }));
  const vc = sum(b.map((x) => x.vcMinutes));
  const msg = sum(b.map((x) => x.messages));
  const avgPeople = sum(b.map((x) => x.people));
  const hourPts = a.hours.map((h) => ({ label: `${h.hour}時`, title: `${h.hour}時台` }));
  const total = (c: SexCount) => c.male + c.female + c.unknown;
  const peak = [...a.hours].sort((x, y) => total(y.people) - total(x.people))[0];
  const quiet = [...a.hours].sort((x, y) => total(x.people) - total(y.people))[0];
  const hrs = (min: number) => min / 60;
  return (
    <>
      <p class="note">
        浮上 = その区切りに 1 回でも発言したか、通話にいた人（AFK・BOT はのぞく）。男女の分け方は「👫 男女」と同じです。時間帯のグラフは、記録のある日の 1 日あたりの平均です
        {a.days ? `（${a.days} 日分）` : ''}。
      </p>
      <div class="stats">
        <div class="stat">
          <div class="label">いちばん人が多い時間</div>
          <div class="value">{a.days && peak ? `${peak.hour}時台` : '—'}</div>
          {a.days > 0 && peak && <small class="note">平均 {oneDecimal(total(peak.people))} 人</small>}
        </div>
        <div class="stat">
          <div class="label">いちばん静かな時間</div>
          <div class="value">{a.days && quiet ? `${quiet.hour}時台` : '—'}</div>
          {a.days > 0 && quiet && <small class="note">平均 {oneDecimal(total(quiet.people))} 人</small>}
        </div>
        <div class="stat">
          <div class="label">通話の時間（男:女）</div>
          <div class="value">{vc.male + vc.female ? `${Math.round((vc.male / (vc.male + vc.female)) * 100)}:${Math.round((vc.female / (vc.male + vc.female)) * 100)}` : '—'}</div>
        </div>
        <div class="stat">
          <div class="label">発言（男:女）</div>
          <div class="value">{msg.male + msg.female ? `${Math.round((msg.male / (msg.male + msg.female)) * 100)}:${Math.round((msg.female / (msg.male + msg.female)) * 100)}` : '—'}</div>
        </div>
      </div>

      <div class="stats">
        <div class="stat">
          <div class="label">浮上した人（のべ）</div>
          <div class="value">
            {fmt(totalOf(avgPeople))}
            <small>人</small>
          </div>
          <Delta now={totalOf(avgPeople)} before={props.prev?.people} unit="人" />
        </div>
        <div class="stat">
          <div class="label">通話の時間</div>
          <div class="value">
            {oneDecimal(hrs(totalOf(vc)))}
            <small>時間</small>
          </div>
          <Delta now={Math.round(hrs(totalOf(vc)) * 10) / 10} before={props.prev ? Math.round(hrs(props.prev.vcMinutes) * 10) / 10 : undefined} unit="時間" format={oneDecimal} />
        </div>
        <div class="stat">
          <div class="label">発言</div>
          <div class="value">
            {fmt(totalOf(msg))}
            <small>件</small>
          </div>
          <Delta now={totalOf(msg)} before={props.prev?.messages} unit="件" />
        </div>
      </div>

      <section class="card">
        <h2>浮上の男女（この期間の合計）</h2>
        <ShareBars
          label="浮上の男女"
          rows={[
            { name: '浮上した人（のべ）', parts: SEX_PARTS(avgPeople) },
            { name: '通話の時間', unit: '時間', parts: SEX_PARTS({ male: Math.round(hrs(vc.male)), female: Math.round(hrs(vc.female)), unknown: Math.round(hrs(vc.unknown)) }) },
            { name: '発言の数', unit: '件', parts: SEX_PARTS(msg) },
          ]}
        />
        <p class="note">「浮上した人（のべ）」は区切りごとの人数の合計です（毎日来る人は日数ぶん数えます）。</p>
      </section>

      <section class="card">
        <h2>浮上した人の男女（{props.per}）</h2>
        <StackedColumnChart
          points={points}
          series={[
            { name: '男性', cls: 's2', values: b.map((x) => x.people.male) },
            { name: '女性', cls: 's1', values: b.map((x) => x.people.female) },
            { name: '不明', cls: 's3', values: b.map((x) => x.people.unknown) },
          ]}
          unit="人"
          label="浮上した人の男女"
          avg={props.daily ? { name: AVG_NAME, values: ma7(b.map((x) => totalOf(x.people))) } : undefined}
        />
      </section>

      <section class="card">
        <h2>通話の時間の男女（{props.per}）</h2>
        <StackedColumnChart
          points={points}
          series={[
            { name: '男性', cls: 's2', values: b.map((x) => Math.round(hrs(x.vcMinutes.male) * 10) / 10) },
            { name: '女性', cls: 's1', values: b.map((x) => Math.round(hrs(x.vcMinutes.female) * 10) / 10) },
            { name: '不明', cls: 's3', values: b.map((x) => Math.round(hrs(x.vcMinutes.unknown) * 10) / 10) },
          ]}
          unit="時間"
          label="通話の時間の男女"
          avg={props.daily ? { name: AVG_NAME, values: ma7(b.map((x) => Math.round(hrs(totalOf(x.vcMinutes)) * 10) / 10)) } : undefined}
        />
      </section>

      {a.days > 0 ? (
        <>
          <section class="card">
            <h2>時間帯ごとの浮上（1 日あたりの平均の人数）</h2>
            <StackedColumnChart
              points={hourPts}
              series={[
                { name: '男性', cls: 's2', values: a.hours.map((h) => h.people.male) },
                { name: '女性', cls: 's1', values: a.hours.map((h) => h.people.female) },
                { name: '不明', cls: 's3', values: a.hours.map((h) => h.people.unknown) },
              ]}
              unit="人"
              label="時間帯ごとの浮上した人数（平均）"
            />
            <p class="note">その時間台（例: 21時台 = 21:00〜21:59）に 1 回でも発言したか、通話にいた人の数です。</p>
          </section>

          <section class="card">
            <h2>時間帯ごとの通話（平均で何人が通話にいたか）</h2>
            <StackedColumnChart
              points={hourPts}
              series={[
                { name: '男性', cls: 's2', values: a.hours.map((h) => Math.round((h.vcMinutes.male / 60) * 10) / 10) },
                { name: '女性', cls: 's1', values: a.hours.map((h) => Math.round((h.vcMinutes.female / 60) * 10) / 10) },
                { name: '不明', cls: 's3', values: a.hours.map((h) => Math.round((h.vcMinutes.unknown / 60) * 10) / 10) },
              ]}
              unit="人"
              label="時間帯ごとに通話にいた人数（平均）"
            />
            <p class="note">その 1 時間ずっと通話にいた人を 1 人として数えています（30 分なら 0.5 人）。</p>
          </section>

          <section class="card">
            <h2>曜日 × 時間帯（浮上した人数の平均）</h2>
            <Heatmap
              rows={['月', '火', '水', '木', '金', '土', '日']}
              cols={Array.from({ length: 24 }, (_, h) => `${h}時`)}
              values={a.week}
              unit="人"
              label="曜日と時間帯ごとの浮上した人数（平均）"
              format={oneDecimal}
            />
          </section>
        </>
      ) : (
        <section class="card">
          <p class="empty">時間帯の記録はまだありません。BOT が新しくなってから 1 分ごとに記録していきます（数時間たつと出てきます）。</p>
        </section>
      )}

      <details class="card">
        <summary>浮上の表で見る</summary>
        <div class="table-wrap">
          <table class="compact">
            <thead>
              <tr>
                <th>期間</th>
                <th class="num">浮上 男/女/不明</th>
                <th class="num">通話（時間）男/女/不明</th>
                <th class="num">発言 男/女/不明</th>
              </tr>
            </thead>
            <tbody>
              {[...b].reverse().map((x) => (
                <tr>
                  <td>{x.title}</td>
                  <td class="num">
                    {fmt(x.people.male)}/{fmt(x.people.female)}/{fmt(x.people.unknown)}
                  </td>
                  <td class="num">
                    {oneDecimal(hrs(x.vcMinutes.male))}/{oneDecimal(hrs(x.vcMinutes.female))}/{oneDecimal(hrs(x.vcMinutes.unknown))}
                  </td>
                  <td class="num">
                    {fmt(x.messages.male)}/{fmt(x.messages.female)}/{fmt(x.messages.unknown)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

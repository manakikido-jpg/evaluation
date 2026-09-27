import type { AdminSession, VoiceChannelRow } from '../../db/schema.js';
import { fmtMinutes, type CategoryMinutes, type MemberUsage } from '../../services/voiceUsage.js';
import { BarList, ColumnChart } from './charts.js';
import { Layout } from './layout.js';

type Names = Map<string, string>;
export const VOICE_RANGES = { 7: '7 日', 30: '30 日', 90: '90 日' } as const;
export type VoiceRange = keyof typeof VOICE_RANGES;

const hoursText = (v: number) => v.toLocaleString('ja-JP', { maximumFractionDigits: 1 });
/** 「9/27」 */
const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
const points = (daily: { date: string }[]) => daily.map((d) => ({ label: md(d.date), title: `${Number(d.date.slice(5, 7))}月${Number(d.date.slice(8, 10))}日` }));

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const who = (names: Names, id: string) => <a href={`/members/${id}`}>{names.get(id) ?? id}</a>;
const KIND: Record<string, string> = { public: '🔓 公開', invite: '🔒 招待限定', secret: '🤫 シークレット', twoshot: '💞 ツーショット' };
const jst = (d: Date) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);

/** 通話の記録（浮上時間）: 人ごと・カテゴリごと・よくいっしょにいる 2 人・自分の通話部屋 */
export function VoicePage(props: {
  session: AdminSession;
  days: VoiceRange;
  category?: string;
  categories: CategoryMinutes[];
  members: MemberUsage[];
  pairs: { memberA: string; memberB: string; minutes: number }[];
  rooms: (VoiceChannelRow & { personMinutes: number; people: number; paid: number })[];
  hubNames: Map<string, string>;
  names: Names;
  /** 日ごとの分（カテゴリを選んでいればそのカテゴリだけ） */
  daily: { date: string; minutes: number }[];
}) {
  const { names } = props;
  const all = props.categories.reduce((n, c) => n + c.minutes, 0);
  const cat = props.categories.find((c) => (c.categoryId ?? 'none') === props.category);
  const catMin = (m: MemberUsage) => m.byCategory.find((c) => (c.categoryId ?? 'none') === props.category)?.minutes ?? 0;
  const rows = cat ? [...props.members].filter((m) => catMin(m) > 0).sort((a, b) => catMin(b) - catMin(a)) : props.members;
  const q = (days: number, category?: string) => `/voice?days=${days}${category ? `&cat=${category}` : ''}`;
  return (
    <Layout title="通話の記録" session={props.session} nav="voice">
      <h1>通話の記録（浮上時間）</h1>
      <p class="note">
        BOT が 1 分ごとに、だれがどの通話に何分いたか・だれといっしょだったかを記録しています（AFK はのぞく。1 人でいた時間も入ります）。運営を任せる人・イベントを計画してもらう人を選ぶときや、部屋の使われ方を見るときに使ってください。
      </p>
      <nav class="tabs" aria-label="期間">
        {(Object.keys(VOICE_RANGES).map(Number) as VoiceRange[]).map((d) => (
          <a href={q(d, props.category)} class={d === props.days ? 'on' : ''} aria-current={d === props.days ? 'page' : undefined}>
            {VOICE_RANGES[d]}
          </a>
        ))}
      </nav>

      <section class="card">
        <h2>{cat ? `${cat.categoryName} の通話時間（日ごと）` : 'みんなの通話時間（日ごと）'}</h2>
        <ColumnChart
          points={points(props.daily)}
          up={{ name: '通話', values: props.daily.map((d) => d.minutes / 60) }}
          unit="時間"
          label={cat ? `${cat.categoryName} の日ごとの通話時間` : '日ごとの通話時間の合計'}
          format={hoursText}
        />
        <p class="note">のべ時間です（2 人が 1 時間いたら 2 時間）。棒にマウスを乗せると、その日の時間が出ます。</p>
      </section>

      <section class="card">
        <h2>カテゴリ（エリア）ごと</h2>
        {props.categories.length > 0 && (
          <BarList rows={props.categories.map((c) => ({ name: c.categoryName, value: c.minutes / 60 }))} unit="時間" label="カテゴリごとの通話時間" format={hoursText} />
        )}
        {props.categories.length === 0 ? (
          <p class="empty">まだ記録がありません。</p>
        ) : (
          <table class="compact">
            <thead>
              <tr>
                <th>カテゴリ</th>
                <th class="num">のべ時間</th>
                <th class="num">割合</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {props.categories.map((c) => (
                <tr>
                  <td>{c.categoryName}</td>
                  <td class="num">{fmtMinutes(c.minutes)}</td>
                  <td class="num">{pct(c.minutes, all)}</td>
                  <td>
                    <a href={q(props.days, c.categoryId ?? 'none')}>この場所で多い人 →</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section class="card">
        <h2>
          人ごとの浮上時間{cat ? `（${cat.categoryName} が多い順）` : '（合計が多い順）'}
          {cat && (
            <small>
              {' '}
              <a href={q(props.days)}>すべて</a>
            </small>
          )}
        </h2>
        <div class="table-wrap">
          <table class="members">
            <thead>
              <tr>
                <th>#</th>
                <th>メンバー</th>
                <th class="num">合計</th>
                {cat && <th class="num">{cat.categoryName}</th>}
                {cat && <th class="num">その人の中の割合</th>}
                <th>多い場所</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 100).map((m, i) => (
                <tr>
                  <td>{i + 1}</td>
                  <td>{who(names, m.memberId)}</td>
                  <td class="num">{fmtMinutes(m.total)}</td>
                  {cat && <td class="num">{fmtMinutes(catMin(m))}</td>}
                  {cat && <td class="num">{pct(catMin(m), m.total)}</td>}
                  <td class="wrap">
                    {m.byCategory
                      .slice(0, 3)
                      .map((c) => `${c.categoryName} ${pct(c.minutes, m.total)}`)
                      .join('・')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <h2>よくいっしょにいる 2 人</h2>
        {props.pairs.length === 0 ? (
          <p class="empty">まだ記録がありません。</p>
        ) : (
          <table class="compact">
            <tbody>
              {props.pairs.map((p) => (
                <tr>
                  <td>
                    {who(names, p.memberA)} ・ {who(names, p.memberB)}
                  </td>
                  <td class="num">{fmtMinutes(p.minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section class="card">
        <h2>自分の通話部屋（宿坊・宵宮・縁側など）</h2>
        <p class="note">ひらいた部屋ごとに、作った人・種類・ひらいていた時間・入った人数・のべ時間・払われた花びら（部屋代）です。</p>
        {props.rooms.length === 0 ? (
          <p class="empty">この期間の部屋はありません。</p>
        ) : (
          <div class="table-wrap">
            <table class="members">
              <thead>
                <tr>
                  <th>ひらいた</th>
                  <th>部屋</th>
                  <th>入口</th>
                  <th>作った人</th>
                  <th>種類</th>
                  <th class="num">ひらいていた</th>
                  <th class="num">人数</th>
                  <th class="num">のべ時間</th>
                  <th class="num">部屋代</th>
                </tr>
              </thead>
              <tbody>
                {props.rooms.map((r) => (
                  <tr>
                    <td>{jst(r.firstSeen)}</td>
                    <td>{r.name}</td>
                    <td>{(r.hubId && props.hubNames.get(r.hubId)) ?? r.categoryName ?? '—'}</td>
                    <td>{r.ownerId ? who(names, r.ownerId) : '—'}</td>
                    <td>{(r.kind && KIND[r.kind]) ?? '—'}</td>
                    <td class="num">{fmtMinutes(Math.max(1, Math.round((r.lastSeen.getTime() - r.firstSeen.getTime()) / 60_000)))}</td>
                    <td class="num">{r.people}</td>
                    <td class="num">{fmtMinutes(r.personMinutes)}</td>
                    <td class="num">{r.paid ? `${r.paid} 枚` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Layout>
  );
}

/** メンバーのページ: 通話の記録（30 日） */
export function MemberVoiceSection(props: {
  daily?: { date: string; minutes: number }[];
  total: number;
  byCategory: CategoryMinutes[];
  channels: { channelId: string; name: string; hubId: string | null; kind: string | null; minutes: number }[];
  partners: { memberId: string; minutes: number }[];
  names: Names;
}) {
  return (
    <section class="card">
      <h2>通話の記録（30 日）</h2>
      {props.total === 0 ? (
        <p class="empty">この 30 日は通話にいません。</p>
      ) : (
        <div class="grid2">
          <div>
            <p>
              合計 <strong>{fmtMinutes(props.total)}</strong>
            </p>
            {props.daily && (
              <ColumnChart
                points={points(props.daily)}
                up={{ name: '通話', values: props.daily.map((d) => d.minutes / 60) }}
                unit="時間"
                label="この人の日ごとの通話時間"
                format={hoursText}
              />
            )}
            <h3>場所ごと</h3>
            <ul>
              {props.byCategory.map((c) => (
                <li>
                  {c.categoryName}: {fmtMinutes(c.minutes)}（{pct(c.minutes, props.total)}）
                </li>
              ))}
            </ul>
            <h3>よくいた通話</h3>
            <ul>
              {props.channels.map((c) => (
                <li>
                  {c.name}
                  {c.kind && KIND[c.kind] ? `（${KIND[c.kind]}）` : ''}: {fmtMinutes(c.minutes)}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>よくいっしょにいる人</h3>
            {props.partners.length === 0 ? (
              <p class="empty">—</p>
            ) : (
              <ul>
                {props.partners.map((p) => (
                  <li>
                    {who(props.names, p.memberId)}: {fmtMinutes(p.minutes)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

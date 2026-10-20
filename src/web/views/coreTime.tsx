import type { AdminSession, CoreTimeAttendance } from '../../db/schema.js';
import { fmtMinutes } from '../../services/voiceUsage.js';
import { Layout } from './layout.js';

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
/** 「10/18（土）」 */
const dayText = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}（${WEEK[new Date(`${day}T00:00:00Z`).getUTCDay()]}）`;
const hm = (d: Date) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }).format(d);

/** ⏰ コアタイムに上がった人（運営だけ） */
export function CoreTimePage(props: {
  session: AdminSession;
  coreTime: string;
  days: number;
  sessions: { day: string; slot: string; people: number; minutes: number }[];
  selected?: { day: string; slot: string };
  members: CoreTimeAttendance[];
  regulars: { memberId: string; times: number; minutes: number; lastDay: string }[];
  name: (id: string) => string;
}) {
  const sel = props.selected;
  const link = (day: string, slot: string) => `/voice/core?days=${props.days}&day=${day}&slot=${encodeURIComponent(slot)}`;
  return (
    <Layout title="コアタイムの記録" session={props.session} nav="voice">
      <h1>⏰ コアタイムに上がった人</h1>
      <p class="note">
        コアタイム（{props.coreTime}）の間、BOT が 1 分ごとに、通話にいる人を記録しています（花びらがもらえる人と同じ: AFK・BOT はのぞく）。1 分でもいれば「上がった」に数えます。
        <a href="/voice">← 通話の記録へ</a>
      </p>
      <nav class="tabs" aria-label="期間">
        {[7, 30, 90].map((d) => (
          <a href={`/voice/core?days=${d}`} class={d === props.days ? 'on' : ''} aria-current={d === props.days ? 'page' : undefined}>
            {d} 日
          </a>
        ))}
      </nav>

      <section class="card">
        <h2>コアタイムごと</h2>
        {props.sessions.length ? (
          <table class="compact">
            <thead>
              <tr>
                <th>日</th>
                <th>始まり</th>
                <th class="num">上がった人</th>
                <th class="num">のべ時間</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {props.sessions.map((s) => (
                <tr class={sel && sel.day === s.day && sel.slot === s.slot ? 'on' : ''}>
                  <td>{dayText(s.day)}</td>
                  <td>{s.slot}</td>
                  <td class="num">{s.people} 人</td>
                  <td class="num">{fmtMinutes(s.minutes)}</td>
                  <td>
                    <a href={link(s.day, s.slot)}>だれが来たか</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p class="empty">この期間のコアタイムの記録はまだありません。</p>
        )}
      </section>

      {sel && (
        <section class="card" id="core-members">
          <h2>
            {dayText(sel.day)} {sel.slot} からのコアタイム（{props.members.length} 人）
          </h2>
          {props.members.length ? (
            <table class="compact">
              <thead>
                <tr>
                  <th>人</th>
                  <th class="num">いた時間</th>
                  <th>来た</th>
                  <th>最後にいた</th>
                  <th class="num">ボーナス</th>
                </tr>
              </thead>
              <tbody>
                {props.members.map((m) => (
                  <tr>
                    <td>
                      <a href={`/members/${m.memberId}`}>{props.name(m.memberId)}</a>
                    </td>
                    <td class="num">{fmtMinutes(m.minutes)}</td>
                    <td>{hm(m.firstAt)}</td>
                    <td>{hm(m.lastAt)}</td>
                    <td class="num">{m.bonusAt ? `🎁 ${m.bonus.toLocaleString('ja-JP')}` : '―'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p class="empty">このコアタイムに来た人はいません。</p>
          )}
        </section>
      )}

      <section class="card">
        <h2>よく来る人（{props.days} 日）</h2>
        {props.regulars.length ? (
          <table class="compact">
            <thead>
              <tr>
                <th>人</th>
                <th class="num">来た回数</th>
                <th class="num">合計の時間</th>
                <th>最後に来た日</th>
              </tr>
            </thead>
            <tbody>
              {props.regulars.map((r) => (
                <tr>
                  <td>
                    <a href={`/members/${r.memberId}`}>{props.name(r.memberId)}</a>
                  </td>
                  <td class="num">
                    {r.times} / {props.sessions.length} 回
                  </td>
                  <td class="num">{fmtMinutes(r.minutes)}</td>
                  <td>{dayText(r.lastDay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p class="empty">まだだれも来ていません。</p>
        )}
      </section>
    </Layout>
  );
}

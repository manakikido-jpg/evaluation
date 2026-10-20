import type { AdminSession, CoreTimeAttendance } from '../../db/schema.js';
import { fmtMinutes } from '../../services/voiceUsage.js';
import { TICKET_GROUPS, TICKET_LABEL } from '../../services/tickets.js';
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
  /** 銭・券の名前（プレゼントの欄） */
  coin: { emoji: string; name: string };
  /** 宮司だけ、参加者へプレゼントできる */
  canGift: boolean;
  msg?: string;
}) {
  const sel = props.selected;
  const csrf = <input type="hidden" name="_csrf" value={props.session.csrfToken} />;
  const MSG: Record<string, string> = {
    gift_given: '🎁 プレゼントしました。社務所Web の「⚙ 設定」→「今いる人に配る」の履歴から回収もできます。',
    gift_invalid: '入力を確かめてください（量・ひとこと・確認のチェック）。',
    gift_none: 'その条件に合う人がいません。',
  };
  const link = (day: string, slot: string) => `/voice/core?days=${props.days}&day=${day}&slot=${encodeURIComponent(slot)}`;
  return (
    <Layout title="コアタイム" session={props.session} nav="coretime">
      <h1>⏰ コアタイム</h1>
      {props.msg && MSG[props.msg] && <p class="flash">{MSG[props.msg]}</p>}
      <p class="note">
        コアタイム（{props.coreTime}）の間、BOT が 1 分ごとに、通話にいる人を記録しています（花びらがもらえる人と同じ: AFK・BOT はのぞく）。1 分でもいれば「上がった」に数えます。
        <a href="/voice">← 通話の記録へ</a>
      </p>
      <p class="inline-actions">
        <a href={`/voice/core.csv?days=${props.days}`} download>📥 この期間の記録を CSV で書き出す</a>
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
          <p class="inline-actions">
            <a href={`/voice/core.csv?day=${sel.day}&slot=${encodeURIComponent(sel.slot)}`} download>📥 この回を CSV で書き出す</a>
          </p>
          {props.canGift && props.members.length > 0 && (
            <form method="post" action="/voice/core/gift" class="fields">
              {csrf}
              <h3>🎁 この回の参加者へプレゼント</h3>
              <input type="hidden" name="day" value={sel.day} />
              <input type="hidden" name="slot" value={sel.slot} />
              <label class="field">
                <span>何分以上いた人に（1 で、来た人みんな）</span>
                <input type="number" name="minMinutes" min={1} max={1440} value="1" required />
              </label>
              <label class="field">
                <span>配るもの</span>
                <select name="what" required>
                  <option value="coins">
                    {props.coin.emoji} {props.coin.name}
                  </option>
                  {TICKET_GROUPS.map((g) => (
                    <optgroup label={g.label}>
                      {g.kinds.map((k) => (
                        <option value={`ticket:${k}`}>
                          {TICKET_LABEL[k].emoji} {TICKET_LABEL[k].name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label class="field">
                <span>1 人あたりの量（券は 10 枚まで）</span>
                <input type="number" name="amount" min={1} required />
              </label>
              <label class="field">
                <span>ひとこと（記録に残す）</span>
                <input type="text" name="note" maxlength={200} required value={`コアタイム ${dayText(sel.day)} ${sel.slot} のお礼`} />
              </label>
              <label class="check">
                <input type="checkbox" name="confirm" value="yes" required /> この回の参加者に配る（押すとすぐに配ります）
              </label>
              <button type="submit" class="ok">
                🎁 プレゼントする
              </button>
            </form>
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

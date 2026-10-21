import type { AdminSession, BoostTime, BoostTimeAttendance } from '../../db/schema.js';
import { fmtMinutes } from '../../services/voiceUsage.js';
import { TICKET_GROUPS, TICKET_LABEL } from '../../services/tickets.js';
import { Layout } from './layout.js';

/** 日本時間の datetime-local の値 */
const jstLocal = (d: Date) => new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 16);
const jstText = (d: Date) => jstLocal(d).replace('T', ' ').slice(5);
const hm = (d: Date) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }).format(d);

export const boostState = (b: BoostTime, now: Date) => (b.canceledAt ? 'canceled' : b.endAt <= now ? 'ended' : b.startAt <= now ? 'active' : 'upcoming');
const STATE = { upcoming: '⏳ これから', active: '🟢 記録中', ended: '終わった', canceled: 'やめた' } as const;

/** ⏱ 浮上の記録の時間（運営だけ） */
export function BoostTimePage(props: {
  session: AdminSession;
  now: Date;
  list: BoostTime[];
  /** 人数（決めた分以上いた人 / 来た人） */
  counts: Map<number, { all: number; ok: number }>;
  selected?: BoostTime;
  members: BoostTimeAttendance[];
  name: (id: string) => string;
  coin: { emoji: string; name: string };
  canEdit: boolean;
  /** 宮司だけ、プレゼントできる */
  canGift: boolean;
  msg?: string;
}) {
  const csrf = <input type="hidden" name="_csrf" value={props.session.csrfToken} />;
  const MSG: Record<string, string> = {
    created: '⏱ 作りました。始まると、BOT が 1 分ごとに通話にいる人を記録します。',
    saved: '保存しました。',
    canceled: 'やめました（記録した分は残ります）。',
    invalid: '入力を確かめてください（名前・始まり・終わり（24 時間まで）・何分以上（時間の長さまで））。',
    not_editable: '終わった・やめた時間は直せません。',
    gift_given: '🎁 プレゼントしました。社務所Web の「⚙ 設定」→「今いる人に配る」の履歴から回収もできます。',
    gift_invalid: '入力を確かめてください（量・ひとこと・確認のチェック）。',
    gift_none: '決めた分以上いた人がいません。',
    gift_already: 'この時間には、もうプレゼントしました（1 回だけです）。',
    gift_not_ended: '終わってからプレゼントできます。',
  };
  const sel = props.selected;
  const t0 = new Date(Math.ceil(props.now.getTime() / 3_600_000) * 3_600_000);
  return (
    <Layout title="浮上の記録の時間" session={props.session} nav="boosttime">
      <h1>⏱ 浮上の記録の時間</h1>
      {props.msg && MSG[props.msg] && <p class="flash">{MSG[props.msg]}</p>}
      <p class="note">
        人が少ない時間帯の浮上をふやすための、臨時の時間です。決めた時間の間、BOT が 1 分ごとに通話にいる人を記録します（花びらがもらえる人と同じ: AFK・BOT はのぞく）。終わったら、決めた分以上いた人へ、銭や券をプレゼントできます。
      </p>

      {props.canEdit && (
        <form method="post" action="/voice/boost" class="card fields">
          {csrf}
          <h2>➕ 新しく作る</h2>
          <label class="field">
            <span>名前（例: 平日お昼の浮上タイム）</span>
            <input type="text" name="title" maxlength={60} required />
          </label>
          <label class="field">
            <span>始まり（日本時間）</span>
            <input type="datetime-local" name="startAt" value={jstLocal(t0)} required />
          </label>
          <label class="field">
            <span>終わり（日本時間・24 時間まで）</span>
            <input type="datetime-local" name="endAt" value={jstLocal(new Date(t0.getTime() + 2 * 3_600_000))} required />
          </label>
          <label class="field">
            <span>何分以上いた人を数えるか</span>
            <input type="number" name="minMinutes" min={1} max={1440} value="30" required />
          </label>
          <button type="submit" class="ok">作る</button>
        </form>
      )}

      <section class="card">
        <h2>一覧</h2>
        {props.list.length ? (
          <table class="compact">
            <thead>
              <tr>
                <th>名前</th>
                <th>時間</th>
                <th class="num">何分以上</th>
                <th class="num">達成 / 来た人</th>
                <th>状態</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {props.list.map((b) => {
                const n = props.counts.get(b.id) ?? { all: 0, ok: 0 };
                return (
                  <tr class={sel?.id === b.id ? 'on' : ''}>
                    <td>{b.title}</td>
                    <td>
                      {jstText(b.startAt)}〜{hm(b.endAt)}
                    </td>
                    <td class="num">{b.minMinutes} 分</td>
                    <td class="num">
                      {n.ok} / {n.all} 人
                    </td>
                    <td>
                      {STATE[boostState(b, props.now)]}
                      {b.giftedAt ? ' ・ 🎁 済み' : ''}
                    </td>
                    <td>
                      <a href={`/voice/boost?id=${b.id}#boost-detail`}>くわしく</a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p class="empty">まだありません。</p>
        )}
      </section>

      {sel && (
        <section class="card" id="boost-detail">
          <h2>
            {sel.title}（{jstText(sel.startAt)}〜{hm(sel.endAt)}・{sel.minMinutes} 分以上）
          </h2>
          {props.canEdit && ['upcoming', 'active'].includes(boostState(sel, props.now)) && (
            <details>
              <summary>時間を直す・やめる</summary>
              <form method="post" action={`/voice/boost/${sel.id}`} class="fields">
                {csrf}
                <label class="field">
                  <span>名前</span>
                  <input type="text" name="title" maxlength={60} required value={sel.title} />
                </label>
                <label class="field">
                  <span>始まり</span>
                  <input type="datetime-local" name="startAt" value={jstLocal(sel.startAt)} required />
                </label>
                <label class="field">
                  <span>終わり</span>
                  <input type="datetime-local" name="endAt" value={jstLocal(sel.endAt)} required />
                </label>
                <label class="field">
                  <span>何分以上</span>
                  <input type="number" name="minMinutes" min={1} max={1440} value={String(sel.minMinutes)} required />
                </label>
                <button type="submit">保存</button>
              </form>
              <form method="post" action={`/voice/boost/${sel.id}/cancel`} class="row-actions">
                {csrf}
                <button type="submit" class="danger">やめる</button>
              </form>
            </details>
          )}
          {props.members.length ? (
            <table class="compact">
              <thead>
                <tr>
                  <th>人</th>
                  <th class="num">いた時間</th>
                  <th>来た</th>
                  <th>最後にいた</th>
                  <th>達成</th>
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
                    <td>{m.minutes >= sel.minMinutes ? '✅' : '―'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p class="empty">まだだれも記録されていません。</p>
          )}
          {props.canGift && boostState(sel, props.now) !== 'upcoming' && boostState(sel, props.now) !== 'active' && !sel.giftedAt && props.members.some((m) => m.minutes >= sel.minMinutes) && (
            <form method="post" action={`/voice/boost/${sel.id}/gift`} class="fields">
              {csrf}
              <h3>🎁 {sel.minMinutes} 分以上いた人へプレゼント（1 回だけ）</h3>
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
                <input type="text" name="note" maxlength={200} required value={`${sel.title} のお礼`} />
              </label>
              <label class="check">
                <input type="checkbox" name="confirm" value="yes" required /> {props.members.filter((m) => m.minutes >= sel.minMinutes).length} 人に配る（押すとすぐに配ります）
              </label>
              <button type="submit" class="ok">
                🎁 プレゼントする
              </button>
            </form>
          )}
        </section>
      )}
    </Layout>
  );
}

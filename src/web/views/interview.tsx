import { raw } from 'hono/html';
import type { AdminSession, Interview } from '../../db/schema.js';
import { DEFAULT_INTERVIEW_TEMPLATE, DEFAULT_REMINDER_TEMPLATE, jstParts, type InterviewSettings } from '../../services/interview.js';
import { discordMarkdownToHtml } from '../markdown.js';
import { Layout } from './layout.js';

export const INTERVIEW_FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  posted: { text: '📣 面談の告知を流しました。リマインドも時間になったら流します。', kind: 'ok' },
  scheduled: { text: '⏳ 告知を予約しました。時間になったら BOT が流します。', kind: 'ok' },
  updated: { text: '面談を変えました（流したあとなら、Discord のメッセージも書き換えました）。', kind: 'ok' },
  cancelled: { text: '面談を中止にしました（流したあとなら、Discord のメッセージを「中止になりました」に書き換えました）。', kind: 'ok' },
  saved: { text: '定型文と流し先を保存しました。', kind: 'ok' },
  invalid: { text: '日にちと時刻を選んでください。', kind: 'warn' },
  past: { text: 'その日時はもう過ぎています。これから先の日時を選んでください。', kind: 'warn' },
  post_after: { text: '告知を流す日時は、面談より前にしてください。', kind: 'warn' },
  no_channel: { text: '流すチャンネルが見つかりません。下の「定型文と流し先」で選ぶか、名前に「面談」を含むチャンネルを作ってください。', kind: 'warn' },
  failed: { text: '流せませんでした。BOT がそのチャンネルに書き込めるか確かめてください。', kind: 'warn' },
  not_found: { text: 'その面談はもうありません（中止済みかもしれません）。', kind: 'warn' },
  settings_invalid: { text: '定型文を 1 つ以上入れてください（名前は 30 文字・本文は 1800 文字まで）。ロールに通知するときはロールを選んでください。', kind: 'warn' },
};

export type DayChip = { value: string; label: string; sub: string };
export type Option = { id: string; name: string; category?: string };

const TIMES = ['19:00', '20:00', '20:30', '21:00', '21:30', '22:00', '22:30', '23:00'];

const WHEN: [string, string][] = [
  ['now', '今すぐ流す'],
  ['morning', '当日の朝 10:00 に流す'],
  ['eve', '前日の 21:00 に流す'],
  ['before2h', '2 時間前に流す'],
  ['custom', '日時を決めて流す'],
];

/** 日本時間の datetime-local の値 */
const jstLocal = (d: Date) => new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 16);
const when = (d: Date) => {
  const p = jstParts(d);
  return `${p.date} ${p.time}`;
};

function Chips(props: { name: string; items: { value: string; label: string; sub?: string }[]; checked?: string }) {
  return (
    <div class="chips">
      {props.items.map((it) => (
        <label class="chip">
          <input type="radio" name={props.name} value={it.value} checked={props.checked === it.value} />
          <span>
            {it.label}
            {it.sub && <small>{it.sub}</small>}
          </span>
        </label>
      ))}
    </div>
  );
}

function PlaceSelect(props: { voice: Option[]; selected?: string; name?: string }) {
  return (
    <select name={props.name ?? 'placeChannelId'}>
      <option value="">通話を選ばない（下に書く・なし）</option>
      {props.voice.map((v) => (
        <option value={v.id} selected={props.selected === v.id}>
          🔊 {v.name}
          {v.category ? `（${v.category}）` : ''}
        </option>
      ))}
    </select>
  );
}

/** プレビュー（Discord での見た目・いつ流すか・リマインド） */
export function InterviewPreview(props: { text: string; mention: string; postLabel: string; reminders: string[]; error?: string }) {
  return (
    <div class="iv-preview-body">
      {props.error ? (
        <p class="flash warn">{props.error}</p>
      ) : (
        <>
          <p class="iv-when">📣 {props.postLabel}</p>
          <div class="notice-rendered">
            {props.mention && <div class="md-mentionline">{props.mention}</div>}
            <div class="notice-preview md">{raw(discordMarkdownToHtml(props.text))}</div>
          </div>
          <p class="note">⏰ リマインド: {props.reminders.length ? props.reminders.join('・') : 'なし'}</p>
        </>
      )}
    </div>
  );
}

const STATUS: Record<Interview['status'], string> = { scheduled: '⏳ 予約中', posted: '📣 流した', cancelled: '中止' };

export function InterviewPage(props: {
  session: AdminSession;
  settings: InterviewSettings;
  channelName?: string;
  textChannels: Option[];
  voiceChannels: Option[];
  roles: { id: string; name: string }[];
  days: DayChip[];
  defaultDay: string;
  defaultTime: string;
  preview: Parameters<typeof InterviewPreview>[0];
  upcoming: Interview[];
  past: Interview[];
  channelNameOf: (id: string) => string | undefined;
  now: Date;
  flash?: string;
}) {
  const { session, settings: st } = props;
  const csrf = <input type="hidden" name="_csrf" value={session.csrfToken} />;
  const f = props.flash && Object.hasOwn(INTERVIEW_FLASH, props.flash) ? INTERVIEW_FLASH[props.flash] : undefined;
  const times = props.defaultTime && !TIMES.includes(props.defaultTime) ? [...TIMES, props.defaultTime].sort() : TIMES;
  const place = (i: Interview) => (i.placeChannelId ? `🔊 ${props.channelNameOf(i.placeChannelId) ?? '通話'}` : i.placeText || '―');
  const preview = { 'hx-post': '/interview/preview', 'hx-trigger': 'change, input delay:400ms', 'hx-target': '#iv-preview', 'hx-swap': 'innerHTML' };
  return (
    <Layout title="面談告知" session={session} nav="interview">
      <h1>🍵 面談告知</h1>
      {f && <p class={`flash ${f.kind}`}>{f.text}</p>}
      <p class="note">
        日にちと時刻を選んで「告知する」を押すと、定型文を {props.channelName ? <strong>#{props.channelName}</strong> : '面談告知のチャンネル'}{' '}
        に流します。予約して流したり、1 時間前・10 分前にリマインドを流したりもできます。
      </p>

      <div class="iv-grid">
        <form method="post" action="/interview/post" class="card iv-form" id="iv-form" {...preview}>
          {csrf}
          <h2>面談を告知する</h2>

          <div class="iv-step">
            <h3>
              <b>1</b> 日にち
            </h3>
            <Chips name="day" items={props.days} checked={props.defaultDay} />
            <label class="iv-other">
              <span>ほかの日</span>
              <input type="date" name="dayOther" />
            </label>
          </div>

          <div class="iv-step">
            <h3>
              <b>2</b> 時刻
            </h3>
            <Chips name="time" items={times.map((t) => ({ value: t, label: t }))} checked={props.defaultTime} />
            <label class="iv-other">
              <span>ほかの時刻</span>
              <input type="time" name="timeOther" step={300} />
            </label>
          </div>

          <div class="iv-step">
            <h3>
              <b>3</b> 場所
            </h3>
            <PlaceSelect voice={props.voiceChannels} selected={st.lastPlaceChannelId} />
            <input type="text" name="placeText" maxlength={100} placeholder="通話を選ばないとき: 場所を書く（なくても大丈夫）" />
          </div>

          {st.templates.length > 1 && (
            <div class="iv-step">
              <h3>
                <b>4</b> 定型文
              </h3>
              <Chips name="template" items={st.templates.map((t, i) => ({ value: String(i), label: t.name }))} checked="0" />
            </div>
          )}

          <div class="iv-step">
            <h3>
              <b>{st.templates.length > 1 ? 5 : 4}</b> 一言（なくても大丈夫）
            </h3>
            <textarea name="note" maxlength={500} rows={3} placeholder="例: 新しく入った方もお気軽にどうぞ"></textarea>
          </div>

          <div class="iv-step">
            <h3>
              <b>{st.templates.length > 1 ? 6 : 5}</b> 告知を流すタイミング
            </h3>
            <Chips name="when" items={WHEN.map(([value, label]) => ({ value, label }))} checked="now" />
            <label class="iv-other">
              <span>「日時を決めて流す」のとき</span>
              <input type="datetime-local" name="postAtOther" />
            </label>
          </div>

          <div class="iv-step">
            <h3>
              <b>{st.templates.length > 1 ? 7 : 6}</b> リマインド
            </h3>
            <div class="chips">
              <label class="chip">
                <input type="checkbox" name="remind60" value="yes" checked />
                <span>⏰ 1 時間前</span>
              </label>
              <label class="chip">
                <input type="checkbox" name="remind10" value="yes" checked />
                <span>⏰ 10 分前</span>
              </label>
            </div>
          </div>

          <button type="submit" class="ok iv-submit">
            📣 告知する
          </button>
        </form>

        <section class="card iv-preview">
          <h2>プレビュー</h2>
          <div id="iv-preview">
            <InterviewPreview {...props.preview} />
          </div>
        </section>
      </div>

      <section class="card anchor" id="iv-upcoming">
        <h2>これからの面談</h2>
        {props.upcoming.length === 0 ? (
          <p class="empty">予定はありません。</p>
        ) : (
          <ul class="iv-list">
            {props.upcoming.map((i) => (
              <li class={`iv-item st-${i.status}`}>
                <div class="iv-item-head">
                  <strong class="iv-at">{when(i.at)}</strong>
                  <span class={`status iv-${i.status}`}>{STATUS[i.status]}</span>
                  <span>{place(i)}</span>
                  <small>{i.templateName}</small>
                </div>
                <p class="note">
                  {i.status === 'scheduled' && `${when(i.postAt)} に流します。`}
                  {i.status === 'posted' && i.postedAt && `${when(i.postedAt)} に流しました。`}
                  {i.status !== 'cancelled' &&
                    ` リマインド: ${[i.remind60 ? `1 時間前${i.remind60At ? '（流した）' : ''}` : '', i.remind10 ? `10 分前${i.remind10At ? '（流した）' : ''}` : ''].filter(Boolean).join('・') || 'なし'}`}
                  {i.note && ` ／ 一言: ${i.note}`}
                </p>
                {i.status !== 'cancelled' && (
                  <div class="inline-actions">
                    {i.status === 'scheduled' && (
                      <form method="post" action={`/interview/${i.id}/post-now`}>
                        {csrf}
                        <button type="submit" class="ok">
                          今すぐ流す
                        </button>
                      </form>
                    )}
                    <details class="iv-edit">
                      <summary>変更する</summary>
                      <form method="post" action={`/interview/${i.id}/update`} class="fields">
                        {csrf}
                        <label class="field">
                          <span>面談の日時（日本時間）</span>
                          <input type="datetime-local" name="at" value={jstLocal(i.at)} required />
                        </label>
                        {i.status === 'scheduled' && (
                          <label class="field">
                            <span>告知を流す日時</span>
                            <input type="datetime-local" name="postAt" value={jstLocal(i.postAt)} required />
                          </label>
                        )}
                        <label class="field">
                          <span>場所（通話）</span>
                          <PlaceSelect voice={props.voiceChannels} selected={i.placeChannelId ?? undefined} />
                        </label>
                        <label class="field">
                          <span>場所（書く）</span>
                          <input type="text" name="placeText" value={i.placeText} maxlength={100} />
                        </label>
                        <label class="field wide">
                          <span>一言</span>
                          <textarea name="note" maxlength={500} rows={2}>
                            {i.note}
                          </textarea>
                        </label>
                        <div class="chips">
                          <label class="chip">
                            <input type="checkbox" name="remind60" value="yes" checked={i.remind60} />
                            <span>⏰ 1 時間前</span>
                          </label>
                          <label class="chip">
                            <input type="checkbox" name="remind10" value="yes" checked={i.remind10} />
                            <span>⏰ 10 分前</span>
                          </label>
                        </div>
                        <button type="submit" class="ok">
                          変更を保存{i.status === 'posted' ? '（Discord も書き換える）' : ''}
                        </button>
                      </form>
                    </details>
                    <details class="iv-edit">
                      <summary class="danger-text">中止する</summary>
                      <form method="post" action={`/interview/${i.id}/cancel`} class="fields">
                        {csrf}
                        <label class="field wide">
                          <span>理由（なくても大丈夫。Discord にも出ます）</span>
                          <input type="text" name="reason" maxlength={200} />
                        </label>
                        <button type="submit" class="danger">
                          中止にする{i.status === 'posted' ? '（Discord のメッセージを書き換える）' : ''}
                        </button>
                      </form>
                    </details>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <details class="card">
        <summary>
          <strong>⚙ 定型文と流し先</strong>
        </summary>
        <form method="post" action="/interview/settings" class="iv-settings">
            {csrf}
            <div class="fields">
              <label class="field">
                <span>流し先のチャンネル</span>
                <select name="channelId">
                  <option value="" selected={!st.channelId}>
                    名前に「面談」を含むチャンネル（自動）
                  </option>
                  {props.textChannels.map((c) => (
                    <option value={c.id} selected={c.id === st.channelId}>
                      #{c.name}
                      {c.category ? `（${c.category}）` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label class="field">
                <span>通知するロール（「ロールに通知」のとき）</span>
                <select name="roleId">
                  <option value="">―</option>
                  {props.roles.map((r) => (
                    <option value={r.id} selected={r.id === st.roleId}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <h3>告知の通知</h3>
            <Chips
              name="mention"
              items={[
                { value: 'none', label: 'なし' },
                { value: 'here', label: '@here', sub: 'いま見ている人' },
                { value: 'everyone', label: '@everyone', sub: '全員' },
                { value: 'ranks', label: '⛩ すべての役職', sub: '役職のロール全部' },
                { value: 'role', label: 'ロールに通知' },
              ]}
              checked={st.mention}
            />
            <h3>定型文</h3>
            <p class="note">
              差し込み: {'{日時}'}（10月3日（土） 21:00）・{'{日付}'}・{'{時刻}'}・{'{あと}'}（「あと 2 時間」のように各自の画面で出る）・{'{場所}'}・{'{一言}'}。{'{場所}'}・
              {'{一言}'} が空なら、その行は消します。名前と本文を空にすると、その定型文は消えます。
            </p>
            {[...st.templates, { name: '', body: '' }].map((t, i) => (
              <div class="iv-template">
                <input type="text" name={`tplName.${i}`} value={t.name} maxlength={30} placeholder={i === st.templates.length ? '＋ 新しい定型文の名前（例: 新人面談）' : '名前'} />
                <textarea name={`tplBody.${i}`} rows={6} maxlength={1800} placeholder={i === st.templates.length ? DEFAULT_INTERVIEW_TEMPLATE : ''}>
                  {t.body}
                </textarea>
              </div>
            ))}
            <h3>リマインドの文（1 時間前・10 分前）</h3>
            <textarea name="reminderTemplate" rows={3} maxlength={1000} class="iv-wide">
              {st.reminderTemplate}
            </textarea>
            <label class="field check">
              <input type="checkbox" name="remindMention" value="yes" checked={st.remindMention} />
              <span>リマインドでも通知を鳴らす（上の「告知の通知」と同じ相手に）</span>
            </label>
            <div class="inline-actions">
              <button type="submit" class="ok">
                保存する
              </button>
              <button type="submit" name="reset" value="yes">
                標準の定型文に戻す
              </button>
            </div>
            <details>
              <summary>標準の定型文・リマインドの文</summary>
              <pre class="preview">{DEFAULT_INTERVIEW_TEMPLATE}</pre>
              <pre class="preview">{DEFAULT_REMINDER_TEMPLATE}</pre>
            </details>
        </form>
      </details>

      <details class="card">
        <summary>
          <strong>終わった面談</strong>（{props.past.length}）
        </summary>
        {props.past.length === 0 ? (
          <p class="empty">まだありません。</p>
        ) : (
          <table class="compact">
            <tbody>
              {props.past.map((i) => (
                <tr class={i.status === 'cancelled' ? 'muted' : ''}>
                  <td>{when(i.at)}</td>
                  <td>{STATUS[i.status]}</td>
                  <td>{place(i)}</td>
                  <td class="wrap note">{i.status === 'cancelled' ? (i.cancelReason ?? '') : i.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </details>
    </Layout>
  );
}

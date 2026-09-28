import { raw } from 'hono/html';
import type { AdminSession, Meeting, MeetingTodo } from '../../db/schema.js';
import { lines, type MeetingRow, type OpenTodo, type Person, type VoiceNow } from '../../services/meetings.js';
import { fmtDateTime } from '../format.js';
import { discordMarkdownToHtml } from '../markdown.js';
import { Layout } from './layout.js';

export const MINUTES_FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  created: { text: '議事録を作りました。', kind: 'ok' },
  saved: { text: '保存しました。', kind: 'ok' },
  deleted: { text: '議事録を消しました。', kind: 'ok' },
  invalid: { text: '題と日時を入れてください。', kind: 'warn' },
  posted: { text: 'Discord にまとめを出しました。', kind: 'ok' },
  edited: { text: 'Discord のまとめを書き換えました。', kind: 'ok' },
  post_invalid: { text: '出すチャンネルを選んでください。', kind: 'warn' },
  post_failed: { text: 'Discord に出せませんでした（BOT がそのチャンネルに書き込めるか確かめてください）。', kind: 'warn' },
  toggled: { text: 'やることを更新しました。', kind: 'ok' },
  forbidden: { text: '消せるのは宮司です。', kind: 'warn' },
};

function Flash(props: { code?: string }) {
  const f = props.code && Object.hasOwn(MINUTES_FLASH, props.code) ? MINUTES_FLASH[props.code] : undefined;
  return f ? <p class={`flash ${f.kind}`}>{f.text}</p> : null;
}

function Csrf(props: { session: AdminSession }) {
  return <input type="hidden" name="_csrf" value={props.session.csrfToken} />;
}

/** 日本時間の datetime-local の値 */
export const jstLocal = (d: Date) => new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 16);
/** 日本時間の今日（YYYY-MM-DD） */
const jstDay = (d: Date) => new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
const dueLabel = (due: string) => `${Number(due.slice(5, 7))}/${Number(due.slice(8, 10))}`;

type Names = (id: string) => string;

/** やること 1 つ（済 ⇔ まだ のボタン付き） */
function TodoItem(props: { session: AdminSession; todo: MeetingTodo; name: Names; today: string; back: string; meeting?: { id: number; title: string } }) {
  const t = props.todo;
  const overdue = !t.doneAt && t.due && t.due < props.today;
  return (
    <li class={`todo-item${t.doneAt ? ' done' : ''}`}>
      <form method="post" action={`/minutes/todos/${t.id}/toggle`} class="todo-toggle">
        <Csrf session={props.session} />
        <input type="hidden" name="back" value={props.back} />
        <button type="submit" class={t.doneAt ? 'ok small' : 'small'} title={t.doneAt ? 'まだに戻す' : '済にする'}>
          {t.doneAt ? '✅ 済' : '☐ まだ'}
        </button>
      </form>
      <div class="ch-main">
        <div class="todo-body">{t.body}</div>
        <div class="ch-topic">
          {t.assigneeId ? `👤 ${props.name(t.assigneeId)}` : '担当なし'}
          {t.due && <span class={overdue ? 'over' : ''}> ・ 〆 {dueLabel(t.due)}{overdue ? '（過ぎています）' : ''}</span>}
          {props.meeting && (
            <>
              {' '}
              ・ <a href={`/minutes/${props.meeting.id}`}>{props.meeting.title}</a>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

// ───────── 一覧 ─────────

export function MinutesPage(props: { session: AdminSession; meetings: MeetingRow[]; open: OpenTodo[]; name: Names; q?: string; flash?: string; now: Date }) {
  const { session } = props;
  const today = jstDay(props.now);
  return (
    <Layout title="議事録" session={session} nav="minutes">
      <div class="page-head">
        <h1>📓 議事録</h1>
        <a class="button-link primary" href="/minutes/new">
          ＋ 会議を記録
        </a>
      </div>
      <Flash code={props.flash} />
      <p class="note">運営の会議の記録です。決まったことと「やること」（担当・期限）を残して、会議のあとに Discord へまとめを出せます。まだのやることはホームの「対応待ち」にも出ます。</p>

      <section class="card ch-group">
        <div class="ch-cat">
          <span class="ch-cat-name">📌 まだのやること</span>
          <span class="ch-count">{props.open.length}</span>
        </div>
        {props.open.length ? (
          <ul class="ch-list todo-list">
            {props.open.map((t) => (
              <TodoItem session={session} todo={t} name={props.name} today={today} back="list" meeting={{ id: t.meetingId, title: t.meetingTitle }} />
            ))}
          </ul>
        ) : (
          <p class="note ch-empty">まだのやることはありません。</p>
        )}
      </section>

      <form method="get" action="/minutes" class="ch-search">
        <input type="search" name="q" value={props.q ?? ''} placeholder="題・議題・話したこと・決まったことで探す" aria-label="議事録を探す" />
        <button type="submit">探す</button>
        {props.q && <a href="/minutes">すべて表示</a>}
      </form>
      <section class="card ch-group">
        <div class="ch-cat">
          <span class="ch-cat-name">会議</span>
          <span class="ch-count">{props.meetings.length}</span>
        </div>
        {props.meetings.length ? (
          <ul class="ch-list">
            {props.meetings.map((m) => (
              <li class="ch-row">
                <span class="ch-icon" aria-hidden="true">
                  📓
                </span>
                <div class="ch-main">
                  <div class="ch-line">
                    <a class="ch-name" href={`/minutes/${m.id}`}>
                      {m.title}
                    </a>
                    <span class="ch-tags">
                      {m.attendees.length > 0 && <span class="tag gray">👥 {m.attendees.length} 人</span>}
                      {m.todoCount > 0 && <span class={`tag ${m.openCount ? 'red' : 'green'}`}>{m.openCount ? `やること まだ ${m.openCount} / ${m.todoCount}` : `やること 全部済`}</span>}
                      {m.postedMessageId && <span class="tag gray">📣 Discord に出した</span>}
                    </span>
                  </div>
                  <div class="ch-topic">
                    {fmtDateTime(m.heldAt)}
                    {lines(m.decisions).length > 0 && ` ・ 決まったこと: ${lines(m.decisions).slice(0, 2).join('／')}${lines(m.decisions).length > 2 ? ' ほか' : ''}`}
                  </div>
                </div>
                <span class="ch-actions">
                  <a class="button-link small" href={`/minutes/${m.id}`}>
                    開く
                  </a>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p class="note ch-empty">{props.q ? '見つかりませんでした。' : 'まだ議事録がありません。「＋ 会議を記録」から書けます。'}</p>
        )}
      </section>
    </Layout>
  );
}

// ───────── 書く・直す ─────────

/** 新しい行（やること）をいくつ出すか */
const BLANK_TODOS = 3;

export function MeetingEditPage(props: {
  session: AdminSession;
  meeting?: Meeting;
  todos: MeetingTodo[];
  people: Person[];
  /** 選べる通話チャンネル（場所） */
  voiceChannels: { id: string; name: string; category: string | null }[];
  /** いま通話にいる人（参加した人に入れるボタン） */
  voiceNow: VoiceNow;
  /** ?voice= で選んだ通話（場所と参加した人を入れておく） */
  prefill?: { placeChannelId: string; attendees: string[] };
  flash?: string;
  now: Date;
}) {
  const { session, meeting: m } = props;
  const action = m ? `/minutes/${m.id}` : '/minutes';
  const attendees = new Set(props.prefill?.attendees ?? m?.attendees ?? []);
  const place = props.prefill?.placeChannelId ?? m?.placeChannelId ?? '';
  const rows: (MeetingTodo | undefined)[] = [...props.todos, ...Array.from({ length: BLANK_TODOS }, () => undefined)];
  const base = m ? `/minutes/${m.id}/edit` : '/minutes/new';
  return (
    <Layout title={m ? `議事録を直す: ${m.title}` : '会議を記録'} session={session} nav="minutes">
      <p class="crumbs">
        <a href={m ? `/minutes/${m.id}` : '/minutes'}>← {m ? m.title : '議事録'}</a>
      </p>
      <div class="page-head">
        <h1>{m ? '📓 議事録を直す' : '📓 会議を記録'}</h1>
      </div>
      <Flash code={props.flash} />
      {props.voiceNow.length > 0 && (
        <div class="card voice-now">
          <strong>🔊 いま通話にいる人を入れる</strong>
          <span class="note">（場所と「参加した人」が入ります。書いた内容は消えるので、はじめに押してください）</span>
          <div class="inline-actions">
            {props.voiceNow.map((v) => (
              <a class="button-link small" href={`${base}?voice=${v.id}`}>
                🔊 {v.name}（{v.memberIds.length} 人）
              </a>
            ))}
          </div>
        </div>
      )}
      <form method="post" action={action} class="minutes-form">
        <Csrf session={session} />
        <section class="card">
          <h2>会議</h2>
          <div class="fields">
            <label class="field">
              <span>題</span>
              <input type="text" name="title" value={m?.title ?? ''} maxlength={100} required placeholder="例: 9 月の運営会議" />
            </label>
            <label class="field">
              <span>日時</span>
              <input type="datetime-local" name="heldAt" value={jstLocal(m?.heldAt ?? props.now)} required />
            </label>
            <label class="field">
              <span>場所（通話）</span>
              <select name="placeChannelId">
                <option value="">なし・通話以外</option>
                {props.voiceChannels.map((c) => (
                  <option value={c.id} selected={place === c.id}>
                    {c.category ? `${c.category} / ` : ''}🔊 {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset class="field">
            <legend>参加した人</legend>
            {props.people.length ? (
              <div class="role-checks people-checks">
                {props.people.map((p) => (
                  <label class="check">
                    <input type="checkbox" name="attendees" value={p.id} checked={attendees.has(p.id)} />
                    <span>
                      {p.name}
                      {!p.staff && <small>（運営以外）</small>}
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p class="note">選べる人がいません（運営のロールを持っている人が出ます）。</p>
            )}
          </fieldset>
        </section>

        <section class="card">
          <h2>中身</h2>
          <label class="field">
            <span>議題（話すこと）</span>
            <textarea name="agenda" rows={4} maxlength={4000} placeholder={'- 新しいイベントについて\n- 厄の基準の見直し'}>
              {m?.agenda ?? ''}
            </textarea>
          </label>
          <label class="field">
            <span>話したこと（メモ。Discord の書き方で飾れます: **太字**・- 箇条書き・## 見出し）</span>
            <textarea name="notes" rows={10} maxlength={20000}>
              {m?.notes ?? ''}
            </textarea>
          </label>
          <label class="field">
            <span>✅ 決まったこと（1 行に 1 つ。Discord のまとめに出ます）</span>
            <textarea name="decisions" rows={4} maxlength={4000} placeholder={'ハロウィンイベントは 10/31 の 21 時から\n厄の期限は 30 日のまま'}>
              {m?.decisions ?? ''}
            </textarea>
          </label>
        </section>

        <section class="card">
          <h2>📌 やること</h2>
          <p class="note">空の行は使いません。行が足りなければ、保存すると空の行が増えます。済にしたものは Discord のまとめで打ち消し線になります。</p>
          <div class="table-wrap">
            <table class="compact todo-edit">
              <thead>
                <tr>
                  <th>やること</th>
                  <th>担当</th>
                  <th>期限</th>
                  <th>済</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t, i) => (
                  <tr>
                    <td>
                      {t && <input type="hidden" name={`todo.${i}.id`} value={String(t.id)} />}
                      <input type="text" name={`todo.${i}.body`} value={t?.body ?? ''} maxlength={200} aria-label="やること" placeholder={t ? '' : '例: 告知文を書く'} />
                    </td>
                    <td>
                      <select name={`todo.${i}.assignee`} aria-label="担当">
                        <option value="">担当なし</option>
                        {props.people.map((p) => (
                          <option value={p.id} selected={t?.assigneeId === p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input type="date" name={`todo.${i}.due`} value={t?.due ?? ''} aria-label="期限" />
                    </td>
                    <td>
                      <input type="checkbox" name={`todo.${i}.done`} value="yes" checked={Boolean(t?.doneAt)} aria-label="済" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <input type="hidden" name="todoRows" value={String(rows.length)} />
        </section>

        <div class="save-bar">
          <button type="submit" class="ok">
            保存
          </button>
          <a href={m ? `/minutes/${m.id}` : '/minutes'}>やめる</a>
        </div>
      </form>
    </Layout>
  );
}

// ───────── 見る ─────────

export function MeetingViewPage(props: {
  session: AdminSession;
  meeting: Meeting;
  todos: MeetingTodo[];
  name: Names;
  placeName?: string;
  /** まとめを出せるチャンネル */
  channels: { id: string; name: string; category: string | null }[];
  /** 最初から選んでおくチャンネル（前に出したところ・運営のチャンネル） */
  defaultChannelId?: string;
  flash?: string;
  now: Date;
}) {
  const { session, meeting: m } = props;
  const decided = lines(m.decisions);
  const today = jstDay(props.now);
  const done = props.todos.filter((t) => t.doneAt).length;
  return (
    <Layout title={`議事録: ${m.title}`} session={session} nav="minutes">
      <p class="crumbs">
        <a href="/minutes">← 議事録</a>
      </p>
      <div class="page-head">
        <h1>📓 {m.title}</h1>
        <a class="button-link" href={`/minutes/${m.id}/edit`}>
          直す
        </a>
      </div>
      <Flash code={props.flash} />
      <p class="meeting-meta">
        <span>🗓 {fmtDateTime(m.heldAt)}</span>
        {props.placeName && <span>📍 🔊 {props.placeName}</span>}
        <span>👥 {m.attendees.length ? m.attendees.map(props.name).join('・') : '（参加した人の記録なし）'}</span>
      </p>

      <div class="meeting-view">
        <div class="meeting-main">
          {m.agenda.trim() && (
            <section class="card">
              <h2>議題</h2>
              <div class="md">{raw(discordMarkdownToHtml(m.agenda))}</div>
            </section>
          )}
          <section class="card">
            <h2>話したこと</h2>
            {m.notes.trim() ? <div class="md">{raw(discordMarkdownToHtml(m.notes))}</div> : <p class="note">メモはありません。</p>}
          </section>
        </div>
        <div class="meeting-side">
          <section class="card">
            <h2>✅ 決まったこと</h2>
            {decided.length ? (
              <ul class="decisions">
                {decided.map((d) => (
                  <li>{d}</li>
                ))}
              </ul>
            ) : (
              <p class="note">まだありません。</p>
            )}
          </section>
          <section class="card ch-group">
            <div class="ch-cat">
              <span class="ch-cat-name">📌 やること</span>
              <span class="ch-count">
                {done} / {props.todos.length}
              </span>
            </div>
            {props.todos.length ? (
              <ul class="ch-list todo-list">
                {props.todos.map((t) => (
                  <TodoItem session={session} todo={t} name={props.name} today={today} back={`meeting:${m.id}`} />
                ))}
              </ul>
            ) : (
              <p class="note ch-empty">やることはありません。</p>
            )}
          </section>
          <section class="card">
            <h2>📣 Discord にまとめを出す</h2>
            <p class="note">
              日時・場所・参加した人・決まったこと・やることをカードで出します。
              {m.postedMessageId ? ` ${fmtDateTime(m.postedAt)} に出しました。同じチャンネルなら書き換えます。` : ''}
            </p>
            <form method="post" action={`/minutes/${m.id}/post`} class="inline-actions">
              <Csrf session={session} />
              <select name="channelId" required aria-label="出すチャンネル">
                <option value="">チャンネルを選ぶ</option>
                {props.channels.map((c) => (
                  <option value={c.id} selected={props.defaultChannelId === c.id}>
                    {c.category ? `${c.category} / ` : ''}#{c.name}
                  </option>
                ))}
              </select>
              <button type="submit" class="ok">
                {m.postedMessageId ? '出す・書き換える' : '出す'}
              </button>
            </form>
          </section>
          {session.level === 'guji' && (
            <details class="card danger-zone">
              <summary>🗑 この議事録を消す</summary>
              <form method="post" action={`/minutes/${m.id}/delete`} class="inline-actions">
                <Csrf session={session} />
                <label class="field check">
                  <input type="checkbox" name="confirm" value="yes" required />
                  <span>消す（やることも消えます。Discord に出したまとめは残ります）</span>
                </label>
                <button type="submit" class="danger">
                  消す
                </button>
              </form>
            </details>
          )}
          <p class="note">
            書いた人・直した人の記録は「記録」のページにあります（最後に直したのは {props.name(m.updatedBy)}・{fmtDateTime(m.updatedAt)}）。
          </p>
        </div>
      </div>
    </Layout>
  );
}

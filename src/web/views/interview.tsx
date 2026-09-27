import type { AdminSession, AuditLog } from '../../db/schema.js';
import { DEFAULT_INTERVIEW_TEMPLATE, type InterviewSettings } from '../../services/interview.js';
import { fmtDateTime } from '../format.js';
import { Layout } from './layout.js';

export const INTERVIEW_FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  posted: { text: '面談の告知を流しました。', kind: 'ok' },
  saved: { text: '定型文と流し先を保存しました。', kind: 'ok' },
  invalid: { text: '日時を入れてください。', kind: 'warn' },
  no_channel: { text: '流すチャンネルが見つかりません。下の「流し先」で選ぶか、名前に「面談」を含むチャンネルを作ってください。', kind: 'warn' },
  failed: { text: '流せませんでした。BOT がそのチャンネルに書き込めるか確かめてください。', kind: 'warn' },
  settings_invalid: { text: '定型文を入れてください（1800 文字まで）。ロールに通知するときはロールを選んでください。', kind: 'warn' },
};

export function InterviewPage(props: {
  session: AdminSession;
  settings: InterviewSettings;
  channelName?: string;
  textChannels: { id: string; name: string; category?: string }[];
  roles: { id: string; name: string }[];
  /** 画面を開いたときの、次の区切りの時刻（日本時間の 2026-09-28T21:00） */
  defaultAt: string;
  preview: string;
  history: AuditLog[];
  names: Map<string, string>;
  flash?: string;
}) {
  const { session, settings: st } = props;
  const csrf = <input type="hidden" name="_csrf" value={session.csrfToken} />;
  const f = props.flash && Object.hasOwn(INTERVIEW_FLASH, props.flash) ? INTERVIEW_FLASH[props.flash] : undefined;
  return (
    <Layout title="面談告知" session={session} nav="interview">
      <h1>🍵 面談告知</h1>
      {f && <p class={`flash ${f.kind}`}>{f.text}</p>}
      <p class="note">
        日時を決めて「流す」を押すと、決めておいた定型文を {props.channelName ? <strong>#{props.channelName}</strong> : '面談告知のチャンネル'} に流します。
      </p>

      <section class="card">
        <h2>面談を告知する</h2>
        <form method="post" action="/interview/post" class="fields">
          {csrf}
          <label class="field">
            <span>面談の日時（日本時間）</span>
            <input type="datetime-local" name="at" value={props.defaultAt} required />
          </label>
          <label class="field">
            <span>場所（なくても大丈夫。例: 🔊 拝殿）</span>
            <input type="text" name="place" maxlength={100} />
          </label>
          <label class="field">
            <span>一言（なくても大丈夫）</span>
            <textarea name="note" maxlength={500} rows={2}></textarea>
          </label>
          <button type="submit" class="ok">
            流す
          </button>
        </form>
        <h3>こんなふうに流れます（例）</h3>
        <pre class="preview">{props.preview}</pre>
      </section>

      <section class="card">
        <h2>定型文と流し先</h2>
        <form method="post" action="/interview/settings" class="fields">
          {csrf}
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
          <fieldset class="tier-pick">
            <legend>通知</legend>
            {(
              [
                ['none', 'なし'],
                ['here', '@here（いま見ている人）'],
                ['everyone', '@everyone（全員）'],
                ['role', 'ロールに通知'],
              ] as const
            ).map(([v, label]) => (
              <label>
                <input type="radio" name="mention" value={v} checked={st.mention === v} />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
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
          <label class="field">
            <span>定型文</span>
            <textarea name="template" rows={8} maxlength={1800} required>
              {st.template}
            </textarea>
            <small>
              差し込み: {'{日時}'}（9月28日（日） 21:00）・{'{日付}'}・{'{時刻}'}・{'{あと}'}（「あと 2 時間」のように各自の画面で出る）・{'{場所}'}・{'{一言}'}。{'{場所}'}・{'{一言}'} が空なら、その行は消します。
            </small>
          </label>
          <div class="inline-actions">
            <button type="submit" class="ok">
              保存する
            </button>
            <button type="submit" name="reset" value="yes">
              標準の定型文に戻す
            </button>
          </div>
        </form>
        <details>
          <summary>標準の定型文</summary>
          <pre class="preview">{DEFAULT_INTERVIEW_TEMPLATE}</pre>
        </details>
      </section>

      <section class="card">
        <h2>これまでの告知</h2>
        {props.history.length === 0 ? (
          <p class="empty">まだありません。</p>
        ) : (
          <table class="compact">
            <thead>
              <tr>
                <th>流した日時</th>
                <th>面談の日時</th>
                <th>流した人</th>
              </tr>
            </thead>
            <tbody>
              {props.history.map((h) => (
                <tr>
                  <td>{fmtDateTime(h.at)}</td>
                  <td>{typeof h.detail.label === 'string' ? h.detail.label : ''}</td>
                  <td>{props.names.get(h.actorId) ?? h.actorId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </Layout>
  );
}

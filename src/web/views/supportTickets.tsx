import type { AdminSession, SupportTicket } from '../../db/schema.js';
import { TICKET_QUESTIONS_MAX, type TicketConfig, type TicketType } from '../../services/supportTickets.js';
import { fmtDateTime } from '../format.js';
import { Layout } from './layout.js';

/**
 * 🎫 チケット（社務所Web）: 設定・種類（見えるロール・カテゴリ・あいさつ・質問）・開いているチケット・閉じたチケットとやりとりの記録
 */

export const TICKET_FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  saved: { text: '設定を保存しました。', kind: 'ok' },
  invalid: { text: '入力を確かめてください（名前・英字の名札・時間）。', kind: 'warn' },
  type_saved: { text: '種類を保存しました（パネルも書き換えました）。', kind: 'ok' },
  type_added: { text: '種類を足しました（パネルも書き換えました）。', kind: 'ok' },
  type_removed: { text: '種類を外しました（開いているチケットはそのままです）。', kind: 'ok' },
  type_dup: { text: 'その名札（英字）の種類はもうあります。', kind: 'warn' },
  posted: { text: 'パネルを出しました。', kind: 'ok' },
  post_failed: { text: 'パネルを出せませんでした。パネルのチャンネルを選んで保存し、BOT がそこに書きこめるか確かめてください。', kind: 'warn' },
  guji: { text: '変えられるのは宮司だけです。', kind: 'warn' },
};

type Opt = { id: string; name: string };

function Csrf(props: { session: AdminSession }) {
  return <input type="hidden" name="_csrf" value={props.session.csrfToken} />;
}

function Pick(props: { name: string; label: string; value?: string; options: Opt[]; empty: string }) {
  return (
    <label class="field">
      <span>{props.label}</span>
      <select name={props.name}>
        <option value="">{props.empty}</option>
        {props.options.map((o) => (
          <option value={o.id} selected={o.id === props.value}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function Multi(props: { name: string; label: string; values: string[]; options: Opt[] }) {
  return (
    <label class="field">
      <span>{props.label}</span>
      <select name={props.name} multiple size={6}>
        {props.options.map((o) => (
          <option value={o.id} selected={props.values.includes(o.id)}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

const KIND_LABEL = { normal: 'ふつう（やりとりだけ）', role: '🎐 役職の希望（希望する役職を選ぶ・採用ボタン）', request: '💰 依頼（値段と期限・銭を預かる・納品）' } as const;

/** 種類の欄（足す・書きかえる） */
function TypeFields(props: { t?: TicketType; roles: Opt[]; categories: Opt[] }) {
  const t = props.t;
  return (
    <div class="fields">
      {!t && (
        <label class="field">
          <span>名札（英小文字・数字。あとで変えない）</span>
          <input type="text" name="key" pattern="[a-z0-9_-]{1,20}" required placeholder="stamp" />
        </label>
      )}
      <label class="field">
        <span>名前</span>
        <input type="text" name="label" maxlength={40} required value={t?.label ?? ''} />
      </label>
      <label class="field">
        <span>絵文字</span>
        <input type="text" name="emoji" maxlength={16} value={t?.emoji ?? ''} />
      </label>
      <label class="field">
        <span>説明（パネルに出る・100 文字まで）</span>
        <input type="text" name="description" maxlength={100} value={t?.description ?? ''} />
      </label>
      <label class="field">
        <span>種類</span>
        <select name="kind">
          {(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((k) => (
            <option value={k} selected={(t?.kind ?? 'normal') === k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <Multi name="roleIds" label="見えるロール（係の運営。神職・宮司はいつも見える。Ctrl で複数）" values={t?.roleIds ?? []} options={props.roles} />
      <Pick name="categoryId" label="チャンネルを作るカテゴリ" value={t?.categoryId} options={props.categories} empty="全体の設定のカテゴリ" />
      <label class="field">
        <span>チャンネルの最初のあいさつ</span>
        <textarea name="greeting" maxlength={1000} rows={3}>
          {t?.greeting ?? ''}
        </textarea>
      </label>
      {Array.from({ length: TICKET_QUESTIONS_MAX }, (_, n) => {
        const q = t?.questions[n];
        return (
          <div class="inline-actions">
            <label class="field">
              <span>質問 {n + 1}（空なら使わない）</span>
              <input type="text" name={`q${n}`} maxlength={45} value={q?.label ?? ''} />
            </label>
            <label class="field check">
              <input type="checkbox" name={`q${n}long`} value="yes" checked={q?.long ?? false} />
              <span>長い答え</span>
            </label>
            <label class="field check">
              <input type="checkbox" name={`q${n}req`} value="yes" checked={q ? q.required : true} />
              <span>必須</span>
            </label>
          </div>
        );
      })}
      <Multi name="roleChoices" label="🎐 役職の希望で選べる役職（種類が「役職の希望」のときだけ）" values={t?.roleChoices ?? []} options={props.roles} />
      <label class="field check">
        <input type="checkbox" name="enabled" value="yes" checked={t?.enabled ?? true} />
        <span>使う（外すとパネルに出ない）</span>
      </label>
    </div>
  );
}

export function TicketsPage(props: {
  session: AdminSession;
  config: TicketConfig;
  open: SupportTicket[];
  closed: SupportTicket[];
  channels: Opt[];
  categories: Opt[];
  roles: Opt[];
  name: (id: string) => string;
  guji: boolean;
  now: Date;
  guildId: string;
  flash?: string;
}) {
  const { session, config: c, name } = props;
  const f = props.flash && Object.hasOwn(TICKET_FLASH, props.flash) ? TICKET_FLASH[props.flash] : undefined;
  const label = (key: string) => {
    const t = c.types.find((x) => x.key === key);
    return t ? `${t.emoji} ${t.label}` : key;
  };
  const hours = (d: Date) => Math.floor((props.now.getTime() - d.getTime()) / 3_600_000);
  const rated = props.closed.filter((t) => t.rating);
  const avg = rated.length ? (rated.reduce((n, t) => n + (t.rating ?? 0), 0) / rated.length).toFixed(1) : '—';
  return (
    <Layout title="チケット" session={session} nav="tickets">
      <h1>🎫 チケット</h1>
      {f && <p class={`flash ${f.kind}`}>{f.text}</p>}

      <section class="card">
        <h2>📬 開いているチケット（{props.open.length}）</h2>
        {props.open.length ? (
          <table class="compact">
            <thead>
              <tr>
                <th>#</th>
                <th>種類</th>
                <th>開いた人</th>
                <th>担当</th>
                <th>開いてから</th>
                <th>待ち</th>
                <th>チャンネル</th>
              </tr>
            </thead>
            <tbody>
              {props.open.map((t) => {
                const userAt = t.lastUserAt?.getTime() ?? t.createdAt.getTime();
                const waiting = userAt > (t.lastStaffAt?.getTime() ?? 0);
                return (
                  <tr>
                    <td>{t.id}</td>
                    <td>{label(t.typeKey)}</td>
                    <td>
                      <a href={`/members/${t.openerId}`}>{name(t.openerId)}</a>
                    </td>
                    <td>{t.assigneeId ? name(t.assigneeId) : <span class="tag gray">担当なし</span>}</td>
                    <td>{hours(t.createdAt)} 時間</td>
                    <td>{waiting ? <span class={`tag ${hours(new Date(userAt)) >= c.staleHours ? 'warn' : 'gray'}`}>運営の返事待ち {hours(new Date(userAt))} 時間</span> : <span class="tag gray">開いた人の返事待ち</span>}{t.escrow > 0 ? <span class="tag gray">💰 {t.escrow.toLocaleString('ja-JP')} 枚 預かり中</span> : ''}</td>
                    <td>{t.channelId ? <a href={`https://discord.com/channels/${props.guildId}/${t.channelId}`}>開く</a> : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p class="note">いま開いているチケットはありません。</p>
        )}
      </section>

      <section class="card">
        <h2>🗂 閉じたチケット（新しい順・50 件）</h2>
        <p class="note">評価の平均 ⭐ {avg}（{rated.length} 件）。「記録」で、閉じたときのやりとりを読めます。</p>
        {props.closed.length ? (
          <table class="compact">
            <thead>
              <tr>
                <th>#</th>
                <th>種類</th>
                <th>開いた人</th>
                <th>担当</th>
                <th>閉じた日時</th>
                <th>評価</th>
                <th>やりとり</th>
              </tr>
            </thead>
            <tbody>
              {props.closed.map((t) => (
                <tr>
                  <td>{t.id}</td>
                  <td>
                    {label(t.typeKey)}
                    {t.closeReason?.startsWith('hired:') ? <span class="tag gray">✅ 採用</span> : ''}
                    {t.paidTo ? <span class="tag gray">📦 納品</span> : ''}
                  </td>
                  <td>
                    <a href={`/members/${t.openerId}`}>{name(t.openerId)}</a>
                  </td>
                  <td>{t.assigneeId ? name(t.assigneeId) : '—'}</td>
                  <td>{t.closedAt ? fmtDateTime(t.closedAt) : '—'}</td>
                  <td>{t.rating ? '⭐'.repeat(t.rating) : '—'}</td>
                  <td>
                    <a href={`/tickets/${t.id}/transcript`}>記録</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p class="note">まだありません。</p>
        )}
      </section>

      <section class="card">
        <h2>⚙ 設定</h2>
        {!props.guji && <p class="note">変えられるのは宮司だけです。</p>}
        <form method="post" action="/tickets/settings" class="fields">
          <Csrf session={session} />
          <Pick name="panelChannelId" label="パネルを出すチャンネル" value={c.panelChannelId} options={props.channels} empty="選ぶ" />
          <Pick name="categoryId" label="チャンネルを作るカテゴリ（種類で決めていなければ）" value={c.categoryId} options={props.categories} empty="カテゴリなし（いちばん上）" />
          <Pick name="logChannelId" label="閉じたときのやりとりと、返事のない知らせを出すチャンネル" value={c.logChannelId} options={props.channels} empty="#記録" />
          <label class="field">
            <span>運営の返事がないまま、この時間たったら知らせる（時間）</span>
            <input type="number" name="staleHours" min={1} max={336} value={String(c.staleHours)} required />
          </label>
          <label class="field">
            <span>開いた人の返事がないまま、この時間たったら案内して、さらに 24 時間で自動で閉じる（時間。0 なら閉じない）</span>
            <input type="number" name="idleHours" min={0} max={720} value={String(c.idleHours)} required />
          </label>
          {props.guji && (
            <button type="submit" class="ok">
              保存する
            </button>
          )}
        </form>
        {props.guji && (
          <form method="post" action="/tickets/post" class="row-actions">
            <Csrf session={session} />
            <button type="submit">パネルを出す（出し直す）</button>
          </form>
        )}
      </section>

      <section class="card">
        <h2>🏷 種類</h2>
        <p class="note">パネルで選べるチケットの種類です。開くと、開いた人と「見えるロール」の人（と神職・宮司）だけが見えるチャンネルができます。質問は開くときに聞きます（5 つまで）。</p>
        {c.types.map((t) => (
          <details>
            <summary>
              {t.emoji} {t.label}
              {!t.enabled ? '（使わない）' : ''} ・ {KIND_LABEL[t.kind]}
            </summary>
            <form method="post" action={`/tickets/types/${t.key}`}>
              <Csrf session={session} />
              <TypeFields t={t} roles={props.roles} categories={props.categories} />
              {props.guji && (
                <button type="submit" class="ok">
                  保存する
                </button>
              )}
            </form>
            {props.guji && (
              <form method="post" action={`/tickets/types/${t.key}/delete`} class="row-actions">
                <Csrf session={session} />
                <button type="submit" class="danger">
                  この種類を外す
                </button>
              </form>
            )}
          </details>
        ))}
        {props.guji && (
          <details>
            <summary>➕ 種類を足す</summary>
            <form method="post" action="/tickets/types">
              <Csrf session={session} />
              <TypeFields roles={props.roles} categories={props.categories} />
              <button type="submit" class="ok">
                足す
              </button>
            </form>
          </details>
        )}
      </section>
    </Layout>
  );
}

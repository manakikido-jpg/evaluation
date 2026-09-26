import type { AdminSession, Notice } from '../../db/schema.js';
import { maxLengthOf, NOTICE_STYLES, type NoticeStatus, type NoticeStyle, type NoticeVariable } from '../../services/notices.js';
import { fmtAgo } from '../format.js';
import { Layout } from './layout.js';

export const NOTICE_FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  saved: { text: '保存しました（Discord にはまだ反映していません）。', kind: 'ok' },
  posted: { text: 'Discord に投稿しました。', kind: 'ok' },
  edited: { text: 'Discord のメッセージを書き換えました。', kind: 'ok' },
  reposted: { text: 'Discord のメッセージが消されていたので、新しく投稿しました（いちばん下に出ます。並びを直すには「投稿し直す」）。', kind: 'warn' },
  unchanged: { text: 'Discord の内容と同じなので、何もしていません。', kind: 'ok' },
  too_long: { text: '本文が空か、文字数の上限（カード 4096・普通のメッセージ 2000）を超えています。分けてください。', kind: 'warn' },
  published_all: { text: '未反映の掲示をすべて反映しました。', kind: 'ok' },
  reposted_channel: { text: 'チャンネルの掲示を順番どおりに投稿し直しました。', kind: 'ok' },
  deleted: { text: '削除しました（Discord のメッセージも消しました）。', kind: 'ok' },
  seeded: { text: '標準の文面を入れました。内容を確認して「すべて反映」を押すと Discord に投稿されます。', kind: 'ok' },
  seed_missing: { text: '#鳥居・#しきたり が見つからなかったため、見つかったチャンネルの分だけ入れました。', kind: 'warn' },
  guides_seeded: {
    text: 'チャンネルの使い方の案内を入れました（標準の文面のままのものは新しい文面にしました）。内容を確認して「すべて反映」を押すと、各チャンネルに投稿してピン留めします。',
    kind: 'ok',
  },
  guides_none: { text: '入れる案内はありませんでした（もう入っています）。', kind: 'ok' },
  guides_missing: { text: '見つからないチャンネルがあったので、見つかったチャンネルの分だけ入れました。', kind: 'warn' },
  pin_failed: {
    text: '投稿はできましたが、ピン留めできませんでした。BOT のロールに「メッセージの管理」（または「メッセージをピン留め」）権限を付けてから、もう一度「反映」を押してください。',
    kind: 'warn',
  },
  invalid: { text: '入力が足りません（タイトル・本文・チャンネル）。', kind: 'warn' },
  discord_error: { text: 'Discord への投稿に失敗しました。BOT がそのチャンネルに書き込めるか確認してください。', kind: 'warn' },
};

const STATUS: Record<NoticeStatus, { label: string; cls: string }> = {
  draft: { label: '未投稿', cls: 'st-draft' },
  posted: { label: '投稿済み', cls: 'st-posted' },
  changed: { label: '未反映の変更あり', cls: 'st-changed' },
};

function Csrf(props: { session: AdminSession }) {
  return <input type="hidden" name="_csrf" value={props.session.csrfToken} />;
}

function Flash(props: { code?: string }) {
  const f = props.code && Object.hasOwn(NOTICE_FLASH, props.code) ? NOTICE_FLASH[props.code] : undefined;
  return f ? <p class={`flash ${f.kind}`}>{f.text}</p> : null;
}

export type NoticeRow = { notice: Notice; preview: string; length: number; status: NoticeStatus; unknown: string[] };
export type NoticeGroup = { channelId: string; channelName: string | null; rows: NoticeRow[] };

export function NoticesPage(props: { session: AdminSession; groups: NoticeGroup[]; flash?: string; now: Date }) {
  const { session } = props;
  const pending = props.groups.flatMap((g) => g.rows).filter((r) => r.status !== 'posted').length;
  return (
    <Layout title="掲示" session={session} nav="notices">
      <h1>掲示（BOT が投稿する文面）</h1>
      <Flash code={props.flash} />
      <p class="note">
        #鳥居・#しきたり などに BOT が投稿するメッセージです。「カード」にすると 1 つずつ枠で区切られて読みやすくなります。ここで直して「反映」を押すと、Discord のメッセージが書き換わります。本文の{' '}
        <code>{'{免罪符の値段}'}</code> などは今の設定の値に、<code>{'{#しきたり}'}</code> はチャンネルへのリンクに置き換わります。設定を変えると、投稿済みの掲示の数字も自動で書き換わります。
      </p>
      <div class="inline-actions">
        <a class="button-link" href="/notices/new">
          ＋ 掲示を追加
        </a>
        {pending > 0 && (
          <form method="post" action="/notices/publish-all">
            <Csrf session={session} />
            <button type="submit" class="ok">
              未反映の {pending} 件をすべて反映
            </button>
          </form>
        )}
      </div>

      <details class="card">
        <summary>チャンネルの使い方の案内を入れる</summary>
        <p class="note">
          #絵馬-男性・#絵馬-女性（ひな形をいちばん下に）・#手水舎・#縁日・#宿帳・#おみくじ などに「使い方」のカードを入れて、ピン留めします（話が流れても 📌 から読めます）。#しきたり には全チャンネルの一覧「チャンネル案内」を入れます。入れたあと、ここで文面を直してから反映できます。もう入っているものは入れません（標準の文面のまま手を加えていないものは、新しい標準の文面にします）。
        </p>
        <form method="post" action="/notices/seed-guides">
          <Csrf session={session} />
          <button type="submit" class="ok">
            チャンネルの案内を入れる
          </button>
        </form>
      </details>

      {props.groups.length === 0 && (
        <section class="card">
          <p>まだ掲示がありません。#鳥居（ようこそ）と #しきたり（ルール・朱印の仕組み・花びら・用語集）の標準の文面を入れられます。</p>
          <form method="post" action="/notices/seed">
            <Csrf session={session} />
            <button type="submit" class="ok">
              標準の文面を入れる
            </button>
          </form>
        </section>
      )}

      {props.groups.map((g) => (
        <section class="card">
          <h2>#{g.channelName ?? `（見つからないチャンネル ${g.channelId}）`}</h2>
          <ol class="notices">
            {g.rows.map((r, i) => (
              <li>
                <div class="notice-head">
                  <strong>{r.notice.title}</strong>
                  <span class={`status ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                  <small>{r.notice.style === 'text' ? '普通のメッセージ' : 'カード'}</small>
                  {r.notice.sticky ? <small>⬇ いちばん下に表示し続ける</small> : r.notice.pinned && <small>📌 ピン留め</small>}
                  <small class={r.length > maxLengthOf(r.notice.style) ? 'over' : ''}>
                    {r.length} / {maxLengthOf(r.notice.style)} 文字
                  </small>
                  <small>更新 {fmtAgo(r.notice.updatedAt, props.now)}</small>
                </div>
                {r.unknown.length > 0 && <p class="flash warn">置き換えられない名前: {r.unknown.map((u) => `{${u}}`).join(' ')}</p>}
                <pre class={`notice-preview${r.notice.style === 'text' ? '' : ' embed'}`}>{r.preview}</pre>
                <div class="inline-actions">
                  <a class="button-link" href={`/notices/${r.notice.id}`}>
                    編集
                  </a>
                  {r.status !== 'posted' && (
                    <form method="post" action={`/notices/${r.notice.id}/publish`}>
                      <Csrf session={session} />
                      <button type="submit" class="ok">
                        {r.status === 'draft' ? '投稿する' : '反映する'}
                      </button>
                    </form>
                  )}
                  <form method="post" action={`/notices/${r.notice.id}/move`}>
                    <Csrf session={session} />
                    <button type="submit" name="dir" value="up" disabled={i === 0} title="上へ">
                      ↑
                    </button>
                    <button type="submit" name="dir" value="down" disabled={i === g.rows.length - 1} title="下へ">
                      ↓
                    </button>
                  </form>
                  <a class="danger-link" href={`/notices/${r.notice.id}/delete`}>
                    削除
                  </a>
                </div>
              </li>
            ))}
          </ol>
          {g.rows.some((r) => r.notice.messageId) && (
            <form method="post" action={`/notices/channel/${g.channelId}/repost`} class="inline-actions">
              <Csrf session={session} />
              <label class="field check">
                <input type="checkbox" name="confirm" value="yes" required />
                <span>このチャンネルの掲示を全部消して、上の順番で投稿し直す（並べ替えたとき・途中に追加したとき）</span>
              </label>
              <button type="submit">投稿し直す</button>
            </form>
          )}
        </section>
      ))}
    </Layout>
  );
}

export function NoticeEditPage(props: {
  session: AdminSession;
  notice?: Notice;
  channels: { id: string; name: string; category: string | null }[];
  channelName?: string | null;
  vars: NoticeVariable[];
  preview: string;
  length: number;
  unknown: string[];
  error?: string;
}) {
  const { session, notice } = props;
  const action = notice ? `/notices/${notice.id}` : '/notices';
  return (
    <Layout title={notice ? `掲示の編集: ${notice.title}` : '掲示の追加'} session={session} nav="notices">
      <p>
        <a href="/notices">← 掲示の一覧</a>
      </p>
      <h1>{notice ? `掲示の編集: ${notice.title}` : '掲示の追加'}</h1>
      <Flash code={props.error} />
      <div class="notice-edit">
        <form method="post" action={action} class="card notice-form" id="notice-form">
          <Csrf session={session} />
          <label class="field">
            <span>投稿先のチャンネル</span>
            {notice ? (
              <input type="text" value={`#${props.channelName ?? notice.channelId}`} disabled />
            ) : (
              <select name="channelId" required>
                <option value="">選んでください</option>
                {props.channels.map((c) => (
                  <option value={c.id}>
                    {c.category ? `${c.category} / ` : ''}#{c.name}
                  </option>
                ))}
              </select>
            )}
          </label>
          <label class="field">
            <span>タイトル（管理画面での見分け用。Discord には出ません）</span>
            <input type="text" name="title" value={notice?.title ?? ''} maxlength={60} required />
          </label>
          <label class="field">
            <span>見せ方</span>
            <select
              name="style"
              hx-post="/notices/preview"
              hx-trigger="change"
              hx-target="#notice-preview"
              hx-include="#notice-form"
            >
              {(Object.keys(NOTICE_STYLES) as NoticeStyle[]).map((k) => (
                <option value={k} selected={(notice?.style ?? 'embed') === k}>
                  {NOTICE_STYLES[k].label}
                </option>
              ))}
            </select>
          </label>
          <label class="field check">
            <input type="checkbox" name="pinned" value="yes" checked={notice?.pinned ?? false} />
            <span>📌 ピン留めする（チャンネルの使い方など、話が流れても読めるように）</span>
          </label>
          <label class="field check">
            <input type="checkbox" name="sticky" value="yes" checked={notice?.sticky ?? false} />
            <span>⬇ いちばん下に表示し続ける（誰かが書き込むと、3 秒ほどで BOT が下に出し直す。#絵馬-男性 のひな形など。こちらを選ぶとピン留めはしません）</span>
          </label>
          <label class="field">
            <span>本文（Discord の書き方: # 見出し、**太字**、- 箇条書き、-# 小さい文字）</span>
            <textarea
              name="body"
              rows={24}
              required
              hx-post="/notices/preview"
              hx-trigger="input changed delay:500ms"
              hx-target="#notice-preview"
              hx-include="#notice-form"
            >
              {notice?.body ?? ''}
            </textarea>
          </label>
          <div class="inline-actions">
            <button type="submit" name="then" value="save">
              保存
            </button>
            <button type="submit" name="then" value="publish" class="ok">
              保存して Discord に反映
            </button>
          </div>
        </form>
        <div>
          <section class="card">
            <h2>プレビュー</h2>
            <div id="notice-preview">
              <NoticePreview preview={props.preview} length={props.length} unknown={props.unknown} style={notice?.style ?? 'embed'} />
            </div>
          </section>
          <section class="card">
            <h2>差し込める値</h2>
            <p class="note">
              本文に書くと、今の設定の値に置き換わります。<code>{'{#チャンネル名}'}</code> でチャンネルへのリンクになります。
            </p>
            <table class="compact">
              <tbody>
                {props.vars.map((v) => (
                  <tr>
                    <td>
                      <code>{`{${v.name}}`}</code>
                    </td>
                    <td class="wrap">{v.name === '役職一覧' ? '（役職の箇条書き）' : v.value}</td>
                    <td class="wrap note">{v.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </Layout>
  );
}

export function NoticePreview(props: { preview: string; length: number; unknown: string[]; style: string }) {
  const max = maxLengthOf(props.style);
  return (
    <>
      <p class={props.length > max ? 'flash warn' : 'note'}>
        {props.length} / {max} 文字{props.length > max ? '（多すぎます。2 つに分けてください）' : ''}
      </p>
      {props.unknown.length > 0 && <p class="flash warn">置き換えられない名前: {props.unknown.map((u) => `{${u}}`).join(' ')}</p>}
      <pre class={`notice-preview${props.style === 'text' ? '' : ' embed'}`}>{props.preview}</pre>
    </>
  );
}

export function NoticeDeletePage(props: { session: AdminSession; notice: Notice; channelName: string | null }) {
  const { session, notice } = props;
  return (
    <Layout title="掲示の削除" session={session} nav="notices">
      <section class="card confirm">
        <h1>掲示を削除しますか？</h1>
        <p>
          #{props.channelName ?? notice.channelId} の「{notice.title}」を削除します。
          {notice.messageId ? 'Discord に投稿したメッセージも消えます。' : ''}元に戻せません。
        </p>
        <form method="post" action={`/notices/${notice.id}/delete`}>
          <Csrf session={session} />
          <button type="submit" class="danger">
            削除する
          </button>
          <a class="cancel" href="/notices">
            やめる
          </a>
        </form>
      </section>
    </Layout>
  );
}

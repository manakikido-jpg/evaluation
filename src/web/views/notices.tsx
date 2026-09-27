import { raw } from 'hono/html';
import type { AdminSession, Notice } from '../../db/schema.js';
import {
  maxLengthOf,
  NOTICE_STYLES,
  parseMention,
  type ImagePosition,
  type NoticeStatus,
  type NoticeStyle,
  type NoticeVariable,
} from '../../services/notices.js';
import { fmtAgo } from '../format.js';
import { discordMarkdownToHtml } from '../markdown.js';
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
  invalid: { text: '入力が足りません（タイトル・本文・チャンネル。本文なしにできるのは「朱印を押す」ボタンを付けたときだけ）。', kind: 'warn' },
  shuin_buttons: { text: '🌸 カテゴリの全部のチャンネルに「朱印を押す」ボタンを置きました（ひな形があるチャンネルはひな形に、ないチャンネルはボタンだけ）。内容を見て「すべて反映」を押すと Discord に出ます。', kind: 'ok' },
  shuin_buttons_none: { text: 'そのカテゴリには、ボタンを置くテキストチャンネルがありませんでした（もう全部に付いているかもしれません）。', kind: 'warn' },
  image_too_big: { text: '写真が大きすぎます（8MB まで）。小さくしてから選び直してください。', kind: 'warn' },
  image_bad_type: { text: '写真は PNG・JPEG・GIF・WebP のどれかにしてください。', kind: 'warn' },
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

export type NoticeRow = { notice: Notice; preview: string; length: number; status: NoticeStatus; unknown: string[]; mention: string };
export type NoticeGroup = { channelId: string; channelName: string | null; rows: NoticeRow[] };

export function NoticesPage(props: {
  session: AdminSession;
  groups: NoticeGroup[];
  flash?: string;
  now: Date;
  /** カテゴリ（「朱印を押す」ボタンをまとめて置く先を選ぶ） */
  categories?: { id: string; name: string }[];
}) {
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

      {(props.categories ?? []).length > 0 && (
        <details class="card">
          <summary>🌸 カテゴリの全部のチャンネルに「朱印を押す」ボタンを置く</summary>
          <p class="note">
            選んだカテゴリ（絵馬殿など）のテキストチャンネル全部の、いちばん下に「🌸 朱印を押す」ボタンを置きます。いちばん下に表示し続ける掲示（#絵馬
            のひな形など）があればそれにボタンを付け、なければボタンだけ（文章なし）の掲示を作ります。押したあと「すべて反映」を押すと Discord に出ます。
          </p>
          <form method="post" action="/notices/shuin-category" class="inline-actions">
            <Csrf session={session} />
            <select name="categoryId" required>
              {(props.categories ?? []).map((c) => (
                <option value={c.id} selected={c.name.includes('絵馬')}>
                  {c.name}
                </option>
              ))}
            </select>
            <button type="submit" class="ok">
              ボタンを置く
            </button>
          </form>
        </details>
      )}

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
          <p>まだ掲示がありません。#鳥居（ようこそ）と #しきたり（ルール・朱印の仕組み・銭・用語集）の標準の文面を入れられます。</p>
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
                  {r.mention && <small>🔔 {r.mention}</small>}
                  {r.notice.imageHash && <small>🖼 写真（{r.notice.imagePosition === 'top' ? '上' : '下'}）</small>}
                  {r.notice.shuinButton && <small>🌸 朱印ボタン</small>}
                  <small class={r.length > maxLengthOf(r.notice.style) ? 'over' : ''}>
                    {r.length} / {maxLengthOf(r.notice.style)} 文字
                  </small>
                  <small>更新 {fmtAgo(r.notice.updatedAt, props.now)}</small>
                </div>
                {r.unknown.length > 0 && <p class="flash warn">置き換えられない名前: {r.unknown.map((u) => `{${u}}`).join(' ')}</p>}
                <Rendered text={r.preview} style={r.notice.style} mention={r.mention} image={imageOf(r.notice)} button={r.notice.shuinButton} />
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
  roles: { id: string; name: string }[];
  vars: NoticeVariable[];
  preview: string;
  length: number;
  unknown: string[];
  error?: string;
}) {
  const { session, notice } = props;
  const action = notice ? `/notices/${notice.id}` : '/notices';
  const mention = parseMention(notice?.mention);
  const picked = new Set(mention.kind === 'roles' ? mention.roleIds : []);
  const preview = { 'hx-post': '/notices/preview', 'hx-trigger': 'change', 'hx-target': '#notice-preview', 'hx-include': '#notice-form' };
  const mentionLabel = mention.kind === 'here' ? '@here' : mention.kind === 'everyone' ? '@everyone' : props.roles.filter((r) => picked.has(r.id)).map((r) => `@${r.name}`).join(' ');
  return (
    <Layout title={notice ? `掲示の編集: ${notice.title}` : '掲示の追加'} session={session} nav="notices" scripts={['editor.js']}>
      <p>
        <a href="/notices">← 掲示の一覧</a>
      </p>
      <h1>{notice ? `掲示の編集: ${notice.title}` : '掲示の追加'}</h1>
      <Flash code={props.error} />
      <div class="notice-edit">
        {/* プレビューのたびに写真を送らないよう、htmx には写真を入れない */}
        <form method="post" action={action} class="card notice-form" id="notice-form" enctype="multipart/form-data" hx-params="not image">
          <Csrf session={session} />
          {notice && <input type="hidden" name="noticeId" value={String(notice.id)} />}
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
          <label class="field check">
            <input type="checkbox" name="shuinButton" value="yes" checked={notice?.shuinButton ?? false} {...preview} />
            <span>🌸「朱印を押す」ボタンを付ける（押すと相手を選んで朱印を押せる。#絵馬 のひな形など、いちばん下に表示し続けるものに付けるのがおすすめ）</span>
          </label>
          <fieldset class="field mention-pick" {...preview}>
            <legend>🔔 メンション（投稿したときに通知を届ける相手）</legend>
            <div class="inline-actions">
              {(
                [
                  ['none', 'なし'],
                  ['here', '@here（いまオンラインの人）'],
                  ['everyone', '@everyone（全員）'],
                  ['roles', 'ロール（下で選ぶ）'],
                ] as const
              ).map(([v, label]) => (
                <label class="check">
                  <input type="radio" name="mentionKind" value={v} checked={mention.kind === v} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            {props.roles.length > 0 ? (
              <div class="role-checks">
                {props.roles.map((r) => (
                  <label class="check">
                    <input type="checkbox" name="mentionRoles" value={r.id} checked={picked.has(r.id)} />
                    <span>@{r.name}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p class="note">ロールを読み込めませんでした（BOT が動いていれば、少しあとに開き直すと出ます）。</p>
            )}
            <p class="note">
              通知が届くのは<strong>はじめて投稿したときだけ</strong>です（あとから書き換えても、もう一度は鳴りません）。ロールは 5 つまで。@everyone・@here や「メンションを許可」していないロールを鳴らすには、BOT
              のロールに「@everyone、@here、全てのロールにメンション」の権限が要ります。
            </p>
          </fieldset>
          <label class="field" for="notice-body">
            <span>本文（Discord の書き方で飾れます。下のボタンか、Ctrl+B 太字・Ctrl+I 斜体・Ctrl+U 下線）</span>
          </label>
          <MarkdownToolbar target="notice-body" />
          <textarea
            id="notice-body"
            name="body"
            rows={24}
            data-md-editor
            hx-post="/notices/preview"
            hx-trigger="input changed delay:500ms"
            hx-target="#notice-preview"
            hx-include="#notice-form"
          >
            {notice?.body ?? ''}
          </textarea>
          <fieldset class="field image-pick" {...preview}>
            <legend>🖼 写真</legend>
            {notice?.imageHash && (
              <div class="image-current">
                <img src={`/notices/${notice.id}/image?v=${notice.imageHash}`} alt="今の写真" />
                <label class="check">
                  <input type="checkbox" name="removeImage" value="yes" />
                  <span>写真を外す</span>
                </label>
              </div>
            )}
            <label class="field">
              <span>{notice?.imageHash ? '別の写真に替える' : '写真を選ぶ'}（PNG・JPEG・GIF・WebP、8MB まで）</span>
              <input type="file" name="image" accept="image/png,image/jpeg,image/gif,image/webp" data-image-input />
            </label>
            <div class="inline-actions">
              {(
                [
                  ['top', '⬆ 本文の上'],
                  ['bottom', '⬇ 本文の下'],
                ] as const
              ).map(([v, label]) => (
                <label class="check">
                  <input type="radio" name="imagePosition" value={v} checked={(notice?.imagePosition ?? 'bottom') === v} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <p class="note">
              カードは、上なら写真のカードを本文のカードの上に、下なら本文のカードの中のいちばん下に出します。普通のメッセージは Discord の決まりで、写真はいつも本文の下になります。
            </p>
          </fieldset>
          <details class="md-help">
            <summary>書き方の一覧</summary>
            <table class="compact">
              <tbody>
                {MD_HELP.map(([src, note]) => (
                  <tr>
                    <td>
                      <code>{src}</code>
                    </td>
                    <td class="wrap note">{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
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
              <NoticePreview
                preview={props.preview}
                length={props.length}
                unknown={props.unknown}
                style={notice?.style ?? 'embed'}
                mention={mentionLabel}
                image={imageOf(notice)}
                slot
                button={notice?.shuinButton ?? false}
              />
            </div>
          </section>
          <section class="card">
            <h2>差し込める値</h2>
            <p class="note">
              本文に書くと、今の設定の値に置き換わります。<code>{'{#チャンネル名}'}</code> でチャンネルへのリンクになります。名前を押すと、本文のカーソルの所に入ります。
            </p>
            <table class="compact">
              <tbody>
                {props.vars.map((v) => (
                  <tr>
                    <td>
                      <button type="button" class="md-insert" data-md="insert" data-target="notice-body" data-text={`{${v.name}}`}>
                        {`{${v.name}}`}
                      </button>
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

type PreviewImage = { url?: string; position: ImagePosition };

/** 保存済みの写真（プレビュー用の URL） */
const imageOf = (n?: Notice): PreviewImage => ({
  url: n?.imageHash ? `/notices/${n.id}/image?v=${n.imageHash}` : undefined,
  position: n?.imagePosition ?? 'bottom',
});

export function NoticePreview(props: {
  preview: string;
  length: number;
  unknown: string[];
  style: string;
  mention?: string;
  image?: PreviewImage;
  /** 編集画面: 新しく選んだ写真を JS が入れる場所を用意する */
  slot?: boolean;
  button?: boolean;
}) {
  const max = maxLengthOf(props.style);
  return (
    <>
      <p class={props.length > max ? 'flash warn' : 'note'}>
        {props.length} / {max} 文字{props.length > max ? '（多すぎます。2 つに分けてください）' : ''}
      </p>
      {props.unknown.length > 0 && <p class="flash warn">置き換えられない名前: {props.unknown.map((u) => `{${u}}`).join(' ')}</p>}
      <Rendered text={props.preview} style={props.style} mention={props.mention} image={props.image} slot={props.slot} button={props.button} />
    </>
  );
}

/** Discord での見た目（メンションはカードの上・普通のメッセージなら 1 行目。写真は上か下） */
function Rendered(props: { text: string; style: string; mention?: string; image?: PreviewImage; slot?: boolean; button?: boolean }) {
  const card = props.style !== 'text';
  // 普通のメッセージの写真は、いつも本文の下
  const top = card && props.image?.position === 'top';
  const img = (props.image?.url || props.slot) && (
    <img class="notice-img" src={props.image?.url} alt="写真" hidden={!props.image?.url} {...(props.slot ? { 'data-image-slot': '' } : {})} />
  );
  const body = raw(discordMarkdownToHtml(props.text));
  return (
    <div class="notice-rendered">
      {props.mention && <div class="md-mentionline">{props.mention}</div>}
      {top && img && (
        <div class="notice-preview embed notice-img-card" hidden={!props.image?.url}>
          {img}
        </div>
      )}
      <div class={`notice-preview md${card ? ' embed' : ''}`}>
        {body}
        {card && !top && img}
      </div>
      {!card && img}
      {props.button && <div class="md-button">🌸 朱印を押す</div>}
    </div>
  );
}

/** 飾りのボタン（押すと選んだ文字を囲む・行の頭に付ける。JS がなければ何もしないので、手で書く） */
const TOOLBAR: { label: string; title: string; attrs: Record<string, string> }[][] = [
  [
    { label: 'B', title: '太字 **文字**', attrs: { 'data-md': 'wrap', 'data-before': '**' } },
    { label: 'I', title: '斜体 *文字*', attrs: { 'data-md': 'wrap', 'data-before': '*' } },
    { label: 'U', title: '下線 __文字__', attrs: { 'data-md': 'wrap', 'data-before': '__' } },
    { label: 'S', title: '取り消し線 ~~文字~~', attrs: { 'data-md': 'wrap', 'data-before': '~~' } },
    { label: '伏せ字', title: 'ネタバレ（押すと見える） ||文字||', attrs: { 'data-md': 'wrap', 'data-before': '||' } },
  ],
  [
    { label: '見出し大', title: '# 見出し', attrs: { 'data-md': 'line', 'data-prefix': '# ' } },
    { label: '中', title: '## 見出し', attrs: { 'data-md': 'line', 'data-prefix': '## ' } },
    { label: '小', title: '### 見出し', attrs: { 'data-md': 'line', 'data-prefix': '### ' } },
    { label: '小さい文字', title: '-# 小さい文字', attrs: { 'data-md': 'line', 'data-prefix': '-# ' } },
  ],
  [
    { label: '• 箇条書き', title: '- 箇条書き', attrs: { 'data-md': 'line', 'data-prefix': '- ' } },
    { label: '1. 番号', title: '1. 番号付き', attrs: { 'data-md': 'line', 'data-prefix': '1. ', 'data-numbered': 'yes' } },
    { label: '❝ 引用', title: '> 引用', attrs: { 'data-md': 'line', 'data-prefix': '> ' } },
  ],
  [
    { label: '`コード`', title: '`コード`', attrs: { 'data-md': 'wrap', 'data-before': '`' } },
    { label: 'コード枠', title: '```コードブロック```', attrs: { 'data-md': 'code' } },
    { label: '🔗 リンク', title: '[文字](https://…)', attrs: { 'data-md': 'link' } },
  ],
];

function MarkdownToolbar(props: { target: string }) {
  return (
    <div class="md-toolbar" role="toolbar" aria-label="本文の飾り">
      {TOOLBAR.map((group) => (
        <span class="md-group">
          {group.map((b) => (
            <button type="button" title={b.title} data-target={props.target} {...b.attrs}>
              {b.label}
            </button>
          ))}
        </span>
      ))}
    </div>
  );
}

const MD_HELP: [string, string][] = [
  ['**太字**', '太字'],
  ['*斜体*', '斜め（_斜体_ でも）'],
  ['__下線__', '下線'],
  ['~~取り消し~~', '取り消し線'],
  ['||ネタバレ||', '押すまで隠れる'],
  ['***太字の斜体***', '組み合わせもできます（__**下線の太字**__ など）'],
  ['# 見出し', '大きな見出し（## 中・### 小）。行の頭に書く'],
  ['-# 小さい文字', '小さく薄い文字。注意書きに'],
  ['- 箇条書き', '行の頭に。先頭に空白 2 つで 1 段下げる'],
  ['1. 番号付き', '番号の箇条書き'],
  ['> 引用', 'その行を引用の枠に（>>> ならそこから最後まで）'],
  ['`コード`', '等幅の文字'],
  ['```\n複数行\n```', 'コードの枠'],
  ['[文字](https://…)', '文字にリンクを付ける'],
  ['{#チャンネル名}', 'チャンネルへのリンク'],
];

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

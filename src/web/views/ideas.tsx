import { raw } from 'hono/html';
import type { AdminSession, IdeaComment } from '../../db/schema.js';
import { IDEA_BODY_MAX, IDEA_COMMENT_MAX, IDEA_KINDS, IDEA_STATUSES, IDEA_TITLE_MAX, type IdeaKind, type IdeaRow, type IdeaStatus } from '../../services/ideas.js';
import { fmtDateTime } from '../format.js';
import { discordMarkdownToHtml } from '../markdown.js';
import { Layout } from './layout.js';

/** 💡 アイデア・共有メモ（運営どうし） */

export const IDEAS_FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  created: { text: '書きました。', kind: 'ok' },
  saved: { text: '保存しました。', kind: 'ok' },
  status: { text: '状態を変えました。', kind: 'ok' },
  commented: { text: 'コメントしました。', kind: 'ok' },
  deleted: { text: '消しました。', kind: 'ok' },
  invalid: { text: '題を入れてください。', kind: 'warn' },
  forbidden: { text: '直す・消すのは、書いた人と宮司だけです。', kind: 'warn' },
};

function Flash(props: { code?: string }) {
  const f = props.code && Object.hasOwn(IDEAS_FLASH, props.code) ? IDEAS_FLASH[props.code] : undefined;
  return f ? <p class={`flash ${f.kind}`}>{f.text}</p> : null;
}
const Csrf = (props: { session: AdminSession }) => <input type="hidden" name="_csrf" value={props.session.csrfToken} />;
type Names = (id: string) => string;

const KindBadge = (p: { kind: string }) => {
  const k = IDEA_KINDS[p.kind as IdeaKind] ?? IDEA_KINDS.memo;
  return (
    <span class={`idea-kind ${p.kind}`}>
      {k.emoji} {k.label}
    </span>
  );
};
const StatusBadge = (p: { status: string }) => {
  const s = IDEA_STATUSES[p.status as IdeaStatus] ?? IDEA_STATUSES.new;
  return (
    <span class={`idea-status ${p.status}`}>
      {s.emoji} {s.label}
    </span>
  );
};

/** 👍 ボタン（押すと付く・もう一度で外れる） */
function Vote(p: { session: AdminSession; idea: IdeaRow; back: string }) {
  return (
    <form method="post" action={`/ideas/${p.idea.id}/vote`} class="inline">
      <Csrf session={p.session} />
      <input type="hidden" name="back" value={p.back} />
      <button type="submit" class={`idea-vote${p.idea.voted ? ' on' : ''}`} aria-pressed={p.idea.voted ? 'true' : 'false'} title={p.idea.voted ? '👍 を外す' : 'いいね（賛成）'}>
        👍 {p.idea.votes}
      </button>
    </form>
  );
}

/** 書く・直すフォーム */
function IdeaForm(p: { session: AdminSession; idea?: IdeaRow; kind?: IdeaKind }) {
  const kind = (p.idea?.kind as IdeaKind | undefined) ?? p.kind ?? 'idea';
  return (
    <form method="post" action={p.idea ? `/ideas/${p.idea.id}/edit` : '/ideas'} class="idea-form">
      <Csrf session={p.session} />
      <div class="idea-kinds" role="radiogroup" aria-label="種類">
        {(Object.keys(IDEA_KINDS) as IdeaKind[]).map((k) => (
          <label class="idea-kind-pick">
            <input type="radio" name="kind" value={k} checked={k === kind} />
            <span>
              {IDEA_KINDS[k].emoji} {IDEA_KINDS[k].label}
            </span>
          </label>
        ))}
      </div>
      <label class="field">
        <span>題 *</span>
        <input type="text" name="title" maxlength={IDEA_TITLE_MAX} required value={p.idea?.title ?? ''} placeholder="例: 夏祭りのイベントをやりたい" />
      </label>
      <label class="field">
        <span>中身（Discord と同じ書き方: **太字**・- 箇条書き・URL）</span>
        <textarea name="body" rows={p.idea ? 8 : 4} maxlength={IDEA_BODY_MAX} placeholder="なぜ・どんなふうに・参考の URL など">
          {p.idea?.body ?? ''}
        </textarea>
      </label>
      <div class="inline-actions">
        {p.idea && <a href={`/ideas/${p.idea.id}`}>やめる</a>}
        <button type="submit" class="ok">
          {p.idea ? '保存する' : '書く'}
        </button>
      </div>
    </form>
  );
}

export function IdeasPage(props: {
  session: AdminSession;
  ideas: IdeaRow[];
  counts: { byStatus: Record<string, number>; byKind: Record<string, number>; open: number };
  name: Names;
  kind?: IdeaKind;
  status?: IdeaStatus | 'open';
  q?: string;
  flash?: string;
}) {
  const { session } = props;
  const link = (o: { kind?: string; status?: string; q?: string }) => {
    const p = new URLSearchParams();
    const kind = 'kind' in o ? o.kind : props.kind;
    const status = 'status' in o ? o.status : props.status;
    if (kind) p.set('kind', kind);
    if (status) p.set('status', status);
    if (props.q) p.set('q', props.q);
    const s = p.toString();
    return `/ideas${s ? `?${s}` : ''}`;
  };
  const back = link({});
  return (
    <Layout title="アイデア・共有" session={session} nav="ideas">
      <div class="page-head">
        <h1>💡 アイデア・共有</h1>
      </div>
      <p class="note">足したい機能・みんなに共有したいこと・不具合・メモを、運営どうしで書いておく場所です。👍 で賛成、コメントで相談、状態（アイデア → 検討中 → やる → 作業中 → できた）で進み具合が分かります。</p>
      <Flash code={props.flash} />

      <details class="card idea-new" open={props.ideas.length === 0}>
        <summary>✏ 新しく書く</summary>
        <IdeaForm session={session} kind={props.kind} />
      </details>

      <nav class="tabs" aria-label="種類">
        <a href={link({ kind: undefined })} class={!props.kind ? 'on' : ''}>
          すべて
        </a>
        {(Object.keys(IDEA_KINDS) as IdeaKind[]).map((k) => (
          <a href={link({ kind: k })} class={props.kind === k ? 'on' : ''}>
            {IDEA_KINDS[k].emoji} {IDEA_KINDS[k].label} <small>{props.counts.byKind[k] ?? 0}</small>
          </a>
        ))}
      </nav>
      <div class="idea-filter">
        <a href={link({ status: undefined })} class={!props.status ? 'on' : ''}>
          すべての状態
        </a>
        <a href={link({ status: 'open' })} class={props.status === 'open' ? 'on' : ''}>
          まだ終わっていない <small>{props.counts.open}</small>
        </a>
        {(Object.keys(IDEA_STATUSES) as IdeaStatus[]).map((s) => (
          <a href={link({ status: s })} class={props.status === s ? 'on' : ''}>
            {IDEA_STATUSES[s].emoji} {IDEA_STATUSES[s].label} <small>{props.counts.byStatus[s] ?? 0}</small>
          </a>
        ))}
        <form method="get" action="/ideas" class="idea-search">
          {props.kind && <input type="hidden" name="kind" value={props.kind} />}
          {props.status && <input type="hidden" name="status" value={props.status} />}
          <input type="search" name="q" value={props.q ?? ''} placeholder="さがす" aria-label="さがす" />
        </form>
      </div>

      {props.ideas.length === 0 ? (
        <p class="empty">まだありません。「✏ 新しく書く」から書いてください。</p>
      ) : (
        <div class="idea-list">
          {props.ideas.map((i) => (
            <article class={`card idea-card status-${i.status}${i.pinned ? ' pinned' : ''}`}>
              <div class="idea-head">
                {i.pinned && <span class="idea-pin">📌</span>}
                <KindBadge kind={i.kind} />
                <StatusBadge status={i.status} />
                <a href={`/ideas/${i.id}`} class="idea-title">
                  {i.title}
                </a>
              </div>
              {i.body && <div class="idea-body clamp">{raw(discordMarkdownToHtml(i.body))}</div>}
              <div class="idea-foot">
                <Vote session={session} idea={i} back={back} />
                <a href={`/ideas/${i.id}#comments`}>💬 {i.comments}</a>
                <span class="note">
                  {props.name(i.createdBy)} ・ {fmtDateTime(i.createdAt)}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </Layout>
  );
}

export function IdeaPage(props: { session: AdminSession; idea: IdeaRow; comments: IdeaComment[]; voters: string[]; name: Names; canEdit: boolean; edit?: boolean; flash?: string }) {
  const { session, idea: i } = props;
  const guji = session.level === 'guji';
  const back = `/ideas/${i.id}`;
  return (
    <Layout title={i.title} session={session} nav="ideas">
      <div class="page-head">
        <h1>
          {i.pinned && '📌 '}
          {i.title}
        </h1>
        <a href="/ideas">← アイデア・共有</a>
      </div>
      <Flash code={props.flash} />
      {props.edit && props.canEdit ? (
        <section class="card">
          <h2>✏ 直す</h2>
          <IdeaForm session={session} idea={i} />
        </section>
      ) : (
        <section class="card">
          <div class="idea-head">
            <KindBadge kind={i.kind} />
            <StatusBadge status={i.status} />
          </div>
          {i.body ? <div class="idea-body">{raw(discordMarkdownToHtml(i.body))}</div> : <p class="note">（中身なし）</p>}
          <p class="note">
            書いた人: {props.name(i.createdBy)} ・ {fmtDateTime(i.createdAt)}
            {i.updatedBy !== i.createdBy && ` ・ さいごに動かした人: ${props.name(i.updatedBy)}`}
          </p>
          <div class="idea-foot">
            <Vote session={session} idea={i} back={back} />
            {props.voters.length > 0 && <span class="note">👍 {props.voters.map(props.name).join('・')}</span>}
          </div>
          <div class="idea-actions">
            <form method="post" action={`/ideas/${i.id}/status`} class="inline-actions">
              <Csrf session={session} />
              <label>
                状態:{' '}
                <select name="status">
                  {(Object.keys(IDEA_STATUSES) as IdeaStatus[]).map((s) => (
                    <option value={s} selected={s === i.status}>
                      {IDEA_STATUSES[s].emoji} {IDEA_STATUSES[s].label}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" class="small">
                変える
              </button>
            </form>
            <form method="post" action={`/ideas/${i.id}/pin`} class="inline">
              <Csrf session={session} />
              <input type="hidden" name="pinned" value={i.pinned ? 'no' : 'yes'} />
              <button type="submit" class="small">
                {i.pinned ? '📌 ピン留めを外す' : '📌 いちばん上に留める'}
              </button>
            </form>
            {props.canEdit && (
              <>
                <a class="button-link" href={`/ideas/${i.id}?edit=1`}>
                  ✏ 直す
                </a>
                <form method="post" action={`/ideas/${i.id}/delete`} class="inline" data-confirm="消しますか？（コメント・👍 も消えます）">
                  <Csrf session={session} />
                  <button type="submit" class="danger small">
                    消す
                  </button>
                </form>
              </>
            )}
          </div>
        </section>
      )}

      <section class="card anchor" id="comments">
        <h2>💬 コメント（{props.comments.length}）</h2>
        {props.comments.length === 0 && <p class="empty">まだありません。</p>}
        <ul class="idea-comments">
          {props.comments.map((c) => (
            <li>
              <div class="idea-comment-head">
                <b>{props.name(c.by)}</b> <span class="note">{fmtDateTime(c.at)}</span>
                {(guji || c.by === session.userId) && (
                  <form method="post" action={`/ideas/comments/${c.id}/delete`} class="inline">
                    <Csrf session={session} />
                    <button type="submit" class="link small" title="コメントを消す">
                      消す
                    </button>
                  </form>
                )}
              </div>
              <div class="idea-body">{raw(discordMarkdownToHtml(c.body))}</div>
            </li>
          ))}
        </ul>
        <form method="post" action={`/ideas/${i.id}/comments`} class="idea-comment-form">
          <Csrf session={session} />
          <textarea name="body" rows={3} maxlength={IDEA_COMMENT_MAX} required placeholder="コメントを書く（賛成・反対・こうしたら？など）"></textarea>
          <button type="submit" class="ok">
            コメントする
          </button>
        </form>
      </section>
    </Layout>
  );
}

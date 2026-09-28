import type { AdminSession, BoardEntry, BoardPost } from '../../db/schema.js';
import { BOARD_CATEGORIES, hiredCount, type BoardCategory } from '../../services/board.js';
import { fmtDateTime } from '../format.js';
import { Layout } from './layout.js';

export const BOARD_FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  place_saved: { text: '掲示板のチャンネルを決めて、「募集を書く」を出しました。', kind: 'ok' },
  panel: { text: '「募集を書く」をいちばん下に出し直しました。', kind: 'ok' },
  panel_failed: { text: '出せませんでした。BOT がそのチャンネルに書き込めるか確かめてください。', kind: 'warn' },
  no_place: { text: '先に掲示板のチャンネルを選んでください。', kind: 'warn' },
  removed: { text: '取り下げました（採用しなかった分の報酬は、募集した人に戻しました）。', kind: 'ok' },
  paid: { text: '報酬を渡しました。', kind: 'ok' },
  refunded: { text: '報酬を募集した人に戻しました。', kind: 'ok' },
  done_already: { text: 'もう終わっています。', kind: 'warn' },
};

const STATUS: Record<BoardEntry['status'], string> = { applied: '応募', hired: '採用（仕事中）', done: '完了', disputed: '⚠ 問題あり', refunded: '戻した' };

function Csrf(props: { session: AdminSession }) {
  return <input type="hidden" name="_csrf" value={props.session.csrfToken} />;
}

export function BoardPage(props: {
  session: AdminSession;
  channelId?: string;
  channels: { id: string; name: string; category: string | null }[];
  posts: BoardPost[];
  entries: BoardEntry[];
  name: (id: string) => string;
  coin: string;
  feePercent: number;
  flash?: string;
}) {
  const { session, name } = props;
  const f = props.flash && Object.hasOwn(BOARD_FLASH, props.flash) ? BOARD_FLASH[props.flash] : undefined;
  const byPost = (id: number) => props.entries.filter((e) => e.postId === id);
  const disputed = props.entries.filter((e) => e.status === 'disputed');
  const post = (id: number) => props.posts.find((p) => p.id === id);
  const current = props.channels.find((c) => c.id === props.channelId);
  return (
    <Layout title="掲示板" session={session} nav="board">
      <div class="page-head">
        <h1>📌 掲示板</h1>
      </div>
      {f && <p class={`flash ${f.kind}`}>{f.text}</p>}
      <p class="note">
        仕事・依頼・手伝い・仲間・イベントの募集の板です。入鯖が承認された人ならだれでも「📝 募集を書く」から書けます（報酬を付けられるのは 2 段目の役職以上）。報酬（{props.coin}）は人数分を宮が預かり、募集した人が「完了」を押すか、採用から市場と同じ日数が過ぎると採用された人に渡します（手数料 {props.feePercent}%）。締め切ったら、採用しなかった分は戻ります。
      </p>

      <section class="card">
        <h2>置き場所</h2>
        <p class="note">
          {current ? `いまは「${current.category ? `${current.category} / ` : ''}#${current.name}」です。` : 'まだ決まっていません。'}
          募集ごとにカードとスレッドを BOT が作ります。メンバーは直接書き込めない（スレッドには書ける）チャンネルにすると見やすくなります。
        </p>
        <form method="post" action="/board/place" class="inline-actions">
          <Csrf session={session} />
          <select name="channelId" required aria-label="掲示板のチャンネル">
            <option value="">チャンネルを選ぶ</option>
            {props.channels.map((c) => (
              <option value={c.id} selected={c.id === props.channelId}>
                {c.category ? `${c.category} / ` : ''}#{c.name}
              </option>
            ))}
          </select>
          <button type="submit" class="ok">
            ここにする
          </button>
        </form>
        {current && (
          <form method="post" action="/board/panel" class="inline-actions">
            <Csrf session={session} />
            <button type="submit">「募集を書く」を出し直す</button>
          </form>
        )}
      </section>

      {disputed.length > 0 && (
        <section class="card ch-group">
          <div class="ch-cat">
            <span class="ch-cat-name">⚠ 問題あり（運営が決める）</span>
            <span class="ch-count">{disputed.length}</span>
          </div>
          <ul class="ch-list">
            {disputed.map((e) => {
              const p = post(e.postId);
              return (
                <li class="ch-row">
                  <span class="ch-icon" aria-hidden="true">
                    ⚠
                  </span>
                  <div class="ch-main">
                    <div class="ch-line">
                      <span class="ch-name">{p ? p.title : `募集 #${e.postId}`}</span>
                      <span class="tag red">
                        {props.coin} {p?.reward.toLocaleString('ja-JP')} 枚
                      </span>
                    </div>
                    <div class="ch-topic">
                      募集した人 <a href={`/members/${p?.authorId ?? ''}`}>{p ? name(p.authorId) : ''}</a> ・ 採用された人 <a href={`/members/${e.memberId}`}>{name(e.memberId)}</a>
                      {e.hiredAt ? ` ・ ${fmtDateTime(e.hiredAt)} に採用` : ''}
                    </div>
                  </div>
                  <span class="ch-actions">
                    <form method="post" action={`/board/entries/${e.id}/pay`} class="row-actions">
                      <Csrf session={session} />
                      <button type="submit" class="ok">
                        採用された人に渡す
                      </button>
                    </form>
                    <form method="post" action={`/board/entries/${e.id}/refund`} class="row-actions">
                      <Csrf session={session} />
                      <button type="submit" class="danger">
                        募集した人に戻す
                      </button>
                    </form>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section class="card ch-group">
        <div class="ch-cat">
          <span class="ch-cat-name">募集</span>
          <span class="ch-count">{props.posts.length}</span>
          <span class="note">新しい順（100 件まで）</span>
        </div>
        {props.posts.length ? (
          <ul class="ch-list">
            {props.posts.map((p) => {
              const c = BOARD_CATEGORIES[p.category as BoardCategory] ?? BOARD_CATEGORIES.other;
              const es = byPost(p.id);
              return (
                <li class={`ch-row${p.status === 'open' ? '' : ' off'}`}>
                  <span class="ch-icon" aria-hidden="true">
                    {c.emoji}
                  </span>
                  <div class="ch-main">
                    <div class="ch-line">
                      <span class="ch-name">{p.title}</span>
                      <span class={`tag ${p.status === 'open' ? 'green' : 'gray'}`}>{p.status === 'open' ? '募集中' : p.status === 'removed' ? '取り下げ' : '締め切り'}</span>
                      <span class="tag gray">
                        {hiredCount(es)} / {p.slots} 人（応募 {es.length}）
                      </span>
                      {p.reward > 0 && (
                        <span class="tag gray">
                          報酬 1 人 {p.reward.toLocaleString('ja-JP')} 枚・預かり {p.escrow.toLocaleString('ja-JP')} 枚
                        </span>
                      )}
                    </div>
                    <div class="ch-topic">
                      <a href={`/members/${p.authorId}`}>{name(p.authorId)}</a> ・ {c.label} ・ {fmtDateTime(p.createdAt)}
                      {es.length ? ` ・ ${es.map((e) => `${name(e.memberId)}（${STATUS[e.status]}）`).join('、')}` : ''}
                    </div>
                  </div>
                  <span class="ch-actions">
                    {p.status !== 'removed' && (
                      <form method="post" action={`/board/posts/${p.id}/remove`} class="row-actions">
                        <Csrf session={session} />
                        <button type="submit" class="danger">
                          取り下げ
                        </button>
                      </form>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p class="note ch-empty">まだ募集はありません。</p>
        )}
      </section>
    </Layout>
  );
}

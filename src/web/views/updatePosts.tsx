import type { AdminSession } from '../../db/schema.js';
import type { GuildChannel, GuildRole } from '../../lib/discordRest.js';
import type { UpdatePostConfig, UpdatePostRow as UpdatePost } from '../../services/updatePosts.js';
import { DeviceFrame, STATUS_LABEL, UpdatePostPreview } from '../updateDesk.js';
import { fmtDateTime } from '../format.js';
import { Layout } from './layout.js';

const FLASH: Record<string, string> = {
  saved: '保存しました。', posted: '許可して投稿しました。', rejected: 'まとめ係に戻しました。', gone: 'もう処理された投稿文です。',
  failed: 'Discord に投稿できませんでした。許可待ちに戻したので、もう一度お試しください。', nochannel: '先に「投稿するチャンネル」を決めてください。', invalid: '入力を確かめてください。',
};

/** 📝 まとめ係が書いた投稿文を見て、許可（投稿）・戻すを選ぶ */
export function UpdatePostsPage(p: { session: AdminSession; config: UpdatePostConfig; pending: UpdatePost[]; done: UpdatePost[]; channels: GuildChannel[]; roles: GuildRole[]; names: Map<string, string>; flash?: string }) {
  const csrf = <input type="hidden" name="_csrf" value={p.session.csrfToken} />;
  const guji = p.session.level === 'guji';
  const channel = p.channels.find(c => c.id === p.config.channelId);
  const name = (id: string | null) => (id && p.names.get(id)) || id || '';
  const preview = (post: UpdatePost) => <DeviceFrame name={`device-${post.id}`}><UpdatePostPreview post={post} imageUrl={post.imageHash ? `/posts/${post.id}/image?v=${post.imageHash}` : undefined} /></DeviceFrame>;
  return <Layout title="投稿文の許可" nav="posts" session={p.session}>
    <h1>📝 投稿文の許可</h1>
    {p.flash && <p role="status">{FLASH[p.flash] ?? p.flash}</p>}
    <p>まとめ係のロールの人が、サーバーの更新のお知らせを書いて申請します。中身を見て「許可して投稿」を押すと、決めたチャンネルに投稿します（通知は飛ばしません）。直してほしいときは、ひとことを付けて戻せます。まとめ係は Discord で <strong>/投稿文</strong> を打つと、専用のページに入れます。</p>
    <section class="card"><h2>⏳ 許可待ち（{p.pending.length}）</h2>
      {!channel && <p class="c-alert">投稿するチャンネルが決まっていません。下の設定で選んでください。</p>}
      {!p.pending.length && <p class="note">許可待ちの投稿文はありません。</p>}
      {p.pending.map(post => <article class="card">
        <p><strong>{post.title || '（題なし）'}</strong> ・ {post.authorName || name(post.authorId)} さん ・ 申請 {post.submittedAt ? fmtDateTime(post.submittedAt) : ''}</p>
        {preview(post)}
        <form method="post" action={`/posts/${post.id}/approve`}>{csrf}<button type="submit" disabled={!channel}>許可して {channel ? `#${channel.name}` : ''} に投稿</button></form>
        <form method="post" action={`/posts/${post.id}/reject`}>{csrf}<label>戻すときのひとこと（まとめ係に見えます）<input name="note" maxlength={300} /></label><button type="submit">戻す</button></form>
      </article>)}
    </section>
    <details class="card fold"><summary><h2>これまで（新しい順）</h2></summary>
      {!p.done.length ? <p class="note">まだありません。</p> : <div class="table-wrap"><table class="compact"><thead><tr><th>状態</th><th>題</th><th>書いた人</th><th>決めた人</th><th>日時</th></tr></thead><tbody>
        {p.done.map(post => <tr><td>{STATUS_LABEL[post.status]}</td><td>{post.title || post.body.slice(0, 30)}</td><td>{post.authorName || name(post.authorId)}</td><td>{name(post.decidedBy)}</td><td>{post.decidedAt ? fmtDateTime(post.decidedAt) : ''}</td></tr>)}
      </tbody></table></div>}
    </details>
    <section class="card"><h2>設定</h2>
      <form method="post" action="/posts/settings">{csrf}<fieldset class="fields" disabled={!guji}><legend>宮司だけ変更できます</legend>
        <label>まとめ係のロール<select name="roleId"><option value="">選んでいない（だれも書けない）</option>{p.roles.filter(r => !r.managed).map(r => <option value={r.id} selected={r.id === p.config.roleId}>{r.name}</option>)}</select></label>
        <label>許可したら投稿するチャンネル<select name="channelId"><option value="">選んでいない</option>{p.channels.filter(c => c.type === 0 || c.type === 5).map(c => <option value={c.id} selected={c.id === p.config.channelId}>#{c.name}</option>)}</select></label>
        <button type="submit">保存する</button></fieldset></form>
    </section>
  </Layout>;
}

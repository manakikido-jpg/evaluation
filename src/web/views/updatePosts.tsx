import type { AdminSession } from '../../db/schema.js';
import type { GuildChannel, GuildRole } from '../../lib/discordRest.js';
import { postableUpdateChannels, type UpdatePostConfig, type UpdatePostRow as UpdatePost } from '../../services/updatePosts.js';
import { mentionLabel } from '../../services/notices.js';
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
  const fallback = p.channels.find(c => c.id === p.config.channelId);
  const allowed = postableUpdateChannels(p.config, p.channels);
  // その投稿文が出る先（選んだ先が候補から外れていたら出せない）
  const targetOf = (post: UpdatePost) => post.targetChannelId ? allowed.find(c => c.id === post.targetChannelId) : fallback;
  const roleName = (id: string) => p.roles.find(r => r.id === id)?.name;
  const name = (id: string | null) => (id && p.names.get(id)) || id || '';
  const preview = (post: UpdatePost) => <DeviceFrame name={`device-${post.id}`}><UpdatePostPreview post={post} mention={mentionLabel(post.mention, roleName)} imageUrl={post.imageHash ? `/posts/${post.id}/image?v=${post.imageHash}` : undefined} /></DeviceFrame>;
  return <Layout title="投稿文の許可" nav="posts" session={p.session}>
    <h1>📝 投稿文の許可</h1>
    {p.flash && <p role="status">{FLASH[p.flash] ?? p.flash}</p>}
    <p>まとめ係のロールの人が、サーバーの更新のお知らせを書いて申請します。中身を見て「許可して投稿」を押すと、まとめ係が選んだチャンネルに投稿します（メンションは、まとめ係が選んだ相手にだけ届きます）。直してほしいときは、ひとことを付けて戻せます。まとめ係は Discord で <strong>/投稿文</strong> を打つと、専用のページに入れます。</p>
    <section class="card"><h2>⏳ 許可待ち（{p.pending.length}）</h2>
      {!p.pending.length && <p class="note">許可待ちの投稿文はありません。</p>}
      {p.pending.map(post => <article class="card">
        <p><strong>{post.title || '（題なし）'}</strong> ・ {post.authorName || name(post.authorId)} さん ・ 申請 {post.submittedAt ? fmtDateTime(post.submittedAt) : ''}</p>
        {preview(post)}
        {(() => { const ch = targetOf(post); return <form method="post" action={`/posts/${post.id}/approve`}>{csrf}{!ch && <p class="flash warn">投稿先が候補にありません（外されたか、選ばれていません）。戻して選びなおしてもらってください。</p>}<button type="submit" disabled={!ch}>許可して {ch ? `#${ch.name}` : ''} に投稿{post.mention ? `（${mentionLabel(post.mention, roleName)} に通知）` : ''}</button></form>; })()}
        <form method="post" action={`/posts/${post.id}/reject`}>{csrf}<label>戻すときのひとこと（まとめ係に見えます）<input name="note" maxlength={300} /></label><button type="submit">戻す</button></form>
      </article>)}
    </section>
    <details class="card fold"><summary><h2>これまで（新しい順）</h2></summary>
      {!p.done.length ? <p class="note">まだありません。</p> : <div class="table-wrap"><table class="compact"><thead><tr><th>状態</th><th>題</th><th>書いた人</th><th>決めた人</th><th>日時</th></tr></thead><tbody>
        {p.done.map(post => <tr><td>{STATUS_LABEL[post.status]}</td><td>{post.title || post.body.slice(0, 30)}</td><td>{post.authorName || name(post.authorId)}</td><td>{name(post.decidedBy)}</td><td>{post.decidedAt ? fmtDateTime(post.decidedAt) : ''}</td></tr>)}
      </tbody></table></div>}
    </details>
    <section class="card" id="post-channels"><h2>🗂 まとめ係が選べる投稿先</h2>
      <p class="note">まとめ係は、この中から投稿先を選びます。チャンネルの名前を変えても、そのまま使えます。</p>
      {!allowed.length ? <p class="note">まだありません。</p> : <ul class="plain-list">{allowed.map(ch => <li><span>#{ch.name}</span>{guji && <form method="post" action="/posts/channels" class="inline">{csrf}<input type="hidden" name="op" value="remove" /><input type="hidden" name="channelId" value={ch.id} /><button type="submit" class="danger-link">外す</button></form>}</li>)}</ul>}
      {guji && <form method="post" action="/posts/channels">{csrf}<input type="hidden" name="op" value="add" /><label>チャンネルを足す<select name="channelId" required><option value="">選んでください</option>{p.channels.filter(c => (c.type === 0 || c.type === 5) && !allowed.some(a => a.id === c.id)).map(c => <option value={c.id}>#{c.name}</option>)}</select></label><button type="submit">＋ 追加</button></form>}
    </section>
    <section class="card"><h2>設定</h2>
      <form method="post" action="/posts/settings">{csrf}<fieldset class="fields" disabled={!guji}><legend>宮司だけ変更できます</legend>
        <label>まとめ係のロール<select name="roleId"><option value="">選んでいない（だれも書けない）</option>{p.roles.filter(r => !r.managed).map(r => <option value={r.id} selected={r.id === p.config.roleId}>{r.name}</option>)}</select></label>
        <label>投稿先を選んでいない前の投稿文の行き先<select name="channelId"><option value="">選んでいない</option>{p.channels.filter(c => c.type === 0 || c.type === 5).map(c => <option value={c.id} selected={c.id === p.config.channelId}>#{c.name}</option>)}</select></label>
        <button type="submit">保存する</button></fieldset></form>
    </section>
  </Layout>;
}

import type { Child } from 'hono/jsx';
import type { Hono, Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Db } from '../db/client.js';
import type { GuildConfig } from '../config.js';
import type { MemberSession, UpdatePost } from '../db/schema.js';
import type { DiscordActions } from '../lib/discordRest.js';
import type { DiscordApi } from './discordApi.js';
import { createMemberSession, findMemberSession, deleteMemberSession } from './memberSessions.js';
import { safeEqual } from './sessions.js';
import { assetUrl } from './assets.js';
import { audit } from '../services/audit.js';
import { logger } from '../lib/logger.js';
import { peekLoginLink, useLoginLink } from '../services/casino/loginLinks.js';
import { BODY_MAX, TITLE_MAX, checkUpdateImage, deleteUpdateDraft, getUpdatePost, loadUpdatePostConfig, myUpdatePosts, parseUpdatePost, saveUpdateDraft, submitUpdatePost, updatePostText, withdrawUpdatePost, type UpdatePostRow } from '../services/updatePosts.js';
import { MD_HELP, MarkdownToolbar, Rendered } from './views/notices.js';
import { fmtDateTime } from './format.js';

const COOKIE = 'sakura_update_desk';
export const UPDATE_DESK_ROOT = '/update-desk';
const ROOT = UPDATE_DESK_ROOT;
const messages: Record<string, string> = {
  saved: '下書きを保存しました。',
  submitted: '申請しました。運営が許可すると投稿されます。',
  withdrawn: '申請を取り消して、下書きに戻しました。',
  deleted: '下書きを消しました。',
  invalid: `本文を入れてください（題は${TITLE_MAX}字まで・本文は${BODY_MAX}字まで）。`,
  image_too_big: '写真が大きすぎます（8MB まで）。',
  image_bad_type: 'PNG・JPEG・GIF・WebP の写真を選んでください。',
  locked: 'この投稿文は、いまは直せません（許可待ち・投稿ずみ）。',
  denied: 'まとめ係のロールの人だけが使えます。',
  failed: 'Discordに接続できませんでした。もう一度お試しください。',
  link: 'リンクの期限が切れたか、もう使われています。Discord で /投稿文 を打って、新しいリンクから入ってください。',
};
export const STATUS_LABEL: Record<UpdatePost['status'], string> = { draft: '📝 下書き', pending: '⏳ 許可待ち', posted: '✅ 投稿ずみ', rejected: '↩ 戻された' };

function Shell(p: { children: Child }) {
  return <html lang="ja"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="htmx-config" content='{"includeIndicatorStyles":false}' /><title>投稿文の下書き</title><link rel="stylesheet" href={assetUrl('style.css')} /><script src={assetUrl('htmx.min.js')} defer /><script src={assetUrl('editor.js')} defer /></head><body><main class="main update-desk">{p.children}</main></body></html>;
}

const Head = (p: { session: MemberSession }) => <div class="page-head"><div><p class="note">咲楽ノ宮 ／ まとめ係</p><h1>サーバーの更新の投稿文</h1></div><form action={`${ROOT}/logout`} method="post"><input type="hidden" name="_csrf" value={p.session.csrfToken} /><button>ログアウト</button></form></div>;

/** 💻 PC と 📱 スマホの幅を切りかえて見る（JS なし。選んだほうの幅で中身を囲む） */
export function DeviceFrame(p: { name: string; children: Child }) {
  return <div class="preview-device"><div class="preview-switch" role="radiogroup" aria-label="見る画面">
    <label class="check"><input type="radio" name={p.name} value="pc" checked /><span>💻 PC</span></label>
    <label class="check"><input type="radio" name={p.name} value="phone" /><span>📱 スマホ</span></label>
  </div><div class="preview-frame">{p.children}</div></div>;
}

/** Discord での見た目（掲示と同じ形） */
export function UpdatePostPreview(p: { post: Pick<UpdatePost, 'title' | 'body' | 'style' | 'imagePosition'>; imageUrl?: string; slot?: boolean }) {
  const text = updatePostText(p.post);
  return <><p class={text.length > BODY_MAX + TITLE_MAX + 4 ? 'flash warn' : 'note'}>{text.length} 文字</p><Rendered text={text} style={p.post.style} image={{ url: p.imageUrl, position: p.post.imagePosition }} slot={p.slot} /></>;
}

export function UpdateDeskPage(p: { session: MemberSession; posts: UpdatePostRow[]; message?: string }) {
  return <Shell><Head session={p.session} />
    {p.message && <p role="status" class="flash">{messages[p.message] || '入力を確認してください。'}</p>}
    <p>サーバーの更新をまとめて、投稿文を書きます。保存しただけでは投稿されません。「申請する」と運営に届き、運営が許可すると、お知らせのチャンネルに投稿されます。</p>
    <p><a class="button" href={`${ROOT}/new`}>＋ 新しく書く</a></p>
    <section class="card"><h2>これまでの投稿文</h2>{!p.posts.length && <p class="note">まだありません。</p>}
      {p.posts.length > 0 && <div class="table-wrap"><table class="compact"><thead><tr><th>状態</th><th>題</th><th>更新</th><th></th></tr></thead><tbody>
        {p.posts.map(post => <tr><td>{STATUS_LABEL[post.status]}</td><td>{post.title || post.body.slice(0, 30)}{post.imageHash ? ' 🖼' : ''}{post.status === 'rejected' && post.note ? <div class="note">運営から：{post.note}</div> : ''}</td><td>{fmtDateTime(post.updatedAt)}</td><td><a href={`${ROOT}/edit/${post.id}`}>{post.status === 'draft' || post.status === 'rejected' ? '直す' : '見る'}</a></td></tr>)}
      </tbody></table></div>}
    </section></Shell>;
}

export function UpdateDeskEdit(p: { session: MemberSession; post?: UpdatePostRow; message?: string }) {
  const post = p.post;
  const editable = !post || post.status === 'draft' || post.status === 'rejected';
  const action = post ? `${ROOT}/posts/${post.id}` : `${ROOT}/posts`;
  const imageUrl = post?.imageHash ? `${ROOT}/posts/${post.id}/image?v=${post.imageHash}` : undefined;
  const hx = { 'hx-post': `${ROOT}/preview`, 'hx-trigger': 'change', 'hx-target': '#post-preview', 'hx-include': '#post-form' };
  const view = { title: post?.title ?? '', body: post?.body ?? '', style: post?.style ?? 'embed', imagePosition: post?.imagePosition ?? 'bottom' } as const;
  return <Shell><Head session={p.session} /><p class="crumbs"><a href={ROOT}>← 投稿文の一覧</a></p>
    {p.message && <p role="status" class="flash">{messages[p.message] || '入力を確認してください。'}</p>}
    {post?.status === 'rejected' && post.note && <p class="flash warn">運営から：{post.note}</p>}
    {!editable ? <section class="card"><h2>{STATUS_LABEL[post!.status]}</h2><DeviceFrame name="device"><UpdatePostPreview post={view} imageUrl={imageUrl} /></DeviceFrame>
      {post!.status === 'pending' && <form action={`${ROOT}/posts/${post!.id}/withdraw`} method="post"><input type="hidden" name="_csrf" value={p.session.csrfToken} /><button>申請を取り消して直す</button></form>}</section>
    : <div class="notice-edit">
      {/* プレビューのたびに写真を送らないよう、htmx には写真を入れない */}
      <form method="post" action={action} class="notice-form" id="post-form" enctype="multipart/form-data" hx-params="not image">
        <input type="hidden" name="_csrf" value={p.session.csrfToken} />
        {post && <input type="hidden" name="postId" value={String(post.id)} />}
        <section class="card"><h2>どう出す</h2><div class="fields">
          <label class="field"><span>見せ方</span><select name="style" {...hx}><option value="embed" selected={view.style === 'embed'}>カード（左に色の線）</option><option value="text" selected={view.style === 'text'}>普通のメッセージ</option></select></label>
          <label class="field"><span>題（なくてもよい・{TITLE_MAX}字まで。太字で 1 行目に出ます）</span><input name="title" maxlength={TITLE_MAX} value={view.title} hx-post={`${ROOT}/preview`} hx-trigger="input changed delay:500ms" hx-target="#post-preview" hx-include="#post-form" /></label>
        </div></section>
        <section class="card"><h2>本文</h2>
          <label class="field" for="post-body"><span class="note">Discord の書き方で飾れます。下のボタンか、Ctrl+B 太字・Ctrl+I 斜体・Ctrl+U 下線</span></label>
          <MarkdownToolbar target="post-body" />
          <textarea id="post-body" name="body" rows={18} maxlength={BODY_MAX} required data-md-editor hx-post={`${ROOT}/preview`} hx-trigger="input changed delay:500ms" hx-target="#post-preview" hx-include="#post-form">{view.body}</textarea>
          <details class="md-help"><summary>書き方の一覧</summary><table class="compact"><tbody>{MD_HELP.filter(([src]) => !src.startsWith('{')).map(([src, note]) => <tr><td><code>{src}</code></td><td class="wrap note">{note}</td></tr>)}</tbody></table></details>
        </section>
        <section class="card"><h2>🖼 写真</h2><fieldset class="field image-pick" {...hx}>
          {imageUrl && <div class="image-current"><img src={imageUrl} alt="今の写真" /><label class="check"><input type="checkbox" name="removeImage" value="yes" /><span>写真を外す</span></label></div>}
          <label class="field"><span>{imageUrl ? '別の写真に替える' : '写真を選ぶ'}（PNG・JPEG・GIF・WebP、8MB まで）</span><input type="file" name="image" accept="image/png,image/jpeg,image/gif,image/webp" data-image-input /></label>
          <div class="inline-actions">{([['top', '⬆ 本文の上'], ['bottom', '⬇ 本文の下']] as const).map(([v, label]) => <label class="check"><input type="radio" name="imagePosition" value={v} checked={view.imagePosition === v} /><span>{label}</span></label>)}</div>
          <p class="note">普通のメッセージは Discord の決まりで、写真はいつも本文の下になります。</p>
        </fieldset></section>
        <div class="save-bar"><button type="submit" name="next" value="save">下書きを保存</button><button type="submit" name="next" value="submit">保存して申請する</button></div>
      </form>
      <aside class="notice-side card"><h2>Discord での見た目</h2><DeviceFrame name="device"><div id="post-preview"><UpdatePostPreview post={view} imageUrl={imageUrl} slot /></div></DeviceFrame></aside>
      {post && <form action={`${ROOT}/posts/${post.id}/delete`} method="post" data-confirm="この下書きを消しますか？"><input type="hidden" name="_csrf" value={p.session.csrfToken} /><button class="danger">この下書きを消す</button></form>}
    </div>}
  </Shell>;
}

/** まとめ係（決めたロールの人）専用。運営のセッションは出さず、操作は必ずログインした本人の投稿文だけ */
export function mountUpdateDesk(app: Hono<any>, d: { db: Db; api: DiscordApi; discord: DiscordActions; cfg: () => GuildConfig; baseUrl: string; secure: boolean; now: () => Date }) {
  const { db, api } = d;
  const isWriter = async (userId: string) => {
    const conf = await loadUpdatePostConfig(db);
    const roles = await api.memberRoles(d.cfg().guildId, userId);
    return !!(conf.roleId && roles?.includes(conf.roleId));
  };
  const info = (msg: string) => <Shell><p class="note">咲楽ノ宮</p><h1>投稿文の下書き</h1><p role="alert" class="flash warn">{messages[msg] ?? messages.denied}</p><p>Discord で <strong>/投稿文</strong> を打つと、入るためのリンクが出ます（10 分だけ使えます）。</p></Shell>;
  app.get(`${ROOT}/login`, c => c.html(info(c.req.query('e') ?? 'link')));
  app.get(`${ROOT}/link/:token`, async (c) => {
    const user = await peekLoginLink(db, c.req.param('token') ?? '', d.now());
    if (!user) return c.redirect(`${ROOT}/login?e=link`);
    return c.html(<Shell><p class="note">咲楽ノ宮</p><h1>投稿文の下書き</h1><p>{user.displayName} さんとして入ります。</p><form action={`${ROOT}/link/${c.req.param('token')}`} method="post"><button>入る</button></form></Shell>);
  });
  app.post(`${ROOT}/link/:token`, async (c) => {
    // ほかのサイトから送らせて、別の人として入らせることはさせない
    const origin = c.req.header('origin');
    if (origin && origin !== new URL(d.baseUrl).origin) return c.text('不正なリクエストです。', 403);
    const user = await useLoginLink(db, c.req.param('token') ?? '', d.now());
    if (!user) return c.redirect(`${ROOT}/login?e=link`);
    try { if (!await isWriter(user.id)) return c.redirect(`${ROOT}/login?e=denied`); }
    catch (err) { logger.warn({ err }, 'update desk login failed'); return c.redirect(`${ROOT}/login?e=failed`); }
    const token = await createMemberSession(db, { id: user.id, username: user.displayName, displayName: user.displayName, avatarUrl: user.avatarUrl }, d.now());
    setCookie(c, COOKIE, token, { httpOnly: true, secure: d.secure, sameSite: 'Lax', path: ROOT, maxAge: 7 * 86400 });
    await audit(db, { actorId: user.id, action: 'update_post.login', via: 'web' });
    return c.redirect(ROOT);
  });
  const page = (fn: (c: Context, session: MemberSession, body: Record<string, unknown>) => Promise<Response>) => async (c: Context) => {
    const token = getCookie(c, COOKIE);
    const session = token ? await findMemberSession(db, token, d.now()) : undefined;
    if (!session) return c.redirect(`${ROOT}/login`);
    let ok;
    try { ok = await isWriter(session.userId); }
    catch { return c.text('Discordに接続できません。時間をおいて再試行してください。', 503); }
    // ロールを外された人は、すぐ入れなくする
    if (!ok) { await deleteMemberSession(db, session.id); deleteCookie(c, COOKIE, { path: ROOT }); return c.redirect(`${ROOT}/login?e=denied`); }
    const body = c.req.method === 'POST' ? await c.req.parseBody() : {};
    if (c.req.method === 'POST' && !safeEqual(typeof body._csrf === 'string' ? body._csrf : '', session.csrfToken)) return c.text('不正なリクエストです（CSRF）。', 403);
    return fn(c, session, body);
  };
  const idOf = (c: Context) => { const n = Number(c.req.param('id')); return Number.isSafeInteger(n) && n > 0 ? n : undefined; };
  // 申請したら、運営のログに知らせる
  const notify = async (post: UpdatePost) => {
    const log = d.cfg().channels.log;
    if (!log) return;
    await d.discord.sendMessage(log, { content: `📝 **投稿文の申請がきました**（${post.authorName || post.authorId} さん）\n「${post.title || post.body.slice(0, 30)}」\n${d.baseUrl}/posts で中身を見て、許可・戻すを選んでください。`, allowed_mentions: { parse: [] } }).catch((err: unknown) => logger.warn({ err }, 'update post notify failed'));
  };
  const save = async (c: Context, s: MemberSession, b: Record<string, unknown>, id?: number) => {
    const back = id ? `${ROOT}/edit/${id}` : `${ROOT}/new`;
    const input = parseUpdatePost(b);
    if (!input) return c.redirect(`${back}?msg=invalid`);
    const f = Array.isArray(b.image) ? b.image[0] : b.image;
    let image: Parameters<typeof saveUpdateDraft>[5];
    if (f instanceof File && f.size > 0) {
      const checked = checkUpdateImage(new Uint8Array(await f.arrayBuffer()));
      if (typeof checked === 'string') return c.redirect(`${back}?msg=image_${checked}`);
      image = checked;
    } else if (b.removeImage === 'yes') image = 'remove';
    const row = await saveUpdateDraft(db, { id: s.userId, name: s.displayName }, input, id, d.now(), image);
    if (!row) return c.redirect(`${ROOT}?msg=locked`);
    if (b.next !== 'submit') return c.redirect(`${ROOT}/edit/${row.id}?msg=saved`);
    const sent = await submitUpdatePost(db, s.userId, row.id, d.now());
    if (sent) await notify(sent);
    return c.redirect(`${ROOT}?msg=${sent ? 'submitted' : 'locked'}`);
  };
  const mine = async (s: MemberSession, id?: number) => { const post = id ? await getUpdatePost(db, id) : undefined; return post && post.authorId === s.userId ? post : undefined; };
  app.get(`${ROOT}/new`, page(async (c, s) => c.html(<UpdateDeskEdit session={s} message={c.req.query('msg')} />)));
  app.get(`${ROOT}/edit/:id`, page(async (c, s) => {
    const post = await mine(s, idOf(c));
    if (!post) return c.redirect(ROOT);
    const { imageData: _d, ...row } = post;
    return c.html(<UpdateDeskEdit session={s} post={row} message={c.req.query('msg')} />);
  }));
  app.get(`${ROOT}/posts/:id/image`, page(async (c, s) => {
    const post = await mine(s, idOf(c));
    if (!post?.imageData || !post.imageType) return c.notFound();
    return c.body(new Uint8Array(post.imageData), 200, { 'content-type': post.imageType, 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=3600' });
  }));
  // 書いている途中の見た目（写真はブラウザが入れる）
  app.post(`${ROOT}/preview`, page(async (c, s, b) => {
    const id = Number(b.postId);
    const post = Number.isSafeInteger(id) && id > 0 ? await mine(s, id) : undefined;
    const view = { title: String(b.title ?? '').trim(), body: String(b.body ?? '').replace(/\r\n/g, '\n'), style: b.style === 'text' ? 'text' as const : 'embed' as const, imagePosition: b.imagePosition === 'top' ? 'top' as const : 'bottom' as const };
    const imageUrl = post?.imageHash && b.removeImage !== 'yes' ? `${ROOT}/posts/${post.id}/image?v=${post.imageHash}` : undefined;
    return c.html(<UpdatePostPreview post={view} imageUrl={imageUrl} slot />);
  }));
  app.get(ROOT, page(async (c, s) => c.html(<UpdateDeskPage session={s} posts={await myUpdatePosts(db, s.userId)} message={c.req.query('msg')} />)));
  app.post(`${ROOT}/posts`, page(async (c, s, b) => save(c, s, b)));
  app.post(`${ROOT}/posts/:id`, page(async (c, s, b) => { const id = idOf(c); return id ? save(c, s, b, id) : c.redirect(`${ROOT}?msg=invalid`); }));
  app.post(`${ROOT}/posts/:id/withdraw`, page(async (c, s) => { const id = idOf(c); const row = id ? await withdrawUpdatePost(db, s.userId, id, d.now()) : undefined; return c.redirect(`${ROOT}?msg=${row ? 'withdrawn' : 'locked'}`); }));
  app.post(`${ROOT}/posts/:id/delete`, page(async (c, s) => {
    const id = idOf(c);
    const post = id ? await getUpdatePost(db, id) : undefined;
    const ok = !!post && await deleteUpdateDraft(db, s.userId, post.id);
    if (ok) await audit(db, { actorId: s.userId, action: 'update_post.delete', detail: { id }, via: 'web' });
    return c.redirect(`${ROOT}?msg=${ok ? 'deleted' : 'locked'}`);
  }));
  app.post(`${ROOT}/logout`, page(async (c, s) => { await deleteMemberSession(db, s.id); deleteCookie(c, COOKIE, { path: ROOT }); return c.redirect(`${ROOT}/login?e=link`); }));
}

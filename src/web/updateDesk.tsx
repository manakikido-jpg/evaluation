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
import { BODY_MAX, TITLE_MAX, deleteUpdateDraft, getUpdatePost, loadUpdatePostConfig, myUpdatePosts, parseUpdatePost, saveUpdateDraft, submitUpdatePost, withdrawUpdatePost } from '../services/updatePosts.js';

const COOKIE = 'sakura_update_desk';
export const UPDATE_DESK_ROOT = '/update-desk';
const ROOT = UPDATE_DESK_ROOT;
const messages: Record<string, string> = {
  saved: '下書きを保存しました。',
  submitted: '申請しました。運営が許可すると投稿されます。',
  withdrawn: '申請を取り消して、下書きに戻しました。',
  deleted: '下書きを消しました。',
  invalid: `本文を入れてください（題は${TITLE_MAX}字まで・本文は${BODY_MAX}字まで）。`,
  locked: 'この投稿文は、いまは直せません（許可待ち・投稿ずみ）。',
  denied: 'まとめ係のロールの人だけが使えます。',
  failed: 'Discordに接続できませんでした。もう一度お試しください。',
  link: 'リンクの期限が切れたか、もう使われています。Discord で /投稿文 を打って、新しいリンクから入ってください。',
};
export const STATUS_LABEL: Record<UpdatePost['status'], string> = { draft: '📝 下書き', pending: '⏳ 許可待ち', posted: '✅ 投稿ずみ', rejected: '↩ 戻された' };

function Shell(p: { children: Child }) {
  return <html lang="ja"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>投稿文の下書き</title><link rel="stylesheet" href={assetUrl('cast-office.css')} /><script src={assetUrl('cast-office.js')} defer /></head><body><main class="cast-office">{p.children}</main></body></html>;
}

export function UpdateDeskPage(p: { session: MemberSession; posts: UpdatePost[]; message?: string }) {
  const csrf = <input type="hidden" name="_csrf" value={p.session.csrfToken} />;
  const fields = (post?: UpdatePost) => <div class="fields"><label>題（なくてもよい・{TITLE_MAX}字まで）<input name="title" maxlength={TITLE_MAX} value={post?.title ?? ''} /></label><label>本文（{BODY_MAX}字まで）<textarea name="body" maxlength={BODY_MAX} rows={12} required>{post?.body ?? ''}</textarea></label></div>;
  return <Shell><header><div><p class="eyebrow">咲楽ノ宮 ／ まとめ係</p><h1>サーバーの更新の投稿文</h1></div><form action={`${ROOT}/logout`} method="post">{csrf}<button>ログアウト</button></form></header>
    {p.message && <p role="status" class="notice">{messages[p.message] || '入力を確認してください。'}</p>}
    <p>サーバーの更新をまとめて、投稿文を書きます。保存しただけでは投稿されません。「申請する」と運営に届き、運営が許可すると、お知らせのチャンネルに投稿されます。</p>
    <section id="new"><h2>新しく書く</h2><form action={`${ROOT}/posts`} method="post">{csrf}{fields()}<button class="primary" name="next" value="save">下書きを保存</button><button class="primary" name="next" value="submit">保存して申請する</button></form></section>
    <section id="list"><h2>これまでの投稿文</h2>{!p.posts.length && <p>まだありません。</p>}
      {p.posts.map(post => { const editable = post.status === 'draft' || post.status === 'rejected'; return <details class="menu-row" open={post.status === 'rejected'}><summary><strong>{post.title || post.body.slice(0, 20)}</strong><span>{STATUS_LABEL[post.status]}</span><span>{editable ? '直す' : '見る'}</span></summary>
        {post.status === 'rejected' && post.note && <p class="notice">運営から：{post.note}</p>}
        {editable ? <><form action={`${ROOT}/posts/${post.id}`} method="post">{csrf}{fields(post)}<button class="primary" name="next" value="save">下書きを保存</button><button class="primary" name="next" value="submit">保存して申請する</button></form>
          <form action={`${ROOT}/posts/${post.id}/delete`} method="post" data-confirm="この下書きを消しますか？">{csrf}<button class="danger">この下書きを消す</button></form></>
          : <><pre class="post-preview">{post.title ? `${post.title}\n\n` : ''}{post.body}</pre>{post.status === 'pending' && <form action={`${ROOT}/posts/${post.id}/withdraw`} method="post">{csrf}<button>申請を取り消して直す</button></form>}</>}
      </details>; })}
    </section><footer><span>運営への連絡はDiscordからお願いします。</span></footer></Shell>;
}

/** まとめ係（決めたロールの人）専用。運営のセッションは出さず、操作は必ずログインした本人の投稿文だけ */
export function mountUpdateDesk(app: Hono<any>, d: { db: Db; api: DiscordApi; discord: DiscordActions; cfg: () => GuildConfig; baseUrl: string; secure: boolean; now: () => Date }) {
  const { db, api } = d;
  const isWriter = async (userId: string) => {
    const conf = await loadUpdatePostConfig(db);
    const roles = await api.memberRoles(d.cfg().guildId, userId);
    return !!(conf.roleId && roles?.includes(conf.roleId));
  };
  const info = (msg: string) => <Shell><p class="eyebrow">咲楽ノ宮</p><h1>投稿文の下書き</h1><p role="alert" class="notice">{messages[msg] ?? messages.denied}</p><p>Discord で <strong>/投稿文</strong> を打つと、入るためのリンクが出ます（10 分だけ使えます）。</p></Shell>;
  app.get(`${ROOT}/login`, c => c.html(info(c.req.query('e') ?? 'link')));
  app.get(`${ROOT}/link/:token`, async (c) => {
    const user = await peekLoginLink(db, c.req.param('token') ?? '', d.now());
    if (!user) return c.redirect(`${ROOT}/login?e=link`);
    return c.html(<Shell><p class="eyebrow">咲楽ノ宮</p><h1>投稿文の下書き</h1><p>{user.displayName} さんとして入ります。</p><form action={`${ROOT}/link/${c.req.param('token')}`} method="post"><button class="primary">入る</button></form></Shell>);
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
    const input = parseUpdatePost(b);
    if (!input) return c.redirect(`${ROOT}?msg=invalid`);
    const row = await saveUpdateDraft(db, { id: s.userId, name: s.displayName }, input, id, d.now());
    if (!row) return c.redirect(`${ROOT}?msg=locked`);
    if (b.next !== 'submit') return c.redirect(`${ROOT}?msg=saved`);
    const sent = await submitUpdatePost(db, s.userId, row.id, d.now());
    if (sent) await notify(sent);
    return c.redirect(`${ROOT}?msg=${sent ? 'submitted' : 'locked'}`);
  };
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

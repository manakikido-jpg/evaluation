import type { Child } from 'hono/jsx';
import type { Hono, Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Db } from '../db/client.js';
import type { GuildConfig } from '../config.js';
import type { MemberSession } from '../db/schema.js';
import type { DiscordActions } from '../lib/discordRest.js';
import type { DiscordApi } from './discordApi.js';
import { createMemberSession, findMemberSession, deleteMemberSession } from './memberSessions.js';
import { peekLoginLink, useLoginLink } from '../services/casino/loginLinks.js';
import { safeEqual } from './sessions.js';
import { assetUrl } from './assets.js';
import { Layout } from './views/layout.js';
import { audit } from '../services/audit.js';
import { logger } from '../lib/logger.js';
import { getSticker, listStickers, loadStickerConfig, moveSticker, prepareSticker, reconcileSticker, registerSticker, rejectSticker, saveSticker, saveStickerConfig, STICKER_UPLOAD_MAX, stickerCreatorRole, stickerInputSchema, submitSticker } from '../services/stickers.js';
const ROOT = '/sticker-desk', COOKIE = 'sakura_sticker_desk';
const labels = { draft: '下書き', pending: '運営の確認待ち', rejected: '修正をお願いします', registering: '登録中・結果確認が必要', uncertain: '登録結果を確認してください', registered: '登録済み' };
const msg: Record<string, string> = { saved: '保存しました。', submitted: '運営へ申請しました。', registered: 'Discordへ登録しました。', rejected: '製作者へ戻しました。', gone: 'すでに処理されたか、今は変更できません。', failed: '登録できませんでした。空き枠・BOTの権限を確認してください。', uncertain: '結果を確認できません。Discord側を確認し、登録結果を照合してください。自動では再送しません。', invalid: '入力・画像・操作対象を確認してください。', moved: 'Web一覧の順番を変更しました。', reconciled: '登録結果を照合しました。' };
function Shell(p: { children: Child }) { return <html lang="ja"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>スタンプ製作所</title><link rel="stylesheet" href={assetUrl('style.css')}/></head><body><main class="main"><h1>🌸 スタンプ製作所</h1>{p.children}</main></body></html>; }
const Flash = (p: { value?: string }) => p.value ? <p role="status" class="flash">{msg[p.value] ?? '操作を確認してください。'}</p> : null;
const Csrf = (p: { token: string }) => <input type="hidden" name="_csrf" value={p.token}/>;
const Intro = () => <p>画像を保存して申請すると、運営が確認してDiscordに登録します。静止画のPNG・JPEG・WebP（8MBまで）を、透過と縦横比を保って320×320のPNGに整えます。アニメーションは今回対象外です。</p>;
function Editor(p: { session: MemberSession; row?: Awaited<ReturnType<typeof getSticker>>; values?: Record<string, unknown>; error?: string }) {
  const row = p.row, values = p.values ?? row ?? {};
  return <Shell><a href={ROOT}>← 一覧</a><Intro/>{p.error && <p role="alert">{p.error}</p>}{row && <img src={`${ROOT}/drafts/${row.id}/image`} width="160" height="160" alt={row.name}/>}<form action={`${ROOT}/drafts${row ? '/' + row.id : ''}`} method="post" enctype="multipart/form-data"><Csrf token={p.session.csrfToken}/><label>スタンプ名（2〜30文字）<input name="name" minlength={2} maxlength={30} value={String(values.name ?? '')} required/></label><label>説明（空、または2〜100文字）<textarea name="description" maxlength={100}>{String(values.description ?? '')}</textarea></label><label>関連する絵文字・検索語<input name="tags" maxlength={200} value={String(values.tags ?? '😊')} required/></label><label>画像<input type="file" name="image" accept="image/png,image/jpeg,image/webp" required={!row}/></label><p class="note">保存後の見本を確認してから申請してください。画像を変更しない場合は選び直す必要はありません。</p><button class="primary">下書きを保存</button></form></Shell>;
}
type Deps = { db: Db; api: DiscordApi; discord: DiscordActions; cfg: () => GuildConfig; baseUrl: string; secure: boolean; now: () => Date };
export function mountStickerDesk(app: Hono<any>, d: Deps) {
  const { db } = d;
  const allowed = async (user: string) => {
    const role = await stickerCreatorRole(db, await d.discord.guildRoles(d.cfg().guildId));
    const roles = await d.api.memberRoles(d.cfg().guildId, user);
    return !!role && !!roles?.includes(role);
  };
  const info = (text: string) => <Shell><p role="alert">{text}</p><p>Discordの /スタンプ製作 から、自分専用のリンクを開いてください。</p></Shell>;
  app.get(`${ROOT}/login`, c => c.html(info('スタンプ製作者ロールの人だけが利用できます。リンクは10分・1回だけ使えます。')));
  app.get(`${ROOT}/link/:token`, async c => {
    const user = await peekLoginLink(db, c.req.param('token'), d.now());
    if (!user) return c.redirect(`${ROOT}/login`);
    return c.html(<Shell><p>{user.displayName} さんとして入ります。</p><form action={`${ROOT}/link/${c.req.param('token')}`} method="post"><button>入る</button></form></Shell>);
  });
  app.post(`${ROOT}/link/:token`, async c => {
    if (c.req.header('origin') && c.req.header('origin') !== new URL(d.baseUrl).origin) return c.text('不正なリクエストです。', 403);
    const user = await useLoginLink(db, c.req.param('token'), d.now());
    if (!user) return c.redirect(`${ROOT}/login`);
    try { if (!await allowed(user.id)) return c.redirect(`${ROOT}/login`); }
    catch { return c.text('Discordに接続できません。時間をおいてお試しください。', 503); }
    const token = await createMemberSession(db, { id: user.id, username: user.displayName, displayName: user.displayName, avatarUrl: user.avatarUrl }, d.now());
    setCookie(c, COOKIE, token, { httpOnly: true, secure: d.secure, sameSite: 'Lax', path: ROOT, maxAge: 7 * 86400 });
    return c.redirect(ROOT);
  });
  const page = (fn: (c: Context, s: MemberSession, b: Record<string, unknown>) => Promise<Response>) => async (c: Context) => {
    const token = getCookie(c, COOKIE), s = token ? await findMemberSession(db, token, d.now()) : undefined;
    if (!s) return c.redirect(`${ROOT}/login`);
    try {
      if (!await allowed(s.userId)) { await deleteMemberSession(db, s.id); deleteCookie(c, COOKIE, { path: ROOT }); return c.redirect(`${ROOT}/login`); }
    } catch { return c.text('権限を確認できません。時間をおいてお試しください。', 503); }
    const b = c.req.method === 'POST' ? await c.req.parseBody() : {};
    if (c.req.method === 'POST' && !safeEqual(typeof b._csrf === 'string' ? b._csrf : '', s.csrfToken)) return c.text('不正なリクエストです（CSRF）。', 403);
    return fn(c, s, b);
  };
  app.get(ROOT, page(async (c, s) => {
    const rows = await listStickers(db, s.userId);
    return c.html(<Shell><Intro/><Flash value={c.req.query('msg')}/><a class="button" href={`${ROOT}/new`}>＋ スタンプを作る</a>{rows.map(row => <section class="card"><img src={`${ROOT}/drafts/${row.id}/image`} width="160" height="160" alt={row.name}/><h2>{row.name}</h2><p>{labels[row.status]}{row.stickerId && ` ／ ID: ${row.stickerId}`}</p>{row.note && <p role="alert">{row.note}</p>}{['draft', 'rejected'].includes(row.status) && <><a href={`${ROOT}/edit/${row.id}`}>編集する</a><form action={`${ROOT}/drafts/${row.id}/submit`} method="post"><Csrf token={s.csrfToken}/><button>この見本で申請する</button></form></>}</section>)}<form action={`${ROOT}/logout`} method="post"><Csrf token={s.csrfToken}/><button>ログアウト</button></form></Shell>);
  }));
  app.get(`${ROOT}/new`, page(async (c, s) => c.html(<Editor session={s}/>)));
  app.get(`${ROOT}/edit/:id`, page(async (c, s) => {
    const row = await getSticker(db, Number(c.req.param('id')));
    return row?.authorId === s.userId && ['draft', 'rejected'].includes(row.status) ? c.html(<Editor session={s} row={row}/>) : c.notFound();
  }));
  app.get(`${ROOT}/drafts/:id/image`, page(async (c, s) => {
    const row = await getSticker(db, Number(c.req.param('id')));
    return row?.authorId === s.userId ? c.body(new Uint8Array(row.imageData), 200, { 'content-type': 'image/png', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' }) : c.notFound();
  }));
  const save = page(async (c, s, b) => {
    const id = c.req.param('id') ? Number(c.req.param('id')) : undefined;
    const row = id === undefined ? undefined : await getSticker(db, id);
    if (id !== undefined && (!row || row.authorId !== s.userId || !['draft', 'rejected'].includes(row.status))) return c.notFound();
    const input = stickerInputSchema.safeParse(b);
    let image;
    try {
      if (!input.success) throw Error('名前・説明・絵文字を確認してください。');
      const file = b.image;
      if (file instanceof File && file.size) {
        if (file.size > STICKER_UPLOAD_MAX) throw Error('画像は8MBまでです。');
        image = await prepareSticker(new Uint8Array(await file.arrayBuffer()));
      } else if (!row) throw Error('画像を選んでください。');
    } catch {
      return c.html(<Editor session={s} row={row} values={b} error="入力を確認してください。静止画のPNG・JPEG・WebP（8MB・約1600万画素まで）を選んでください。名前は2〜30文字、説明は空か2〜100文字です。"/>, 400);
    }
    const saved = await saveSticker(db, { id: s.userId, name: s.displayName }, input.data!, image, id);
    if (saved) await audit(db, { actorId: s.userId, action: 'sticker.save', detail: { id: saved.id }, via: 'web' });
    return c.redirect(`${ROOT}?msg=${saved ? 'saved' : 'gone'}`);
  });
  app.post(`${ROOT}/drafts`, save); app.post(`${ROOT}/drafts/:id`, save);
  app.post(`${ROOT}/drafts/:id/submit`, page(async (c, s) => {
    const row = await submitSticker(db, Number(c.req.param('id')), s.userId);
    if (row) {
      await audit(db, { actorId: s.userId, action: 'sticker.submit', detail: { id: row.id }, via: 'web' });
      if (d.cfg().channels.log) await d.discord.sendMessage(d.cfg().channels.log!, { content: `🌸 スタンプの申請が届きました。\n${d.baseUrl}/stickers`, allowed_mentions: { parse: [] } }).catch(err => logger.warn({ err }, 'sticker notify failed'));
    }
    return c.redirect(`${ROOT}?msg=${row ? 'submitted' : 'gone'}`);
  }));
  app.post(`${ROOT}/logout`, page(async (c, s) => { await deleteMemberSession(db, s.id); deleteCookie(c, COOKIE, { path: ROOT }); return c.redirect(`${ROOT}/login`); }));
}

/** 呼び出し側の管理者認証・ページ権限・CSRFを通した社務所ルート。 */
export function mountStickerAdmin(app: Hono<any>, d: Deps) {
  const { db } = d;
  app.get('/stickers', async c => {
    const session = c.get('session'), rows = await listStickers(db), roles = await d.discord.guildRoles(d.cfg().guildId);
    const selected = await stickerCreatorRole(db, roles);
    return c.html(<Layout title="スタンプ" nav="stickers" session={session}><h1>🌸 スタンプの登録</h1><Flash value={c.req.query('msg')}/><p>製作者の見本を確認して登録します。BOTに「サーバー表現の作成」と空き枠が必要です。並び替えはWeb一覧だけに反映します。</p>{session.level === 'guji' && <form action="/stickers/settings" method="post"><Csrf token={session.csrfToken}/><label>製作者ロール<select name="roleId"><option value="">名前が「スタンプ製作者」のロールを自動で探す</option>{roles.filter(r => !r.managed && r.id !== d.cfg().guildId).map(r => <option value={r.id} selected={r.id === selected}>{r.name}</option>)}</select></label><button>設定を保存</button></form>}{!selected && <p role="alert">製作者ロールが未設定、または同名ロールが複数あります。宮司が選んでください。</p>}{rows.map(row => <section class="card"><h2>{row.name}</h2><img src={`/stickers/${row.id}/image`} width="160" height="160" alt={row.name}/><p>{row.description}</p><p>製作者：{row.authorName} ／ 絵文字・検索語：{row.tags}</p><p>{labels[row.status]}{row.stickerId && ` ／ ID: ${row.stickerId}`}</p>{row.note && <p role="alert">{row.note}</p>}<form action={`/stickers/${row.id}/move`} method="post"><Csrf token={session.csrfToken}/><button name="direction" value="up" aria-label={`${row.name}を上へ`}>↑ 上へ</button><button name="direction" value="down" aria-label={`${row.name}を下へ`}>↓ 下へ</button></form>{row.status === 'pending' && <><form action={`/stickers/${row.id}/register`} method="post"><Csrf token={session.csrfToken}/><input type="hidden" name="revision" value={row.updatedAt.toISOString()}/><label><input type="checkbox" name="confirm" value="yes" required/>画像と名前を確認しました</label><button class="primary">許可してDiscordへ登録</button></form><form action={`/stickers/${row.id}/reject`} method="post"><Csrf token={session.csrfToken}/><label>修正してほしい点<textarea name="note" maxlength={300}/></label><button>製作者へ戻す</button></form></>}{['registering', 'uncertain'].includes(row.status) && <details><summary>Discord側の登録結果を照合する（2分以上たってから）</summary><p>Discordのスタンプ一覧で確認し、作成済みならIDを入力してください。同名のスタンプがある間は再送できません。</p><form action={`/stickers/${row.id}/reconcile`} method="post"><Csrf token={session.csrfToken}/><label>Discordに作成済みのスタンプID<input name="stickerId" pattern="[0-9]{17,20}"/></label><label><input type="checkbox" name="absent" value="yes"/>Discordに登録されていないことを確認しました（IDが空なら許可待ちへ戻す）</label><button>照合する</button></form></details>}</section>)}</Layout>);
  });
  app.get('/stickers/:id/image', async c => {
    const row = await getSticker(db, Number(c.req.param('id')));
    return row ? c.body(new Uint8Array(row.imageData), 200, { 'content-type': 'image/png', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' }) : c.notFound();
  });
  app.post('/stickers/settings', async c => {
    if (c.get('session').level !== 'guji') return c.text('宮司だけが設定できます。', 403);
    const b = await c.req.parseBody(), roles = await d.discord.guildRoles(d.cfg().guildId), roleId = typeof b.roleId === 'string' && b.roleId ? b.roleId : undefined;
    if (roleId && !roles.some(r => r.id === roleId && !r.managed && r.id !== d.cfg().guildId)) return c.redirect('/stickers?msg=invalid');
    await saveStickerConfig(db, { roleId }, c.get('session').userId);
    return c.redirect('/stickers?msg=saved');
  });
  app.post('/stickers/:id/:action', async c => {
    const id = Number(c.req.param('id')), action = c.req.param('action'), by = c.get('session').userId, b = await c.req.parseBody();
    if (!Number.isSafeInteger(id) || id <= 0) return c.redirect('/stickers?msg=invalid');
    try {
      if (action === 'register' && b.confirm === 'yes' && typeof b.revision === 'string' && Number.isFinite(Date.parse(b.revision)) && d.discord.createGuildSticker) {
        const result = await registerSticker(db, id, by, r => d.discord.createGuildSticker!(d.cfg().guildId, { name: r.name, description: r.description, tags: r.tags, data: r.imageData }, `スタンプ申請 #${r.id} を許可（${by}）`), new Date(b.revision));
        return c.redirect(`/stickers?msg=${result}`);
      }
      if (action === 'reject') return c.redirect(`/stickers?msg=${await rejectSticker(db, id, by, typeof b.note === 'string' ? b.note : '') ? 'rejected' : 'gone'}`);
      if (action === 'move' && (b.direction === 'up' || b.direction === 'down')) { await moveSticker(db, id, b.direction, by); return c.redirect('/stickers?msg=moved'); }
      if (action === 'reconcile' && d.discord.guildStickers) {
        const ok = await reconcileSticker(db, id, by, typeof b.stickerId === 'string' ? b.stickerId.trim() : '', () => d.discord.guildStickers!(d.cfg().guildId), b.absent === 'yes');
        return c.redirect(`/stickers?msg=${ok ? 'reconciled' : 'invalid'}`);
      }
    } catch (err) { logger.warn({ err, id, action }, 'sticker admin failed'); return c.redirect('/stickers?msg=uncertain'); }
    return c.redirect('/stickers?msg=invalid');
  });
}

import type { Child } from 'hono/jsx';
import type { Hono, Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Db } from '../db/client.js';
import type { GuildConfig } from '../config.js';
import type { Cast, MemberSession } from '../db/schema.js';
import type { DiscordActions } from '../lib/discordRest.js';
import type { DiscordApi } from './discordApi.js';
import { createMemberSession, findMemberSession, deleteMemberSession } from './memberSessions.js';
import { randomToken, safeEqual } from './sessions.js';
import { assetUrl } from './assets.js';
import { audit } from '../services/audit.js';
import { logger } from '../lib/logger.js';
import { getCast, menuOf, loadCastConfig, loadCastPhoto, saveCastPhoto, deleteCastPhoto, updateProfile, updateMenuItem, addMenuItem, removeMenuItem, parsePrice, parseTags } from '../services/cast.js';
import { refreshCastIntros } from '../discord/cast.js';

const COOKIE = 'sakura_cast_office';
const STATE = 'sakura_cast_office_state';
const ROOT = '/cast-office';
const allowed = (cast?: Cast) => cast?.status === 'active' || cast?.status === 'paused';
const messages: Record<string, string> = {
  saved: '保存しました。紹介投稿にも反映しました。',
  pending: '保存しました。Discordへの反映はまだ完了していません。「紹介投稿を更新」で再試行できます。',
  invalid: '入力を確認してください。料金は運営が決めた範囲内にしてください。',
  image: 'PNG・JPEG・WebP・GIFの画像を選んでください（8MBまで）。',
  denied: '登録済みのキャストだけが利用できます。運営に登録状況を確認してください。',
  failed: 'Discordに接続できませんでした。もう一度お試しください。',
  state: 'ログインを最初からやり直してください。',
};

function Shell(p: { children: Child }) {
  return <html lang="ja"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>キャスト用 社務所</title><link rel="stylesheet" href={assetUrl('cast-office.css')} /><script src={assetUrl('cast-office.js')} defer /></head><body><main class="cast-office">{p.children}</main></body></html>;
}

export function CastOfficeEditor(p: { cast: Cast; session: MemberSession; hash?: string; message?: string; min: number; max: number; coin: string }) {
  const csrf = <input type="hidden" name="_csrf" value={p.session.csrfToken} />;
  return <Shell><header><div><p class="eyebrow">咲楽ノ宮 ／ キャスト用 社務所</p><h1>{p.session.displayName}のメニュー編集</h1></div><form action={`${ROOT}/logout`} method="post">{csrf}<button>ログアウト</button></form></header>
    {p.message && <p role="status" class="notice">{messages[p.message] || '入力を確認してください。'}</p>}
    <nav aria-label="編集する項目"><a href="#photo">画像</a><a href="#profile">紹介文</a><a href="#menu">メニュー</a></nav>
    <p>自分の内容を編集できます。保存すると、登録済みのDiscord紹介投稿も更新します。</p>
    <div class="editor-layout"><section id="photo"><h2>メニュー画像・紹介写真</h2><img class="photo-preview" data-photo-preview src={p.hash ? `${ROOT}/photo?v=${p.hash}` : undefined} hidden={!p.hash} alt="現在のメニュー画像" /><p data-image-hint>画像は切り取らず、全体を表示します。</p>
      <form action={`${ROOT}/photo`} method="post" enctype="multipart/form-data">{csrf}<label>画像を選ぶ<input type="file" name="image" accept="image/png,image/jpeg,image/webp,image/gif" required data-photo-input /></label><p>8MBまで。選ぶと保存前に見本が出ます。</p><button class="primary">画像を保存</button></form>
      {p.hash && <form action={`${ROOT}/photo/delete`} method="post" data-confirm="画像を外しますか？">{csrf}<button class="danger">画像を外す</button></form>}
    </section><section id="profile"><h2>紹介文</h2><form action={`${ROOT}/profile`} method="post">{csrf}<label>自己紹介<textarea name="bio" maxlength={300} rows={6}>{p.cast.bio}</textarea></label><label>得意なこと（カンマで区切る）<input name="tags" value={p.cast.tags.join(', ')} maxlength={200} /></label><label class="check"><input type="checkbox" name="minorOk" value="yes" checked={p.cast.minorOk} />18歳未満の雑談も受ける</label><button class="primary">紹介文を保存</button></form></section></div>
    <section id="menu"><h2>料金メニュー</h2><p>料金は{p.min.toLocaleString()}〜{p.max.toLocaleString()}{p.coin}。1つずつ保存できます。</p>
      {menuOf(p.cast).map(m => <details class="menu-row"><summary><strong>{m.name}</strong><span>{m.consult ? '内容・料金は相談' : `${m.delivery ? '納品' : m.night ? '寝落ち' : `${m.minutes}分`} ／ ${m.price.toLocaleString()}${p.coin}`}</span><span>変更する</span></summary><form action={`${ROOT}/menu/${m.id}`} method="post">{csrf}<div class="fields"><label>メニュー名<input name="name" value={m.name} maxlength={30} required /></label><label>説明<textarea name="note" maxlength={100} rows={3}>{m.note}</textarea></label><label>時間（分）<input name="minutes" type="number" min={0} max={720} value={m.minutes} required readonly={m.consult || m.delivery || m.night} /></label><label>料金（{p.coin}）<input name="price" type="number" min={m.consult ? 0 : p.min} max={p.max} value={m.price} required readonly={m.consult} /></label>{m.gacha?.length ? <label>ガチャの中身（1行に1つ）<textarea name="gacha" rows={5}>{m.gacha.join('\n')}</textarea></label> : null}</div><button class="primary">このメニューを保存</button></form><form action={`${ROOT}/menu/${m.id}/delete`} method="post" data-confirm="このメニューを削除しますか？">{csrf}<button class="danger">このメニューを削除</button></form></details>)}
      <details class="menu-row"><summary>＋ メニューを追加する</summary><form action={`${ROOT}/menu`} method="post">{csrf}<div class="fields"><label>メニュー名<input name="name" maxlength={30} required /></label><label>説明<textarea name="note" maxlength={100} rows={3} /></label><label>種類<select name="kind" data-menu-kind><option value="call">通話</option><option value="consult">相談</option><option value="delivery">納品</option><option value="gacha">ガチャ（納品）</option></select></label><label>時間（分・相談や納品は0）<input name="minutes" type="number" min={0} max={720} value={30} required /></label><label>料金（相談は0）<input name="price" type="number" min={0} max={p.max} required /></label><label>ガチャの中身（ガチャのみ・1行に1つ）<textarea name="gacha" rows={4} maxlength={2000} /></label></div><button class="primary">メニューを追加</button></form></details>
    </section><footer><form action={`${ROOT}/sync`} method="post">{csrf}<button>紹介投稿を更新</button></form><span>運営への連絡はDiscordからお願いします。</span></footer></Shell>;
}

/** 本人専用。運営のセッションを発行せず、操作対象は必ずログインした本人から決める。 */
export function mountCastOffice(app: Hono<any>, d: { db: Db; api: DiscordApi; discord: DiscordActions; cfg: () => GuildConfig; baseUrl: string; secure: boolean; now: () => Date; enabled: boolean }) {
  const { db, api } = d;
  const redirectUri = `${d.baseUrl}/auth/callback`;
  app.get(`${ROOT}/login`, c => c.html(<Shell><p class="eyebrow">咲楽ノ宮</p><h1>キャスト用 社務所</h1><p>自分のメニュー画像・紹介文・料金を編集できます。</p>{c.req.query('e') && <p role="alert" class="notice">{messages[c.req.query('e')!] || messages.state}</p>}{d.enabled ? <a class="primary login" href={`${ROOT}/auth`}>Discordでログイン</a> : <p>Discordログインは現在停止しています。</p>}</Shell>));
  app.get(`${ROOT}/auth`, c => {
    if (!d.enabled) return c.notFound();
    const state = randomToken();
    setCookie(c, STATE, state, { httpOnly: true, secure: d.secure, sameSite: 'Lax', path: '/auth', maxAge: 600 });
    return c.redirect(api.authorizeUrl(state, redirectUri));
  });
  // 登録済みのOAuth戻り先を共用する。キャストのstateが一致した場合だけ処理する。
  app.use('/auth/callback', async (c, next) => {
    const state = getCookie(c, STATE);
    if (!state || !safeEqual(state, c.req.query('state') ?? '')) return next();
    deleteCookie(c, STATE, { path: '/auth' });
    if (!d.enabled || !c.req.query('code')) return c.redirect(`${ROOT}/login?e=state`);
    try {
      const user = await api.me(await api.exchangeCode(c.req.query('code')!, redirectUri));
      const roles = await api.memberRoles(d.cfg().guildId, user.id);
      if (!roles || !allowed(await getCast(db, user.id))) return c.redirect(`${ROOT}/login?e=denied`);
      const token = await createMemberSession(db, user, d.now());
      setCookie(c, COOKIE, token, { httpOnly: true, secure: d.secure, sameSite: 'Lax', path: ROOT, maxAge: 7 * 86400 });
      await audit(db, { actorId: user.id, action: 'cast.office.login', via: 'web' });
      return c.redirect(ROOT);
    } catch (err) { logger.warn({ err }, 'cast office login failed'); return c.redirect(`${ROOT}/login?e=failed`); }
  });
  const page = (fn: (c: Context, session: MemberSession, cast: Cast, body: Record<string, unknown>) => Promise<Response>) => async (c: Context) => {
    const token = getCookie(c, COOKIE);
    const session = token ? await findMemberSession(db, token, d.now()) : undefined;
    if (!session) return c.redirect(`${ROOT}/login`);
    let roles;
    try { roles = await api.memberRoles(d.cfg().guildId, session.userId); }
    catch { return c.text('Discordに接続できません。時間をおいて再試行してください。', 503); }
    const cast = await getCast(db, session.userId);
    if (!roles || !allowed(cast)) { await deleteMemberSession(db, session.id); deleteCookie(c, COOKIE, { path: ROOT }); return c.redirect(`${ROOT}/login?e=denied`); }
    const body = c.req.method === 'POST' ? await c.req.parseBody() : {};
    if (c.req.method === 'POST' && !safeEqual(typeof body._csrf === 'string' ? body._csrf : '', session.csrfToken)) return c.text('不正なリクエストです（CSRF）。', 403);
    return fn(c, session, cast!, body);
  };
  const saved = async (c: Context, s: MemberSession, action: string) => {
    await audit(db, { actorId: s.userId, targetId: s.userId, action, via: 'web' });
    const ok = await refreshCastIntros(db, d.discord, s.userId).catch(err => { logger.warn({ err }, 'cast office sync failed'); return false; });
    return c.redirect(`${ROOT}?msg=${ok ? 'saved' : 'pending'}`);
  };
  const input = (b: Record<string, unknown>) => ({ name: String(b.name ?? '').trim(), note: String(b.note ?? '').trim(), minutes: parsePrice(String(b.minutes ?? '')), price: parsePrice(String(b.price ?? '')), night: false, ...(typeof b.gacha === 'string' ? { gacha: [...new Set(b.gacha.split(/\r?\n/).map(x => x.trim()).filter(Boolean))] } : {}) });
  app.get(ROOT, page(async (c, session, cast) => {
    const conf = await loadCastConfig(db);
    return c.html(<CastOfficeEditor cast={cast} session={session} hash={(await loadCastPhoto(db, session.userId))?.hash} message={c.req.query('msg')} min={conf.priceMin} max={conf.priceMax} coin={d.cfg().economy.currencyName} />);
  }));
  app.get(`${ROOT}/photo`, page(async (c, s) => {
    const photo = await loadCastPhoto(db, s.userId);
    return photo ? c.body(Buffer.from(photo.data), 200, { 'content-type': photo.contentType, 'x-content-type-options': 'nosniff' }) : c.notFound();
  }));
  app.post(`${ROOT}/photo`, page(async (c, s, _cast, b) => {
    const f = b.image;
    if (!(f instanceof File) || !f.size || f.size > 8 * 1024 * 1024 || !await saveCastPhoto(db, s.userId, new Uint8Array(await f.arrayBuffer()))) return c.redirect(`${ROOT}?msg=image`);
    return saved(c, s, 'cast.office.photo');
  }));
  app.post(`${ROOT}/photo/delete`, page(async (c, s) => { await deleteCastPhoto(db, s.userId); return saved(c, s, 'cast.office.photo.delete'); }));
  app.post(`${ROOT}/profile`, page(async (c, s, cast, b) => {
    const r = await updateProfile(db, await loadCastConfig(db), s.userId, { bio: String(b.bio ?? '').trim(), tags: parseTags(String(b.tags ?? '')), minorOk: b.minorOk === 'yes', price30: cast.price30, price60: cast.price60, priceNight: cast.priceNight });
    return r ? saved(c, s, 'cast.office.profile') : c.redirect(`${ROOT}?msg=invalid`);
  }));
  app.post(`${ROOT}/menu`, page(async (c, s, _cast, b) => {
    const m = input(b);
    const kind = String(b.kind ?? 'call');
    if (!['call', 'consult', 'delivery', 'gacha'].includes(kind)) return c.redirect(`${ROOT}?msg=invalid`);
    const r = await addMenuItem(db, await loadCastConfig(db), s.userId, { ...m, consult: kind === 'consult', delivery: kind === 'delivery' || kind === 'gacha', minutes: kind === 'call' ? m.minutes : 0, price: kind === 'consult' ? 0 : m.price, gacha: kind === 'gacha' ? m.gacha : [] });
    return r === 'ok' ? saved(c, s, 'cast.office.menu.add') : c.redirect(`${ROOT}?msg=invalid`);
  }));
  app.post(`${ROOT}/menu/:item`, page(async (c, s, _cast, b) => {
    const r = await updateMenuItem(db, await loadCastConfig(db), s.userId, c.req.param('item') ?? '', input(b));
    return r === 'ok' ? saved(c, s, 'cast.office.menu.edit') : c.redirect(`${ROOT}?msg=invalid`);
  }));
  app.post(`${ROOT}/menu/:item/delete`, page(async (c, s) => await removeMenuItem(db, s.userId, c.req.param('item') ?? '') ? saved(c, s, 'cast.office.menu.delete') : c.redirect(`${ROOT}?msg=invalid`)));
  app.post(`${ROOT}/sync`, page(async (c, s) => saved(c, s, 'cast.office.sync')));
  app.post(`${ROOT}/logout`, page(async (c, s) => { await deleteMemberSession(db, s.id); deleteCookie(c, COOKIE, { path: ROOT }); return c.redirect(`${ROOT}/login`); }));
}

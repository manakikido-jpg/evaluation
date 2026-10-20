import type { Child } from 'hono/jsx';
import type { Hono, Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Db } from '../db/client.js';
import type { GuildConfig } from '../config.js';
import type { MemberSession } from '../db/schema.js';
import type { DiscordActions } from '../lib/discordRest.js';
import type { DiscordApi } from './discordApi.js';
import { createMemberSession, findMemberSession, deleteMemberSession } from './memberSessions.js';
import { safeEqual } from './sessions.js';
import { assetUrl } from './assets.js';
import { audit } from '../services/audit.js';
import { logger } from '../lib/logger.js';
import { walletOf } from '../services/economy.js';
import { setWorn, wearables, type Wearable } from '../services/myPage.js';
import { peekLoginLink, useLoginLink } from '../services/casino/loginLinks.js';

/**
 * 👘 マイページ（メンバー本人だけ）。Discord の /マイページ のボタン（1 回きりのリンク）から入る。
 * 持っている色守り・称号などのロールを、自分でつける・外す。操作する相手は、いつもログインした本人
 */

const COOKIE = 'sakura_mypage';
const ROOT = '/mypage';
const messages: Record<string, string> = {
  worn: 'つけました。Discord の名前・プロフィールに出ます。',
  off: '外しました。持ったままなので、いつでもつけ直せます。',
  failed: 'Discord でロールを変えられませんでした。少し待ってから、もう一度お試しください。',
  invalid: 'その品は見つかりません。画面を開き直してください。',
  link: 'リンクの期限が切れたか、もう使われています。Discord で /マイページ を打って、新しいボタンから入ってください。',
  denied: 'サーバーにいる方だけが使えます。',
  login: 'Discord で /マイページ を打って、出てきたボタンから入ってください（10 分だけ使えるリンク）。',
};
const GROUP_LABEL: Record<string, string> = { color: '🎨 色守り', mycolor: '🖌 自分だけの色', title: '🏷 称号', vip: '💎 VIP', other: '🎁 そのほか' };
const jstDay = (d: Date) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' }).format(d);

function Shell(p: { children: Child }) {
  return (
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>マイページ | 咲楽ノ宮</title>
        <link rel="stylesheet" href={assetUrl('cast-office.css')} />
      </head>
      <body>
        <main class="cast-office">{p.children}</main>
      </body>
    </html>
  );
}

export function MyPageView(p: { session: MemberSession; balance: number; coin: string; items: Wearable[]; roles: readonly string[]; message?: string }) {
  const csrf = <input type="hidden" name="_csrf" value={p.session.csrfToken} />;
  const groups = [...new Set(p.items.map((i) => i.group))];
  return (
    <Shell>
      <header>
        <div>
          <p class="eyebrow">咲楽ノ宮 ／ マイページ</p>
          <h1>{p.session.displayName} さんのマイページ</h1>
        </div>
        <form action={`${ROOT}/logout`} method="post">
          {csrf}
          <button>ログアウト</button>
        </form>
      </header>
      {p.message && (
        <p role="status" class="notice">
          {messages[p.message] ?? messages.invalid}
        </p>
      )}
      <section>
        <h2>👛 持っている{p.coin}</h2>
        <p>
          <strong>{p.balance.toLocaleString('ja-JP')}</strong> 枚
        </p>
      </section>
      <section id="wear">
        <h2>👘 つけるもの</h2>
        <p>授与所で受けた色守り・称号などは、全部持ったままです。つける・外すを自分で選べます。外しても持ったままで、期限はそのまま進みます。名前の色は、ついている色のうち、いちばん上の色になります。</p>
        {p.items.length === 0 && <p>まだ持っていません。授与所（ショップ）で受けると、ここに出ます。</p>}
        {groups.map((g) => (
          <>
            <h3>{GROUP_LABEL[g] ?? GROUP_LABEL.other}</h3>
            {p.items
              .filter((i) => i.group === g)
              .map((i) => {
                const on = i.worn;
                return (
                  <div class="menu-row">
                    <strong>
                      {i.emoji} {i.name}
                    </strong>
                    <span>
                      {on ? '✅ つけている' : '⬜ 外している'}
                      {on && !p.roles.includes(i.roleId) ? '（Discord でまだ付いていません）' : ''}
                      {i.expiresAt ? ` ・ ${jstDay(i.expiresAt)} まで` : ' ・ ずっと'}
                    </span>
                    <form action={`${ROOT}/wear/${i.purchaseId}`} method="post">
                      {csrf}
                      <input type="hidden" name="worn" value={on ? '0' : '1'} />
                      <button class={on ? '' : 'primary'}>{on ? '外す' : 'つける'}</button>
                    </form>
                  </div>
                );
              })}
          </>
        ))}
      </section>
      <footer>
        <span>色や称号は、Discord の授与所（ショップ）で受けられます。</span>
      </footer>
    </Shell>
  );
}

export function mountMyPage(app: Hono<any>, d: { db: Db; api: DiscordApi; discord: DiscordActions; cfg: () => GuildConfig; baseUrl: string; secure: boolean; now: () => Date }) {
  const { db, api } = d;
  const notice = (key: string) => (
    <Shell>
      <p class="eyebrow">咲楽ノ宮</p>
      <h1>マイページ</h1>
      <p role="alert" class="notice">
        {messages[key] ?? messages.login}
      </p>
    </Shell>
  );
  app.get(`${ROOT}/login`, (c) => c.html(notice(c.req.query('e') ?? 'login')));
  // /マイページ のボタンに出す 1 回きりのリンク（Discord のログイン画面を通らない）
  app.get(`${ROOT}/link/:token`, async (c) => {
    const user = await peekLoginLink(db, c.req.param('token') ?? '', d.now());
    if (!user) return c.redirect(`${ROOT}/login?e=link`);
    return c.html(
      <Shell>
        <p class="eyebrow">咲楽ノ宮</p>
        <h1>マイページ</h1>
        <p>{user.displayName} さんとして入ります。</p>
        <form action={`${ROOT}/link/${c.req.param('token')}`} method="post">
          <button class="primary">入る</button>
        </form>
      </Shell>,
    );
  });
  app.post(`${ROOT}/link/:token`, async (c) => {
    // ほかのサイトから送らせて、別の人として入らせることはさせない
    const origin = c.req.header('origin');
    if (origin && origin !== new URL(d.baseUrl).origin) return c.text('不正なリクエストです。', 403);
    const user = await useLoginLink(db, c.req.param('token') ?? '', d.now());
    if (!user) return c.redirect(`${ROOT}/login?e=link`);
    try {
      if (!(await api.memberRoles(d.cfg().guildId, user.id))) return c.redirect(`${ROOT}/login?e=denied`);
    } catch (err) {
      logger.warn({ err }, 'mypage link login failed');
      return c.text('Discordに接続できません。時間をおいて再試行してください。', 503);
    }
    const token = await createMemberSession(db, { id: user.id, username: user.displayName, displayName: user.displayName, avatarUrl: user.avatarUrl }, d.now());
    setCookie(c, COOKIE, token, { httpOnly: true, secure: d.secure, sameSite: 'Lax', path: ROOT, maxAge: 7 * 86400 });
    await audit(db, { actorId: user.id, action: 'mypage.login', via: 'web' });
    return c.redirect(ROOT);
  });
  /** 本人だけ。サーバーにいなければ追い出す。POST は CSRF を確かめる */
  const page = (fn: (c: Context, s: MemberSession, roles: string[], body: Record<string, unknown>) => Promise<Response>) => async (c: Context) => {
    const token = getCookie(c, COOKIE);
    const session = token ? await findMemberSession(db, token, d.now()) : undefined;
    if (!session) return c.redirect(`${ROOT}/login`);
    let roles: string[] | null;
    try {
      roles = await api.memberRoles(d.cfg().guildId, session.userId);
    } catch {
      return c.text('Discordに接続できません。時間をおいて再試行してください。', 503);
    }
    if (!roles) {
      await deleteMemberSession(db, session.id);
      deleteCookie(c, COOKIE, { path: ROOT });
      return c.redirect(`${ROOT}/login?e=denied`);
    }
    const body = c.req.method === 'POST' ? await c.req.parseBody() : {};
    if (c.req.method === 'POST' && !safeEqual(typeof body._csrf === 'string' ? body._csrf : '', session.csrfToken)) return c.text('不正なリクエストです（CSRF）。', 403);
    return fn(c, session, roles, body);
  };
  app.get(
    ROOT,
    page(async (c, s, roles) => {
      const e = d.cfg().economy;
      const [items, wallet] = await Promise.all([wearables(db, s.userId), walletOf(db, s.userId)]);
      return c.html(<MyPageView session={s} balance={wallet.balance} coin={`${e.currencyEmoji}${e.currencyName}`} items={items} roles={roles} message={c.req.query('msg')} />);
    }),
  );
  app.post(
    `${ROOT}/wear/:id`,
    page(async (c, s, _roles, b) => {
      const id = Number(c.req.param('id'));
      const worn = b.worn === '1';
      const item = (await wearables(db, s.userId)).find((w) => w.purchaseId === id);
      if (!Number.isSafeInteger(id) || !item) return c.redirect(`${ROOT}?msg=invalid`);
      // 先に Discord でロールを変える（できなければ記録は変えない）
      try {
        if (worn) await d.discord.addRole(d.cfg().guildId, s.userId, item.roleId, 'マイページでつけた');
        else await d.discord.removeRole(d.cfg().guildId, s.userId, item.roleId, 'マイページで外した');
      } catch (err) {
        logger.warn({ err }, 'mypage wear failed');
        return c.redirect(`${ROOT}?msg=failed`);
      }
      await setWorn(db, s.userId, id, worn);
      await audit(db, { actorId: s.userId, targetId: s.userId, action: worn ? 'mypage.wear' : 'mypage.unwear', detail: { purchaseId: id, roleId: item.roleId, name: item.name }, via: 'web' });
      return c.redirect(`${ROOT}?msg=${worn ? 'worn' : 'off'}#wear`);
    }),
  );
  app.post(
    `${ROOT}/logout`,
    page(async (c, s) => {
      await deleteMemberSession(db, s.id);
      deleteCookie(c, COOKIE, { path: ROOT });
      return c.redirect(`${ROOT}/login`);
    }),
  );
}

import type { Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { adminLevelOf, type GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { peekLoginLink, useLoginLink } from '../services/casino/loginLinks.js';
import { audit } from '../services/audit.js';
import { ShinpuRooms } from '../services/shinpu/rooms.js';
import { createMemberSession, deleteMemberSession, findMemberSession } from './memberSessions.js';
import { randomToken, safeEqual } from './sessions.js';
import type { DiscordApi, DiscordUser } from './discordApi.js';
import { assetUrl } from './assets.js';
import { ShinpuTestPage } from './views/shinpu.js';
import { ShinpuCatalogPage } from './views/shinpuCatalog.js';
import { catalog } from '../services/shinpu/catalog.js';
const ROOT = '/casino/shinpu';
const COOKIE = 'sakura_shinpu_test',
  STATE = 'sakura_shinpu_state',
  ROOM = 'sakura_shinpu_room';
type Deps = {
  db: Db;
  api: DiscordApi;
  cfg: () => GuildConfig;
  baseUrl: string;
  secure: boolean;
  now: () => Date;
  /** 社務所Web に運営としてログインしている、その人か（Discord に聞かずに入れる。ID とパスワードの人も） */
  staffOf?: (c: Context, userId: string) => Promise<boolean>;
};
const input = z.object({
  operation: z.enum(['create', 'join', 'start', 'move', 'leave']),
  roomId: z.string().uuid().optional(),
  capacity: z.number().int().min(2).max(6).optional(),
  revision: z.number().int().nonnegative().optional(),
  action: z.string().max(20).optional(),
  ids: z.array(z.number().int().positive()).max(10).default([]),
  target: z.union([z.number().int().min(0).max(5), z.enum(['mp', 'hp', 'coin'])]).optional(),
  options: z.object({
    targets: z.array(z.number().int().min(0).max(5)).min(1).max(2).optional(),
    element: z.enum(['火', '水', '風', '雷', '土', '光', '闇']).optional(),
    pay: z.boolean().optional(),
  }).strict().optional(),
});
function Entry({ action, name, room }: { action?: string; name?: string; room?: string }) {
  return (
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>神符合戦・運営テスト</title>
        <link rel="stylesheet" href={assetUrl('shinpu.css')} />
      </head>
      <body>
        <main class="wrap">
          <section class="arena">
            <h1>神符合戦・運営テスト</h1>
            <p>宮司・神職のロールがある人だけ入れます。</p>
            <p>テスト用の霊銭で遊びます。サーバーの残高は動きません。</p>
            {action ? (
              <form method="post" action={action}>
                <p>{name}さんとして入ります。このリンクは人に渡さないでください。</p>
                <button class="primary">テストプレイに入る</button>
              </form>
            ) : (
              <a href={`${ROOT}/auth${room ? `?room=${room}` : ''}`}>Discordで認証して入る</a>
            )}
          </section>
        </main>
      </body>
    </html>
  );
}
export function mountShinpu(app: Hono<any>, d: Deps) {
  const rooms = new ShinpuRooms(() => d.now().getTime());
  const redirect = `${d.baseUrl}/casino/auth/callback`;
  const cookieOpts = { httpOnly: true, secure: d.secure, sameSite: 'Lax' as const, path: ROOT, maxAge: 7 * 86400 };
  const allowed = async (id: string) => {
    const roles = await d.api.memberRoles(d.cfg().guildId, id);
    return !!roles && !!adminLevelOf(d.cfg(), roles);
  };
  // 権限の再確認は各リクエスト。Discordへの接続失敗も許可として扱わない。
  const requireAdmin = async (c: Context) => {
    const s = await findMemberSession(d.db, getCookie(c, COOKIE) ?? '', d.now());
    if (!s) return { response: c.json({ error: 'Discordで認証して入り直してください。' }, 401) };
    // 社務所Web に運営として入っていれば、それで確かめる（Discord が混んでいても・ID とパスワードの人も入れる）
    if (d.staffOf && (await d.staffOf(c, s.userId))) return { session: s };
    try {
      if (!(await allowed(s.userId))) {
        await deleteMemberSession(d.db, s.id);
        deleteCookie(c, COOKIE, { path: ROOT });
        return { response: c.json({ error: '運営ロールが必要です。' }, 403) };
      }
    } catch {
      return { response: c.json({ error: 'Discordで権限を確認できません。少し待ってください。' }, 503) };
    }
    return { session: s };
  };
  const login = async (c: Context, user: DiscordUser, room?: string) => {
    try {
      if (!(await allowed(user.id))) return c.text('運営ロールが必要です。', 403);
    } catch {
      return c.text('Discordで権限を確認できません。少し待ってください。', 503);
    }
    const token = await createMemberSession(d.db, user, d.now());
    setCookie(c, COOKIE, token, cookieOpts);
    await audit(d.db, { actorId: user.id, action: 'shinpu.test.login', via: 'web' });
    return c.redirect(`${ROOT}${room ? `?room=${room}` : ''}`);
  };
  app.get(`${ROOT}/auth`, (c) => {
    const state = randomToken();
    setCookie(c, STATE, state, { ...cookieOpts, path: '/casino/auth', maxAge: 600 });
    const room = z.string().uuid().safeParse(c.req.query('room'));
    if (room.success) setCookie(c, ROOM, room.data, { ...cookieOpts, path: '/casino/auth', maxAge: 600 });
    else deleteCookie(c, ROOM, { path: '/casino/auth' });
    return c.redirect(d.api.authorizeUrl(state, redirect));
  });
  app.get('/casino/auth/callback', async (c, next) => {
    const state = getCookie(c, STATE);
    if (!state || !safeEqual(state, c.req.query('state') ?? '')) return next();
    deleteCookie(c, STATE, { path: '/casino/auth' });
    const room = z.string().uuid().safeParse(getCookie(c, ROOM));
    deleteCookie(c, ROOM, { path: '/casino/auth' });
    if (!state || !c.req.query('code') || !safeEqual(state, c.req.query('state') ?? ''))
      return c.text('認証を最初からやり直してください。', 403);
    let user: DiscordUser;
    try {
      user = await d.api.me(await d.api.exchangeCode(c.req.query('code')!, redirect));
    } catch {
      return c.text('Discord認証に失敗しました。', 503);
    }
    return login(c, user, room.success ? room.data : undefined);
  });
  app.get(`${ROOT}/link/:token`, async (c) => {
    const u = await peekLoginLink(d.db, c.req.param('token'), d.now());
    if (!u) return c.text('リンクの期限が切れたか、使用済みです。BOTから開き直してください。', 410);
    return c.html(<Entry action={`${ROOT}/link/${c.req.param('token')}`} name={u.displayName} />);
  });
  app.post(`${ROOT}/link/:token`, async (c) => {
    if (c.req.header('origin') !== new URL(d.baseUrl).origin) return c.text('不正なリクエストです。', 403);
    const u = await useLoginLink(d.db, c.req.param('token'), d.now());
    if (!u) return c.text('リンクの期限が切れたか、使用済みです。', 410);
    return login(c, { ...u, username: u.displayName });
  });
  app.get(ROOT, async (c) => {
    if (!getCookie(c, COOKIE)) {
      const room = z.string().uuid().safeParse(c.req.query('room'));
      return c.html(<Entry room={room.success ? room.data : undefined} />);
    }
    const auth = await requireAdmin(c);
    if (auth.response) return auth.response;
    return c.html(<ShinpuTestPage csrf={auth.session.csrfToken} name={auth.session.displayName} />);
  });
  app.get(`${ROOT}/cards`, async (c) => {
    const auth = await requireAdmin(c);
    if (auth.response) return auth.response;
    const page = z.coerce.number().int().min(1).max(10000).safeParse(c.req.query('page') ?? '1');
    return c.html(<ShinpuCatalogPage query={(c.req.query('q') ?? '').slice(0, 100)} category={c.req.query('category') ?? ''}
      element={c.req.query('element') ?? ''} page={page.success ? page.data : 1} />);
  });
  app.get(`${ROOT}/cards/:id`, async (c) => {
    const auth = await requireAdmin(c);
    if (auth.response) return auth.response;
    const card = catalog.find(card => card.id === c.req.param('id'));
    if (!card) return c.text('この札は見つかりません。', 404);
    return c.html(<ShinpuCatalogPage card={card} />);
  });
  app.get(`${ROOT}/api`, async (c) => {
    const auth = await requireAdmin(c);
    if (auth.response) return auth.response;
    try {
      const id = c.req.query('room');
      return c.json(id ? rooms.view(id, auth.session.userId) : { rooms: rooms.list(auth.session.userId) });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });
  app.post(`${ROOT}/api`, async (c) => {
    const auth = await requireAdmin(c);
    if (auth.response) return auth.response;
    if (c.req.header('origin') !== new URL(d.baseUrl).origin || !safeEqual(auth.session.csrfToken, c.req.header('x-csrf-token') ?? ''))
      return c.json({ error: '画面を開き直してください。' }, 403);
    let body;
    try {
      body = input.safeParse(await c.req.json());
    } catch {
      return c.json({ error: '送る内容を確認してください。' }, 400);
    }
    if (!body.success) return c.json({ error: '送る内容を確認してください。' }, 400);
    const b = body.data,
      user = { id: auth.session.userId, name: auth.session.displayName, avatarUrl: auth.session.avatarUrl };
    try {
      if (b.operation === 'create') {
        if (!b.capacity) throw Error('人数を選んでください。');
        const view = rooms.create(user, b.capacity);
        await audit(d.db, {
          actorId: user.id,
          action: 'shinpu.test.create',
          detail: { roomId: view.roomId, capacity: b.capacity },
          via: 'web',
        });
        return c.json(view);
      }
      if (!b.roomId) throw Error('部屋を選んでください。');
      if (b.operation === 'join') return c.json(rooms.join(b.roomId, user));
      if (b.operation === 'leave') {
        rooms.leave(b.roomId, user.id);
        return c.json({ left: true });
      }
      if (b.revision === undefined) throw Error('画面を開き直してください。');
      if (b.operation === 'start') return c.json(rooms.start(b.roomId, user.id, b.revision));
      return c.json(rooms.move(b.roomId, user.id, { revision: b.revision, action: b.action ?? '', ids: b.ids, target: b.target, options: b.options }));
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });
}

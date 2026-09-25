import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { listAudit } from '../src/services/audit.js';
import { recordJoin } from '../src/services/members.js';
import type { DiscordApi } from '../src/web/discordApi.js';
import { createWebApp } from '../src/web/app.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const STAFF = '700000000000000001';
const GUJI = '700000000000000002';
const USER = '700000000000000003';
const BASE = 'https://shamusho.example.com';

let db: Db;
let close: () => Promise<void>;
let roles: Map<string, string[]>;
let clock: Date;
let app: ReturnType<typeof createWebApp>;
/** 偽の Discord で「誰としてログインするか」 */
let loginAs: string;

const fakeApi: DiscordApi = {
  authorizeUrl: (state, redirect) => `https://discord.com/oauth2/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirect)}`,
  exchangeCode: async (code) => {
    if (code !== 'good') throw new Error('bad code');
    return 'access';
  },
  me: async () => ({ id: loginAs, username: 'u' + loginAs.slice(-1), displayName: 'User' + loginAs.slice(-1), avatarUrl: null }),
  memberRoles: async (_g, userId) => roles.get(userId) ?? null,
};

beforeEach(async () => {
  ({ db, close } = await makeDb());
  roles = new Map([
    [STAFF, [ROLE.shinshoku, ROLE.ujiko]],
    [GUJI, [ROLE.guji]],
    [USER, [ROLE.sanpaisha]],
  ]);
  clock = new Date('2026-09-25T12:00:00Z');
  app = createWebApp({ db, cfg, api: fakeApi, baseUrl: BASE, now: () => clock });
  await recordJoin(db, {
    id: USER,
    username: 'sakura',
    displayName: 'さくら<script>',
    avatarUrl: null,
    roleIds: [ROLE.sanpaisha],
    isBot: false,
    joinedAt: new Date('2026-09-01T00:00:00Z'),
  });
});
afterEach(async () => {
  await close();
});

function cookiesFrom(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const [k, v] = pair!.split('=');
    out[k!] = v ?? '';
  }
  return out;
}

/** ログインまでの流れを通して、セッション Cookie を返す */
async function login(userId: string): Promise<string> {
  loginAs = userId;
  const start = await app.request('/auth/discord');
  expect(start.status).toBe(302);
  const state = cookiesFrom(start).shamusho_state!;
  const location = start.headers.get('location')!;
  expect(location).toContain(`state=${state}`);
  expect(location).toContain(encodeURIComponent(`${BASE}/auth/callback`));

  const cb = await app.request(`/auth/callback?code=good&state=${state}`, { headers: { cookie: `shamusho_state=${state}` } });
  expect(cb.status).toBe(302);
  if (cb.headers.get('location') !== '/') return '';
  const session = cookiesFrom(cb).shamusho_session!;
  expect(cb.headers.getSetCookie().find((c) => c.startsWith('shamusho_session'))).toMatch(/HttpOnly.*Secure|Secure.*HttpOnly/);
  return session;
}

const get = (path: string, session: string, headers: Record<string, string> = {}) =>
  app.request(path, { headers: { cookie: `shamusho_session=${session}`, ...headers } });

describe('ログイン', () => {
  it('ログインしていなければログイン画面へ', async () => {
    for (const p of ['/', '/members', `/members/${USER}`, '/audit']) {
      const res = await app.request(p);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/login');
    }
  });

  it('ログイン画面は誰でも見られる', async () => {
    const res = await app.request('/login');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Discord でログイン');
  });

  it('神職はログインでき、記録が残る', async () => {
    const s = await login(STAFF);
    expect(s).not.toBe('');
    const home = await get('/', s);
    expect(home.status).toBe(200);
    const html = await home.text();
    expect(html).toContain('今日の社務所');
    expect(html).toContain('🎐 神職');
    expect((await listAudit(db)).map((a) => a.action)).toContain('auth.login');
  });

  it('宮司は宮司としてログイン', async () => {
    const s = await login(GUJI);
    expect(await (await get('/', s)).text()).toContain('⛩ 宮司');
  });

  it('一般メンバー・サーバーにいない人は入れない', async () => {
    loginAs = USER;
    for (const id of [USER, '700000000000000099']) {
      loginAs = id;
      const start = await app.request('/auth/discord');
      const state = cookiesFrom(start).shamusho_state!;
      const cb = await app.request(`/auth/callback?code=good&state=${state}`, { headers: { cookie: `shamusho_state=${state}` } });
      expect(cb.headers.get('location')).toBe('/login?e=forbidden');
      expect(cookiesFrom(cb).shamusho_session).toBeUndefined();
    }
    expect((await listAudit(db)).filter((a) => a.action === 'auth.denied')).toHaveLength(2);
  });

  it('state が合わないログインは拒否（偽のログイン対策）', async () => {
    loginAs = STAFF;
    const cb = await app.request('/auth/callback?code=good&state=forged', { headers: { cookie: 'shamusho_state=real' } });
    expect(cb.headers.get('location')).toBe('/login?e=state');
    const noCookie = await app.request('/auth/callback?code=good&state=x');
    expect(noCookie.headers.get('location')).toBe('/login?e=state');
  });

  it('Discord とのやり取りに失敗したら', async () => {
    loginAs = STAFF;
    const start = await app.request('/auth/discord');
    const state = cookiesFrom(start).shamusho_state!;
    const cb = await app.request(`/auth/callback?code=bad&state=${state}`, { headers: { cookie: `shamusho_state=${state}` } });
    expect(cb.headers.get('location')).toBe('/login?e=failed');
  });

  it('でたらめな Cookie では入れない', async () => {
    const res = await get('/', 'not-a-real-session');
    expect(res.headers.get('location')).toBe('/login?e=expired');
  });

  it('12 時間でログインが切れる', async () => {
    const s = await login(STAFF);
    clock = new Date(clock.getTime() + 13 * 3_600_000);
    roles.set(STAFF, [ROLE.shinshoku]);
    const res = await get('/', s);
    expect(res.headers.get('location')).toBe('/login?e=expired');
  });
});

describe('権限の確かめ直し', () => {
  it('5 分以内は Discord に問い合わせない', async () => {
    const s = await login(STAFF);
    roles.set(STAFF, []);
    clock = new Date(clock.getTime() + 60_000);
    expect((await get('/', s)).status).toBe(200);
  });

  it('神職を外されたら、次の確認で追い出される', async () => {
    const s = await login(STAFF);
    roles.set(STAFF, [ROLE.ujiko]);
    clock = new Date(clock.getTime() + 6 * 60_000);
    const res = await get('/', s);
    expect(res.headers.get('location')).toBe('/login?e=forbidden');
    // セッションも消えている
    roles.set(STAFF, [ROLE.shinshoku]);
    expect((await get('/', s)).headers.get('location')).toBe('/login?e=expired');
    expect((await listAudit(db)).map((a) => a.action)).toContain('auth.revoked');
  });

  it('htmx からのリクエストはページごとログイン画面へ', async () => {
    const res = await app.request('/members?q=a', { headers: { 'hx-request': 'true' } });
    expect(res.status).toBe(401);
    expect(res.headers.get('hx-redirect')).toBe('/login');
  });
});

describe('ログアウト', () => {
  it('CSRF トークンがないと拒否、正しければログアウト', async () => {
    const s = await login(STAFF);
    const bad = await app.request('/logout', {
      method: 'POST',
      headers: { cookie: `shamusho_session=${s}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: '_csrf=wrong',
    });
    expect(bad.status).toBe(403);

    const html = await (await get('/', s)).text();
    const csrf = /name="_csrf" value="([^"]+)"/.exec(html)![1]!;
    const ok = await app.request('/logout', {
      method: 'POST',
      headers: { cookie: `shamusho_session=${s}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: `_csrf=${encodeURIComponent(csrf)}`,
    });
    expect(ok.headers.get('location')).toBe('/login');
    expect((await get('/', s)).headers.get('location')).toBe('/login?e=expired');
  });
});

describe('画面', () => {
  it('メンバー一覧・検索（名前はエスケープされる）', async () => {
    const s = await login(STAFF);
    const res = await get('/members?q=さくら', s);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('1 人');
    expect(html).toContain('さくら&lt;script&gt;');
    expect(html).not.toContain('さくら<script>');
  });

  it('htmx の絞り込みは結果の部分だけ返す', async () => {
    const s = await login(STAFF);
    const html = await (await get('/members?rank=sanpaisha', s, { 'hx-request': 'true' })).text();
    expect(html.startsWith('<section id="results">')).toBe(true);
    expect(html).not.toContain('<html');
  });

  it('メンバー詳細', async () => {
    const s = await login(STAFF);
    const res = await get(`/members/${USER}`, s);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('🔰 参拝者');
    expect(html).toContain('頂いた朱印');
    expect(html).toContain('参加');
  });

  it('いない人・おかしな ID は 404', async () => {
    const s = await login(STAFF);
    expect((await get('/members/700000000000000050', s)).status).toBe(404);
    expect((await get('/members/abc', s)).status).toBe(404);
  });

  it('操作の記録', async () => {
    const s = await login(STAFF);
    const html = await (await get('/audit', s)).text();
    expect(html).toContain('ログイン');
  });

  it('セキュリティヘッダー', async () => {
    const res = await app.request('/login');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
  });

  it('静的ファイル', async () => {
    expect((await app.request('/static/style.css')).headers.get('content-type')).toContain('text/css');
    expect((await app.request('/static/htmx.min.js')).status).toBe(200);
    expect((await app.request('/static/../../package.json')).status).toBe(404);
  });
});

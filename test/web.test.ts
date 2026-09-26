import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { listAudit } from '../src/services/audit.js';
import { recordJoin } from '../src/services/members.js';
import type { DiscordApi } from '../src/web/discordApi.js';
import type { DiscordActions } from '../src/lib/discordRest.js';
import { addCoins } from '../src/services/economy.js';
import { activeYakuCount, memosOf } from '../src/services/yaku.js';
import { createWebApp } from '../src/web/app.js';
import { listNotices } from '../src/services/notices.js';
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
let actions: string[];
const fakeActions: DiscordActions = {
  addRole: async (_g, u, r) => void actions.push(`addRole ${u} ${r}`),
  removeRole: async (_g, u, r) => void actions.push(`removeRole ${u} ${r}`),
  sendDm: async (u) => (actions.push(`dm ${u}`), true),
  ban: async (_g, u) => void actions.push(`ban ${u}`),
  unban: async () => undefined,
  kick: async (_g, u) => void actions.push(`kick ${u}`),
  editMessage: async (_c, m, b) => void actions.push(`edit ${m} ${b.content || b.embeds?.[0]?.description}`),
  sendMessage: async (c, b) => (actions.push(`send ${c} ${b.content || b.embeds?.[0]?.description}`), { id: `m${actions.length}` }),
  deleteMessage: async (_c, m) => void actions.push(`delete ${m}`),
  guildChannels: async () => [
    { id: '910000000000000001', name: '⛩ 鳥居', type: 4, parent_id: null, position: 0 },
    { id: '910000000000000002', name: '鳥居', type: 0, parent_id: '910000000000000001', position: 0, topic: 'ようこそ', permission_overwrites: [] },
    { id: '910000000000000003', name: 'しきたり', type: 0, parent_id: '910000000000000001', position: 1 },
  ],
  guildRoles: async () => [],
  editChannel: async (c, b) => void actions.push(`editChannel ${c} ${b.topic ?? ''}${b.name ? ` name=${b.name}` : ''}${b.nsfw !== undefined ? ` nsfw=${b.nsfw}` : ''}`),
  setChannelOverwrite: async (c, o) => void actions.push(`overwrite ${c} ${o.id} allow=${o.allow} deny=${o.deny}`),
  pinMessage: async (c, m, pin) => void actions.push(`${pin ? 'pin' : 'unpin'} ${c} ${m}`),
};

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
  actions = [];
  app = createWebApp({ db, cfg, api: fakeApi, discord: fakeActions, baseUrl: BASE, now: () => clock });
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


describe('厄・BAN・キック・メモ（管理画面）', () => {
  async function csrfOf(session: string): Promise<string> {
    const html = await (await get('/', session)).text();
    return /name="_csrf" value="([^"]+)"/.exec(html)![1]!;
  }
  const post = (path: string, session: string, form: Record<string, string>) =>
    app.request(path, {
      method: 'POST',
      headers: { cookie: `shamusho_session=${session}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });

  it('CSRF トークンがない操作は拒否', async () => {
    const s = await login(STAFF);
    const res = await post(`/members/${USER}/yaku`, s, { reason: '誹謗中傷' });
    expect(res.status).toBe(403);
    expect(await activeYakuCount(db, USER)).toBe(0);
  });

  it('厄 1 つ目 → 2 つ目は確認画面 → 確認して BAN', async () => {
    const s = await login(STAFF);
    const csrf = await csrfOf(s);
    const first = await post(`/members/${USER}/yaku`, s, { _csrf: csrf, reason: '誹謗中傷', note: '' });
    expect(first.headers.get('location')).toBe(`/members/${USER}?msg=warned`);
    expect(actions).toContain(`addRole ${USER} ${ROLE.yakudoshi}`);

    const page = await get(`/members/${USER}?msg=warned`, s);
    const html = await page.text();
    expect(html).toContain('厄を付けました（1 つ目・注意）');
    expect(html).toContain('👹 今 1 つ');

    const second = await post(`/members/${USER}/yaku`, s, { _csrf: csrf, reason: 'スパム・宣伝', note: '' });
    expect(second.status).toBe(200);
    expect(await second.text()).toContain('厄を付けて BAN する');
    expect(actions.some((a) => a.startsWith('ban'))).toBe(false);

    const confirmed = await post(`/members/${USER}/yaku`, s, { _csrf: csrf, reason: 'スパム・宣伝', note: '', confirm: 'yes' });
    expect(confirmed.headers.get('location')).toBe(`/members/${USER}?msg=banned`);
    expect(actions).toContain(`ban ${USER}`);
  });

  it('BAN の解除は宮司だけ。厄を全部祓うか 1 つ残すかを選ぶ', async () => {
    const s = await login(STAFF);
    let csrf = await csrfOf(s);
    await post(`/members/${USER}/yaku`, s, { _csrf: csrf, reason: '誹謗中傷', note: '' });
    await post(`/members/${USER}/yaku`, s, { _csrf: csrf, reason: '誹謗中傷', note: '', confirm: 'yes' });
    // 神職には解除の欄が出ない。送っても解除できない
    expect(await (await get(`/members/${USER}`, s)).text()).not.toContain('BAN を解除する');
    expect((await post(`/members/${USER}/unban`, s, { _csrf: csrf, keep: '0', note: 'x' })).headers.get('location')).toBe(`/members/${USER}?msg=unban_forbidden`);

    const g = await login(GUJI);
    const page = await (await get(`/members/${USER}`, g)).text();
    expect(page).toContain('BAN を解除する');
    csrf = await csrfOf(g);
    // 選ばない・理由なしは受け付けない
    expect((await post(`/members/${USER}/unban`, g, { _csrf: csrf, note: '反省' })).headers.get('location')).toBe(`/members/${USER}?msg=invalid`);
    const r = await post(`/members/${USER}/unban`, g, { _csrf: csrf, keep: '1', note: '反省している' });
    expect(r.headers.get('location')).toBe(`/members/${USER}?msg=unbanned`);
    expect(await activeYakuCount(db, USER)).toBe(1);
    const after = await (await get(`/members/${USER}?msg=unbanned`, g)).text();
    expect(after).toContain('BAN を解除しました');
    expect(after).not.toContain('>BAN を解除する');
  });

  it('「その他」は補足が必須・一覧にない理由は拒否', async () => {
    const s = await login(STAFF);
    const csrf = await csrfOf(s);
    expect((await post(`/members/${USER}/yaku`, s, { _csrf: csrf, reason: 'その他', note: '' })).headers.get('location')).toContain('msg=invalid');
    expect((await post(`/members/${USER}/yaku`, s, { _csrf: csrf, reason: '勝手な理由' })).headers.get('location')).toContain('msg=invalid');
    expect((await post(`/members/${USER}/yaku`, s, { _csrf: csrf, reason: 'その他', note: '通話で大声' })).headers.get('location')).toContain('msg=warned');
  });

  it('一発 BAN は確認画面を通す', async () => {
    const s = await login(STAFF);
    const csrf = await csrfOf(s);
    const ask = await post(`/members/${USER}/ban`, s, { _csrf: csrf, reason: '個人情報の晒し', note: '住所' });
    expect(await ask.text()).toContain('BAN する');
    expect(actions).toEqual([]);
    const done = await post(`/members/${USER}/ban`, s, { _csrf: csrf, reason: '個人情報の晒し', note: '住所', confirm: 'yes' });
    expect(done.headers.get('location')).toContain('msg=banned');
    expect(actions).toEqual([`dm ${USER}`, `ban ${USER}`]);
  });

  it('神職は神職に操作できない（画面にも操作欄が出ない）', async () => {
    await recordJoin(db, { id: GUJI, username: 'guji', displayName: '宮司さん', avatarUrl: null, roleIds: [ROLE.guji], isBot: false, joinedAt: null });
    const s = await login(STAFF);
    const csrf = await csrfOf(s);
    const res = await post(`/members/${GUJI}/kick`, s, { _csrf: csrf, reason: 'x' });
    expect(res.headers.get('location')).toContain('msg=denied_protected');
    const html = await (await get(`/members/${GUJI}`, s)).text();
    expect(html).not.toContain('厄を付ける</button>');
  });

  it('キック・メモ・厄の取り消し', async () => {
    const s = await login(STAFF);
    const csrf = await csrfOf(s);
    await post(`/members/${USER}/yaku`, s, { _csrf: csrf, reason: '誹謗中傷' });
    const clear = await post(`/members/${USER}/yaku/clear`, s, { _csrf: csrf, note: '間違い' });
    expect(clear.headers.get('location')).toContain('msg=cleared');
    expect(actions).toContain(`removeRole ${USER} ${ROLE.yakudoshi}`);

    const memo = await post(`/members/${USER}/memo`, s, { _csrf: csrf, body: '<b>様子見</b>' });
    expect(memo.headers.get('location')).toContain('msg=memo');
    expect((await memosOf(db, USER))[0]?.body).toBe('<b>様子見</b>');
    const html = await (await get(`/members/${USER}`, s)).text();
    expect(html).toContain('&lt;b&gt;様子見&lt;/b&gt;');

    const ask = await post(`/members/${USER}/kick`, s, { _csrf: csrf, reason: '迷惑行為' });
    expect(await ask.text()).toContain('キックする');
    const kick = await post(`/members/${USER}/kick`, s, { _csrf: csrf, reason: '迷惑行為', confirm: 'yes' });
    expect(kick.headers.get('location')).toContain('msg=kicked');
  });

  it('厄の一覧ページとホームの数字', async () => {
    const s = await login(STAFF);
    const csrf = await csrfOf(s);
    await post(`/members/${USER}/yaku`, s, { _csrf: csrf, reason: '誹謗中傷' });
    const list = await (await get('/yaku', s)).text();
    expect(list).toContain('さくら&lt;script&gt;');
    const home = await (await get('/', s)).text();
    expect(home).toMatch(/厄が付いている方<\/div><div class="value">1/);
  });

  it('花びらが表示される', async () => {
    await addCoins(db, USER, 77, 'adjust');
    const s = await login(STAFF);
    const html = await (await get(`/members/${USER}`, s)).text();
    expect(html).toContain('77');
    expect(html).toContain('花びらの出入り');
  });
});

describe('申請・お参り期間・相談・設定（管理画面）', () => {
  async function csrfOf(session: string): Promise<string> {
    const html = await (await get('/', session)).text();
    return /name="_csrf" value="([^"]+)"/.exec(html)![1]!;
  }
  const post = (path: string, session: string, form: Record<string, string>) =>
    app.request(path, {
      method: 'POST',
      headers: { cookie: `shamusho_session=${session}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
  const NEWBIE = '700000000000000020';

  async function pendingApplication(): Promise<number> {
    const { submitApplication } = await import('../src/services/applications.js');
    await recordJoin(db, { id: NEWBIE, username: 'newbie', displayName: 'しんじん', avatarUrl: null, roleIds: [], isBot: false, joinedAt: null });
    const r = await submitApplication(db, { memberId: NEWBIE, kind: 'join', answers: { name: 'しんじん', age: 'minor', purpose: '雑談', message: '' } });
    return (r as { id: number }).id;
  }

  it('申請の一覧 → 承認', async () => {
    const id = await pendingApplication();
    const s = await login(STAFF);
    const html = await (await get('/applications', s)).text();
    expect(html).toContain('しんじん');
    expect(html).toContain('13〜17 歳');
    const res = await post(`/applications/${id}/decide`, s, { _csrf: await csrfOf(s), approve: 'yes', note: '' });
    expect(res.headers.get('location')).toBe('/applications?msg=approved');
    expect(actions).toContain(`addRole ${NEWBIE} ${ROLE.sanpaisha}`);
    const again = await post(`/applications/${id}/decide`, s, { _csrf: await csrfOf(s), approve: 'no' });
    expect(again.headers.get('location')).toBe('/applications?msg=already_decided');
    // お参り期間の一覧
    expect(await (await get('/omairi', s)).text()).toContain('しんじん');
    // 退出は確認画面を通す
    const ask = await post(`/omairi/${NEWBIE}`, s, { _csrf: await csrfOf(s), action: 'remove' });
    expect(await ask.text()).toContain('退出にする');
    expect(actions).not.toContain(`kick ${NEWBIE}`);
    const done = await post(`/omairi/${NEWBIE}`, s, { _csrf: await csrfOf(s), action: 'remove', confirm: 'yes' });
    expect(done.headers.get('location')).toBe('/omairi?msg=omairi_ok');
    expect(actions).toContain(`kick ${NEWBIE}`);
  });

  it('ホームに対応待ちが出る', async () => {
    await pendingApplication();
    const s = await login(STAFF);
    const html = await (await get('/', s)).text();
    expect(html).toMatch(/申請（入鯖・宵参り）<\/span><strong>1 件/);
  });

  it('相談: 神職は送った人を見られない・宮司は理由を書いて確認できる', async () => {
    const { createSoudan } = await import('../src/services/soudan.js');
    const id = await createSoudan(db, USER, 'こまっています');
    const s = await login(STAFF);
    const list = await (await get('/soudan', s)).text();
    expect(list).toContain('こまっています');
    const page = await (await get(`/soudan/${id}`, s)).text();
    expect(page).toContain('相談した人（匿名）');
    expect(page).not.toContain('相談した人を確認');
    expect(page).not.toContain(USER);

    const reply = await post(`/soudan/${id}/reply`, s, { _csrf: await csrfOf(s), body: '大丈夫ですか' });
    expect(reply.headers.get('location')).toBe(`/soudan/${id}?msg=replied`);
    expect(actions).toContain(`dm ${USER}`);
    const forbidden = await post(`/soudan/${id}/reveal`, s, { _csrf: await csrfOf(s), reason: 'x' });
    expect(forbidden.headers.get('location')).toBe(`/soudan/${id}?msg=forbidden`);

    const g = await login(GUJI);
    const gpage = await (await get(`/soudan/${id}`, g)).text();
    expect(gpage).toContain('相談した人を確認');
    const revealed = await (await post(`/soudan/${id}/reveal`, g, { _csrf: await csrfOf(g), reason: '身の危険' })).text();
    expect(revealed).toContain(`/members/${USER}`);
    // 確認したことは記録に残るが、相談した人（相手）は記録に残さない（神職も記録を見られるため）
    const [row] = await listAudit(db, { action: 'soudan.reveal' });
    expect(row?.targetId).toBeNull();
    expect(await (await get('/audit', s)).text()).not.toContain('さくら');
  });

  it('設定は宮司だけ。保存すると反映され、記録に残る', async () => {
    const s = await login(STAFF);
    expect((await get('/settings', s)).status).toBe(403);
    expect(await (await get('/', s)).text()).not.toContain('href="/settings"');

    // 設定の読み直しを確かめるため、ConfigStore を使うアプリで試す
    const { ConfigStore } = await import('../src/services/settings.js');
    const store = new ConfigStore(db, cfg);
    app = createWebApp({ db, cfg: () => store.current, fileCfg: cfg, onSettingsSaved: () => store.refresh(), api: fakeApi, discord: fakeActions, baseUrl: BASE, now: () => clock });
    const g = await login(GUJI);
    const page = await (await get('/settings', g)).text();
    expect(page).toContain('免罪符の値段');
    const form: Record<string, string> = {
      _csrf: await csrfOf(g),
      currencyName: '花びら',
      currencyEmoji: '🌸',
      menzaifuPrice: '800',
      menzaifuMaxUses: '1',
      voicePer10Min: '5',
      voiceDailyCap: '150',
      shuinGive: '3',
      shuinReceive: '5',
      omikujiBase: '10',
      joinBonus: '3000',
      giftMin: '10',
      giftMax: '1000',
      giftDailyLimit: '1000',
      boostThanks: '1500',
      boostDiscountPercent: '20',
      coreTimePercent: '150',
      'ct.5.start': '21:00',
      'ct.5.end': '23:00',
      ctNoticeDayBefore: '21:00',
      ctNoticeMinutesBefore: '60',
      omairiDays: '14',
      omairiExtendDays: '7',
      autoApproveAccountDays: '0',
      kickOnReject: 'yes',
    };
    for (const r of cfg.ranks) {
      form[`rank.${r.key}.weight`] = String(r.weight);
      if (r.auto) form[`rank.${r.key}.requiredGoen`] = String(r.requiredGoen);
    }
    const res = await post('/settings', g, form);
    expect(res.headers.get('location')).toBe('/settings?msg=saved');
    expect(store.current.economy.menzaifuPrice).toBe(800);
    expect((await listAudit(db, { action: 'settings.update' }))[0]?.detail).toMatchObject({ economy: { menzaifuPrice: [300, 800] } });

    // おかしな値（昇格ラインが重複）は保存しない
    const bad = await post('/settings', g, { ...form, _csrf: await csrfOf(g), 'rank.ujiko.requiredGoen': '100' });
    expect(bad.headers.get('location')).toBe('/settings?msg=settings_invalid');
    expect(store.current.ranks.find((r) => r.key === 'ujiko')?.requiredGoen).toBe(20);

    const reset = await post('/settings/reset', g, { _csrf: await csrfOf(g) });
    expect(reset.headers.get('location')).toBe('/settings?msg=saved');
    expect(store.current.economy.menzaifuPrice).toBe(300);
  });

  it('年齢区分の変更は宮司だけ', async () => {
    const s = await login(STAFF);
    const res = await post(`/members/${USER}/age`, s, { _csrf: await csrfOf(s), age: 'adult' });
    expect(res.headers.get('location')).toBe(`/members/${USER}?msg=forbidden`);
    const g = await login(GUJI);
    const ok = await post(`/members/${USER}/age`, g, { _csrf: await csrfOf(g), age: 'adult' });
    expect(ok.headers.get('location')).toBe(`/members/${USER}?msg=age_changed`);
    expect(await (await get(`/members/${USER}?msg=age_changed`, g)).text()).toContain('年齢区分を変更しました');
  });

  it('掲示は宮司だけ。標準の文面を入れて投稿し、編集して反映できる', async () => {
    const s = await login(STAFF);
    expect((await get('/notices', s)).status).toBe(403);
    expect((await post('/notices/seed', s, { _csrf: await csrfOf(s) })).status).toBe(403);
    expect(await (await get('/', s)).text()).not.toContain('href="/notices"');

    const g = await login(GUJI);
    expect(await (await get('/notices', g)).text()).toContain('標準の文面を入れる');
    const seeded = await post('/notices/seed', g, { _csrf: await csrfOf(g) });
    expect(seeded.headers.get('location')).toBe('/notices?msg=seeded');
    const page = await (await get('/notices', g)).text();
    expect(page).toContain('#しきたり');
    expect(page).toContain('未反映の 6 件をすべて反映');
    // プレビューは差し込み済み（{#しきたり} → #しきたり、{免罪符の値段} → 300）
    expect(page).toContain('1. #しきたり を読む');
    expect(page).toContain('300 枚・1 人 1 回まで');

    const all = await post('/notices/publish-all', g, { _csrf: await csrfOf(g) });
    expect(all.headers.get('location')).toBe('/notices?msg=published_all');
    expect(actions.filter((a) => a.startsWith('send 910000000000000003'))).toHaveLength(5);
    expect(actions.find((a) => a.startsWith('send 910000000000000002'))).toContain('<#910000000000000003>');

    const [first] = await listNotices(db);
    const edit = await (await get(`/notices/${first!.id}`, g)).text();
    expect(edit).toContain('差し込める値');
    const preview = await (await post('/notices/preview', g, { _csrf: await csrfOf(g), body: '値段 {免罪符の値段} {なぞ}' })).text();
    expect(preview).toContain('値段 300');
    expect(preview).toContain('置き換えられない名前');
    actions = [];
    const saved = await post(`/notices/${first!.id}`, g, { _csrf: await csrfOf(g), title: 'ようこそ', body: 'ようこそ！', then: 'publish' });
    expect(saved.headers.get('location')).toBe('/notices?msg=edited');
    expect(actions).toEqual([`edit ${first!.messageId} ようこそ！`]);

    const del = await post(`/notices/${first!.id}/delete`, g, { _csrf: await csrfOf(g) });
    expect(del.headers.get('location')).toBe('/notices?msg=deleted');
    expect(actions).toContain(`delete ${first!.messageId}`);
    expect((await listAudit(db)).map((a) => a.action)).toEqual(expect.arrayContaining(['notice.create', 'notice.publish', 'notice.update', 'notice.delete']));
  });

  it('設定で免罪符の値段を変えると、投稿済みの掲示も書き換わる', async () => {
    const { ConfigStore } = await import('../src/services/settings.js');
    const store = new ConfigStore(db, cfg);
    app = createWebApp({ db, cfg: () => store.current, fileCfg: cfg, onSettingsSaved: () => store.refresh(), api: fakeApi, discord: fakeActions, baseUrl: BASE, now: () => clock });
    const g = await login(GUJI);
    await post('/notices', g, { _csrf: await csrfOf(g), channelId: '910000000000000003', title: '値段', body: '免罪符は {免罪符の値段} 枚', then: 'publish' });
    expect(actions.at(-1)).toBe('send 910000000000000003 免罪符は 300 枚');

    const form: Record<string, string> = {
      _csrf: await csrfOf(g),
      currencyName: '花びら',
      currencyEmoji: '🌸',
      menzaifuPrice: '800',
      menzaifuMaxUses: '1',
      voicePer10Min: '5',
      voiceDailyCap: '150',
      shuinGive: '3',
      shuinReceive: '5',
      omikujiBase: '10',
      joinBonus: '3000',
      giftMin: '10',
      giftMax: '1000',
      giftDailyLimit: '1000',
      boostThanks: '1500',
      boostDiscountPercent: '20',
      coreTimePercent: '150',
      'ct.5.start': '21:00',
      'ct.5.end': '23:00',
      ctNoticeDayBefore: '21:00',
      ctNoticeMinutesBefore: '60',
      omairiDays: '14',
      omairiExtendDays: '7',
      autoApproveAccountDays: '0',
      kickOnReject: 'yes',
    };
    for (const r of cfg.ranks) {
      form[`rank.${r.key}.weight`] = String(r.weight);
      if (r.auto) form[`rank.${r.key}.requiredGoen`] = String(r.requiredGoen);
    }
    const res = await post('/settings', g, form);
    expect(res.headers.get('location')).toBe('/settings?msg=saved_notices');
    expect(actions.at(-1)).toMatch(/^edit m\d+ 免罪符は 800 枚$/);
  });
});

describe('管理画面の守り', () => {
  it('ログイン後のページはブラウザに残さない（Cache-Control: no-store）', async () => {
    const s = await login(STAFF);
    const res = await get('/members', s);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('vary')).toContain('HX-Request');
    expect((await app.request('/static/style.css')).headers.get('cache-control')).toContain('max-age');
  });

  it('おかしな名前（__proto__ など）でエラーにならない', async () => {
    expect((await app.request('/static/__proto__')).status).toBe(404);
    expect((await app.request('/static/constructor')).status).toBe(404);
    expect((await app.request('/login?e=constructor')).status).toBe(200);
  });

  it('入れない人が何度ログインしても、記録は 1 時間に 1 回だけ', async () => {
    for (let i = 0; i < 3; i++) {
      loginAs = USER;
      const start = await app.request('/auth/discord');
      const state = cookiesFrom(start).shamusho_state!;
      await app.request(`/auth/callback?code=good&state=${state}`, { headers: { cookie: `shamusho_state=${state}` } });
    }
    expect(await listAudit(db, { action: 'auth.denied' })).toHaveLength(1);
  });

  it('Discord が混んでいてロールを確かめ直せなくても、30 分以内に確かめていれば使える', async () => {
    const s = await login(STAFF);
    const memberRoles = fakeApi.memberRoles;
    fakeApi.memberRoles = async () => {
      throw new Error('guild member lookup failed: 429');
    };
    try {
      clock = new Date(clock.getTime() + 10 * 60_000);
      expect((await get('/', s)).status).toBe(200);
      clock = new Date(clock.getTime() + 60 * 60_000);
      expect((await get('/', s)).status).toBe(503);
    } finally {
      fakeApi.memberRoles = memberRoles;
    }
  });
});

describe('初期配布（管理画面）', () => {
  it('今いる人に配るのは宮司だけ。確認なしでは配らない', async () => {
    const { walletOf } = await import('../src/services/economy.js');
    const s = await login(STAFF);
    const csrf = async (session: string) => /name="_csrf" value="([^"]+)"/.exec(await (await get('/', session)).text())![1]!;
    const post = async (session: string, form: Record<string, string>) =>
      app.request('/settings/join-bonus-all', {
        method: 'POST',
        headers: { cookie: `shamusho_session=${session}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ _csrf: await csrf(session), ...form }).toString(),
      });
    expect((await post(s, { confirm: 'yes' })).status).toBe(403);
    const g = await login(GUJI);
    expect((await post(g, {})).headers.get('location')).toBe('/settings');
    expect((await walletOf(db, USER)).balance).toBe(0);
    expect((await post(g, { confirm: 'yes' })).headers.get('location')).toBe('/settings?msg=bonus_given');
    expect((await walletOf(db, USER)).balance).toBe(cfg.economy.joinBonus);
    await post(g, { confirm: 'yes' });
    expect((await walletOf(db, USER)).balance).toBe(cfg.economy.joinBonus);
  });
});

describe('運営から花びらを送る（管理画面）', () => {
  const post = async (session: string, path: string, form: Record<string, string>) => {
    const csrf = /name="_csrf" value="([^"]+)"/.exec(await (await get('/', session)).text())![1]!;
    return app.request(path, {
      method: 'POST',
      headers: { cookie: `shamusho_session=${session}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, ...form }).toString(),
    });
  };
  const nonceOn = async (session: string, path: string) => /name="nonce" value="([^"]+)"/.exec(await (await get(path, session)).text())?.[1];

  it('宮司だけが送れる。DM で知らせ、二度押ししても 1 回だけ', async () => {
    const { walletOf, recentCoinTx } = await import('../src/services/economy.js');
    const s = await login(STAFF);
    expect(await nonceOn(s, `/members/${USER}`)).toBeUndefined();
    const fake = '11111111-2222-3333-4444-555555555555';
    expect((await post(s, `/members/${USER}/coins`, { mode: 'grant', amount: '500', note: 'お礼', nonce: fake })).headers.get('location')).toBe(
      `/members/${USER}?msg=coins_forbidden`,
    );
    expect((await walletOf(db, USER)).balance).toBe(0);

    const g = await login(GUJI);
    const nonce = (await nonceOn(g, `/members/${USER}`))!;
    const form = { mode: 'grant', amount: '500', note: 'イベントのお礼', dm: 'yes', nonce };
    expect((await post(g, `/members/${USER}/coins`, form)).headers.get('location')).toBe(`/members/${USER}?msg=coins_given`);
    expect((await walletOf(db, USER)).balance).toBe(500);
    expect(actions).toContain(`dm ${USER}`);
    expect((await post(g, `/members/${USER}/coins`, form)).headers.get('location')).toBe(`/members/${USER}?msg=coins_dup`);
    expect((await walletOf(db, USER)).balance).toBe(500);
    expect((await recentCoinTx(db, USER))[0]).toMatchObject({ reason: 'admin_grant', amount: 500, detail: { note: 'イベントのお礼', by: GUJI } });
    expect((await listAudit(db, { action: 'coins.grant' })).length).toBe(1);
    expect(await (await get(`/members/${USER}`, g)).text()).toContain('イベントのお礼');
  });

  it('減らすときは残高までしか減らさない。枚数・理由がおかしければ何もしない', async () => {
    const { walletOf } = await import('../src/services/economy.js');
    await addCoins(db, USER, 300, 'voice');
    const g = await login(GUJI);
    const bad = async (form: Record<string, string>) =>
      (await post(g, `/members/${USER}/coins`, { mode: 'grant', nonce: (await nonceOn(g, `/members/${USER}`))!, ...form })).headers.get('location');
    expect(await bad({ amount: '0', note: 'x' })).toBe(`/members/${USER}?msg=coins_invalid`);
    expect(await bad({ amount: '100001', note: 'x' })).toBe(`/members/${USER}?msg=coins_invalid`);
    expect(await bad({ amount: '1.5', note: 'x' })).toBe(`/members/${USER}?msg=coins_invalid`);
    expect(await bad({ amount: '10', note: '' })).toBe(`/members/${USER}?msg=coins_invalid`);
    expect(await bad({ amount: '10', note: 'x', nonce: 'nope' })).toBe(`/members/${USER}?msg=coins_invalid`);
    expect((await walletOf(db, USER)).balance).toBe(300);

    const r = await post(g, `/members/${USER}/coins`, { mode: 'take', amount: '1000', note: '送りすぎ', nonce: (await nonceOn(g, `/members/${USER}`))! });
    expect(r.headers.get('location')).toBe(`/members/${USER}?msg=coins_taken_short`);
    expect((await walletOf(db, USER)).balance).toBe(0);
    expect(actions.filter((a) => a.startsWith('dm'))).toEqual([]);
  });

  it('今いる人みんなに送る（宮司のみ・確認が要る・二度押しで 2 回送らない）', async () => {
    const { walletOf } = await import('../src/services/economy.js');
    const s = await login(STAFF);
    expect((await post(s, '/settings/coins-all', { amount: '100', note: 'お詫び', confirm: 'yes', nonce: '11111111-2222-3333-4444-555555555555' })).status).toBe(403);
    const g = await login(GUJI);
    const nonce = (await nonceOn(g, '/settings'))!;
    expect((await post(g, '/settings/coins-all', { amount: '100', note: 'お詫び', nonce })).headers.get('location')).toBe('/settings?msg=coins_invalid');
    const form = { amount: '100', note: 'お詫び', confirm: 'yes', nonce };
    expect((await post(g, '/settings/coins-all', form)).headers.get('location')).toBe('/settings?msg=coins_all_given');
    expect((await walletOf(db, USER)).balance).toBe(100);
    expect((await post(g, '/settings/coins-all', form)).headers.get('location')).toBe('/settings?msg=coins_dup');
    expect((await walletOf(db, USER)).balance).toBe(100);
    expect((await listAudit(db, { action: 'coins.grant_all' }))[0]?.detail).toMatchObject({ amount: 100, count: 1 });
  });
});

describe('ショップ（管理画面）', () => {
  const form = async (session: string, path: string, data: Record<string, string>) => {
    const csrf = /name="_csrf" value="([^"]+)"/.exec(await (await get('/', session)).text())![1]!;
    return app.request(path, {
      method: 'POST',
      headers: { cookie: `shamusho_session=${session}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, ...data }).toString(),
    });
  };

  it('宮司だけが開けて、品物の値段・販売のオン／オフを変えられる', async () => {
    const { seedDefaultItems, listItems } = await import('../src/services/shop.js');
    await seedDefaultItems(db, { colors: [{ roleId: '960000000000000001', name: '桜', emoji: '🌸' }], titles: [] });
    const s = await login(STAFF);
    expect((await get('/shop', s)).status).toBe(403);
    const [sakura] = await listItems(db);
    expect((await form(s, `/shop/items/${sakura!.id}`, { name: 'x', price: '1' })).status).toBe(403);

    const g = await login(GUJI);
    const page = await (await get('/shop', g)).text();
    expect(page).toContain('色守り（桜）');
    expect(page).toContain('花吹雪');
    const r = await form(g, `/shop/items/${sakura!.id}`, { name: '色守り（桜）', emoji: '🌸', description: 'きれい', price: '1200', durationDays: '14', position: '1' });
    expect(r.headers.get('location')).toBe('/shop?msg=saved');
    const after = (await listItems(db)).find((i) => i.id === sakura!.id)!;
    expect(after).toMatchObject({ price: 1200, durationDays: 14, enabled: false, description: 'きれい' });
    expect((await form(g, `/shop/items/${sakura!.id}`, { name: '', price: '1' })).headers.get('location')).toBe('/shop?msg=invalid');
    expect((await form(g, `/shop/items/${sakura!.id}`, { name: 'a', price: '-5' })).headers.get('location')).toBe('/shop?msg=invalid');
    expect((await listAudit(db, { action: 'shop.update' })).length).toBe(1);
  });

  it('決まった動きの品物（花吹雪など）は消せない', async () => {
    const { seedDefaultItems, listItems } = await import('../src/services/shop.js');
    await seedDefaultItems(db, { colors: [], titles: [] });
    const g = await login(GUJI);
    const hana = (await listItems(db)).find((i) => i.kind === 'hanafubuki')!;
    await form(g, `/shop/items/${hana.id}/delete`, { confirm: 'yes' });
    expect((await listItems(db)).some((i) => i.id === hana.id)).toBe(true);
  });
});

describe('チャンネル（管理画面）', () => {
  const TORII = '910000000000000002';
  const form = async (session: string, path: string, data: Record<string, string>) => {
    const csrf = /name="_csrf" value="([^"]+)"/.exec(await (await get('/', session)).text())![1]!;
    return app.request(path, {
      method: 'POST',
      headers: { cookie: `shamusho_session=${session}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, ...data }).toString(),
    });
  };

  it('宮司だけが開ける', async () => {
    const s = await login(STAFF);
    expect((await get('/channels', s)).status).toBe(403);
    expect((await form(s, `/channels/${TORII}`, { topic: 'x', mode: 'readonly' })).status).toBe(403);
    expect(actions.filter((a) => a.startsWith('editChannel') || a.startsWith('overwrite'))).toEqual([]);
    const g = await login(GUJI);
    const page = await (await get('/channels', g)).text();
    expect(page).toContain('#鳥居');
    expect(page).toContain('ようこそ');
  });

  it('説明を変えて、読むだけにできる', async () => {
    const g = await login(GUJI);
    const r = await form(g, `/channels/${TORII}`, { topic: '最初に読んでね', mode: 'readonly' });
    expect(r.headers.get('location')).toBe('/channels?msg=saved');
    expect(actions).toContain(`editChannel ${TORII} 最初に読んでね`);
    // みんな（@everyone）の書き込みを止める。リアクションは止めない
    const ow = actions.find((a) => a.startsWith(`overwrite ${TORII} ${cfg.guildId}`))!;
    const deny = BigInt(/deny=(\d+)/.exec(ow)![1]!);
    expect(deny & (1n << 11n)).not.toBe(0n);
    expect(deny & (1n << 6n)).toBe(0n);
    expect((await listAudit(db, { action: 'channel.update' })).length).toBe(1);
  });

  it('何も変わらなければ Discord に送らない。おかしな入力は受けない', async () => {
    const g = await login(GUJI);
    expect((await form(g, `/channels/${TORII}`, { topic: 'ようこそ', mode: 'writable' })).headers.get('location')).toBe('/channels?msg=unchanged');
    expect((await form(g, `/channels/${TORII}`, { topic: 'x'.repeat(1025), mode: 'writable' })).headers.get('location')).toBe('/channels?msg=invalid');
    expect((await form(g, `/channels/${TORII}`, { topic: 'x', mode: 'nope' })).headers.get('location')).toBe('/channels?msg=invalid');
    expect(actions.filter((a) => a.startsWith('editChannel') || a.startsWith('overwrite'))).toEqual([]);
  });

  it('名前を変えられる（チャンネル・カテゴリ）。空の名前は受けない', async () => {
    const g = await login(GUJI);
    const r = await form(g, `/channels/${TORII}`, { name: '⛩｜鳥居', topic: 'ようこそ', mode: 'writable' });
    expect(r.headers.get('location')).toBe('/channels?msg=saved');
    expect(actions).toContain(`editChannel ${TORII}  name=⛩｜鳥居`);
    expect((await form(g, `/channels/${TORII}`, { name: '  ', topic: 'ようこそ', mode: 'writable' })).headers.get('location')).toBe('/channels?msg=invalid');
    const CAT = '910000000000000001';
    expect((await form(g, `/channels/${CAT}/name`, { name: '⛩ 鳥居 ⛩' })).headers.get('location')).toBe('/channels?msg=saved');
    expect(actions).toContain(`editChannel ${CAT}  name=⛩ 鳥居 ⛩`);
    expect((await form(g, `/channels/${CAT}/name`, { name: '⛩ 鳥居' })).headers.get('location')).toBe('/channels?msg=unchanged');
    expect((await form(g, `/channels/${CAT}/name`, { name: '' })).headers.get('location')).toBe('/channels?msg=invalid');
    const s2 = await login(STAFF);
    expect((await form(s2, `/channels/${CAT}/name`, { name: 'x' })).status).toBe(403);
    expect((await listAudit(db, { action: 'channel.update' })).length).toBe(2);
  });

  it('Discord の年齢制限を付け外しできる（チェックがあるフォームのときだけ）', async () => {
    const g = await login(GUJI);
    await form(g, `/channels/${TORII}`, { topic: 'ようこそ', mode: 'writable', nsfwField: '1', nsfw: 'yes' });
    expect(actions).toContain(`editChannel ${TORII}  nsfw=true`);
    actions.length = 0;
    await form(g, `/channels/${TORII}`, { topic: 'ようこそ', mode: 'writable' });
    expect(actions.filter((a) => a.startsWith('editChannel'))).toEqual([]);
  });

  it('コアタイムの設定が設定ページに出る', async () => {
    const g = await login(GUJI);
    const page = await (await get('/settings', g)).text();
    expect(page).toContain('コアタイム');
    expect(page).toMatch(/name="ct\.5\.start" value="21:00"/);
  });

  it('掲示: チャンネルの案内を入れる・ピン留めを選べる', async () => {
    const g = await login(GUJI);
    expect((await form(g, '/notices/seed-guides', {})).headers.get('location')).toBe('/notices?msg=guides_missing');
    expect((await listNotices(db)).map((n) => n.title)).toEqual(['チャンネル案内']);
    const r = await form(g, '/notices', { channelId: TORII, title: '使い方', body: 'ここは入口', pinned: 'yes', then: 'publish' });
    expect(r.headers.get('location')).toBe('/notices?msg=posted');
    expect(actions.some((a) => a.startsWith(`pin ${TORII}`))).toBe(true);
    const n = (await listNotices(db)).find((x) => x.title === '使い方')!;
    await form(g, `/notices/${n.id}`, { title: '使い方', body: 'ここは入口', then: 'publish' });
    expect(actions.some((a) => a.startsWith(`unpin ${TORII}`))).toBe(true);
  });
});

describe('推移（管理画面）', () => {
  it('神職も見られる。グラフと表が出て、知らない期間は 30 日になる', async () => {
    const s = await login(STAFF);
    const page = await (await get('/stats?range=1y', s)).text();
    expect(page).toContain('<svg');
    expect(page).toContain('サーバーにいる人数');
    expect(page).toContain('表で見る');
    const fallback = await (await get('/stats?range=zzz', s)).text();
    expect(fallback).toContain('aria-current="page"');
    expect(fallback).toMatch(/aria-current="page"[^>]*>30 日/);
    expect((await app.request('/stats')).status).toBe(302);
  });

  it('ホームのいちばん上に、30 日の人数のグラフが出る', async () => {
    const s = await login(STAFF);
    const home = await (await get('/', s)).text();
    expect(home.indexOf('メンバーの推移')).toBeGreaterThan(-1);
    expect(home.indexOf('メンバーの推移')).toBeLessThan(home.indexOf('class="stats"'));
    expect(home).toContain('<svg');
  });
});

describe('CSS・JS の読み込み', () => {
  it('URL に中身の印が付き、更新すると別の URL になる（古い CSS を使い続けない）', async () => {
    const page = await (await app.request('/login')).text();
    const href = /href="(\/static\/style\.css\?v=[0-9a-f]{10})"/.exec(page)?.[1];
    expect(href).toBeDefined();
    const res = await app.request(href!);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(await res.text()).toContain('--series-1');
    // 印なし・古い印は長く覚えさせない
    expect((await app.request('/static/style.css')).headers.get('cache-control')).toBe('public, max-age=300');
    expect((await app.request('/static/style.css?v=0000000000')).headers.get('cache-control')).toBe('public, max-age=300');
  });
});

describe('更新履歴（管理画面）', () => {
  it('まだ読んでいない数がメニューに出て、開くと消える。ホームにも最近の更新', async () => {
    const { CHANGELOG } = await import('../src/changelog.js');
    const s = await login(STAFF);
    const home = await (await get('/', s)).text();
    expect(home).toContain(`新しい更新 ${CHANGELOG.length} 件`);
    expect(home).toContain('最近の更新');
    expect(home).toContain(CHANGELOG[0]!.title);
    const page = await (await get('/updates', s)).text();
    expect(page).toContain(CHANGELOG.at(-1)!.title);
    expect(page).toContain('NEW');
    expect(page).not.toContain('新しい更新 ');
    const again = await (await get('/', s)).text();
    expect(again).not.toContain('新しい更新 ');
    expect(await (await get('/updates', s)).text()).not.toContain('>NEW<');
  });
});

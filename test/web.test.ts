import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { listAudit } from '../src/services/audit.js';
import { recordJoin } from '../src/services/members.js';
import type { DiscordApi } from '../src/web/discordApi.js';
import type { DiscordActions, MessageBody } from '../src/lib/discordRest.js';
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
/** 偽の Discord のロール一覧 */
let roleList: import('../src/lib/discordRest.js').GuildRole[] = [];
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
    { id: '910000000000000004', name: '拝殿', type: 2, parent_id: '910000000000000001', position: 2, user_limit: 0 },
  ],
  guildRoles: async () => roleList,
  editRole: async (_g, r, b) => void actions.push(`editRole ${r} ${JSON.stringify(b)}`),
  editChannel: async (c, b) =>
    void actions.push(
      `editChannel ${c} ${b.topic ?? ''}${b.name ? ` name=${b.name}` : ''}${b.nsfw !== undefined ? ` nsfw=${b.nsfw}` : ''}${b.user_limit !== undefined ? ` limit=${b.user_limit}` : ''}`,
    ),
  setChannelOverwrite: async (c, o) => void actions.push(`overwrite ${c} ${o.id} allow=${o.allow} deny=${o.deny}`),
  pinMessage: async (c, m, pin) => void actions.push(`${pin ? 'pin' : 'unpin'} ${c} ${m}`),
  createChannel: async (_g, b) => (
    actions.push(`createChannel ${JSON.stringify(b)}`), { id: '910000000000000099', name: b.name, type: b.type, parent_id: b.parent_id ?? null, position: 9 }
  ),
  deleteChannel: async (c) => void actions.push(`deleteChannel ${c}`),
  reorderChannels: async (_g, list) => void actions.push(`reorder ${JSON.stringify(list)}`),
  createRole: async (_g, b) => (actions.push(`createRole ${JSON.stringify(b)}`), { id: '980000000000000099', name: b.name ?? '', position: 1, managed: false, color: b.color ?? 0 }),
  deleteRole: async (_g, r) => void actions.push(`deleteRole ${r}`),
  setNickname: async (_g, u, nick) => void actions.push(`nick ${u} ${nick}`),
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
    for (const p of ['/', '/members', `/members/${USER}`, '/audit', '/gacha', '/interview']) {
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

  it('銭が表示される', async () => {
    await addCoins(db, USER, 77, 'adjust');
    const s = await login(STAFF);
    const html = await (await get(`/members/${USER}`, s)).text();
    expect(html).toContain('77');
    expect(html).toContain('銭の出入り');
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

  it('🎴 運営吉: 宮司が名前・確率・絵を入れる（途中の枠は空にできない）→ 絵を消せる', async () => {
    const { ConfigStore } = await import('../src/services/settings.js');
    const { omikujiArtHashes, loadOmikujiArt } = await import('../src/services/omikujiArt.js');
    const store = new ConfigStore(db, cfg);
    app = createWebApp({ db, cfg: () => store.current, fileCfg: cfg, onSettingsSaved: () => store.refresh(), api: fakeApi, discord: fakeActions, baseUrl: BASE, now: () => clock });
    const s = await login(STAFF);
    expect((await get('/settings/omikuji-art/1', s)).status).toBe(404);
    const g = await login(GUJI);
    const page = await (await get('/settings', g)).text();
    expect(page).toContain('id="sec-unei"');
    expect(page).toContain('action="/settings/omikuji-special"');
    expect(page).toContain('name="img.1"');
    const csrf = await csrfOf(g);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    const send = (fields: Record<string, string>, files: Record<string, Uint8Array | string> = {}) => {
      const fd = new FormData();
      fd.append('_csrf', csrf);
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      for (const [k, v] of Object.entries(files)) fd.append(k, new File([v], 'a.png', { type: 'image/png' }));
      return app.request('/settings/omikuji-special', { method: 'POST', headers: { cookie: `shamusho_session=${g}` }, body: fd });
    };
    const base = { enabled: 'yes', percent: '0.5', mult: '5', 'name.1': '小林吉', 'message.1': '今日はいい日', 'name.2': 'ais吉', 'message.2': '' };
    expect((await send({ ...base, 'name.2': '', 'name.3': '三' })).headers.get('location')).toBe('/settings?msg=unei_gap&at=unei#sec-unei');
    expect((await send({ ...base, percent: '' })).headers.get('location')).toBe('/settings?msg=unei_invalid&at=unei#sec-unei');
    expect((await send(base, { 'img.1': png, 'img.2': '<svg/>' })).headers.get('location')).toBe('/settings?msg=unei_partial&at=unei#sec-unei');
    expect(store.current.omikujiSpecial).toEqual({ enabled: true, percent: 0.5, mult: 5, mode: 'fixed', everyDays: 30, minPercent: 0.01, maxPercent: 1, list: [{ name: '小林吉', message: '今日はいい日' }, { name: 'ais吉', message: '' }] });
    // 出したい間隔で決める（30 日の平均回数から計算した今の確率が出る）
    expect((await send({ ...base, mode: 'interval', everyDays: '14', minPercent: '0.02', maxPercent: '0.8' })).headers.get('location')).toBe('/settings?msg=unei_saved&at=unei#sec-unei');
    expect(store.current.omikujiSpecial).toMatchObject({ mode: 'interval', everyDays: 14, minPercent: 0.02, maxPercent: 0.8 });
    expect(await (await get('/settings', g)).text()).toContain('いまの確率 <strong>0.8%</strong>');
    expect(Object.keys(await omikujiArtHashes(db))).toEqual(['1']);
    expect((await loadOmikujiArt(db, 1))?.name).toBe('unei1.png');
    const img = await get('/settings/omikuji-art/1', g);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(png);
    expect(await (await get('/settings', g)).text()).toContain('/settings/omikuji-art/1?v=');
    // AT 機の絵の一覧には出ない
    const { artUrls } = await import('../src/services/casino/slotArt.js');
    expect(await artUrls(db)).toEqual({});
    const del = await post('/settings/omikuji-art/1/delete', g, { _csrf: csrf });
    expect(del.headers.get('location')).toBe('/settings?msg=unei_art_deleted&at=unei#sec-unei');
    expect(await omikujiArtHashes(db)).toEqual({});
  });

  it('📜 おみくじの文と紙: 1 行 1 つで保存・長い行は断る・台紙（PNG・JPEG だけ）・紙の見本・はじめの文に戻す', async () => {
    const { ConfigStore } = await import('../src/services/settings.js');
    const { slipBgHashes } = await import('../src/services/omikujiArt.js');
    const { renderSlip } = await import('../src/services/omikujiSlip.js');
    const { DEFAULT_MESSAGES } = await import('../src/omikujiTexts.js');
    const store = new ConfigStore(db, cfg);
    app = createWebApp({ db, cfg: () => store.current, fileCfg: cfg, onSettingsSaved: () => store.refresh(), api: fakeApi, discord: fakeActions, baseUrl: BASE, now: () => clock });
    const s = await login(STAFF);
    expect((await get('/settings/omikuji-preview/daikichi', s)).status).toBe(404);
    const g = await login(GUJI);
    const page = await (await get('/settings', g)).text();
    expect(page).toContain('id="sec-omikujitexts"');
    expect(page).toContain('name="msg.daikichi"');
    expect(page).toContain(DEFAULT_MESSAGES.kichi[0]);
    const csrf = await csrfOf(g);
    const send = (fields: Record<string, string>, files: Record<string, Uint8Array | string> = {}) => {
      const fd = new FormData();
      fd.append('_csrf', csrf);
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      for (const [k, v] of Object.entries(files)) fd.append(k, new File([v], 'a.png', { type: 'image/png' }));
      return app.request('/settings/omikuji-texts', { method: 'POST', headers: { cookie: `shamusho_session=${g}` }, body: fd });
    };
    const base = {
      shrine: '咲楽ノ宮',
      slip: 'yes',
      'msg.daikichi': '一つめ\r\n\r\n二つめ\n一つめ',
      'item.0.key': 'wish',
      'item.0.label': '願い事',
      'item.0.emoji': '🙏',
      'item.0.fixed': 'yes',
      'item.0.good': '叶う',
      'item.0.normal': 'まあまあ',
      'item.0.bad': '叶わない',
      'item.1.label': '金運',
      'item.1.good': '上がる',
      places: '縁側\n屋台',
    };
    expect((await send({ ...base, places: 'あ'.repeat(61) })).headers.get('location')).toBe('/settings?msg=otexts_long&at=omikujitexts#sec-omikujitexts');
    expect((await send({ ...base, 'item.1.label': '七文字の項目名' })).headers.get('location')).toBe('/settings?msg=otexts_invalid&at=omikujitexts#sec-omikujitexts');
    const real = renderSlip({ name: '吉', color: '#e0607e', message: 'a', items: [], shrine: '', date: new Date() });
    expect((await send(base, { 'bg.daikichi': real, 'bg.unei1': '<svg/>' })).headers.get('location')).toBe('/settings?msg=otexts_partial&at=omikujitexts#sec-omikujitexts');
    const t = store.current.omikujiTexts;
    expect(t.messages.daikichi).toEqual(['一つめ', '二つめ']);
    expect(t.messages.kichi).toEqual([]);
    expect(t.shake).toBe(false);
    expect(t.items.map((x) => [x.label, x.fixed])).toEqual([
      ['願い事', true],
      ['金運', false],
    ]);
    expect(t.items[1]!.key).toMatch(/^item/);
    expect(t.places).toEqual(['縁側', '屋台']);
    expect(Object.keys(await slipBgHashes(db))).toEqual(['daikichi']);
    // 紙の見本（台紙つき・運営吉）
    for (const k of ['daikichi', 'kyo', 'unei1']) {
      const img = await get(`/settings/omikuji-preview/${k}`, g);
      expect(img.headers.get('content-type')).toBe('image/png');
      expect((await img.arrayBuffer()).byteLength).toBeGreaterThan(10_000);
    }
    expect((await get('/settings/omikuji-preview/nope', g)).status).toBe(404);
    // 台紙を消す・はじめの文に戻す（神社の名前・紙の出し方はそのまま）
    expect((await post('/settings/omikuji-bg/daikichi/delete', g, { _csrf: csrf })).headers.get('location')).toBe('/settings?msg=otexts_bg_deleted&at=omikujitexts#sec-omikujitexts');
    expect(await slipBgHashes(db)).toEqual({});
    expect((await post('/settings/omikuji-texts/reset', g, { _csrf: csrf })).headers.get('location')).toBe('/settings?msg=otexts_reset&at=omikujitexts#sec-omikujitexts');
    expect(store.current.omikujiTexts.messages.daikichi).toEqual(DEFAULT_MESSAGES.daikichi);
    expect(store.current.omikujiTexts.shake).toBe(false);
    // 運営吉の色
    const fd = new FormData();
    fd.append('_csrf', csrf);
    for (const [k, v] of Object.entries({ enabled: 'yes', percent: '1', mult: '3', 'name.1': '小林吉', 'color.1': '#1f4fbf' })) fd.append(k, v);
    await app.request('/settings/omikuji-special', { method: 'POST', headers: { cookie: `shamusho_session=${g}` }, body: fd });
    expect(store.current.omikujiSpecial.list).toEqual([{ name: '小林吉', message: '', color: '#1f4fbf' }]);
    // 🧪 Discord で試す（運営のチャンネルへ）。名前のない枠はできない
    const { TRIAL_MS } = await import('../src/services/omikujiTrial.js');
    Object.assign(TRIAL_MS, { shake: 0, glow: 0, art: 0 });
    expect(await (await get('/settings', g)).text()).toContain('action="/settings/omikuji-trial/1"');
    expect((await post('/settings/omikuji-trial/2', g, { _csrf: csrf })).headers.get('location')).toBe('/settings?msg=unei_trial_noslot&at=unei#sec-unei');
    const before = actions.length;
    expect((await post('/settings/omikuji-trial/1', g, { _csrf: csrf })).headers.get('location')).toBe('/settings?msg=unei_trial&at=unei#sec-unei');
    expect(actions.slice(before)[0]).toMatch(/^send \d+ -# 🧪 運営吉の試し/);
  });

  it('🔄 今日のおみくじをリセット: 宮司だけ・チェックが要る・日が変わったら止める。引いた全員の記録と銭を戻し、記録に残す', async () => {
    const { drawOmikuji, omikujiToday } = await import('../src/services/omikuji.js');
    const { walletOf } = await import('../src/services/economy.js');
    const economy = { ...cfg.economy, omikujiBase: 10 };
    await drawOmikuji(db, economy, STAFF, clock, () => 0.5);
    await drawOmikuji(db, economy, GUJI, clock, () => 0.5);
    const s = await login(STAFF);
    expect((await post('/settings/omikuji-reset', s, { _csrf: await csrfOf(s), confirm: 'yes', date: '2026-09-25' })).status).toBe(403);
    const g = await login(GUJI);
    const page = await (await get('/settings', g)).text();
    expect(page).toContain('🔄 今日のおみくじをリセット（2026-09-25）');
    expect(page).toContain('引いた人 <strong>2 人</strong>');
    const csrf = await csrfOf(g);
    const go = async (body: Record<string, string>) => (await post('/settings/omikuji-reset', g, { _csrf: csrf, ...body })).headers.get('location');
    expect(await go({ date: '2026-09-25' })).toBe('/settings?msg=oreset_confirm&at=omikujitexts#sec-omikujitexts');
    expect(await go({ confirm: 'yes', date: '2026-09-24' })).toBe('/settings?msg=oreset_stale&at=omikujitexts#sec-omikujitexts');
    expect((await omikujiToday(db, STAFF, clock)).drawn).toBe(true);
    expect(await go({ confirm: 'yes', date: '2026-09-25' })).toBe('/settings?msg=oreset_done&at=omikujitexts#sec-omikujitexts');
    expect((await omikujiToday(db, STAFF, clock)).drawn).toBe(false);
    expect((await walletOf(db, STAFF)).balance).toBe(0);
    expect((await walletOf(db, GUJI)).balance).toBe(0);
    expect((await listAudit(db, { action: 'omikuji.reset_day' }))[0]).toMatchObject({ actorId: GUJI, detail: { date: '2026-09-25', members: 2, draws: 2 } });
    expect(await go({ confirm: 'yes', date: '2026-09-25' })).toBe('/settings?msg=oreset_none&at=omikujitexts#sec-omikujitexts');
    expect(await (await get('/settings', g)).text()).toContain('今日はまだだれも引いていません。');
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
      boostDiscountPercent: '20',
      coreTimePercent: '150',
      onboardingReward: '300',
      inviteReward: '500',
      inviteActiveReward: '20',
      inviteActiveDays: '30',
      roomBoosterDiscount: '100',
      marketFee: '10',
      marketAutoRelease: '7',
      ...Object.fromEntries(['once', 'hourly'].flatMap((p) => ['public', 'invite', 'secret', 'twoshot'].map((k) => [`room.${p}.${k}`, '0']))),
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
    // 物御籤の値（物御籤のページで変える）は、設定を保存しても残る
    const { saveOverrides, overridesSchema: os } = await import('../src/services/settings.js');
    // カジノ（カジノのページで変える）・おみくじのおまけ（フォームにないとき）も残る
    await saveOverrides(
      db,
      os.parse({
        gacha: { price: 777, enabled: false },
        casino: { slotMachines: [3, 'random'] },
        omikujiStreak: { rewards: [{ days: 5, repeat: false, coins: 9, ticket: 'none', tickets: 0 }] },
        omikujiSpecial: { enabled: true, percent: 1, mult: 3, list: [{ name: '小林吉', message: '' }] },
      }),
      GUJI,
    );
    const res = await post('/settings', g, form);
    expect(res.headers.get('location')).toBe('/settings?msg=saved');
    expect(store.current.economy.menzaifuPrice).toBe(800);
    expect(store.current.gacha).toMatchObject({ price: 777, enabled: false });
    expect(store.current.casino.slotMachines).toEqual([3, 'random']);
    expect(store.current.omikujiStreak.rewards).toEqual([{ days: 5, repeat: false, coins: 9, ticket: 'none', tickets: 0 }]);
    expect(store.current.omikujiSpecial.list.map((x) => x.name)).toEqual(['小林吉']);
    expect((await listAudit(db, { action: 'settings.update' }))[0]?.detail).toMatchObject({ economy: { menzaifuPrice: [300, 800] } });
    // おみくじの「通話中だけ」はチェックを外すと OFF
    expect(store.current.economy.omikujiVoiceOnly).toBe(false);
    await post('/settings', g, { ...form, _csrf: await csrfOf(g), omikujiVoiceOnly: 'yes' });
    expect(store.current.economy.omikujiVoiceOnly).toBe(true);

    // 項目の下の「保存する」（通話部屋の値段など）は、その項目に戻って「保存しました」を出す
    const rooms = await post('/settings', g, { ...form, _csrf: await csrfOf(g), 'room.hourly.public': '50', at: 'rooms' });
    expect(rooms.headers.get('location')).toBe('/settings?msg=saved&at=rooms#sec-rooms');
    expect(store.current.rooms.hourly.public).toBe(50);
    // 呼び鈴（知らせ先を空にすると #記録）
    const bellBody = new URLSearchParams({ ...form, _csrf: await csrfOf(g), bellChannel: '910000000000000003', bellCooldown: '3', bellMention: 'yes' });
    bellBody.append('bellRoles', ROLE.shinshoku);
    bellBody.append('bellRoles', ROLE.sewayaku);
    bellBody.append('bellChannels', '910000000000000002');
    const bell = await app.request('/settings', {
      method: 'POST',
      headers: { cookie: `shamusho_session=${g}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: bellBody.toString(),
    });
    expect(bell.headers.get('location')).toBe('/settings?msg=saved');
    expect(store.current.bell).toEqual({
      channelId: '910000000000000003',
      cooldownMinutes: 3,
      mentionStaff: true,
      roleIds: [ROLE.shinshoku, ROLE.sewayaku],
      channelIds: ['910000000000000002'],
    });
    await post('/settings', g, { ...form, _csrf: await csrfOf(g), bellChannel: '', bellCooldown: '3' });
    expect(store.current.bell).toEqual({ cooldownMinutes: 3, mentionStaff: false, roleIds: [], channelIds: [] });
    // ⏰ 対応待ちのお知らせ・週報（フォームにないときは今の値を残す）
    expect(await (await get('/settings', g)).text()).toContain('⏰ 対応待ちのお知らせ・週報');
    const ops = { opsChannel: '910000000000000003', opsRemind: 'yes', opsAppHours: '6', opsSoudanHours: '12', opsOmairiHours: '0', opsBellMinutes: '15', opsQuietStart: '0', opsQuietEnd: '7', opsReportWeekday: '5', opsReportHour: '20' };
    expect((await post('/settings', g, { ...form, _csrf: await csrfOf(g), ...ops, at: 'opswatch' })).headers.get('location')).toBe('/settings?msg=saved&at=opswatch#sec-opswatch');
    expect(store.current.opsWatch).toMatchObject({ channelId: '910000000000000003', remindEnabled: true, mention: false, applicationHours: 6, soudanHours: 12, omairiHours: 0, bellMinutes: 15, quietStart: 0, quietEnd: 7, reportEnabled: false, reportWeekday: 5, reportHour: 20 });
    await post('/settings', g, { ...form, _csrf: await csrfOf(g), 'room.hourly.public': '50' });
    expect(store.current.opsWatch.applicationHours).toBe(6);
    // 募集の荒らし対策
    expect(await (await get('/settings', g)).text()).toContain('📣 募集（荒らし対策）');
    actions = [];
    const rec = await post('/settings', g, {
      ...form,
      _csrf: await csrfOf(g),
      recruitCooldownSec: '15',
      recruitChannelCooldownSec: '15',
      recruitNewDays: '2',
      recruitSpamAlert: '4',
      recruitRequireRank: 'yes',
    });
    expect(rec.headers.get('location')).toBe('/settings?msg=saved');
    expect(store.current.recruit).toMatchObject({
      cooldownSeconds: 15,
      channelCooldownSeconds: 15,
      newMemberDays: 2,
      spamAlertCount: 4,
      requireRank: true,
      blockYakudoshi: false,
    });
    // 通話のチャット（チェックを外すと消さない）
    const vcc = await post('/settings', g, { ...form, _csrf: await csrfOf(g), vcClearDelay: '5' });
    expect(vcc.headers.get('location')).toBe('/settings?msg=saved');
    expect(store.current.voiceChat).toEqual({ clearWhenEmpty: false, delayMinutes: 5 });
    // 自動で増える通話（名前が空の行は使わない）
    const vg = await post('/settings', g, { ...form, _csrf: await csrfOf(g), 'vg.0.name': '大きな縁側', 'vg.0.min': '3', 'vg.0.max': '10', 'vg.1.name': '', 'vg.1.min': '3', 'vg.1.max': '20', at: 'voicegroups' });
    expect(vg.headers.get('location')).toBe('/settings?msg=saved&at=voicegroups#sec-voicegroups');
    expect(store.current.voiceGroups).toEqual([{ name: '大きな縁側', min: 3, max: 10 }]);
    const back = await (await get('/settings?msg=saved&at=rooms', g)).text();
    expect(back).toContain('id="sec-rooms"');
    expect(back.match(/設定を保存しました/g)?.length).toBe(2);

    // 役職は役職のページで変える（設定の保存では変わらない）
    const ignored = await post('/settings', g, { ...form, _csrf: await csrfOf(g), 'rank.ujiko.requiredGoen': '100' });
    expect(ignored.headers.get('location')).toBe('/settings?msg=saved');
    expect(store.current.ranks.find((r) => r.key === 'ujiko')?.requiredGoen).toBe(20);
    expect(await (await get('/settings', g)).text()).toContain('href="/ranks"');

    const reset = await post('/settings/reset', g, { _csrf: await csrfOf(g) });
    expect(reset.headers.get('location')).toBe('/settings?msg=saved');
    expect(store.current.economy.menzaifuPrice).toBe(300);
  });

  it('🏮 設定のブースト: だれが何回ブーストしているか', async () => {
    const { boostMessages, members } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    const g = await login(GUJI);
    expect(await (await get('/settings', g)).text()).toContain('今ブーストしている人はいません');
    const since = new Date('2026-09-20T12:00:00+09:00');
    await db.update(members).set({ boostingSince: since }).where(eq(members.id, USER));
    await db.insert(boostMessages).values([
      { messageId: '1', memberId: USER, count: 1, granted: 0, at: new Date(since.getTime() + 60_000) },
      { messageId: '2', memberId: USER, count: 1, granted: 0, at: new Date('2026-09-25T12:00:00+09:00') },
    ]);
    const page = await (await get('/settings', g)).text();
    expect(page).toContain('今ブーストしている人（1 人・ブースト 2 回）');
    expect(page).toContain(`href="/members/${USER}"`);
    expect(page).toContain('2 回');
    expect(page).toContain('最近の「ブーストしました」');
  });

  it('評価のリセット: 宮司だけ・「リセット」と入れたときだけ・一度だけ', async () => {
    const s = await login(STAFF);
    expect((await post('/ranks/reset', s, { _csrf: await csrfOf(s), confirm: 'リセット' })).status).toBe(403);
    const g = await login(GUJI);
    expect(await (await get('/ranks', g)).text()).toContain('action="/ranks/reset"');
    expect((await post('/ranks/reset', g, { _csrf: await csrfOf(g), confirm: 'はい' })).headers.get('location')).toBe('/ranks?msg=reset_confirm#reset');
    expect((await post('/ranks/reset', g, { _csrf: await csrfOf(g), confirm: 'リセット' })).headers.get('location')).toBe('/ranks?msg=reset_started#reset');
    expect((await post('/ranks/reset', g, { _csrf: await csrfOf(g), confirm: 'リセット' })).headers.get('location')).toBe('/ranks?msg=reset_already#reset');
    const page = await (await get('/ranks', g)).text();
    expect(page).toContain('にリセットしました');
    expect(page).toContain('action="/ranks/reset/undo"');
  });

  it('役職: 宮司だけ。名前・絵文字・ロール・格・昇格ラインを変える・足す・消す', async () => {
    const { ROLE } = await import('./helpers.js');
    const { renderNotice } = await import('../src/services/notices.js');
    const s = await login(STAFF);
    expect((await get('/ranks', s)).status).toBe(403);
    const { ConfigStore } = await import('../src/services/settings.js');
    const store = new ConfigStore(db, cfg);
    app = createWebApp({ db, cfg: () => store.current, fileCfg: cfg, onSettingsSaved: () => store.refresh(), api: fakeApi, discord: fakeActions, baseUrl: BASE, now: () => clock });
    roleList = [
      { id: cfg.guildId, name: '@everyone', position: 0, managed: false, color: 0 },
      ...Object.entries(ROLE).map(([k, id], i) => ({ id, name: k, position: i + 1, managed: false, color: 0 })),
      { id: '980000000000000010', name: '新しい氏子', position: 20, managed: false, color: 0 },
      { id: '980000000000000011', name: '巫女', position: 21, managed: false, color: 0 },
      { id: '980000000000000012', name: 'BOT', position: 22, managed: true, color: 0 },
      { id: '980000000000000013', name: '巫女頭', position: 23, managed: false, color: 0 },
    ];
    try {
      const g = await login(GUJI);
      const page = await (await get('/ranks', g)).text();
      expect(page).toContain('action="/ranks/new"');
      expect(page).toContain('name="rank.ujiko.roleId"');
      // 管理画面に入れるかを決める役職のロールは、ここでは変えない
      expect(page).not.toContain('name="rank.guji.roleId"');
      expect(page).not.toContain('>BOT<');
      const form = async (patch: Record<string, string> = {}) => {
        const f: Record<string, string> = { _csrf: await csrfOf(g) };
        for (const r of store.current.ranks) {
          f[`rank.${r.key}.name`] = r.name;
          f[`rank.${r.key}.emoji`] = r.emoji;
          f[`rank.${r.key}.weight`] = String(r.weight);
          f[`rank.${r.key}.roleId`] = r.roleId;
          if (r.auto) f[`rank.${r.key}.requiredGoen`] = String(r.requiredGoen);
          if (!cfg.ranks.some((x) => x.key === r.key)) f[`rank.${r.key}.kind`] = r.auto ? 'auto' : 'appointed';
        }
        return { ...f, ...patch };
      };
      const saved = await post('/ranks', g, await form({ 'rank.ujiko.name': '氏子さん', 'rank.ujiko.emoji': '🌿', 'rank.ujiko.roleId': '980000000000000010', 'rank.ujiko.weight': '3', 'rank.guji.roleId': '980000000000000011' }));
      expect(saved.headers.get('location')).toBe('/ranks?msg=saved');
      const ujiko = store.current.ranks.find((r) => r.key === 'ujiko')!;
      expect(ujiko).toMatchObject({ name: '氏子さん', emoji: '🌿', roleId: '980000000000000010', weight: 3, formerNames: ['氏子'] });
      expect(store.current.ranks.find((r) => r.key === 'guji')?.roleId).toBe(ROLE.guji);
      // 掲示の {氏子のご縁} は前の名前でも使える
      expect(renderNotice('{氏子のご縁} {氏子さんのご縁}', store.current, []).text).toBe('20 20');
      expect((await listAudit(db, { action: 'ranks.update' }))[0]?.detail).toMatchObject({ ranks: { ujiko: { name: ['氏子', '氏子さん'] } } });
      // 通話の銭の倍率（%）。フォームになければそのまま、範囲の外は保存しない
      expect(await (await get('/ranks', g)).text()).toContain('name="rank.ujiko.voicePercent"');
      expect((await post('/ranks', g, await form({ 'rank.ujiko.voicePercent': '150' }))).headers.get('location')).toBe('/ranks?msg=saved');
      expect(store.current.ranks.find((r) => r.key === 'ujiko')?.voicePercent).toBe(150);
      expect(store.current.ranks.find((r) => r.key === 'sodai')?.voicePercent).toBe(100);
      // 1 日の上限の倍率は別に決められる（空なら通話の銭と同じに戻る）
      expect((await post('/ranks', g, await form({ 'rank.ujiko.voicePercent': '150', 'rank.ujiko.voiceCapPercent': '300' }))).headers.get('location')).toBe('/ranks?msg=saved');
      expect(store.current.ranks.find((r) => r.key === 'ujiko')?.voiceCapPercent).toBe(300);
      expect(await (await get('/ranks', g)).text()).toContain('1 日 450 枚まで');
      expect((await post('/ranks', g, await form({ 'rank.ujiko.voicePercent': '150', 'rank.ujiko.voiceCapPercent': '' }))).headers.get('location')).toBe('/ranks?msg=saved');
      expect(store.current.ranks.find((r) => r.key === 'ujiko')?.voiceCapPercent).toBeUndefined();
      expect((await post('/ranks', g, await form({ 'rank.ujiko.voicePercent': '2000' }))).headers.get('location')).toBe('/ranks?msg=invalid');
      expect(store.current.ranks.find((r) => r.key === 'ujiko')?.voicePercent).toBe(150);

      // 昇格ラインが重なる・選べないロール・名前が空は保存しない
      const bads: Record<string, string>[] = [{ 'rank.ujiko.requiredGoen': '100' }, { 'rank.ujiko.roleId': '980000000000000012' }, { 'rank.sodai.name': '' }];
      for (const bad of bads) {
        expect((await post('/ranks', g, await form(bad))).headers.get('location')).toBe('/ranks?msg=invalid');
      }
      expect(store.current.ranks.find((r) => r.key === 'ujiko')?.requiredGoen).toBe(20);

      // 足す（ご縁が同じ役職があると足せない）
      const add = async (b: Record<string, string>) => post('/ranks/new', g, { _csrf: await csrfOf(g), ...b });
      expect((await add({ name: '巫女', roleId: '980000000000000011', kind: 'auto', requiredGoen: '20', weight: '5' })).headers.get('location')).toContain('msg=invalid');
      expect((await add({ name: '巫女', emoji: '🎀', roleId: '980000000000000011', kind: 'auto', requiredGoen: '500', weight: '5' })).headers.get('location')).toBe('/ranks?msg=added');
      const miko = store.current.ranks.find((r) => r.name === '巫女')!;
      expect(miko).toMatchObject({ emoji: '🎀', roleId: '980000000000000011', auto: true, requiredGoen: 500, weight: 5 });
      // 足した役職は、なり方も変えられる
      expect((await post('/ranks', g, await form({ [`rank.${miko.key}.kind`]: 'appointed' }))).headers.get('location')).toBe('/ranks?msg=saved');
      expect(store.current.ranks.find((r) => r.key === miko.key)?.auto).toBe(false);

      // ファイルの役職も、ご縁で自動 ⇔ 任命制 を変えられる（任命制ならご縁は要らない）
      const toAppointed = await post('/ranks', g, await form({ 'rank.sodai.kind': 'appointed', 'rank.sodai.requiredGoen': '' }));
      expect(toAppointed.headers.get('location')).toBe('/ranks?msg=saved');
      expect(store.current.ranks.find((r) => r.key === 'sodai')?.auto).toBe(false);
      // 自動に戻すときはご縁が要る
      expect((await post('/ranks', g, await form({ 'rank.sodai.kind': 'auto', 'rank.sodai.requiredGoen': '' }))).headers.get('location')).toBe('/ranks?msg=invalid');
      expect((await post('/ranks', g, await form({ 'rank.sodai.kind': 'auto', 'rank.sodai.requiredGoen': '400' }))).headers.get('location')).toBe('/ranks?msg=saved');
      expect(store.current.ranks.find((r) => r.key === 'sodai')).toMatchObject({ auto: true, requiredGoen: 400 });
      // 宮司・参拝者のなり方は変えない
      await post('/ranks', g, await form({ 'rank.guji.kind': 'auto', 'rank.sanpaisha.kind': 'appointed' }));
      expect(store.current.ranks.find((r) => r.key === 'guji')?.auto).toBe(false);
      expect(store.current.ranks.find((r) => r.key === 'sanpaisha')?.auto).toBe(true);
      // 任命制で足すときはご縁なしでよい
      expect((await add({ name: '巫女頭', roleId: '980000000000000013', kind: 'appointed', weight: '6' })).headers.get('location')).toBe('/ranks?msg=added');
      const head = store.current.ranks.find((r) => r.name === '巫女頭')!;
      expect(head).toMatchObject({ auto: false, requiredGoen: 0 });
      await post(`/ranks/${head.key}/delete`, g, { _csrf: await csrfOf(g) });

      // 消せるのは足した役職だけ
      expect((await post('/ranks/ujiko/delete', g, { _csrf: await csrfOf(g) })).headers.get('location')).toBe('/ranks?msg=locked');
      expect((await post(`/ranks/${miko.key}/delete`, g, { _csrf: await csrfOf(g) })).headers.get('location')).toBe('/ranks?msg=deleted');
      expect(store.current.ranks.some((r) => r.key === miko.key)).toBe(false);
      expect(store.current.ranks.length).toBe(cfg.ranks.length);
    } finally {
      roleList = [];
    }
  });

  it('📰 更新速報: 宮司が設定して、1 つ・1 日分を #更新速報 に出す', async () => {
    const { CHANGELOG, LATEST_CHANGE_ID } = await import('../src/changelog.js');
    const { loadUpdateNews } = await import('../src/services/updateNews.js');
    const s = await login(STAFF);
    const staffPage = await (await get('/updates', s)).text();
    expect(staffPage).not.toContain('action="/updates/news"');
    expect((await post('/updates/news', s, { _csrf: await csrfOf(s), enabled: 'yes' })).status).toBe(403);
    const g = await login(GUJI);
    const page = await (await get('/updates', g)).text();
    expect(page).toContain('action="/updates/news"');
    expect(page).toContain('news-card');
    // 名前で探す（テストの偽の Discord には「更新速報」がないので #しきたり を選ぶ）
    expect((await post('/updates/news/post', g, { _csrf: await csrfOf(g), id: CHANGELOG[0]!.id })).headers.get('location')).toBe('/updates?msg=news_nochannel#update-news');
    const saved = await post('/updates/news', g, { _csrf: await csrfOf(g), enabled: 'yes', channelId: '910000000000000003', scope: 'all' });
    expect(saved.headers.get('location')).toBe('/updates?msg=news_saved#update-news');
    expect(await loadUpdateNews(db)).toEqual({ enabled: true, channelId: '910000000000000003', scope: 'all', lastId: LATEST_CHANGE_ID });
    actions = [];
    expect((await post('/updates/news/post', g, { _csrf: await csrfOf(g), id: CHANGELOG[0]!.id })).headers.get('location')).toBe('/updates?msg=news_posted#update-news');
    expect(actions).toEqual([expect.stringMatching(/^send 910000000000000003 /)]);
    actions = [];
    await post('/updates/news/post', g, { _csrf: await csrfOf(g), date: CHANGELOG[0]!.date });
    expect(actions.length).toBeGreaterThan(0);
    expect((await post('/updates/news/post', g, { _csrf: await csrfOf(g), id: 'nothing' })).headers.get('location')).toBe('/updates?msg=news_none#update-news');
  });

  it('⌨ コマンドのまとめ: だれでも見られる。宮司はメンバー向けのまとめを掲示にできる', async () => {
    const s = await login(STAFF);
    const page = await (await get('/commands', s)).text();
    expect(page).toContain('/残高');
    expect(page).toContain('/厄');
    expect(page).not.toContain('action="/commands/notice"');
    expect((await post('/commands/notice', s, { _csrf: await csrfOf(s), channelId: '910000000000000003' })).status).toBe(403);
    const g = await login(GUJI);
    expect(await (await get('/commands', g)).text()).toContain('action="/commands/notice"');
    expect((await post('/commands/notice', g, { _csrf: await csrfOf(g), channelId: '' })).headers.get('location')).toBe('/commands?msg=notice_invalid');
    const r = await post('/commands/notice', g, { _csrf: await csrfOf(g), channelId: '910000000000000003' });
    expect(r.headers.get('location')).toMatch(/^\/notices\/\d+\?msg=commands_notice$/);
    const n = (await listNotices(db)).find((x) => x.title === 'コマンドのまとめ')!;
    expect(n.body).toContain('{コマンド一覧}');
    expect(await (await get(r.headers.get('location')!, g)).text()).toContain('コマンドのまとめの掲示を作りました');
  });

  it('💡 アイデア・共有: 神職も書ける・👍・コメント・状態。直す・消すのは書いた人と宮司', async () => {
    const s = await login(STAFF);
    const page = await (await get('/ideas', s)).text();
    expect(page).toContain('アイデア・共有');
    expect(page).toContain('href="/ideas"');
    expect((await post('/ideas', s, { _csrf: await csrfOf(s), kind: 'idea', title: '  ' })).headers.get('location')).toBe('/ideas?msg=invalid');
    const created = await post('/ideas', s, { _csrf: await csrfOf(s), kind: 'idea', title: '運営吉を足したい', body: '**小林吉**と ais吉' });
    const loc = created.headers.get('location')!;
    expect(loc).toMatch(/^\/ideas\/\d+\?msg=created$/);
    const id = Number(/\/ideas\/(\d+)/.exec(loc)![1]);
    const detail = await (await get(`/ideas/${id}`, s)).text();
    expect(detail).toContain('<strong>小林吉</strong>');
    expect(detail).toContain('💡 足したい機能');
    // 👍（もう一度で外れる）・戻り先は /ideas だけ
    expect((await post(`/ideas/${id}/vote`, s, { _csrf: await csrfOf(s), back: '/ideas?status=open' })).headers.get('location')).toBe('/ideas?status=open');
    expect(await (await get('/ideas?status=open', s)).text()).toContain('aria-pressed="true"');
    expect((await post(`/ideas/${id}/vote`, s, { _csrf: await csrfOf(s), back: 'https://evil.example/' })).headers.get('location')).toBe(`/ideas/${id}`);
    expect(await (await get('/ideas', s)).text()).toContain('aria-pressed="false"');
    // コメント・状態・ピン留め
    expect((await post(`/ideas/${id}/comments`, s, { _csrf: await csrfOf(s), body: 'いいね' })).headers.get('location')).toBe(`/ideas/${id}?msg=commented#comments`);
    expect((await post(`/ideas/${id}/status`, s, { _csrf: await csrfOf(s), status: 'todo' })).headers.get('location')).toBe(`/ideas/${id}?msg=status`);
    await post(`/ideas/${id}/pin`, s, { _csrf: await csrfOf(s), pinned: 'yes' });
    const list = await (await get('/ideas?status=todo', s)).text();
    expect(list).toContain('運営吉を足したい');
    expect(list).toContain('📌');
    expect(await (await get('/ideas?status=done', s)).text()).not.toContain('運営吉を足したい');
    expect(await (await get('/ideas?q=小林', s)).text()).toContain('運営吉を足したい');
    // 書いた人は直せる。ほかの神職は直せない・消せない（宮司はできる）
    expect((await post(`/ideas/${id}/edit`, s, { _csrf: await csrfOf(s), kind: 'share', title: '運営吉（決定）', body: '' })).headers.get('location')).toBe(`/ideas/${id}?msg=saved`);
    const other = await login('700000000000000077');
    if (other) {
      expect((await post(`/ideas/${id}/delete`, other, { _csrf: await csrfOf(other) })).headers.get('location')).toBe(`/ideas/${id}?msg=forbidden`);
    }
    const g = await login(GUJI);
    expect((await post(`/ideas/${id}/delete`, g, { _csrf: await csrfOf(g) })).headers.get('location')).toBe('/ideas?msg=deleted');
    expect((await get(`/ideas/${id}`, g)).status).toBe(404);
  });

  it('📎 アイデア・共有: 写真・ファイルを付けられる（本文・コメント）。見る・ダウンロード・まとめて zip・消す', async () => {
    const { renderSlip } = await import('../src/services/omikujiSlip.js');
    const s = await login(STAFF);
    const csrf = await csrfOf(s);
    const png = renderSlip({ name: '吉', color: '#e0607e', message: 'a', items: [], shrine: '', date: new Date() });
    const send = (path: string, fields: Record<string, string>, files: [string, Uint8Array][]) => {
      const fd = new FormData();
      fd.append('_csrf', csrf);
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      for (const [name, data] of files) fd.append('files', new File([data], name));
      return app.request(path, { method: 'POST', headers: { cookie: `shamusho_session=${s}` }, body: fd });
    };
    expect(await (await get('/ideas', s)).text()).toContain('enctype="multipart/form-data"');
    // 写真 2 枚（1 つは名前と中身がちがう）・PDF・付けられないもの（.exe）
    const created = await send('/ideas', { kind: 'share', title: 'POP の写真' }, [
      ['pop.png', png],
      ['写真.jpg', png],
      ['資料.pdf', new TextEncoder().encode('%PDF-1.4 test')],
      ['virus.exe', new Uint8Array([1, 2, 3])],
    ]);
    const loc = created.headers.get('location')!;
    expect(loc).toMatch(/^\/ideas\/\d+\?msg=files_rejected$/);
    const id = Number(/\/ideas\/(\d+)/.exec(loc)![1]);
    const detail = await (await get(`/ideas/${id}`, s)).text();
    const fileIds = [...detail.matchAll(/\/ideas\/files\/(\d+)\?dl=1/g)].map((m) => Number(m[1]));
    expect(fileIds).toHaveLength(2);
    expect(detail).toContain('写真.png');
    expect(detail).toContain('📄 資料.pdf');
    expect(detail).not.toContain('virus.exe');
    expect(detail).toContain(`/ideas/${id}/files.zip`);
    // 写真はそのまま見られる・?dl=1 でダウンロード
    const img = await get(`/ideas/files/${fileIds[0]}`, s);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(img.headers.get('content-disposition')).toBe("inline; filename*=UTF-8''pop.png");
    expect(Buffer.from(await img.arrayBuffer()).equals(png)).toBe(true);
    expect((await get(`/ideas/files/${fileIds[1]}?dl=1`, s)).headers.get('content-disposition')).toBe(`attachment; filename*=UTF-8''${encodeURIComponent('写真.png')}`);
    // 写真でないものはいつもダウンロード（中身の種類は信じない）
    const pdfId = Number(/\/ideas\/files\/(\d+)" download="資料.pdf"/.exec(detail)![1]);
    const pdf = await get(`/ideas/files/${pdfId}`, s);
    expect(pdf.headers.get('content-type')).toBe('application/octet-stream');
    expect(pdf.headers.get('content-disposition')).toContain('attachment;');
    // 一覧に 📎 と小さい写真
    const list = await (await get('/ideas', s)).text();
    expect(list).toContain('📎 3');
    expect(list).toContain(`/ideas/files/${fileIds[0]}`);
    // 写真だけのコメント
    expect((await send(`/ideas/${id}/comments`, { body: '' }, [['screenshot.png', png]])).headers.get('location')).toBe(`/ideas/${id}?msg=commented#comments`);
    expect((await send(`/ideas/${id}/comments`, { body: '' }, [])).headers.get('location')).toBe(`/ideas/${id}#comments`);
    // 一覧のコメントの数（前は、ほかの表の id と取りちがえて数えていた）
    expect(await (await get('/ideas', s)).text()).toContain(`<a href="/ideas/${id}#comments">💬 1</a>`);
    // まとめて zip（4 つ）
    const z = await get(`/ideas/${id}/files.zip`, s);
    expect(z.headers.get('content-type')).toBe('application/zip');
    const zb = Buffer.from(await z.arrayBuffer());
    expect(zb.readUInt32LE(0)).toBe(0x04034b50);
    expect(zb.readUInt16LE(zb.length - 22 + 10)).toBe(4);
    for (const n of ['pop.png', '写真.png', '資料.pdf', 'screenshot.png']) expect(zb.includes(Buffer.from(n))).toBe(true);
    // ほかの神職は消せない・付けた人は消せる
    const other = await login('700000000000000077');
    if (other) expect((await post(`/ideas/files/${fileIds[0]}/delete`, other, { _csrf: await csrfOf(other) })).headers.get('location')).toBe('/ideas?msg=forbidden');
    expect((await post(`/ideas/files/${fileIds[0]}/delete`, s, { _csrf: csrf })).headers.get('location')).toBe(`/ideas/${id}?msg=file_deleted`);
    expect((await get(`/ideas/files/${fileIds[0]}`, s)).status).toBe(404);
    // アイデアを消すと、写真も消える
    const g = await login(GUJI);
    await post(`/ideas/${id}/delete`, g, { _csrf: await csrfOf(g) });
    expect((await get(`/ideas/files/${fileIds[1]}`, g)).status).toBe(404);
  });

  it('📓 議事録: 神職も書ける・直せる・やることを済にできる・まとめを Discord に出せる。消すのは宮司だけ', async () => {
    const { listAudit: audits } = await import('../src/services/audit.js');
    const s = await login(STAFF);
    expect(await (await get('/minutes', s)).text()).toContain('まだ議事録がありません');
    expect(await (await get('/minutes/new', s)).text()).toContain('name="todo.0.body"');
    expect((await post('/minutes', s, { _csrf: await csrfOf(s), title: '', heldAt: '2026-09-28T21:00', todoRows: '0' })).headers.get('location')).toBe('/minutes/new?msg=invalid');
    const created = await post('/minutes', s, {
      _csrf: await csrfOf(s),
      title: '9 月の運営会議',
      heldAt: '2026-09-28T21:00',
      placeChannelId: '910000000000000004',
      attendees: STAFF,
      agenda: '- イベント',
      notes: '**ハロウィン**',
      decisions: '10/31 21 時から',
      todoRows: '3',
      'todo.0.body': '告知文を書く',
      'todo.0.assignee': STAFF,
      'todo.0.due': '2026-10-05',
      'todo.1.body': '',
      'todo.2.body': '部屋を作る',
      'todo.2.done': 'yes',
    });
    const loc = created.headers.get('location')!;
    expect(loc).toMatch(/^\/minutes\/\d+\?msg=created$/);
    const id = Number(/\/minutes\/(\d+)/.exec(loc)![1]);
    const view = await (await get(`/minutes/${id}`, s)).text();
    for (const t of ['9 月の運営会議', '10/31 21 時から', '告知文を書く', '<strong>ハロウィン</strong>', '🔊 拝殿', '1 / 2']) expect(view).toContain(t);
    expect(view).not.toContain('この議事録を消す');
    // ホームの対応待ち・一覧のまだのやること
    expect(await (await get('/', s)).text()).toContain('議事録のやること（まだ）');
    const list = await (await get('/minutes', s)).text();
    expect(list).toContain('やること まだ 1 / 2');
    // 済にする
    const { getMeeting } = await import('../src/services/meetings.js');
    const todo = (await getMeeting(db, id))!.todos[0]!;
    expect((await post(`/minutes/todos/${todo.id}/toggle`, s, { _csrf: await csrfOf(s), back: `meeting:${id}` })).headers.get('location')).toBe(`/minutes/${id}?msg=toggled`);
    expect((await getMeeting(db, id))!.todos[0]!.doneAt).not.toBeNull();
    // 直す（題を変え、やることを 1 つ足す）
    const edit = await (await get(`/minutes/${id}/edit`, s)).text();
    expect(edit).toContain(`name="todo.0.id" value="${todo.id}"`);
    await post(`/minutes/${id}`, s, { _csrf: await csrfOf(s), title: '9 月の運営会議（直した）', heldAt: '2026-09-28T21:00', todoRows: '2', 'todo.0.id': String(todo.id), 'todo.0.body': '告知文を書く', 'todo.0.done': 'yes', 'todo.1.body': 'BOT の告知' });
    expect((await getMeeting(db, id))!.todos.map((t) => t.body)).toEqual(['告知文を書く', 'BOT の告知']);
    // Discord に出す
    actions = [];
    expect((await post(`/minutes/${id}/post`, s, { _csrf: await csrfOf(s), channelId: '' })).headers.get('location')).toBe(`/minutes/${id}?msg=post_invalid`);
    expect((await post(`/minutes/${id}/post`, s, { _csrf: await csrfOf(s), channelId: '910000000000000003' })).headers.get('location')).toBe(`/minutes/${id}?msg=posted`);
    expect(actions[0]).toMatch(/^send 910000000000000003 /);
    expect((await post(`/minutes/${id}/post`, s, { _csrf: await csrfOf(s), channelId: '910000000000000003' })).headers.get('location')).toBe(`/minutes/${id}?msg=edited`);
    // 消すのは宮司だけ
    expect((await post(`/minutes/${id}/delete`, s, { _csrf: await csrfOf(s), confirm: 'yes' })).headers.get('location')).toBe(`/minutes/${id}?msg=forbidden`);
    const g = await login(GUJI);
    expect(await (await get(`/minutes/${id}`, g)).text()).toContain('この議事録を消す');
    expect((await post(`/minutes/${id}/delete`, g, { _csrf: await csrfOf(g), confirm: 'yes' })).headers.get('location')).toBe('/minutes?msg=deleted');
    expect(await getMeeting(db, id)).toBeUndefined();
    expect((await audits(db, { action: 'meeting.delete' })).length).toBe(1);
    expect((await get('/minutes/99999', g)).status).toBe(404);
  });

  it('⏳ 一時的な権限: 社務所Web から付ける・のばす・外す。危ないロールは宮司だけ', async () => {
    const { activeGrants } = await import('../src/services/tempGrants.js');
    roleList = [
      { id: cfg.guildId, name: '@everyone', position: 0, managed: false, color: 0, permissions: '0' },
      { id: '980000000000000001', name: 'イベント係', position: 2, managed: false, color: 0, permissions: '0' },
      { id: '980000000000000002', name: 'BAN できる', position: 3, managed: false, color: 0, permissions: String(1n << 2n) },
      { id: '980000000000000009', name: 'BOT', position: 10, managed: true, color: 0, permissions: '8', tags: { bot_id: '990000000000000001' } },
    ];
    try {
      const s = await login(STAFF);
      const page = await (await get('/temp', s)).text();
      expect(page).toContain('いま一時的に付いているものはありません');
      expect(page).toContain('<option value="980000000000000002" disabled="">BAN できる（宮司だけ）</option>');
      const csrf = await csrfOf(s);
      expect((await post('/temp', s, { _csrf: csrf, member: 'だれでもない', kind: 'role', roleId: '980000000000000001', for: '1h' })).headers.get('location')).toBe('/temp?msg=no_member#temp-give');
      expect((await post('/temp', s, { _csrf: csrf, member: USER, kind: 'role', roleId: '980000000000000002', for: '1h' })).headers.get('location')).toBe('/temp?msg=guji_only#temp-give');
      expect((await post('/temp', s, { _csrf: csrf, member: USER, kind: 'role', roleId: '980000000000000001', for: '1h', reason: '手伝い' })).headers.get('location')).toBe('/temp?msg=granted');
      expect(actions).toContain(`addRole ${USER} 980000000000000001`);
      expect((await post('/temp', s, { _csrf: csrf, member: USER, kind: 'perm', channelId: '910000000000000003', preset: 'mute', for: '10m' })).headers.get('location')).toBe('/temp?msg=granted');
      expect(actions.some((a) => a.startsWith(`overwrite 910000000000000003 ${USER}`))).toBe(true);
      const list = await (await get('/temp', s)).text();
      expect(list).toContain('イベント係');
      expect(list).toContain('#しきたり の 🔇 書き込み禁止');
      const [first] = await activeGrants(db);
      expect((await post(`/temp/${first!.id}/extend`, s, { _csrf: csrf, for: '1d' })).headers.get('location')).toBe('/temp?msg=extended');
      expect((await post(`/temp/${first!.id}/revoke`, s, { _csrf: csrf })).headers.get('location')).toBe('/temp?msg=revoked');
      expect((await post(`/temp/${first!.id}/revoke`, s, { _csrf: csrf })).headers.get('location')).toBe('/temp?msg=ended_already');
      expect((await activeGrants(db)).length).toBe(1);
      expect(await (await get('/temp', s)).text()).toContain('⏹ 手で外した');
    } finally {
      roleList = [];
    }
  });

  it('🔗 招待: だれのリンクか・だれがだれを招待したか・人が作った期限つきのリンクを消せる', async () => {
    const { saveLink, recordInvite, SHARED_INVITER } = await import('../src/services/invites.js');
    await recordJoin(db, { id: GUJI, username: 'g', displayName: 'ぐうじ', avatarUrl: null, roleIds: [ROLE.guji], isBot: false, joinedAt: null });
    await saveLink(db, { code: 'sakuraLink', inviterId: USER, channelId: '910000000000000002', uses: 1 });
    await saveLink(db, { code: 'snsLink', inviterId: SHARED_INVITER, channelId: '910000000000000002', uses: 0, label: 'X 用', createdBy: GUJI });
    await recordInvite(db, '800000000000000077', USER, 'link');
    const created = new Date(clock.getTime() - 86_400_000).toISOString();
    fakeActions.guildInvites = async () => [
      { code: 'sakuraLink', uses: 2, max_age: 0, inviter: { id: '990000000000000001', username: 'bot', bot: true } },
      { code: 'snsLink', uses: 5, max_age: 0, inviter: { id: '990000000000000001', username: 'bot', bot: true } },
      { code: 'handMade', uses: 3, max_age: 604800, created_at: created, inviter: { id: USER, username: 'u', global_name: 'さくら' }, channel: { id: '910000000000000003', name: 'しきたり' } },
    ];
    const deleted: string[] = [];
    fakeActions.deleteInvite = async (code) => void deleted.push(code);
    try {
      const s = await login(STAFF);
      const page = await (await get('/invites', s)).text();
      expect(page).toContain('discord.gg/sakuraLink');
      expect(page).toContain('使われた 2 回');
      expect(page).toContain('「X 用」');
      expect(page).toContain('使われた 5 回');
      expect(page).toContain('discord.gg/handMade');
      expect(page).toContain('期限が付いているリンクが 1 個あります');
      expect(page).toContain('招待リンクで入った');
      expect(page).toContain('参加者・報酬');
      expect(page).toContain('氏子の報酬');
      expect(page).toContain('参拝者で 150銭');
      expect(page).toContain('氏子で追加 350銭');
      expect(page).toContain('要確認・招待元不明');
      const unknown = await (await get('/invites?filter=unknown', s)).text();
      const participant = unknown.split('id="invite-rewards"')[1]!.split('id="invite-inviters"')[0]!;
      expect(participant).not.toContain('/members/800000000000000077');
      expect(participant).toContain('招待元の記録なし');

      expect((await post('/invites/handMade/delete', s, { _csrf: await csrfOf(s) })).headers.get('location')).toBe('/invites?msg=deleted');
      expect(deleted).toEqual(['handMade']);
      expect((await post('/invites/sakuraLink/delete', s, { _csrf: await csrfOf(s) })).headers.get('location')).toBe('/invites?msg=deleted');
      fakeActions.guildInvites = async () => [];
      const after = await (await get('/invites', s)).text();
      expect(after).not.toContain('discord.gg/sakuraLink');
      expect((await listAudit(db, { action: 'invite.delete' })).length).toBe(2);
      // 読めないとき
      fakeActions.guildInvites = async () => Promise.reject(new Error('403'));
      expect(await (await get('/invites', s)).text()).toContain('Discord から読めませんでした');
    } finally {
      delete fakeActions.guildInvites;
      delete fakeActions.deleteInvite;
    }
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

  it('掲示: メンションを選び、写真を付けて投稿できる。飾りのボタンとプレビュー', async () => {
    roleList = [
      { id: cfg.guildId, name: '@everyone', position: 0, managed: false, color: 0 },
      { id: '980000000000000001', name: '新人', position: 2, managed: false, color: 0 },
      { id: '980000000000000002', name: 'BOT', position: 3, managed: true, color: 0 },
    ];
    const bodies: MessageBody[] = [];
    const send = fakeActions.sendMessage;
    fakeActions.sendMessage = async (c, b) => (bodies.push(b), send(c, b));
    try {
      const g = await login(GUJI);
      const page = await (await get('/notices/new', g)).text();
      expect(page).toContain('/static/editor.js?v=');
      expect(page).toContain('data-md="wrap"');
      expect(page).toContain('name="mentionRoles" value="980000000000000001"');
      expect(page).not.toContain('value="980000000000000002"');
      expect(page).toContain('enctype="multipart/form-data"');
      expect((await get('/static/editor.js', g)).status).toBe(200);

      // プレビュー: 飾りを HTML で、メンションは上に
      const pv = await (
        await post('/notices/preview', g, { _csrf: await csrfOf(g), body: '**太字** <b>', mentionKind: 'roles', mentionRoles: '980000000000000001' })
      ).text();
      expect(pv).toContain('<strong>太字</strong> &lt;b&gt;');
      expect(pv).toContain('@新人');

      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
      const fd = new FormData();
      for (const [k, v] of Object.entries({ _csrf: await csrfOf(g), channelId: '910000000000000003', title: '祭り', body: '夏祭り', mentionKind: 'everyone', imagePosition: 'top', then: 'publish' }))
        fd.append(k, v);
      fd.append('image', new File([png], 'photo.png', { type: 'image/png' }));
      const r = await app.request('/notices', { method: 'POST', headers: { cookie: `shamusho_session=${g}` }, body: fd });
      expect(r.headers.get('location')).toBe('/notices?msg=posted');
      expect(bodies.at(-1)).toMatchObject({ content: '@everyone', allowed_mentions: { parse: ['everyone'] }, embeds: [{ image: {} }, { description: '夏祭り' }] });
      const n = (await listNotices(db)).at(-1)!;
      expect(bodies.at(-1)!.files![0]).toMatchObject({ name: `notice-${n.id}.png`, contentType: 'image/png' });
      expect((await get(`/notices/${n.id}/image`, g)).headers.get('content-type')).toBe('image/png');
      const list = await (await get('/notices', g)).text();
      expect(list).toContain('🔔 @everyone');
      expect(list).toContain('🖼 写真（上）');

      // 写真でないものは入れない
      const bad = new FormData();
      for (const [k, v] of Object.entries({ _csrf: await csrfOf(g), title: '祭り', body: '夏祭り' })) bad.append(k, v);
      bad.append('image', new File(['<svg/>'], 'x.png', { type: 'image/png' }));
      const br = await app.request(`/notices/${n.id}`, { method: 'POST', headers: { cookie: `shamusho_session=${g}` }, body: bad });
      expect(await br.text()).toContain('PNG・JPEG・GIF・WebP');

      // 写真を外す（メンションの欄がない古い画面から送られても、メンションは変えない）
      await post(`/notices/${n.id}`, g, { _csrf: await csrfOf(g), title: '祭り', body: '夏祭り', removeImage: 'yes' });
      const after = (await listNotices(db)).at(-1)!;
      expect(after.imageHash).toBeNull();
      expect(after.mention).toBe('everyone');
    } finally {
      fakeActions.sendMessage = send;
      roleList = [];
    }
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
      boostDiscountPercent: '20',
      coreTimePercent: '150',
      onboardingReward: '300',
      inviteReward: '500',
      inviteActiveReward: '20',
      inviteActiveDays: '30',
      roomBoosterDiscount: '100',
      marketFee: '10',
      marketAutoRelease: '7',
      ...Object.fromEntries(['once', 'hourly'].flatMap((p) => ['public', 'invite', 'secret', 'twoshot'].map((k) => [`room.${p}.${k}`, '0']))),
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

describe('通話の記録（管理画面）', () => {
  it('運営が見られる。カテゴリで絞ると、その場所が多い順。メンバーのページにも出る', async () => {
    const { recordPresence } = await import('../src/services/voiceUsage.js');
    await recordPresence(db, [{ id: '990000000000000001', name: '宵宮', categoryId: '990000000000000010', categoryName: '🔞 宵宮', memberIds: [USER, STAFF] }], clock);
    const s = await login(STAFF);
    const page = await (await get('/voice', s)).text();
    expect(page).toContain('🔞 宵宮');
    expect(page).toContain('よくいっしょにいる 2 人');
    // グラフ（日ごと・カテゴリごと）
    expect(page).toContain('日ごとの通話時間の合計');
    expect(page).toContain('カテゴリごとの通話時間');
    const filtered = await (await get('/voice?days=7&cat=990000000000000010', s)).text();
    expect(filtered).toContain('🔞 宵宮 が多い順');
    const member = await (await get(`/members/${USER}`, s)).text();
    expect(member).toContain('通話の記録（30 日）');
    expect(member).toContain('この人の日ごとの通話時間');
    expect(member).toContain('1分');
  });
});

describe('ニックネーム（管理画面）', () => {
  it('運営がメンバーのニックネームを変えられる（上の運営は変えられない）', async () => {
    const s = await login(STAFF);
    const csrf = /name="_csrf" value="([^"]+)"/.exec(await (await get(`/members/${USER}`, s)).text())![1]!;
    const post = (path: string, data: Record<string, string>) =>
      app.request(path, { method: 'POST', headers: { cookie: `shamusho_session=${s}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrf, ...data }).toString() });
    expect((await post(`/members/${USER}/nickname`, { nickname: 'さくら' })).headers.get('location')).toBe(`/members/${USER}?msg=nickname_changed`);
    expect(actions).toContain(`nick ${USER} さくら`);
    expect((await listAudit(db, { action: 'member.nickname' }))[0]?.detail).toMatchObject({ to: 'さくら' });
    await recordJoin(db, { id: GUJI, username: 'g', displayName: '宮司', avatarUrl: null, roleIds: [ROLE.guji], isBot: false, joinedAt: null });
    expect((await post(`/members/${GUJI}/nickname`, { nickname: 'x' })).headers.get('location')).toBe(`/members/${GUJI}?msg=denied_protected`);
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

  it('💎 極の VIP を作る: ロール・VIP だけが見える入口・授与品。設定に入り、極の入口が通話部屋の入口になる。やめられる', async () => {
    const { ConfigStore } = await import('../src/services/settings.js');
    const { listItems } = await import('../src/services/shop.js');
    const store = new ConfigStore(db, cfg);
    await store.refresh();
    app = createWebApp({ db, cfg: () => store.current, fileCfg: cfg, onSettingsSaved: () => store.refresh(), api: fakeApi, discord: fakeActions, baseUrl: BASE, now: () => clock });
    const g = await login(GUJI);
    // 宵宮（遊郭）のカテゴリがないと作れない
    expect(await (await get('/shop', g)).text()).toContain('入口を置くカテゴリが見つかりません');
    expect((await form(g, '/shop/vip', { price: '8000', durationDays: '30' })).headers.get('location')).toBe('/shop?msg=vip_nocategory#shop-vip');
    const original = fakeActions.guildChannels;
    fakeActions.guildChannels = async () => [
      ...(await original(cfg.guildId)),
      { id: '910000000000000020', name: '🏮 遊郭', type: 4, parent_id: null, position: 5, permission_overwrites: [{ id: cfg.guildId, type: 0, allow: '0', deny: String(1n << 10n) }] },
    ];
    try {
      actions = [];
      expect((await form(g, '/shop/vip', { price: '8000', durationDays: '30' })).headers.get('location')).toBe('/shop?msg=vip_created#shop-vip');
      expect(actions.some((a) => a.startsWith('createRole') && a.includes('極 VIP'))).toBe(true);
      const made = actions.find((a) => a.startsWith('createChannel'))!;
      expect(made).toContain('極の部屋をひらく');
      expect(made).toContain('"parent_id":"910000000000000020"');
      expect(store.current.rooms.vip).toEqual({ roleId: '980000000000000099', hubId: '910000000000000099' });
      expect(store.current.tempVoice.hubs.some((h) => h.channelId === '910000000000000099' && h.plan === 'free')).toBe(true);
      const vipItem = (await listItems(db)).find((i) => i.roleGroup === 'vip')!;
      expect(vipItem).toMatchObject({ kind: 'role', price: 8000, durationDays: 30, roleId: '980000000000000099' });
      expect(await (await get('/shop', g)).text()).toContain('VIP だけの部屋');
      expect((await form(g, '/shop/vip', {})).headers.get('location')).toBe('/shop?msg=vip_exists#shop-vip');
      // 設定を保存しても消えない
      expect((await listAudit(db, { action: 'rooms.vip_create' })).length).toBe(1);
      expect((await form(g, '/shop/vip/off', { confirm: 'yes' })).headers.get('location')).toBe('/shop?msg=vip_off#shop-vip');
      expect(store.current.rooms.vip).toBeUndefined();
      expect((await listItems(db)).find((i) => i.id === vipItem.id)!.enabled).toBe(false);
    } finally {
      fakeActions.guildChannels = original;
    }
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

describe('市場（管理画面）', () => {
  const SELLER = '700000000000000009';
  const form = async (session: string, path: string, data: Record<string, string> = {}) => {
    const csrf = /name="_csrf" value="([^"]+)"/.exec(await (await get('/', session)).text())![1]!;
    return app.request(path, {
      method: 'POST',
      headers: { cookie: `shamusho_session=${session}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, ...data }).toString(),
    });
  };
  const setup = async () => {
    const { createListing, buyListing, setListingMessage } = await import('../src/services/market.js');
    const mcfg = { ...cfg, roles: { ...cfg.roles, merchant: '100000000000000077' } };
    const r = await createListing(db, mcfg, { id: SELLER, roleIds: ['100000000000000077'] }, { category: 'illust', title: 'アイコン', description: '', price: 1000 });
    if (r.status !== 'ok') throw new Error(r.status);
    await setListingMessage(db, r.listing.id, '920000000000000001', '920000000000000002');
    await addCoins(db, USER, 1000, 'adjust');
    const b = await buyListing(db, mcfg, r.listing.id, USER);
    if (b.status !== 'ok') throw new Error(b.status);
    return { listing: r.listing, order: b.order };
  };

  it('運営が返金すると買った人に戻り、2 回目は何もしない', async () => {
    const { walletOf } = await import('../src/services/economy.js');
    const { order } = await setup();
    expect((await get('/market', await login(USER))).status).not.toBe(200);
    const s = await login(STAFF);
    expect(await (await get('/market', s)).text()).toContain('アイコン');
    expect((await form(s, `/market/orders/${order.id}/refund`)).headers.get('location')).toBe('/market?msg=refunded');
    expect((await walletOf(db, USER)).balance).toBe(1000);
    expect(actions).toContain(`dm ${USER}`);
    expect((await form(s, `/market/orders/${order.id}/release`)).headers.get('location')).toBe('/market?msg=done_already');
    expect((await walletOf(db, SELLER)).balance).toBe(0);
    expect((await listAudit(db, { action: 'market.refund' })).length).toBe(1);
  });

  it('運営が完了にすると手数料を引いて売った人へ。出品の取り下げはカードも直す', async () => {
    const { walletOf } = await import('../src/services/economy.js');
    const { listing, order } = await setup();
    const s = await login(STAFF);
    expect((await form(s, `/market/orders/${order.id}/release`)).headers.get('location')).toBe('/market?msg=released');
    expect((await walletOf(db, SELLER)).balance).toBe(900);
    expect((await form(s, `/market/listings/${listing.id}/remove`)).headers.get('location')).toBe('/market?msg=removed');
    expect(actions.some((a) => a.startsWith('edit 920000000000000002'))).toBe(true);
    expect((await form(s, `/market/listings/${listing.id}/remove`)).headers.get('location')).toBe('/market?msg=done_already');
  });

  it('依頼の募集が出て、運営が締め切れる（カードも直す）', async () => {
    const { createRequest, setRequestMessage } = await import('../src/services/market.js');
    const r = await createRequest(db, USER, { category: 'illust', title: '立ち絵がほしい', description: '', budget: 1500 });
    if (r.status !== 'ok') throw new Error(r.status);
    await setRequestMessage(db, r.request.id, '920000000000000001', '920000000000000003');
    const s = await login(STAFF);
    expect(await (await get('/market', s)).text()).toContain('立ち絵がほしい');
    expect((await form(s, `/market/requests/${r.request.id}/close`)).headers.get('location')).toBe('/market?msg=request_closed');
    expect(actions.some((a) => a.startsWith('edit 920000000000000003'))).toBe(true);
    expect((await form(s, `/market/requests/${r.request.id}/close`)).headers.get('location')).toBe('/market?msg=done_already');
  });
});

describe('物御籤（管理画面）', () => {
  const post = async (session: string, path: string, form: Record<string, string>) => {
    const csrf = /name="_csrf" value="([^"]+)"/.exec(await (await get('/', session)).text())![1]!;
    return app.request(path, {
      method: 'POST',
      headers: { cookie: `shamusho_session=${session}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, ...form }).toString(),
    });
  };

  it('神職も見られる: 回数・運勢ごとの割合・最近の結果・券を持っている人・よく引いている人', async () => {
    const { drawGacha } = await import('../src/services/gacha.js');
    await addCoins(db, USER, 1000, 'adjust');
    await drawGacha(db, cfg.gacha, USER, 1, [], () => 0);
    await drawGacha(db, cfg.gacha, USER, 1, [], () => 0.99);
    const s = await login(STAFF);
    const res = await get('/gacha', s);
    expect(res.status).toBe(200);
    const html = await res.text();
    for (const t of ['🎲 物御籤', '引かれた回数', '最近の大吉', 'よく引いている人', '券を持っている人', '部屋代無料券', '絵馬のピン留め券', '50%', `/members/${USER}`, '🟢 いま引けます'])
      expect(html).toContain(t);
    // 変えるフォームは宮司だけ
    expect(html).not.toContain('action="/gacha/');
    const guji = await (await get('/gacha', await login(GUJI))).text();
    for (const t of ['action="/gacha/toggle"', 'action="/gacha/settings"', 'action="/gacha/prizes"', '物御籤を止める']) expect(guji).toContain(t);
    // メンバーのページにも（券を渡すフォームは宮司だけ）
    const member = await (await get(`/members/${USER}`, s)).text();
    expect(member).toContain('🎁 物御籤');
    expect(member).toContain('引いた回数 <strong>2</strong>');
    expect(member).not.toContain('/tickets"');
  });

  it('ON/OFF・値段・天井・出やすさを変える（宮司のみ）', async () => {
    const { ConfigStore } = await import('../src/services/settings.js');
    const store = new ConfigStore(db, cfg);
    app = createWebApp({ db, cfg: () => store.current, fileCfg: cfg, onSettingsSaved: () => store.refresh(), api: fakeApi, discord: fakeActions, baseUrl: BASE, now: () => clock });
    const s = await login(STAFF);
    expect((await post(s, '/gacha/toggle', { enabled: 'no' })).status).toBe(403);
    const g = await login(GUJI);
    expect((await post(g, '/gacha/toggle', { enabled: 'no' })).headers.get('location')).toBe('/gacha?msg=gacha_off#gacha-basic');
    expect(store.current.gacha.enabled).toBe(false);
    expect(await (await get('/gacha', g)).text()).toContain('物御籤を始める');
    const rates = { 'rate.daikichi': '10', 'rate.chukichi': '20', 'rate.shokichi': '30', 'rate.kichi': '40' };
    expect((await post(g, '/gacha/settings', { price: '300', pity: '0', ...rates })).headers.get('location')).toBe('/gacha?msg=gacha_saved#gacha-basic');
    expect(store.current.gacha).toMatchObject({ enabled: false, price: 300, pity: 0, rates: { daikichi: 10, kichi: 40 } });
    expect((await post(g, '/gacha/settings', { price: '0', pity: '0', ...rates })).headers.get('location')).toContain('gacha_invalid');
    expect((await post(g, '/gacha/settings', { price: '300', pity: '0', 'rate.super': '0', 'rate.daikichi': '0', 'rate.chukichi': '0', 'rate.shokichi': '0', 'rate.kichi': '0' })).headers.get('location')).toContain(
      'gacha_invalid',
    );
    expect((await post(g, '/gacha/toggle', { enabled: 'yes' })).headers.get('location')).toContain('gacha_on');
    expect(store.current.gacha).toMatchObject({ enabled: true, price: 300 });
    expect((await listAudit(db, { action: 'gacha.settings' })).length).toBe(3);
  });

  it('中身を足す・変える・ON/OFF・削除する（宮司のみ。ショップのロールの品も出せる）', async () => {
    const { listPrizes } = await import('../src/services/gacha.js');
    const { createItem } = await import('../src/services/shop.js');
    const item = await createItem(db, { kind: 'role', name: '色守り（桜）', emoji: '🌸', description: '', price: 1500, roleId: '100000000000000081', roleGroup: 'color', durationDays: 30, enabled: false });
    const hana = await createItem(db, { kind: 'hanafubuki', name: '花吹雪', emoji: '🌸', description: '', price: 300 });
    const s = await login(STAFF);
    expect((await post(s, '/gacha/prizes', { tier: 'kichi', kind: 'coins', amount: '100', weight: '1' })).status).toBe(403);
    const g = await login(GUJI);
    await get('/gacha', g);
    const before = (await listPrizes(db)).length;
    const add = async (form: Record<string, string>) => (await post(g, '/gacha/prizes', form)).headers.get('location');
    expect(await add({ tier: 'kichi', kind: 'coins', amount: '100', weight: '2' })).toBe('/gacha?msg=prize_added#gacha-prizes');
    expect(await add({ tier: 'daikichi', kind: 'shop', shopItemId: String(item.id), weight: '1', fallback: 'yes' })).toContain('prize_added');
    expect(await add({ tier: 'daikichi', kind: 'role', roleId: '100000000000000091', weight: '1' })).toContain('prize_added');
    expect(await add({ tier: 'chukichi', kind: 'ticket', ticket: 'ema_pin', amount: '2', weight: '1' })).toContain('prize_added');
    // おかしな入力は足さない（花吹雪はロールの品ではない・ロールなし・重み 0）
    expect(await add({ tier: 'kichi', kind: 'shop', shopItemId: String(hana.id), weight: '1' })).toContain('prize_invalid');
    expect(await add({ tier: 'kichi', kind: 'role', roleId: '', weight: '1' })).toContain('prize_invalid');
    expect(await add({ tier: 'kichi', kind: 'coins', amount: '10', weight: '0' })).toContain('prize_invalid');
    expect(await add({ tier: 'nope', kind: 'coins', amount: '10', weight: '1' })).toContain('prize_invalid');
    const list = await listPrizes(db);
    expect(list.length).toBe(before + 4);
    const coins = list.find((p) => p.kind === 'coins')!;
    expect(coins).toMatchObject({ tier: 'kichi', amount: 100, weight: 2, fallback: false, enabled: true });
    expect(list.find((p) => p.kind === 'shop')).toMatchObject({ shopItemId: item.id, fallback: true });
    expect(await (await get('/gacha', g)).text()).toContain('色守り（桜）');

    expect((await post(g, `/gacha/prizes/${coins.id}`, { amount: '250', weight: '5', fallback: 'yes' })).headers.get('location')).toContain('prize_saved');
    expect((await post(g, `/gacha/prizes/${coins.id}/toggle`, {})).headers.get('location')).toContain('prize_off');
    expect((await listPrizes(db)).find((p) => p.id === coins.id)).toMatchObject({ amount: 250, weight: 5, fallback: true, enabled: false });
    expect((await post(g, `/gacha/prizes/${coins.id}/toggle`, {})).headers.get('location')).toContain('prize_on');
    expect((await post(g, `/gacha/prizes/${coins.id}/delete`, {})).headers.get('location')).toContain('prize_deleted');
    expect((await post(g, `/gacha/prizes/${coins.id}/delete`, {})).headers.get('location')).toContain('prize_not_found');
    expect((await listPrizes(db)).some((p) => p.id === coins.id)).toBe(false);
    expect((await listAudit(db, { action: 'gacha.prize_add' })).length).toBe(4);
  });

  it('リセット（宮司のみ・「リセット」と入れる）: 返金・取り上げ・ロールを外す・DM・記録', async () => {
    const { drawGacha, createPrize, ensureGachaPrizes, listPrizes, deletePrize } = await import('../src/services/gacha.js');
    const { walletOf } = await import('../src/services/economy.js');
    await ensureGachaPrizes(db, cfg.gacha);
    for (const p of await listPrizes(db)) await deletePrize(db, p.id);
    await createPrize(db, { tier: 'kichi', kind: 'role', roleId: '100000000000000091', amount: 1, weight: 1, fallback: false });
    await addCoins(db, USER, 500, 'adjust');
    await drawGacha(db, cfg.gacha, USER, 1, [], () => 0.5);
    expect((await walletOf(db, USER)).balance).toBe(0);
    const s = await login(STAFF);
    expect(await (await get('/gacha', s)).text()).not.toContain('action="/gacha/reset"');
    expect((await post(s, '/gacha/reset', { confirm: 'リセット' })).status).toBe(403);
    const g = await login(GUJI);
    const page = await (await get('/gacha', g)).text();
    expect(page).toContain('action="/gacha/reset"');
    expect(page).toContain('1 回</strong>（1 人）');
    expect((await post(g, '/gacha/reset', { confirm: 'りせっと' })).headers.get('location')).toContain('gacha_reset_confirm');
    expect((await walletOf(db, USER)).balance).toBe(0);
    actions.length = 0;
    expect((await post(g, '/gacha/reset', { confirm: 'リセット', dm: 'yes' })).headers.get('location')).toBe('/gacha?msg=gacha_reset#gacha-basic');
    expect((await walletOf(db, USER)).balance).toBe(500);
    expect(actions).toContain(`removeRole ${USER} 100000000000000091`);
    expect(actions).toContain(`dm ${USER}`);
    expect((await listAudit(db, { action: 'gacha.reset' }))[0]?.detail).toMatchObject({ draws: 1, refunded: 500, roles: 1 });
  });

  it('中身をまとめて ON・OFF・削除（選んだもの・全部）', async () => {
    const { listPrizes, createPrize } = await import('../src/services/gacha.js');
    const g = await login(GUJI);
    await get('/gacha', g);
    const a = await createPrize(db, { tier: 'kichi', kind: 'coins', amount: 10, weight: 1, fallback: false });
    const b = await createPrize(db, { tier: 'kichi', kind: 'coins', amount: 20, weight: 1, fallback: false });
    const bulk = async (form: [string, string][]) => {
      const csrf = /name="_csrf" value="([^"]+)"/.exec(await (await get('/', g)).text())![1]!;
      const body = new URLSearchParams([['_csrf', csrf], ...form]);
      return (await app.request('/gacha/prizes/bulk', { method: 'POST', headers: { cookie: `shamusho_session=${g}`, 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() })).headers.get('location');
    };
    expect(await bulk([['action', 'off']])).toContain('prize_bulk_none');
    expect(await bulk([['action', 'off'], ['ids', String(a.id)], ['ids', String(b.id)]])).toBe('/gacha?msg=prize_bulk#gacha-prizes');
    expect((await listPrizes(db)).filter((p) => [a.id, b.id].includes(p.id)).map((p) => p.enabled)).toEqual([false, false]);
    expect(await bulk([['action', 'all_on']])).toContain('prize_bulk');
    expect((await listPrizes(db)).every((p) => p.enabled)).toBe(true);
    expect(await bulk([['action', 'all_off']])).toContain('prize_bulk');
    expect((await listPrizes(db)).some((p) => p.enabled)).toBe(false);
    expect(await bulk([['action', 'delete'], ['ids', String(a.id)]])).toContain('prize_bulk');
    expect((await listPrizes(db)).some((p) => p.id === a.id)).toBe(false);
    const s = await login(STAFF);
    const csrf = /name="_csrf" value="([^"]+)"/.exec(await (await get('/', s)).text())![1]!;
    expect((await app.request('/gacha/prizes/bulk', { method: 'POST', headers: { cookie: `shamusho_session=${s}`, 'content-type': 'application/x-www-form-urlencoded' }, body: `_csrf=${csrf}&action=all_on` })).status).toBe(403);
  });

  it('運営が渡す賞品（超大当たり）: 足す・当たりの一覧・「渡した」', async () => {
    const { drawGacha, listPrizes, listClaims } = await import('../src/services/gacha.js');
    const g = await login(GUJI);
    await get('/gacha', g);
    expect(await (await post(g, '/gacha/prizes', { tier: 'super', kind: 'special', label: '', stock: '1', weight: '1' })).headers.get('location')).toContain('prize_invalid');
    expect((await post(g, '/gacha/prizes', { tier: 'super', kind: 'special', label: 'Discord Nitro 1 か月分', stock: '1', weight: '1' })).headers.get('location')).toContain('prize_added');
    const nitro = (await listPrizes(db)).find((p) => p.kind === 'special')!;
    expect(nitro).toMatchObject({ tier: 'super', label: 'Discord Nitro 1 か月分', stock: 1 });
    // 残りを変える（空でいくらでも）
    expect((await post(g, `/gacha/prizes/${nitro.id}`, { weight: '1', stock: '' })).headers.get('location')).toContain('prize_saved');
    expect((await listPrizes(db)).find((p) => p.id === nitro.id)?.stock).toBeNull();
    await addCoins(db, USER, 500, 'adjust');
    await drawGacha(db, cfg.gacha, USER, 1, [], () => 0);
    const page = await (await get('/gacha', g)).text();
    expect(page).toContain('🎊 運営が渡す賞品');
    expect(page).toContain('🎊 Discord Nitro 1 か月分');
    const claim = (await listClaims(db))[0]!;
    expect(page).toContain(`/gacha/claims/${claim.id}/done`);
    expect((await post(g, `/gacha/claims/${claim.id}/done`, {})).headers.get('location')).toBe('/gacha?msg=claim_done#gacha-claims');
    expect((await post(g, `/gacha/claims/${claim.id}/done`, {})).headers.get('location')).toContain('claim_done_already');
    expect((await listAudit(db, { action: 'gacha.claim_done' })).length).toBe(1);
  });

  it('用語集: 神職は見るだけ。宮司は言葉を入れる・直す・掲示に反映・#用語集 を作る', async () => {
    const { listTerms } = await import('../src/services/glossary.js');
    const s = await login(STAFF);
    const view = await (await get('/glossary', s)).text();
    expect(view).toContain('📖 用語集');
    expect(view).not.toContain('action="/glossary/seed"');
    expect((await post(s, '/glossary/seed', {})).status).toBe(403);
    const g = await login(GUJI);
    expect((await post(g, '/glossary/seed', {})).headers.get('location')).toBe('/glossary?msg=seeded');
    const page = await (await get('/glossary', g)).text();
    expect(page).toContain('金の10連券');
    expect(page).toContain('サーバーの中だけのお金');
    // {#しきたり} などはプレビューでは #名前
    expect(page).toContain('#しきたり');
    expect((await post(g, '/glossary', { category: 'gacha', term: '', description: 'x' })).headers.get('location')).toContain('msg=invalid');
    const added = await post(g, '/glossary', { category: 'gacha', term: '推し券', description: '推しに会える券', aliases: 'おし' });
    expect(added.headers.get('location')).toMatch(/msg=added#term-\d+/);
    const t = (await listTerms(db)).find((x) => x.term === '推し券')!;
    expect(await (await get(`/glossary?edit=${t.id}`, g)).text()).toContain(`action="/glossary/${t.id}"`);
    await post(g, `/glossary/${t.id}`, { category: 'gacha', term: '推し券', description: '推しと話せる券' });
    expect((await listTerms(db)).find((x) => x.id === t.id)?.description).toBe('推しと話せる券');
    await post(g, `/glossary/${t.id}/toggle`, {});
    expect((await listTerms(db)).find((x) => x.id === t.id)?.enabled).toBe(false);
    // #用語集 を作る → 掲示に反映
    actions = [];
    const places = await (await get('/glossary', g)).text();
    expect(places).toContain('action="/glossary/places"');
    expect(places).toContain('<option value="910000000000000001" selected="">⛩ 鳥居</option>');
    expect((await post(g, '/glossary/channel', {})).headers.get('location')).toBe('/glossary?msg=channel_nocategory#glossary-places');
    expect((await post(g, '/glossary/channel', { categoryId: '910000000000000001' })).headers.get('location')).toBe('/glossary?msg=channel_created#glossary-places');
    expect(actions.find((a) => a.startsWith('createChannel'))).toContain('"name":"用語集"');
    const { loadGlossaryPlaces } = await import('../src/services/glossary.js');
    expect((await loadGlossaryPlaces(db)).glossaryChannelId).toBe('910000000000000099');
    // 出すチャンネルを選ぶ（通話やカテゴリは選べない）
    expect((await post(g, '/glossary/places', { rulesChannelId: '910000000000000004' })).headers.get('location')).toContain('msg=places_invalid');
    expect((await post(g, '/glossary/places', { rulesChannelId: '910000000000000002' })).headers.get('location')).toContain('msg=places_saved');
    expect((await loadGlossaryPlaces(db)).rulesChannelId).toBe('910000000000000002');
    await post(g, '/glossary/places', { rulesChannelId: '910000000000000003' });
    expect((await post(g, '/glossary/sync', {})).headers.get('location')).toContain('/glossary?msg=synced');
    expect((await listNotices(db)).some((n) => n.title === '用語集')).toBe(true);
    await post(g, `/glossary/${t.id}/delete`, {});
    expect((await listTerms(db)).some((x) => x.id === t.id)).toBe(false);
  });

  it('経済の見守り: イベントを作る・やめる、見守りの設定、1 人ずつの収支（変えるのは宮司だけ）', async () => {
    const { listEvents } = await import('../src/services/economyEvents.js');
    const { loadOverrides } = await import('../src/services/settings.js');
    await addCoins(db, USER, 3000, 'join_bonus');
    const s = await login(STAFF);
    const view = await (await get('/economy', s)).text();
    for (const t of ['期間限定イベント', '物御籤の収支', '値段の目安', 'サブアカウントの疑い', '最近の警告', '見守りの設定']) expect(view).toContain(t);
    expect(view).not.toContain('action="/economy/events"');
    expect((await post(s, '/economy/events', { kind: 'voice', value: '200', title: 'x', startsAt: '2026-10-01T00:00', endsAt: '2026-10-08T00:00' })).status).toBe(403);
    const ledger = await (await get(`/economy/members/${USER}`, s)).text();
    expect(ledger).toContain('の収支');
    expect(ledger).toContain('初期配布');

    const g = await login(GUJI);
    expect(await (await get('/economy', g)).text()).toContain('action="/economy/events"');
    const bad = await post(g, '/economy/events', { kind: 'shop', value: '95', title: 'セール', startsAt: '2026-10-01T00:00', endsAt: '2026-10-08T00:00' });
    expect(bad.headers.get('location')).toContain('event_invalid');
    const ok = await post(g, '/economy/events', { kind: 'shop', value: '30', title: '秋のセール', startsAt: '2026-10-01T00:00', endsAt: '2026-10-08T00:00' });
    expect(ok.headers.get('location')).toBe('/economy?msg=event_created#economy-events');
    const [ev] = await listEvents(db);
    expect(ev).toMatchObject({ kind: 'shop', value: 30, title: '秋のセール', startsAt: new Date('2026-09-30T15:00:00Z') });
    expect(await (await get('/economy', g)).text()).toContain('秋のセール');
    await post(g, `/economy/events/${ev!.id}/cancel`, {});
    expect((await listEvents(db))[0]!.cancelledAt).not.toBeNull();
    // 🎫 通話で券（その日の通話が 10 分で 物御籤の無料券 ×2）
    const vt = await post(g, '/economy/events', { kind: 'voice_ticket', value: '10', ticket: 'gacha_free', ticketCount: '2', title: '通話で券の日', startsAt: '2026-10-03T00:00', endsAt: '2026-10-03T23:59' });
    expect(vt.headers.get('location')).toBe('/economy?msg=event_created#economy-events');
    expect((await listEvents(db)).find((e) => e.kind === 'voice_ticket')).toMatchObject({ value: 10, ticket: 'gacha_free', ticketCount: 2 });
    const tooMany = await post(g, '/economy/events', { kind: 'voice_ticket', value: '10', ticket: 'gacha_free', ticketCount: '50', title: 'x', startsAt: '2026-10-03T00:00', endsAt: '2026-10-03T23:59' });
    expect(tooMany.headers.get('location')).toContain('event_invalid');
    expect(await (await get('/economy', g)).text()).toContain('その日の通話が 10 分になると 🎁物御籤の無料券 ×2');

    const saved = await post(g, '/economy/settings', {
      reportEnabled: 'yes',
      reportWeekday: '5',
      reportHour: '21',
      channelId: '',
      alertsEnabled: 'yes',
      alertEarn24h: '8000',
      alertSpend24h: '30000',
      saisenThreshold: '100000',
      saisenPercent: '2',
    });
    expect(saved.headers.get('location')).toBe('/economy?msg=watch_saved#economy-watch');
    expect((await loadOverrides(db)).economyOps).toMatchObject({ reportWeekday: 5, reportHour: 21, alertEarn24h: 8000, saisenEnabled: false, saisenPercent: 2, channelId: null });
    expect((await post(g, '/economy/settings', { reportWeekday: '9', reportHour: '1', alertEarn24h: '1', alertSpend24h: '1', saisenThreshold: '1', saisenPercent: '50' })).headers.get('location')).toContain('watch_invalid');
  });

  it('経済のページ: 神職も見られる。期間を切り替えられる', async () => {
    await addCoins(db, USER, 3000, 'join_bonus');
    const s = await login(STAFF);
    const html = await (await get('/economy', s)).text();
    for (const t of ['経済（🪙銭の流れ）', 'いま出回っている銭', '鯖の収入の内訳', '配った内訳', '持っている量のかたより', 'ジニ係数', '初期配布', 'href="/economy"'])
      expect(html).toContain(t);
    expect(html).toContain('3,000');
    expect((await get('/economy?range=1y', s)).status).toBe(200);
    expect((await app.request('/economy')).status).toBe(302);
  });

  it('🔔 通知 OK／NG: ロールを用意して今いる人を OK に・ボタンを置く・設定を保存しても残る', async () => {
    const { ConfigStore } = await import('../src/services/settings.js');
    const store = new ConfigStore(db, cfg);
    app = createWebApp({ db, cfg: () => store.current, fileCfg: cfg, onSettingsSaved: () => store.refresh(), api: fakeApi, discord: fakeActions, baseUrl: BASE, now: () => clock });
    const OK = '980000000000000070';
    const saved = roleList;
    // 🔔 通知OK は前からある（同じ名前を使う）・🔕 通知NG は新しく作る
    roleList = [{ id: OK, name: '🔔 通知OK', position: 1, managed: false, color: 0, permissions: '0' }];
    try {
      const s = await login(STAFF);
      expect((await post(s, '/settings/notify/create', {})).status).toBe(403);
      const g = await login(GUJI);
      expect(await (await get('/settings', g)).text()).toContain('action="/settings/notify/create"');
      actions = [];
      const r = await post(g, '/settings/notify/create', {});
      expect(r.headers.get('location')).toBe('/settings?msg=notify_started&at=notify#sec-notify');
      expect(store.current.notify).toEqual({ okRoleId: OK, ngRoleId: '980000000000000099' });
      expect(actions.some((a) => a.startsWith('createRole') && a.includes('🔕 通知NG'))).toBe(true);
      for (let i = 0; i < 50 && !actions.includes(`addRole ${USER} ${OK}`); i++) await new Promise((res) => setTimeout(res, 20));
      expect(actions).toContain(`addRole ${USER} ${OK}`);
      const page = await (await get('/settings', g)).text();
      expect(page).toContain('🔔 <b>🔔 通知OK</b>: 1 人');
      expect(page).toContain('action="/settings/notify/panel"');
      // ボタンを置く
      actions = [];
      expect((await post(g, '/settings/notify/panel', { channelId: '' })).headers.get('location')).toContain('notify_panel_invalid');
      expect((await post(g, '/settings/notify/panel', { channelId: '910000000000000003' })).headers.get('location')).toContain('msg=notify_panel');
      expect(actions.some((a) => a.startsWith('send 910000000000000003'))).toBe(true);
      // 設定のほかの項目を保存しても残る
      const form = Object.fromEntries([...page.matchAll(/name="([^"]+)"[^>]*?value="([^"]*)"/g)].map((m) => [m[1]!, m[2]!]));
      delete form._csrf;
      expect((await post(g, '/settings', { ...form, at: 'coins' })).headers.get('location')).toContain('msg=saved');
      expect(store.current.notify.okRoleId).toBe(OK);
    } finally {
      roleList = saved;
    }
  });

  it('おみくじを続けたおまけ: 設定で決める（日数が空の行は使わない・危ないロールは選べない）', async () => {
    const { ConfigStore } = await import('../src/services/settings.js');
    const store = new ConfigStore(db, cfg);
    app = createWebApp({ db, cfg: () => store.current, fileCfg: cfg, onSettingsSaved: () => store.refresh(), api: fakeApi, discord: fakeActions, baseUrl: BASE, now: () => clock });
    const TITLE = '980000000000000060';
    const saved = roleList;
    roleList = [
      { id: TITLE, name: '皆勤', position: 1, managed: false, color: 0, permissions: '0' },
      { id: '980000000000000061', name: '危ない', position: 1, managed: false, color: 0, permissions: '8' },
    ];
    try {
      const g = await login(GUJI);
      const page = await (await get('/settings', g)).text();
      expect(page).toContain('🔥 おみくじを続けたおまけ');
      expect(page).toContain('name="streak.0.days" min="2" max="365" value="7"');
      const roleSelect = page.slice(page.indexOf('name="streak.0.roleId"'), page.indexOf('</select>', page.indexOf('name="streak.0.roleId"')));
      expect(roleSelect).toContain(`value="${TITLE}">@皆勤`);
      expect(roleSelect).not.toContain('@危ない');
      const form = Object.fromEntries(
        [...page.matchAll(/name="([^"]+)"[^>]*?value="([^"]*)"/g)].map((m) => [m[1]!, m[2]!]));
      delete form._csrf;
      const base: Record<string, string> = {
        ...form,
        at: 'coins',
        'streak.0.days': '3',
        'streak.0.repeat': 'yes',
        'streak.0.coins': '20',
        'streak.0.ticket': 'none',
        'streak.0.tickets': '0',
        'streak.0.roleId': '',
        'streak.1.days': '30',
        'streak.1.coins': '0',
        'streak.1.ticket': 'gacha_free',
        'streak.1.tickets': '2',
        'streak.1.roleId': TITLE,
        'streak.2.days': '',
      };
      for (const k of Object.keys(base)) if (/^streak\.[2-4]\./.test(k) && k.endsWith('.days')) base[k] = '';
      delete (base as Record<string, string>)['streak.1.repeat'];
      const res = await post(g, '/settings', base);
      expect(res.headers.get('location')).toBe('/settings?msg=saved&at=coins#sec-coins');
      expect(store.current.omikujiStreak.rewards).toEqual([
        { days: 3, repeat: true, coins: 20, ticket: 'none', tickets: 0 },
        { days: 30, repeat: false, coins: 0, ticket: 'gacha_free', tickets: 2, roleId: TITLE },
      ]);
      expect((await post(g, '/settings', { ...base, 'streak.1.roleId': '980000000000000061' })).headers.get('location')).toContain('settings_invalid');
      expect((await post(g, '/settings', { ...base, 'streak.0.days': '1' })).headers.get('location')).toContain('settings_invalid');
      expect(store.current.omikujiStreak.rewards).toHaveLength(2);
    } finally {
      roleList = saved;
    }
  });

  it('🎁 全員にプレゼント（宮司だけ・二度押しでも 1 回・お知らせ）', async () => {
    const { ticketsOf } = await import('../src/services/tickets.js');
    const { recentGifts } = await import('../src/services/gifts.js');
    const s = await login(STAFF);
    expect(await (await get('/gacha', s)).text()).not.toContain('action="/gacha/gift"');
    expect((await post(s, '/gacha/gift', { item: 'fuku', count: '1', note: 'x', confirm: 'yes', nonce: randomUUIDLike(1) })).status).toBe(403);
    const g = await login(GUJI);
    const page = await (await get('/gacha', g)).text();
    expect(page).toContain('🎁 全員にプレゼント');
    const nonce = /name="nonce" value="([0-9a-f-]{36})"/.exec(page)![1]!;
    expect((await post(g, '/gacha/gift', { item: 'fuku', count: '0', note: '1 周年', confirm: 'yes', nonce })).headers.get('location')).toContain('gift_invalid');
    expect((await post(g, '/gacha/gift', { item: 'fuku', count: '1', note: '1 周年', nonce })).headers.get('location')).toContain('gift_invalid');
    actions = [];
    const ok = await post(g, '/gacha/gift', { item: 'fuku', count: '2', note: '1 周年', confirm: 'yes', nonce, announce: '910000000000000002', everyone: 'yes' });
    expect(ok.headers.get('location')).toBe('/gacha?msg=gift_announced#gacha-gift');
    expect((await ticketsOf(db, USER)).fuku).toBe(2);
    expect(actions.find((a) => a.startsWith('send 910000000000000002'))).toContain('@everyone\n🎁 **運営からみなさんへプレゼント！**');
    // 同じ画面から 2 回目
    expect((await post(g, '/gacha/gift', { item: 'fuku', count: '2', note: '1 周年', confirm: 'yes', nonce })).headers.get('location')).toContain('gift_dup');
    expect((await ticketsOf(db, USER)).fuku).toBe(2);
    const [batch] = await recentGifts(db);
    expect(batch).toMatchObject({ label: '🧧福の札', count: 2, note: '1 周年' });
    expect(batch!.recipients).toBeGreaterThanOrEqual(1);
    expect(await (await get('/gacha', g)).text()).toContain('これまでのプレゼント');
    // すべての役職に通知
    actions = [];
    await post(g, '/gacha/gift', { item: 'fuku', count: '1', note: '秋祭り', confirm: 'yes', nonce: randomUUIDLike(9), announce: '910000000000000002', ping: 'ranks' });
    const rankHead = [...new Set(cfg.ranks.map((x) => x.roleId))].map((id) => `<@&${id}>`).join(' ');
    expect(actions.find((a) => a.startsWith('send 910000000000000002'))).toContain(`${rankHead}\n🎁`);
    // 持っている人がいないロールで絞る
    expect((await post(g, '/gacha/gift', { item: 'coins', count: '100', note: 'x', confirm: 'yes', nonce: randomUUIDLike(2), roleId: '990000000000000077' })).headers.get('location')).toContain('gift_none');
  });

  it('🎁 全員にプレゼント: 入った日で絞る・ふつうのロールを配る（お詫びなど）', async () => {
    const { ticketsOf } = await import('../src/services/tickets.js');
    const LATE = '850000000000000777';
    await recordJoin(db, { id: LATE, username: 'late', displayName: 'late', avatarUrl: null, roleIds: [ROLE.sanpaisha], isBot: false, joinedAt: new Date('2026-09-30T00:30:00+09:00') });
    const SORRY = '980000000000000050';
    const ADMINISH = '980000000000000051';
    const saved = roleList;
    roleList = [
      { id: SORRY, name: 'お詫びの印', position: 1, managed: false, color: 0, permissions: '0' },
      { id: ADMINISH, name: '危ない', position: 1, managed: false, color: 0, permissions: '8' },
      { id: ROLE.sanpaisha, name: '参拝者', position: 1, managed: false, color: 0, permissions: '0' },
    ];
    try {
      const g = await login(GUJI);
      const page = await (await get('/gacha', g)).text();
      expect(page).toContain(`value="role:${SORRY}"`);
      expect(page).not.toContain(`value="role:${ADMINISH}"`);
      expect(page).not.toContain(`value="role:${ROLE.sanpaisha}"`);
      expect(page).toContain('name="joinedBy"');
      // 危ない権限・役職のロールは配れない
      for (const id of [ADMINISH, ROLE.sanpaisha])
        expect((await post(g, '/gacha/gift', { item: `role:${id}`, count: '1', note: 'x', confirm: 'yes', nonce: randomUUIDLike(31) })).headers.get('location')).toContain('gift_invalid');
      expect((await post(g, '/gacha/gift', { item: 'gacha_free', count: '2', note: 'x', confirm: 'yes', nonce: randomUUIDLike(32), joinedBy: '9/29' })).headers.get('location')).toContain('gift_invalid');
      actions = [];
      const r = await post(g, '/gacha/gift', { item: `role:${SORRY}`, count: '1', note: 'リセットのお詫び', confirm: 'yes', nonce: randomUUIDLike(33), joinedBy: '2026-09-29', announce: '910000000000000002' });
      expect(r.headers.get('location')).toContain('gift_announced');
      await new Promise((res) => setTimeout(res, 10));
      expect(actions).toContain(`addRole ${USER} ${SORRY}`);
      expect(actions).not.toContain(`addRole ${LATE} ${SORRY}`);
      expect(actions.find((a) => a.startsWith('send 910000000000000002'))).toContain('9月29日までに入ったみなさんへプレゼント');
      expect(actions.find((a) => a.startsWith('send 910000000000000002'))).toContain('ロール **@お詫びの印** をお付けしました');
      // 券 2 枚ずつ（同じ日で絞る）
      expect((await post(g, '/gacha/gift', { item: 'gacha_free', count: '2', note: 'リセットのお詫び', confirm: 'yes', nonce: randomUUIDLike(34), joinedBy: '2026-09-29' })).headers.get('location')).toContain(
        'gift_given',
      );
      expect((await ticketsOf(db, USER)).gacha_free).toBe(2);
      expect((await ticketsOf(db, LATE)).gacha_free).toBe(0);
      // 日をまちがえた（10 月 29 日）: LATE にも渡る → 入った日を 9 月 29 日に直して取り消す
      expect((await post(g, '/gacha/gift', { item: 'fuku', count: '3', note: '秋', confirm: 'yes', nonce: randomUUIDLike(35), joinedBy: '2026-10-29' })).headers.get('location')).toContain('gift_given');
      expect((await ticketsOf(db, LATE)).fuku).toBe(3);
      const { recentGifts } = await import('../src/services/gifts.js');
      const [wrong] = await recentGifts(db);
      expect(await (await get('/gacha', g)).text()).toContain('入った日を直す…');
      const preview = await (await get(`/gacha?narrow=${wrong!.id}&joinedBy=2026-09-29`, g)).text();
      expect(preview).toContain('プレゼントの入った日を直す');
      expect(preview).toContain('9月29日までに入った人');
      expect(preview).toContain('>late</a>');
      expect(preview).toContain(`action="/gacha/gift/${wrong!.id}/narrow"`);
      // スタッフはできない・チェックがないとしない
      expect((await post(await login(STAFF), `/gacha/gift/${wrong!.id}/narrow`, { joinedBy: '2026-09-29', confirm: 'yes' })).status).toBe(403);
      expect((await post(g, `/gacha/gift/${wrong!.id}/narrow`, { joinedBy: '2026-09-29' })).headers.get('location')).toContain('gift_narrow_invalid');
      expect((await ticketsOf(db, LATE)).fuku).toBe(3);
      const done = await post(g, `/gacha/gift/${wrong!.id}/narrow`, { joinedBy: '2026-09-29', confirm: 'yes' });
      expect(done.headers.get('location')).toBe('/gacha?msg=gift_narrowed&n=1&taken=3&short=0#gacha-gift');
      expect((await ticketsOf(db, LATE)).fuku).toBe(0);
      expect((await ticketsOf(db, USER)).fuku).toBeGreaterThanOrEqual(3);
      expect(await (await get('/gacha?msg=gift_narrowed&n=1&taken=3&short=0', g)).text()).toContain('1 人から取り消しました');
      expect((await post(g, `/gacha/gift/${wrong!.id}/narrow`, { joinedBy: '2026-09-29', confirm: 'yes' })).headers.get('location')).toContain('gift_narrow_none');
    } finally {
      roleList = saved;
    }
  });

  it('自由な券: 作る・ON/OFF・物御籤の中身に足す・メンバーに渡す', async () => {
    const { listCustomTickets, customHoldingsOf } = await import('../src/services/customTickets.js');
    const { listPrizes } = await import('../src/services/gacha.js');
    const s = await login(STAFF);
    expect((await post(s, '/gacha/custom', { emoji: '🎤', name: 'リクエスト曲券' })).status).toBe(403);
    const g = await login(GUJI);
    expect((await post(g, '/gacha/custom', { emoji: '🎤', name: '' })).headers.get('location')).toContain('custom_invalid');
    expect((await post(g, '/gacha/custom', { emoji: '🎤', name: 'リクエスト曲券', note: '1 曲歌います' })).headers.get('location')).toBe('/gacha?msg=custom_created#gacha-custom');
    const t = (await listCustomTickets(db))[0]!;
    expect(t).toMatchObject({ emoji: '🎤', name: 'リクエスト曲券', note: '1 曲歌います', enabled: true });
    const page = await (await get('/gacha', g)).text();
    expect(page).toContain('🎤 リクエスト曲券');
    expect(page).toContain('name="customTicketId"');
    expect((await post(g, '/gacha/prizes', { tier: 'kichi', kind: 'custom', customTicketId: String(t.id), amount: '2', weight: '1' })).headers.get('location')).toContain('prize_added');
    expect((await listPrizes(db)).find((p) => p.kind === 'custom')).toMatchObject({ customTicketId: t.id, amount: 2 });
    // メンバーに渡す（DM）
    expect(await (await get(`/members/${USER}`, g)).text()).toContain(`value="custom:${t.id}"`);
    const to = (form: Record<string, string>) => post(g, `/members/${USER}/tickets`, form).then((r) => r.headers.get('location'));
    expect(await to({ mode: 'grant', kind: `custom:${t.id}`, count: '3', note: 'お礼', dm: 'yes' })).toContain('tickets_given');
    expect(await customHoldingsOf(db, USER)).toMatchObject([{ count: 3 }]);
    expect(await to({ mode: 'take', kind: `custom:${t.id}`, count: '1', note: '多すぎ' })).toContain('tickets_taken');
    expect(await customHoldingsOf(db, USER)).toMatchObject([{ count: 2 }]);
    expect(await to({ mode: 'grant', kind: 'custom:999', count: '1', note: 'x' })).toContain('tickets_invalid');
    expect((await post(g, `/gacha/custom/${t.id}/toggle`, {})).headers.get('location')).toContain('custom_toggled');
    expect((await listCustomTickets(db))[0]?.enabled).toBe(false);
  });

  it('出る確率（%）を直接決める: 運勢の出やすさと重みを合わせる。0% は OFF', async () => {
    const { ConfigStore } = await import('../src/services/settings.js');
    const store = new ConfigStore(db, cfg);
    app = createWebApp({ db, cfg: () => store.current, fileCfg: cfg, onSettingsSaved: () => store.refresh(), api: fakeApi, discord: fakeActions, baseUrl: BASE, now: () => clock });
    const { listPrizes, deletePrize, createPrize, prizeChances, ensureGachaPrizes } = await import('../src/services/gacha.js');
    await ensureGachaPrizes(db, cfg.gacha);
    for (const p of await listPrizes(db)) await deletePrize(db, p.id);
    const a = await createPrize(db, { tier: 'kichi', kind: 'coins', amount: 10, weight: 1, fallback: false });
    const b = await createPrize(db, { tier: 'chukichi', kind: 'coins', amount: 50, weight: 1, fallback: false });
    const c2 = await createPrize(db, { tier: 'chukichi', kind: 'coins', amount: 80, weight: 1, fallback: false });
    const g = await login(GUJI);
    const page = await (await get('/gacha', g)).text();
    expect(page).toContain(`name="pct.${a.id}"`);
    expect(page).toContain('action="/gacha/prizes/rates"');
    expect((await post(g, '/gacha/prizes/rates', { [`pct.${a.id}`]: '150' })).headers.get('location')).toContain('prize_rates_invalid');
    expect((await post(g, '/gacha/prizes/rates', { [`pct.${a.id}`]: '70', [`pct.${b.id}`]: '20', [`pct.${c2.id}`]: '10' })).headers.get('location')).toBe(
      '/gacha?msg=prize_rates#gacha-prizes',
    );
    expect(store.current.gacha.rates).toMatchObject({ kichi: 70, chukichi: 30 });
    const chances = prizeChances(store.current.gacha, await listPrizes(db));
    expect([chances.get(a.id), chances.get(b.id), chances.get(c2.id)]).toEqual([70, 20, 10]);
    // 0% にすると OFF
    await post(g, '/gacha/prizes/rates', { [`pct.${a.id}`]: '70', [`pct.${b.id}`]: '30', [`pct.${c2.id}`]: '0' });
    expect((await listPrizes(db)).find((p) => p.id === c2.id)?.enabled).toBe(false);
    expect(prizeChances(store.current.gacha, await listPrizes(db)).get(b.id)).toBe(30);
  });

  it('おすすめの中身（ロールを作ってまとめて足す）・おすそ分けの設定・期間限定の中身', async () => {
    const { ConfigStore } = await import('../src/services/settings.js');
    const store = new ConfigStore(db, cfg);
    app = createWebApp({ db, cfg: () => store.current, fileCfg: cfg, onSettingsSaved: () => store.refresh(), api: fakeApi, discord: fakeActions, baseUrl: BASE, now: () => clock });
    const { listPrizes } = await import('../src/services/gacha.js');
    const g = await login(GUJI);
    await get('/gacha', g);
    const before = (await listPrizes(db)).length;
    actions.length = 0;
    const loc = (await post(g, '/gacha/presets', {})).headers.get('location')!;
    expect(loc).toMatch(/^\/gacha\?msg=presets&added=\d+&roles=7#gacha-prizes$/);
    expect(actions.filter((a) => a.startsWith('createRole')).length).toBe(7);
    const after = await listPrizes(db);
    expect(after.length).toBeGreaterThan(before);
    expect(after.some((p) => p.kind === 'special' && p.label === 'Discord Nitro 1 か月分')).toBe(true);
    expect(after.some((p) => p.kind === 'zodiac')).toBe(true);
    // おすそ分け
    const rates = { 'rate.daikichi': '3', 'rate.chukichi': '12', 'rate.shokichi': '25', 'rate.kichi': '60' };
    expect((await post(g, '/gacha/settings', { price: '500', pity: '30', share: '120', ...rates })).headers.get('location')).toContain('gacha_saved');
    expect(store.current.gacha.share).toBe(120);
    // 期間限定（最後の日はその日の終わりまで）
    expect((await post(g, '/gacha/prizes', { tier: 'kichi', kind: 'coins', amount: '5', weight: '1', startsOn: '2026-10-01', endsOn: '2026-10-31' })).headers.get('location')).toContain(
      'prize_added',
    );
    const seasonal = (await listPrizes(db)).find((p) => p.kind === 'coins' && p.amount === 5)!;
    expect(seasonal.startsAt?.toISOString()).toBe('2026-09-30T15:00:00.000Z');
    expect(seasonal.endsAt?.toISOString()).toBe('2026-10-31T15:00:00.000Z');
    expect(await (await get('/gacha', g)).text()).toContain('🎍 10/1〜10/31');
    expect((await post(g, '/gacha/prizes', { tier: 'kichi', kind: 'coins', amount: '5', weight: '1', startsOn: '2026-10-31', endsOn: '2026-10-01' })).headers.get('location')).toContain(
      'prize_invalid',
    );
  });

  it('券を渡す・減らす（宮司のみ・理由が要る・持っている分まで減らす）', async () => {
    const { ticketsOf } = await import('../src/services/tickets.js');
    const s = await login(STAFF);
    expect((await post(s, `/members/${USER}/tickets`, { mode: 'grant', kind: 'room_free', count: '2', note: 'お礼' })).headers.get('location')).toBe(
      `/members/${USER}?msg=tickets_forbidden#sec-gacha`,
    );
    const g = await login(GUJI);
    expect(await (await get(`/members/${USER}`, g)).text()).toContain(`/members/${USER}/tickets`);
    const loc = async (form: Record<string, string>) => (await post(g, `/members/${USER}/tickets`, form)).headers.get('location');
    expect(await loc({ mode: 'grant', kind: 'nope', count: '1', note: 'x' })).toContain('tickets_invalid');
    expect(await loc({ mode: 'grant', kind: 'room_free', count: '0', note: 'x' })).toContain('tickets_invalid');
    expect(await loc({ mode: 'grant', kind: 'room_free', count: '101', note: 'x' })).toContain('tickets_invalid');
    expect(await loc({ mode: 'grant', kind: 'room_free', count: '1', note: '' })).toContain('tickets_invalid');
    expect(await loc({ mode: 'grant', kind: 'room_free', count: '2', note: 'イベントのお礼', dm: 'yes' })).toBe(`/members/${USER}?msg=tickets_given#sec-gacha`);
    expect(actions).toContain(`dm ${USER}`);
    expect((await ticketsOf(db, USER)).room_free).toBe(2);
    expect(await loc({ mode: 'take', kind: 'room_free', count: '5', note: '渡しすぎ' })).toBe(`/members/${USER}?msg=tickets_taken_short#sec-gacha`);
    expect(await loc({ mode: 'take', kind: 'room_free', count: '1', note: '渡しすぎ' })).toBe(`/members/${USER}?msg=tickets_none#sec-gacha`);
    expect((await ticketsOf(db, USER)).room_free).toBe(0);
    expect((await listAudit(db, { action: 'tickets.grant' })).length).toBe(1);
    expect((await listAudit(db, { action: 'tickets.take' })).length).toBe(2);
  });
});

describe('面談告知（管理画面）', () => {
  const post = async (session: string, path: string, form: Record<string, string>) => {
    const csrf = /name="_csrf" value="([^"]+)"/.exec(await (await get('/', session)).text())![1]!;
    return app.request(path, {
      method: 'POST',
      headers: { cookie: `shamusho_session=${session}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, ...form }).toString(),
    });
  };

  it('日にち・時刻をボタンで選んで流す（流し先・通知・定型文は保存できる）。神職も使える', async () => {
    const s = await login(STAFF);
    const page = await (await get('/interview', s)).text();
    expect(page).toContain('🍵 面談告知');
    expect(page).toContain('面談のお知らせ');
    // 今日（9/25）の 21:00 は過ぎているので、明日が選ばれている
    expect(page).toContain('value="2026-09-26" checked');
    expect(page).toContain('name="time" value="21:00" checked');
    expect(page).toContain('value="910000000000000004"'); // 通話（拝殿）を場所に選べる
    // 面談のチャンネルがなければ流せない
    expect((await post(s, '/interview/post', { day: '2026-09-28', time: '21:00', when: 'now' })).headers.get('location')).toBe('/interview?msg=no_channel');
    expect((await post(s, '/interview/settings', { channelId: '910000000000000003', mention: 'role', 'tplName.0': 'a', 'tplBody.0': 'x' })).headers.get('location')).toBe(
      '/interview?msg=settings_invalid',
    );
    const saved = await post(s, '/interview/settings', {
      channelId: '910000000000000003',
      mention: 'here',
      'tplName.0': 'いつもの',
      'tplBody.0': '面談: {日時}\n場所: {場所}\n{一言}',
      'tplName.1': '新人面談',
      'tplBody.1': '新人さん向け: {日時}',
      reminderTemplate: 'まもなく {時刻}',
    });
    expect(saved.headers.get('location')).toBe('/interview?msg=saved');
    expect((await post(s, '/interview/post', { day: 'だめ', time: '21:00' })).headers.get('location')).toBe('/interview?msg=invalid');
    expect((await post(s, '/interview/post', { day: '2026-09-25', time: '20:00' })).headers.get('location')).toBe('/interview?msg=past');

    // プレビュー
    const pv = await (await post(s, '/interview/preview', { day: '2026-09-28', time: '21:00', placeChannelId: '910000000000000004', when: 'now', remind10: 'yes' })).text();
    expect(pv).toContain('すぐに流します');
    expect(pv).toContain('面談: 9月28日（月） 21:00');
    expect(pv).toContain('場所: 🔊 拝殿');
    expect(pv).toContain('@here');
    expect(pv).toContain('10 分前');

    // 今すぐ流す（ほかの時刻・定型文を選ぶ）
    actions.length = 0;
    const now = await post(s, '/interview/post', { day: '2026-09-28', timeOther: '21:15', template: '1', when: 'now', placeChannelId: '910000000000000004' });
    expect(now.headers.get('location')).toBe('/interview?msg=posted#iv-upcoming');
    expect(actions).toEqual(['send 910000000000000003 @here\n新人さん向け: 9月28日（月） 21:15']);
    // 予約（当日の朝 10:00）
    actions.length = 0;
    const later = await post(s, '/interview/post', { day: '2026-09-29', time: '22:00', when: 'morning', note: 'よろしく', remind60: 'yes' });
    expect(later.headers.get('location')).toBe('/interview?msg=scheduled#iv-upcoming');
    expect(actions).toEqual([]);
    const { listInterviews } = await import('../src/services/interview.js');
    const [sched, posted] = await listInterviews(db);
    expect(sched).toMatchObject({ status: 'scheduled', postAt: new Date('2026-09-29T01:00:00Z'), remind60: true, remind10: false, note: 'よろしく' });
    expect(posted).toMatchObject({ status: 'posted', templateName: '新人面談', placeChannelId: '910000000000000004' });
    // 前日 21:00 は面談より前でないとだめ
    expect((await post(s, '/interview/post', { day: '2026-09-29', time: '20:00', when: 'custom', postAtOther: '2026-09-29T20:30' })).headers.get('location')).toBe(
      '/interview?msg=post_after',
    );
    const list = await (await get('/interview', s)).text();
    expect(list).toContain('⏳ 予約中');
    expect(list).toContain('📣 流した');
    expect(list).toContain('value="22:00" checked'); // 前の時刻を覚える

    // 変更（流したあとは Discord も書き換え）・中止
    actions.length = 0;
    const up = await post(s, `/interview/${posted!.id}/update`, { at: '2026-09-28T22:00', placeText: '拝殿', note: '' });
    expect(up.headers.get('location')).toBe('/interview?msg=updated#iv-upcoming');
    expect(actions[0]).toContain('edit ');
    expect(actions[0]).toContain('日時が変わりました');
    const cancel = await post(s, `/interview/${posted!.id}/cancel`, { reason: '都合により' });
    expect(cancel.headers.get('location')).toBe('/interview?msg=cancelled#iv-upcoming');
    expect(actions[1]).toContain('中止になりました');
    // 予約を今すぐ流す
    actions.length = 0;
    expect((await post(s, `/interview/${sched!.id}/post-now`, {})).headers.get('location')).toBe('/interview?msg=posted#iv-upcoming');
    expect(actions[0]).toContain('面談: 9月29日（火） 22:00');
    expect(actions[0]).toContain('よろしく');
    // 標準に戻す
    await post(s, '/interview/settings', { channelId: '910000000000000003', mention: 'none', reset: 'yes' });
    expect(await (await get('/interview', s)).text()).toContain('運営との面談をおこないます');
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

  const formMulti = async (session: string, path: string, data: [string, string][]) => {
    const csrf = /name="_csrf" value="([^"]+)"/.exec(await (await get('/', session)).text())![1]!;
    return app.request(path, {
      method: 'POST',
      headers: { cookie: `shamusho_session=${session}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams([['_csrf', csrf], ...data]).toString(),
    });
  };

  it('🧮 権限マトリクス: マスを押すと上書きが変わる（ほかのビットはそのまま）・テンプレートを作って一括で当てる', async () => {
    roleList = [
      { id: ROLE.ujiko, name: '🍃 氏子', position: 3, managed: false, color: 0, permissions: '0' },
      { id: '980000000000000088', name: 'BOT 連携', position: 4, managed: true, color: 0, permissions: '0' },
    ];
    const s = await login(STAFF);
    expect((await get('/channels/perms', s)).status).toBe(403);
    const g = await login(GUJI);
    expect(await (await get('/channels', g)).text()).toContain('href="/channels/perms"');
    const page = await (await get(`/channels/perms?role=${ROLE.ujiko}`, g)).text();
    expect(page).toContain('権限マトリクス一覧');
    expect(page).toContain(`data-role="${ROLE.ujiko}"`);
    expect(page).toContain(`data-ch="${TORII}" data-bit="11"`);
    expect(page).not.toContain('BOT 連携');
    expect(page).toContain('/static/perms.js');
    // ボイスの権限は、テキストのチャンネルにはない
    expect((await form(g, '/channels/perms/cell', { channel: TORII, role: ROLE.ujiko, bit: '20', cell: 'allow' })).status).toBe(400);
    actions = [];
    const r = await form(g, '/channels/perms/cell', { channel: TORII, role: ROLE.ujiko, bit: '11', cell: 'deny' });
    expect(await r.json()).toEqual({ ok: true, cell: 'deny' });
    expect(actions).toContain(`overwrite ${TORII} ${ROLE.ujiko} allow=0 deny=2048`);
    // 連携のロールは変えない
    expect((await form(g, '/channels/perms/cell', { channel: TORII, role: '980000000000000088', bit: '11', cell: 'deny' })).status).toBe(400);
    // テンプレート
    const tpl = await (await get('/channels/perms?tab=templates', g)).text();
    expect(tpl).toContain('新規 権限テンプレートの作成');
    expect((await form(g, '/channels/perms/templates', { name: '', target: 'text' })).headers.get('location')).toContain('tpl_invalid');
    expect((await form(g, '/channels/perms/templates', { name: '📢 告知（発言禁止）', target: 'text', note: '見るだけ', 'p.1': 'allow', 'p.6': 'deny', 'p.22': 'deny' })).headers.get('location')).toContain('tpl_saved');
    const { listTemplates } = await import('../src/services/permMatrix.js');
    const [t] = await listTemplates(db);
    expect(t).toMatchObject({ name: '📢 告知（発言禁止）', target: 'text', perms: { '1': 'allow', '6': 'deny', '22': 'deny' } });
    actions = [];
    // テキスト用なので、ボイスのチャンネルは飛ばす。確認がないと当てない
    expect((await formMulti(g, '/channels/perms/apply', [['template', t!.id], ['role', ROLE.ujiko], ['channels', TORII], ['channels', '910000000000000004']])).headers.get('location')).toContain('msg=invalid');
    const applied = await formMulti(g, '/channels/perms/apply', [['template', t!.id], ['role', ROLE.ujiko], ['channels', TORII], ['channels', '910000000000000004'], ['confirm', 'yes']]);
    expect(applied.headers.get('location')).toContain('msg=applied');
    expect(actions).toEqual([`overwrite ${TORII} ${ROLE.ujiko} allow=1024 deny=2048`]);
    // 直す・消す
    expect((await form(g, '/channels/perms/templates', { id: t!.id, name: '告知', target: 'all', 'p.6': 'deny' })).headers.get('location')).toContain('tpl_saved');
    expect((await listTemplates(db))[0]).toMatchObject({ id: t!.id, name: '告知', target: 'all', perms: { '6': 'deny' } });
    expect((await form(g, `/channels/perms/templates/${t!.id}/delete`, {})).headers.get('location')).toContain('tpl_deleted');
    expect(await listTemplates(db)).toEqual([]);

    // 見出しに短い名前・まとめて変えるボタン
    expect(page).toContain('<span class="pm-th-label">閲覧</span>');
    expect(page).toContain(`data-pm-rowset="${TORII}"`);
    expect(page).toContain('data-pm-colset="11"');
    // まとめて変える（テキストのチャンネルにボイスの権限は付けない）
    actions = [];
    const bulk = await formMulti(g, '/channels/perms/bulk', [['role', ROLE.ujiko], ['cell', 'deny'], ['channels', TORII], ['channels', '910000000000000004'], ['bits', '11'], ['bits', '20']]);
    const br = (await bulk.json()) as { ok: boolean; changed: number; cells: { ch: string; bit: number }[] };
    expect(br.ok).toBe(true);
    expect(br.cells.map((x) => `${x.ch}:${x.bit}`).sort()).toEqual([`${TORII}:11`, '910000000000000004:11', '910000000000000004:20'].sort());
    expect(actions).toContain(`overwrite ${TORII} ${ROLE.ujiko} allow=0 deny=2048`);
    expect(actions).toContain(`overwrite 910000000000000004 ${ROLE.ujiko} allow=0 deny=${2048 + 2 ** 20}`);
    expect((await formMulti(g, '/channels/perms/bulk', [['role', ROLE.ujiko], ['cell', 'deny'], ['channels', TORII]])).status).toBe(400);
    expect((await formMulti(g, '/channels/perms/bulk', [['role', '980000000000000088'], ['cell', 'deny'], ['channels', TORII], ['bits', '11']])).status).toBe(400);
    // 👥 ロールを並べて見る（1 つのチャンネル × ロール）
    const byRole = await (await get(`/channels/perms?tab=roles&ch=${TORII}&all=1`, g)).text();
    expect(byRole).toContain('ロールを並べて見る');
    expect(byRole).toContain(`data-ch="${TORII}" data-role="${ROLE.ujiko}" data-bit="11"`);
    expect(byRole).not.toContain('BOT 連携');
    roleList = [];
  });

  it('🧮 権限マトリクス: 同じチャンネルの別のマスを同時に変えても、両方残る（前の変更を消さない）。ホイールのボタンがある', async () => {
    roleList = [{ id: ROLE.ujiko, name: '🍃 氏子', position: 3, managed: false, color: 0, permissions: '0' }];
    // Discord のまね: 上書きを覚えていて、書きこみに少し時間がかかる
    let ow = { allow: 0n, deny: 0n };
    const original = { guildChannels: fakeActions.guildChannels, setChannelOverwrite: fakeActions.setChannelOverwrite };
    fakeActions.guildChannels = async () => [
      { id: '910000000000000001', name: '⛩ 鳥居', type: 4, parent_id: null, position: 0 },
      { id: TORII, name: '鳥居', type: 0, parent_id: '910000000000000001', position: 0, permission_overwrites: ow.allow || ow.deny ? [{ id: ROLE.ujiko, type: 0, allow: String(ow.allow), deny: String(ow.deny) }] : [] },
    ];
    fakeActions.setChannelOverwrite = async (_c, o) => {
      await new Promise((r) => setTimeout(r, 30));
      ow = { allow: BigInt(o.allow), deny: BigInt(o.deny) };
    };
    try {
      const g = await login(GUJI);
      const page = await (await get(`/channels/perms?role=${ROLE.ujiko}`, g)).text();
      expect(page).toContain('data-pm-wheel');
      expect(await (await get('/channels/perms?tab=templates', g)).text()).toContain('data-pm-wheel');
      // 送信（11）を拒否・閲覧（10）を許可を、同時に
      const [a, b] = await Promise.all([
        form(g, '/channels/perms/cell', { channel: TORII, role: ROLE.ujiko, bit: '11', cell: 'deny' }),
        form(g, '/channels/perms/cell', { channel: TORII, role: ROLE.ujiko, bit: '10', cell: 'allow' }),
      ]);
      expect(((await a.json()) as { ok: boolean }).ok).toBe(true);
      expect(((await b.json()) as { ok: boolean }).ok).toBe(true);
      expect(ow).toEqual({ allow: 1024n, deny: 2048n });
      // まとめて変えるのと同時に押しても、両方残る
      const [c1, c2] = await Promise.all([
        formMulti(g, '/channels/perms/bulk', [['role', ROLE.ujiko], ['cell', 'deny'], ['channels', TORII], ['bits', '14']]),
        form(g, '/channels/perms/cell', { channel: TORII, role: ROLE.ujiko, bit: '15', cell: 'allow' }),
      ]);
      expect(c1.status).toBe(200);
      expect(c2.status).toBe(200);
      expect(ow).toEqual({ allow: 1024n + 2n ** 15n, deny: 2048n + 2n ** 14n });
    } finally {
      Object.assign(fakeActions, original);
    }
  });

  it('チャンネルを作れる（プライベートは選んだロールと運営・BOT だけ見られる）。おかしな入力は作らない', async () => {
    roleList = [{ id: ROLE.ujiko, name: '🍃 氏子', position: 3, managed: false, color: 0, permissions: '0' }];
    const g = await login(GUJI);
    expect(await (await get('/channels', g)).text()).toContain('href="/channels/new"');
    const page = await (await get('/channels/new?parent=910000000000000001', g)).text();
    expect(page).toContain('チャンネルを作る');
    expect(page).toContain('🍃 氏子');
    // カテゴリから開いたら、そのカテゴリが選ばれている
    expect(page).toContain('<option value="910000000000000001" selected="">');
    const bad = await formMulti(g, '/channels/new', [['kind', 'text'], ['name', '秘密'], ['visibility', 'private']]);
    expect(bad.headers.get('location')).toBe('/channels/new?msg=create_invalid');
    const noParent = await formMulti(g, '/channels/new', [['kind', 'text'], ['name', '秘密'], ['visibility', 'category']]);
    expect(noParent.headers.get('location')).toBe('/channels/new?msg=create_invalid');
    expect(actions.filter((a) => a.startsWith('createChannel'))).toEqual([]);

    const ok = await formMulti(g, '/channels/new', [
      ['kind', 'text'],
      ['name', '氏子の間'],
      ['parent', '910000000000000001'],
      ['visibility', 'private'],
      ['roles', ROLE.ujiko],
      ['topic', '氏子だけ'],
    ]);
    expect(ok.headers.get('location')).toBe('/channels/910000000000000099?msg=created');
    const body = JSON.parse(actions.find((a) => a.startsWith('createChannel'))!.slice('createChannel '.length)) as {
      name: string;
      parent_id: string;
      topic: string;
      permission_overwrites: { id: string; allow: string; deny: string }[];
    };
    expect(body).toMatchObject({ name: '氏子の間', parent_id: '910000000000000001', topic: '氏子だけ' });
    const view = 1n << 10n;
    const ow = (id: string) => body.permission_overwrites.find((o) => o.id === id);
    expect(BigInt(ow(cfg.guildId)!.deny) & view).toBe(view);
    expect(BigInt(ow(ROLE.ujiko)!.allow) & view).toBe(view);
    expect(BigInt(ow(ROLE.guji)!.allow) & view).toBe(view);
    expect(ow(ROLE.sanpaisha)).toBeUndefined();
    expect((await listAudit(db, { action: 'channel.create' }))[0]?.detail).toMatchObject({ name: '氏子の間', visibility: 'private' });
  });

  it('通話の人数の上限を変えられる（0〜99）。作るときにも決められる', async () => {
    const g = await login(GUJI);
    expect(await (await get('/channels/910000000000000004', g)).text()).toContain('name="userLimit"');
    const r = await form(g, '/channels/910000000000000004/name', { name: '拝殿', userLimit: '5' });
    expect(r.headers.get('location')).toBe('/channels/910000000000000004?msg=saved');
    expect(actions).toContain('editChannel 910000000000000004  limit=5');
    expect((await form(g, '/channels/910000000000000004/name', { name: '拝殿', userLimit: '100' })).headers.get('location')).toBe('/channels/910000000000000004?msg=invalid');
    const created = await formMulti(g, '/channels/new', [['kind', 'voice'], ['name', '二人部屋'], ['visibility', 'members'], ['userLimit', '2']]);
    expect(created.headers.get('location')).toBe('/channels/910000000000000099?msg=created');
    expect(actions.find((a) => a.startsWith('createChannel'))).toContain('"user_limit":2');
  });

  it('▲▼ で入れ替え、ほかのカテゴリへ移せる', async () => {
    const g = await login(GUJI);
    const page = await (await get('/channels', g)).text();
    expect(page).toContain(`action="/channels/${TORII}/move"`);
    // 一覧の ▲▼ は一覧へ、編集ページからは編集ページへ戻る
    const up = await form(g, '/channels/910000000000000003/move', { dir: 'up', from: 'list' });
    expect(up.headers.get('location')).toBe('/channels?msg=moved#ch-910000000000000003');
    expect(actions.find((a) => a.startsWith('reorder'))).toBe(
      `reorder ${JSON.stringify([
        { id: '910000000000000003', position: 0 },
        { id: TORII, position: 1 },
      ])}`,
    );
    expect((await form(g, `/channels/${TORII}/move`, { dir: 'up' })).headers.get('location')).toBe(`/channels/${TORII}?msg=unchanged`);
    const out = await form(g, `/channels/${TORII}/move`, { parent: 'none' });
    expect(out.headers.get('location')).toBe(`/channels/${TORII}?msg=moved`);
    expect(actions.at(-1)).toContain(`"id":"${TORII}","position":0,"parent_id":null,"lock_permissions":false`);
    expect((await listAudit(db, { action: 'channel.move' })).length).toBe(2);
  });

  it('消すときは名前を入力。BOT が使っているもの・中身のあるカテゴリは消せない', async () => {
    const g = await login(GUJI);
    expect((await form(g, `/channels/${TORII}/delete`, { confirmName: 'ちがう' })).headers.get('location')).toBe(`/channels/${TORII}?msg=confirm_name`);
    expect((await form(g, '/channels/910000000000000001/delete', { confirmName: '⛩ 鳥居' })).headers.get('location')).toBe('/channels/910000000000000001?msg=has_children');
    expect(actions.filter((a) => a.startsWith('deleteChannel'))).toEqual([]);
    const r = await form(g, `/channels/${TORII}/delete`, { confirmName: '鳥居' });
    expect(r.headers.get('location')).toBe('/channels?msg=deleted');
    expect(actions).toContain(`deleteChannel ${TORII}`);
    expect((await listAudit(db, { action: 'channel.delete' }))[0]?.detail).toMatchObject({ name: '鳥居' });
    // 宮司でなければできない
    const s = await login(STAFF);
    expect((await form(s, `/channels/${TORII}/delete`, { confirmName: '鳥居' })).status).toBe(403);
  });

  it('一覧はカテゴリごと。名前を押すとそのチャンネルの編集ページ。名前で探せる', async () => {
    const g = await login(GUJI);
    const page = await (await get('/channels', g)).text();
    expect(page).toContain('href="/channels/910000000000000002"');
    expect(page).toContain('id="ch-910000000000000002"');
    expect(page).toContain('id="cat-910000000000000001"');
    // 通話も同じカテゴリに並ぶ
    expect(page).toContain('href="/channels/910000000000000004"');
    const found = await (await get(`/channels?q=${encodeURIComponent('しきたり')}`, g)).text();
    expect(found).toContain('href="/channels/910000000000000003"');
    expect(found).not.toContain('href="/channels/910000000000000002"');
    // 編集ページ: 基本・場所と並び・消す、Discord で開く
    const edit = await (await get('/channels/910000000000000002', g)).text();
    expect(edit).toContain('action="/channels/910000000000000002"');
    expect(edit).toContain('action="/channels/910000000000000002/move"');
    expect(edit).toContain('action="/channels/910000000000000002/delete"');
    expect(edit).toContain(`https://discord.com/channels/${cfg.guildId}/910000000000000002`);
    // カテゴリの編集ページには中のチャンネル
    const cat = await (await get('/channels/910000000000000001', g)).text();
    expect(cat).toContain('中のチャンネル（3）');
    expect((await get('/channels/123', g)).status).toBe(404);
  });

  it('宮司だけが開ける', async () => {
    const s = await login(STAFF);
    expect((await get('/channels', s)).status).toBe(403);
    expect((await form(s, `/channels/${TORII}`, { topic: 'x', mode: 'readonly' })).status).toBe(403);
    expect(actions.filter((a) => a.startsWith('editChannel') || a.startsWith('overwrite'))).toEqual([]);
    const g = await login(GUJI);
    const page = await (await get('/channels', g)).text();
    expect(page).toContain('>鳥居</a>');
    expect(page).toContain('ようこそ');
  });

  it('説明を変えて、読むだけにできる', async () => {
    const g = await login(GUJI);
    const r = await form(g, `/channels/${TORII}`, { topic: '最初に読んでね', mode: 'readonly' });
    expect(r.headers.get('location')).toBe(`/channels/${TORII}?msg=saved`);
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
    expect((await form(g, `/channels/${TORII}`, { topic: 'ようこそ', mode: 'writable' })).headers.get('location')).toBe(`/channels/${TORII}?msg=unchanged`);
    expect((await form(g, `/channels/${TORII}`, { topic: 'x'.repeat(1025), mode: 'writable' })).headers.get('location')).toBe(`/channels/${TORII}?msg=invalid`);
    expect((await form(g, `/channels/${TORII}`, { topic: 'x', mode: 'nope' })).headers.get('location')).toBe(`/channels/${TORII}?msg=invalid`);
    expect(actions.filter((a) => a.startsWith('editChannel') || a.startsWith('overwrite'))).toEqual([]);
  });

  it('名前を変えられる（チャンネル・カテゴリ）。空の名前は受けない', async () => {
    const g = await login(GUJI);
    const r = await form(g, `/channels/${TORII}`, { name: '⛩｜鳥居', topic: 'ようこそ', mode: 'writable' });
    expect(r.headers.get('location')).toBe(`/channels/${TORII}?msg=saved`);
    expect(actions).toContain(`editChannel ${TORII}  name=⛩｜鳥居`);
    expect((await form(g, `/channels/${TORII}`, { name: '  ', topic: 'ようこそ', mode: 'writable' })).headers.get('location')).toBe(`/channels/${TORII}?msg=invalid`);
    const CAT = '910000000000000001';
    expect((await form(g, `/channels/${CAT}/name`, { name: '⛩ 鳥居 ⛩' })).headers.get('location')).toBe(`/channels/${CAT}?msg=saved`);
    expect(actions).toContain(`editChannel ${CAT}  name=⛩ 鳥居 ⛩`);
    expect((await form(g, `/channels/${CAT}/name`, { name: '⛩ 鳥居' })).headers.get('location')).toBe(`/channels/${CAT}?msg=unchanged`);
    expect((await form(g, `/channels/${CAT}/name`, { name: '' })).headers.get('location')).toBe(`/channels/${CAT}?msg=invalid`);
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
    // 男女・浮上のタブ
    const g = await (await get('/stats?range=30d&view=gender', s)).text();
    expect(g).toContain('男女の割合');
    expect(g).not.toContain('サーバーにいる人数');
    const a = await (await get('/stats?range=90d&view=active', s)).text();
    expect(a).toContain('浮上した人の男女');
    expect(a).toContain('時間帯の記録はまだありません');
    expect(a).toContain('href="/stats?range=1y&amp;view=active"');
    // 日付で選ぶ・前の期間とくらべる・平均の線・マウスを乗せたカード
    const custom = await (await get('/stats?from=2026-01-01&to=2026-01-20&view=overview', s)).text();
    expect(custom).toContain('value="2026-01-01"');
    expect(custom).toContain('href="/stats?from=2026-01-01&amp;to=2026-01-20&amp;view=gender"');
    expect(custom).toContain('前の期間より');
    expect(custom).toContain('7 日の平均');
    expect(custom).toContain('data-tip=');
    expect(custom).toContain('/static/charts.js');
    // おかしな日付は 30 日に
    expect(await (await get('/stats?from=2026-13-01&to=2026-01-20', s)).text()).toMatch(/aria-current="page"[^>]*>30 日/);
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

describe('ロール（管理画面）', () => {
  const form = async (session: string, path: string, data: [string, string][]) => {
    const csrf = /name="_csrf" value="([^"]+)"/.exec(await (await get('/', session)).text())![1]!;
    const body = new URLSearchParams([['_csrf', csrf], ...data]);
    return app.request(path, { method: 'POST', headers: { cookie: `shamusho_session=${session}`, 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  };
  const BOTROLE = '980000000000000001';
  const TOP = '980000000000000002';
  beforeEach(() => {
    roleList = [
      { id: TOP, name: '上のロール', position: 20, managed: false, color: 0, permissions: '0' },
      { id: BOTROLE, name: 'BOT', position: 15, managed: true, color: 0, permissions: '8', tags: { bot_id: 'bot' } },
      { id: ROLE.sanpaisha, name: '🔰 参拝者', position: 2, managed: false, color: 0xb0b0b0, permissions: String((1n << 11n) | (1n << 2n)), hoist: true },
      { id: cfg.guildId, name: '@everyone', position: 0, managed: false, color: 0, permissions: String(1n << 10n) },
    ];
  });
  afterEach(() => {
    roleList = [];
  });

  it('宮司だけが見られる。人数・役目・気をつける権限・持っている人が出る', async () => {
    const s = await login(STAFF);
    expect((await get('/roles', s)).status).toBe(403);
    const g = await login(GUJI);
    const page = await (await get('/roles', g)).text();
    expect(page).toContain('🔰 参拝者');
    expect(page).toContain('役職（自動で昇格）');
    expect(page).toContain('メンバーを BAN');
    expect(page).toMatch(/上のロール 🔒/);
    const detail = await (await get(`/roles/${ROLE.sanpaisha}`, g)).text();
    expect(detail).toContain('さくら');
    expect(detail).toMatch(/name="perm" value="11" checked/);
  });

  it('ニックネームを自分で変えられないように: @everyone とロールから「ニックネームの変更」を外す', async () => {
    const NICK = 1n << 26n;
    roleList = roleList.map((r) => (r.id === cfg.guildId || r.id === ROLE.sanpaisha ? { ...r, permissions: String(BigInt(r.permissions ?? '0') | NICK) } : r));
    const g = await login(GUJI);
    expect(await (await get('/roles', g)).text()).toContain('今「ニックネームの変更」を持っているロール: 🔰 参拝者・@everyone');
    const r = await form(g, '/roles/nickname-lock', [['confirm', 'yes']]);
    expect(r.headers.get('location')).toBe('/roles?msg=nickname_locked');
    const edits = actions.filter((a) => a.startsWith('editRole'));
    expect(edits).toHaveLength(2);
    for (const e of edits) expect(BigInt(JSON.parse(e.slice(e.indexOf('{'))).permissions) & NICK).toBe(0n);
  });

  it('ロールを作れる（権限なし）。消すときは名前を入力。BOT が使っているロールは消せない', async () => {
    roleList.push({ id: '980000000000000050', name: 'イベント係', position: 3, managed: false, color: 0, permissions: '0' });
    const g = await login(GUJI);
    expect(await (await get('/roles', g)).text()).toContain('ロールを作る');
    expect((await form(g, '/roles/new', [['name', ''], ['color', '#ff0000']])).headers.get('location')).toBe('/roles?msg=invalid#new-role');
    const created = await form(g, '/roles/new', [['name', '🎉 イベント係'], ['color', '#ff0000'], ['mentionable', 'yes']]);
    expect(created.headers.get('location')).toBe('/roles/980000000000000099?msg=created');
    expect(actions).toContain(`createRole ${JSON.stringify({ name: '🎉 イベント係', color: 0xff0000, hoist: false, mentionable: true, permissions: '0' })}`);

    // 役職（BOT が使っている）は消せない
    expect(await (await get(`/roles/${ROLE.sanpaisha}`, g)).text()).toContain('BOT が使っているので消せません');
    expect((await form(g, `/roles/${ROLE.sanpaisha}/delete`, [['confirmName', '🔰 参拝者']])).headers.get('location')).toBe(`/roles/${ROLE.sanpaisha}?msg=in_use`);
    // BOT より上も消せない
    expect((await form(g, `/roles/${TOP}/delete`, [['confirmName', '上のロール']])).headers.get('location')).toBe(`/roles/${TOP}?msg=locked`);
    expect((await form(g, '/roles/980000000000000050/delete', [['confirmName', 'ちがう']])).headers.get('location')).toBe('/roles/980000000000000050?msg=confirm_name');
    expect(actions.filter((a) => a.startsWith('deleteRole'))).toEqual([]);
    const del = await form(g, '/roles/980000000000000050/delete', [['confirmName', 'イベント係']]);
    expect(del.headers.get('location')).toBe('/roles?msg=deleted');
    expect(actions).toContain('deleteRole 980000000000000050');
    expect((await listAudit(db, { action: 'role.delete' }))[0]?.detail).toMatchObject({ name: 'イベント係' });
  });

  it('📋 権限のテンプレート: はじめからあるもので作る・今の権限から作る・消す。管理者入りは作れない', async () => {
    const { BUILTIN_ROLE_TEMPLATES, allRoleTemplates } = await import('../src/services/roleTemplates.js');
    const g = await login(GUJI);
    const list = await (await get('/roles', g)).text();
    expect(list).toContain('id="role-templates"');
    expect(list).toContain('👀 見るだけ');
    expect(list).toContain('name="template"');
    // はじめからあるもの（見るだけ）で作る
    const ro = BUILTIN_ROLE_TEMPLATES.find((t) => t.key === 'b:readonly')!;
    await form(g, '/roles/new', [['name', '見学'], ['color', '#00ff00'], ['template', 'b:readonly']]);
    expect(actions).toContain(`createRole ${JSON.stringify({ name: '見学', color: 0x00ff00, hoist: false, mentionable: false, permissions: ro.bits.toString() })}`);
    expect(ro.bits).toBe((1n << 10n) | (1n << 16n) | (1n << 6n));
    // ロールのページ: 選ぶ欄と、今の権限からテンプレートを作る
    const page = await (await get(`/roles/${ROLE.sanpaisha}`, g)).text();
    expect(page).toContain('data-perm-template');
    expect(page).toContain('action="/roles/templates"');
    const saved = await form(g, '/roles/templates', [['roleId', ROLE.sanpaisha], ['name', '参拝者のまね']]);
    expect(saved.headers.get('location')).toBe(`/roles/${ROLE.sanpaisha}?msg=template_saved#role-template`);
    const mine = (await allRoleTemplates(db)).find((t) => t.name === '参拝者のまね')!;
    expect(mine.bits).toBe(BigInt(roleList.find((r) => r.id === ROLE.sanpaisha)!.permissions ?? '0'));
    expect((await form(g, '/roles/templates', [['roleId', ROLE.sanpaisha], ['name', '']])).headers.get('location')).toBe(`/roles/${ROLE.sanpaisha}?msg=template_invalid#role-template`);
    // 作ったテンプレートで作る
    await form(g, '/roles/new', [['name', '二人目'], ['noColor', 'yes'], ['template', mine.key]]);
    expect(actions.at(-1)).toContain(`"permissions":"${mine.bits.toString()}"`);
    // 管理者の入ったロールからは作れない
    const ADMIN = '980000000000000070';
    roleList.push({ id: ADMIN, name: '管理', position: 3, managed: false, color: 0, permissions: String(1n << 3n) });
    expect((await form(g, '/roles/templates', [['roleId', ADMIN], ['name', '管理のまね']])).headers.get('location')).toBe(`/roles/${ADMIN}?msg=template_admin#role-template`);
    // 消す
    const del = await form(g, `/roles/templates/${mine.key.slice(2)}/delete`, []);
    expect(del.headers.get('location')).toBe('/roles?msg=template_deleted#role-templates');
    expect((await allRoleTemplates(db)).some((t) => t.name === '参拝者のまね')).toBe(false);
  });

  it('ロールを人に付ける・外す: 名前で探して選ぶ・選んだ人から外す。注意の権限は確認・🔒 はできない', async () => {
    const EV = '980000000000000060';
    const MOD = '980000000000000061';
    roleList.push({ id: EV, name: 'イベント係', position: 3, managed: false, color: 0, permissions: '0' });
    roleList.push({ id: MOD, name: '見回り', position: 4, managed: false, color: 0, permissions: String(1n << 2n) });
    const NEW1 = '700000000000000881';
    const NEW2 = '700000000000000882';
    await recordJoin(db, { id: NEW1, username: 'hanako', displayName: 'はなこ', avatarUrl: null, roleIds: [], isBot: false, joinedAt: null });
    await recordJoin(db, { id: NEW2, username: 'hanabi', displayName: 'はなび', avatarUrl: null, roleIds: [EV], isBot: false, joinedAt: null });
    const g = await login(GUJI);
    // 探す: まだ持っていない人だけ
    const found = await (await get(`/roles/${EV}?q=はな`, g)).text();
    expect(found).toContain('はなこ');
    expect(found).not.toMatch(/name="member" value="700000000000000882"[^>]*>\s*<span class="who">[\s\S]*?はなび[\s\S]*?選んだ人に/);
    expect(found).toContain(`action="/roles/${EV}/members/add"`);
    const add = await form(g, `/roles/${EV}/members/add`, [['member', NEW1]]);
    expect(add.headers.get('location')).toBe(`/roles/${EV}?msg=members_added&n=1#role-members`);
    expect(actions).toContain(`addRole ${NEW1} ${EV}`);
    // こちらの記録にもすぐ入る（持っている人に出る）
    const after = await (await get(add.headers.get('location')!.replace(/#.*/, ''), g)).text();
    expect(after).toContain('このロールを持っている人（2 人）');
    expect(after).toContain('ロールを付けました。（1 人）');
    expect((await listAudit(db, { action: 'role.member_add' }))[0]?.detail).toMatchObject({ roleId: EV, members: [{ id: NEW1, name: 'はなこ' }] });
    // 外す
    const rm = await form(g, `/roles/${EV}/members/remove`, [['member', NEW1], ['member', NEW2]]);
    expect(rm.headers.get('location')).toBe(`/roles/${EV}?msg=members_removed&n=2#role-members`);
    expect(actions).toContain(`removeRole ${NEW2} ${EV}`);
    expect(await (await get(`/roles/${EV}`, g)).text()).toContain('このロールを持っている人（0 人）');
    // 選んでいない・注意の権限（キック）は確認が要る・🔒 はできない
    expect((await form(g, `/roles/${EV}/members/add`, [])).headers.get('location')).toBe(`/roles/${EV}?msg=pick_members#role-members`);
    expect((await form(g, `/roles/${MOD}/members/add`, [['member', NEW1]])).headers.get('location')).toBe(`/roles/${MOD}?msg=need_confirm_danger#role-members`);
    expect((await form(g, `/roles/${MOD}/members/add`, [['member', NEW1], ['confirmDanger', 'yes']])).headers.get('location')).toBe(`/roles/${MOD}?msg=members_added&n=1#role-members`);
    expect((await form(g, `/roles/${TOP}/members/add`, [['member', NEW1]])).headers.get('location')).toBe(`/roles/${TOP}?msg=locked#role-members`);
    expect(await (await get(`/roles/${TOP}`, g)).text()).not.toContain('人に付ける');
    // 神職は使えない
    expect((await form(await login(STAFF), `/roles/${EV}/members/add`, [['member', NEW1]])).status).toBe(403);
  });

  it('招待リンクを BOT だけに: @everyone とロールから「招待を作成」を外す（🔒 はのぞく）', async () => {
    roleList = roleList.map((r) => (r.id === cfg.guildId ? { ...r, permissions: String((1n << 10n) | 1n) } : r));
    const g = await login(GUJI);
    expect(await (await get('/roles', g)).text()).toContain('今「招待を作成」を持っているロール: @everyone');
    expect((await form(g, '/roles/invites-bot-only', [])).headers.get('location')).toBe('/roles?msg=need_confirm_all');
    const r = await form(g, '/roles/invites-bot-only', [['confirm', 'yes']]);
    expect(r.headers.get('location')).toBe('/roles?msg=invites_bot_only');
    expect(actions.filter((a) => a.startsWith('editRole'))).toEqual([`editRole ${cfg.guildId} {"permissions":"${String(1n << 10n)}"}`]);
  });

  it('すべてのロールをまとめて @ で呼べるように（🔒・@everyone はのぞく。確認が要る）', async () => {
    roleList.push({ id: ROLE.ujiko, name: '🍃 氏子', position: 3, managed: false, color: 0, permissions: '0', mentionable: true });
    const s = await login(STAFF);
    expect((await form(s, '/roles/mentionable-all', [['mentionable', 'on'], ['confirm', 'yes']])).status).toBe(403);
    const g = await login(GUJI);
    expect(await (await get('/roles', g)).text()).toContain('今 @ で呼べないロール: 1 個');
    expect((await form(g, '/roles/mentionable-all', [['mentionable', 'on']])).headers.get('location')).toBe('/roles?msg=need_confirm_all');
    expect(actions.filter((a) => a.startsWith('editRole'))).toEqual([]);
    const r = await form(g, '/roles/mentionable-all', [['mentionable', 'on'], ['confirm', 'yes']]);
    expect(r.headers.get('location')).toBe('/roles?msg=mentionable_on');
    expect(actions.filter((a) => a.startsWith('editRole'))).toEqual([`editRole ${ROLE.sanpaisha} {"mentionable":true}`]);
    expect((await listAudit(db, { action: 'role.mentionable_all' }))[0]?.detail).toMatchObject({ mentionable: true, count: 1 });
  });

  it('権限・名前・色を変えられる。管理者を付けるときは確認が要る。BOT より上は変えられない', async () => {
    const g = await login(GUJI);
    const r = await form(g, `/roles/${ROLE.sanpaisha}`, [
      ['name', '🔰 参拝者'],
      ['color', '#ff0000'],
      ['hoist', 'yes'],
      ['perm', '11'],
      ['perm', '20'],
    ]);
    expect(r.headers.get('location')).toBe(`/roles/${ROLE.sanpaisha}?msg=saved`);
    expect(actions.at(-1)).toBe(`editRole ${ROLE.sanpaisha} ${JSON.stringify({ permissions: String((1n << 11n) | (1n << 20n)), color: 0xff0000 })}`);
    const log = (await listAudit(db, { action: 'role.update' }))[0]!;
    expect(log.detail).toMatchObject({ added: ['接続'], removed: ['メンバーを BAN'] });

    const admin = await form(g, `/roles/${ROLE.sanpaisha}`, [['name', 'x'], ['noColor', 'yes'], ['perm', '3']]);
    expect(admin.headers.get('location')).toBe(`/roles/${ROLE.sanpaisha}?msg=need_confirm`);
    expect((await form(g, `/roles/${TOP}`, [['name', 'x'], ['noColor', 'yes']])).headers.get('location')).toBe(`/roles/${TOP}?msg=locked`);
    expect((await form(g, `/roles/${BOTROLE}`, [['name', 'x'], ['noColor', 'yes']])).headers.get('location')).toBe(`/roles/${BOTROLE}?msg=locked`);
  });

  it('みんな（@everyone）は権限だけ', async () => {
    const g = await login(GUJI);
    await form(g, `/roles/${cfg.guildId}`, [['perm', '10'], ['perm', '6']]);
    expect(actions.at(-1)).toBe(`editRole ${cfg.guildId} ${JSON.stringify({ permissions: String((1n << 10n) | (1n << 6n)) })}`);
  });
});

/** テスト用の nonce（UUID の形） */
function randomUUIDLike(n: number): string {
  return `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
}

describe('掲示板（管理画面）', () => {
  const form = async (session: string, path: string, data: Record<string, string>) => {
    const csrf = /name="_csrf" value="([^"]+)"/.exec(await (await get('/', session)).text())![1]!;
    return app.request(path, {
      method: 'POST',
      headers: { cookie: `shamusho_session=${session}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, ...data }).toString(),
    });
  };

  it('置き場所を決めると「募集を書く」を出す。問題ありは渡す・戻すを決められる。取り下げで余りを戻す', async () => {
    const { createPost, applyPost, hire, disputeEntry, getPost } = await import('../src/services/board.js');
    const { walletOf } = await import('../src/services/economy.js');
    const s = await login(STAFF);
    expect(await (await get('/board', s)).text()).toContain('まだ決まっていません');
    actions = [];
    expect((await form(s, '/board/place', { channelId: '910000000000000003' })).headers.get('location')).toBe('/board?msg=place_saved');
    expect(actions.some((a) => a.startsWith('send 910000000000000003') && a.includes('仕事・依頼'))).toBe(true);
    expect((await form(s, '/board/place', { channelId: '999' })).headers.get('location')).toBe('/board?msg=no_place');
    // 報酬つきの募集と、問題あり
    const AUTHOR = '870000000000000011';
    const WORKER = '870000000000000012';
    await addCoins(db, AUTHOR, 3000, 'adjust');
    const r = await createPost(db, cfg, { id: AUTHOR, roleIds: [ROLE.ujiko] }, { category: 'work', title: 'ロゴ作り', body: '', slots: 2, reward: 1000, days: 7 });
    if (r.status !== 'ok') throw new Error(r.status);
    const a = await applyPost(db, cfg, r.post.id, { id: WORKER, roleIds: [ROLE.sanpaisha] });
    if (a.status !== 'ok') throw new Error(a.status);
    await hire(db, cfg, a.entry.id, AUTHOR);
    await disputeEntry(db, a.entry.id, WORKER);
    const page = await (await get('/board', s)).text();
    expect(page).toContain('問題あり（運営が決める）');
    expect(page).toContain('ロゴ作り');
    expect((await form(s, `/board/entries/${a.entry.id}/pay`, {})).headers.get('location')).toBe('/board?msg=paid');
    expect((await walletOf(db, WORKER)).balance).toBe(900);
    expect((await form(s, `/board/entries/${a.entry.id}/refund`, {})).headers.get('location')).toBe('/board?msg=done_already');
    // 取り下げ: 採用しなかった 1 人分を戻す。応募の受付のスレッドを消し、採用しなかった人に知らせる
    const { setPostMessage } = await import('../src/services/board.js');
    await setPostMessage(db, r.post.id, { channelId: '910000000000000003', messageId: '910000000000000070', applyThreadId: '910000000000000071' });
    const other = await applyPost(db, cfg, r.post.id, { id: '870000000000000013', roleIds: [ROLE.sanpaisha] });
    if (other.status !== 'ok') throw new Error(other.status);
    actions = [];
    expect((await form(s, `/board/posts/${r.post.id}/remove`, {})).headers.get('location')).toBe('/board?msg=removed');
    expect(actions).toContain('deleteChannel 910000000000000071');
    expect(actions).toContain('dm 870000000000000013');
    expect((await getPost(db, r.post.id))!.status).toBe('removed');
    expect((await walletOf(db, AUTHOR)).balance).toBe(2000);
    expect((await listAudit(db, { action: 'board.pay' })).length).toBe(1);
  });
});

describe('キャスト（管理画面）', () => {
  const form = async (session: string, path: string, data: Record<string, string>) => {
    const csrf = /name="_csrf" value="([^"]+)"/.exec(await (await get('/', session)).text())![1]!;
    return app.request(path, {
      method: 'POST',
      headers: { cookie: `shamusho_session=${session}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, ...data }).toString(),
    });
  };

  it('設定・画像・承認・メニューを出す・通報を決める', async () => {
    const { applyCast, requestSession, acceptSession, disputeSession, getCast, CAST_DEFAULTS } = await import('../src/services/cast.js');
    const { walletOf } = await import('../src/services/economy.js');
    const s = await login(STAFF);
    expect(await (await get('/cast', s)).text()).toContain('申し込みはありません');
    expect((await form(s, '/cast/settings', { channelId: '910000000000000003', priceMin: '100', priceMax: '50', feePercent: '10', acceptMinutes: '10' })).headers.get('location')).toBe('/cast?msg=invalid');
    expect((await form(s, '/cast/settings', { channelId: '910000000000000003', roleId: '980000000000000001', priceMin: '100', priceMax: '30000', feePercent: '10', acceptMinutes: '10' })).headers.get('location')).toBe('/cast?msg=saved');
    // 画像
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    const fd = new FormData();
    fd.append('_csrf', /name="_csrf" value="([^"]+)"/.exec(await (await get('/', s)).text())![1]!);
    fd.append('image', new File([png], 'menu.png', { type: 'image/png' }));
    actions = [];
    const up = await app.request('/cast/image', { method: 'POST', headers: { cookie: `shamusho_session=${s}` }, body: fd });
    expect(up.headers.get('location')).toBe('/cast?msg=image_saved');
    expect(actions.some((a) => a.startsWith('send 910000000000000003') && a.includes('指名できます'))).toBe(true);
    expect((await get('/cast/image', s)).headers.get('content-type')).toBe('image/png');
    // 申し込み → 承認（ロールを付ける）
    const CAST = '880000000000000011';
    const GUEST = '880000000000000012';
    await applyCast(db, CAST_DEFAULTS, { id: CAST, adult: true }, { bio: 'よろしく', tags: ['寝落ち'], price30: 300, price60: 500, priceNight: 0, minorOk: true });
    expect(await (await get('/cast', s)).text()).toContain('よろしく');
    actions = [];
    expect((await form(s, `/cast/casts/${CAST}/active`, {})).headers.get('location')).toBe('/cast?msg=approved');
    expect(actions).toContain(`addRole ${CAST} 980000000000000001`);
    expect((await getCast(db, CAST))?.status).toBe('active');
    // 通報 → お客に戻す
    await addCoins(db, GUEST, 1000, 'adjust');
    const r = await requestSession(db, CAST_DEFAULTS, { castId: CAST, customerId: GUEST, customerAdult: true, plan: '60' });
    if (r.status !== 'ok') throw new Error(r.status);
    await acceptSession(db, r.session.id, CAST);
    await disputeSession(db, r.session.id, GUEST);
    expect(await (await get('/cast', s)).text()).toContain('通報（運営が決める）');
    expect((await form(s, `/cast/sessions/${r.session.id}/refund`, {})).headers.get('location')).toBe('/cast?msg=refunded');
    expect((await walletOf(db, GUEST)).balance).toBe(1000);
    expect((await form(s, `/cast/sessions/${r.session.id}/pay`, {})).headers.get('location')).toBe('/cast?msg=done_already');
    expect((await listAudit(db, { action: 'cast.refund' })).length).toBe(1);
  });
});

describe('社務所Web に入れる人（ロール・人ごとに見られるページ）', () => {
  it('ロールで足した人は、選んだページだけ。人で選ぶと神職でも絞れる。ページなしは入れない', async () => {
    const { ConfigStore, loadOverrides } = await import('../src/services/settings.js');
    const store = new ConfigStore(db, cfg);
    await store.refresh();
    app = createWebApp({ db, cfg: () => store.current, fileCfg: cfg, onSettingsSaved: () => store.refresh(), api: fakeApi, discord: fakeActions, baseUrl: BASE, now: () => clock });
    const KAMISHIRO_ROLE = '980000000000000055';
    const KAMISHIRO = '800000000000000055';
    roleList = [
      { id: cfg.guildId, name: '@everyone', position: 0, managed: false, color: 0, permissions: '0' },
      { id: KAMISHIRO_ROLE, name: '神代', position: 3, managed: false, color: 0, permissions: '0' },
    ];
    roles.set(KAMISHIRO, [KAMISHIRO_ROLE]);
    await recordJoin(db, { id: STAFF, username: 'staff', displayName: '神職さん', avatarUrl: null, roleIds: [ROLE.shinshoku], isBot: false, joinedAt: null });
    try {
      expect(await login(KAMISHIRO)).toBe('');
      const g = await login(GUJI);
      expect(await (await get('/settings', g)).text()).toContain('社務所Web に入れる人');
      const csrf = /name="_csrf" value="([^"]+)"/.exec(await (await get('/', g)).text())![1]!;
      const post = async (path: string, data: [string, string][]) =>
        (
          await app.request(path, {
            method: 'POST',
            headers: { cookie: `shamusho_session=${g}`, 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams([['_csrf', csrf], ...data]).toString(),
          })
        ).headers.get('location');
      const back = (msg: string) => `/settings?msg=${msg}&at=webaccess#sec-webaccess`;
      // ロール: ページなしは足せない
      expect(await post('/settings/web-access', [['kind', 'role'], ['roleId', KAMISHIRO_ROLE]])).toBe(back('webaccess_no_pages'));
      expect(await post('/settings/web-access', [['kind', 'role'], ['roleId', KAMISHIRO_ROLE], ['pages', 'members'], ['pages', 'board'], ['pages', 'nope']])).toBe(back('saved'));
      expect(store.current.webAccess.entries).toEqual([{ kind: 'role', id: KAMISHIRO_ROLE, pages: ['members', 'board'] }]);
      const k = await login(KAMISHIRO);
      expect(k).not.toBe('');
      // ホームは選んでいないので、最初のページへ
      const home = await get('/', k);
      expect(home.status).toBe(302);
      expect(home.headers.get('location')).toBe('/members');
      expect((await get('/members', k)).status).toBe(200);
      expect((await get(`/members/${USER}`, k)).status).toBe(200);
      expect((await get('/board', k)).status).toBe(200);
      expect((await get('/economy', k)).status).toBe(403);
      expect((await get('/omairi', k)).status).toBe(403);
      expect((await get('/updates', k)).status).toBe(200);
      // 宮司だけのページは入れない
      expect((await get('/shop', k)).status).toBe(403);
      // メニューにも選んだページだけ
      const menu = await (await get('/members', k)).text();
      expect(menu).toContain('href="/board"');
      expect(menu).not.toContain('href="/economy"');
      expect(menu).not.toContain('href="/audit"');

      // 人で: 名前でも選べる。神職でも、選んだページだけになる（ログイン中の人も次に開いたときから）
      const s = await login(STAFF);
      expect((await get('/audit', s)).status).toBe(200);
      expect(await post('/settings/web-access', [['kind', 'member'], ['member', 'だれでもない']])).toBe(back('webaccess_not_found'));
      expect(await post('/settings/web-access', [['kind', 'member'], ['member', '@神職さん'], ['pages', 'economy']])).toBe(back('saved'));
      expect((await get('/audit', s)).status).toBe(403);
      expect((await get('/economy', s)).status).toBe(200);
      // 役職のない人も、人で足せば入れる
      expect(await login(USER)).toBe('');
      expect(await post('/settings/web-access', [['kind', 'member'], ['member', 'sakura'], ['pages', '*'], ['pages', 'board']])).toBe(back('saved'));
      const u = await login(USER);
      expect(u).not.toBe('');
      expect((await get('/', u)).status).toBe(200);
      // ページなしの人は、神職でも入れない
      expect(await post('/settings/web-access', [['kind', 'member'], ['member', STAFF]])).toBe(back('saved'));
      expect((await get('/economy', s)).status).toBe(302);
      expect(await login(STAFF)).toBe('');
      // 外すと神職は元どおり
      expect(await post('/settings/web-access/remove', [['kind', 'member'], ['id', STAFF]])).toBe(back('webaccess_removed'));
      expect((await get('/audit', await login(STAFF))).status).toBe(200);
      // ほかの設定を保存しても消えない
      expect((await loadOverrides(db)).webAccess.entries).toEqual([
        { kind: 'role', id: KAMISHIRO_ROLE, pages: ['members', 'board'] },
        { kind: 'member', id: USER, pages: ['*'] },
      ]);
      expect(await (await get('/settings', g)).text()).toContain('@神代');
    } finally {
      roleList = [];
      roles.delete(KAMISHIRO);
    }
  });
});

describe('🪪 ID とパスワード・秘密の入口', () => {
  it('入口を通らないと何も見えない。ID とパスワードで入り、宮司が発行したアカウントはページを絞れて、止めるとすぐ入れない', async () => {
    const { createAccount } = await import('../src/services/webAccounts.js');
    const KEY = 'test-entry-key-0123456789';
    app = createWebApp({ db, cfg, api: fakeApi, discord: fakeActions, baseUrl: BASE, now: () => clock, discordLogin: false, entryKey: KEY });
    const g = await createAccount(db, { loginId: 'miyaji', name: '宮司さん', level: 'guji', pages: null }, 'cli');
    if (g.status !== 'ok') throw new Error(g.status);
    // 入口を通っていなければ、どこも「見つかりません」
    for (const p of ['/', '/login', '/members', '/auth/discord']) expect((await app.request(p)).status).toBe(404);
    expect((await app.request('/enter/wrong-key-0123456789')).status).toBe(404);
    const enter = await app.request(`/enter/${KEY}`);
    expect(enter.headers.get('location')).toBe('/login');
    const entry = `shamusho_entry=${cookiesFrom(enter).shamusho_entry}`;
    // Discord のログインは止めている
    expect((await app.request('/auth/discord', { headers: { cookie: entry } })).status).toBe(404);
    const loginAs = async (loginId: string, password: string) => {
      const page = await app.request('/login', { headers: { cookie: entry } });
      const html = await page.text();
      expect(html).toContain('name="loginId"');
      expect(html).not.toContain('Discord でログイン');
      const csrf = /name="_csrf" value="([^"]+)"/.exec(html)![1]!;
      const lc = cookiesFrom(page).shamusho_login!;
      const res = await app.request('/login', {
        method: 'POST',
        headers: { cookie: `${entry}; shamusho_login=${lc}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ _csrf: csrf, loginId, password }).toString(),
      });
      return { location: res.headers.get('location'), session: cookiesFrom(res).shamusho_session };
    };
    expect((await loginAs('miyaji', 'wrong')).location).toBe('/login?e=wrong');
    const me = await loginAs('Miyaji', g.password);
    expect(me.location).toBe('/');
    const s = me.session!;
    expect((await get('/', s)).status).toBe(200);
    expect(await (await get('/settings', s)).text()).toContain('社務所Web のアカウント');
    // 神職のアカウントを発行（掲示板だけ）→ パスワードはこの画面だけ
    const csrf = /name="_csrf" value="([^"]+)"/.exec(await (await get('/', s)).text())![1]!;
    const issued = await app.request('/settings/accounts', {
      method: 'POST',
      headers: { cookie: `shamusho_session=${s}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams([['_csrf', csrf], ['loginId', 'shin'], ['name', '神職さん'], ['level', 'shinshoku'], ['pages', 'board']]).toString(),
    });
    const issuedHtml = await issued.text();
    expect(issuedHtml).toContain('アカウントを発行しました');
    const pw = /<code class="secret">([^<]+)<\/code>/.exec(issuedHtml)![1]!;
    const shin = await loginAs('shin', pw);
    expect(shin.location).toBe('/');
    const home = await get('/', shin.session!);
    expect(home.headers.get('location')).toBe('/board');
    expect((await get('/economy', shin.session!)).status).toBe(403);
    // 止めると、ログイン中でもすぐ入れない
    const { listAccounts } = await import('../src/services/webAccounts.js');
    const id = (await listAccounts(db)).find((a) => a.loginId === 'shin')!.id;
    const stop = await app.request(`/settings/accounts/${id}/toggle`, {
      method: 'POST',
      headers: { cookie: `shamusho_session=${s}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf }).toString(),
    });
    expect(stop.headers.get('location')).toBe('/settings?msg=account_disabled&at=accounts#sec-accounts');
    expect((await get('/board', shin.session!)).status).toBe(404);
    expect((await app.request('/board', { headers: { cookie: `${entry}; shamusho_session=${shin.session}` } })).headers.get('location')).toBe('/login?e=expired');
  });
});

describe('🚪 最近抜けた人（ホーム）', () => {
  it('ホームに 30 秒ごとに読み直すカード。抜けた人が並ぶ', async () => {
    const { recordLeave } = await import('../src/services/members.js');
    const s = await login(STAFF);
    expect(await (await get('/', s)).text()).toContain('hx-get="/members/left"');
    expect(await (await get('/members/left', s)).text()).toContain('まだ抜けた人はいません');
    await recordLeave(db, USER);
    const html = await (await get('/members/left', s)).text();
    expect(html).toContain('@sakura');
    expect(html).toContain(`/members/${USER}`);
  });
});

describe('👥 人数の差（ホームのポップアップ）', () => {
  it('ホームの参加・退出を押すとポップアップ。ページでは日時を選んでくらべられる', async () => {
    const { recordLeave } = await import('../src/services/members.js');
    const s = await login(STAFF);
    const home = await (await get('/', s)).text();
    expect(home).toContain('data-popup="/members/diff?since=today&amp;popup=1"');
    expect(home).toContain('id="popup"');
    await recordLeave(db, USER);
    const pop = await (await get('/members/diff?since=today&popup=1', s)).text();
    expect(pop).toContain('今日の 0 時から今までの人数');
    expect(pop).toContain('@sakura');
    expect(pop).not.toContain('<html');
    const page = await (await get('/members/diff?at=2026-09-20T10:00', s)).text();
    expect(page).toContain('2026-09-20 10:00の人数');
    expect(page).toContain('name="at"');
  });
});


describe('🔐 チャンネルの見られる人・ロール', () => {
  it('編集ページで今見られるロールを見て、ロールを足して許可・拒否を決められる', async () => {
    const R = '980000000000000071';
    roleList = [
      { id: cfg.guildId, name: '@everyone', position: 0, managed: false, color: 0, permissions: String(1 << 10) },
      { id: R, name: '参拝者', position: 2, managed: false, color: 0, permissions: '0' },
    ];
    try {
      const g = await login(GUJI);
      const page = await (await get('/channels/910000000000000002', g)).text();
      expect(page).toContain('見られる人・ロール');
      expect(page).toContain('みんな（@everyone）');
      const csrf = /name="_csrf" value="([^"]+)"/.exec(page)![1]!;
      const post = (data: Record<string, string>) =>
        app.request('/channels/910000000000000002/perms', {
          method: 'POST',
          headers: { cookie: `shamusho_session=${g}`, 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ _csrf: csrf, rows: '0', ...data }).toString(),
        });
      actions = [];
      const r = await post({ 'new.role': R, 'new.view': 'allow', 'new.send': 'deny' });
      expect(r.headers.get('location')).toBe('/channels/910000000000000002?msg=perms_saved');
      expect(actions).toEqual([`overwrite 910000000000000002 ${R} allow=${1 << 10} deny=${1 << 11}`]);
      expect((await post({ 'new.member': 'だれでもない' })).headers.get('location')).toBe('/channels/910000000000000002?msg=perms_member_not_found');
      expect((await post({})).headers.get('location')).toBe('/channels/910000000000000002?msg=unchanged');
    } finally {
      roleList = [];
    }
  });
});

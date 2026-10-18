import { afterEach, beforeEach, expect, it } from 'vitest';
import { createWebApp } from '../src/web/app.js';
import type { DiscordApi } from '../src/web/discordApi.js';
import type { DiscordActions } from '../src/lib/discordRest.js';
import { createMemberSession } from '../src/web/memberSessions.js';
import { createLoginLink } from '../src/services/casino/loginLinks.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { recordJoin } from '../src/services/members.js';
import { makeDb, cfg, ROLE } from './helpers.js';
import type { ShinpuRooms } from '../src/services/shinpu/rooms.js';
type RoomView = ReturnType<ShinpuRooms['view']>;
import type { Db } from '../src/db/client.js';
const BASE = 'https://shamusho.example.com',
  ROOT = '/casino/shinpu',
  A = '760000000000000001',
  B = '760000000000000002';
let db: Db, close: () => Promise<void>, app: ReturnType<typeof createWebApp>, roles: string[], fail: boolean, cookie: string, csrf: string;
function token(res: Response, key: string) {
  return res.headers
    .getSetCookie()
    .find((x) => x.startsWith(key + '='))
    ?.split(';')[0]!
    .slice(key.length + 1);
}
beforeEach(async () => {
  ({ db, close } = await makeDb());
  roles = [ROLE.guji];
  fail = false;
  const api: DiscordApi = {
    authorizeUrl: (s, r) => `https://discord.com/auth?state=${s}&redirect_uri=${encodeURIComponent(r)}`,
    exchangeCode: async () => 'access',
    me: async () => ({ id: A, username: 'ais', displayName: 'ais <b>', avatarUrl: null }),
    memberRoles: async () => {
      if (fail) throw Error('offline');
      return roles;
    },
  };
  app = createWebApp({ db, cfg: () => cfg, api, discord: {} as DiscordActions, baseUrl: BASE });
  cookie = await createMemberSession(db, { id: A, username: 'ais', displayName: 'ais <b>', avatarUrl: null });
  const page = await app.request(ROOT, { headers: { cookie: 'sakura_shinpu_test=' + cookie } });
  csrf = /data-csrf="([^"]+)"/.exec(await page.text())![1]!;
});
afterEach(async () => close());
const headers = () => ({ cookie: 'sakura_shinpu_test=' + cookie, origin: BASE, 'content-type': 'application/json', 'x-csrf-token': csrf });
const post = (body: unknown, h = headers()) => app.request(ROOT + '/api', { method: 'POST', headers: h, body: JSON.stringify(body) });
const get = (path = ROOT + '/api') => app.request(path, { headers: { cookie: 'sakura_shinpu_test=' + cookie } });
it('未認証・通常のカジノCookie・一般ロールでは部屋を操作できない', async () => {
  expect((await app.request(ROOT + '/api')).status).toBe(401);
  expect((await app.request(ROOT + '/api', { headers: { cookie: 'sakura_casino=' + cookie } })).status).toBe(401);
  roles = [ROLE.sanpaisha];
  expect((await post({ operation: 'create', capacity: 2 })).status).toBe(403);
});
it('神器図鑑と個別の札でも認証と運営ロールを毎回確かめる', async () => {
  for (const path of [ROOT + '/cards', ROOT + '/cards/SK-038']) {
    expect((await app.request(path)).status).toBe(401);
    expect((await get(path)).status).toBe(200);
    fail = true;
    expect((await get(path)).status).toBe(503);
    fail = false;
  }
  expect((await get(ROOT + '/cards/unknown')).status).toBe(404);
  const search = await get(ROOT + '/cards?q=SK-038');
  expect(await search.text()).toContain('紫電の短刀');
  roles = [ROLE.sanpaisha];
  expect((await get(ROOT + '/cards')).status).toBe(403);
});
it('4〜10枚の選択を対戦処理へ渡し、11枚以上は受付で拒否する', async () => {
  const created = (await (await post({ operation: 'create', capacity: 2 })).json()) as RoomView;
  const started = (await (await post({ operation: 'start', roomId: created.roomId, revision: created.revision })).json()) as RoomView;
  for (const count of [4, 10, 11]) {
    const res = await post({ operation: 'move', roomId: created.roomId, revision: started.revision, action: 'attack', target: 1,
      ids: Array.from({ length: count }, (_, i) => 10000 + i) });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe(count <= 10 ? '手札にない札です。' : '送る内容を確認してください。');
  }
});
it('Web操作で運営ロールを再確認し、接続失敗時も許可しない', async () => {
  fail = true;
  expect((await get()).status).toBe(503);
  expect((await post({ operation: 'create', capacity: 2 })).status).toBe(503);
  fail = false;
  roles = [];
  expect((await get()).status).toBe(403);
});
it('OriginとCSRFを両方確認し、不正な入力を拒否する', async () => {
  expect((await post({ operation: 'create', capacity: 2 }, { ...headers(), origin: 'https://evil.example' })).status).toBe(403);
  expect((await post({ operation: 'create', capacity: 2 }, { ...headers(), 'x-csrf-token': 'bad' })).status).toBe(403);
  expect((await post({ operation: 'create', capacity: 99 })).status).toBe(400);
});
it('部屋作成・人間の参加・開始・両替を通して実際の残高は動かない', async () => {
  await recordJoin(db, { id: A, username: 'ais', displayName: 'ais', avatarUrl: null, roleIds: roles, isBot: false, joinedAt: new Date() });
  await addCoins(db, A, 500, 'admin_grant');
  const created = (await (await post({ operation: 'create', capacity: 2 })).json()) as RoomView;
  const other = await createMemberSession(db, { id: B, username: 'b', displayName: 'b', avatarUrl: null });
  const page = await app.request(ROOT, { headers: { cookie: 'sakura_shinpu_test=' + other } });
  const c = /data-csrf="([^"]+)"/.exec(await page.text())![1]!;
  const joined = (await (
    await post({ operation: 'join', roomId: created.roomId }, { ...headers(), cookie: 'sakura_shinpu_test=' + other, 'x-csrf-token': c })
  ).json()) as RoomView;
  const started = (await (await post({ operation: 'start', roomId: created.roomId, revision: joined.revision })).json()) as RoomView;
  expect(started.state!.players[1]!.hand).toEqual([]);
  const result = (await (
    await post({ operation: 'move', roomId: created.roomId, revision: started.revision, action: 'exchange', target: 'mp' })
  ).json()) as RoomView;
  expect(result.state!.players[0]!.money).toBe(16);
  expect((await walletOf(db, A)).balance).toBe(500);
  expect(
    (await post({ operation: 'move', roomId: created.roomId, revision: started.revision, action: 'exchange', target: 'mp' })).status,
  ).toBe(400);
});
it('BOTのリンクは開いただけでは消費せず、POSTで1回だけ認証する', async () => {
  const link = await createLoginLink(db, { id: A, displayName: 'ais', avatarUrl: null });
  expect((await app.request(ROOT + '/link/' + link)).status).toBe(200);
  expect((await app.request(ROOT + '/link/' + link, { method: 'POST', headers: { origin: 'https://evil.example' } })).status).toBe(403);
  const login = await app.request(ROOT + '/link/' + link, { method: 'POST', headers: { origin: BASE } });
  expect(login.headers.get('location')).toBe(ROOT);
  expect(token(login, 'sakura_shinpu_test')).toBeTruthy();
  expect((await app.request(ROOT + '/link/' + link, { method: 'POST', headers: { origin: BASE } })).status).toBe(410);
});
it('既存のカジノOAuthコールバックを使い、神職も入れる', async () => {
  roles = [ROLE.shinshoku];
  const start = await app.request(ROOT + '/auth');
  expect(start.headers.get('location')).toContain(encodeURIComponent(BASE + '/casino/auth/callback'));
  const state = token(start, 'sakura_shinpu_state')!;
  const login = await app.request('/casino/auth/callback?code=good&state=' + state, {
    headers: { cookie: 'sakura_shinpu_state=' + state },
  });
  expect(login.headers.get('location')).toBe(ROOT);
  expect(token(login, 'sakura_shinpu_test')).toBeTruthy();
  expect(
    (await app.request('/casino/auth/callback?code=good&state=bad', { headers: { cookie: 'sakura_shinpu_state=' + state } })).headers.get(
      'location',
    ),
  ).toBe('/casino?e=state');
});
it('厳しいCSPで外部JSだけを使い、表示名をHTMLとして実行しない', async () => {
  const res = await get(ROOT),
    html = await res.text();
  expect(html).toContain('ais &lt;b&gt;');
  expect(html).not.toMatch(/<script>\s*\S/);
  expect(html).not.toMatch(/onclick=|style=/);
  expect(res.headers.get('content-security-policy')).not.toContain("'unsafe-inline'");
  expect((await app.request('/static/shinpu.js')).status).toBe(200);
  expect((await app.request('/static/shinpu.css')).status).toBe(200);
});

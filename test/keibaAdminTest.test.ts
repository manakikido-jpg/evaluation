import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { makeDb, cfg, ROLE } from './helpers.js';
import type { Db } from '../src/db/client.js';
import { createWebApp } from '../src/web/app.js';
import { createSession, findSession } from '../src/web/sessions.js';
import { createMemberSession } from '../src/web/memberSessions.js';
import { recordJoin } from '../src/services/members.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { casinoTables, keibaHorses, keibaReplays } from '../src/db/schema.js';
const id = '760000000000000001', now = new Date('2026-10-28T03:00:00Z');
const user = { id, username: 'sample', displayName: '試走の運営', avatarUrl: null };
let db: Db, close: () => Promise<void>, app: ReturnType<typeof createWebApp>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  await recordJoin(db, { ...user, roleIds: [ROLE.guji], isBot: false, joinedAt: now });
  await addCoins(db, id, 1234, 'adjust');
  app = createWebApp({ db, cfg: () => cfg, api: { memberRoles: async () => [ROLE.guji] } as never, discord: {} as never, baseUrl: 'https://example.test', now: () => now });
});
afterEach(async () => { await close(); });
const headers = (token: string) => ({ cookie: 'shamusho_session=' + token });
describe('社務所の競馬テスト', () => {
  it('未ログイン・メンバー用セッションでは開けず、経済のページ権限も必要', async () => {
    for (const suffix of ['', '?phase=race']) {
      expect((await app.request('/economy/keiba-test' + suffix)).status).toBe(302);
      const member = await createMemberSession(db, user, now);
      expect((await app.request('/economy/keiba-test' + suffix, { headers: { cookie: 'sakura_casino=' + member } })).status).toBe(302);
    }
    const limited = await createSession(db, user, { level: 'shinshoku', pages: ['members'] }, now);
    expect((await app.request('/economy/keiba-test?phase=race', { headers: headers(limited) })).status).toBe(403);
  });
  it('宮司・神職が社務所のセッションだけで開け、メニューから入れる', async () => {
    for (const level of ['guji', 'shinshoku'] as const) {
      const token = await createSession(db, user, { level, pages: ['economy'] }, now);
      const page = await app.request('/economy/keiba-test', { headers: headers(token) });
      expect(page.status).toBe(200);
      expect(page.headers.get('cache-control')).toContain('no-store');
      const text = await page.text();
      expect(text).toContain('競馬・運営テスト');
      expect(text).toContain('data-kb-test="true"');
      expect(text).not.toContain('action="/casino/');
      const menu = await app.request('/economy', { headers: headers(token) });
      expect(await menu.text()).toContain('href="/economy/keiba-test"');
    }
  });
  it('サンプル映像は実卓への情報取得を持たず、追従馬の選択も運営の画面に留まる', async () => {
    const token = await createSession(db, user, { level: 'guji', pages: null }, now);
    const html = await (await app.request('/economy/keiba-test?phase=race&follow=3', { headers: headers(token) })).text();
    expect(html).toContain('data-keiba-preview=');
    expect(html).toContain('action="/economy/keiba-test"');
    expect(html).toContain('name="phase" value="race"');
    expect(html).toContain('value="3" selected');
    expect(html).not.toContain('/state?race=');
    expect(html).not.toContain('/casino/keiba/preview');
    const none = await (await app.request('/economy/keiba-test?phase=race&follow=0', { headers: headers(token) })).text();
    expect(none).not.toContain('data-kr-camera="mine"');
  });
  it('繰り返し確認・偽の購入送信をしても残高や実馬・卓・リプレイを変更しない', async () => {
    const token = await createSession(db, user, { level: 'guji', pages: null }, now);
    const count = async () => Promise.all([casinoTables, keibaHorses, keibaReplays].map(async table => (await db.select({ n: sql<number>`count(*)::int` }).from(table))[0]!.n));
    const before = await count();
    for (const phase of ['betting', 'race', 'bad']) await app.request('/economy/keiba-test?phase=' + phase + '&follow=999&action=bets&bet=1000', { headers: headers(token) });
    const response = await app.request('/economy/keiba-test', { method: 'POST', headers: headers(token), body: new URLSearchParams({ action: 'bets', bet: '1000' }) });
    expect(response.status).toBe(403);
    const session = (await findSession(db, token, now))!;
    const withCsrf = await app.request('/economy/keiba-test', { method: 'POST', headers: headers(token), body: new URLSearchParams({ _csrf: session.csrfToken, action: 'bets', bet: '1000' }) });
    expect(withCsrf.status).toBe(404);
    expect((await walletOf(db, id)).balance).toBe(1234);
    expect(await count()).toEqual(before);
  });
});

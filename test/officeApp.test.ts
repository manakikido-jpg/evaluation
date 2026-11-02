import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import type { Db } from '../src/db/client.js';
import type { WebAccess } from '../src/config.js';
import { adminSessions, applications, auditLogs, members, officeApp, officeSubscriptions, soudan, guideReceptions } from '../src/db/schema.js';
import { createWebApp } from '../src/web/app.js';
import { createSession, findSession } from '../src/web/sessions.js';
import { normalizeOfficeIcon } from '../src/web/office.js';
import { deliverOfficePush, subscribeOffice, validPushEndpoint, pushAccess } from '../src/services/officeNotifications.js';
import { cfg, makeDb, ROLE } from './helpers.js';
import type { DiscordApi } from '../src/web/discordApi.js';
import type { DiscordActions } from '../src/lib/discordRest.js';
import { applyOverrides, loadOverrides } from '../src/services/settings.js';

const user = '700000000000000051';
const now = new Date('2026-11-02T01:00:00Z');
let db: Db, close: () => Promise<void>, app: ReturnType<typeof createWebApp>, token: string, csrf: string;
let roleCheck: ReturnType<typeof vi.fn>;
const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/test-device', keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) } };
beforeEach(async () => {
  ({ db, close } = await makeDb());
  roleCheck = vi.fn().mockResolvedValue([ROLE.shinshoku]);
  let config = cfg;
  app = createWebApp({ db, cfg: () => config, baseUrl: 'https://test.example', api: { memberRoles: roleCheck } as unknown as DiscordApi,
    discord: { guildRoles: async () => [{ id: ROLE.ujiko, name: '氏子', position: 1, managed: false }] } as unknown as DiscordActions,
    now: () => now, onSettingsSaved: async () => { config = applyOverrides(cfg, await loadOverrides(db)); } });
  await login({ level: 'guji', pages: null });
});
afterEach(async () => close());
async function login(access: WebAccess) {
  token = await createSession(db, { id: user, username: 'staff', displayName: '運営', avatarUrl: null }, access, now);
  csrf = (await findSession(db, token, now))!.csrfToken;
}
const get = (path: string) => app.request(path, { headers: { cookie: `shamusho_session=${token}` } });
const post = (path: string, body: Record<string, string> = {}) => app.request(path, { method: 'POST', headers: { cookie: `shamusho_session=${token}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrf, ...body }) });
async function seed() {
  await db.insert(applications).values({ memberId: 'visitor', kind: 'join', createdAt: now });
  await db.insert(soudan).values({ createdAt: now, updatedAt: now });
  await db.insert(guideReceptions).values({ visitorId: 'visitor', channelId: 'channel', createdAt: now });
  await db.insert(auditLogs).values({ actorId: 'system', action: 'security.role_alert', via: 'system', at: now });
}
it('閲覧のみはPOSTを拒否し、権限外の画面・JSONを見せない。Discord障害中も同じ', async () => {
  await login({ level: 'shinshoku', pages: ['guide'], writePages: [] });
  for (const path of ['/guide/anything', '/office/access', '/office/icon']) expect((await post(path)).status).toBe(403);
  expect((await get('/soudan')).status).toBe(403);
  expect((await get('/voice-now.json')).status).toBe(403);
  expect((await get('/security')).status).toBe(403);
  const session = (await findSession(db, token, now))!;
  await db.update(adminSessions).set({ checkedAt: new Date(now.getTime() - 6 * 60_000) }).where(eq(adminSessions.id, session.id));
  roleCheck.mockRejectedValue(new Error('test unavailable'));
  expect((await get('/soudan')).status).toBe(403);
  expect((await post('/guide/anything')).status).toBe(403);
});
it('担当の通知画面だけ表示し、端末購読はCSRFとページ権限で守る', async () => {
  await seed(); await login({ level: 'shinshoku', pages: ['guide'], writePages: [] });
  const html = await (await get('/office/app')).text();
  expect(html).toContain('案内所の対応待ち'); expect(html).not.toContain('相談の対応待ち'); expect(html).not.toContain('共通のアプリアイコン');
  expect((await post('/office/push/subscribe', { subscription: JSON.stringify(subscription), topic: 'guide', _csrf: 'wrong' })).status).toBe(403);
  expect((await post('/office/push/subscribe', { subscription: JSON.stringify(subscription), topic: 'soudan' })).status).toBe(400);
  expect((await post('/office/push/subscribe', { subscription: JSON.stringify(subscription), topic: 'guide' })).status).toBe(200);
  expect((await db.select().from(officeSubscriptions))[0]!.topics).toEqual(['guide']);
  expect((await post('/logout')).status).toBe(302);
  expect(await db.select().from(officeSubscriptions)).toEqual([]);
});
it('権限保存は宮司・CSRF・確認が必要で、保存直後に既存セッションを再確認する', async () => {
  await db.insert(members).values({ id: user, username: 'staff', displayName: '運営', roleIds: [ROLE.shinshoku] });
  const form = { kind: 'member', member: user, page_guide: 'read', confirm: 'yes' };
  expect((await post('/office/access', { ...form, _csrf: 'bad' })).status).toBe(403);
  expect((await post('/office/access', { ...form, confirm: '' })).headers.get('location')).toContain('invalid');
  expect((await post('/office/access', form)).headers.get('location')).toContain('saved');
  expect((await loadOverrides(db)).webAccess.entries).toContainEqual({ kind: 'member', id: user, pages: ['guide'], writePages: [] });
  expect((await post('/guide/anything')).status).toBe(403);
  expect((await get('/office/access')).status).toBe(403);
});
it('manifest・標準アイコン・SWを取得でき、SWは個人情報を保存しない', async () => {
  const manifest = await (await app.request('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ start_url: '/office/app', display: 'standalone' });
  const response = await app.request('/office-icon/192.png');
  expect(response.headers.get('content-type')).toBe('image/png');
  expect((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).width).toBe(192);
  const sw = await app.request('/service-worker.js');
  expect(sw.headers.get('service-worker-allowed')).toBe('/');
  expect(await sw.text()).not.toMatch(/caches\.(open|put|add)/);
  expect((await get('/office/app')).headers.get('cache-control')).toBe('no-store');
  const html = await (await get('/office/access')).text();
  expect(html).toContain('案内'); expect(html).toContain('data-office-grant');
  expect(html).not.toMatch(/onclick=|style=|<script>/);
});
it('アイコンは形式とサイズを調べ、メタデータを除いたPNGへ変換する', async () => {
  const source = await sharp({ create: { width: 100, height: 80, channels: 3, background: '#fff' } }).jpeg().toBuffer();
  const normalized = await normalizeOfficeIcon(source);
  expect(await sharp(Buffer.from(normalized, 'base64')).metadata()).toMatchObject({ format: 'png', width: 512, height: 512 });
  await expect(normalizeOfficeIcon(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).rejects.toThrow();
  await expect(normalizeOfficeIcon(Buffer.alloc(2 * 1024 * 1024 + 1))).rejects.toThrow();
});
it('通知をまとめ、成功済みは重複させない。追加・権限変更・410に追従する', async () => {
  await seed(); const session = (await findSession(db, token, now))!;
  await subscribeOffice(db, session, subscription, ['applications', 'soudan', 'guide', 'security'], now);
  const access = vi.fn().mockResolvedValue({ level: 'shinshoku', pages: ['guide'] });
  const send = vi.fn().mockResolvedValue({});
  await deliverOfficePush(db, access, 'https://test.example', now, send);
  expect(send).toHaveBeenCalledTimes(1);
  expect(JSON.parse(send.mock.calls[0]![1])).toEqual({ title: '咲楽ノ宮 社務所', body: '確認が必要なお知らせがあります。社務所を開いて確認してください。', url: '/office/app' });
  expect((await db.select().from(officeSubscriptions))[0]!.lastKeys).toEqual(['guide:1']);
  await deliverOfficePush(db, access, 'https://test.example', new Date(now.getTime() + 60_000), send);
  expect(send).toHaveBeenCalledTimes(1);
  access.mockRejectedValueOnce(new Error('Discord unavailable'));
  await deliverOfficePush(db, access, 'https://test.example', new Date(now.getTime() + 120_000), send);
  expect(send).toHaveBeenCalledTimes(1);
  await db.insert(guideReceptions).values({ visitorId: 'second', channelId: 'channel' });
  send.mockRejectedValue({ statusCode: 410 });
  await deliverOfficePush(db, access, 'https://test.example', new Date(now.getTime() + 420_000), send);
  expect(await db.select().from(officeSubscriptions)).toEqual([]);
  expect(await db.select({ publicKey: officeApp.publicKey }).from(officeApp)).toHaveLength(1);
});
it('購読の配信先を制限し、権限を失った人へ配信しない', async () => {
  for (const endpoint of ['http://fcm.googleapis.com/a', 'https://localhost/a', 'https://127.0.0.1/a', 'https://fcm.googleapis.com.evil.test/a', 'https://fcm.googleapis.com:8080/a', 'https://user:pass@fcm.googleapis.com/a']) expect(validPushEndpoint(endpoint)).toBe(false);
  for (const endpoint of ['https://web.push.apple.com/a', 'https://updates.push.services.mozilla.com/a', subscription.endpoint]) expect(validPushEndpoint(endpoint)).toBe(true);
  await subscribeOffice(db, (await findSession(db, token, now))!, subscription, ['guide'], now);
  const send = vi.fn(); await deliverOfficePush(db, async () => undefined, 'https://test.example', now, send);
  expect(send).not.toHaveBeenCalled(); expect(await db.select().from(officeSubscriptions)).toEqual([]);
  roleCheck.mockResolvedValue([]);
  expect(await pushAccess(db, () => cfg, { memberRoles: roleCheck } as unknown as DiscordApi)({ userId: user, accountId: null })).toBeUndefined();
});

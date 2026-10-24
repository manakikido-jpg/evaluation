import { afterEach, beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { galleryRewards, members } from '../src/db/schema.js';
import type { DiscordActions, GalleryMessage } from '../src/lib/discordRest.js';
import { createWebApp } from '../src/web/app.js';
import type { DiscordApi } from '../src/web/discordApi.js';
import { createSession, findSession } from '../src/web/sessions.js';
import { loadGalleryPrices, saveGalleryPrices } from '../src/services/galleryRewards.js';
import { saveOverrides, loadOverrides, applyOverrides, overridesSchema } from '../src/services/settings.js';
import { cfg, makeDb } from './helpers.js';
const A = '700000000000000001', STAFF = '700000000000000002', PHOTO = '710000000000000001', ID = '720000000000000001';
const at = new Date('2026-10-23T12:00:00+09:00');
let db: Db, close: () => Promise<void>, app: ReturnType<typeof createWebApp>, cookie: string, csrf: string, reads: number;
beforeEach(async () => {
  ({ db, close } = await makeDb()); reads = 0;
  await db.insert(members).values({ id: A, username: 'a', displayName: '投稿者' });
  const m: GalleryMessage = { id: ID, channel_id: PHOTO, timestamp: '2026-10-23T00:00:00Z', author: { id: A }, attachments: [{ id: 'a', content_type: 'image/png' }] };
  app = createWebApp({ db, cfg, api: {} as DiscordApi, baseUrl: 'https://test.example', now: () => at,
    discord: { guildChannels: async () => [{ id: PHOTO, name: '写真館', type: 0, parent_id: null, position: 0 }], galleryMessage: async () => { reads++; return m; } } as unknown as DiscordActions });
  await login('guji');
});
afterEach(async () => close());
async function login(level: 'guji' | 'shinshoku', pages: ('economy' | 'board')[] | null = null) {
  cookie = await createSession(db, { id: STAFF, username: 'staff', displayName: '運営', avatarUrl: null }, { level, pages }, at);
  csrf = (await findSession(db, cookie, at))!.csrfToken;
}
const get = () => app.request('/economy/gallery', { headers: { cookie: 'shamusho_session=' + cookie } });
const post = (action: string, body: Record<string, string>) => app.request('/economy/gallery/' + action, { method: 'POST', headers: { cookie: 'shamusho_session=' + cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrf, ...body }) });
it('ログインと経済ページ権限を必須にし、未許可POSTから投稿を読み取らない', async () => {
  expect((await app.request('/economy/gallery')).status).toBe(302);
  await login('shinshoku', ['board']);
  expect((await get()).status).toBe(403);
  expect((await post('register', { link: `https://discord.com/channels/${cfg.guildId}/${PHOTO}/${ID}`, kind: 'full' })).status).toBe(403);
  expect(reads).toBe(0);
});
it('金額欄と固定ルールを表示し、CSRF偽装・小数・負数・欠落を保存しない', async () => {
  const html = await (await get()).text();
  expect(html).toContain('週2回'); expect(html).toContain('金額を保存'); expect(html).toContain('日曜');
  const prices = { full: '200', half: '100', song: '200', voice: '200' };
  expect((await post('prices', { ...prices, _csrf: 'bad' })).status).toBe(403);
  expect((await post('prices', { ...prices, full: '1.5' })).status).toBe(400);
  expect((await post('prices', { ...prices, half: '-1' })).status).toBe(400);
  expect((await post('prices', { full: '150' })).status).toBe(400);
  expect(await loadGalleryPrices(db)).toEqual({ full: 150, half: 75, song: 150, voice: 150 });
});
it('宮司だけ金額を変更し、他設定保存でも保持。余分な回数・締切入力は使わない', async () => {
  const prices = { full: '200', half: '100', song: '300', voice: '250', weeklyLimit: '999', deadline: 'sunday' };
  await login('shinshoku', ['economy']);
  expect((await post('prices', prices)).status).toBe(403);
  await login('guji');
  expect((await post('prices', prices)).status).toBe(303);
  await saveOverrides(db, overridesSchema.parse({ casino: { enabled: false } }), STAFF);
  expect(applyOverrides(cfg, await loadOverrides(db)).casino.enabled).toBe(false);
  expect(await loadGalleryPrices(db)).toEqual({ full: 200, half: 100, song: 300, voice: 250 });
});
it('運営は投稿リンクと区分だけ登録でき、金額・投稿者・時刻を偽装できない。重複と取消を検証', async () => {
  await login('shinshoku', ['economy']);
  const body = { link: `https://discord.com/channels/${cfg.guildId}/${PHOTO}/${ID}`, kind: 'half', amount: '99999', memberId: STAFF, postedAt: '2000-01-01', day: 'saturday' };
  expect((await post('register', { ...body, _csrf: '' })).status).toBe(403);
  expect(reads).toBe(0);
  expect((await post('register', body)).status).toBe(303);
  const [row] = await db.select().from(galleryRewards);
  expect(row).toMatchObject({ amount: 75, memberId: A, day: '2026-10-23', status: 'pending', kind: 'half' });
  expect((await post('register', body)).status).toBe(400);
  expect((await post('cancel', { messageId: ID })).status).toBe(303);
  expect((await db.select().from(galleryRewards))[0]?.status).toBe('cancelled');
});
it('報酬を止めても既に登録した投稿の金額は残る', async () => {
  const body = { link: `https://discord.com/channels/${cfg.guildId}/${PHOTO}/${ID}`, kind: 'full' };
  expect((await post('register', body)).status).toBe(303);
  await saveGalleryPrices(db, { full: 0 }, STAFF);
  expect((await db.select().from(galleryRewards))[0]?.amount).toBe(150);
});

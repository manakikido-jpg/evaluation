import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import type { Db } from '../src/db/client.js';
import { createWebApp } from '../src/web/app.js';
import { createSession, findSession } from '../src/web/sessions.js';
import { createLoginLink } from '../src/services/casino/loginLinks.js';
import { getSticker, listStickers, saveSticker, prepareSticker, submitSticker } from '../src/services/stickers.js';
import { cfg, makeDb, ROLE } from './helpers.js';
const USER = '700000000000000001', OTHER = '700000000000000002', CREATOR = '700000000000000003', STAFF = '700000000000000004', ID = '700000000000000009';
let db: Db, close: () => Promise<void>, app: ReturnType<typeof createWebApp>, roles: Map<string, string[]>, create: ReturnType<typeof vi.fn>;
const clock = new Date();
beforeEach(async () => {
  ({ db, close } = await makeDb()); roles = new Map([[USER, [CREATOR]], [OTHER, [CREATOR]], [STAFF, [ROLE.guji]]]);
  create = vi.fn(async () => ({ id: ID, name: 'おはよう' }));
  app = createWebApp({ db, cfg, baseUrl: 'https://example.com', now: () => clock,
    api: { memberRoles: async (_g: string, id: string) => roles.get(id) ?? null } as never,
    discord: { guildRoles: async () => [{ id: CREATOR, name: 'スタンプ製作者', managed: false, color: 0, position: 1 }], guildChannels: async () => [], sendMessage: vi.fn(async () => ({ id: 'log' })), createGuildSticker: create, guildStickers: async () => [] } as never });
});
afterEach(async () => { await close(); });
async function creator(user = USER) {
  const link = await createLoginLink(db, { id: user, displayName: '製作者', avatarUrl: null }, clock);
  const res = await app.request(`/sticker-desk/link/${link}`, { method: 'POST' });
  const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
  const html = await (await app.request('/sticker-desk', { headers: { cookie } })).text();
  return { cookie, csrf: /name="_csrf" value="([^"]+)"/.exec(html)![1]!, link };
}
async function staff(pages?: ('home' | 'stickers')[], level: 'guji' | 'shinshoku' = 'guji') {
  const token = await createSession(db, { id: STAFF, username: 'staff', displayName: 'staff', avatarUrl: null }, { level, pages: pages ?? null }, clock);
  return { cookie: `shamusho_session=${token}`, csrf: (await findSession(db, token, clock))!.csrfToken };
}
const post = (path: string, s: { cookie: string; csrf: string }, values: Record<string, string> = {}) => app.request(path, { method: 'POST', headers: { cookie: s.cookie }, body: new URLSearchParams({ _csrf: s.csrf, ...values }) });
async function png() { return await sharp({ create: { width: 640, height: 480, channels: 4, background: '#ffccff' } }).png().toBuffer(); }
it('製作者が画像を保存・申請し、運営だけが1回登録できる。管理セッションを作らない', async () => {
  const s = await creator(); expect(s.cookie).not.toContain('shamusho_session');
  const f = new FormData(); f.set('_csrf', s.csrf); f.set('name', 'おはよう'); f.set('description', '朝のあいさつ'); f.set('tags', '😊'); f.set('image', new File([await png()], 'art.png'));
  expect((await app.request('/sticker-desk/drafts', { method: 'POST', headers: { cookie: s.cookie }, body: f })).headers.get('location')).toBe('/sticker-desk?msg=saved');
  const row = (await listStickers(db))[0]!;
  expect((await app.request(`/sticker-desk/drafts/${row.id}/image`, { headers: { cookie: s.cookie } })).headers.get('content-type')).toBe('image/png');
  await post(`/sticker-desk/drafts/${row.id}/submit`, s);
  expect((await getSticker(db, row.id))!.status).toBe('pending');
  const denied = await post(`/stickers/${row.id}/register`, s, { confirm: 'yes' });
  expect(denied.status).not.toBe(200); expect(create).not.toHaveBeenCalled();
  const a = await staff();
  const revision = (await getSticker(db, row.id))!.updatedAt.toISOString();
  expect((await post(`/stickers/${row.id}/register`, a)).headers.get('location')).toBe('/stickers?msg=invalid');
  expect((await post(`/stickers/${row.id}/register`, a, { confirm: 'yes', revision })).headers.get('location')).toBe('/stickers?msg=registered');
  await post(`/stickers/${row.id}/register`, a, { confirm: 'yes', revision }); expect(create).toHaveBeenCalledOnce();
  const html = await (await app.request('/stickers', { headers: { cookie: a.cookie } })).text();
  expect(html).toContain('登録済み'); expect(html).toContain('Web一覧だけ'); expect(html).not.toMatch(/onclick=|style=|<script>/);
});
it('他人の画像・編集を返さず、製作者ロールを失ったセッションを止める', async () => {
  const row = (await saveSticker(db, { id: USER, name: '作家' }, { name: 'おはよう', description: '', tags: '😊' }, await prepareSticker(await png())))!;
  const other = await creator(OTHER);
  expect((await app.request(`/sticker-desk/drafts/${row.id}/image`, { headers: { cookie: other.cookie } })).status).toBe(404);
  expect((await app.request(`/sticker-desk/edit/${row.id}`, { headers: { cookie: other.cookie } })).status).toBe(404);
  expect((await post(`/sticker-desk/drafts/${row.id}`, other)).status).toBe(404);
  roles.set(OTHER, []);
  expect((await app.request('/sticker-desk', { headers: { cookie: other.cookie } })).headers.get('location')).toBe('/sticker-desk/login');
});
it('製作者・運営のCSRF、ページ権限、宮司限定設定を確認する', async () => {
  const c = await creator();
  expect((await app.request('/sticker-desk/drafts', { method: 'POST', headers: { cookie: c.cookie }, body: new URLSearchParams({ name: 'xx' }) })).status).toBe(403);
  const a = await staff();
  expect((await app.request('/stickers/1/register', { method: 'POST', headers: { cookie: a.cookie } })).status).toBe(403);
  const limited = await staff(['home']);
  expect((await app.request('/stickers', { headers: { cookie: limited.cookie } })).status).toBe(403);
  expect((await post('/stickers/1/register', limited, { confirm: 'yes' })).status).toBe(403);
  const ordinary = await staff(undefined, 'shinshoku');
  expect((await post('/stickers/settings', ordinary, { roleId: CREATOR })).status).toBe(403);
  expect(create).not.toHaveBeenCalled();
});
it('ワンタイムリンクを外部Originから使えず、再利用できない', async () => {
  const link = await createLoginLink(db, { id: USER, displayName: '作家', avatarUrl: null }, clock);
  expect((await app.request(`/sticker-desk/link/${link}`, { method: 'POST', headers: { origin: 'https://evil.example' } })).status).toBe(403);
  expect((await app.request(`/sticker-desk/link/${link}`, { method: 'POST' })).headers.get('location')).toBe('/sticker-desk');
  expect((await app.request(`/sticker-desk/link/${link}`, { method: 'POST' })).headers.get('location')).toBe('/sticker-desk/login');
});
it('画像失敗では登録せず入力を残し、申請後の画像差替えを拒否する', async () => {
  const s = await creator(), f = new FormData();
  f.set('_csrf', s.csrf); f.set('name', '入力を残す'); f.set('tags', '😊'); f.set('description', ''); f.set('image', new File([new Uint8Array(300_000)], 'fake.png'));
  const res = await app.request('/sticker-desk/drafts', { method: 'POST', headers: { cookie: s.cookie }, body: f });
  expect(res.status).toBe(400); expect(await res.text()).toContain('入力を残す');
  expect(await listStickers(db)).toHaveLength(0);
  const row = (await saveSticker(db, { id: USER, name: '作家' }, { name: 'おはよう', description: '', tags: '😊' }, await prepareSticker(await png())))!;
  await submitSticker(db, row.id, USER);
  expect((await post(`/sticker-desk/drafts/${row.id}`, s, { name: '差替え', tags: '😊', description: '' })).status).toBe(404);
  expect(create).not.toHaveBeenCalled();
});

it('Discordの製作コマンドは現在の製作者ロールを再確認し、本人にだけリンクを出す', async () => {
  const { StickerDeskApp } = await import('../src/discord/stickerDesk.js');
  const desk = new StickerDeskApp(db, () => cfg, 'https://example.com');
  const make = () => ({ isChatInputCommand: () => true, commandName: 'stickerdesk', inCachedGuild: () => true, guildId: cfg.guildId,
    guild: { roles: { cache: new Map([[CREATOR, { id: CREATOR, name: 'スタンプ製作者' }]]) }, members: { fetch: async () => ({ roles: { cache: new Map((roles.get(USER) ?? []).map(id => [id, {}])) } }) } },
    user: { id: USER }, member: { displayName: '製作者', displayAvatarURL: () => null, roles: { cache: new Map([[CREATOR, {}]]) } }, deferReply: vi.fn(async () => {}), editReply: vi.fn(async () => {}) });
  const yes = make(); await desk.onInteraction(yes as never);
  expect(yes.deferReply).toHaveBeenCalledWith(expect.objectContaining({ flags: 64 }));
  expect(yes.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('/sticker-desk/link/'), allowedMentions: { parse: [] } }));
  roles.set(USER, []);
  const revoked = make(); await desk.onInteraction(revoked as never);
  expect(revoked.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('スタンプ製作者のロールの人だけ') }));
});

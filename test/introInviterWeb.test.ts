import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Db } from '../src/db/client.js';
import { invites, members } from '../src/db/schema.js';
import type { DiscordActions } from '../src/lib/discordRest.js';
import { createWebApp } from '../src/web/app.js';
import type { DiscordApi } from '../src/web/discordApi.js';
import { createSession, findSession } from '../src/web/sessions.js';
import { recordIntro } from '../src/services/intros.js';
import { inviterOf, SHARED_INVITER } from '../src/services/invites.js';
import { walletOf } from '../src/services/economy.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const A = '790000000000000001', B = '790000000000000002', ADMIN = '790000000000000003';
const CHANNEL = '790000000000000011', MESSAGE = '790000000000000021';
const at = new Date('2026-11-02T00:00:00Z');
let db: Db, close: () => Promise<void>, app: ReturnType<typeof createWebApp>, cookie: string, csrf: string;
let fetchIntro: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  await db.insert(members).values([
    { id: A, username: 'new', displayName: '新人', roleIds: [ROLE.sanpaisha] },
    { id: B, username: 'sakura', displayName: 'さくら', roleIds: [ROLE.ujiko] },
  ]);
  await recordIntro(db, { memberId: A, channelId: CHANNEL, messageId: MESSAGE, content: `【招待者】<@${B}> <script>秘密</script>`, postedAt: at });
  fetchIntro = vi.fn().mockResolvedValue({ id: MESSAGE, channel_id: CHANNEL, timestamp: at.toISOString(), content: '【招待者】さくら', author: { id: A } });
  app = createWebApp({ db, cfg: { ...cfg, channels: { ...cfg.channels, ema: CHANNEL } }, api: {} as DiscordApi,
    discord: { introMessage: fetchIntro, sendDm: async () => true } as unknown as DiscordActions, baseUrl: 'https://test.example', now: () => at });
  await login('guji');
});
afterEach(async () => close());
async function login(level: 'guji' | 'shinshoku', pages: ('invites' | 'board')[] | null = null) {
  cookie = await createSession(db, { id: ADMIN, username: 'staff', displayName: '運営', avatarUrl: null }, { level, pages }, at);
  csrf = (await findSession(db, cookie, at))!.csrfToken;
}
const get = () => app.request('/invites', { headers: { cookie: `shamusho_session=${cookie}` } });
const post = (action: string, body: Record<string, string> = {}) => app.request(`/invites/members/${A}/${action}`, { method: 'POST',
  headers: { cookie: `shamusho_session=${cookie}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrf, ...body }) });

it('候補・元の記入・リンクを表示するが、選択済みにはせず招待元も報酬も変えない', async () => {
  const html = await (await get()).text();
  expect(html).toContain('絵馬からの候補（未確定）');
  expect(html).toContain(`https://discord.com/channels/${cfg.guildId}/${CHANNEL}/${MESSAGE}`);
  expect(html).toContain('&lt;script&gt;秘密&lt;/script&gt;');
  expect(html).not.toContain('<script>秘密');
  expect(html).toMatch(new RegExp(`<option value="${B}">さくら`));
  expect(html).not.toMatch(new RegExp(`<option[^>]*value="${B}"[^>]*selected`));
  expect(fetchIntro).not.toHaveBeenCalled();
  expect(await inviterOf(db, A)).toBeUndefined();
  expect((await walletOf(db, B)).balance).toBe(0);
});

it('読み直しは宮司・CSRF必須。通常の運営に記入内容を追加公開しない', async () => {
  expect((await post('refresh-intro', { _csrf: '不正' })).status).toBe(403);
  await login('shinshoku');
  const html = await (await get()).text();
  expect(html).not.toContain('絵馬からの候補');
  expect(html).not.toContain('秘密');
  expect((await post('refresh-intro')).status).toBe(403);
  await login('shinshoku', ['board']);
  expect((await get()).status).toBe(403);
  expect((await post('refresh-intro')).status).toBe(403);
  expect(fetchIntro).not.toHaveBeenCalled();
});

it('読み直しても未登録のまま。候補を選んで既存の確認をしたときだけ登録・支払う', async () => {
  expect((await post('refresh-intro')).headers.get('location')).toContain('intro_refreshed');
  expect(fetchIntro).toHaveBeenCalledWith(CHANNEL, MESSAGE);
  expect(await inviterOf(db, A)).toBeUndefined();
  expect((await post('assign', { inviterId: B })).headers.get('location')).toContain('assign_confirm');
  expect(await inviterOf(db, A)).toBeUndefined();
  expect((await post('assign', { inviterId: B, confirm: 'yes' })).headers.get('location')).toContain('assign_assigned');
  expect(await inviterOf(db, A)).toBe(B);
  const paid = (await walletOf(db, B)).balance;
  expect(paid).toBe(cfg.economy.inviteSanpaishaReward);
  expect((await post('assign', { inviterId: B, confirm: 'yes' })).headers.get('location')).toContain('assign_known');
  expect((await walletOf(db, B)).balance).toBe(paid);
});

it.each([{ inviterId: B, source: 'link' }, { inviterId: SHARED_INVITER, source: 'shared:SNS' }])('登録済みの招待元や共通リンクは候補で上書きしない: $source', async ({ inviterId, source }) => {
  await db.insert(invites).values({ memberId: A, inviterId, source });
  expect(await (await get()).text()).not.toContain(`/invites/members/${A}/refresh-intro`);
  expect((await db.select().from(invites))[0]).toMatchObject({ inviterId, source });
});

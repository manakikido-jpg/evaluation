import { afterEach, beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { members, voiceChannels, voiceUsage } from '../src/db/schema.js';
import { createWebApp } from '../src/web/app.js';
import { createSession } from '../src/web/sessions.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const now = new Date('2026-11-18T03:00:00Z');
const ID = '880000000000000001', U = '880000000000000002', ENG = '980000000000000001';
const user = { id: ID, username: 'staff', displayName: '運営', avatarUrl: null };
let db: Db, close: () => Promise<void>, app: ReturnType<typeof createWebApp>, token: string;
const headers = (t = token) => ({ cookie: 'shamusho_session=' + t });
beforeEach(async () => {
  ({ db, close } = await makeDb());
  await db.insert(members).values([
    { id: ID, username: 'staff', displayName: '運営', roleIds: [ROLE.guji] },
    { id: U, username: 'u', displayName: '氏子ユー', roleIds: [ROLE.ujiko] },
  ]);
  await db.insert(voiceChannels).values({ channelId: ENG, name: '🌸 縁側１' });
  await db.insert(voiceUsage).values({ memberId: U, date: '2026-11-12', channelId: ENG, minutes: 200, rankRecordedMinutes: 200, sanpaishaMinutes: 0, evaluationRecordedMinutes: 0, evaluationEligibleMinutes: 0 });
  app = createWebApp({ db, cfg: () => cfg, api: { memberRoles: async () => [ROLE.guji] } as never, discord: { guildChannels: async () => [] } as never, baseUrl: 'https://example.test', now: () => now });
  token = await createSession(db, user, { level: 'guji', pages: null }, now);
});
afterEach(async () => close());

it('新制度の検証ページは推移の権限を要求し、絞り込みを反映して読むだけで出す', async () => {
  const limited = await createSession(db, user, { level: 'shinshoku', pages: ['members'] }, now);
  const allowed = await createSession(db, user, { level: 'shinshoku', pages: ['stats'] }, now);
  expect((await app.request('/stats/new-system')).status).toBe(302); // 未ログイン
  expect((await app.request('/stats/new-system', { headers: headers(limited) })).status).toBe(403);
  const res = await app.request('/stats/new-system', { headers: headers(allowed) });
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('新制度の検証');
  expect(html).toContain('絵馬の必要数');
  expect(html).toContain('氏子ユー'); // 縁側ランキングに名前が出る
  expect(html).not.toMatch(/onclick=|style=/); // CSP: インライン属性なし
  // 絞り込み（分しきい値・時間帯）がフォームに反映される
  const filtered = await (await app.request('/stats/new-system?days=7&min=60&hourFrom=22&hourTo=24', { headers: headers() })).text();
  expect(filtered).toContain('value="60"');
  expect(filtered).toContain('7 日');
});

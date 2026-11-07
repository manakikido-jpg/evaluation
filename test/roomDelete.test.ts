import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { auditLogs, members, roomPayers, tempVoice } from '../src/db/schema.js';
import { roomPanel } from '../src/discord/rooms.js';
import { DiscordHttpError } from '../src/lib/discordRest.js';
import { removeInvites, roomOverwrites } from '../src/services/rooms.js';
import { closeRoomNow } from '../src/services/tempVoice.js';
import { createWebApp } from '../src/web/app.js';
import { createSession, findSession } from '../src/web/sessions.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const now = new Date('2026-11-07T03:00:00Z');
const STAFF = '830000000000000101', OWNER = '830000000000000102', F1 = '830000000000000103', F2 = '830000000000000104';
const ROOM = '930000000000000101', HUB = '930000000000000100';
let db: Db, close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  await db.insert(members).values([{ id: STAFF, username: 'staff', displayName: '運営', roleIds: [ROLE.guji] }, { id: OWNER, username: 'owner', displayName: 'へやぬし', roleIds: [ROLE.sanpaisha] }]);
  await db.insert(tempVoice).values({ channelId: ROOM, ownerId: OWNER, hubId: HUB, kind: 'invite', invited: [F1, F2], keepUntil: new Date(now.getTime() + 3600_000), createdAt: now });
  await db.insert(roomPayers).values({ channelId: ROOM, memberId: F1, paidUntil: new Date(now.getTime() + 3600_000) });
});
afterEach(async () => close());

describe('🗑 宿の削除', () => {
  it('チャンネルを消してから、記録と払った人の記録を消す。2 回目は not_found', async () => {
    const removed: string[] = [];
    expect(await closeRoomNow(db, ROOM, async (id) => void removed.push(id), OWNER, 'discord')).toBe('ok');
    expect(removed).toEqual([ROOM]);
    expect(await db.select().from(tempVoice)).toEqual([]);
    expect(await db.select().from(roomPayers)).toEqual([]);
    expect((await db.select().from(auditLogs)).some((a) => a.action === 'room.delete' && a.actorId === OWNER)).toBe(true);
    expect(await closeRoomNow(db, ROOM, async () => undefined, OWNER, 'discord')).toBe('not_found');
  });
  it('チャンネルを消せなければ、記録は残す。もう消えていた（404）なら記録も消す', async () => {
    await expect(closeRoomNow(db, ROOM, async () => { throw new DiscordHttpError('Missing Permissions', 403); }, OWNER, 'discord')).rejects.toThrow();
    expect(await db.select().from(tempVoice)).toHaveLength(1);
    expect(await closeRoomNow(db, ROOM, async () => { throw new DiscordHttpError('Unknown Channel', 404); }, OWNER, 'discord')).toBe('ok');
    expect(await db.select().from(tempVoice)).toEqual([]);
  });
  it('設定パネルに「宿を削除する」、入室許可者がいるときだけ「入室許可者を外す」が出る', () => {
    const withInvites = JSON.stringify(roomPanel(cfg, { ownerId: OWNER, hubId: HUB, kind: 'invite', kindLocked: true, invited: [F1] }, { name: 'x', userLimit: 0 }));
    expect(withInvites).toContain('room:delete'); expect(withInvites).toContain('room:uninvite');
    const none = JSON.stringify(roomPanel(cfg, { ownerId: OWNER, hubId: HUB, kind: 'invite', kindLocked: true, invited: [] }, { name: 'x', userLimit: 0 }));
    expect(none).toContain('room:delete'); expect(none).not.toContain('room:uninvite');
  });
});

describe('➖ 入室許可者を外す', () => {
  it('外した人だけ消え、部屋の権限からも外れる', async () => {
    const row = await removeInvites(db, ROOM, [F1]);
    expect(row!.invited).toEqual([F2]);
    const list = roomOverwrites([], 'invite', { ownerId: OWNER, botId: '1', invited: row!.invited, ownerAllow: 0n });
    expect(list.some((o) => o.id === F1)).toBe(false);
    expect(list.some((o) => o.id === F2)).toBe(true);
  });
});

describe('🏨 社務所Web の宿の一覧', () => {
  it('一覧が出て、確かめてから削除できる。CSRF・ページ権限を守る', async () => {
    const deleted: string[] = [];
    const app = createWebApp({ db, cfg: () => cfg, api: { memberRoles: async () => [ROLE.guji] } as never,
      discord: { guildChannels: async () => [{ id: ROOM, name: '🏨 へやぬしの宿', type: 2, parent_id: null, position: 0 }], deleteChannel: async (id: string) => void deleted.push(id) } as never,
      baseUrl: 'https://example.test', now: () => now });
    const user = { id: STAFF, username: 'staff', displayName: '運営', avatarUrl: null };
    const token = await createSession(db, user, { level: 'guji', pages: null }, now);
    const limited = await createSession(db, user, { level: 'shinshoku', pages: ['members'] }, now);
    const h = (t: string) => ({ cookie: 'shamusho_session=' + t });
    expect((await app.request('/voice/rooms', { headers: h(limited) })).status).toBe(403);
    const html = await (await app.request('/voice/rooms', { headers: h(token) })).text();
    expect(html).toContain('🏨 へやぬしの宿'); expect(html).toContain('へやぬし'); expect(html).toContain('2人');
    expect(html).not.toMatch(/onclick=|style=/);
    const csrf = (await findSession(db, token, now))!.csrfToken;
    const post = (body: Record<string, string>) => app.request(`/voice/rooms/${ROOM}/delete`, { method: 'POST', headers: { ...h(token), 'content-type': 'application/x-www-form-urlencoded', origin: 'https://example.test' }, body: new URLSearchParams(body).toString() });
    expect((await post({ _csrf: '' , confirm: 'yes' })).status).toBe(403);
    const noConfirm = await post({ _csrf: csrf });
    expect(noConfirm.headers.get('location')).toContain('msg=confirm');
    expect(await db.select().from(tempVoice)).toHaveLength(1);
    const ok = await post({ _csrf: csrf, confirm: 'yes' });
    expect(ok.headers.get('location')).toContain('msg=deleted');
    expect(deleted).toEqual([ROOM]);
    expect(await db.select().from(tempVoice).where(eq(tempVoice.channelId, ROOM))).toEqual([]);
  });
});

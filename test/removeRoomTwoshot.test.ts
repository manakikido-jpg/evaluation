import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { economyEvents, gachaPrizes, presenceGifts, roomPasses, settings, tempVoice, tickets } from '../src/db/schema.js';
import { TICKET_KINDS, parseGuildConfig, streakRewardSchema } from '../src/config.js';
import { isRoomKind, ROOM_KINDS, roomOverwrites } from '../src/services/rooms.js';
import { overridesSchema } from '../src/services/settings.js';
import { TICKET_GROUPS, TICKET_LABEL, ticketsOf } from '../src/services/tickets.js';
import { roomPanel } from '../src/discord/rooms.js';
import { cfg, makeDb } from './helpers.js';
let db: Db, close: () => Promise<void>;
beforeEach(async () => { ({ db, close } = await makeDb()); });
afterEach(async () => { await close(); });
const MEMBER = '870000000000000001', ROOM = '870000000000000002', HUB = '870000000000000003';
const migration = readFileSync(new URL('../drizzle/0142_remove_room_twoshot.sql', import.meta.url), 'utf8');
async function applyMigration() {
  for (const statement of migration.split('--> statement-breakpoint')) await db.execute(sql.raw(statement));
}
describe('宿のツーショット廃止', () => {
  it('新規種類・券・設定パネルから完全に外し、人数制限は通常の操作で変更できる', () => {
    expect(Object.keys(ROOM_KINDS)).toEqual(['public', 'invite', 'secret']);
    expect(isRoomKind('twoshot')).toBe(false);
    expect(TICKET_KINDS.some(k => (k as string).includes('twoshot'))).toBe(false);
    expect(JSON.stringify(TICKET_GROUPS)).not.toContain('twoshot');
    expect(JSON.stringify(TICKET_LABEL)).not.toContain('ツーショット');
    const configured = { ...cfg, tempVoice: { ...cfg.tempVoice, hubs: [{ channelId: HUB, name: '宿坊', plan: 'once' as const }] } };
    const panel = roomPanel(configured, { ownerId: MEMBER, hubId: HUB, kind: 'invite', invited: [], kindLocked: false }, { name: '宿', userLimit: 2 });
    expect(JSON.stringify(panel)).not.toMatch(/twoshot|ツーショット/);
    const limit = panel.components.flatMap(r => r.components).find(c => 'custom_id' in c && c.custom_id === 'room:limit');
    expect(limit).toBeDefined(); expect(limit?.disabled).not.toBe(true);
  });
  it('旧設定ファイルの券IDを読み込み時だけ変換し、残りの設定や原本は変えない', () => {
    const input = { ...cfg, rooms: { ...cfg.rooms, once: { ...cfg.rooms.once, twoshot: 999 } }, gacha: { ...cfg.gacha, prizes: { ...cfg.gacha.prizes, kichi: { ...cfg.gacha.prizes.kichi, ticket: 'room_half_twoshot' } } } };
    const parsed = parseGuildConfig(input);
    expect(parsed.gacha.prizes.kichi.ticket).toBe('room_half_invite');
    expect(parsed.rooms.once).not.toHaveProperty('twoshot');
    expect(input.rooms.once.twoshot).toBe(999);
    expect(input.gacha.prizes.kichi.ticket).toBe('room_half_twoshot');
    expect(streakRewardSchema.parse({ days: 2, ticket: 'room_free_twoshot' }).ticket).toBe('room_free_invite');
    expect(overridesSchema.parse({ gacha: input.gacha }).gacha?.prizes.kichi.ticket).toBe('room_half_invite');
  });
  it('既存部屋は招待制へ。許可者・支払い額・期限・ロックを残し、公開にはしない', async () => {
    const until = new Date('2026-10-30T00:00:00Z');
    await db.insert(tempVoice).values({ channelId: ROOM, ownerId: MEMBER, hubId: HUB, kind: 'twoshot' as never, invited: ['friend'], paid: 73, paidUntil: until, keepUntil: until, kindLocked: true });
    await applyMigration();
    const [room] = await db.select().from(tempVoice).where(eq(tempVoice.channelId, ROOM));
    expect(room).toMatchObject({ kind: 'invite', invited: ['friend'], paid: 73, paidUntil: until, keepUntil: until, kindLocked: true });
    const permissions = roomOverwrites([{ id: 'everyone', type: 0, allow: 0n, deny: 0n }], 'invite', { ownerId: MEMBER, botId: 'bot', invited: ['friend'], ownerAllow: 0n });
    expect(permissions.find(p => p.id === 'everyone')!.deny & (1n << 20n)).not.toBe(0n);
  });
  it('券は同じ効力の招待制券に合算し、一日券は長い有効期限を残す。再実行でも増やさない', async () => {
    await db.insert(tickets).values([
      { memberId: MEMBER, kind: 'room_free_twoshot' as never, count: 2 },
      { memberId: MEMBER, kind: 'room_free_invite', count: 3 },
      { memberId: MEMBER, kind: 'room_half_twoshot' as never, count: 4 },
      { memberId: MEMBER, kind: 'room_day_twoshot' as never, count: 1 },
    ]);
    const early = new Date('2026-10-28'), late = new Date('2026-10-29');
    await db.insert(roomPasses).values([{ memberId: MEMBER, kind: 'invite', until: early }, { memberId: MEMBER, kind: 'twoshot' as never, until: late }]);
    await applyMigration(); await applyMigration();
    const owned = await ticketsOf(db, MEMBER);
    expect(owned.room_free_invite).toBe(5); expect(owned.room_half_invite).toBe(4); expect(owned.room_day_invite).toBe(1);
    expect((await db.select().from(tickets)).some(t => (t.kind as string).includes('twoshot'))).toBe(false);
    expect(await db.select().from(roomPasses)).toEqual([{ memberId: MEMBER, kind: 'invite', until: late }]);
  });
  it('景品・配布予定・設定の旧券だけ変換し、キャストの種別や自由文は残す', async () => {
    await db.insert(gachaPrizes).values({ tier: 'kichi', kind: 'ticket', ticket: 'room_day_twoshot' as never, amount: 2 });
    await db.insert(economyEvents).values({ kind: 'voice_ticket', value: 10, ticket: 'room_free_twoshot', ticketCount: 2, title: 'test', startsAt: new Date('2026-10-01'), endsAt: new Date('2026-10-31'), createdBy: MEMBER });
    await db.insert(presenceGifts).values({ kind: 'ticket', ticketKind: 'room_half_twoshot', amount: 2, note: 'test', createdBy: MEMBER });
    await db.insert(settings).values({ key: 'overrides', updatedBy: MEMBER, value: { rooms: { once: { public: 50, invite: 200, secret: 300, twoshot: 400 } }, gacha: { ticket: 'room_day_twoshot' }, cast: { kind: 'twoshot', name: 'ツーショット' }, nested: ['room_free_twoshot', null, {}, []] } }).onConflictDoUpdate({ target: settings.key, set: { value: sql`excluded.value`, updatedBy: MEMBER } });
    await applyMigration();
    expect((await db.select().from(gachaPrizes))[0]).toMatchObject({ ticket: 'room_day_invite', amount: 2 });
    expect((await db.select().from(economyEvents))[0]).toMatchObject({ ticket: 'room_free_invite', ticketCount: 2 });
    expect((await db.select().from(presenceGifts))[0]).toMatchObject({ ticketKind: 'room_half_invite', amount: 2 });
    const [row] = await db.select().from(settings).where(eq(settings.key, 'overrides'));
    expect(row!.value).toEqual({ rooms: { once: { public: 50, invite: 200, secret: 300 } }, gacha: { ticket: 'room_day_invite' }, cast: { kind: 'twoshot', name: 'ツーショット' }, nested: ['room_free_invite', null, {}, []] });
  });
});

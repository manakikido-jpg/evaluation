import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/db/client.js';
import { InnGuestApp, INN_GUEST_IDLE_MS, innGuests, isInnChannel } from '../src/discord/innGuest.js';
import { vcPanel } from '../src/discord/views.js';
import { cfg, makeDb } from './helpers.js';

const VC = '960000000000000001', STAFF = '960000000000000011', GUEST = '960000000000000012';
let db: Db, close: () => Promise<void>;
beforeEach(async () => ({ db, close } = await makeDb()));
afterEach(async () => close());

function world() {
  const overwrites = new Map<string, unknown>();
  const states = new Map<string, { channelId: string | null; disconnect: ReturnType<typeof vi.fn> }>();
  const vc = {
    id: VC, name: '院の間', parent: { name: '🏯 院' }, isVoiceBased: () => true, isSendable: () => true, send: vi.fn(async () => undefined),
    permissionsFor: (u: unknown) => { const id = typeof u === 'string' ? u : (u as { id: string }).id; return { has: () => id === STAFF || overwrites.has(id) }; },
    permissionOverwrites: { edit: vi.fn(async (id: string, p: unknown) => void overwrites.set(id, p)), delete: vi.fn(async (id: string) => void overwrites.delete(id)) },
  };
  const guild = { id: cfg.guildId, channels: { cache: new Map([[VC, vc]]) }, members: { cache: new Map() }, voiceStates: { cache: states } };
  return { vc, guild, overwrites, states };
}
const base = (w: ReturnType<typeof world>, user: string, customId: string, extra: Record<string, unknown> = {}) => ({
  inCachedGuild: () => true, guildId: cfg.guildId, guild: w.guild, user: { id: user }, member: { id: user, displayName: 'さくら' }, customId,
  isRepliable: () => true, isButton: () => false, isUserSelectMenu: () => false, isStringSelectMenu: () => false,
  reply: vi.fn(async () => undefined), deferUpdate: vi.fn(async () => undefined), editReply: vi.fn(async () => undefined), ...extra,
});

describe('🏯 院に人を呼ぶ', () => {
  it('院の通話だけにボタンを出す（奥の院はのぞく）', () => {
    expect(isInnChannel({ name: '院の間', parent: { name: '🏯 院' } })).toBe(true);
    expect(isInnChannel({ name: '奥の院', parent: { name: '院' } })).toBe(false);
    expect(isInnChannel({ name: '雑談', parent: { name: '境内' } })).toBe(false);
    expect(JSON.stringify(vcPanel(VC, false, true))).toContain(`inn:invite:${VC}`);
    expect(JSON.stringify(vcPanel(VC))).not.toContain('inn:');
  });

  it('役職だけが呼べる。呼ぶと話す・文と画像の権限を付け、抜けたら元に戻す', async () => {
    const w = world();
    const app = new InnGuestApp(db, () => cfg);
    const denied = base(w, GUEST, `inn:invite:${VC}`, { isButton: () => true });
    await app.onInteraction(denied as never);
    expect(String((denied.reply.mock.calls[0] as unknown[])[0] && JSON.stringify(denied.reply.mock.calls[0]))).toContain('役職');
    const pick = base(w, STAFF, `inn:pick:${VC}`, { isUserSelectMenu: () => true, users: new Map([[GUEST, { id: GUEST, bot: false }]]) });
    await app.onInteraction(pick as never);
    const perms = w.overwrites.get(GUEST) as Record<string, boolean>;
    expect(perms).toMatchObject({ ViewChannel: true, Connect: true, Speak: true, SendMessages: true, AttachFiles: true });
    expect((await innGuests(db)).map((g) => g.memberId)).toEqual([GUEST]);
    // 呼ばれた人は、ほかの人を呼べない
    const again = base(w, GUEST, `inn:invite:${VC}`, { isButton: () => true });
    await app.onInteraction(again as never);
    expect(JSON.stringify(again.reply.mock.calls[0])).toContain('役職');
    const g = { id: GUEST, guild: w.guild };
    await app.onVoiceStateUpdate({ channelId: null } as never, { ...g, channelId: VC } as never);
    expect((await innGuests(db))[0]?.joined).toBe(true);
    await app.onVoiceStateUpdate({ channelId: VC } as never, { ...g, channelId: null } as never);
    expect(w.overwrites.has(GUEST)).toBe(false);
    expect(await innGuests(db)).toEqual([]);
  });

  it('呼ばれたのに入らないまま 30 分たったら元に戻す', async () => {
    const w = world();
    let now = new Date('2026-10-25T00:00:00Z');
    const app = new InnGuestApp(db, () => cfg, () => now);
    await app.onInteraction(base(w, STAFF, `inn:pick:${VC}`, { isUserSelectMenu: () => true, users: new Map([[GUEST, { id: GUEST, bot: false }]]) }) as never);
    await app.tick(w.guild as never);
    expect(w.overwrites.has(GUEST)).toBe(true);
    now = new Date(now.getTime() + INN_GUEST_IDLE_MS);
    await app.tick(w.guild as never);
    expect(w.overwrites.has(GUEST)).toBe(false);
  });
});

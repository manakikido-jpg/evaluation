import { Collection } from 'discord.js';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/db/client.js';
import { coinTx, members, tempVoice } from '../src/db/schema.js';
import { RoomApp, roomNotice, roomPanel } from '../src/discord/rooms.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { roomOf } from '../src/services/rooms.js';
import { extendStayRoom, onVoiceLeave, STAY_MS, type VoiceOps } from '../src/services/tempVoice.js';
import { cfg as base, makeDb, ROLE } from './helpers.js';

const HUB = '960000000000000001', ROOM = '960000000000000002', OWNER = '960000000000000003', BOT = '960000000000000004';
const NOW = new Date('2099-01-01T00:00:00Z'), DUE = new Date(NOW.getTime() + STAY_MS);
const cfg = { ...base, rooms: { ...base.rooms, stayPrice: 3000 }, tempVoice: { hubs: [{ channelId: HUB, name: '宿坊', plan: 'once' as const }] } };
let db: Db, close: () => Promise<void>;
beforeEach(async () => { ({ db, close } = await makeDb()); });
afterEach(async () => { await close(); });
async function seed(overrides: Partial<typeof tempVoice.$inferInsert> = {}, balance = 9000) {
  await db.insert(tempVoice).values({ channelId: ROOM, ownerId: OWNER, hubId: HUB, createdAt: new Date(NOW.getTime() - STAY_MS), keepUntil: DUE, kind: 'secret', invited: ['friend'], ...overrides });
  await addCoins(db, OWNER, balance, 'adjust');
}
const input = () => ({ channelId: ROOM, userId: OWNER, expectedUntil: DUE.getTime(), expectedPrice: 3000 });
const extend = () => extendStayRoom(db, cfg, input(), NOW);
const ops = (): VoiceOps => ({ create: vi.fn(), move: vi.fn(), remove: vi.fn(async () => {}), occupancy: vi.fn(() => 0) });

function discord() {
  const notice: any = { id: 'notice', author: { id: BOT }, components: [{ components: [{ customId: 'room:open' }] }], embeds: roomNotice(cfg, { ownerId: OWNER, hubId: HUB, keepUntil: DUE }).embeds };
  notice.edit = vi.fn(async (body: any) => { notice.embeds = body.embeds; return notice; });
  const channel = { id: ROOM, name: '宿', userLimit: 5, parent: null, isVoiceBased: () => true, isTextBased: () => true,
    messages: { fetch: vi.fn(async (arg: any) => arg.message ? notice : new Collection([['notice', notice]])) }, send: vi.fn() };
  const guild = { client: { user: { id: BOT } }, channels: { cache: new Map([[ROOM, channel]]) } };
  const app = new RoomApp(db, () => cfg, vi.fn());
  function interaction(customId: string, userId = OWNER, staff = false): any {
    const i: any = { customId, guildId: cfg.guildId, channelId: ROOM, user: { id: userId }, member: { roles: { cache: new Map(staff ? [[ROLE.guji, {}]] : []) } },
      inCachedGuild: () => true, isAutocomplete: () => false, isChatInputCommand: () => false, isButton: () => true,
      isStringSelectMenu: () => false, isUserSelectMenu: () => false, isModalSubmit: () => false, isMessageComponent: () => true,
      reply: vi.fn(), update: vi.fn(), editReply: vi.fn(), followUp: vi.fn(), deferred: false, replied: false };
    i.deferUpdate = vi.fn(async () => { i.deferred = true; });
    return i;
  }
  return { app, guild, channel, notice, interaction };
}

describe('24時間宿の1日延長', () => {
  it('残り時間を保ち、部屋主の財布だけから1日分を払い、権限や招待者は残す', async () => {
    await seed({ payerId: 'previous-owner' });
    const before = await roomOf(db, ROOM);
    const result = await extend();
    expect(result).toEqual({ status: 'ok', charged: 3000, keepUntil: new Date(DUE.getTime() + STAY_MS) });
    expect(await roomOf(db, ROOM)).toEqual({ ...before, keepUntil: new Date(DUE.getTime() + STAY_MS) });
    expect((await walletOf(db, OWNER)).balance).toBe(6000);
    const payments = await db.select().from(coinTx).where(eq(coinTx.reason, 'room'));
    expect(payments).toHaveLength(1);
    expect(payments[0]?.detail).toMatchObject({ extension: true, hours: 24, previousUntil: DUE.toISOString() });
    // 新しい期限で確認し直せば、さらにもう1日延長できる。
    expect(await extendStayRoom(db, cfg, { ...input(), expectedUntil: DUE.getTime() + STAY_MS }, NOW)).toMatchObject({ status: 'ok' });
    expect((await walletOf(db, OWNER)).balance).toBe(3000);
  });

  it('同じ確認の同時送信と再送では1回しか払わない', async () => {
    await seed();
    const results = await Promise.all([extend(), extend()]);
    expect(results.map(r => r.status).sort()).toEqual(['changed', 'ok']);
    expect(await extend()).toEqual({ status: 'changed' });
    expect((await walletOf(db, OWNER)).balance).toBe(6000);
    expect((await roomOf(db, ROOM))?.keepUntil).toEqual(new Date(DUE.getTime() + STAY_MS));
  });

  it('残高不足なら支払いも期限更新もしない', async () => {
    await seed({}, 1000);
    expect(await extend()).toEqual({ status: 'insufficient', price: 3000 });
    expect((await walletOf(db, OWNER)).balance).toBe(1000);
    expect((await roomOf(db, ROOM))?.keepUntil).toEqual(DUE);
  });

  it('期限更新が失敗したら支払いと出入り記録も戻す', async () => {
    await seed();
    await db.execute(sql`CREATE FUNCTION fail_stay_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test update failure'; END; $$`);
    await db.execute(sql`CREATE TRIGGER fail_stay BEFORE UPDATE ON temp_voice FOR EACH ROW EXECUTE FUNCTION fail_stay_update()`);
    await expect(extend()).rejects.toMatchObject({ cause: { message: 'test update failure' } });
    expect((await walletOf(db, OWNER)).balance).toBe(9000);
    expect((await roomOf(db, ROOM))?.keepUntil).toEqual(DUE);
    expect(await db.select().from(coinTx).where(eq(coinTx.reason, 'room'))).toHaveLength(0);
  });

  it('奉納者は無料。確認後に奉納や料金が変わったら改めて確認する', async () => {
    await seed();
    await db.insert(members).values({ id: OWNER, username: 'owner', displayName: '宿主', boostingSince: NOW });
    expect(await extend()).toEqual({ status: 'changed' });
    expect(await extendStayRoom(db, cfg, { ...input(), expectedPrice: 0 }, NOW)).toMatchObject({ status: 'ok', charged: 0 });
    expect((await walletOf(db, OWNER)).balance).toBe(9000);
    await db.update(members).set({ boostingSince: null }).where(eq(members.id, OWNER));
    const nextInput = { ...input(), expectedUntil: DUE.getTime() + STAY_MS, expectedPrice: 0 };
    expect(await extendStayRoom(db, cfg, nextInput, NOW)).toEqual({ status: 'changed' });
    expect(await extendStayRoom(db, { ...cfg, rooms: { ...cfg.rooms, stayPrice: 4000 } }, { ...nextInput, expectedPrice: 3000 }, NOW)).toEqual({ status: 'changed' });
  });

  it('ほかの部屋主・1時間宿・普通の部屋・消えた部屋を延長しない', async () => {
    await seed();
    expect(await extendStayRoom(db, cfg, { ...input(), userId: 'other' }, NOW)).toEqual({ status: 'not_owner' });
    await db.update(tempVoice).set({ ownerId: 'new-owner' }).where(eq(tempVoice.channelId, ROOM));
    expect(await extend()).toEqual({ status: 'not_owner' });
    await db.update(tempVoice).set({ ownerId: OWNER, renewHourly: true }).where(eq(tempVoice.channelId, ROOM));
    expect(await extend()).toEqual({ status: 'not_daily' });
    await db.update(tempVoice).set({ renewHourly: false, keepUntil: null }).where(eq(tempVoice.channelId, ROOM));
    expect(await extend()).toEqual({ status: 'not_daily' });
    await db.delete(tempVoice).where(eq(tempVoice.channelId, ROOM));
    expect(await extend()).toEqual({ status: 'not_found' });
    expect((await walletOf(db, OWNER)).balance).toBe(9000);
  });

  it('期限切れでも残っている宿は確定時から1日。延長済みなら空室でも消さない', async () => {
    await seed();
    const now = new Date(DUE.getTime() + 60000);
    const v = ops();
    const results = await Promise.all([
      extendStayRoom(db, cfg, input(), now),
      onVoiceLeave({ db, cfg, ops: v }, ROOM, now),
    ]);
    expect(results).toEqual([{ status: 'ok', charged: 3000, keepUntil: new Date(now.getTime() + STAY_MS) }, false]);
    expect(v.remove).not.toHaveBeenCalled();
  });

  it('空室の削除が先に始まったときは、消した宿の延長代を取らない', async () => {
    await seed();
    const now = new Date(DUE.getTime() + 60000), v = ops();
    let removed!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { removed = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    v.remove = vi.fn(async () => { removed(); await gate; });
    const deletion = onVoiceLeave({ db, cfg, ops: v }, ROOM, now);
    await started;
    const extension = extendStayRoom(db, cfg, input(), now);
    release();
    expect(await deletion).toBe(true);
    expect(await extension).toEqual({ status: 'not_found' });
    expect((await walletOf(db, OWNER)).balance).toBe(9000);
  });

  it('Discordで料金を確認して確定。古いボタンの再送は課金せず、元の案内の期限も更新する', async () => {
    await seed();
    const f = discord(); await f.app.attach(f.guild as never);
    const ask = f.interaction('room:extend'); await f.app.onInteraction(ask);
    expect(ask.deferUpdate).toHaveBeenCalledOnce();
    const preview = ask.editReply.mock.calls[0][0];
    expect(preview.embeds[0].description).toContain('3,000');
    expect((await walletOf(db, OWNER)).balance).toBe(9000);
    const confirmId = preview.components[0].components[0].custom_id;
    const confirm = f.interaction(confirmId); await f.app.onInteraction(confirm);
    expect(JSON.stringify(confirm.editReply.mock.calls)).toContain('1日延長しました');
    expect(f.notice.edit).toHaveBeenCalledOnce();
    expect(f.notice.embeds[0].description).toContain('1/3');
    const replay = f.interaction(confirmId); await f.app.onInteraction(replay);
    expect(replay.editReply.mock.calls[0][0].content).toContain('すでに延長');
    expect((await walletOf(db, OWNER)).balance).toBe(6000);
  });

  it('やめると課金しない。別の場所から開いた設定にも部屋IDを引き継ぐ', async () => {
    await seed(); const f = discord(); await f.app.attach(f.guild as never);
    const ask = f.interaction(`room:extend|${ROOM}`); ask.channelId = 'elsewhere';
    await f.app.onInteraction(ask);
    const preview = ask.editReply.mock.calls[0][0];
    expect(preview.components[0].components.every((b: any) => b.custom_id.endsWith(`|${ROOM}`))).toBe(true);
    expect(preview.components[0].components[0].custom_id.length).toBeLessThanOrEqual(100);
    const cancel = f.interaction(preview.components[0].components[1].custom_id); cancel.channelId = 'elsewhere';
    await f.app.onInteraction(cancel);
    expect(cancel.update).toHaveBeenCalledOnce();
    expect((await walletOf(db, OWNER)).balance).toBe(9000);
  });

  it('ボタンは24時間宿の部屋主だけ。運営の代理支払いも拒否する', async () => {
    await seed(); const row = (await roomOf(db, ROOM))!;
    const ch = { name: '宿', userLimit: 0 };
    expect(JSON.stringify(roomPanel(cfg, row, ch))).toContain('room:extend');
    expect(JSON.stringify(roomPanel(cfg, row, ch, undefined, { staff: true }))).not.toContain('room:extend');
    expect(JSON.stringify(roomPanel(cfg, { ...row, renewHourly: true }, ch))).not.toContain('room:extend');
    expect(JSON.stringify(roomPanel(cfg, { ...row, keepUntil: null }, ch))).not.toContain('room:extend');
    const f = discord(); await f.app.attach(f.guild as never);
    for (const staff of [false, true]) {
      const i = f.interaction(`room:extendok:${DUE.getTime()}:3000`, 'other', staff);
      await f.app.onInteraction(i); expect(i.reply).toHaveBeenCalledOnce(); expect(i.deferUpdate).not.toHaveBeenCalled();
    }
    expect((await walletOf(db, OWNER)).balance).toBe(9000);
  });
});

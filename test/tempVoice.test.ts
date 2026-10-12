import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuildConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { tempVoice } from '../src/db/schema.js';
import { claimSecretRoom, cleanupRooms, createSecretRoom, onVoiceJoin, onVoiceLeave, roomName, type VoiceOps } from '../src/services/tempVoice.js';
import { cfg as baseCfg, makeDb } from './helpers.js';

const HUB = '920000000000000001';
const cfg: GuildConfig = { ...baseCfg, tempVoice: { hubs: [{ channelId: HUB, name: '🍵 {name}の縁側' }] } };

/** 偽の Discord: 通話ごとにいる人 */
function fakeVoice() {
  let seq = 0;
  const rooms = new Map<string, { name: string; members: Set<string> }>();
  rooms.set(HUB, { name: '➕ 縁側をひらく', members: new Set() });
  const log: string[] = [];
  const where = (u: string) => [...rooms].find(([, r]) => r.members.has(u))?.[0];
  const ops: VoiceOps = {
    create: async ({ name, ownerId }) => {
      const id = `room${++seq}`;
      rooms.set(id, { name, members: new Set() });
      log.push(`create ${name} ${ownerId}`);
      return id;
    },
    move: async (u, c) => {
      const from = where(u);
      if (!from) throw new Error('not in voice');
      rooms.get(from)!.members.delete(u);
      rooms.get(c)!.members.add(u);
    },
    remove: async (c) => {
      rooms.delete(c);
      log.push(`remove ${c}`);
    },
    occupancy: (c) => rooms.get(c)?.members.size,
  };
  const join = (u: string, c: string) => {
    const from = where(u);
    if (from) rooms.get(from)!.members.delete(u);
    rooms.get(c)!.members.add(u);
    return from;
  };
  const leave = (u: string) => {
    const from = where(u)!;
    rooms.get(from)!.members.delete(u);
    return from;
  };
  return { ops, rooms, log, join, leave, where };
}

/** できてから 30 秒以上たったころ */
/** 今から 1 分後（使うときに決める。読み込んだときに決めると、遅いときに 30 秒以内になる） */
const later = () => new Date(Date.now() + 60_000);

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
});
afterEach(async () => {
  await close();
});

describe('🤫 パネルで作るシクレ部屋', () => {
  it('どの通話も通らずに見えない部屋を作り、作った人が入るまで 5 分待つ。入ったら 1 回だけ部屋代の合図。入らなければ消す', async () => {
    const v = fakeVoice();
    const created: unknown[] = [];
    const ops = { ...v.ops, create: async (input: Parameters<VoiceOps['create']>[0]) => { created.push(input); return v.ops.create(input); } };
    const ctx = { db, cfg, ops };
    const now = new Date();
    const r = await createSecretRoom(ctx, { hubId: HUB, userId: 'u1', displayName: 'さくら' }, now);
    if (r.status !== 'created') throw new Error(r.status);
    expect(created[0]).toMatchObject({ secret: true, ownerId: 'u1' });
    expect(v.where('u1')).toBeUndefined();
    // もう一度押しても、同じ部屋を返す
    expect(await createSecretRoom(ctx, { hubId: HUB, userId: 'u1', displayName: 'さくら' }, now)).toEqual({ status: 'exists', channelId: r.channelId });
    // 4 分たっても消さない
    expect(await cleanupRooms(ctx, new Date(now.getTime() + 4 * 60_000))).toBe(0);
    // 入ったら 1 回だけ（ほかの人では外れない）
    expect(await claimSecretRoom(db, r.channelId, 'u2')).toBe(false);
    expect(await claimSecretRoom(db, r.channelId, 'u1')).toBe(true);
    expect(await claimSecretRoom(db, r.channelId, 'u1')).toBe(false);
    // 入らないまま 5 分たった別の部屋は消える
    const r2 = await createSecretRoom(ctx, { hubId: HUB, userId: 'u3', displayName: 'もも' }, now);
    if (r2.status !== 'created') throw new Error(r2.status);
    expect(await cleanupRooms(ctx, new Date(now.getTime() + 5 * 60_000 + 1))).toBeGreaterThanOrEqual(1);
    expect(v.rooms.has(r2.channelId)).toBe(false);
  });

  it('公開パネルは開くボタン1つ。種類と料金は本人にだけ表示する', async () => {
    const { secretRoomPanel } = await import('../src/discord/tempVoice.js');
    const c = { ...cfg, tempVoice: { hubs: [{ channelId: HUB, name: '🌙 {name}の宿坊' }] } } as GuildConfig;
    const p = JSON.stringify(secretRoomPanel(c));
    expect(p).toContain('secretroom:open');
    expect(p).toContain('シクレ部屋を開く');
    expect(p).not.toContain(`secretroom:${HUB}`);
    expect(p).not.toContain('5 分');
    const { onSecretRoomInteraction } = await import('../src/discord/tempVoice.js');
    const { MessageFlags } = await import('discord.js');
    const reply = vi.fn(), openSecret = vi.fn();
    const interaction = { inCachedGuild: () => true, guildId: c.guildId, isChatInputCommand: () => false, isButton: () => true, customId: 'secretroom:open', guild: {channels: {cache: new Map([[HUB, {name:'宿坊をひらく',permissionsFor:() => ({has:()=>true})}]])}}, member: {}, reply };
    await onSecretRoomInteraction({ openSecret } as never, () => c, interaction as never);
    expect(openSecret).not.toHaveBeenCalled();
    expect(reply.mock.calls[0]![0].flags).toBe(MessageFlags.Ephemeral);
    expect(JSON.stringify(reply.mock.calls)).toContain(`secretroom:${HUB}`);
    expect(JSON.stringify(reply.mock.calls)).toContain('5 分');
    expect(JSON.stringify(reply.mock.calls)).toContain('宿坊をひらく');
    // 払い方のない入口（縁側）はボタンにしない
    expect(JSON.stringify(secretRoomPanel(cfg))).not.toContain('secretroom:');
  });
});

describe('自分の通話部屋', () => {
  it('名前: {name} に表示名が入る。長い名前は切る', () => {
    expect(roomName('🍵 {name}の縁側', 'さくら')).toBe('🍵 さくらの縁側');
    expect(roomName('{name}', 'あ'.repeat(30))).toBe('あ'.repeat(20));
    expect(roomName('{name}の部屋', '  ')).toBe('名無しの部屋');
  });

  it('入口に入ると部屋ができて移動する。全員抜けると消える', async () => {
    const v = fakeVoice();
    const ctx = { db, cfg, ops: v.ops };
    v.join('A', HUB);
    expect(await onVoiceJoin(ctx, { userId: 'A', displayName: 'さくら', channelId: HUB })).toEqual({ status: 'created', channelId: 'room1' });
    expect(v.where('A')).toBe('room1');
    expect(v.rooms.get('room1')?.name).toBe('🍵 さくらの縁側');

    // 友だちが入ってきて、作った人が先に抜けても残る
    v.join('B', 'room1');
    expect(await onVoiceLeave(ctx, v.leave('A'), later())).toBe(false);
    expect(v.rooms.has('room1')).toBe(true);
    // 最後の人が抜けたら消える
    expect(await onVoiceLeave(ctx, v.leave('B'), later())).toBe(true);
    expect(v.rooms.has('room1')).toBe(false);
    expect(await db.select().from(tempVoice)).toEqual([]);
  });

  it('入口以外の通話では何もしない。自分の部屋があれば、2 つ目は作らずそこへ戻す', async () => {
    const v = fakeVoice();
    const ctx = { db, cfg, ops: v.ops };
    expect(await onVoiceJoin(ctx, { userId: 'A', displayName: 'A', channelId: 'room999' })).toEqual({ status: 'ignored' });
    v.join('A', HUB);
    await onVoiceJoin(ctx, { userId: 'A', displayName: 'A', channelId: HUB });
    v.join('B', 'room1');
    v.join('A', HUB);
    expect(await onVoiceJoin(ctx, { userId: 'A', displayName: 'A', channelId: HUB })).toEqual({ status: 'moved', channelId: 'room1' });
    expect(v.where('A')).toBe('room1');
    expect(v.log.filter((l) => l.startsWith('create'))).toHaveLength(1);
  });

  it('作っている間に抜けていたら、部屋を消す', async () => {
    const v = fakeVoice();
    const ctx = { db, cfg, ops: v.ops };
    expect(await onVoiceJoin(ctx, { userId: 'A', displayName: 'A', channelId: HUB })).toEqual({ status: 'failed' });
    expect(v.log).toEqual(['create 🍵 Aの縁側 A', 'remove room1']);
    expect(await db.select().from(tempVoice)).toEqual([]);
  });

  it('作れなかったとき（BOT の権限がないなど）は何も残さない', async () => {
    const v = fakeVoice();
    v.ops.create = async () => {
      throw new Error('Missing Permissions');
    };
    v.join('A', HUB);
    expect(await onVoiceJoin({ db, cfg, ops: v.ops }, { userId: 'A', displayName: 'A', channelId: HUB })).toEqual({ status: 'failed' });
    expect(await db.select().from(tempVoice)).toEqual([]);
  });

  it('起動したとき: 空の部屋を消し、手で消された部屋の記録も消す', async () => {
    const v = fakeVoice();
    const ctx = { db, cfg, ops: v.ops };
    for (const u of ['A', 'B', 'C']) {
      v.join(u, HUB);
      await onVoiceJoin(ctx, { userId: u, displayName: u, channelId: HUB });
    }
    // BOT が止まっている間に: A は抜けた、B の部屋は手で消された、C はまだいる
    v.leave('A');
    v.rooms.delete('room2');
    expect(await cleanupRooms(ctx, later())).toBe(1);
    expect((await db.select().from(tempVoice)).map((r) => r.ownerId)).toEqual(['C']);
    expect(v.rooms.has('room3')).toBe(true);
  });
});

describe('自分の通話部屋: 取りこぼし', () => {
  it('できたばかり（30 秒以内）の部屋は、人がいないように見えても消さない', async () => {
    const v = fakeVoice();
    const ctx = { db, cfg, ops: v.ops };
    v.join('A', HUB);
    await onVoiceJoin(ctx, { userId: 'A', displayName: 'A', channelId: HUB });
    v.leave('A');
    expect(await cleanupRooms(ctx, new Date())).toBe(0);
    expect(v.rooms.has('room1')).toBe(true);
    expect(await cleanupRooms(ctx, later())).toBe(1);
  });

  it('ほかの入口では、その入口の部屋を新しく作る', async () => {
    const HUB2 = '920000000000000002';
    const cfg2: GuildConfig = { ...cfg, tempVoice: { hubs: [...cfg.tempVoice.hubs, { channelId: HUB2, name: '🎮 {name}の屋台' }] } };
    const v = fakeVoice();
    v.rooms.set(HUB2, { name: '➕ 屋台', members: new Set() });
    const ctx = { db, cfg: cfg2, ops: v.ops };
    v.join('A', HUB);
    await onVoiceJoin(ctx, { userId: 'A', displayName: 'A', channelId: HUB });
    v.join('A', HUB2);
    expect(await onVoiceJoin(ctx, { userId: 'A', displayName: 'A', channelId: HUB2 })).toEqual({ status: 'created', channelId: 'room2' });
    expect(v.rooms.get('room2')?.name).toBe('🎮 Aの屋台');
  });
});

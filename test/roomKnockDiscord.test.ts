import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Collection, PermissionFlagsBits } from 'discord.js';
import type { Db } from '../src/db/client.js';
import { RoomKnockApp } from '../src/discord/roomKnock.js';
import { roomKnockState, setRoomKnockMode } from '../src/services/roomKnock.js';
import { cfg, makeDb } from './helpers.js';
let db: Db, close: () => Promise<void>;
beforeEach(async () => { ({ db, close } = await makeDb()); });
afterEach(async () => { vi.restoreAllMocks(); await close(); });
const ROOM = '870000000000000001', OTHER = '870000000000000002', IN = '870000000000000003', OUT = '870000000000000004', DIR = '870000000000000005', BOT = '870000000000000006';
function fixture() {
  let seq = 0;
  const client = { user: { id: BOT }, users: { send: vi.fn(async (_user: string, _body: any) => undefined) } };
  function channel(id: string, name: string, type: number) {
    const store = new Collection<string, any>();
    const ch: any = { id, name, type, rawPosition: 0, members: new Collection(), visible: true, connectable: true };
    function update(m: any, body: any) {
      m.content = body.content;
      m.components = (body.components ?? []).map((r: any) => ({ components: r.toJSON().components.map((c: any) => ({ ...c, customId: c.custom_id })) }));
      return m;
    }
    ch.messages = {
      fetch: vi.fn(async (arg: any) => { if (typeof arg === 'object') return store; if (!store.has(arg)) throw Error('Unknown message'); return store.get(arg); }),
      edit: vi.fn(async (id: string, body: any) => { if (!store.has(id)) throw Error('Unknown message'); return update(store.get(id), body); }),
    };
    ch.send = vi.fn(async (body: any) => {
      const m: any = { id: `msg${++seq}`, author: { id: BOT }, edit: vi.fn(async (b: any) => update(m, b)) };
      update(m, body); store.set(m.id, m); return m;
    });
    ch.permissionsFor = vi.fn(() => ({ has: (bits: bigint[]) => ch.visible && ch.connectable && bits.includes(PermissionFlagsBits.ViewChannel) }));
    return ch;
  }
  const room = channel(ROOM, 'さくらの宿', 2), other = channel(OTHER, '縁側', 2), directory = channel(DIR, '🌸 お部屋案内', 0);
  const resident: any = { id: IN, user: { bot: false }, voice: { channelId: ROOM } };
  const visitor: any = { id: OUT, user: { bot: false }, voice: { channelId: null } };
  room.members.set(IN, resident);
  const people = new Collection([[IN, resident], [OUT, visitor]]);
  const guild: any = { id: cfg.guildId, client, afkChannelId: null, channels: { cache: new Collection([[ROOM, room], [OTHER, other], [DIR, directory]]) }, members: { fetch: vi.fn(async ({ user }: any) => { if (!people.has(user)) throw Error('Unknown Member'); return people.get(user); }) } };
  for (const ch of [room, other, directory]) ch.guild = guild;
  const app = new RoomKnockApp(db, () => cfg, async id => id === ROOM);
  function interaction(customId: string, who = OUT, values?: string[]) {
    return { id: `req${++seq}`, customId, values, user: { id: who }, guild, guildId: guild.id, client, isButton: () => !values, isStringSelectMenu: () => Boolean(values), inCachedGuild: () => true, deferReply: vi.fn(async () => undefined), editReply: vi.fn(async (_body: any) => undefined) };
  }
  async function act(customId: string, who = OUT, values?: string[]) {
    const i = interaction(customId, who, values); await app.onInteraction(i as never); return i;
  }
  return { app, room, other, directory, guild, resident, visitor, people, client, act, interaction };
}
describe('宿のお部屋案内パネル', () => {
  it('退会した依頼者へ返事のDMを送らない', async () => {
    const f = fixture(); await setRoomKnockMode(db, ROOM, 'knock'); await f.act(`rkn:knock:${ROOM}`);
    const p = (await roomKnockState(db, ROOM)).pending!;
    f.people.delete(OUT);
    await f.act(`rkn:reply:${ROOM}:${p.id}:yes`, IN);
    expect(f.client.users.send).not.toHaveBeenCalled();
  });
  it('入室不可の宿や対象外VCのボタンを直接押しても通知しない', async () => {
    const f = fixture(); await setRoomKnockMode(db, ROOM, 'knock');
    f.room.connectable = false;
    await f.act(`rkn:knock:${ROOM}`); expect(f.room.send).not.toHaveBeenCalled();
    await f.act(`rkn:knock:${OTHER}`); expect(f.other.send).not.toHaveBeenCalled();
  });
  it('部屋が空のまま再起動したら自由へ戻し、期限切れの受付を閉じる', async () => {
    const f = fixture(); await setRoomKnockMode(db, ROOM, 'busy'); f.room.members.clear();
    await f.app.tick(f.guild); expect((await roomKnockState(db, ROOM)).mode).toBe('open');
    f.room.members.set(IN, f.resident); await setRoomKnockMode(db, ROOM, 'knock');
    await f.act(`rkn:knock:${ROOM}`);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 180001);
    await f.app.tick(f.guild); expect((await roomKnockState(db, ROOM)).pending).toBeUndefined();
  });
  it('状態変更後の古い通知を閉じ、返事を無効にする', async () => {
    const f = fixture(); await setRoomKnockMode(db, ROOM, 'knock'); await f.act(`rkn:knock:${ROOM}`);
    const p = (await roomKnockState(db, ROOM)).pending!;
    await f.act(`rkn:mode:${ROOM}:busy`, IN);
    await f.act(`rkn:reply:${ROOM}:${p.id}:yes`, IN); expect(f.client.users.send).not.toHaveBeenCalled();
    expect(f.room.messages.edit).toHaveBeenCalledWith(p.messageId, expect.objectContaining({ components: [] }));
  });
  it('指定チャンネルへ常設し、再起動しても二重投稿しない。削除後は復元', async () => {
    const f = fixture(); f.directory.name = '🌸-お部屋案内'; await f.app.tick(f.guild);
    expect(f.directory.send).toHaveBeenCalledTimes(1);
    await new RoomKnockApp(db, () => cfg, async id => id === ROOM).tick(f.guild);
    expect(f.directory.send).toHaveBeenCalledTimes(1);
    const state = await roomKnockState(db, ROOM); expect(state.controlId).toBeDefined();
    f.directory.messages.fetch.mockRejectedValueOnce(Error('missing'));
    await f.app.tick(f.guild); expect(f.directory.send).toHaveBeenCalledTimes(1); // 直近の入口を再利用
  });
  it('対象チャンネルがない/同名複数のときは誤投稿しない', async () => {
    const f = fixture(); f.guild.channels.cache.delete(DIR); await f.app.tick(f.guild);
    expect(f.directory.send).not.toHaveBeenCalled();
    f.guild.channels.cache.set(DIR, f.directory); f.guild.channels.cache.set('duplicate', { ...f.directory, id: 'duplicate' });
    await f.app.tick(f.guild); expect(f.directory.send).not.toHaveBeenCalled();
  });
  it('本人用一覧は宿だけ。非公開/入室不可の部屋を隠す', async () => {
    const f = fixture();
    const i = await f.act('rkn:list:0');
    expect(i.deferReply).toHaveBeenCalledWith({ flags: 64 });
    const body = i.editReply.mock.calls[0]![0];
    expect(body.components[0].toJSON().components[0].options.map((o: any) => o.value)).toEqual([ROOM]);
    f.room.visible = false;
    const hidden = await f.act('rkn:list:0'); expect(hidden.editReply.mock.calls[0]![0].content).toContain('ありません');
    const forged = await f.act(`rkn:knock:${ROOM}`); expect(forged.editReply).toHaveBeenCalledWith(expect.stringContaining('利用できません'));
  });
  it('外の人にだけ歓迎中のこんこんボタンを出す。在室者・自由・取り込み中・空室には出さない', async () => {
    const f = fixture(); await setRoomKnockMode(db, ROOM, 'knock');
    const getIds = (i: any) => JSON.stringify(i.editReply.mock.calls[0][0]);
    expect(getIds(await f.act('rkn:select', OUT, [ROOM]))).toContain(`rkn:knock:${ROOM}`);
    expect(getIds(await f.act('rkn:select', IN, [ROOM]))).not.toContain(`rkn:knock:${ROOM}`);
    for (const mode of ['open', 'busy'] as const) { await setRoomKnockMode(db, ROOM, mode); expect(getIds(await f.act('rkn:select', OUT, [ROOM]))).not.toContain(`rkn:knock:${ROOM}`); }
    await setRoomKnockMode(db, ROOM, 'knock'); f.room.members.clear();
    expect(getIds(await f.act('rkn:select', OUT, [ROOM]))).not.toContain(`rkn:knock:${ROOM}`);
  });
  it('在室者だけが状態変更し、VC内パネルへ反映する', async () => {
    const f = fixture(); await f.act(`rkn:mode:${ROOM}:knock`);
    expect((await roomKnockState(db, ROOM)).mode).toBe('open');
    await f.act(`rkn:mode:${ROOM}:knock`, IN);
    expect((await roomKnockState(db, ROOM)).mode).toBe('knock');
    expect(f.room.send.mock.calls[0][0].content).toContain('こんこん歓迎');
    await f.act(`rkn:mode:${ROOM}:invalid`, IN); expect((await roomKnockState(db, ROOM)).mode).toBe('knock');
  });
  it('在室者にだけ通知し、同じ人は3分制限。他の人の要求を既存通知へ集約', async () => {
    const f = fixture(); await setRoomKnockMode(db, ROOM, 'knock');
    await f.act(`rkn:knock:${ROOM}`);
    expect(f.room.send).toHaveBeenCalledTimes(1);
    expect(f.room.send.mock.calls[0][0].allowedMentions).toEqual({ parse: [], users: [IN] });
    const again = await f.act(`rkn:knock:${ROOM}`); expect(again.editReply).toHaveBeenCalledWith(expect.stringContaining('お待ちください'));
    const outsider = 'another'; f.people.set(outsider, { ...f.visitor, id: outsider });
    await f.act(`rkn:knock:${ROOM}`, outsider);
    expect(f.room.send).toHaveBeenCalledTimes(1); expect(f.room.messages.edit).toHaveBeenCalledTimes(1);
    expect((await roomKnockState(db, ROOM)).pending?.users).toEqual([OUT, outsider]);
  });
  it('外の人・退出した人は返事できず、在室者の返事は1回だけDMする', async () => {
    const f = fixture(); await setRoomKnockMode(db, ROOM, 'knock'); await f.act(`rkn:knock:${ROOM}`);
    const p = (await roomKnockState(db, ROOM)).pending!;
    await f.act(`rkn:reply:${ROOM}:${p.id}:yes`); expect(f.client.users.send).not.toHaveBeenCalled();
    f.resident.voice.channelId = null;
    await f.act(`rkn:reply:${ROOM}:${p.id}:yes`, IN); expect(f.client.users.send).not.toHaveBeenCalled();
    f.resident.voice.channelId = ROOM;
    await Promise.all([f.act(`rkn:reply:${ROOM}:${p.id}:yes`, IN), f.act(`rkn:reply:${ROOM}:${p.id}:no`, IN)]);
    expect(f.client.users.send).toHaveBeenCalledTimes(1);
    expect(f.client.users.send.mock.calls[0]![1].content).toContain('どうぞ');
  });
  it('通知失敗でも連打せず、古いボタンは無効にする', async () => {
    const f = fixture(); await setRoomKnockMode(db, ROOM, 'knock'); f.room.send.mockRejectedValueOnce(Error('send timeout'));
    const i = await f.act(`rkn:knock:${ROOM}`); expect(i.editReply).toHaveBeenCalledWith(expect.stringContaining('3分後'));
    expect((await roomKnockState(db, ROOM)).pending).toBeUndefined();
    await f.act(`rkn:knock:${ROOM}`); expect(f.room.send).toHaveBeenCalledTimes(1);
  });
  it('DM不可を返事した人に伝え、同じ返事の再送で重複させない', async () => {
    const f = fixture(); await setRoomKnockMode(db, ROOM, 'knock'); await f.act(`rkn:knock:${ROOM}`);
    f.client.users.send.mockRejectedValueOnce(Error('DM closed'));
    const p = (await roomKnockState(db, ROOM)).pending!;
    const reply = await f.act(`rkn:reply:${ROOM}:${p.id}:wait`, IN);
    expect(reply.editReply).toHaveBeenCalledWith(expect.stringContaining('届けられなかった'));
    await f.act(`rkn:reply:${ROOM}:${p.id}:yes`, IN); expect(f.client.users.send).toHaveBeenCalledTimes(1);
  });
  it('全員退出で自由へ戻し、宿のメッセージを削除せず旧通知を終了', async () => {
    const f = fixture(); await setRoomKnockMode(db, ROOM, 'knock'); await f.act(`rkn:knock:${ROOM}`);
    const p = (await roomKnockState(db, ROOM)).pending!; f.room.members.clear();
    await f.app.onVoiceStateUpdate({ channelId: ROOM, channel: f.room } as never, { guild: f.guild, channelId: null, channel: null } as never);
    expect((await roomKnockState(db, ROOM)).mode).toBe('open');
    await f.act(`rkn:reply:${ROOM}:${p.id}:yes`, IN); expect(f.client.users.send).not.toHaveBeenCalled();
    expect(f.room.messages.edit).toHaveBeenCalledWith(p.messageId, expect.objectContaining({ components: [] }));
  });
});

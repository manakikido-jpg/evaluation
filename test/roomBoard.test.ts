import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChannelType } from 'discord.js';
import type { Db } from '../src/db/client.js';
import { tempVoice } from '../src/db/schema.js';
import { RoomBoardApp, roomBoardCard } from '../src/discord/roomBoard.js';
import { roomKnockControls } from '../src/discord/roomKnock.js';
import { resetRoomKnock, roomKnockState, saveRoomKnockConfig, setRoomKnockMode, setRoomTopic } from '../src/services/roomKnock.js';
import { cfg, makeDb } from './helpers.js';

let db: Db, close: () => Promise<void>;
beforeEach(async () => { ({ db, close } = await makeDb()); });
afterEach(async () => close());

const BOARD = '940000000000000001', OTHER_BOARD = '940000000000000002';
const V1 = '940000000000000011', V2 = '940000000000000012', V3 = '940000000000000013', V4 = '940000000000000014';

/** 偽の guild: 掲示板のチャンネル（送る・書きかえる・消す）と VC（中の人） */
function fakeGuild() {
  let seq = 0;
  const boards = new Map<string, Map<string, unknown>>([[BOARD, new Map()], [OTHER_BOARD, new Map()]]);
  const log: string[] = [];
  const text = (id: string) => ({
    id, type: ChannelType.GuildText, isTextBased: () => true, isSendable: () => true,
    send: async (body: unknown) => { const m = `m${++seq}`; boards.get(id)!.set(m, body); log.push(`send ${id} ${m}`); return { id: m }; },
    messages: {
      edit: async (m: string, body: unknown) => { if (!boards.get(id)!.has(m)) throw new Error('Unknown Message'); boards.get(id)!.set(m, body); log.push(`edit ${m}`); },
      delete: async (m: string) => { boards.get(id)!.delete(m); log.push(`delete ${m}`); },
    },
  });
  const member = (id: string, bot = false) => [id, { id, user: { bot } }] as const;
  const voice = (id: string, name: string, pos: number, people: string[]) => {
    const members = new Map(people.map((p) => member(p)));
    return { id, name, type: ChannelType.GuildVoice, rawPosition: pos, members: Object.assign(members, { some: (f: (m: { user: { bot: boolean } }) => boolean) => [...members.values()].some(f), filter: (f: (m: { user: { bot: boolean } }) => boolean) => ({ size: [...members.values()].filter(f).length }) }) };
  };
  const vcs = { [V1]: voice(V1, '🏨 りくの宿', 1, ['a', 'b']), [V2]: voice(V2, '🔒 ひみつ', 2, ['c']), [V3]: voice(V3, 'みんなの宿', 3, ['d', 'e', 'f']), [V4]: voice(V4, '空の宿', 4, []) };
  const cache = new Map<string, unknown>([[BOARD, text(BOARD)], [OTHER_BOARD, text(OTHER_BOARD)], ...Object.entries(vcs)]);
  return { guild: { id: cfg.guildId, channels: { cache } } as never, boards, log, vcs };
}

describe('🏨 いまの部屋の掲示板', () => {
  it('1 部屋のメッセージ: 人数・入室のしかた・話題・こんこんボタン・🔑 招待のみ', () => {
    const base = { vcId: V1, guildId: cfg.guildId, name: '🏨 りくの宿', count: 3, mode: 'knock' as const, invite: false, topic: 'ゲームの話', ownerId: 'o', knockEnabled: true };
    const knock = JSON.stringify(roomBoardCard(base));
    expect(knock).toContain('3人'); expect(knock).toContain('こんこん歓迎'); expect(knock).toContain('ゲームの話'); expect(knock).toContain(`rkn:knock:${V1}`);
    const open = JSON.stringify(roomBoardCard({ ...base, mode: 'open', topic: undefined }));
    expect(open).toContain('出入り自由'); expect(open).not.toContain('rkn:knock'); expect(open).toContain('部屋を開く');
    const invite = JSON.stringify(roomBoardCard({ ...base, invite: true }));
    expect(invite).toContain('🔑 招待のみ'); expect(invite).not.toContain('rkn:knock');
    expect(roomBoardCard(base).allowedMentions).toEqual({ parse: [] });
  });

  it('人がいる宿だけ 1 部屋 1 メッセージ。シクレは出さない。変わらなければ書きかえず、空いたら消し、出す先を変えたら移す', async () => {
    const g = fakeGuild();
    await db.insert(tempVoice).values([
      { channelId: V1, ownerId: 'o1', hubId: 'h', kind: 'public' },
      { channelId: V2, ownerId: 'o2', hubId: 'h', kind: 'secret' },
      { channelId: V3, ownerId: 'o3', hubId: 'h', kind: 'invite' },
    ]);
    await saveRoomKnockConfig(db, { boardChannelId: BOARD }, 'staff');
    const app = new RoomBoardApp(db, () => cfg, async () => true, 0);
    await app.attach(g.guild);
    const cards = () => [...g.boards.get(BOARD)!.values()].map((b) => JSON.stringify(b));
    expect(cards()).toHaveLength(2);
    expect(cards()[0]).toContain('りくの宿'); expect(cards()[0]).toContain('2人');
    expect(cards()[1]).toContain('🔑 招待のみ');
    expect(cards().join()).not.toContain('ひみつ');
    // 変わらなければ書きかえない
    const before = g.log.length;
    await app.refreshNow();
    expect(g.log.length).toBe(before);
    // 受付と話題が変わると、その部屋だけ書きかえる
    await setRoomKnockMode(db, V1, 'knock');
    await setRoomTopic(db, V1, '  ゆるく\n雑談中  ', 'a');
    await app.refreshNow();
    expect(g.log.slice(before)).toEqual(['edit m1']);
    expect(cards()[0]).toContain('こんこん歓迎'); expect(cards()[0]).toContain('ゆるく 雑談中');
    // 空いたら消す
    g.vcs[V1].members.clear();
    await app.refreshNow();
    expect(cards()).toHaveLength(1);
    // 出す先を変えたら、前のは消して新しいほうに出す
    await saveRoomKnockConfig(db, { boardChannelId: OTHER_BOARD }, 'staff');
    await app.refreshNow();
    expect(g.boards.get(BOARD)!.size).toBe(0);
    expect(g.boards.get(OTHER_BOARD)!.size).toBe(1);
    // 出さないにすると、全部消す
    await saveRoomKnockConfig(db, { boardChannelId: '' }, 'staff');
    await app.refreshNow();
    expect(g.boards.get(OTHER_BOARD)!.size).toBe(0);
  });
});

describe('💬 今の話題', () => {
  it('改行は空白に、80 文字まで、空で消す。全員いなくなると消える', async () => {
    expect(await setRoomTopic(db, V1, 'あ'.repeat(100), 'a')).toBe('あ'.repeat(80));
    expect((await roomKnockState(db, V1)).topic?.text).toBe('あ'.repeat(80));
    expect(await setRoomTopic(db, V1, '   ', 'a')).toBe('');
    expect((await roomKnockState(db, V1)).topic).toBeUndefined();
    await setRoomTopic(db, V1, 'ゲーム', 'a');
    await resetRoomKnock(db, V1);
    expect((await roomKnockState(db, V1)).topic).toBeUndefined();
  });
  it('VC のチャットの操作メッセージに、話題と「話題を書く」ボタンが出る', () => {
    const body = JSON.stringify(roomKnockControls(V1, 'open', 'ゲーム'));
    expect(body).toContain('ゲーム'); expect(body).toContain(`rkn:topic:${V1}`);
    expect(JSON.stringify(roomKnockControls(V1, 'open'))).toContain('まだありません');
  });
});

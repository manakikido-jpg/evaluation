import { beforeEach, expect, it } from 'vitest';
import { ShinpuRooms } from '../src/services/shinpu/rooms.js';
const a = { id: 'a', name: 'あいす' },
  b = { id: 'b', name: 'あおい' };
let clock: number, rooms: ShinpuRooms;
beforeEach(() => {
  clock = 1000;
  rooms = new ShinpuRooms(
    () => clock,
    () => 0,
  );
});
it('運営の人間同士で開始し、空席だけCPUにする', () => {
  const r = rooms.create(a, 4);
  const joined = rooms.join(r.roomId, b);
  expect(joined.myIndex).toBe(1);
  const started = rooms.start(r.roomId, a.id, joined.revision);
  expect(started.seats.map((p) => p.cpu)).toEqual([false, false, true, true]);
  expect(started.state!.players[0]!.hand).toHaveLength(7);
  expect(started.state!.players[1]!.hand).toEqual([]);
  expect(rooms.view(r.roomId, b.id).state!.players[1]!.hand).toHaveLength(7);
});
it('参加していない人には手札も状態も返さない', () => {
  const r = rooms.create(a, 2);
  expect(() => rooms.view(r.roomId, b.id)).toThrow('参加');
  expect(() => rooms.start(r.roomId, b.id, r.revision)).toThrow('作った人');
});
it('人間の攻撃は対象者が返答するまで進めず、他人は操作できない', () => {
  let r = rooms.create(a, 2);
  r = rooms.join(r.roomId, b);
  r = rooms.start(r.roomId, a.id, r.revision);
  const arrow = r.state!.players[0]!.hand[0]!;
  r = rooms.move(r.roomId, a.id, { revision: r.revision, action: 'attack', ids: [arrow.uid], target: 1 });
  clock += 1000;
  expect(rooms.view(r.roomId, a.id).state!.phase).toBe('defense');
  expect(() => rooms.move(r.roomId, a.id, { revision: r.revision, action: 'defend', ids: [] })).toThrow('あなたの番');
  const v = rooms.move(r.roomId, b.id, { revision: r.revision, action: 'defend', ids: [] });
  expect(v.state!.players[1]!.hp).toBe(55);
});
it('同じリビジョンを再送しても二重に両替しない', () => {
  let r = rooms.create(a, 2);
  r = rooms.start(r.roomId, a.id, r.revision);
  const move = { revision: r.revision, action: 'exchange', ids: [], target: 'mp' };
  rooms.move(r.roomId, a.id, move);
  expect(() => rooms.move(r.roomId, a.id, move)).toThrow('更新');
  expect(rooms.view(r.roomId, a.id).state!.players[0]!.money).toBe(16);
});
it('CPUの行動は待ち時間後に一度だけ進む', () => {
  let r = rooms.create(a, 2);
  r = rooms.start(r.roomId, a.id, r.revision);
  r = rooms.move(r.roomId, a.id, { revision: r.revision, action: 'pass', ids: [] });
  expect(r.state!.turn).toBe(1);
  expect(rooms.view(r.roomId, a.id).revision).toBe(r.revision);
  clock += 900;
  const next = rooms.view(r.roomId, a.id);
  expect(next.state!.phase).toBe('defense');
  expect(rooms.view(r.roomId, a.id).revision).toBe(next.revision);
});
it('人間の防御は2分で防御なしとして進む', () => {
  let r = rooms.create(a, 2);
  r = rooms.join(r.roomId, b);
  r = rooms.start(r.roomId, a.id, r.revision);
  r = rooms.move(r.roomId, a.id, { revision: r.revision, action: 'attack', ids: [r.state!.players[0]!.hand[0]!.uid], target: 1 });
  clock += 120001;
  const v = rooms.view(r.roomId, a.id);
  expect(v.state!.phase).toBe('action');
  expect(v.state!.players[1]!.hp).toBe(55);
});
it('退出した人の席はCPUが引き継ぎ、全員退出で部屋を消す', () => {
  let r = rooms.create(a, 2);
  r = rooms.join(r.roomId, b);
  r = rooms.start(r.roomId, a.id, r.revision);
  rooms.leave(r.roomId, a.id);
  const v = rooms.view(r.roomId, b.id);
  expect(v.owner).toBe(true);
  expect(v.seats[0]!.cpu).toBe(true);
  rooms.leave(r.roomId, b.id);
  expect(rooms.list()).toEqual([]);
});
it('開始後の参加・満員・複数の部屋への参加を防ぐ', () => {
  const r = rooms.create(a, 2);
  rooms.join(r.roomId, b);
  expect(() => rooms.join(r.roomId, { id: 'c', name: 'c' })).toThrow('満員');
  expect(() => rooms.create(a, 2)).toThrow('退出');
  const started = rooms.start(r.roomId, a.id, 1);
  expect(() => rooms.join(started.roomId, { id: 'c', name: 'c' })).toThrow('始まった');
});
it('部屋は2時間で期限切れになる', () => {
  const r = rooms.create(a, 2);
  clock += 2 * 60 * 60000;
  expect(() => rooms.view(r.roomId, a.id)).toThrow('期限切れ');
  expect(rooms.list()).toEqual([]);
});

it('一覧から自分の対戦中の部屋を再開できる', () => {
  let r = rooms.create(a, 2);
  r = rooms.start(r.roomId, a.id, r.revision);
  expect(rooms.list(a.id)[0]!.mine).toBe(true);
  expect(rooms.list(b.id)[0]!.mine).toBe(false);
  expect(rooms.join(r.roomId, a).roomId).toBe(r.roomId);
});

it('召喚はais・小林だけで、ログイン由来の肖像を全参加者に表示し二重使用を拒否する', () => {
  const ais = { id: 'ais-id', name: 'ais', avatarUrl: 'https://cdn.discordapp.com/avatars/1/a.png' };
  let r = rooms.create(ais, 2);
  r = rooms.join(r.roomId, b);
  r = rooms.start(r.roomId, ais.id, r.revision);
  const card = r.state!.players[0]!.hand.find((c) => c.id === 'summon')!;
  const move = { revision: r.revision, action: 'use', ids: [card.uid] };
  const next = rooms.move(r.roomId, ais.id, move);
  expect(next.state!.summon).toMatchObject({ name: 'ais', avatarUrl: ais.avatarUrl, recipient: 'ais' });
  expect(rooms.view(r.roomId, b.id).state!.summon).toEqual(next.state!.summon);
  expect(next.state).not.toHaveProperty('summoners');
  expect(() => rooms.move(r.roomId, ais.id, move)).toThrow('更新');
  expect(rooms.view(r.roomId, ais.id).state!.players[0]!.mp).toBe(9);
});

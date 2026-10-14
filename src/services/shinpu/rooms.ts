import { randomUUID } from 'node:crypto';
import { act, cpu, create, defend, SUMMONER_NAMES, type State } from './engine.js';
export type Tester = {
  id: string;
  name: string;
  avatarUrl?: string | null;
};
type Room = {
  id: string;
  owner: string;
  seats: (Tester | null)[];
  capacity: number;
  state: State | null;
  revision: number;
  expires: number;
  next: number;
  deadline: number;
};
export type Move = {
  revision: number;
  action: string;
  ids: number[];
  target?: string | number;
};
const LIFE_MS = 2 * 60 * 60000;
const MOVE_MS = 120000;
/** テスト部屋はWebプロセス内だけ。再起動で消える。銭・本番の卓のDBには書かない。 */
export class ShinpuRooms {
  private rooms = new Map<string, Room>();
  constructor(
    private readonly clock: () => number = Date.now,
    private readonly rng: () => number = Math.random,
  ) {}
  private sweep() {
    for (const [id, r] of this.rooms) if (r.expires <= this.clock()) this.rooms.delete(id);
  }
  private room(id: string) {
    this.sweep();
    const r = this.rooms.get(id);
    if (!r) throw Error('部屋がありません。期限切れか、Webの再起動で終了しました。');
    return r;
  }
  private seat(r: Room, user: string) {
    const i = r.seats.findIndex((p) => p?.id === user);
    if (i < 0) throw Error('先にこの部屋へ参加してください。');
    return i;
  }
  private check(r: Room, revision: number) {
    if (r.revision !== revision) throw Error('画面が更新されています。もう一度選んでください。');
  }
  private changed(r: Room) {
    r.revision++;
    r.next = this.clock() + 850;
    r.deadline = this.clock() + MOVE_MS;
  }
  private occupied(user: string) {
    return [...this.rooms.values()].some((r) => r.seats.some((p) => p?.id === user));
  }
  list(user?: string) {
    this.sweep();
    return [...this.rooms.values()].map((r) => ({
      id: r.id,
      mine: r.seats.some((p) => p?.id === user),
      name: r.seats.find((p) => p?.id === r.owner)?.name ?? '運営',
      capacity: r.capacity,
      players: r.seats.filter(Boolean).length,
      status: r.state?.phase === 'over' ? '終了' : r.state ? '対戦中' : '参加受付中',
    }));
  }
  create(user: Tester, capacity: number) {
    this.sweep();
    if (!Number.isInteger(capacity) || capacity < 2 || capacity > 6) throw Error('人数は2〜6人です。');
    if (this.occupied(user.id)) throw Error('いまの部屋を退出してから作ってください。');
    if (this.rooms.size >= 50) throw Error('テスト部屋がいっぱいです。');
    const id = randomUUID();
    this.rooms.set(id, {
      id,
      owner: user.id,
      seats: [user],
      capacity,
      state: null,
      revision: 0,
      expires: this.clock() + LIFE_MS,
      next: 0,
      deadline: 0,
    });
    return this.view(id, user.id);
  }
  join(id: string, user: Tester) {
    const r = this.room(id);
    if (r.seats.some((p) => p?.id === user.id)) return this.view(id, user.id);
    if (r.state) throw Error('対戦が始まった部屋には参加できません。');
    if (this.occupied(user.id)) throw Error('いまの部屋を退出してから参加してください。');
    if (r.seats.length >= r.capacity) throw Error('部屋が満員です。');
    r.seats.push(user);
    this.changed(r);
    return this.view(id, user.id);
  }
  start(id: string, user: string, revision: number) {
    const r = this.room(id);
    this.check(r, revision);
    if (r.owner !== user || r.state) throw Error('部屋を作った人だけが開始できます。');
    r.state = create(
      r.capacity,
      this.rng,
      r.seats[0]!.name,
      SUMMONER_NAMES.map((name) => ({ name, avatarUrl: r.seats.find((p) => p?.name === name)?.avatarUrl ?? null })),
    );
    while (r.seats.length < r.capacity) r.seats.push(null);
    r.state.players.forEach((p, i) => (p.name = r.seats[i]?.name ?? `式神CPU ${i + 1}`));
    this.changed(r);
    return this.view(id, user);
  }
  move(id: string, user: string, move: Move) {
    const r = this.room(id),
      i = this.seat(r, user);
    this.check(r, move.revision);
    const s = r.state;
    if (!s || s.phase === 'over') throw Error('対戦中ではありません。');
    const who = s.phase === 'defense' ? s.pending!.to : s.turn;
    if (who !== i) throw Error('いまはあなたの番ではありません。');
    if (s.phase === 'defense') {
      if (move.action !== 'defend') throw Error('防御の返事をしてください。');
      defend(s, move.ids);
    } else {
      if (!['attack', 'use', 'exchange', 'pass'].includes(move.action)) throw Error('操作を選んでください。');
      act(s, move.action, move.ids, move.target);
    }
    this.changed(r);
    return this.view(id, user);
  }
  leave(id: string, user: string) {
    const r = this.room(id),
      i = this.seat(r, user);
    if (r.state) {
      r.seats[i] = null;
      r.state.players[i]!.name += '（CPU引継ぎ）';
    } else r.seats.splice(i, 1);
    if (!r.seats.some(Boolean)) this.rooms.delete(id);
    else {
      if (r.owner === user) r.owner = r.seats.find((p): p is Tester => !!p)!.id;
      this.changed(r);
    }
  }
  private tick(r: Room) {
    const s = r.state;
    if (!s || s.phase === 'over') return;
    const who = s.phase === 'defense' ? s.pending!.to : s.turn;
    if (r.seats[who]) {
      if (this.clock() < r.deadline) return;
      if (s.phase === 'defense') defend(s, []);
      else act(s, 'pass');
      s.log.push('返事の時間が過ぎたので、手番を進めました。');
    } else {
      if (this.clock() < r.next) return;
      cpu(s);
    }
    this.changed(r);
  }
  view(id: string, user: string) {
    const r = this.room(id),
      index = this.seat(r, user);
    this.tick(r);
    const s = r.state;
    return {
      roomId: r.id,
      revision: r.revision,
      owner: r.owner === user,
      myIndex: index,
      capacity: r.capacity,
      expires: r.expires,
      deadline: r.deadline,
      seats: r.seats.map((p) => (p ? { name: p.name, cpu: false } : { name: '式神CPU', cpu: true })),
      state: s
        ? {
            phase: s.phase,
            turn: s.turn,
            turns: s.turns,
            winner: s.winner,
            pending: s.pending,
            log: [...s.log],
            summon: s.summon ? { ...s.summon } : null,
            players: s.players.map((p, i) => ({ ...p, handCount: p.hand.length, hand: i === index ? p.hand.map((c) => ({ ...c })) : [] })),
          }
        : null,
    };
  }
}

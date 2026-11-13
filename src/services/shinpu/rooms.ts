import { randomUUID } from 'node:crypto';
import { act, cpu, create, defend, autoChoose, battleSummary, defenseForecast, SUMMONER_NAMES, type BattleSummary, type ActionOptions, type State } from './engine.js';
export type Tester = {
  id: string;
  name: string;
  avatarUrl?: string | null;
};
export type Room = {
  round?: number;
  rematchReady?: string[];
  previousSummary?: BattleSummary;
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
  options?: ActionOptions;
};
const LIFE_MS = 2 * 60 * 60000;
const MOVE_MS = 120000;
/** 対戦操作と公開ビュー。永続化はstore.tsのトランザクションで行う。 */
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
    if (!r) throw Error('部屋がありません。保存期限切れの可能性があります。');
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
      round: 1, rematchReady: [],
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
      r.seats.find((p):p is Tester=>!!p)!.name,
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
    this.tick(r);
    this.check(r, move.revision);
    const s = r.state;
    if (!s || s.phase === 'over') throw Error('対戦中ではありません。');
    const who = s.phase === 'choice' ? s.choice!.player : s.phase === 'defense' ? s.pending!.to : s.turn;
    if (who !== i) throw Error('いまはあなたの番ではありません。');
    if (s.phase === 'choice') {
      if (move.action !== 'choose') throw Error('札の選択を終えてください。');
      act(s, 'choose', move.ids);
    } else if (s.phase === 'defense') {
      if (move.action !== 'defend') throw Error('防御の返事をしてください。');
      defend(s, move.ids, move.options);
    } else {
      if (!['attack', 'use', 'exchange', 'pass'].includes(move.action)) throw Error('操作を選んでください。');
      act(s, move.action, move.ids, move.target, move.options);
    }
    this.changed(r);
    return this.view(id, user);
  }
  leave(id: string, user: string) {
    const r = this.room(id),
      i = this.seat(r, user);
    if (r.state) {
      r.seats[i] = null;
      if(r.state.phase!=='over')r.state.players[i]!.name += '（CPU引継ぎ）';
      r.rematchReady=(r.rematchReady??[]).filter(id=>id!==user);
    } else r.seats.splice(i, 1);
    if (!r.seats.some(Boolean)) this.rooms.delete(id);
    else {
      if (r.owner === user) r.owner = r.seats.find((p): p is Tester => !!p)!.id;
      this.changed(r);
      if(r.state?.phase==='over'&&r.seats.filter(Boolean).every(p=>r.rematchReady?.includes(p!.id)))this.nextRound(r);
    }
  }
  preview(id: string, user: string, move: Move) {
    const r=this.room(id),i=this.seat(r,user);this.tick(r);this.check(r,move.revision);
    if(r.state?.phase!=='defense'||r.state.pending?.to!==i)throw Error('いまはあなたの防御の番ではありません。');
    return {roomId:r.id,revision:r.revision,...defenseForecast(r.state,move.ids,move.options)};
  }
  rematch(id: string,user: string,revision: number) {
    const r=this.room(id);this.seat(r,user);this.check(r,revision);
    if(r.state?.phase!=='over')throw Error('対戦が終わってから再戦できます。');
    r.rematchReady??=[];if(r.rematchReady.includes(user))return this.view(id,user);r.rematchReady.push(user);
    this.changed(r);
    if(r.seats.filter(Boolean).every(p=>r.rematchReady!.includes(p!.id)))this.nextRound(r);
    return this.view(id,user);
  }
  private nextRound(r: Room) {
    r.previousSummary=battleSummary(r.state!);r.round=(r.round??1)+1;r.rematchReady=[];
    r.state=null;r.expires=this.clock()+LIFE_MS;
    // 全員の同意を確認した後、同じ席とCPUで開始する。
    this.start(r.id,r.owner,r.revision);
  }
  snapshot(id: string): StoredRoom | undefined {
    const r=this.rooms.get(id);return r?JSON.parse(JSON.stringify(r)) as StoredRoom:undefined;
  }
  restore(data: StoredRoom) {
    if(!data||typeof data.id!=='string'||!Array.isArray(data.seats)||!Number.isSafeInteger(data.revision)||!Number.isFinite(data.expires)||!Number.isInteger(data.capacity)||data.capacity<2||data.capacity>6||data.seats.length>data.capacity||typeof data.owner!=='string'||!Number.isFinite(data.next)||!Number.isFinite(data.deadline)||!data.seats.every(p=>p===null||typeof p?.id==='string'&&typeof p?.name==='string'))throw Error('保存した対戦を読み込めません。');
    const r=JSON.parse(JSON.stringify(data)) as Room;
    if(r.state){if(!Array.isArray(r.state.players)||r.state.players.length!==r.capacity||!r.state.players.every(p=>[p.hp,p.mp,p.money].every(n=>Number.isSafeInteger(n)&&n>=0)&&Array.isArray(p.hand))||!Array.isArray(r.state.deck)||!['action','defense','choice','over'].includes(r.state.phase))throw Error('保存した対戦を読み込めません。');r.state.rng=this.rng;}
    this.rooms.set(r.id,r);
  }
  private tick(r: Room) {
    const s = r.state;
    if (!s || s.phase === 'over') return;
    const who = s.phase === 'choice' ? s.choice!.player : s.phase === 'defense' ? s.pending!.to : s.turn;
    if (r.seats[who]) {
      if (this.clock() < r.deadline) return;
      if (s.phase === 'choice') autoChoose(s);
      else if (s.phase === 'defense') defend(s, []);
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
      round: r.round??1,
      rematchReady: r.seats.map(p=>!!p&&!!r.rematchReady?.includes(p.id)),
      summary: s?.phase==='over'?battleSummary(s):null,
      previousSummary: r.previousSummary??null,
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
            result: s.result ? { ...s.result } : null,
            choice: s.choice ? { ...s.choice, cards: s.choice.player === index ? s.choice.cards.map(c => ({ ...c })) : [] } : null,
            deckCount: s.deck.length,
            discardCount: s.discard.length,
            players: s.players.map((p, i) => ({ ...p, handCount: p.hand.length, hand: i === index ? p.hand.map((c) => ({ ...c })) : [] })),
          }
        : null,
    };
  }
}

export type StoredRoom = Omit<Room,'state'> & {state: Omit<State,'rng'> | null};

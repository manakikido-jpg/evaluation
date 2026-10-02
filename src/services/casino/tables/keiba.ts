import {
  addToPool,
  commentary,
  estimate,
  finalOdds,
  fmtTime,
  isKbBetType,
  isPairType,
  KB_DISTANCES,
  KB_HORSES,
  KB_MAX_TICKETS,
  makeRace,
  margin,
  pairKey,
  seeded,
  seedPools,
  simulate,
  ticketOdds,
  type KbBetType,
  type KbFinal,
  type KbHorse,
  type KbPools,
  type KbRaceInfo,
} from '../keiba.js';
import { fail, intOf, ok, str, type Credit, type Ctx, type PlayRecord, type Step, type TableEngine, type Who } from './types.js';

/**
 * 🏇 みんなでダービー（競馬の卓）。だれかがレースを開くと受付が始まり、締め切ったら全員が同じレースを見る。
 * 結果を出したら、座っている人がいるあいだは次のレースの受付が自動で始まる。
 * - 受付の時間は開いた人が選ぶ（1〜5 分）。開いた人は「締め切って発走」で早めに走らせられる
 * - 座っていない人も見られる。賭けるには「参加する」
 * - 受付中に席を立つと、そのレースの賭けは返す。発走してからは返さない（当たれば席を立っていても払う）
 */

export const KB_WINDOWS = [1, 2, 3, 5] as const;
export const KB_RESULT_SECONDS = 25;
export const KB_IDLE_MINUTES = 15;
export const KB_SEATS = 30;
/** 画面でレースを見せる長さ（先頭がゴールするまで）。距離が長いほど少し長い */
export const raceShowMs = (dist: number) => Math.round(25_000 + (dist / 2400) * 20_000);

export type KbTicket = { memberId: string; name: string; t: KbBetType; key: string; amount: number; odds?: number; payout?: number };
export type KbSeat = Who & { lastActive: number };
export type KbRun = {
  /** 発走の時刻（ms） */
  start: number;
  /** 先頭がゴールするまでの長さ（ms） */
  showMs: number;
  /** 1 コマの長さ（ms） */
  frameMs: number;
  frames: number[][];
  /** 内ラチからの距離（10 倍した m） */
  lanes: number[][];
  order: number[];
  /** 先頭の 200m ごとのラップ（秒） */
  laps: number[];
  /** 上がり 3 ハロン・通過順（着順に並ぶ） */
  last3f: number[];
  corners: string[];
  /** 走破タイム（表示用）と着差。着順に並ぶ */
  times: string[];
  margins: string[];
  calls: { t: number; text: string }[];
};
export type KbState = {
  kind: 'keiba';
  hostId: string;
  seats: KbSeat[];
  phase: 'betting' | 'racing' | 'result';
  /** 受付の締め切り・ゴールして結果を出す時刻・次のレースの受付を始める時刻 */
  deadline: number;
  /** 受付の長さ（分） */
  window: number;
  /** 開いた人がつけたレース名（なければおまかせ） */
  title: string | null;
  dist: number | null;
  race: KbRaceInfo;
  horses: KbHorse[];
  pools: KbPools;
  /** メンバーが賭けた合計（BOT のお客さんを除く） */
  real: number;
  tickets: KbTicket[];
  run?: KbRun;
  final?: KbFinal;
  /** これまでのレース（新しい順・10 回まで） */
  history: { n: number; name: string; order: number[]; win: number; names: string[] }[];
};

const seat = (w: Who, now: number): KbSeat => ({ id: w.id, name: w.name, lastActive: now });

/** 次のレースを作る（馬・見込み・BOT のお客さんの賭け） */
function newRace(s: Pick<KbState, 'title' | 'dist'>, n: number, ctx: Ctx): Pick<KbState, 'race' | 'horses' | 'pools' | 'real' | 'tickets'> {
  const { race, horses } = makeRace(ctx.rng, n, { ...(s.title ? { name: s.title } : {}), ...(s.dist ? { dist: s.dist } : {}) }, ctx.roster ?? []);
  const est = estimate(race, horses, ctx.rng(2 ** 31));
  for (const h of horses) {
    h.p = Math.round(est.p[h.no - 1]! * 1000) / 1000;
    h.p3 = Math.round(est.p3[h.no - 1]! * 1000) / 1000;
  }
  return { race, horses, pools: seedPools(est), real: 0, tickets: [] };
}

/** 締め切って走らせる。結果はここで決まる（払うのはゴールしてから） */
function startRace(state: KbState, ctx: Ctx): Step<KbState> {
  const s: KbState = structuredClone(state);
  const sim = simulate(s.race, s.horses, seeded(ctx.rng(2 ** 31)), true);
  const showMs = raceShowMs(s.race.dist);
  const leader = Math.min(...sim.times);
  const frameMs = (showMs / leader) * sim.frameSec!;
  const ordered = sim.order.map((no) => sim.times[no - 1]!);
  s.run = {
    // ゲートに入って 3 秒で発走
    start: ctx.now + 3000,
    showMs,
    frameMs: Math.round(frameMs * 10) / 10,
    frames: sim.frames!,
    lanes: sim.lanes!,
    order: sim.order,
    times: ordered.map((t) => fmtTime(t)),
    margins: ordered.map((t, i) => (i === 0 ? '' : margin(t - ordered[i - 1]!))),
    laps: sim.laps!,
    last3f: sim.order.map((no) => sim.last3f![no - 1]!),
    corners: sim.order.map((no) => sim.corners![no - 1]!.join('-')),
    calls: commentary(s.race, s.horses, sim, (sec) => (sec / leader) * showMs),
  };
  s.phase = 'racing';
  // ゴールしてから 5 秒で結果
  s.deadline = s.run.start + showMs + 5000;
  return ok(s);
}

/** ゴール: 払い戻しを決めて払う */
function finish(state: KbState, ctx: Ctx): Step<KbState> {
  const s: KbState = structuredClone(state);
  const run = s.run!;
  s.final = finalOdds(s.pools, run.order);
  const per = new Map<string, { bet: number; payout: number }>();
  for (const t of s.tickets) {
    t.odds = ticketOdds(s.final, t.t, t.key);
    t.payout = Math.floor((t.amount * t.odds) / 10);
    const m = per.get(t.memberId) ?? { bet: 0, payout: 0 };
    m.bet += t.amount;
    m.payout += t.payout;
    per.set(t.memberId, m);
  }
  const credits: Credit[] = [];
  const records: PlayRecord[] = [];
  for (const [memberId, m] of per) {
    if (m.payout > 0) credits.push({ memberId, amount: m.payout, reason: 'casino_win' });
    records.push({ memberId, game: 'keiba', bet: m.bet, payout: m.payout });
  }
  // 名簿の馬の成績
  const keiba = run.order.map((no, i) => ({ horseId: s.horses[no - 1]!.id, pos: i + 1, race: s.race.name, dist: s.race.dist, surface: s.race.surface })).filter((r) => r.horseId > 0);
  s.history = [{ n: s.race.n, name: s.race.name, order: run.order.slice(0, 3), win: s.final.win[1], names: run.order.slice(0, 3).map((no) => s.horses[no - 1]!.name) }, ...s.history].slice(0, 10);
  s.phase = 'result';
  s.deadline = ctx.now + KB_RESULT_SECONDS * 1000;
  return ok(s, { credits, records, keiba });
}

/** 次のレースの受付 */
function nextRace(state: KbState, ctx: Ctx): KbState {
  const s: KbState = structuredClone(state);
  // 賭けずに長くいた人は席を立たせる
  const active = new Set(s.tickets.map((t) => t.memberId));
  for (const x of s.seats) if (active.has(x.id)) x.lastActive = ctx.now;
  s.seats = s.seats.filter((x) => x.lastActive + KB_IDLE_MINUTES * 60_000 > ctx.now);
  Object.assign(s, newRace(s, s.race.n + 1, ctx));
  delete s.run;
  delete s.final;
  s.phase = 'betting';
  s.deadline = ctx.now + s.window * 60_000;
  return s;
}

/** 賭けた馬・組の書き方（"3" / "2-5"） */
export function ticketKey(t: KbBetType, a: number, b: number): string | undefined {
  const okNo = (n: number) => Number.isInteger(n) && n >= 1 && n <= KB_HORSES;
  if (!okNo(a)) return undefined;
  if (!isPairType(t)) return String(a);
  return okNo(b) && a !== b ? pairKey(a, b) : undefined;
}

export const keiba: TableEngine<KbState> = {
  kind: 'keiba',
  maxSeats: KB_SEATS,
  create(host, f, ctx) {
    const w = Number(str(f, 'window'));
    const window = (KB_WINDOWS as readonly number[]).includes(w) ? w : 2;
    const title = (str(f, 'title') ?? '').replace(/\s+/g, ' ').trim().slice(0, 20) || null;
    const d = Number(str(f, 'dist'));
    const dist = (KB_DISTANCES as readonly number[]).includes(d) ? d : null;
    const base = { title, dist };
    return ok({
      kind: 'keiba',
      hostId: host.id,
      seats: [seat(host, ctx.now)],
      phase: 'betting',
      deadline: ctx.now + window * 60_000,
      window,
      ...base,
      ...newRace(base, 1, ctx),
      history: [],
    });
  },
  join(s, who, _f, ctx) {
    if (s.seats.some((x) => x.id === who.id)) return ok(s);
    if (s.seats.length >= this.maxSeats) return fail('full');
    return ok({ ...s, seats: [...s.seats, seat(who, ctx.now)] });
  },
  leave(s, id) {
    if (!s.seats.some((x) => x.id === id)) return fail('not_seated');
    const seats = s.seats.filter((x) => x.id !== id);
    // 開いた人が立ったら、次に座っている人が「締め切って発走」できる
    if (s.hostId === id && seats[0]) s = { ...s, hostId: seats[0].id };
    if (s.phase !== 'betting') return ok({ ...s, seats });
    // 受付中: そのレースの賭けを返す
    const mine = s.tickets.filter((t) => t.memberId === id);
    const refund = mine.reduce((n, t) => n + t.amount, 0);
    const next: KbState = structuredClone({ ...s, seats, tickets: s.tickets.filter((t) => t.memberId !== id) });
    for (const t of mine) addToPool(next.pools, t.t, t.key, -t.amount);
    next.real -= refund;
    return ok(next, refund ? { credits: [{ memberId: id, amount: refund, reason: 'casino_refund' }] } : undefined);
  },
  act(state, id, f, ctx) {
    const me = state.seats.find((x) => x.id === id);
    if (!me) return fail('not_seated');
    const s: KbState = structuredClone(state);
    s.seats.find((x) => x.id === id)!.lastActive = ctx.now;
    const a = str(f, 'action');
    if (a === 'bet') {
      if (s.phase !== 'betting' || s.deadline <= ctx.now) return fail('started');
      const t = str(f, 'type');
      if (!isKbBetType(t)) return fail('invalid');
      const key = ticketKey(t, Number(str(f, 'a')), Number(str(f, 'b')));
      if (!key) return fail('invalid');
      const amount = intOf(f, 'bet');
      const c = ctx.cfg.casino;
      if (!Number.isInteger(amount) || amount < c.minBet || amount > c.maxBet) return fail('bad_bet');
      const mine = s.tickets.filter((x) => x.memberId === id);
      const same = mine.find((x) => x.t === t && x.key === key);
      if (!same && mine.length >= KB_MAX_TICKETS) return fail('too_many');
      if ((same?.amount ?? 0) + amount > c.maxBet) return fail('bad_bet');
      if (same) same.amount += amount;
      else s.tickets.push({ memberId: id, name: me.name, t, key, amount });
      addToPool(s.pools, t, key, amount);
      s.real += amount;
      return ok(s, { debits: [{ memberId: id, amount, reason: 'casino_bet', limited: true }] });
    }
    if (a === 'cancel') {
      // そのレースの自分の賭けを全部取り消す
      if (s.phase !== 'betting') return fail('started');
      const mine = s.tickets.filter((x) => x.memberId === id);
      if (!mine.length) return fail('invalid');
      const refund = mine.reduce((n, x) => n + x.amount, 0);
      for (const x of mine) addToPool(s.pools, x.t, x.key, -x.amount);
      s.tickets = s.tickets.filter((x) => x.memberId !== id);
      s.real -= refund;
      return ok(s, { credits: [{ memberId: id, amount: refund, reason: 'casino_refund' }] });
    }
    if (a === 'start') {
      // 開いた人だけ: 締め切って発走
      if (id !== s.hostId) return fail('host_only');
      if (s.phase !== 'betting') return fail('started');
      return startRace(s, ctx);
    }
    return fail('invalid');
  },
  tick(s, ctx) {
    if (s.deadline > ctx.now) return null;
    if (s.phase === 'betting') return startRace(s, ctx);
    if (s.phase === 'racing') return finish(s, ctx);
    return ok(nextRace(s, ctx));
  },
  due: (s) => s.deadline,
  seats: (s) => s.seats.map((x) => x.id),
  // 走っている間は、だれもいなくても払い終わるまで閉じない
  closed: (s) => s.seats.length === 0 && s.phase !== 'racing',
};

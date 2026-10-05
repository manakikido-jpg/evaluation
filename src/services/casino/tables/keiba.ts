import {
  addToPool,
  commentary,
  estimate,
  finalOdds,
  fmtTime,
  comboKey,
  isKbBetType,
  isOrderedType,
  keyNos,
  liveOdds,
  KB_DISTANCES,
  KB_HORSES,
  KB_MAX_TICKETS,
  makeRace,
  margin,
  racePrizes,
  raceAppearance,
  fanMoney,
  kbPayConf,
  picksOf,
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
import { fail, intOf, list, ok, str, type Credit, type Ctx, type KeibaBet, type KeibaResult, type PlayRecord, type Step, type TableEngine, type Who } from './types.js';

/**
 * 🏇 みんなでダービー（競馬の卓）。だれかがレースを開くと受付が始まり、締め切ったら全員が同じレースを見る。
 * 結果を出したら、座っている人がいるあいだは次のレースの受付が自動で始まる。
 * - 受付の時間は開いた人が選ぶ（1〜5 分）。開いた人は「締め切って発走」で早めに走らせられる
 * - 座っていない人も見られる。賭けるには「参加する」
 * - 受付中に席を立つと、そのレースの賭けは返す。発走してからは返さない（当たれば席を立っていても払う）
 */

export const KB_WINDOWS = [1, 2, 3, 5] as const;
export const KB_RESULT_SECONDS = 30;
/** 締め切ってから発走まで（本馬場入場 → ファンファーレ → ゲート入り） */
export const KB_PRERACE_MS = 15_000;
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
  /** 開いた人が決めたクラス（null はおまかせ） */
  cls?: number | null;
  /** 結果を出しはじめた時刻（到達順位 → 確定 → 払戻金） */
  resultAt?: number;
  race: KbRaceInfo;
  horses: KbHorse[];
  pools: KbPools;
  /** メンバーが賭けた合計（BOT のお客さんを除く） */
  real: number;
  tickets: KbTicket[];
  run?: KbRun;
  final?: KbFinal;
  /** 1〜5 着の賞金（結果を出したとき） */
  prizes?: number[];
  /** これまでのレース（新しい順・10 回まで） */
  history: { n: number; name: string; order: number[]; win: number; names: string[] }[];
};

const seat = (w: Who, now: number): KbSeat => ({ id: w.id, name: w.name, lastActive: now });

/** 次のレースを作る（馬・見込み・BOT のお客さんの賭け） */
function newRace(s: Pick<KbState, 'title' | 'dist' | 'cls'> & { seats?: KbSeat[] }, n: number, ctx: Ctx): Pick<KbState, 'race' | 'horses' | 'pools' | 'real' | 'tickets'> {
  // 座っている馬主の馬を先に出す
  const priority = new Set((s.seats ?? []).map((x) => x.id));
  const { race, horses } = makeRace(
    ctx.rng,
    n,
    { ...(s.title ? { name: s.title } : {}), ...(s.dist ? { dist: s.dist } : {}), ...(s.cls !== null && s.cls !== undefined ? { cls: s.cls } : {}), priority },
    ctx.roster ?? [],
  );
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
    // 本馬場入場 → ファンファーレ → ゲート入りのあと発走
    start: ctx.now + KB_PRERACE_MS,
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
  // 馬券 1 枚ずつ（自分の馬券成績）
  const keibaBets: KeibaBet[] = s.tickets.map((t) => ({
    memberId: t.memberId,
    race: s.race.name,
    cls: s.race.cls,
    type: t.t,
    key: t.key,
    names: keyNos(t.key)
      .map((no) => s.horses[no - 1]?.name ?? String(no))
      .join(t.key.includes('>') ? '→' : '・'),
    amount: t.amount,
    odds: t.odds ?? 0,
    payout: t.payout ?? 0,
  }));
  for (const [memberId, m] of per) {
    if (m.payout > 0) credits.push({ memberId, amount: m.payout, reason: 'casino_win' });
    records.push({ memberId, game: 'keiba', bet: m.bet, payout: m.payout });
  }
  // 1〜5 着の賞金（メンバーが賭けた合計の数 % に倍率・最低保証）と出走手当・応援金（馬主のいる馬はみんな）。馬主に払う
  // 最低保証で足す分は、2 人以上が賭けたレースだけ（ひとりで何度も走らせて集められないように。1 人 1 日の上限もある）
  const conf = kbPayConf(ctx.cfg.casino);
  const base = racePrizes(s.race.cls, s.real, { ...conf, purse: [] });
  const bettors = new Set(s.tickets.map((t) => t.memberId)).size;
  const prizes = bettors >= 2 ? racePrizes(s.race.cls, s.real, conf) : base;
  const fee = raceAppearance(s.real, conf);
  const earned = run.order.map((no, i) => {
    const owner = s.horses[no - 1]!.ownerId;
    return (prizes[i] ?? 0) + (owner ? fee + fanMoney(s.tickets, no, owner, conf) : 0);
  });
  run.order.forEach((no, i) => {
    const h = s.horses[no - 1]!;
    if (!h.ownerId) return;
    const top = (prizes[i] ?? 0) - (base[i] ?? 0);
    if (earned[i]! - top > 0) credits.push({ memberId: h.ownerId, amount: earned[i]! - top, reason: 'keiba_prize' });
    if (top > 0) credits.push({ memberId: h.ownerId, amount: top, reason: 'keiba_prize', cap: 'keiba_purse' });
  });
  s.prizes = prizes;
  // 名簿の馬の成績（1 走ずつ残して馬の成績ページに。馬主の馬はリーディングとお祝いにも使う）
  const winOdds = s.horses.map((h) => liveOdds(s.pools, 'win', String(h.no)).lo);
  const popular = [...s.horses].sort((a, b) => winOdds[a.no - 1]! - winOdds[b.no - 1]! || a.no - b.no).map((h) => h.no);
  const keiba: KeibaResult[] = run.order
    .map((no, i) => {
      const h = s.horses[no - 1]!;
      return {
        horseId: h.id,
        pos: i + 1,
        race: s.race.name,
        dist: s.race.dist,
        surface: s.race.surface,
        prize: earned[i]!,
        ownerId: h.ownerId,
        name: h.name,
        cls: s.race.cls,
        going: s.race.going,
        field: s.horses.length,
        no,
        pop: popular.indexOf(no) + 1,
        odds: winOdds[no - 1]!,
        time: run.times[i]!,
        margin: run.margins[i] ?? '',
        last3f: Math.round((run.last3f[i] ?? 0) * 10),
        corners: run.corners[i] ?? '',
      };
    })
    .filter((r) => r.horseId > 0);
  s.history = [{ n: s.race.n, name: s.race.name, order: run.order.slice(0, 3), win: s.final.win[1], names: run.order.slice(0, 3).map((no) => s.horses[no - 1]!.name) }, ...s.history].slice(0, 10);
  s.phase = 'result';
  s.resultAt = ctx.now;
  s.deadline = ctx.now + KB_RESULT_SECONDS * 1000;
  return ok(s, { credits, records, keiba, ...(keibaBets.length ? { keibaBets } : {}) });
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
  delete s.prizes;
  delete s.resultAt;
  s.phase = 'betting';
  s.deadline = ctx.now + s.window * 60_000;
  return s;
}

const okNo = (n: number) => Number.isInteger(n) && n >= 1 && n <= KB_HORSES;

/** 賭けた馬・組の書き方（"3" / "2-5" / 馬単 "5>2" / 3 連複 "1-2-5" / 3 連単 "5>1>2"）。nos は着順の順 */
export function ticketKey(t: KbBetType, ...nos: number[]): string | undefined {
  const use = nos.slice(0, picksOf(t));
  if (use.length < picksOf(t) || !use.every(okNo) || new Set(use).size !== use.length) return undefined;
  return picksOf(t) === 1 ? String(use[0]) : comboKey(t, use);
}

/**
 * 選んだ馬から馬券を作る。単勝・複勝は 1 頭ずつ、ほかは選んだ馬の組み合わせ全部（ボックス）。
 * 馬単・3 連単のボックスは順番ちがいも全部
 */
export function boxKeys(t: KbBetType, picks: number[]): (string | undefined)[] {
  const nos = [...new Set(picks)];
  if (!nos.length || !nos.every(okNo)) return [undefined];
  const k = picksOf(t);
  if (k === 1) return nos.map((n) => String(n));
  if (nos.length < k) return [undefined];
  const out = new Set<string>();
  const walk = (cur: number[]) => {
    if (cur.length === k) return void out.add(comboKey(t, cur));
    for (const n of nos) if (!cur.includes(n)) walk([...cur, n]);
  };
  walk([]);
  return [...out];
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
    const c = str(f, 'cls');
    const cls = c && /^[0-8]$/.test(c) ? Number(c) : null;
    const base = { title, dist, cls, seats: [seat(host, ctx.now)] };
    return ok({
      kind: 'keiba',
      hostId: host.id,
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
    if (a === 'bet' || a === 'bets') {
      if (s.phase !== 'betting' || s.deadline <= ctx.now) return fail('started');
      const t = str(f, 'type');
      if (!isKbBetType(t)) return fail('invalid');
      // bet: 1 枚（a・b・c）。bets: 選んだ馬（h）ごとに 1 枚・2 頭以上の賭け方は組み合わせ全部（ボックス）。
      // 馬単・3 連単の「着順どおり」（mode=order）は、押した順（seq）の 1 枚
      const order = isOrderedType(t) && str(f, 'mode') === 'order';
      const keys =
        a === 'bet'
          ? [ticketKey(t, Number(str(f, 'a')), Number(str(f, 'b')), Number(str(f, 'c')))]
          : order
            ? [((seq) => (seq.length === picksOf(t) ? ticketKey(t, ...seq) : undefined))((str(f, 'seq') ?? '').split(',').filter(Boolean).map(Number))]
            : boxKeys(t, list(f, 'h').map(Number));
      if (!keys.length || keys.some((k) => !k)) return fail('invalid');
      const amount = intOf(f, 'bet');
      const c = ctx.cfg.casino;
      if (!Number.isInteger(amount) || amount < c.minBet || amount > c.maxBet) return fail('bad_bet');
      const mine = s.tickets.filter((x) => x.memberId === id);
      const fresh = keys.filter((k) => !mine.some((x) => x.t === t && x.key === k));
      if (mine.length + fresh.length > KB_MAX_TICKETS) return fail('too_many');
      for (const key of keys as string[]) {
        const same = s.tickets.find((x) => x.memberId === id && x.t === t && x.key === key);
        if ((same?.amount ?? 0) + amount > c.maxBet) return fail('bad_bet');
        if (same) same.amount += amount;
        else s.tickets.push({ memberId: id, name: me.name, t, key, amount });
        addToPool(s.pools, t, key, amount);
      }
      const total = amount * keys.length;
      s.real += total;
      return ok(s, { debits: [{ memberId: id, amount: total, reason: 'casino_bet', limited: true }] });
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

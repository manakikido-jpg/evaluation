import { and, asc, eq, gte, sql } from 'drizzle-orm';
import type { GuildConfig } from '../../config.js';
import type { Db } from '../../db/client.js';
import { casinoGames, members, slotAtMachines, type CasinoGameRow } from '../../db/schema.js';
import { jstDate } from '../activity.js';
import { addCoins, spendWithin } from '../economy.js';
import { act, activeGame, checkBet, type Acted, type Played } from './casino.js';
import { cryptoRng, type Rng } from './cards.js';
import { atLookFor, atMult, atStopsFor, isOrder, newAtMachine, stepAt, type AtEvent, type AtMachine, type AtRole, type AtStep } from './slotAt.js';
import { dayPicks, pickSetting } from './slotFloor.js';
import { seatUntil } from './slotSeats.js';
import { atShow, type AtShow } from './slotAtShow.js';

/**
 * 🦊 AT 機の島（鬼斬り白狐）を遊ぶ。1 ゲーム = casino_games の 1 行（game = 'atslot'）。
 * 台の状態（回転数・前兆・AT）は slot_at_machines に残り、座っている人だけが回せる（AT_SEAT_MINUTES 回さなければ空く）。
 * AT 中の押し順ベルは、レバーのときはそろわない目で止めておき、押した順（order）を送ってから払う（ナビどおりなら 3 倍）
 */

export const AT_SEAT_MINUTES = 3;
const DAY_KEY = 'casino.atDay';

export const atMachineCount = (cfg: GuildConfig) => cfg.casino.atMachines.length;
export const validAtMachine = (cfg: GuildConfig, m: unknown): m is number => typeof m === 'number' && Number.isInteger(m) && m >= 1 && m <= atMachineCount(cfg);

/** 1 ゲームの記録（casino_games.state） */
export type AtGameState = {
  v: 1;
  machine: number;
  setting: number;
  role: AtRole;
  during: AtStep['during'];
  navi: number[] | null;
  events: AtEvent[];
  hint: number;
  /** 止まった目（押し順ベルを待っているあいだは、そろわない目） */
  stops: number[];
  /** 押し順ベルを待っている（AT 中） */
  waiting?: boolean;
  order?: number[];
  /** 押した順を送る前の目（そろえる動きに使う） */
  from?: number[];
  mult: number;
  /** このゲームのあとの台: 通常時のゲーム数・AT の残り・セット・継続率・AT の獲得 */
  games: number;
  phase: AtMachine['phase'];
  atLeft: number | null;
  atSet: number | null;
  atRate: number | null;
  atTokka: number;
  atWon: number | null;
  /** 回す前のチャンスゾーンの残りゲーム（CZ 中だけ） */
  czLeft?: number | null;
  /** 回す前の AT（液晶はレバーから止め終わりまでこちらを出す。上乗せを先に見せないように） */
  pre?: { left: number; set: number; rate: number; won: number; tokka: number } | null;
  /** 演出（見せ方だけ。古い記録にはない） */
  show?: AtShow;
};

/** 今日のその台の設定（おまかせは日替わり） */
export const atSetting = (db: Db, cfg: GuildConfig, machine: number, now: Date, rng: Rng) => pickSetting(db, cfg.casino.atMachines[machine - 1], DAY_KEY, machine, now, rng);
export const atDayPicks = (db: Db, now = new Date()) => dayPicks(db, now, DAY_KEY);

/** 台の今の状態（なければ新しい台）と、座っている人 */
export async function atMachineRows(db: Db, cfg: GuildConfig): Promise<{ machine: number; state: AtMachine; seatBy: string | null; seatAt: Date | null; seatName: string | null; seatAvatar: string | null; awayUntil: Date | null }[]> {
  const rows = await db.select({ m: slotAtMachines, name: members.displayName, avatar: members.avatarUrl }).from(slotAtMachines).leftJoin(members, eq(members.id, slotAtMachines.seatBy));
  return Array.from({ length: atMachineCount(cfg) }, (_, i) => {
    const r = rows.find((x) => x.m.machine === i + 1);
    return { machine: i + 1, state: (r?.m.state as AtMachine | undefined) ?? newAtMachine(), seatBy: r?.m.seatBy ?? null, seatAt: r?.m.seatAt ?? null, seatName: r?.name ?? null, seatAvatar: r?.avatar ?? null, awayUntil: r?.m.awayUntil ?? null };
  });
}

/** AT が続いているか（AT 中・AT が決まった前兆中）。このあいだは 1 日の上限で打ち切らない */
export const atContinues = (m: Pick<AtMachine, 'phase' | 'at'>) => m.phase === 'zenchou' || (m.phase === 'at' && m.at !== null);

/** だれかが座っているか（自分以外・AT_SEAT_MINUTES 以内に回した） */
export const seatTaken = (seatBy: string | null, seatAt: Date | null, me: string, now: Date, awayUntil: Date | null = null) => Boolean(seatBy && seatBy !== me && (seatUntil(seatAt, awayUntil)?.getTime() ?? 0) > now.getTime());

class Stop extends Error {
  constructor(readonly code: 'occupied' | 'poor') {
    super(code);
  }
}

export type AtPlayed = Played | { status: 'occupied' };

/** レバー: 1 ゲーム回す（賭けは島で決まった atBet） */
export async function playAt(db: Db, cfg: GuildConfig, memberId: string, machine: number, rng: Rng = cryptoRng, now = new Date()): Promise<AtPlayed> {
  if (!cfg.casino.atOpen) return { status: 'game_off' };
  if (!validAtMachine(cfg, machine)) return { status: 'bad_bet' };
  const busy = await activeGame(db, memberId, 'atslot');
  if (busy) return { status: 'busy', row: busy };
  const bet = cfg.casino.atBet;
  // AT 中（AT が決まった前兆中も）は、自分が座っている台なら 1 日の上限を見ない（AT が終わるまで回せる）
  const [cur] = await db.select().from(slotAtMachines).where(eq(slotAtMachines.machine, machine));
  const inAt = Boolean(cur && atContinues(cur.state as unknown as AtMachine) && !seatTaken(cur.seatBy, cur.seatAt, memberId, now, cur.awayUntil));
  // 賭けは島で決まっているので、ほかのゲームの最低・最高とは別
  const casino = { ...cfg.casino, minBet: Math.min(cfg.casino.minBet, bet), maxBet: Math.max(cfg.casino.maxBet, bet), ...(inAt ? { dailyBetLimit: 0 } : {}) };
  const check = await checkBet(db, { ...cfg, casino }, memberId, 'atslot', bet, now);
  if (check !== 'ok') return { status: check };
  const setting = await atSetting(db, cfg, machine, now, rng);
  try {
    const row = await db.transaction(async (tx) => {
      await tx.insert(slotAtMachines).values({ machine, state: newAtMachine() as unknown as Record<string, unknown> }).onConflictDoNothing();
      const [m] = await tx.select().from(slotAtMachines).where(eq(slotAtMachines.machine, machine)).for('update');
      if (seatTaken(m!.seatBy, m!.seatAt, memberId, now, m!.awayUntil)) throw new Stop('occupied');
      const { next, step } = stepAt(m!.state as unknown as AtMachine, setting, rng);
      const waiting = step.role === 'oshijun' && step.navi !== null;
      const lucky = step.role === 'oshijun' && !step.navi && rng(6) === 0;
      const mult = waiting ? 0 : atMult(step.role, { navi: step.navi, lucky });
      const stops = atStopsFor(atLookFor(step.role, mult > 0), rng);
      const prev = m!.state as unknown as AtMachine;
      const show = atShow(prev, step, next, rng);
      const payout = Math.floor(bet * mult);
      // AT の獲得（AT 中に払い戻した銭の合計。押し順ベルは押したあとに足す）
      if (next.at && !waiting && (step.during === 'at' || step.during === 'tokka')) next.at.won += payout;
      if (!(await spendWithin(tx, memberId, bet, 'casino_bet', { game: 'atslot' }))) throw new Stop('poor');
      const state: AtGameState = {
        v: 1,
        machine,
        setting,
        role: step.role,
        during: step.during,
        navi: step.navi,
        events: step.events,
        hint: step.hint,
        stops,
        ...(waiting ? { waiting: true } : {}),
        mult,
        games: next.games,
        phase: next.phase,
        atLeft: next.at?.left ?? null,
        atSet: next.at?.set ?? null,
        atRate: next.at?.rate ?? null,
        atTokka: next.at?.tokka ?? 0,
        atWon: next.at?.won ?? (step.events.find((e) => e.k === 'at_end') as { won: number } | undefined)?.won ?? null,
        czLeft: prev.phase === 'cz' ? (prev.cz?.left ?? null) : null,
        pre: prev.at ? { left: prev.at.left, set: prev.at.set, rate: prev.at.rate, won: prev.at.won, tokka: prev.at.tokka } : null,
        show,
      };
      const [r] = await tx
        .insert(casinoGames)
        .values({ memberId, game: 'atslot', bet, state, status: waiting ? 'playing' : 'done', payout: waiting ? 0 : payout, createdAt: now, finishedAt: waiting ? null : now })
        .returning();
      if (!waiting && payout > 0) await addCoins(tx, memberId, payout, 'casino_win', { game: 'atslot', id: r!.id });
      await tx
        .update(slotAtMachines)
        .set({ state: next as unknown as Record<string, unknown>, seatBy: memberId, seatAt: now, awayUntil: null, updatedAt: now })
        .where(eq(slotAtMachines.machine, machine));
      return r!;
    });
    return { status: 'ok', row };
  } catch (err) {
    if (err instanceof Stop) return { status: err.code };
    throw err;
  }
}

/** AT 中の押し順ベル: 押した順（左 0・中 1・右 2）を送る。'assist' はナビどおり */
export async function orderAt(db: Db, id: number, memberId: string, order: number[] | 'assist', rng: Rng = cryptoRng, now = new Date()): Promise<Acted> {
  const r = await act(
    db,
    id,
    memberId,
    (row) => {
      const s = row.state as AtGameState;
      if (s.v !== 1 || !s.waiting || !s.navi) return undefined;
      const pressed = order === 'assist' ? s.navi : order;
      if (!isOrder(pressed)) return undefined;
      const mult = atMult(s.role, { navi: s.navi, order: pressed });
      const payout = Math.floor(row.bet * mult);
      const stops = mult > 0 ? atStopsFor('bell', rng) : s.stops;
      const state: AtGameState = { ...s, waiting: false, order: pressed, mult, stops, from: s.stops, ...(s.atWon !== null ? { atWon: s.atWon + payout } : {}) };
      return { state, done: true, payout };
    },
    now,
  );
  // 台の AT の獲得にも足す（同じ AT のあいだだけ）
  if (r.status === 'ok' && r.row.payout > 0) {
    const s = r.row.state as AtGameState;
    await db
      .update(slotAtMachines)
      .set({ state: sql`case when ${slotAtMachines.state}->'at' is not null and ${slotAtMachines.state}->>'phase' = 'at' then jsonb_set(${slotAtMachines.state}, '{at,won}', to_jsonb((${slotAtMachines.state}->'at'->>'won')::int + ${r.row.payout})) else ${slotAtMachines.state} end` })
      .where(eq(slotAtMachines.machine, s.machine));
  }
  return r;
}

/** 席を立つ（自分が座っているときだけ。台の状態はそのまま残る） */
export async function leaveAt(db: Db, memberId: string, machine: number): Promise<void> {
  await db.update(slotAtMachines).set({ seatBy: null, seatAt: null, awayUntil: null }).where(and(eq(slotAtMachines.machine, machine), eq(slotAtMachines.seatBy, memberId)));
}

// ───────── 島のデータ ─────────

export type AtHit = { game: number; gap: number; sets: number; games: number; won: number; tenjou: boolean };
/** 1 台の 1 日分。since: 通常時のいまの回転数（台の状態から）・ats: AT の回数・slump: 1 ゲームごとの差枚 */
export type AtDay = { games: number; ats: number; maxWon: number; net: number; slump: number[]; history: AtHit[] };
const emptyDay = (): AtDay => ({ games: 0, ats: 0, maxWon: 0, net: 0, slump: [], history: [] });

/** 全部の台の今日と昨日のデータ（hide: 回したばかりでまだ止めていない回は、差枚に入れない） */
export async function atFloorData(db: Db, cfg: GuildConfig, now = new Date(), hide?: number): Promise<{ today: AtDay[]; yesterday: AtDay[] }> {
  const todayStart = new Date(`${jstDate(now)}T00:00:00+09:00`);
  const yStart = new Date(todayStart.getTime() - 86_400_000);
  const rows = await db
    .select({ id: casinoGames.id, at: casinoGames.createdAt, bet: casinoGames.bet, payout: casinoGames.payout, status: casinoGames.status, state: casinoGames.state })
    .from(casinoGames)
    .where(and(eq(casinoGames.game, 'atslot'), gte(casinoGames.createdAt, yStart)))
    .orderBy(asc(casinoGames.id));
  const n = atMachineCount(cfg);
  const today = Array.from({ length: n }, emptyDay);
  const yesterday = Array.from({ length: n }, emptyDay);
  const open = new Map<string, { start: number; gap: number; tenjou: boolean; won: number }>();
  const gaps = new Map<string, number>();
  for (const r of rows) {
    const s = r.state as AtGameState;
    const m = s?.machine;
    if (!Number.isInteger(m) || m < 1 || m > n) continue;
    const isToday = r.at >= todayStart;
    const d = (isToday ? today : yesterday)[m - 1]!;
    const key = `${isToday ? 't' : 'y'}${m}`;
    d.games++;
    if (s.during === 'normal' || s.during === 'zenchou' || s.during === 'cz') gaps.set(key, (gaps.get(key) ?? 0) + 1);
    if (r.id !== hide) {
      d.net += r.status === 'done' ? r.payout - r.bet : -r.bet;
      d.slump.push(d.net);
    }
    const run = open.get(key);
    if (run && (s.during === 'at' || s.during === 'tokka')) run.won += r.status === 'done' ? r.payout : 0;
    for (const e of s.events ?? []) {
      if (e.k === 'at_start') {
        d.ats++;
        open.set(key, { start: d.games, gap: gaps.get(key) ?? 0, tenjou: e.tenjou, won: 0 });
        gaps.set(key, 0);
      }
      if (e.k === 'at_end') {
        const o = open.get(key);
        const won = o?.won ?? 0;
        d.history.push({ game: o?.start ?? d.games, gap: o?.gap ?? 0, sets: e.sets, games: e.games, won, tenjou: o?.tenjou ?? false });
        d.maxWon = Math.max(d.maxWon, won);
        open.delete(key);
      }
    }
  }
  return { today, yesterday };
}

/** 自分が回している途中の 1 ゲーム（押し順ベルを待っている） */
export const waitingAt = (db: Db, memberId: string): Promise<CasinoGameRow | undefined> => activeGame(db, memberId, 'atslot');

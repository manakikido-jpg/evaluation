import { and, asc, eq, gte, sql } from 'drizzle-orm';
import type { GuildConfig } from '../../config.js';
import type { Db } from '../../db/client.js';
import { casinoGames, settings } from '../../db/schema.js';
import { jstDate } from '../activity.js';
import type { Rng } from './cards.js';
import { isSetting, randomSetting, type SlotSetting } from './slots.js';

/**
 * スロットの島（1 番台・2 番台…）。台ごとに設定（1〜6・おまかせ）があり、データ（回転数・BIG・REG・差枚）はみんなで見られる。
 * おまかせの台は、その日（日本時間）に最初に回されたときに設定を引いて覚える（設定は運営の画面でだけ見える）
 */

const DAY_KEY = 'casino.slotDay';
type DayPick = { date: string; settings: Record<string, number> };

export const machineCount = (cfg: GuildConfig) => cfg.casino.slotMachines.length;
export const validMachine = (cfg: GuildConfig, m: unknown): m is number => typeof m === 'number' && Number.isInteger(m) && m >= 1 && m <= machineCount(cfg);

/** その日のおまかせの設定（まだ引いていなければ undefined） */
export async function dayPicks(db: Db, now = new Date(), dayKey = DAY_KEY): Promise<Record<string, number>> {
  const [row] = await db.select().from(settings).where(eq(settings.key, dayKey));
  const v = row?.value as DayPick | undefined;
  return v && v.date === jstDate(now) ? v.settings : {};
}

/** 台の今日の設定。決めてある台はそのまま、おまかせの台はその日に 1 回だけ引く（同時に回しても 1 つに決まる） */
export function machineSetting(db: Db, cfg: GuildConfig, machine: number, now: Date, rng: Rng): Promise<SlotSetting> {
  return pickSetting(db, cfg.casino.slotMachines[machine - 1], DAY_KEY, machine, now, rng);
}

/** 島ごとの台の今日の設定（conf: 決めた設定か random・dayKey: おまかせを覚えておく所） */
export async function pickSetting(db: Db, conf: number | 'random' | undefined, dayKey: string, machine: number, now: Date, rng: Rng): Promise<SlotSetting> {
  if (isSetting(conf)) return conf;
  const day = jstDate(now);
  const pick = randomSetting(rng);
  const m = String(machine);
  const fresh = { date: day, settings: { [m]: pick } };
  const [row] = await db
    .insert(settings)
    .values({ key: dayKey, value: fresh, updatedBy: 'system', updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: {
        value: sql`case when ${settings.value}->>'date' = ${day}
          then jsonb_set(${settings.value}, ${`{settings,${m}}`}::text[], coalesce(${settings.value}->'settings'->${m}, to_jsonb(${pick}::int)))
          else ${JSON.stringify(fresh)}::jsonb end`,
        updatedAt: now,
      },
    })
    .returning();
  const got = (row?.value as DayPick | undefined)?.settings?.[m];
  return isSetting(got) ? got : pick;
}

export type BonusHit = { game: number; kind: 'big' | 'reg'; gap: number };
/** 1 台の 1 日分のデータ。slump: 1 回ごとの差枚（銭）の合計 */
export type MachineDay = { games: number; big: number; reg: number; since: number; net: number; history: BonusHit[]; slump: number[] };
const emptyDay = (): MachineDay => ({ games: 0, big: 0, reg: 0, since: 0, net: 0, history: [], slump: [] });

/**
 * 全部の台の今日と昨日のデータ。hide: 回したばかりで、まだ止めていない回（回転数には入れるが、当たり・差枚には入れない）
 */
export async function slotFloorData(db: Db, cfg: GuildConfig, now = new Date(), hide?: number): Promise<{ today: MachineDay[]; yesterday: MachineDay[] }> {
  const todayStart = new Date(`${jstDate(now)}T00:00:00+09:00`);
  const yStart = new Date(todayStart.getTime() - 86_400_000);
  const rows = await db
    .select({
      id: casinoGames.id,
      at: casinoGames.createdAt,
      bet: casinoGames.bet,
      payout: casinoGames.payout,
      status: casinoGames.status,
      machine: sql<string | null>`${casinoGames.state}->>'machine'`,
      role: sql<string | null>`${casinoGames.state}->>'role'`,
    })
    .from(casinoGames)
    .where(and(eq(casinoGames.game, 'slots'), gte(casinoGames.createdAt, yStart)))
    .orderBy(asc(casinoGames.id));
  const n = machineCount(cfg);
  const today = Array.from({ length: n }, emptyDay);
  const yesterday = Array.from({ length: n }, emptyDay);
  for (const r of rows) {
    const m = Number(r.machine);
    if (!Number.isInteger(m) || m < 1 || m > n) continue;
    const d = (r.at >= todayStart ? today : yesterday)[m - 1]!;
    d.games++;
    d.since++;
    if (r.id === hide) continue;
    // 持ち越し中のボーナスは、そろうまで当たりに数えない（賭けた分だけ引く）
    d.net += r.status === 'done' ? r.payout - r.bet : -r.bet;
    d.slump.push(d.net);
    if (r.status === 'done' && (r.role === 'big' || r.role === 'reg')) {
      d[r.role]++;
      d.history.push({ game: d.games, kind: r.role, gap: d.since });
      d.since = 0;
    }
  }
  return { today, yesterday };
}

/** 合成確率の分母（1/x の x。当たりがなければ null） */
export const combinedOdds = (d: MachineDay) => (d.big + d.reg > 0 ? d.games / (d.big + d.reg) : null);

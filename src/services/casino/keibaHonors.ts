import { and, eq, inArray, lte } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { keibaEntries, keibaHorses } from '../../db/schema.js';

/**
 * 🏆 称号・殿堂・⚔ 宿敵。出走の記録（keiba_entries）から計算するだけ（銭は動かない）。
 * クラスの番号は KB_CLASSES と同じ（6 = G3・7 = G2・8 = G1）
 */

const G1 = 8;
const GRADED = 6;
/** 殿堂入り: G1 を何勝（引退した馬は 1 勝でも） */
export const HALL_G1_WINS = 2;
/** 宿敵: 同じ 2 頭が 1・2 着を何回争ったら */
export const RIVAL_MIN = 3;

type Run = { cls: number; pos: number };

/** 馬の称号（強いものから） */
export function horseTitles(runs: readonly Run[], retired = false): string[] {
  const starts = runs.length;
  const wins = runs.filter((r) => r.pos === 1).length;
  const g1 = runs.filter((r) => r.pos === 1 && r.cls === G1).length;
  const graded = runs.filter((r) => r.pos === 1 && r.cls >= GRADED).length;
  const out: string[] = [];
  if (isHall(g1, retired)) out.push('🏛 殿堂入り');
  if (g1 >= 2) out.push(`👑 G1 ${g1} 勝`);
  else if (g1 === 1) out.push('👑 G1 馬');
  if (graded >= 3) out.push(`🎖 重賞 ${graded} 勝`);
  if (starts >= 5 && wins === starts) out.push(`✨ ${starts} 戦 ${wins} 勝・無敗`);
  if (starts >= 100) out.push('🛡 100 戦の鉄人');
  else if (starts >= 50) out.push('🛡 50 戦の古馬');
  return out;
}

export const isHall = (g1Wins: number, retired: boolean) => g1Wins >= HALL_G1_WINS || (retired && g1Wins >= 1);

/** 殿堂の馬（G1 の勝ちが多い順） */
export async function hallOfFame(db: Db): Promise<{ id: number; name: string; ownerId: string | null; g1: number; starts: number; wins: number; prize: number; retired: boolean }[]> {
  const g1Wins = await db
    .select({ horseId: keibaEntries.horseId })
    .from(keibaEntries)
    .where(and(eq(keibaEntries.cls, G1), eq(keibaEntries.pos, 1)));
  const count = new Map<number, number>();
  for (const r of g1Wins) count.set(r.horseId, (count.get(r.horseId) ?? 0) + 1);
  if (!count.size) return [];
  const horses = await db.select().from(keibaHorses).where(inArray(keibaHorses.id, [...count.keys()]));
  return horses
    .map((h) => ({ id: h.id, name: h.name, ownerId: h.ownerId, g1: count.get(h.id) ?? 0, starts: h.starts, wins: h.wins, prize: h.prize, retired: h.retiredAt !== null }))
    .filter((h) => isHall(h.g1, h.retired))
    .sort((a, b) => b.g1 - a.g1 || b.wins - a.wins || a.id - b.id);
}

export type Rival = { id: number; name: string; meets: number; ahead: number; behind: number };

/** レース 1 つの見分け方（同じ名前・同じ時刻） */
const raceKey = (r: { race: string; at: Date }) => `${r.at.getTime()}|${r.race}`;

/** 1・2 着を争った組（horseIds のどれかが入っているレースだけ見る） */
async function topPairs(db: Db, horseIds: readonly number[]) {
  if (!horseIds.length) return [];
  const mine = await db
    .select({ race: keibaEntries.race, at: keibaEntries.at })
    .from(keibaEntries)
    .where(and(inArray(keibaEntries.horseId, [...horseIds]), lte(keibaEntries.pos, 2)));
  if (!mine.length) return [];
  const keys = new Set(mine.map(raceKey));
  const ats = [...new Set(mine.map((r) => r.at.getTime()))].map((t) => new Date(t));
  const rows = await db
    .select({ horseId: keibaEntries.horseId, horseName: keibaEntries.horseName, pos: keibaEntries.pos, race: keibaEntries.race, at: keibaEntries.at })
    .from(keibaEntries)
    .where(and(inArray(keibaEntries.at, ats), lte(keibaEntries.pos, 2)));
  const byRace = new Map<string, typeof rows>();
  for (const r of rows) if (keys.has(raceKey(r))) byRace.set(raceKey(r), [...(byRace.get(raceKey(r)) ?? []), r]);
  return [...byRace.values()].filter((x) => x.length === 2);
}

/** その馬の宿敵（1・2 着を RIVAL_MIN 回以上争った馬。多い順） */
export async function rivalsOf(db: Db, horseId: number): Promise<Rival[]> {
  const m = new Map<number, Rival>();
  for (const [a, b] of await topPairs(db, [horseId])) {
    const me = a!.horseId === horseId ? a! : b!;
    const them = me === a ? b! : a!;
    if (them.horseId === horseId) continue;
    const r = m.get(them.horseId) ?? { id: them.horseId, name: them.horseName, meets: 0, ahead: 0, behind: 0 };
    r.meets++;
    if (me.pos < them.pos) r.ahead++;
    else r.behind++;
    m.set(them.horseId, r);
  }
  return [...m.values()].filter((r) => r.meets >= RIVAL_MIN).sort((a, b) => b.meets - a.meets || a.id - b.id);
}

/** 出走表の中の宿敵の組（因縁の対決） */
export async function rivalPairsAmong(db: Db, horseIds: readonly number[]): Promise<[number, number][]> {
  const ids = new Set(horseIds);
  const count = new Map<string, number>();
  for (const [a, b] of await topPairs(db, horseIds)) {
    if (!ids.has(a!.horseId) || !ids.has(b!.horseId)) continue;
    const k = [a!.horseId, b!.horseId].sort((x, y) => x - y).join('-');
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  return [...count.entries()].filter(([, n]) => n >= RIVAL_MIN).map(([k]) => k.split('-').map(Number) as [number, number]);
}

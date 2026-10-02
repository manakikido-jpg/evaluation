import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { keibaHorses, type KeibaHorseRow } from '../../db/schema.js';
import { cryptoRng } from './cards.js';
import { newStable, seeded, type KbStable } from './keiba.js';
import type { KeibaResult } from './tables/types.js';

/**
 * 🏇 競馬の名簿。レースの 8 頭はここから選ぶ。走るたびに成績（○戦○勝・最近のレース）がたまる。
 * 名前は運営が社務所Web でつけ直せる。足りなければ BOT が新しい馬を入れる（名前はあとから変えられる）
 */

/** 走れる馬がこれより少なければ、新しい馬を入れる */
export const KB_ROSTER_MIN = 16;
export const KB_NAME_MAX = 18;

const toStable = (r: KeibaHorseRow): KbStable => ({
  id: r.id,
  name: r.name,
  style: r.style,
  spd: r.spd / 1000,
  sta: r.sta / 1000,
  apt: r.apt,
  surf: r.surf,
  coat: r.coat,
  silk: r.silk,
  starts: r.starts,
  wins: r.wins,
  seconds: r.seconds,
  thirds: r.thirds,
  recent: r.recent,
});

export async function listHorses(db: Db): Promise<KeibaHorseRow[]> {
  return db.select().from(keibaHorses).orderBy(sql`${keibaHorses.retiredAt} is not null`, asc(keibaHorses.id));
}

const activeRows = (db: Db) => db.select().from(keibaHorses).where(isNull(keibaHorses.retiredAt)).orderBy(asc(keibaHorses.id));

/** 新しい馬を入れる（name がなければおまかせの名前） */
export async function addHorse(db: Db, name?: string, rand: () => number = seeded(cryptoRng(2 ** 31))): Promise<KeibaHorseRow | undefined> {
  const taken = new Set((await activeRows(db)).map((h) => h.name));
  const clean = name ? cleanName(name) : undefined;
  if (name !== undefined && (!clean || taken.has(clean))) return undefined;
  const h = newStable(rand, taken);
  const [row] = await db
    .insert(keibaHorses)
    .values({ name: clean ?? h.name, style: h.style, spd: Math.round(h.spd * 1000), sta: Math.round(h.sta * 1000), apt: h.apt, surf: h.surf, coat: h.coat, silk: h.silk })
    .returning();
  return row;
}

/** 走れる馬（足りなければ入れてから） */
export async function loadRoster(db: Db): Promise<KbStable[]> {
  let rows = await activeRows(db);
  if (rows.length < KB_ROSTER_MIN) {
    const rand = seeded(cryptoRng(2 ** 31));
    for (let i = rows.length; i < KB_ROSTER_MIN; i++) await addHorse(db, undefined, rand);
    rows = await activeRows(db);
  }
  return rows.map(toStable);
}

/** 名前の決まり: 前後の空白を取り、1〜18 文字 */
export function cleanName(raw: string): string | undefined {
  const s = raw.replace(/\s+/g, ' ').trim();
  return s.length >= 1 && [...s].length <= KB_NAME_MAX ? s : undefined;
}

export async function renameHorse(db: Db, id: number, raw: string): Promise<'ok' | 'invalid' | 'taken' | 'not_found'> {
  const name = cleanName(raw);
  if (!name) return 'invalid';
  const [same] = await db.select({ id: keibaHorses.id }).from(keibaHorses).where(and(eq(keibaHorses.name, name), isNull(keibaHorses.retiredAt)));
  if (same && same.id !== id) return 'taken';
  const r = await db.update(keibaHorses).set({ name }).where(eq(keibaHorses.id, id)).returning({ id: keibaHorses.id });
  return r.length ? 'ok' : 'not_found';
}

/** 引退させる・戻す */
export async function setRetired(db: Db, id: number, retired: boolean, now = new Date()): Promise<boolean> {
  if (!retired) {
    // 戻すとき、同じ名前の馬が走っていたら戻さない（先にどちらかの名前を変える）
    const [h] = await db.select({ name: keibaHorses.name }).from(keibaHorses).where(eq(keibaHorses.id, id));
    if (!h) return false;
    const [same] = await db.select({ id: keibaHorses.id }).from(keibaHorses).where(and(eq(keibaHorses.name, h.name), isNull(keibaHorses.retiredAt)));
    if (same && same.id !== id) return false;
  }
  const r = await db
    .update(keibaHorses)
    .set({ retiredAt: retired ? now : null })
    .where(eq(keibaHorses.id, id))
    .returning({ id: keibaHorses.id });
  return r.length > 0;
}

/** レースが終わったら、名簿の馬の成績を足す */
export async function applyKeibaResults(tx: Db, rows: readonly KeibaResult[]): Promise<void> {
  for (const r of rows) {
    const [h] = await tx.select().from(keibaHorses).where(eq(keibaHorses.id, r.horseId)).for('update');
    if (!h) continue;
    await tx
      .update(keibaHorses)
      .set({
        starts: h.starts + 1,
        wins: h.wins + (r.pos === 1 ? 1 : 0),
        seconds: h.seconds + (r.pos === 2 ? 1 : 0),
        thirds: h.thirds + (r.pos === 3 ? 1 : 0),
        recent: [{ pos: r.pos, race: r.race, dist: r.dist, surface: r.surface }, ...h.recent].slice(0, 5),
      })
      .where(eq(keibaHorses.id, h.id));
  }
}

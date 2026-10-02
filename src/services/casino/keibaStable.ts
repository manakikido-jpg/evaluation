import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { keibaHorses, members, type KeibaHorseRow } from '../../db/schema.js';
import { spendWithin } from '../economy.js';
import { cryptoRng } from './cards.js';
import { newStable, seeded, type KbStable } from './keiba.js';
import type { KeibaResult } from './tables/types.js';

/**
 * 🏇 競馬の名簿。レースの 8 頭はここから選ぶ。走るたびに成績（○戦○勝・最近のレース）がたまる。
 * 名前は運営が社務所Web でつけ直せる。足りなければ BOT が新しい馬を入れる（名前はあとから変えられる）
 */

/** 走れる馬がこれより少なければ、新しい馬を入れる（クラスごとに分かれるので多めに） */
export const KB_ROSTER_MIN = 24;
export const KB_NAME_MAX = 18;

const toStable = (r: KeibaHorseRow & { ownerName?: string | null }): KbStable => ({
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
  ownerId: r.ownerId,
  ownerName: r.ownerName ?? null,
  prize: r.prize,
  sex: r.sex,
  age: r.age,
  weight: r.weight,
});

export async function listHorses(db: Db): Promise<KeibaHorseRow[]> {
  return db.select().from(keibaHorses).orderBy(sql`${keibaHorses.retiredAt} is not null`, asc(keibaHorses.id));
}

const activeRows = (db: Db) => db.select().from(keibaHorses).where(isNull(keibaHorses.retiredAt)).orderBy(asc(keibaHorses.id));
/** 走れる馬と、馬主の名前 */
const activeWithOwners = (db: Db) =>
  db
    .select({ h: keibaHorses, ownerName: members.displayName })
    .from(keibaHorses)
    .leftJoin(members, eq(members.id, keibaHorses.ownerId))
    .where(isNull(keibaHorses.retiredAt))
    .orderBy(asc(keibaHorses.id));

/** 新しい馬を入れる（name がなければおまかせの名前。ownerId があればその人の馬） */
export async function addHorse(db: Db, name?: string, rand: () => number = seeded(cryptoRng(2 ** 31)), ownerId?: string): Promise<KeibaHorseRow | undefined> {
  const taken = new Set((await activeRows(db)).map((h) => h.name));
  const clean = name ? cleanName(name) : undefined;
  if (name !== undefined && (!clean || taken.has(clean))) return undefined;
  const h = newStable(rand, taken);
  const [row] = await db
    .insert(keibaHorses)
    .values({
      name: clean ?? h.name,
      style: h.style,
      spd: Math.round(h.spd * 1000),
      sta: Math.round(h.sta * 1000),
      apt: h.apt,
      surf: h.surf,
      coat: h.coat,
      silk: h.silk,
      sex: h.sex,
      age: h.age,
      weight: h.weight,
      ownerId: ownerId ?? null,
    })
    .returning();
  return row;
}

// ───────── 🐴 馬主 ─────────

/** その人の馬（引退した馬も。走っている馬が先） */
export async function myHorses(db: Db, memberId: string): Promise<KeibaHorseRow[]> {
  return db
    .select()
    .from(keibaHorses)
    .where(eq(keibaHorses.ownerId, memberId))
    .orderBy(sql`${keibaHorses.retiredAt} is not null`, asc(keibaHorses.id));
}

export type BuyResult = { status: 'ok'; horse: KeibaHorseRow } | { status: 'invalid' | 'taken' | 'too_many' | 'poor' | 'off' };

/**
 * 馬を買って馬主になる（デビュー前の馬。名前は買った人がつける）。払った銭は胴元へ。持てるのは max 頭まで（引退した馬は数えない）
 */
export async function buyHorse(db: Db, memberId: string, rawName: string, price: number, max: number): Promise<BuyResult> {
  if (price <= 0 || max <= 0) return { status: 'off' };
  const name = cleanName(rawName);
  if (!name) return { status: 'invalid' };
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'keiba_owner:' + memberId}))`);
    const [{ n } = { n: 0 }] = await tx
      .select({ n: count() })
      .from(keibaHorses)
      .where(and(eq(keibaHorses.ownerId, memberId), isNull(keibaHorses.retiredAt)));
    if (n >= max) return { status: 'too_many' as const };
    const [same] = await tx.select({ id: keibaHorses.id }).from(keibaHorses).where(and(eq(keibaHorses.name, name), isNull(keibaHorses.retiredAt)));
    if (same) return { status: 'taken' as const };
    if (!(await spendWithin(tx, memberId, price, 'keiba_buy', { name }))) return { status: 'poor' as const };
    const horse = await addHorse(tx, name, undefined, memberId);
    return horse ? { status: 'ok' as const, horse } : { status: 'taken' as const };
  });
}

/** 馬主が名前をつけ直す（デビュー前だけ） */
export async function nameOwnHorse(db: Db, memberId: string, id: number, raw: string): Promise<'ok' | 'invalid' | 'taken' | 'not_found' | 'debuted'> {
  const [h] = await db.select().from(keibaHorses).where(and(eq(keibaHorses.id, id), eq(keibaHorses.ownerId, memberId)));
  if (!h || h.retiredAt) return 'not_found';
  if (h.starts > 0) return 'debuted';
  return renameHorse(db, id, raw);
}

/** 馬主が引退させる（もう走らない。銭は戻らない） */
export async function retireOwnHorse(db: Db, memberId: string, id: number, now = new Date()): Promise<boolean> {
  const r = await db
    .update(keibaHorses)
    .set({ retiredAt: now })
    .where(and(eq(keibaHorses.id, id), eq(keibaHorses.ownerId, memberId), isNull(keibaHorses.retiredAt)))
    .returning({ id: keibaHorses.id });
  return r.length > 0;
}

/** 走れる馬（足りなければ入れてから） */
export async function loadRoster(db: Db): Promise<KbStable[]> {
  const have = (await activeRows(db)).length;
  if (have < KB_ROSTER_MIN) {
    const rand = seeded(cryptoRng(2 ** 31));
    for (let i = have; i < KB_ROSTER_MIN; i++) await addHorse(db, undefined, rand);
  }
  return (await activeWithOwners(db)).map((r) => toStable({ ...r.h, ownerName: r.ownerName }));
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
        prize: h.prize + (r.prize ?? 0),
        // 10 走ごとに 1 つ年をとる
        age: (h.starts + 1) % 10 === 0 ? h.age + 1 : h.age,
      })
      .where(eq(keibaHorses.id, h.id));
  }
}

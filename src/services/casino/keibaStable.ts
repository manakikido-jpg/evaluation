import { development, trained, inherited, isTraining, type TrainingKind } from './keibaDevelopment.js';
import { hasCoOwners, payByShares, sharesOf } from './keibaShares.js';
import { rivalPairsAmong } from './keibaHonors.js';
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { isOutfit, KB_AURAS, KB_AURA_PRICE, KB_CUSTOM_AURA_PRICE, isAuraColor, KB_DEFAULT_OUTFIT, type KbAura, type KbAuraKey, type KbOutfit } from './keibaOutfit.js';
import type { Db } from '../../db/client.js';
import { keibaEntries, keibaHorses, keibaOwners, keibaRuns, members, type KeibaHorseRow } from '../../db/schema.js';
import { addCoins, spendWithin } from '../economy.js';
import { cryptoRng } from './cards.js';
import { fatigueNow, KB_FATIGUE_REST, KB_FATIGUE_RUN, newStable, seeded, type KbSilk, type KbStable } from './keiba.js';
import type { KeibaResult } from './tables/types.js';

/**
 * 🏇 競馬の名簿。レースの 8 頭はここから選ぶ。走るたびに成績（○戦○勝・最近のレース）がたまる。
 * 名前は運営が社務所Web でつけ直せる。足りなければ BOT が新しい馬を入れる（名前はあとから変えられる）
 */

/** 走れる馬がこれより少なければ、新しい馬を入れる（クラスごとに分かれるので多めに） */
export const KB_ROSTER_MIN = 24;
export const KB_NAME_MAX = 18;

const toStable = (r: KeibaHorseRow & { ownerName?: string | null; sire?: string | null }, now = new Date()): KbStable => ({
  id: r.id,
  name: r.name,
  style: r.style,
  spd: r.spd / 1000,
  sta: r.sta / 1000,
  apt: r.apt,
  surf: r.surf,
  coat: r.coat,
  silk: r.silk,
  outfit: r.outfit,
  development: r.development,
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
  fatigue: fatigueNow(r.fatigue, r.fatigueAt, now),
  trainBoost: r.trainBoost,
  sire: r.sire ?? null,
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

/** 馬主本人だけが装備を変更する。引退した馬も着せ替えられる。 */
export async function dressOwnHorse(db: Db, memberId: string, id: number, input: unknown): Promise<'ok' | 'invalid' | 'not_found'> {
  if (!isOutfit(input)) return 'invalid';
  const outfit: KbOutfit = { cloth: input.cloth, bridle: input.bridle, hood: input.hood, ornament: input.ornament };
  return db.transaction(async tx => {
    const [horse] = await tx.select().from(keibaHorses).where(and(eq(keibaHorses.id, id), eq(keibaHorses.ownerId, memberId))).for('update');
    if (!horse) return 'not_found';
    // 有料の色・購入済み情報はフォームから受け取らず、保存済みの値を引き継ぐ。
    await tx.update(keibaHorses).set({ outfit: { ...horse.outfit, ...outfit } }).where(eq(keibaHorses.id, id));
    return 'ok';
  });
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
    if (!horse) return { status: 'taken' as const };
    const silk = await ownerSilk(tx, memberId);
    if (silk) await tx.update(keibaHorses).set({ silk }).where(eq(keibaHorses.id, horse.id));
    return { status: 'ok' as const, horse: silk ? { ...horse, silk } : horse };
  });
}

/** 馬主が名前をつけ直す（デビュー前だけ） */
export async function nameOwnHorse(db: Db, memberId: string, id: number, raw: string): Promise<'ok' | 'invalid' | 'taken' | 'not_found' | 'debuted'> {
  const [h] = await db.select().from(keibaHorses).where(and(eq(keibaHorses.id, id), eq(keibaHorses.ownerId, memberId)));
  if (!h || h.retiredAt) return 'not_found';
  if (h.starts > 0) return 'debuted';
  return renameHorse(db, id, raw);
}

/** 功労金: 1 勝につき perWin（重賞の勝ちは 3 倍） */
export async function retireBonusOf(db: Db, horseId: number, wins: number, perWin: number): Promise<number> {
  if (perWin <= 0 || wins <= 0) return 0;
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(keibaEntries)
    .where(and(eq(keibaEntries.horseId, horseId), eq(keibaEntries.pos, 1), gte(keibaEntries.cls, 6)));
  return perWin * (wins + 2 * Math.min(n, wins));
}
async function payRetireBonus(tx: Db, memberId: string, h: { id: number; wins: number; name: string }, perWin: number): Promise<number> {
  const bonus = await retireBonusOf(tx, h.id, h.wins, perWin);
  // 🤝 共同所有なら口の数で分ける
  if (bonus > 0) await payByShares(tx, h.id, memberId, bonus, 'keiba_prize', { retire: h.id, name: h.name });
  return bonus;
}

/** 馬主が引退させる（もう走らない。勝っていれば功労金が出る。いくら出たかを返す・引退できなければ false） */
export async function retireOwnHorse(db: Db, memberId: string, id: number, now = new Date(), perWin = 0): Promise<number | false> {
  return db.transaction(async (tx) => {
    const r = await tx
      .update(keibaHorses)
      .set({ retiredAt: now })
      .where(and(eq(keibaHorses.id, id), eq(keibaHorses.ownerId, memberId), isNull(keibaHorses.retiredAt)))
      .returning({ id: keibaHorses.id, wins: keibaHorses.wins, name: keibaHorses.name });
    if (!r[0]) return false;
    return payRetireBonus(tx, memberId, r[0], perWin);
  });
}

/** 走れる馬（足りなければ入れてから）。放牧中・疲れすぎの馬は出さない */
export async function loadRoster(db: Db, now = new Date()): Promise<KbStable[]> {
  const have = (await activeRows(db)).length;
  if (have < KB_ROSTER_MIN) {
    const rand = seeded(cryptoRng(2 ** 31));
    for (let i = have; i < KB_ROSTER_MIN; i++) await addHorse(db, undefined, rand);
  }
  const rows = await activeWithOwners(db);
  const parentIds = [...new Set(rows.map((r) => r.h.parentId).filter((x): x is number => x !== null))];
  const parents = parentIds.length ? new Map((await db.select({ id: keibaHorses.id, name: keibaHorses.name }).from(keibaHorses).where(inArray(keibaHorses.id, parentIds))).map((p) => [p.id, p.name])) : new Map<number, string>();
  // ⚔ 宿敵（出馬表に「因縁の対決」を出す）
  const rivals = new Map<number, number[]>();
  for (const [a, b] of await rivalPairsAmong(db, rows.map((r) => r.h.id))) {
    rivals.set(a, [...(rivals.get(a) ?? []), b]);
    rivals.set(b, [...(rivals.get(b) ?? []), a]);
  }
  const shares = await sharesOf(db, rows.map((r) => r.h.id));
  return rows
    .map((r) => ({ ...(shares.has(r.h.id) ? { shares: shares.get(r.h.id) } : {}), ...toStable({ ...r.h, ownerName: r.ownerName, sire: r.h.parentId ? (parents.get(r.h.parentId) ?? null) : null }, now), ...(rivals.has(r.h.id) ? { rivals: rivals.get(r.h.id) } : {}) }))
    .filter((h, i) => !(rows[i]!.h.restUntil && rows[i]!.h.restUntil! > now) && (h.fatigue ?? 0) < KB_FATIGUE_REST);
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

/** レースが終わったら、名簿の馬の成績を足す（疲れがたまり、調教の上乗せは使い切る）。馬主の馬は 1 走ずつ記録 */
export async function applyKeibaResults(tx: Db, rows: readonly KeibaResult[], now = new Date(), royaltyPct = 0): Promise<void> {
  for (const r of rows) {
    const [h] = await tx.select().from(keibaHorses).where(eq(keibaHorses.id, r.horseId)).for('update');
    if (!h) continue;
    // 🧬 血統ロイヤリティ: 産駒が稼いだら、親の馬主にも（胴元が出す）
    // 配合で生まれた馬は、父と母の馬主で半分ずつ
    const royalty = h.parentId && r.ownerId ? Math.floor(((r.prize ?? 0) * royaltyPct) / 100) : 0;
    if (royalty > 0) {
      const parents = h.damId ? [h.parentId!, h.damId] : [h.parentId!];
      const share = Math.floor(royalty / parents.length);
      for (const pid of parents) {
        const [parent] = await tx.select({ ownerId: keibaHorses.ownerId, name: keibaHorses.name }).from(keibaHorses).where(eq(keibaHorses.id, pid));
        if (parent?.ownerId && share > 0) await payByShares(tx, pid, parent.ownerId, share, 'keiba_prize', { royalty: h.id, foal: h.name, parent: parent.name });
      }
    }
    if (r.ownerId) await tx.insert(keibaRuns).values({ tableId:r.tableId, horseId: h.id, horseName: r.name ?? h.name, ownerId: r.ownerId, pos: r.pos, prize: r.prize ?? 0, cls: r.cls ?? 0, race: r.race, at: now });
    if (r.time !== undefined)
      await tx.insert(keibaEntries).values({
        tableId: r.tableId,
        horseId: h.id,
        horseName: r.name ?? h.name,
        ownerId: r.ownerId ?? null,
        race: r.race,
        cls: r.cls ?? 0,
        dist: r.dist,
        surface: r.surface,
        going: r.going ?? 0,
        field: r.field ?? 8,
        no: r.no ?? 0,
        pop: r.pop ?? 0,
        odds: r.odds ?? 0,
        pos: r.pos,
        time: r.time,
        margin: r.margin ?? '',
        last3f: r.last3f ?? 0,
        corners: r.corners ?? '',
        prize: r.prize ?? 0,
        at: now,
      });
    await tx
      .update(keibaHorses)
      .set({
        fatigue: Math.min(100, fatigueNow(h.fatigue, h.fatigueAt, now) + KB_FATIGUE_RUN),
        fatigueAt: now,
        trainBoost: 0,
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

// ───────── 🐴 馬主のうれしいこと ─────────

/** 勝負服に使える色 */
export const KB_SILK_COLORS = ['#e53935', '#1e63d6', '#f4c430', '#2e9e4f', '#ffffff', '#222222', '#8e44ad', '#f08a24', '#f48fb1', '#00a6a6', '#8b1a1a', '#0b3d91', '#f7f7f2', '#c53046', '#d4af37', '#232936', '#728c69', '#b580c9', '#efa9be'] as const;
export const isSilk = (v: { base?: unknown; accent?: unknown; pattern?: unknown }): v is KbSilk =>
  (KB_SILK_COLORS as readonly unknown[]).includes(v.base) && (KB_SILK_COLORS as readonly unknown[]).includes(v.accent) && Number.isInteger(v.pattern) && (v.pattern as number) >= 0 && (v.pattern as number) <= 5;

export async function ownerSilk(db: Db, memberId: string): Promise<KbSilk | undefined> {
  const [o] = await db.select().from(keibaOwners).where(eq(keibaOwners.memberId, memberId));
  return o?.silk;
}

/** 勝負服を決める（その人の馬はみんなこの服になる） */
export async function setOwnerSilk(db: Db, memberId: string, silk: KbSilk): Promise<void> {
  await db.insert(keibaOwners).values({ memberId, silk }).onConflictDoUpdate({ target: keibaOwners.memberId, set: { silk, updatedAt: new Date() } });
  await db.update(keibaHorses).set({ silk }).where(eq(keibaHorses.ownerId, memberId));
}

/** 調教の決まり: 1 頭 6 時間に 1 回。次のレースの調子が 1 つ上がり、速さが少し伸びる（1.02 まで）。疲れが 15 たまる */
export const KB_TRAIN_COOLDOWN_H = 6;
export const KB_TRAIN_FATIGUE = 15;
const SPD_CAP = 1020;

export async function trainHorse(db: Db, memberId: string, id: number, price: number, now = new Date(), kind: TrainingKind = 'speed'): Promise<'ok' | 'not_found' | 'cooldown' | 'poor' | 'off' | 'resting' | 'invalid'> {
  if (!isTraining(kind)) return 'invalid';
  if (price <= 0) return 'off';
  return db.transaction(async (tx) => {
    const [h] = await tx.select().from(keibaHorses).where(and(eq(keibaHorses.id, id), eq(keibaHorses.ownerId, memberId), isNull(keibaHorses.retiredAt))).for('update');
    if (!h) return 'not_found' as const;
    if (h.restUntil && h.restUntil > now) return 'resting' as const;
    if (h.trainedAt && now.getTime() - h.trainedAt.getTime() < KB_TRAIN_COOLDOWN_H * 3_600_000) return 'cooldown' as const;
    if (!(await spendWithin(tx, memberId, price, 'keiba_train', { horse: id, kind }))) return 'poor' as const;
    await tx
      .update(keibaHorses)
      .set({
        trainBoost: 1,
        trainedAt: now,
        spd: kind === 'speed' ? Math.min(SPD_CAP, h.spd + 2) : h.spd,
        sta: kind === 'stamina' ? Math.min(1200, h.sta + 2) : h.sta,
        development: trained(development(h.development), kind, price, now),
        fatigue: Math.min(100, fatigueNow(h.fatigue, h.fatigueAt, now) + KB_TRAIN_FATIGUE),
        fatigueAt: now,
      })
      .where(eq(keibaHorses.id, id));
    return 'ok' as const;
  });
}

/** 放牧: 1 時間走らない代わりに、疲れがすっかり抜ける */
export async function restHorse(db: Db, memberId: string, id: number, now = new Date()): Promise<boolean> {
  return db.transaction(async tx=>{
    const [h]=await tx.select().from(keibaHorses).where(and(eq(keibaHorses.id,id),eq(keibaHorses.ownerId,memberId),isNull(keibaHorses.retiredAt))).for('update');
    if(!h)return false;
    if(h.restUntil&&h.restUntil>now)return true;
    await tx.update(keibaHorses).set({restUntil:new Date(now.getTime()+3_600_000),fatigue:0,fatigueAt:now,development:trained(development(h.development),'rest',0,now)}).where(eq(keibaHorses.id,id));return true;
  });
}

// ───────── 売り買い ─────────

/** 売るときに胴元へ払う手数料（%） */
export const KB_SALE_FEE = 5;

/** 売りに出す（price）・取り下げる（null） */
export async function setSale(db: Db, memberId: string, id: number, price: number | null): Promise<boolean> {
  if (price !== null && !(Number.isInteger(price) && price >= 100 && price <= 10_000_000)) return false;
  // 🤝 口をほかの人も持っている馬は売れない（一口の募集中も）
  if (price !== null && (await hasCoOwners(db, id))) return false;
  const r = await db
    .update(keibaHorses)
    .set({ salePrice: price })
    .where(and(eq(keibaHorses.id, id), eq(keibaHorses.ownerId, memberId), isNull(keibaHorses.retiredAt)))
    .returning({ id: keibaHorses.id });
  return r.length > 0;
}

/** 売りに出ている馬（馬主の名前つき） */
export async function horsesForSale(db: Db): Promise<(KeibaHorseRow & { ownerName: string | null })[]> {
  const rows = await db
    .select({ h: keibaHorses, ownerName: members.displayName })
    .from(keibaHorses)
    .leftJoin(members, eq(members.id, keibaHorses.ownerId))
    .where(and(isNotNull(keibaHorses.salePrice), isNull(keibaHorses.retiredAt), isNotNull(keibaHorses.ownerId)))
    .orderBy(asc(keibaHorses.salePrice));
  return rows.map((r) => ({ ...r.h, ownerName: r.ownerName }));
}

/** ほかの馬主から買う。買う人が払い、売る人は手数料を引いた分を受け取る */
export async function buyFromOwner(db: Db, buyerId: string, id: number, max: number): Promise<'ok' | 'not_found' | 'self' | 'too_many' | 'poor'> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'keiba_owner:' + buyerId}))`);
    const [h] = await tx.select().from(keibaHorses).where(and(eq(keibaHorses.id, id), isNull(keibaHorses.retiredAt), isNotNull(keibaHorses.salePrice))).for('update');
    if (!h || !h.ownerId || h.salePrice === null) return 'not_found' as const;
    if (h.ownerId === buyerId) return 'self' as const;
    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(keibaHorses).where(and(eq(keibaHorses.ownerId, buyerId), isNull(keibaHorses.retiredAt)));
    if (n >= max) return 'too_many' as const;
    const price = h.salePrice;
    if (!(await spendWithin(tx, buyerId, price, 'keiba_trade', { horse: id, from: h.ownerId }))) return 'poor' as const;
    const toSeller = price - Math.floor((price * KB_SALE_FEE) / 100);
    if (toSeller > 0) await addCoins(tx, h.ownerId, toSeller, 'keiba_trade', { horse: id, to: buyerId });
    const silk = await ownerSilk(tx, buyerId);
    await tx
      .update(keibaHorses)
      .set({ ownerId: buyerId, salePrice: null, ...(silk ? { silk } : {}) })
      .where(eq(keibaHorses.id, id));
    return 'ok' as const;
  });
}

// ───────── 繁殖と産駒 ─────────

/** 1 頭の繁殖馬から迎えられる産駒の数 */
export const KB_FOALS_MAX = 3;

/** 引退させる。1 勝以上していれば繁殖入り（breed）もできる */
export async function retireToBreed(db: Db, memberId: string, id: number, now = new Date(), perWin = 0): Promise<'ok' | 'not_found' | 'no_wins' | 'gelding'> {
  return db.transaction(async (tx) => {
    const [h] = await tx.select().from(keibaHorses).where(and(eq(keibaHorses.id, id), eq(keibaHorses.ownerId, memberId), isNull(keibaHorses.retiredAt))).for('update');
    if (!h) return 'not_found' as const;
    if (h.wins < 1) return 'no_wins' as const;
    // セン馬は繁殖に入れない
    if (h.sex === 2) return 'gelding' as const;
    await tx.update(keibaHorses).set({ retiredAt: now, breeding: true, salePrice: null }).where(eq(keibaHorses.id, id));
    await payRetireBonus(tx, memberId, h, perWin);
    return 'ok' as const;
  });
}

/** 産駒の数（配合で生まれた馬は母・父の両方で数える。前の仕組みの親も） */
export async function foalsOf(db: Db, parentId: number): Promise<number> {
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(keibaHorses).where(or(eq(keibaHorses.parentId, parentId), eq(keibaHorses.damId, parentId)));
  return n;
}

/** 母なしで迎えた産駒の数（前の仕組みの産駒・種牡馬だけで迎えた産駒。ほかの馬主の母との配合は数えない） */
export async function soloFoalsOf(db: Db, sireId: number): Promise<number> {
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(keibaHorses).where(and(eq(keibaHorses.parentId, sireId), isNull(keibaHorses.damId)));
  return n;
}

/** 母 1 頭から迎えられる産駒の数 */
async function foalsOfDam(db: Db, damId: number): Promise<number> {
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(keibaHorses).where(or(eq(keibaHorses.damId, damId), and(eq(keibaHorses.parentId, damId), isNull(keibaHorses.damId))));
  return n;
}

/** 種付け料の上限 */
export const KB_STUD_FEE_MAX = 5000;
/** 子の速さ・スタミナの当たり外れ（親の平均から ±） */
export const KB_FOAL_SPD_SWING = 8;
export const KB_FOAL_STA_SWING = 50;

/** 種牡馬の種付け料を決める（自分の繁殖入りした牡馬） */
export async function setStudFee(db: Db, memberId: string, id: number, fee: number): Promise<boolean> {
  if (!Number.isInteger(fee) || fee < 0 || fee > KB_STUD_FEE_MAX) return false;
  const rows = await db
    .update(keibaHorses)
    .set({ studFee: fee })
    .where(and(eq(keibaHorses.id, id), eq(keibaHorses.ownerId, memberId), eq(keibaHorses.breeding, true), eq(keibaHorses.sex, 0)))
    .returning({ id: keibaHorses.id });
  return rows.length > 0;
}

export type StudRow = { id: number; name: string; ownerId: string | null; ownerName: string | null; fee: number; wins: number; starts: number; foals: number; foalWins: number };

/** 種牡馬の一覧（繁殖入りした牡馬。産駒の勝ちが多い順） */
export async function studList(db: Db): Promise<StudRow[]> {
  const rows = await db
    .select({ h: keibaHorses, ownerName: members.displayName })
    .from(keibaHorses)
    .leftJoin(members, eq(members.id, keibaHorses.ownerId))
    .where(and(eq(keibaHorses.breeding, true), eq(keibaHorses.sex, 0)));
  if (!rows.length) return [];
  const kids = await db
    .select({ parentId: keibaHorses.parentId, wins: keibaHorses.wins })
    .from(keibaHorses)
    .where(inArray(keibaHorses.parentId, rows.map((r) => r.h.id)));
  return rows
    .map((r) => {
      const mine = kids.filter((k) => k.parentId === r.h.id);
      return { id: r.h.id, name: r.h.name, ownerId: r.h.ownerId, ownerName: r.ownerName, fee: r.h.studFee, wins: r.h.wins, starts: r.h.starts, foals: mine.length, foalWins: mine.reduce((n, k) => n + k.wins, 0) };
    })
    .sort((a, b) => b.foalWins - a.foalWins || b.wins - a.wins || a.id - b.id);
}

/**
 * 🧬 配合して産駒を迎える。母は自分の繁殖牝馬、父は繁殖入りした牡馬（だれの馬でも。ほかの人の馬なら種付け料をその馬主へ）。
 * 速さ・スタミナは父母の平均に当たり外れ、脚質・得意な距離・馬場・毛色はどちらかの親から（ときどき新しく）
 */
export async function breedFoal(
  db: Db,
  memberId: string,
  damId: number,
  sireId: number,
  rawName: string,
  price: number,
  max: number,
  rand: () => number = seeded(cryptoRng(2 ** 31)),
): Promise<BuyResult | { status: 'not_found' | 'no_foals' | 'no_sire' }> {
  const name = cleanName(rawName);
  if (!name) return { status: 'invalid' };
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'keiba_owner:' + memberId}))`);
    // 父と母に同じ馬: 自分の種牡馬だけで迎える（母なし。前の仕組みの産駒も数えて 3 頭まで）
    const solo = sireId === damId;
    const [dam] = await tx.select().from(keibaHorses).where(and(eq(keibaHorses.id, damId), eq(keibaHorses.ownerId, memberId), eq(keibaHorses.breeding, true), eq(keibaHorses.sex, solo ? 0 : 1)));
    if (!dam) return { status: 'not_found' as const };
    if (solo && (await soloFoalsOf(tx, damId)) >= KB_FOALS_MAX) return { status: 'no_foals' as const };
    // sireId 0: 種牡馬が 1 頭もいないときだけ、母だけで迎える（前の仕組み）
    const studs = await tx.select({ id: keibaHorses.id }).from(keibaHorses).where(and(eq(keibaHorses.breeding, true), eq(keibaHorses.sex, 0))).limit(1);
    const [found] = sireId === 0 || solo ? [] : await tx.select().from(keibaHorses).where(and(eq(keibaHorses.id, sireId), eq(keibaHorses.breeding, true), eq(keibaHorses.sex, 0)));
    if (!solo && !found && (sireId !== 0 || studs.length)) return { status: 'no_sire' as const };
    const sire = found ?? { ...dam, ownerId: null, studFee: 0 };
    if (!solo && (await foalsOfDam(tx, damId)) >= KB_FOALS_MAX) return { status: 'no_foals' as const };
    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(keibaHorses).where(and(eq(keibaHorses.ownerId, memberId), isNull(keibaHorses.retiredAt)));
    if (n >= max) return { status: 'too_many' as const };
    const [same] = await tx.select({ id: keibaHorses.id }).from(keibaHorses).where(and(eq(keibaHorses.name, name), isNull(keibaHorses.retiredAt)));
    if (same) return { status: 'taken' as const };
    const fee = sire.ownerId && sire.ownerId !== memberId ? sire.studFee : 0;
    if (price + fee > 0 && !(await spendWithin(tx, memberId, price + fee, 'keiba_buy', { name, sire: sireId, dam: damId, fee }))) return { status: 'poor' as const };
    if (fee > 0) await addCoins(tx, sire.ownerId!, fee, 'keiba_stud', { sire: sire.name, foal: name, by: memberId });
    const kid = newStable(rand, new Set<string>([name]));
    const swing = (w: number) => Math.round((rand() * 2 - 1) * w);
    const either = <T>(a: T, b: T, fresh: T) => (rand() < 0.1 ? fresh : rand() < 0.5 ? a : b);
    const silk = (await ownerSilk(tx, memberId)) ?? dam.silk;
    const [row] = await tx
      .insert(keibaHorses)
      .values({
        name,
        style: either(sire.style, dam.style, kid.style),
        spd: Math.min(SPD_CAP, Math.max(970, Math.round((sire.spd + dam.spd) / 2) + swing(KB_FOAL_SPD_SWING))),
        sta: Math.min(1200, Math.max(850, Math.round((sire.sta + dam.sta) / 2) + swing(KB_FOAL_STA_SWING))),
        apt: either(sire.apt, dam.apt, kid.apt),
        surf: either(sire.surf, dam.surf, kid.surf),
        coat: either(sire.coat, dam.coat, kid.coat),
        silk,
        sex: kid.sex,
        age: 2,
        weight: Math.round((sire.weight + dam.weight) / 2),
        ownerId: memberId,
        development: inherited(sire.development, solo ? undefined : dam.development),
        parentId: found || solo ? sireId : null,
        damId: solo ? null : damId,
      })
      .returning();
    return { status: 'ok' as const, horse: row! };
  });
}

// ───────── リーディングオーナー・お祝い・ロール ─────────

export type LeadingRow = { ownerId: string; name: string; prize: number; wins: number; runs: number };

/** リーディングオーナー（since から。獲得賞金が多い順 → 勝ち数） */
export async function leadingOwners(db: Db, since: Date, limit = 10): Promise<LeadingRow[]> {
  const rows = await db
    .select({
      ownerId: keibaRuns.ownerId,
      prize: sql<number>`coalesce(sum(${keibaRuns.prize}), 0)::int`,
      wins: sql<number>`count(*) filter (where ${keibaRuns.pos} = 1)::int`,
      runs: sql<number>`count(*)::int`,
    })
    .from(keibaRuns)
    .where(gte(keibaRuns.at, since))
    .groupBy(keibaRuns.ownerId)
    .orderBy(desc(sql`coalesce(sum(${keibaRuns.prize}), 0)`), desc(sql`count(*) filter (where ${keibaRuns.pos} = 1)`))
    .limit(limit);
  if (!rows.length) return [];
  const names = new Map((await db.select({ id: members.id, name: members.displayName }).from(members).where(inArray(members.id, rows.map((r) => r.ownerId)))).map((m) => [m.id, m.name]));
  return rows.map((r) => ({ ...r, name: names.get(r.ownerId) ?? r.ownerId }));
}

/** まだ Discord に流していない、馬主の馬の勝ち */
export async function pendingWins(db: Db, limit = 10) {
  return db
    .select()
    .from(keibaRuns)
    .where(and(eq(keibaRuns.pos, 1), isNull(keibaRuns.announcedAt)))
    .orderBy(asc(keibaRuns.id))
    .limit(limit);
}

export async function markAnnounced(db: Db, id: number, now = new Date()): Promise<void> {
  await db.update(keibaRuns).set({ announcedAt: now }).where(eq(keibaRuns.id, id));
}

/** 🐴 馬主ロールを付ける人（走れる馬を持っている人）・🏆 G1 馬主ロールを付ける人（G1 を勝ったことがある人） */
export async function ownerRoleTargets(db: Db): Promise<{ owners: Set<string>; g1: Set<string> }> {
  const owners = await db.selectDistinct({ id: keibaHorses.ownerId }).from(keibaHorses).where(and(isNotNull(keibaHorses.ownerId), isNull(keibaHorses.retiredAt)));
  const g1 = await db.selectDistinct({ id: keibaRuns.ownerId }).from(keibaRuns).where(and(eq(keibaRuns.pos, 1), eq(keibaRuns.cls, 8)));
  return { owners: new Set(owners.map((r) => r.id!)), g1: new Set(g1.map((r) => r.id)) };
}


/** オーラの購入・装備。馬ごとに固定色を所持し、カスタムは変更ごとに支払う。 */
export async function buyHorseAura(db: Db, memberId: string, id: number, input: { key: string; body?: string; glow?: string; revision: number }): Promise<'ok' | 'invalid' | 'not_found' | 'poor' | 'aura_stale'> {
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) return 'invalid';
  if (input.key !== 'none' && input.key !== 'custom' && !Object.hasOwn(KB_AURAS, input.key)) return 'invalid';
  if (input.key === 'custom' && (!isAuraColor(input.body) || !isAuraColor(input.glow))) return 'invalid';
  return db.transaction(async tx => {
    const [horse] = await tx.select().from(keibaHorses).where(and(eq(keibaHorses.id, id), eq(keibaHorses.ownerId, memberId))).for('update');
    if (!horse) return 'not_found';
    const outfit = horse.outfit ?? KB_DEFAULT_OUTFIT;
    if ((outfit.auraRevision ?? 0) !== input.revision) return 'aura_stale';
    const owned = outfit.auraOwned ?? [];
    const fixed = Object.hasOwn(KB_AURAS, input.key) ? input.key as KbAuraKey : undefined;
    const aura: KbAura | null = input.key === 'none' ? null : fixed
      ? { key: fixed, body: KB_AURAS[fixed].body, glow: KB_AURAS[fixed].glow }
      : { key: 'custom', body: input.body!.toLowerCase(), glow: input.glow!.toLowerCase() };
    // 同じ色のまま押し直しても課金しない。
    if ((!outfit.aura && !aura) || (outfit.aura && aura && outfit.aura.key === aura.key && outfit.aura.body === aura.body && outfit.aura.glow === aura.glow)) return 'ok';
    const price = !aura ? 0 : fixed ? owned.includes(fixed) ? 0 : KB_AURA_PRICE : KB_CUSTOM_AURA_PRICE;
    if (price && !await spendWithin(tx, memberId, price, 'keiba_aura', { horseId: id, aura })) return 'poor';
    await tx.update(keibaHorses).set({ outfit: { ...outfit, aura, auraOwned: fixed ? [...new Set([...owned, fixed])] : owned, auraRevision: input.revision + 1 } }).where(eq(keibaHorses.id, id));
    return 'ok';
  });
}

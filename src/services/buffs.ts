import { and, eq, gt, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { memberBuffs, nameDecos, type NameDeco } from '../db/schema.js';
import { addTickets, useTicket } from './tickets.js';

/**
 * 使うと効く札（物御籤の「🎟 券を使う」から）:
 * 🧧 福の札（24 時間、通話の銭 2 倍）・🍀 運気アップの札（次の 10 回、物御籤の大吉 2 倍）・💝 贈り券・🏷 名前の飾り札。
 */

const HOUR = 3_600_000;
export const FUKU_HOURS = 24;
export const LUCK_DRAWS = 10;
export const NAME_DECO_DAYS = 7;

export type Buffs = { fukuUntil?: Date; luck: number; deco?: NameDeco; /** 🎰 大勝負の札が効いている間 */ casinoUntil?: Date };

export async function buffsOf(db: Db, memberId: string, now = new Date()): Promise<Buffs> {
  const rows = await db.select().from(memberBuffs).where(eq(memberBuffs.memberId, memberId));
  const fuku = rows.find((r) => r.kind === 'fuku');
  const luck = rows.find((r) => r.kind === 'luck');
  const casino = rows.find((r) => r.kind === 'casino');
  const [deco] = await db.select().from(nameDecos).where(eq(nameDecos.memberId, memberId));
  return {
    ...(fuku?.until && fuku.until > now ? { fukuUntil: fuku.until } : {}),
    luck: luck?.remaining ?? 0,
    ...(casino?.until && casino.until > now ? { casinoUntil: casino.until } : {}),
    ...(deco && deco.until > now ? { deco } : {}),
  };
}

/** 福の札が効いているか（通話の銭 2 倍） */
export async function fukuActive(db: Db, memberId: string, now = new Date()): Promise<boolean> {
  const [row] = await db
    .select({ until: memberBuffs.until })
    .from(memberBuffs)
    .where(and(eq(memberBuffs.memberId, memberId), eq(memberBuffs.kind, 'fuku'), gt(memberBuffs.until, now)));
  return Boolean(row);
}

/** 🧧 福の札を使う（効いている間に使うと、今の終わりから 24 時間のばす） */
export async function useFuku(db: Db, memberId: string, now = new Date()): Promise<{ status: 'ok'; until: Date } | { status: 'no_ticket' }> {
  return db.transaction(async (tx) => {
    if (!(await useTicket(tx, memberId, 'fuku'))) return { status: 'no_ticket' as const };
    const [row] = await tx.select().from(memberBuffs).where(and(eq(memberBuffs.memberId, memberId), eq(memberBuffs.kind, 'fuku')));
    const from = row?.until && row.until > now ? row.until : now;
    const until = new Date(from.getTime() + FUKU_HOURS * HOUR);
    await tx
      .insert(memberBuffs)
      .values({ memberId, kind: 'fuku', until })
      .onConflictDoUpdate({ target: [memberBuffs.memberId, memberBuffs.kind], set: { until } });
    return { status: 'ok' as const, until };
  });
}

/** 🍀 運気アップの札を使う（次の 10 回。重ねて使うと足す） */
export async function useLuck(db: Db, memberId: string): Promise<{ status: 'ok'; remaining: number } | { status: 'no_ticket' }> {
  return db.transaction(async (tx) => {
    if (!(await useTicket(tx, memberId, 'luck'))) return { status: 'no_ticket' as const };
    const [row] = await tx
      .insert(memberBuffs)
      .values({ memberId, kind: 'luck', remaining: LUCK_DRAWS })
      .onConflictDoUpdate({ target: [memberBuffs.memberId, memberBuffs.kind], set: { remaining: sql`${memberBuffs.remaining} + ${LUCK_DRAWS}` } })
      .returning({ remaining: memberBuffs.remaining });
    return { status: 'ok' as const, remaining: row!.remaining };
  });
}

/** 物御籤を 1 回引いたとき: 運気アップが残っていれば 1 回減らして true（引く処理のトランザクションの中で） */
export async function takeLuck(tx: Db, memberId: string): Promise<boolean> {
  const rows = await tx
    .update(memberBuffs)
    .set({ remaining: sql`${memberBuffs.remaining} - 1` })
    .where(and(eq(memberBuffs.memberId, memberId), eq(memberBuffs.kind, 'luck'), gt(memberBuffs.remaining, 0)))
    .returning({ remaining: memberBuffs.remaining });
  return rows.length > 0;
}

/** 💝 贈り券を使う: 相手に「物御籤の無料券」を 1 枚 */
export async function giftGacha(db: Db, fromId: string, toId: string): Promise<'ok' | 'no_ticket' | 'self'> {
  if (fromId === toId) return 'self';
  return db.transaction(async (tx) => {
    if (!(await useTicket(tx, fromId, 'gacha_gift'))) return 'no_ticket' as const;
    await addTickets(tx, toId, 'gacha_free', 1);
    return 'ok' as const;
  });
}

/** 名前の飾りに使える絵文字か（1 文字の絵文字。記号・空白・メンションはだめ） */
export function validDecoEmoji(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 16 || /[\s@#:<>`*_~|\\]/.test(t)) return false;
  const chars = [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(t)];
  return chars.length === 1 && /\p{Extended_Pictographic}/u.test(t);
}

/** 飾った名前（32 文字まで） */
export const decoratedNick = (emoji: string, base: string) => `${emoji} ${base}`.slice(0, 32);

/**
 * 🏷 名前の飾り札を使う。飾っている間に使うと、絵文字を替えて 7 日のばす（元の名前はそのまま覚えておく）。
 * baseNick: いまのニックネーム（飾っている最中なら使わない）
 */
export async function startNameDeco(
  db: Db,
  memberId: string,
  emoji: string,
  baseNick: string | null,
  now = new Date(),
): Promise<{ status: 'ok'; until: Date; baseNick: string | null } | { status: 'no_ticket' }> {
  return db.transaction(async (tx) => {
    if (!(await useTicket(tx, memberId, 'name_deco'))) return { status: 'no_ticket' as const };
    const [row] = await tx.select().from(nameDecos).where(eq(nameDecos.memberId, memberId));
    const active = row && row.until > now;
    const base = active ? row.baseNick : baseNick;
    const until = new Date((active ? row.until : now).getTime() + NAME_DECO_DAYS * 24 * HOUR);
    await tx
      .insert(nameDecos)
      .values({ memberId, emoji, baseNick: base, until })
      .onConflictDoUpdate({ target: nameDecos.memberId, set: { emoji, baseNick: base, until } });
    return { status: 'ok' as const, until, baseNick: base };
  });
}

/** ニックネームを変えられなかったとき: 記録を戻して、券を返す */
export async function cancelNameDeco(db: Db, memberId: string, previous: NameDeco | undefined): Promise<void> {
  await db.transaction(async (tx) => {
    if (previous) await tx.insert(nameDecos).values(previous).onConflictDoUpdate({ target: nameDecos.memberId, set: previous });
    else await tx.delete(nameDecos).where(eq(nameDecos.memberId, memberId));
    await addTickets(tx, memberId, 'name_deco', 1);
  });
}

export async function nameDecoOf(db: Db, memberId: string): Promise<NameDeco | undefined> {
  const [row] = await db.select().from(nameDecos).where(eq(nameDecos.memberId, memberId));
  return row;
}

/** 期限が来た名前の飾り（戻したら endNameDeco） */
export async function dueNameDecos(db: Db, now = new Date()): Promise<NameDeco[]> {
  return db.select().from(nameDecos).where(lte(nameDecos.until, now));
}

export async function endNameDeco(db: Db, memberId: string): Promise<void> {
  await db.delete(nameDecos).where(eq(nameDecos.memberId, memberId));
}

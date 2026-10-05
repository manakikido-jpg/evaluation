import { and, asc, count, eq, isNull, lte, sql } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { otoshidamaBags, otoshidamaClaims, type OtoshidamaBag, type OtoshidamaClaim } from '../db/schema.js';
import { autoRanks, currentAutoRank } from '../domain/ranks.js';
import { addCoins, spendWithin, walletOf } from './economy.js';

/**
 * 🧧 お年玉袋（授与品）: 買った人が銭を入れた袋をチャンネルに置き、先着の人がボタンで受け取る。
 * 1 人ずつの量は置いたときに運で決める（合わせると入れた量ちょうど）。受け取れるのは 1 人 1 回・入鯖が承認された人だけ。
 * 期限（24 時間）が来たら、残りは置いた人に戻す。
 */

export const OTOSHIDAMA = { minTotal: 100, maxTotal: 10_000, minCount: 2, maxCount: 20, hours: 24 } as const;

type Rand = () => number;

/** 入れた量を count 人分に分ける（1 人 1 枚以上。多い・少ないは運しだい） */
export function splitShares(total: number, count: number, rand: Rand = Math.random): number[] {
  const weights = Array.from({ length: count }, () => 0.2 + rand());
  const sum = weights.reduce((a, b) => a + b, 0);
  const rest = total - count;
  const shares = weights.map((w) => 1 + Math.floor((rest * w) / sum));
  for (let left = total - shares.reduce((a, b) => a + b, 0); left > 0; left--) shares[Math.min(count - 1, Math.floor(rand() * count))]!++;
  return shares;
}

async function lock(tx: Db, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
}

export type PutResult =
  | { status: 'ok'; bag: OtoshidamaBag; balance: number }
  | { status: 'rank_too_low'; rankName: string }
  | { status: 'bad_amount' }
  | { status: 'insufficient'; need: number; balance: number };

/** 読みやすい数（全角・カンマ・「枚」も読む） */
export function parseCount(raw: string): number {
  const t = raw.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[,，\s枚人]/g, '');
  return /^\d+$/.test(t) ? Number(t) : NaN;
}

/**
 * 袋を置く（入れる量と手数料を払って、袋を作る）。投稿は呼び出し側。
 * サブアカウントで集めた銭を流せないよう、置けるのは 2 段目の役職（氏子）以上か運営。
 */
export async function putBag(
  db: Db,
  cfg: GuildConfig,
  input: { ownerId: string; roleIds: readonly string[]; channelId: string; total: number; count: number; note: string; fee: number; itemId: number; itemName: string },
  now = new Date(),
  rand: Rand = Math.random,
): Promise<PutResult> {
  const [first, second] = autoRanks(cfg.ranks);
  const current = currentAutoRank(cfg.ranks, input.roleIds);
  const isStaff = cfg.ranks.some((r) => !r.auto && input.roleIds.includes(r.roleId));
  if (second && !isStaff && (!current || current.key === first?.key)) return { status: 'rank_too_low', rankName: second.name };
  const { total, count } = input;
  const o = OTOSHIDAMA;
  if (!Number.isInteger(total) || !Number.isInteger(count) || total < o.minTotal || total > o.maxTotal || count < o.minCount || count > o.maxCount || total < count) {
    return { status: 'bad_amount' };
  }
  const need = total + input.fee;
  return db.transaction(async (tx) => {
    await lock(tx, `shop:${input.ownerId}`);
    const balance = (await walletOf(tx, input.ownerId)).balance;
    if (balance < need) return { status: 'insufficient' as const, need, balance };
    await spendWithin(tx, input.ownerId, total, 'otoshidama_put', { channelId: input.channelId, count });
    if (input.fee > 0) await spendWithin(tx, input.ownerId, input.fee, 'shop', { itemId: input.itemId, name: input.itemName });
    const [bag] = await tx
      .insert(otoshidamaBags)
      .values({
        ownerId: input.ownerId,
        channelId: input.channelId,
        total,
        count,
        shares: splitShares(total, count, rand),
        note: input.note.replace(/\s+/g, ' ').trim().slice(0, 60),
        createdAt: now,
        expiresAt: new Date(now.getTime() + o.hours * 3_600_000),
      })
      .returning();
    return { status: 'ok' as const, bag: bag!, balance: (await walletOf(tx, input.ownerId)).balance };
  });
}

/** 投稿できなかったとき: 袋を消して、入れた量と手数料を戻す */
export async function undoBag(db: Db, bag: OtoshidamaBag, fee: number): Promise<void> {
  await db.transaction(async (tx) => {
    const gone = await tx.delete(otoshidamaBags).where(eq(otoshidamaBags.id, bag.id)).returning({ id: otoshidamaBags.id });
    if (!gone.length) return;
    await addCoins(tx, bag.ownerId, bag.total, 'otoshidama_refund', { bag: bag.id });
    if (fee > 0) await addCoins(tx, bag.ownerId, fee, 'shop_refund', { bag: bag.id });
  });
}

export async function setBagMessage(db: Db, id: number, messageId: string): Promise<void> {
  await db.update(otoshidamaBags).set({ messageId }).where(eq(otoshidamaBags.id, id));
}

export type ClaimResult =
  | { status: 'ok'; amount: number; order: number; left: number; bag: OtoshidamaBag }
  | { status: 'gone' | 'ended' | 'own' | 'already' | 'not_member' };

/** ボタンを押した: 次の 1 人分を受け取る */
export async function claimBag(db: Db, cfg: GuildConfig, bagId: number, member: { id: string; roleIds: readonly string[]; bot?: boolean }, now = new Date()): Promise<ClaimResult> {
  if (member.bot || !cfg.ranks.some((r) => member.roleIds.includes(r.roleId))) return { status: 'not_member' };
  return db.transaction(async (tx) => {
    await lock(tx, `otoshidama:${bagId}`);
    const [bag] = await tx.select().from(otoshidamaBags).where(eq(otoshidamaBags.id, bagId));
    if (!bag) return { status: 'gone' as const };
    if (bag.ownerId === member.id) return { status: 'own' as const };
    if (bag.endedAt || bag.expiresAt <= now) return { status: 'ended' as const };
    const [mine] = await tx.select().from(otoshidamaClaims).where(and(eq(otoshidamaClaims.bagId, bagId), eq(otoshidamaClaims.memberId, member.id)));
    if (mine) return { status: 'already' as const };
    const [row] = await tx.select({ n: count() }).from(otoshidamaClaims).where(eq(otoshidamaClaims.bagId, bagId));
    const n = Number(row?.n ?? 0);
    const amount = bag.shares[n];
    if (n >= bag.count || amount === undefined) return { status: 'ended' as const };
    await tx.insert(otoshidamaClaims).values({ bagId, memberId: member.id, amount, at: now });
    await addCoins(tx, member.id, amount, 'otoshidama_get', { bag: bagId, from: bag.ownerId });
    const done = n + 1 >= bag.count;
    if (done) await tx.update(otoshidamaBags).set({ endedAt: now }).where(eq(otoshidamaBags.id, bagId));
    return { status: 'ok' as const, amount, order: n + 1, left: bag.count - n - 1, bag: done ? { ...bag, endedAt: now } : bag };
  });
}

export async function bagState(db: Db, id: number): Promise<{ bag: OtoshidamaBag; claims: OtoshidamaClaim[] } | undefined> {
  const [bag] = await db.select().from(otoshidamaBags).where(eq(otoshidamaBags.id, id));
  if (!bag) return undefined;
  const claims = await db.select().from(otoshidamaClaims).where(eq(otoshidamaClaims.bagId, id)).orderBy(asc(otoshidamaClaims.at));
  return { bag, claims };
}

/** 期限が来た袋: 残りを置いた人に戻して閉じる。閉じた袋を返す（メッセージを書き換える用） */
export async function expireBags(db: Db, now = new Date()): Promise<OtoshidamaBag[]> {
  const due = await db
    .select()
    .from(otoshidamaBags)
    .where(and(isNull(otoshidamaBags.endedAt), lte(otoshidamaBags.expiresAt, now)));
  const out: OtoshidamaBag[] = [];
  for (const b of due) {
    const closed = await db.transaction(async (tx) => {
      await lock(tx, `otoshidama:${b.id}`);
      const [bag] = await tx.select().from(otoshidamaBags).where(eq(otoshidamaBags.id, b.id));
      if (!bag || bag.endedAt) return undefined;
      const [row] = await tx.select({ sum: sql<number>`coalesce(sum(${otoshidamaClaims.amount}), 0)::int` }).from(otoshidamaClaims).where(eq(otoshidamaClaims.bagId, b.id));
      const left = bag.total - Number(row?.sum ?? 0);
      if (left > 0) await addCoins(tx, bag.ownerId, left, 'otoshidama_refund', { bag: bag.id });
      const [u] = await tx.update(otoshidamaBags).set({ endedAt: now, refunded: Math.max(0, left) }).where(eq(otoshidamaBags.id, bag.id)).returning();
      return u;
    });
    if (closed) out.push(closed);
  }
  return out;
}

// ───────── 見た目 ─────────

export type BagView = { embeds: { title: string; description: string; color: number }[]; components: unknown[] };

/** 袋のメッセージ（受け取った人・残り・終わったか） */
export function bagMessage(bag: OtoshidamaBag, claims: OtoshidamaClaim[], coin: { name: string; emoji: string }, now = new Date()): BagView {
  const left = bag.count - claims.length;
  const full = claims.length >= bag.count;
  const expired = !full && (bag.endedAt !== null || bag.expiresAt <= now);
  const best = claims.length ? claims.reduce((a, b) => (b.amount > a.amount ? b : a)) : undefined;
  const lines = [
    `<@${bag.ownerId}> さんからのお年玉！`,
    `${coin.emoji}**${bag.total.toLocaleString('ja-JP')} 枚** を、先着 **${bag.count} 人** で分けます（1 人ずつの量は運しだい）`,
    ...(bag.note ? [`> ${bag.note}`] : []),
    '',
    full
      ? `🈵 **空になりました！** いちばん多かったのは <@${best!.memberId}> さん（${best!.amount.toLocaleString('ja-JP')} 枚）🎉`
      : expired
        ? `⌛ 期限が来ました。残り ${bag.refunded.toLocaleString('ja-JP')} 枚は <@${bag.ownerId}> さんに戻りました`
        : `🧧 残り **${left}** 袋`,
    ...(claims.length ? ['', '**受け取った人**', ...claims.slice(0, 20).map((c, i) => `${i + 1}. <@${c.memberId}> … ${c.amount.toLocaleString('ja-JP')} 枚`)] : []),
    ...(claims.length > 20 ? [`-# ほか ${claims.length - 20} 人`] : []),
    ...(!full && !expired ? [`-# 1 人 1 回・入鯖が承認された人だけ。<t:${Math.floor(bag.expiresAt.getTime() / 1000)}:R> に締め切り（残りは置いた人に戻ります）`] : []),
  ];
  const open = !full && !expired;
  return {
    embeds: [{ title: '🧧 お年玉袋', description: lines.join('\n').slice(0, 4000), color: open ? 0xd7003a : 0x9a8f8f }],
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: open ? 1 : 2, custom_id: `otoshi:claim:${bag.id}`, label: open ? `もらう（残り ${left}）` : full ? '空になりました' : '締め切りました', emoji: { name: '🧧' }, disabled: !open },
        ],
      },
    ],
  };
}

export const CLAIM_MESSAGES: Record<Exclude<ClaimResult['status'], 'ok'>, string> = {
  gone: 'このお年玉袋は見つかりませんでした。',
  ended: 'このお年玉袋は、もう空か締め切りです。',
  own: '自分で置いたお年玉袋は受け取れません。',
  already: 'このお年玉袋は、もう受け取りました（1 人 1 回）。',
  not_member: 'お年玉袋を受け取れるのは、入鯖が承認された人だけです。',
};

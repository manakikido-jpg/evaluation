import { and, asc, count, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { GACHA_TIERS, type GachaConfig, type GachaTier, type TicketKind } from '../config.js';
import type { Db } from '../db/client.js';
import { gachaClaims, gachaCollection, gachaDraws, gachaPrizes, gachaState, settings, shopItems, shopPurchases, type GachaClaim, type GachaDraw, type GachaPrizeRow, type ShopItem, type CustomTicket } from '../db/schema.js';
import { addCoins, deductUpTo, spendWithin, walletOf } from './economy.js';
import { grantRoleItem } from './shop.js';
import { takeLuck } from './buffs.js';
import { addCustom, customName, listCustomTickets, takeCustom } from './customTickets.js';
import { addTickets, takeTickets, TICKET_LABEL, ticketsOf, useTicket } from './tickets.js';

/**
 * 物御籤（もつみくじ）: 花びらで引くくじ。本物のお金は扱わない。
 * 運勢（大吉・中吉・小吉・吉）を出やすさで決め、その運勢の中身（限定ロール・券・花びら・ショップの品）から重みで 1 つ出す。
 * 中身は社務所Web の「物御籤」で足す・変える・止める（gacha_prizes）。
 * 大吉が出ないまま決めた回数目（天井）は必ず大吉。
 */

export const TIER_LABEL: Record<GachaTier, { name: string; emoji: string; color: number }> = {
  super: { name: '超大当たり', emoji: '🎊', color: 0xff3fa4 },
  daikichi: { name: '大吉', emoji: '🌸', color: 0xd4a017 },
  chukichi: { name: '中吉', emoji: '🏮', color: 0xd7003a },
  shokichi: { name: '小吉', emoji: '🎐', color: 0xe0607e },
  kichi: { name: '吉', emoji: '🍡', color: 0x8fbc8f },
};

type Rand = () => number;

/** 出る割合（%、小数 1 桁まで） */
export function gachaRates(g: Pick<GachaConfig, 'rates'>): Record<GachaTier, number> {
  const total = GACHA_TIERS.reduce((n, t) => n + g.rates[t], 0);
  return Object.fromEntries(GACHA_TIERS.map((t) => [t, total > 0 ? roundRate((g.rates[t] / total) * 100) : 0])) as Record<GachaTier, number>;
}

export function pickTier(g: Pick<GachaConfig, 'rates'>, rand: Rand = Math.random): GachaTier {
  const total = GACHA_TIERS.reduce((n, t) => n + g.rates[t], 0);
  let r = rand() * total;
  for (const t of GACHA_TIERS) {
    r -= g.rates[t];
    if (r < 0) return t;
  }
  // 端数のときは、出る運勢のうちいちばん下
  return [...GACHA_TIERS].reverse().find((t) => g.rates[t] > 0) ?? 'kichi';
}

// ───────── 中身 ─────────

export type PrizeKind = GachaPrizeRow['kind'];
export const PRIZE_KINDS: PrizeKind[] = ['role', 'ticket', 'coins', 'shop', 'special', 'custom', 'zodiac'];
export const PRIZE_KIND_LABEL: Record<PrizeKind, string> = { role: '限定ロール', ticket: '券', coins: '銭', shop: 'ショップの品', special: '運営が渡す賞品', custom: '自由な券', zodiac: '十二支のお守り' };

/** 中身の名前（role: ロールの名前・shop: ショップの品。分からなければ「消えた〜」） */
export function prizeLabel(
  p: Pick<GachaPrizeRow, 'kind' | 'roleId' | 'ticket' | 'shopItemId' | 'amount' | 'label' | 'customTicketId'>,
  names: {
    role: (id: string) => string | undefined;
    shop: (id: number) => ShopItem | undefined;
    /** 通貨（絵文字つき。なければ 🪙銭） */ coin?: string;
    custom?: (id: number) => CustomTicket | undefined;
  },
): string {
  if (p.kind === 'role') return `🎀「${(p.roleId && names.role(p.roleId)) ?? '消えたロール'}」`;
  if (p.kind === 'ticket') return p.ticket ? `${TICKET_LABEL[p.ticket].emoji}${TICKET_LABEL[p.ticket].name} ×${p.amount}` : '券';
  if (p.kind === 'coins') return `${names.coin ?? '🪙銭'} ${p.amount.toLocaleString('ja-JP')} 枚`;
  if (p.kind === 'special') return `🎊 ${p.label ?? '特別な賞品'}`;
  if (p.kind === 'zodiac') {
    const reward = p.roleId ? names.role(p.roleId) : undefined;
    return `🐉 十二支のお守り（12 種${reward ? `・そろうと「${reward}」` : ''}）`;
  }
  if (p.kind === 'custom') {
    const t = p.customTicketId ? names.custom?.(p.customTicketId) : undefined;
    return t ? `${customName(t)} ×${p.amount}` : '（消えた自由な券）';
  }
  const item = p.shopItemId ? names.shop(p.shopItemId) : undefined;
  return item ? `${item.emoji}${item.name}${item.durationDays ? `（${item.durationDays} 日）` : ''}` : '（消えたショップの品）';
}

/** 物御籤で出せるショップの品（ロールの品: 色守り・称号・開業権利など） */
export const giftableShopItem = (i: ShopItem) => i.kind === 'role' && Boolean(i.roleId);

export async function listPrizes(db: Db): Promise<GachaPrizeRow[]> {
  const rows = await db.select().from(gachaPrizes).orderBy(asc(gachaPrizes.position), asc(gachaPrizes.id));
  return GACHA_TIERS.flatMap((t) => rows.filter((r) => r.tier === t));
}

export type PrizeInput = Pick<GachaPrizeRow, 'tier' | 'kind' | 'amount' | 'weight' | 'fallback'> &
  Partial<Pick<GachaPrizeRow, 'roleId' | 'ticket' | 'shopItemId' | 'enabled' | 'label' | 'stock' | 'customTicketId' | 'startsAt' | 'endsAt'>>;

export async function createPrize(db: Db, p: PrizeInput): Promise<GachaPrizeRow> {
  const [row] = await db.insert(gachaPrizes).values(p).returning();
  return row!;
}

export async function updatePrize(
  db: Db,
  id: number,
  patch: Partial<Pick<GachaPrizeRow, 'amount' | 'weight' | 'fallback' | 'enabled' | 'tier' | 'stock'>>,
): Promise<GachaPrizeRow | undefined> {
  const [row] = await db
    .update(gachaPrizes)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(gachaPrizes.id, id))
    .returning();
  return row;
}

export async function deletePrize(db: Db, id: number): Promise<GachaPrizeRow | undefined> {
  const [row] = await db.delete(gachaPrizes).where(eq(gachaPrizes.id, id)).returning();
  return row;
}

const SEEDED = 'gacha_prizes_seeded';

/**
 * 最初の中身を作る（設定の prizes・roleIds から。1 回だけ。あとで全部消しても作り直さない）。
 * 限定ロールを出す運勢の券は「ほかが出せないときだけ」にする（ロールを全部持っていたら券）。
 */
export async function ensureGachaPrizes(db: Db, g: GachaConfig): Promise<void> {
  const [marked] = await db.insert(settings).values({ key: SEEDED, value: true, updatedBy: 'system' }).onConflictDoNothing().returning();
  if (!marked) return;
  const rows: PrizeInput[] = [];
  for (const tier of GACHA_TIERS) {
    if (tier === 'super') continue;
    const p = g.prizes[tier];
    if (p.role) for (const roleId of g.roleIds) rows.push({ tier, kind: 'role', roleId, amount: 1, weight: 1, fallback: false });
    if (p.ticket !== 'none' && p.count > 0) rows.push({ tier, kind: 'ticket', ticket: p.ticket, amount: p.count, weight: 1, fallback: p.role });
    if (p.coins > 0) rows.push({ tier, kind: 'coins', amount: p.coins, weight: 1, fallback: false });
  }
  if (rows.length) await db.insert(gachaPrizes).values(rows.map((r, i) => ({ ...r, position: i })));
}

/** 引く人ごとの事情（持っているロール・ショップの品・自由な券・集めた十二支・いま） */
type DrawCtx = {
  owned: ReadonlySet<string>;
  shop: ReadonlyMap<number, ShopItem>;
  custom?: ReadonlyMap<number, CustomTicket>;
  zodiac?: ReadonlySet<string>;
  now: Date;
};

/** 期間限定の中身が、いま出る期間か */
export const inPeriod = (p: Pick<GachaPrizeRow, 'startsAt' | 'endsAt'>, now: Date) => (!p.startsAt || p.startsAt <= now) && (!p.endsAt || now < p.endsAt);

/** その人に出せる中身か（持っているロールは出さない。期限つきのショップの品は延長になるので出す） */
function eligible(p: GachaPrizeRow, ctx: DrawCtx): boolean {
  const { owned, shop, custom } = ctx;
  if (!p.enabled || p.weight <= 0 || !inPeriod(p, ctx.now)) return false;
  if (p.kind === 'zodiac') return (ctx.zodiac?.size ?? 0) < ZODIAC.length;
  if (p.kind === 'special') return Boolean(p.label) && (p.stock === null || p.stock > 0);
  if (p.kind === 'custom') return Boolean(p.customTicketId && custom?.get(p.customTicketId)?.enabled) && p.amount > 0;
  if (p.kind === 'role') return Boolean(p.roleId) && !owned.has(p.roleId!);
  if (p.kind === 'shop') {
    const item = p.shopItemId ? shop.get(p.shopItemId) : undefined;
    return Boolean(item && giftableShopItem(item) && (item.durationDays || !owned.has(item.roleId!)));
  }
  if (p.kind === 'ticket') return Boolean(p.ticket) && p.amount > 0;
  return p.amount > 0;
}

/** 運勢ごとの、今出せる中身（ふつうの中身が 1 つもなければ「ほかが出せないときだけ」の中身） */
function choicesOf(prizes: GachaPrizeRow[], tier: GachaTier, ctx: DrawCtx): GachaPrizeRow[] {
  const ok = prizes.filter((p) => p.tier === tier && eligible(p, ctx));
  const normal = ok.filter((p) => !p.fallback);
  return normal.length ? normal : ok;
}

function pickWeighted<T extends { weight: number }>(list: T[], rand: Rand): T {
  let r = rand() * list.reduce((n, p) => n + p.weight, 0);
  for (const p of list) {
    r -= p.weight;
    if (r < 0) return p;
  }
  return list[list.length - 1]!;
}

/** 出せる中身か（止めていない・重みがある・特別な賞品は残りがある） */
const live = (p: GachaPrizeRow, now: Date) => p.enabled && p.weight > 0 && inPeriod(p, now) && (p.kind !== 'special' || p.stock === null || p.stock > 0);

/** 割合の丸め（0.01% のような小さい値も 0 にしない） */
export const roundRate = (v: number) => (v === 0 ? 0 : v >= 1 ? Math.round(v * 100) / 100 : Number(v.toPrecision(2)));

/** 中身のある運勢だけで数えた、出る割合（%） */
export function effectiveRates(g: Pick<GachaConfig, 'rates'>, prizes: GachaPrizeRow[], now = new Date()): Record<GachaTier, number> {
  const rates = Object.fromEntries(GACHA_TIERS.map((t) => [t, prizes.some((p) => p.tier === t && live(p, now)) ? g.rates[t] : 0])) as Record<
    GachaTier,
    number
  >;
  return gachaRates({ rates });
}

/**
 * 中身ごとの出る確率（%。だれも何も持っていないとき）。止めている中身は 0。
 * 「ほかが出せないときだけ」の中身は、同じ運勢にふつうの中身があれば 0（fallback: true で返す）
 */
export function prizeChances(g: Pick<GachaConfig, 'rates'>, prizes: GachaPrizeRow[], now = new Date()): Map<number, number> {
  const rates = effectiveRates(g, prizes, now);
  const out = new Map<number, number>();
  for (const t of GACHA_TIERS) {
    const on = prizes.filter((p) => p.tier === t && live(p, now));
    const normal = on.filter((p) => !p.fallback);
    const pool = normal.length ? normal : on;
    const sum = pool.reduce((n, p) => n + p.weight, 0);
    for (const p of prizes.filter((x) => x.tier === t)) out.set(p.id, pool.includes(p) && sum > 0 ? roundRate((rates[t] * p.weight) / sum) : 0);
  }
  return out;
}

export type GachaPull = {
  tier: GachaTier;
  pity: boolean;
  prizeId: number;
  kind: PrizeKind;
  roleId?: string;
  ticket?: TicketKind;
  count: number;
  coins: number;
  /** ショップの品 */
  shopItemId?: number;
  shopName?: string;
  expiresAt?: Date | null;
  /** 同じ組（色）の前のロールを外す */
  removeRoleIds?: string[];
  /** 運気アップの札が効いた回 */
  lucky?: boolean;
  /** 運営が渡す特別な賞品（当たりの記録） */
  special?: { label: string; claimId: number };
  /** 自由な券 */
  custom?: { id: number; name: string; count: number };
  /** 十二支のお守り（count: 集めた数。complete: 12 そろった） */
  zodiac?: { key: string; name: string; emoji: string; count: number; complete: boolean };
};

export type GachaResult =
  | { status: 'ok'; pulls: GachaPull[]; balance: number; sinceTop: number; total: number; tickets: Record<TicketKind, number>; refunded: number }
  | { status: 'insufficient'; price: number; balance: number }
  | { status: 'disabled' }
  | { status: 'empty' }
  | { status: 'no_ticket' };

/**
 * 引く（1 回か 10 連）。花びらを払う → 運勢を決める → その運勢の中身から 1 つ → 渡す → 記録、を 1 つのトランザクションで。
 * ロールを付ける・外すのは呼び出し側（pulls の roleId・removeRoleIds）。heldRoleIds: 今持っているロール（持っているロールは出さない）。
 * 中身のない運勢は出ない。途中で出せる中身がなくなったら（ロールを全部持ったなど）、残りの回数分は払い戻す。
 */
export async function drawGacha(
  db: Db,
  g: GachaConfig,
  memberId: string,
  times: number,
  heldRoleIds: readonly string[],
  rand: Rand = Math.random,
  now = new Date(),
  /** free: 物御籤の無料券で 1 回（銭は払わない） */
  opts: { free?: boolean } = {},
): Promise<GachaResult> {
  if (!g.enabled || !Number.isInteger(times) || times < 1 || times > 10 || (opts.free && times !== 1)) return { status: 'disabled' };
  await ensureGachaPrizes(db, g);
  const prizes = await listPrizes(db);
  const shop = new Map((await db.select().from(shopItems)).map((i) => [i.id, i]));
  const custom = new Map((await listCustomTickets(db)).map((t) => [t.id, t]));
  const owned = new Set(heldRoleIds);
  const zodiac = new Set(await collectionOf(db, memberId));
  const ctx: DrawCtx = { owned, shop, custom, zodiac, now };
  /** 今出せる運勢（出やすさ 0 と、出せる中身がない運勢はのぞく） */
  const available = () => {
    const rates = Object.fromEntries(GACHA_TIERS.map((t) => [t, g.rates[t] > 0 && choicesOf(prizes, t, ctx).length ? g.rates[t] : 0])) as Record<
      GachaTier,
      number
    >;
    return GACHA_TIERS.some((t) => rates[t] > 0) ? rates : undefined;
  };
  if (!available()) return { status: 'empty' };
  const unit = opts.free ? 0 : g.price;
  const price = unit * times;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'gacha:' + memberId}))`);
    if (opts.free) {
      if (!(await useTicket(tx, memberId, 'gacha_free'))) return { status: 'no_ticket' as const };
    } else if (!(await spendWithin(tx, memberId, price, 'gacha', { times }))) return { status: 'insufficient' as const, price, balance: (await walletOf(tx, memberId)).balance };
    const [state] = await tx.select().from(gachaState).where(eq(gachaState.memberId, memberId));
    let sinceTop = state?.sinceTop ?? 0;
    const pulls: GachaPull[] = [];
    for (let n = 0; n < times; n++) {
      const rates = available();
      if (!rates) break;
      const pity = g.pity > 0 && sinceTop + 1 >= g.pity && rates.daikichi > 0;
      // 🍀 運気アップの札: 残っていれば、この 1 回は大吉が 2 倍出やすい
      const lucky = !pity && rates.daikichi > 0 && (await takeLuck(tx, memberId));
      const tier = pity ? 'daikichi' : pickTier({ rates: lucky ? { ...rates, daikichi: rates.daikichi * 2 } : rates }, rand);
      sinceTop = tier === 'daikichi' ? 0 : sinceTop + 1;
      const p = pickWeighted(choicesOf(prizes, tier, ctx), rand);
      const pull: GachaPull = { tier, pity, prizeId: p.id, kind: p.kind, count: 0, coins: 0, ...(lucky ? { lucky: true } : {}) };
      if (p.kind === 'role') {
        pull.roleId = p.roleId!;
        owned.add(p.roleId!);
      } else if (p.kind === 'ticket') {
        pull.ticket = p.ticket!;
        pull.count = p.amount;
        await addTickets(tx, memberId, p.ticket!, p.amount);
      } else if (p.kind === 'special') {
        // 運営が渡す特別な賞品: 残りを 1 つ減らして、当たりを記録（同時に当たっても残りより多くは出さない）
        if (p.stock !== null) {
          const [left] = await tx
            .update(gachaPrizes)
            .set({ stock: sql`${gachaPrizes.stock} - 1` })
            .where(and(eq(gachaPrizes.id, p.id), gt(gachaPrizes.stock, 0)))
            .returning({ stock: gachaPrizes.stock });
          if (!left) {
            p.stock = 0;
            n--;
            continue;
          }
          p.stock = left.stock;
        }
        const [claim] = await tx.insert(gachaClaims).values({ memberId, prizeId: p.id, label: p.label ?? '特別な賞品' }).returning();
        pull.special = { label: claim!.label, claimId: claim!.id };
      } else if (p.kind === 'zodiac') {
        // 🐉 十二支のお守り: まだ持っていないものから 1 つ。12 そろったら、決めたロール（称号）
        const missing = ZODIAC.filter((z) => !zodiac.has(z.key));
        const z = missing[Math.floor(rand() * missing.length)]!;
        await tx.insert(gachaCollection).values({ memberId, item: z.key, createdAt: now }).onConflictDoNothing();
        zodiac.add(z.key);
        const complete = zodiac.size >= ZODIAC.length;
        pull.zodiac = { key: z.key, name: z.name, emoji: z.emoji, count: zodiac.size, complete };
        if (complete && p.roleId && !owned.has(p.roleId)) {
          pull.roleId = p.roleId;
          owned.add(p.roleId);
        }
      } else if (p.kind === 'custom') {
        const t = custom.get(p.customTicketId!)!;
        await addCustom(tx, memberId, t.id, p.amount);
        pull.custom = { id: t.id, name: customName(t), count: p.amount };
      } else if (p.kind === 'coins') {
        pull.coins = p.amount;
        await addCoins(tx, memberId, p.amount, 'gacha_prize', { tier, prizeId: p.id });
      } else {
        const item = shop.get(p.shopItemId!)!;
        const r = await grantRoleItem(tx, item, memberId, now);
        pull.roleId = item.roleId!;
        pull.shopItemId = item.id;
        pull.shopName = `${item.emoji}${item.name}`;
        if (r.status === 'ok') {
          pull.expiresAt = r.purchase.expiresAt;
          pull.removeRoleIds = r.removeRoleIds;
        }
        if (!item.durationDays) owned.add(item.roleId!);
      }
      pulls.push(pull);
    }
    // 出せる中身がなくなった分は払い戻す
    const refunded = times - pulls.length;
    if (refunded > 0 && unit > 0) await addCoins(tx, memberId, refunded * unit, 'gacha_refund', { times: refunded });
    if (refunded > 0 && opts.free) await addTickets(tx, memberId, 'gacha_free', 1);
    const total = (state?.total ?? 0) + pulls.length;
    await tx
      .insert(gachaState)
      .values({ memberId, sinceTop, total })
      .onConflictDoUpdate({ target: gachaState.memberId, set: { sinceTop, total, updatedAt: new Date() } });
    await tx.insert(gachaDraws).values(
      pulls.map((p) => ({
        memberId,
        tier: p.tier,
        pity: p.pity,
        price: unit,
        roleId: p.roleId ?? null,
        ticket: p.ticket ?? null,
        ticketCount: p.count,
        coins: p.coins,
        prizeId: p.prizeId,
        shopItemId: p.shopItemId ?? null,
        customTicketId: p.custom?.id ?? null,
        zodiac: p.zodiac?.key ?? null,
        createdAt: now,
        ...(p.custom ? { ticketCount: p.custom.count } : {}),
      })),
    );
    return { status: 'ok' as const, pulls, balance: (await walletOf(tx, memberId)).balance, sinceTop, total, tickets: await ticketsOf(tx, memberId), refunded };
  });
}

/** 自分の回数（天井まであと何回） */
export async function gachaStateOf(db: Db, memberId: string): Promise<{ sinceTop: number; total: number }> {
  const [row] = await db.select().from(gachaState).where(eq(gachaState.memberId, memberId));
  return { sinceTop: row?.sinceTop ?? 0, total: row?.total ?? 0 };
}

/** 天井まであと何回（天井なしは undefined） */
export const untilPity = (g: Pick<GachaConfig, 'pity'>, sinceTop: number) => (g.pity > 0 ? Math.max(1, g.pity - sinceTop) : undefined);

/** 管理画面: 運勢ごとの回数と、使われた花びら */
export async function gachaStats(db: Db): Promise<{ total: number; spent: number; byTier: Record<GachaTier, number>; players: number }> {
  const rows = await db
    .select({ tier: gachaDraws.tier, n: count(), spent: sql<number>`coalesce(sum(${gachaDraws.price}), 0)::int` })
    .from(gachaDraws)
    .groupBy(gachaDraws.tier);
  const byTier = Object.fromEntries(GACHA_TIERS.map((t) => [t, rows.find((r) => r.tier === t)?.n ?? 0])) as Record<GachaTier, number>;
  const [players] = await db.select({ n: count() }).from(gachaState);
  return { total: rows.reduce((n, r) => n + r.n, 0), spent: rows.reduce((n, r) => n + r.spent, 0), byTier, players: players?.n ?? 0 };
}

/** 最近引かれた物御籤（管理画面。memberId でその人だけ・topOnly で大吉だけ） */
export async function recentDraws(db: Db, opts: { limit?: number; memberId?: string; topOnly?: boolean } = {}): Promise<GachaDraw[]> {
  const where = and(opts.memberId ? eq(gachaDraws.memberId, opts.memberId) : undefined, opts.topOnly ? eq(gachaDraws.tier, 'daikichi') : undefined);
  return db
    .select()
    .from(gachaDraws)
    .where(where)
    .orderBy(desc(gachaDraws.createdAt), desc(gachaDraws.id))
    .limit(opts.limit ?? 100);
}

/** よく引いている人（管理画面）: 回数・天井までの回数・大吉の回数 */
export async function topPlayers(db: Db, limit = 30): Promise<{ memberId: string; total: number; sinceTop: number; tops: number }[]> {
  const rows = await db.select().from(gachaState).orderBy(desc(gachaState.total)).limit(limit);
  if (!rows.length) return [];
  const tops = await db
    .select({ memberId: gachaDraws.memberId, n: count() })
    .from(gachaDraws)
    .where(
      and(
        eq(gachaDraws.tier, 'daikichi'),
        inArray(
          gachaDraws.memberId,
          rows.map((r) => r.memberId),
        ),
      ),
    )
    .groupBy(gachaDraws.memberId);
  return rows.map((r) => ({ memberId: r.memberId, total: r.total, sinceTop: r.sinceTop, tops: tops.find((t) => t.memberId === r.memberId)?.n ?? 0 }));
}

// ───────── リセット ─────────

export type GachaResetMember = {
  memberId: string;
  draws: number;
  refund: number;
  coins: number;
  tickets: Partial<Record<TicketKind, number>>;
  /** 自由な券（id → 枚数） */
  custom: Record<number, number>;
  roleIds: string[];
};

/** リセットしたら何が起きるか（引いた人ごと: 返す銭・取り上げる銭・券・ロール） */
export async function gachaResetPreview(db: Db): Promise<GachaResetMember[]> {
  const draws = await db.select().from(gachaDraws);
  const by = new Map<string, GachaResetMember>();
  for (const d of draws) {
    const m = by.get(d.memberId) ?? { memberId: d.memberId, draws: 0, refund: 0, coins: 0, tickets: {}, custom: {}, roleIds: [] };
    m.draws++;
    m.refund += d.price;
    m.coins += d.coins;
    if (d.ticket && d.ticketCount > 0) m.tickets[d.ticket] = (m.tickets[d.ticket] ?? 0) + d.ticketCount;
    if (d.customTicketId && d.ticketCount > 0) m.custom[d.customTicketId] = (m.custom[d.customTicketId] ?? 0) + d.ticketCount;
    if (d.roleId && !m.roleIds.includes(d.roleId)) m.roleIds.push(d.roleId);
    by.set(d.memberId, m);
  }
  return [...by.values()].sort((a, b) => b.draws - a.draws);
}

export type GachaResetResult = {
  members: number;
  draws: number;
  refunded: number;
  coinsTaken: number;
  ticketsTaken: number;
  /** Discord で外すロール（呼び出し側で外す） */
  removeRoles: { memberId: string; roleId: string }[];
  perMember: { memberId: string; refund: number; coinsTaken: number; ticketsTaken: number; roles: number }[];
};

/**
 * 物御籤をリセットする: これまでに引いた分の銭を返し、出たものを取り上げる（当たりの銭・券は残っている分まで。
 * 物御籤で出たショップの品は記録を終わりにする）。引いた記録と天井の回数は消す。中身と設定はそのまま。
 */
export async function resetGacha(db: Db, now = new Date()): Promise<GachaResetResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'gacha:reset'}))`);
    const plan = await gachaResetPreview(tx);
    const out: GachaResetResult = { members: plan.length, draws: 0, refunded: 0, coinsTaken: 0, ticketsTaken: 0, removeRoles: [], perMember: [] };
    const shopDraws = await tx.select({ memberId: gachaDraws.memberId, roleId: gachaDraws.roleId, shopItemId: gachaDraws.shopItemId }).from(gachaDraws);
    for (const m of plan) {
      if (m.refund > 0) await addCoins(tx, m.memberId, m.refund, 'gacha_refund', { reset: true, draws: m.draws });
      const coinsTaken = m.coins > 0 ? await deductUpTo(tx, m.memberId, m.coins, 'gacha_reset', { reset: true }) : 0;
      let ticketsTaken = 0;
      for (const [kind, n] of Object.entries(m.tickets) as [TicketKind, number][]) ticketsTaken += await takeTickets(tx, m.memberId, kind, n);
      for (const [id, n] of Object.entries(m.custom)) ticketsTaken += await takeCustom(tx, m.memberId, Number(id), n);
      // ショップの品: 物御籤で渡した記録（0 枚・券なし）を終わりにする。銭で買った同じ品が残っていればロールは外さない
      const shopRoles = new Set(shopDraws.filter((d) => d.memberId === m.memberId && d.shopItemId && d.roleId).map((d) => d.roleId!));
      for (const roleId of shopRoles) {
        await tx
          .update(shopPurchases)
          .set({ endedAt: now })
          .where(and(eq(shopPurchases.memberId, m.memberId), eq(shopPurchases.roleId, roleId), eq(shopPurchases.price, 0), isNull(shopPurchases.ticket), isNull(shopPurchases.endedAt)));
      }
      const paid = await tx
        .select({ roleId: shopPurchases.roleId })
        .from(shopPurchases)
        .where(and(eq(shopPurchases.memberId, m.memberId), isNull(shopPurchases.endedAt), gt(shopPurchases.price, 0)));
      const keep = new Set(paid.map((p) => p.roleId));
      const roles = m.roleIds.filter((r) => !keep.has(r));
      out.removeRoles.push(...roles.map((roleId) => ({ memberId: m.memberId, roleId })));
      out.draws += m.draws;
      out.refunded += m.refund;
      out.coinsTaken += coinsTaken;
      out.ticketsTaken += ticketsTaken;
      out.perMember.push({ memberId: m.memberId, refund: m.refund, coinsTaken, ticketsTaken, roles: roles.length });
    }
    await tx.delete(gachaDraws);
    await tx.delete(gachaState);
    await tx.delete(gachaCollection);
    return out;
  });
}

// ───────── 運営が渡す特別な賞品 ─────────

/** 当たりの一覧（まだ渡していないものを先に、新しい順） */
export async function listClaims(db: Db, limit = 100): Promise<GachaClaim[]> {
  return db
    .select()
    .from(gachaClaims)
    .orderBy(sql`case when ${gachaClaims.deliveredAt} is null then 0 else 1 end`, desc(gachaClaims.createdAt))
    .limit(limit);
}

/** 渡した（運営） */
export async function deliverClaim(db: Db, id: number, by: string, now = new Date()): Promise<GachaClaim | undefined> {
  const [row] = await db
    .update(gachaClaims)
    .set({ deliveredAt: now, deliveredBy: by })
    .where(and(eq(gachaClaims.id, id), isNull(gachaClaims.deliveredAt)))
    .returning();
  return row;
}

// ───────── 十二支のお守り ─────────

export const ZODIAC = [
  { key: 'ne', name: '子', emoji: '🐭' },
  { key: 'ushi', name: '丑', emoji: '🐮' },
  { key: 'tora', name: '寅', emoji: '🐯' },
  { key: 'u', name: '卯', emoji: '🐰' },
  { key: 'tatsu', name: '辰', emoji: '🐲' },
  { key: 'mi', name: '巳', emoji: '🐍' },
  { key: 'uma', name: '午', emoji: '🐴' },
  { key: 'hitsuji', name: '未', emoji: '🐑' },
  { key: 'saru', name: '申', emoji: '🐵' },
  { key: 'tori', name: '酉', emoji: '🐔' },
  { key: 'inu', name: '戌', emoji: '🐶' },
  { key: 'i', name: '亥', emoji: '🐗' },
] as const;

/** 集めた十二支（key） */
export async function collectionOf(db: Db, memberId: string): Promise<string[]> {
  const rows = await db.select({ item: gachaCollection.item }).from(gachaCollection).where(eq(gachaCollection.memberId, memberId));
  return rows.map((r) => r.item);
}

/** 十二支の並び（持っているものは絵文字、まだのものは ・） */
export const zodiacLine = (have: readonly string[]) => ZODIAC.map((z) => (have.includes(z.key) ? z.emoji : '・')).join('');

/** 🍶 おすそ分け: 大吉・超大当たりを引いた人と同じ通話にいる人それぞれに銭（引いた人はのぞく） */
export async function shareFortune(db: Db, fromId: string, memberIds: readonly string[], amount: number): Promise<string[]> {
  const to = [...new Set(memberIds)].filter((id) => id !== fromId);
  if (amount <= 0 || !to.length) return [];
  await db.transaction(async (tx) => {
    for (const id of to) await addCoins(tx, id, amount, 'gacha_share', { from: fromId });
  });
  return to;
}

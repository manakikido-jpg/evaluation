import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { GACHA_TIERS, type GachaConfig, type GachaTier, type TicketKind } from '../config.js';
import type { Db } from '../db/client.js';
import { gachaDraws, gachaPrizes, gachaState, settings, shopItems, type GachaDraw, type GachaPrizeRow, type ShopItem } from '../db/schema.js';
import { addCoins, spendWithin, walletOf } from './economy.js';
import { grantRoleItem } from './shop.js';
import { addTickets, TICKET_LABEL, ticketsOf } from './tickets.js';

/**
 * 物御籤（もつみくじ）: 花びらで引くくじ。本物のお金は扱わない。
 * 運勢（大吉・中吉・小吉・吉）を出やすさで決め、その運勢の中身（限定ロール・券・花びら・ショップの品）から重みで 1 つ出す。
 * 中身は社務所Web の「物御籤」で足す・変える・止める（gacha_prizes）。
 * 大吉が出ないまま決めた回数目（天井）は必ず大吉。
 */

export const TIER_LABEL: Record<GachaTier, { name: string; emoji: string; color: number }> = {
  daikichi: { name: '大吉', emoji: '🌸', color: 0xd4a017 },
  chukichi: { name: '中吉', emoji: '🏮', color: 0xd7003a },
  shokichi: { name: '小吉', emoji: '🎐', color: 0xe0607e },
  kichi: { name: '吉', emoji: '🍡', color: 0x8fbc8f },
};

type Rand = () => number;

/** 出る割合（%、小数 1 桁まで） */
export function gachaRates(g: Pick<GachaConfig, 'rates'>): Record<GachaTier, number> {
  const total = GACHA_TIERS.reduce((n, t) => n + g.rates[t], 0);
  return Object.fromEntries(GACHA_TIERS.map((t) => [t, total > 0 ? Math.round((g.rates[t] / total) * 1000) / 10 : 0])) as Record<GachaTier, number>;
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
export const PRIZE_KINDS: PrizeKind[] = ['role', 'ticket', 'coins', 'shop'];
export const PRIZE_KIND_LABEL: Record<PrizeKind, string> = { role: '限定ロール', ticket: '券', coins: '銭', shop: 'ショップの品' };

/** 中身の名前（role: ロールの名前・shop: ショップの品。分からなければ「消えた〜」） */
export function prizeLabel(
  p: Pick<GachaPrizeRow, 'kind' | 'roleId' | 'ticket' | 'shopItemId' | 'amount'>,
  names: { role: (id: string) => string | undefined; shop: (id: number) => ShopItem | undefined; /** 通貨（絵文字つき。なければ 🪙銭） */ coin?: string },
): string {
  if (p.kind === 'role') return `🎀「${(p.roleId && names.role(p.roleId)) ?? '消えたロール'}」`;
  if (p.kind === 'ticket') return p.ticket ? `${TICKET_LABEL[p.ticket].emoji}${TICKET_LABEL[p.ticket].name} ×${p.amount}` : '券';
  if (p.kind === 'coins') return `${names.coin ?? '🪙銭'} ${p.amount.toLocaleString('ja-JP')} 枚`;
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
  Partial<Pick<GachaPrizeRow, 'roleId' | 'ticket' | 'shopItemId' | 'enabled'>>;

export async function createPrize(db: Db, p: PrizeInput): Promise<GachaPrizeRow> {
  const [row] = await db.insert(gachaPrizes).values(p).returning();
  return row!;
}

export async function updatePrize(
  db: Db,
  id: number,
  patch: Partial<Pick<GachaPrizeRow, 'amount' | 'weight' | 'fallback' | 'enabled' | 'tier'>>,
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
    const p = g.prizes[tier];
    if (p.role) for (const roleId of g.roleIds) rows.push({ tier, kind: 'role', roleId, amount: 1, weight: 1, fallback: false });
    if (p.ticket !== 'none' && p.count > 0) rows.push({ tier, kind: 'ticket', ticket: p.ticket, amount: p.count, weight: 1, fallback: p.role });
    if (p.coins > 0) rows.push({ tier, kind: 'coins', amount: p.coins, weight: 1, fallback: false });
  }
  if (rows.length) await db.insert(gachaPrizes).values(rows.map((r, i) => ({ ...r, position: i })));
}

/** その人に出せる中身か（持っているロールは出さない。期限つきのショップの品は延長になるので出す） */
function eligible(p: GachaPrizeRow, owned: ReadonlySet<string>, shop: ReadonlyMap<number, ShopItem>): boolean {
  if (!p.enabled || p.weight <= 0) return false;
  if (p.kind === 'role') return Boolean(p.roleId) && !owned.has(p.roleId!);
  if (p.kind === 'shop') {
    const item = p.shopItemId ? shop.get(p.shopItemId) : undefined;
    return Boolean(item && giftableShopItem(item) && (item.durationDays || !owned.has(item.roleId!)));
  }
  if (p.kind === 'ticket') return Boolean(p.ticket) && p.amount > 0;
  return p.amount > 0;
}

/** 運勢ごとの、今出せる中身（ふつうの中身が 1 つもなければ「ほかが出せないときだけ」の中身） */
function choicesOf(prizes: GachaPrizeRow[], tier: GachaTier, owned: ReadonlySet<string>, shop: ReadonlyMap<number, ShopItem>): GachaPrizeRow[] {
  const ok = prizes.filter((p) => p.tier === tier && eligible(p, owned, shop));
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

/** 中身のある運勢だけで数えた、出る割合（%） */
export function effectiveRates(g: Pick<GachaConfig, 'rates'>, prizes: GachaPrizeRow[]): Record<GachaTier, number> {
  const rates = Object.fromEntries(GACHA_TIERS.map((t) => [t, prizes.some((p) => p.tier === t && p.enabled && p.weight > 0) ? g.rates[t] : 0])) as Record<
    GachaTier,
    number
  >;
  return gachaRates({ rates });
}

/**
 * 中身ごとの出る確率（%。だれも何も持っていないとき）。止めている中身は 0。
 * 「ほかが出せないときだけ」の中身は、同じ運勢にふつうの中身があれば 0（fallback: true で返す）
 */
export function prizeChances(g: Pick<GachaConfig, 'rates'>, prizes: GachaPrizeRow[]): Map<number, number> {
  const rates = effectiveRates(g, prizes);
  const out = new Map<number, number>();
  for (const t of GACHA_TIERS) {
    const on = prizes.filter((p) => p.tier === t && p.enabled && p.weight > 0);
    const normal = on.filter((p) => !p.fallback);
    const pool = normal.length ? normal : on;
    const sum = pool.reduce((n, p) => n + p.weight, 0);
    for (const p of prizes.filter((x) => x.tier === t)) out.set(p.id, pool.includes(p) && sum > 0 ? Math.round(((rates[t] * p.weight) / sum) * 100) / 100 : 0);
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
};

export type GachaResult =
  | { status: 'ok'; pulls: GachaPull[]; balance: number; sinceTop: number; total: number; tickets: Record<TicketKind, number>; refunded: number }
  | { status: 'insufficient'; price: number; balance: number }
  | { status: 'disabled' }
  | { status: 'empty' };

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
): Promise<GachaResult> {
  if (!g.enabled || !Number.isInteger(times) || times < 1 || times > 10) return { status: 'disabled' };
  await ensureGachaPrizes(db, g);
  const prizes = await listPrizes(db);
  const shop = new Map((await db.select().from(shopItems)).map((i) => [i.id, i]));
  const owned = new Set(heldRoleIds);
  /** 今出せる運勢（出やすさ 0 と、出せる中身がない運勢はのぞく） */
  const available = () => {
    const rates = Object.fromEntries(GACHA_TIERS.map((t) => [t, g.rates[t] > 0 && choicesOf(prizes, t, owned, shop).length ? g.rates[t] : 0])) as Record<
      GachaTier,
      number
    >;
    return GACHA_TIERS.some((t) => rates[t] > 0) ? rates : undefined;
  };
  if (!available()) return { status: 'empty' };
  const price = g.price * times;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'gacha:' + memberId}))`);
    if (!(await spendWithin(tx, memberId, price, 'gacha', { times }))) return { status: 'insufficient' as const, price, balance: (await walletOf(tx, memberId)).balance };
    const [state] = await tx.select().from(gachaState).where(eq(gachaState.memberId, memberId));
    let sinceTop = state?.sinceTop ?? 0;
    const pulls: GachaPull[] = [];
    for (let n = 0; n < times; n++) {
      const rates = available();
      if (!rates) break;
      const pity = g.pity > 0 && sinceTop + 1 >= g.pity && rates.daikichi > 0;
      const tier = pity ? 'daikichi' : pickTier({ rates }, rand);
      sinceTop = tier === 'daikichi' ? 0 : sinceTop + 1;
      const p = pickWeighted(choicesOf(prizes, tier, owned, shop), rand);
      const pull: GachaPull = { tier, pity, prizeId: p.id, kind: p.kind, count: 0, coins: 0 };
      if (p.kind === 'role') {
        pull.roleId = p.roleId!;
        owned.add(p.roleId!);
      } else if (p.kind === 'ticket') {
        pull.ticket = p.ticket!;
        pull.count = p.amount;
        await addTickets(tx, memberId, p.ticket!, p.amount);
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
    if (refunded > 0) await addCoins(tx, memberId, refunded * g.price, 'gacha_refund', { times: refunded });
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
        price: g.price,
        roleId: p.roleId ?? null,
        ticket: p.ticket ?? null,
        ticketCount: p.count,
        coins: p.coins,
        prizeId: p.prizeId,
        shopItemId: p.shopItemId ?? null,
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

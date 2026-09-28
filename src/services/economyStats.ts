import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { coinTx, members, shopItems, shopPurchases, wallets } from '../db/schema.js';
import { COIN_REASON_LABEL } from './economy.js';
import { trendBuckets, type TrendRange } from './stats.js';

/**
 * 経済（管理画面）: 鯖の中の銭の流れ。
 * - 配った（発行）: 通話・朱印・おみくじ・初期配布・物御籤の当たりなど、鯖がメンバーに出した銭
 * - 鯖の収入（回収）: 授与品・物御籤・通話部屋・免罪符・市場の手数料など、使われて鯖に戻った銭
 * - 運営の調整: 管理画面から送った・減らした分
 * - メンバー間: 贈り物・市場の売り買い（行き来するだけで、全体の量は変わらない。市場の手数料だけ収入）
 * 銭は鯖の中だけのもので、本物のお金とは関係ない。日付は日本時間。
 */

export type Flow = 'issue' | 'income' | 'admin' | 'transfer';

/** 出入りの理由ごとの分け方（知らない理由は「運営の調整」） */
export const REASON_FLOW: Record<string, Flow> = {
  voice: 'issue',
  shuin_give: 'issue',
  shuin_receive: 'issue',
  shuin_revoke: 'issue',
  omikuji: 'issue',
  join_bonus: 'issue',
  onboarding: 'issue',
  invite: 'issue',
  invite_active: 'issue',
  boost: 'issue',
  gacha_prize: 'issue',
  gacha_share: 'issue',
  gacha_reset: 'issue',
  shop: 'income',
  shop_refund: 'income',
  room: 'income',
  gacha: 'income',
  gacha_refund: 'income',
  menzaifu: 'income',
  saisen: 'income',
  market_buy: 'income',
  market_sell: 'income',
  market_refund: 'income',
  board_hold: 'income',
  board_reward: 'income',
  board_refund: 'income',
  gift_send: 'transfer',
  gift_receive: 'transfer',
  otoshidama_put: 'transfer',
  otoshidama_get: 'transfer',
  otoshidama_refund: 'transfer',
  admin_grant: 'admin',
  admin_take: 'admin',
  adjust: 'admin',
};

export const flowOf = (reason: string): Flow => REASON_FLOW[reason] ?? 'admin';

/** 収入の表で 1 行にまとめる理由（払い戻しは元の行から引く・市場は手数料だけ） */
const INCOME_GROUP: Record<string, string> = {
  shop: 'shop',
  shop_refund: 'shop',
  gacha: 'gacha',
  gacha_refund: 'gacha',
  room: 'room',
  menzaifu: 'menzaifu',
  saisen: 'saisen',
  market_buy: 'market',
  market_sell: 'market',
  market_refund: 'market',
  board_hold: 'board',
  board_reward: 'board',
  board_refund: 'board',
};
export const INCOME_LABEL: Record<string, string> = {
  shop: '授与品（ショップ）',
  gacha: '物御籤',
  room: '通話部屋',
  menzaifu: '免罪符',
  market: '市場の手数料',
  board: '掲示板の手数料',
  saisen: 'お賽銭（持ちすぎた分）',
};

export type FlowLine = { key: string; label: string; amount: number; count: number; members: number };

export type EconomyBucket = { label: string; title: string; from: string; to: string; issued: number; income: number; admin: number; supply: number };

export type EconomyOverview = {
  /** 今メンバーが持っている銭の合計 */
  supply: number;
  /** 期間の合計 */
  issued: number;
  income: number;
  admin: number;
  /** 期間の増減（配った − 収入 ＋ 調整） */
  net: number;
  /** メンバー間で動いた量（贈り物・市場の売り上げ） */
  giftVolume: number;
  marketVolume: number;
  issueLines: FlowLine[];
  incomeLines: FlowLine[];
  adminLines: FlowLine[];
  buckets: EconomyBucket[];
};

const jstDay = sql<string>`to_char(${coinTx.at} at time zone 'Asia/Tokyo', 'YYYY-MM-DD')`;
const startOfJstDate = (date: string) => new Date(`${date}T00:00:00+09:00`);
const nextDay = (date: string) => new Date(startOfJstDate(date).getTime() + 86_400_000);

export type FlowSummary = {
  issued: number;
  income: number;
  admin: number;
  giftVolume: number;
  marketVolume: number;
  issueLines: FlowLine[];
  incomeLines: FlowLine[];
  adminLines: FlowLine[];
};

/** from〜to（to は含まない）の銭の流れ */
export async function flowSummary(db: Db, from: Date, to: Date): Promise<FlowSummary> {
  const byReason = await db
    .select({
      reason: coinTx.reason,
      amount: sql<number>`coalesce(sum(${coinTx.amount}), 0)::bigint`,
      n: sql<number>`count(*)::int`,
      who: sql<number>`count(distinct ${coinTx.memberId})::int`,
    })
    .from(coinTx)
    .where(and(gte(coinTx.at, from), lt(coinTx.at, to)))
    .groupBy(coinTx.reason);

  const lines = (flow: Flow, sign: 1 | -1, group: (r: string) => string, label: (k: string) => string): FlowLine[] => {
    const out = new Map<string, FlowLine>();
    for (const r of byReason.filter((x) => flowOf(x.reason) === flow)) {
      const k = group(r.reason);
      const line = out.get(k) ?? { key: k, label: label(k), amount: 0, count: 0, members: 0 };
      line.amount += sign * Number(r.amount);
      // 払い戻し・売った側は件数に入れない（1 回の買い物を 2 回に数えない）
      if (!/_refund$|^market_sell$/.test(r.reason)) {
        line.count += r.n;
        line.members = Math.max(line.members, r.who);
      }
      out.set(k, line);
    }
    return [...out.values()].filter((l) => l.amount !== 0 || l.count > 0).sort((a, b) => b.amount - a.amount);
  };
  const reasonLabel = (k: string) => COIN_REASON_LABEL[k] ?? k;
  const issueLines = lines('issue', 1, (r) => r, reasonLabel);
  const incomeLines = lines('income', -1, (r) => INCOME_GROUP[r] ?? r, (k) => INCOME_LABEL[k] ?? reasonLabel(k));
  const adminLines = lines('admin', 1, (r) => r, reasonLabel);
  const sum = (ls: FlowLine[]) => ls.reduce((n, l) => n + l.amount, 0);
  const amountOf = (reason: string) => Number(byReason.find((r) => r.reason === reason)?.amount ?? 0);
  return {
    issued: sum(issueLines),
    income: sum(incomeLines),
    admin: sum(adminLines),
    giftVolume: -amountOf('gift_send'),
    marketVolume: amountOf('market_sell'),
    issueLines,
    incomeLines,
    adminLines,
  };
}

/** いまメンバーが持っている銭の合計 */
export async function currentSupply(db: Db): Promise<number> {
  const [row] = await db.select({ n: sql<number>`coalesce(sum(${wallets.balance}), 0)::bigint` }).from(wallets);
  return Number(row?.n ?? 0);
}

/** from 以降の増減の合計（今の量から引くと、from の時点の量） */
export async function changeSince(db: Db, from: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${coinTx.amount}), 0)::bigint` })
    .from(coinTx)
    .where(gte(coinTx.at, from));
  return Number(row?.n ?? 0);
}

export async function economyOverview(db: Db, range: TrendRange, now: Date): Promise<EconomyOverview> {
  const frame = trendBuckets(range, now);
  const from = startOfJstDate(frame[0]!.from);
  const to = nextDay(frame.at(-1)!.to);
  const inRange = and(gte(coinTx.at, from), lt(coinTx.at, to));
  const supply = await currentSupply(db);
  const f = await flowSummary(db, from, to);
  const { issued, income, admin } = f;

  // 日ごと → 区切りごと
  const daily = await db
    .select({ day: jstDay, reason: coinTx.reason, amount: sql<number>`coalesce(sum(${coinTx.amount}), 0)::bigint` })
    .from(coinTx)
    .where(inRange)
    .groupBy(jstDay, coinTx.reason);
  const buckets: EconomyBucket[] = frame.map((b) => ({ ...b, issued: 0, income: 0, admin: 0, supply: 0 }));
  const totals = buckets.map(() => 0);
  for (const d of daily) {
    const i = buckets.findIndex((b) => b.from <= d.day && d.day <= b.to);
    if (i < 0) continue;
    const a = Number(d.amount);
    const kind = flowOf(d.reason);
    if (kind === 'issue') buckets[i]!.issued += a;
    else if (kind === 'income') buckets[i]!.income -= a;
    else if (kind === 'admin') buckets[i]!.admin += a;
    totals[i]! += a;
  }
  // 今の量から、あとの区切りの増減を引いていく（各区切りの終わりの量）
  let level = supply - (await changeSince(db, to));
  for (let i = buckets.length - 1; i >= 0; i--) {
    buckets[i]!.supply = Math.max(0, level);
    level -= totals[i]!;
  }

  return {
    supply,
    issued,
    income,
    admin,
    net: issued - income + admin,
    giftVolume: f.giftVolume,
    marketVolume: f.marketVolume,
    issueLines: f.issueLines,
    incomeLines: f.incomeLines,
    adminLines: f.adminLines,
    buckets,
  };
}

export type Distribution = {
  /** 1 枚以上持っている人（BOT・退出した人を除く） */
  holders: number;
  total: number;
  average: number;
  median: number;
  /** 上位 10% の人が持っている割合（0〜1） */
  top10Share: number;
  /** ジニ係数（0 = みんな同じ・1 = 1 人がすべて） */
  gini: number;
  top: { memberId: string; balance: number; lifetimeEarned: number }[];
  /** 持っている量ごとの人数 */
  bands: { label: string; members: number; total: number }[];
};

export const BALANCE_BANDS: { label: string; min: number; max: number }[] = [
  { label: '1〜999', min: 1, max: 999 },
  { label: '1,000〜4,999', min: 1_000, max: 4_999 },
  { label: '5,000〜9,999', min: 5_000, max: 9_999 },
  { label: '10,000〜49,999', min: 10_000, max: 49_999 },
  { label: '50,000 以上', min: 50_000, max: Number.MAX_SAFE_INTEGER },
];

export async function balanceDistribution(db: Db, topN = 10): Promise<Distribution> {
  const rows = await db
    .select({ memberId: wallets.memberId, balance: wallets.balance, lifetimeEarned: wallets.lifetimeEarned })
    .from(wallets)
    .innerJoin(members, eq(members.id, wallets.memberId))
    .where(and(sql`${members.leftAt} is null`, eq(members.isBot, false), gte(wallets.balance, 1)))
    .orderBy(desc(wallets.balance));
  const values = rows.map((r) => r.balance);
  const total = values.reduce((n, v) => n + v, 0);
  const n = values.length;
  const asc = [...values].reverse();
  const median = n === 0 ? 0 : n % 2 ? asc[(n - 1) / 2]! : Math.round((asc[n / 2 - 1]! + asc[n / 2]!) / 2);
  const topCount = Math.max(1, Math.ceil(n * 0.1));
  const top10 = values.slice(0, topCount).reduce((a, v) => a + v, 0);
  // ジニ係数: 小さい順に並べて Σ(2i − n − 1)·x_i / (n · Σx)
  const gini = n < 2 || total === 0 ? 0 : asc.reduce((a, v, i) => a + (2 * (i + 1) - n - 1) * v, 0) / (n * total);
  return {
    holders: n,
    total,
    average: n ? Math.round(total / n) : 0,
    median,
    top10Share: total ? top10 / total : 0,
    gini: Math.round(gini * 100) / 100,
    top: rows.slice(0, topN),
    bands: BALANCE_BANDS.map((b) => {
      const inBand = values.filter((v) => v >= b.min && v <= b.max);
      return { label: b.label, members: inBand.length, total: inBand.reduce((a, v) => a + v, 0) };
    }),
  };
}

/** 期間の大きな出入り（メンバー間の行き来も含む） */
export async function bigTransactions(db: Db, from: Date, limit = 15) {
  return db
    .select()
    .from(coinTx)
    .where(gte(coinTx.at, from))
    .orderBy(desc(sql`abs(${coinTx.amount})`), desc(coinTx.at))
    .limit(limit);
}

/** 期間によく受けられた授与品（値段は払った額。券で割り引いた分は引いてある） */
export async function shopSales(db: Db, from: Date, limit = 10): Promise<{ itemId: number; name: string; count: number; total: number }[]> {
  const rows = await db
    .select({
      itemId: shopPurchases.itemId,
      name: sql<string>`coalesce(${shopItems.emoji} || ${shopItems.name}, '（消えた品）')`,
      count: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${shopPurchases.price}), 0)::int`,
    })
    .from(shopPurchases)
    .leftJoin(shopItems, eq(shopItems.id, shopPurchases.itemId))
    .where(gte(shopPurchases.createdAt, from))
    .groupBy(shopPurchases.itemId, shopItems.emoji, shopItems.name)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);
  return rows;
}

/** 期間の始まり（区切りの最初の日の 0 時） */
export const rangeStart = (range: TrendRange, now: Date) => startOfJstDate(trendBuckets(range, now)[0]!.from);

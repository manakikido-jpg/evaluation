import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { boostThanks, members, settings } from '../db/schema.js';
import { DiscordHttpError, type DiscordActions, type MessageBody } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { banzukeChannelId } from './banzuke.js';
import { addCoins } from './economy.js';

/**
 * サーバーブースト（奉納）のお礼。
 * - 奉納が始まったら: #慶事 にお知らせ・本人に DM・花びら（boostThanks 枚）
 * - 続けてくれている間: 30 日ごとに花びら（DM で知らせる）
 * - #番付 に「奉納板」（今奉納してくれている人の一覧）を貼って書き換える
 * - 授与品の割引（shop.ts の priceOf）
 * BOT は 10 分ごとと、ブーストが始まったときに processBoosters を呼ぶ。止まっていた間の分もここで拾う。
 */

export type BoostCtx = { db: Db; cfg: GuildConfig; discord: DiscordActions };

const DAY = 86_400_000;
/** 花びらを贈る間隔 */
export const BOOST_REWARD_INTERVAL_DAYS = 30;
/** 奉納の色（朱） */
const SHU = 0xd7003a;

export type ThankResult = { kind: 'new' | 'monthly' | 'none'; granted: number };

/**
 * 1 人分のお礼を決めて記録する（花びらもここで）。同じ奉納のお知らせは 1 回だけ。
 * 花びらは、その人に最後に贈ってから 30 日たっていれば贈る（やめてすぐ始め直しても増えない）。
 */
export async function thankBooster(db: Db, cfg: GuildConfig, memberId: string, since: Date, now: Date): Promise<ThankResult> {
  const amount = cfg.economy.boostThanks;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'boost:' + memberId}))`);
    const rows = await tx.select().from(boostThanks).where(eq(boostThanks.memberId, memberId));
    const current = rows.find((r) => r.since.getTime() === since.getTime());
    const lastReward = rows.map((r) => r.lastRewardAt).filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0];
    const due = amount > 0 && (!lastReward || now.getTime() - lastReward.getTime() >= BOOST_REWARD_INTERVAL_DAYS * DAY);

    if (!current) {
      await tx.insert(boostThanks).values({ memberId, since, announcedAt: now, lastRewardAt: due ? now : null });
      if (due) await addCoins(tx, memberId, amount, 'boost', { since: since.toISOString() });
      return { kind: 'new' as const, granted: due ? amount : 0 };
    }
    if (!due) return { kind: 'none' as const, granted: 0 };
    await tx
      .update(boostThanks)
      .set({ lastRewardAt: now })
      .where(and(eq(boostThanks.memberId, memberId), eq(boostThanks.since, since)));
    await addCoins(tx, memberId, amount, 'boost', { since: since.toISOString(), monthly: true });
    return { kind: 'monthly' as const, granted: amount };
  });
}

/** 今奉納してくれている人（在籍中・BOT でない。始めた順） */
export async function currentBoosters(db: Db): Promise<{ id: string; name: string; since: Date }[]> {
  const rows = await db
    .select({ id: members.id, name: members.displayName, since: members.boostingSince })
    .from(members)
    .where(and(isNotNull(members.boostingSince), isNull(members.leftAt), eq(members.isBot, false)))
    .orderBy(asc(members.boostingSince), asc(members.id));
  return rows.map((r) => ({ ...r, since: r.since! }));
}

/** {名前} などを置き換える */
function fill(text: string, memberId: string, cfg: GuildConfig): string {
  return text
    .replaceAll('{名前}', `<@${memberId}>`)
    .replaceAll('{通貨}', cfg.economy.currencyName)
    .replaceAll('{通貨絵文字}', cfg.economy.currencyEmoji);
}

export function boostAnnouncement(memberId: string, cfg: GuildConfig): MessageBody {
  return { content: '', embeds: [{ description: fill(cfg.boost.announceText, memberId, cfg), color: SHU }] };
}

/** 本人への DM。お礼の花びら・割引の案内を BOT が足す */
export function boostDm(memberId: string, cfg: GuildConfig, r: ThankResult): string {
  const e = cfg.economy;
  const coin = `${e.currencyEmoji}${e.currencyName}`;
  const discount =
    e.boostDiscountPercent > 0 ? `奉納してくださっている間は、#授与所 の授与品が **${e.boostDiscountPercent}% 引き** になります（免罪符・贈り物をのぞく）。` : '';
  if (r.kind === 'monthly') {
    return [`🏮 今月も奉納（サーバーブースト）してくださり、ありがとうございます。`, `お礼に${coin}を **${r.granted.toLocaleString('ja-JP')} 枚** お納めしました。`].join('\n');
  }
  return [
    fill(cfg.boost.dmText, memberId, cfg),
    r.granted > 0
      ? `お礼に${coin}を **${r.granted.toLocaleString('ja-JP')} 枚** お納めしました。奉納してくださっている間は、${BOOST_REWARD_INTERVAL_DAYS} 日ごとにまたお届けします。`
      : '',
    discount,
  ]
    .filter(Boolean)
    .join('\n');
}

/** 今奉納している人全員について、お礼が要るか見て、お知らせ・DM を出す */
export async function processBoosters(ctx: BoostCtx, now = new Date(), only?: string): Promise<{ announced: number; granted: number }> {
  let announced = 0;
  let granted = 0;
  for (const b of await currentBoosters(ctx.db)) {
    if (only && b.id !== only) continue;
    const r = await thankBooster(ctx.db, ctx.cfg, b.id, b.since, now);
    if (r.kind === 'none') continue;
    if (r.granted > 0) granted++;
    if (r.kind === 'new') {
      announced++;
      try {
        await ctx.discord.sendMessage(ctx.cfg.channels.keiji, boostAnnouncement(b.id, ctx.cfg));
      } catch (err) {
        logger.warn({ err, memberId: b.id }, 'boost announcement failed');
      }
    }
    // 花びらを贈らないときの「今月も」は送らない
    if (r.kind === 'new' || r.granted > 0) await ctx.discord.sendDm(b.id, boostDm(b.id, ctx.cfg, r));
  }
  return { announced, granted };
}

// ───────── 奉納板（#番付） ─────────

const fmtMonth = (d: Date) => {
  const j = new Date(d.getTime() + 9 * 3_600_000);
  return `${j.getUTCFullYear()}年${j.getUTCMonth() + 1}月`;
};

export function renderBoard(boosters: { id: string; since: Date }[]): MessageBody {
  const list = boosters.length
    ? boosters.map((b) => `- <@${b.id}> … ${fmtMonth(b.since)}から`).join('\n')
    : '-# いまはいません。サーバーブーストで奉納してくださると、ここにお名前が載ります';
  return {
    content: '',
    embeds: [
      {
        title: '🏮 奉納板',
        description: ['サーバーブーストで奉納してくださっている方々です。いつもありがとうございます。', '', list].join('\n'),
        color: SHU,
      },
    ],
  };
}

type BoardState = { channelId: string; messageId: string; text: string };
const BOARD_KEY = 'hounou_board';

async function loadBoard(db: Db): Promise<BoardState | undefined> {
  const [row] = await db.select().from(settings).where(eq(settings.key, BOARD_KEY));
  const v = row?.value as Partial<BoardState> | undefined;
  return v?.channelId && v.messageId ? (v as BoardState) : undefined;
}

async function saveBoard(db: Db, value: BoardState): Promise<void> {
  await db
    .insert(settings)
    .values({ key: BOARD_KEY, value, updatedBy: 'system' })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: 'system', updatedAt: new Date() } });
}

/** 奉納板を貼る・書き換える（変わっていなければ何もしない。消されていたら貼り直す） */
export async function updateBoard(ctx: BoostCtx): Promise<'posted' | 'edited' | 'unchanged' | 'no_channel'> {
  const channelId = await banzukeChannelId(ctx.cfg, ctx.discord);
  if (!channelId) return 'no_channel';
  let state = await loadBoard(ctx.db);
  if (state && state.channelId !== channelId) state = undefined;
  const body = renderBoard(await currentBoosters(ctx.db));
  const text = body.embeds![0]!.description!;
  if (state?.text === text) return 'unchanged';
  if (state) {
    try {
      await ctx.discord.editMessage(channelId, state.messageId, body);
      await saveBoard(ctx.db, { ...state, text });
      return 'edited';
    } catch (err) {
      if (!(err instanceof DiscordHttpError && err.status === 404)) throw err;
    }
  }
  const { id } = await ctx.discord.sendMessage(channelId, body);
  await saveBoard(ctx.db, { channelId, messageId: id, text });
  return 'posted';
}

/** BOT から呼ぶ（失敗してもほかの処理を止めない） */
export async function boostTick(ctx: BoostCtx, now = new Date(), only?: string): Promise<void> {
  try {
    await processBoosters(ctx, now, only);
  } catch (err) {
    logger.warn({ err }, 'boost thanks failed');
  }
  try {
    await updateBoard(ctx);
  } catch (err) {
    logger.warn({ err }, 'hounou board update failed');
  }
}

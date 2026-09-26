import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { boostMessages, boostThanks, members, settings, shopItems, shopPurchases } from '../db/schema.js';
import { DiscordHttpError, type DiscordActions, type MessageBody } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { banzukeChannelId } from './banzuke.js';

/**
 * サーバーブースト（奉納）のお礼。お金（花びら）は渡さない（2026-09 にやめた）。
 * - ブースト 1 回ごとに: #慶事 にお知らせ・本人に DM
 *   Discord がシステムメッセージチャンネルに出す「ブーストしました」のメッセージで数える（1 人が何回ブーストしているかは BOT に分からないため）。
 *   そのメッセージが出ない設定のときは、1 人が始めたときに 1 回。
 * - #番付 に「奉納板」（今奉納してくれている人の一覧・回数）を貼って書き換える
 * - 奉納している間の特典: 授与品の割引（shop.ts の priceOf）など
 * BOT は 10 分ごとと、ブーストが始まったときに processBoosters を呼ぶ。止まっていた間の分もここで拾う。
 */

export type BoostCtx = { db: Db; cfg: GuildConfig; discord: DiscordActions };

/** 奉納の色（朱） */
const SHU = 0xd7003a;

export type ThankResult = { kind: 'new' | 'none'; /** ブーストの回数（メッセージで数えたとき） */ count?: number };

/** Discord の「ブーストしました」のシステムメッセージ（8）と、レベルが上がったときのもの（9〜11） */
export const BOOST_MESSAGE_TYPES: ReadonlySet<number> = new Set([8, 9, 10, 11]);

/** そのメッセージが何回分か（2 回以上まとめてブーストすると、本文に回数が入る） */
export function boostCountOf(content: string): number {
  const n = Number(content.trim());
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : 1;
}

/**
 * 1 人分の奉納を記録する。同じ奉納（始めた日時）のお知らせは 1 回だけ。
 * ブーストのお礼にお金（花びら）は渡さない（2026-09 にやめた）。
 */
export async function thankBooster(db: Db, memberId: string, since: Date, now: Date): Promise<ThankResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'boost:' + memberId}))`);
    const rows = await tx.select().from(boostThanks).where(and(eq(boostThanks.memberId, memberId), eq(boostThanks.since, since)));
    if (rows.length) return { kind: 'none' as const };
    await tx.insert(boostThanks).values({ memberId, since, announcedAt: now });
    return { kind: 'new' as const };
  });
}

/** 今奉納してくれている人（在籍中・BOT でない。始めた順） */
export async function currentBoosters(db: Db): Promise<{ id: string; name: string; since: Date; boosts: number }[]> {
  const rows = await db
    .select({ id: members.id, name: members.displayName, since: members.boostingSince })
    .from(members)
    .where(and(isNotNull(members.boostingSince), isNull(members.leftAt), eq(members.isBot, false)))
    .orderBy(asc(members.boostingSince), asc(members.id));
  if (!rows.length) return [];
  const msgs = await db
    .select({ memberId: boostMessages.memberId, count: boostMessages.count, at: boostMessages.at })
    .from(boostMessages)
    .where(inArray(boostMessages.memberId, rows.map((r) => r.id)));
  return rows.map((r) => {
    // 今の奉納（始めた日時より後）の「ブーストしました」の回数。数えられていなければ 1 回
    const since = r.since!;
    const counted = msgs.filter((m) => m.memberId === r.id && m.at.getTime() >= since.getTime() - SINCE_SLACK_MS).reduce((n, m) => n + m.count, 0);
    return { id: r.id, name: r.name, since, boosts: Math.max(1, counted) };
  });
}

/** Discord の「ブーストを始めた日時」と「ブーストしました」のメッセージの時刻のずれ */
const SINCE_SLACK_MS = 10 * 60_000;

/** {名前} などを置き換える */
function fill(text: string, memberId: string, cfg: GuildConfig): string {
  return text
    .replaceAll('{名前}', `<@${memberId}>`)
    .replaceAll('{通貨}', cfg.economy.currencyName)
    .replaceAll('{通貨絵文字}', cfg.economy.currencyEmoji);
}

export function boostAnnouncement(memberId: string, cfg: GuildConfig, count = 1): MessageBody {
  const text = fill(cfg.boost.announceText, memberId, cfg) + (count > 1 ? `\n-# ブースト ${count} 回分` : '');
  return { content: '', embeds: [{ description: text, color: SHU }] };
}

/** 本人への DM。お礼の花びら・割引の案内を BOT が足す */
export function boostDm(memberId: string, cfg: GuildConfig, r: ThankResult): string {
  const e = cfg.economy;
  const room = cfg.rooms.boosterDiscountPercent;
  const perks = [
    '・#授与所 の「🏮 奉納限定」の授与品（金色の色守り・奉納者の称号など）が受けられます',
    e.boostDiscountPercent > 0 ? `・授与品が **${e.boostDiscountPercent}% 引き**（免罪符・贈り物をのぞく）` : '',
    '・「絵馬の奉納」（自己紹介のピン留め）が無料',
    room >= 100 ? '・宿坊・宵宮の部屋代が無料' : room > 0 ? `・宿坊・宵宮の部屋代が **${room}% 引き**` : '',
    '・#番付 の「🏮 奉納板」にお名前が載ります',
  ].filter(Boolean);
  return [
    fill(cfg.boost.dmText, memberId, cfg),
    ...(r.count && r.count > 1 ? [`（ブースト ${r.count} 回分、ありがとうございます）`] : []),
    '奉納してくださっている間の特典:',
    ...perks,
  ].join('\n');
}

/** 今奉納している人全員について、お礼が要るか見て、お知らせ・DM を出す */
export async function processBoosters(
  ctx: BoostCtx,
  now = new Date(),
  only?: string,
  opts: { byMessage?: boolean } = {},
): Promise<{ announced: number }> {
  let announced = 0;
  for (const b of await currentBoosters(ctx.db)) {
    if (only && b.id !== only) continue;
    const r = await thankBooster(ctx.db, b.id, b.since, now);
    // お知らせ・DM は、「ブーストしました」のメッセージが出る設定ならそちらで出す
    if (r.kind === 'none' || opts.byMessage) continue;
    announced++;
    try {
      await ctx.discord.sendMessage(ctx.cfg.channels.keiji, boostAnnouncement(b.id, ctx.cfg));
    } catch (err) {
      logger.warn({ err, memberId: b.id }, 'boost announcement failed');
    }
    await ctx.discord.sendDm(b.id, boostDm(b.id, ctx.cfg, r));
  }
  return { announced };
}

/**
 * ブースト 1 回ごとのお知らせと DM（Discord の「ブーストしました」のメッセージ 1 件につき 1 回）。
 * 同じメッセージでは 2 回出さない。BOT が止まっていた間のものは、起動したときに読み直して拾う。回数は奉納板に使う。
 */
export async function thankBoostMessage(
  ctx: BoostCtx,
  input: { messageId: string; memberId: string; count: number },
  now = new Date(),
): Promise<{ status: 'ok' } | { status: 'duplicate' }> {
  const inserted = await ctx.db
    .insert(boostMessages)
    .values({ messageId: input.messageId, memberId: input.memberId, count: input.count, granted: 0, at: now })
    .onConflictDoNothing()
    .returning({ id: boostMessages.messageId });
  if (!inserted.length) return { status: 'duplicate' };
  try {
    await ctx.discord.sendMessage(ctx.cfg.channels.keiji, boostAnnouncement(input.memberId, ctx.cfg, input.count));
  } catch (err) {
    logger.warn({ err, memberId: input.memberId }, 'boost announcement failed');
  }
  await ctx.discord.sendDm(input.memberId, boostDm(input.memberId, ctx.cfg, { kind: 'new', count: input.count }));
  return { status: 'ok' };
}

// ───────── 奉納板（#番付） ─────────

const fmtMonth = (d: Date) => {
  const j = new Date(d.getTime() + 9 * 3_600_000);
  return `${j.getUTCFullYear()}年${j.getUTCMonth() + 1}月`;
};

export function renderBoard(boosters: { id: string; since: Date; boosts?: number }[]): MessageBody {
  const list = boosters.length
    ? boosters.map((b) => `- <@${b.id}> … ${fmtMonth(b.since)}から・ブースト ${b.boosts ?? 1} 回`).join('\n')
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
export async function boostTick(ctx: BoostCtx, now = new Date(), only?: string, opts: { byMessage?: boolean } = {}): Promise<void> {
  try {
    await processBoosters(ctx, now, only, opts);
  } catch (err) {
    logger.warn({ err }, 'boost thanks failed');
  }
  try {
    await updateBoard(ctx);
  } catch (err) {
    logger.warn({ err }, 'hounou board update failed');
  }
  try {
    const n = await endBoosterOnlyRoles(ctx, now);
    if (n) logger.info({ ended: n }, 'booster-only roles removed');
  } catch (err) {
    logger.warn({ err }, 'booster-only roles check failed');
  }
}

/** 買ってすぐは外さない（Discord からブーストのお知らせが届くまでの間） */
const BOOSTER_GRACE_MS = 15 * 60_000;

/** 奉納をやめた人の、奉納限定のロール（金色の色守り・奉納者の称号など）を外す */
export async function endBoosterOnlyRoles(ctx: BoostCtx, now = new Date()): Promise<number> {
  const rows = await ctx.db
    .select({ id: shopPurchases.id, memberId: shopPurchases.memberId, roleId: shopPurchases.roleId, createdAt: shopPurchases.createdAt })
    .from(shopPurchases)
    .innerJoin(shopItems, eq(shopItems.id, shopPurchases.itemId))
    .where(and(eq(shopItems.boosterOnly, true), eq(shopPurchases.kind, 'role'), isNull(shopPurchases.endedAt)));
  if (!rows.length) return 0;
  const boosting = new Set((await currentBoosters(ctx.db)).map((b) => b.id));
  let ended = 0;
  for (const r of rows) {
    if (boosting.has(r.memberId) || now.getTime() - r.createdAt.getTime() < BOOSTER_GRACE_MS) continue;
    if (r.roleId) {
      try {
        await ctx.discord.removeRole(ctx.cfg.guildId, r.memberId, r.roleId, '奉納（ブースト）が終わった');
      } catch (err) {
        // 退出した人など
        logger.debug({ err }, 'booster-only role remove failed');
      }
    }
    await ctx.db.update(shopPurchases).set({ endedAt: now }).where(eq(shopPurchases.id, r.id));
    ended++;
  }
  return ended;
}

/**
 * 起動したときに読み直す「ブーストしました」のメッセージは、この機能が動き始めた時より後のものだけ
 * （前からあるメッセージで、あとからまとめて贈らないように）。はじめて呼んだときに今を覚える。
 */
export async function boostCatchupSince(db: Db, now = new Date()): Promise<Date> {
  const key = 'boost_messages_since';
  await db.insert(settings).values({ key, value: { at: now.toISOString() }, updatedBy: 'system' }).onConflictDoNothing();
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  const at = (row?.value as { at?: string } | undefined)?.at;
  return at ? new Date(at) : now;
}

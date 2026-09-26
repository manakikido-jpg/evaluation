import { and, asc, count, desc, eq, gte, isNull, lt, sql, type SQL } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { members, settings, shuin } from '../db/schema.js';
import { DiscordHttpError, type DiscordActions, type MessageBody } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { guildChannelsCached } from './notices.js';

/**
 * 番付: #番付 に「今月のご縁」「累計のご縁」「今月たくさん朱印を押した人」を BOT が貼り、10 分ごとに書き換える。
 * 月が変わったら、先月の分を「確定」にして残し、新しい番付を下に貼る。
 */

export type BanzukeEntry = { memberId: string; name: string; value: number };
export type BanzukeData = { month: JstMonth; monthly: BanzukeEntry[]; total: BanzukeEntry[]; givers: BanzukeEntry[] };
export type JstMonth = { key: string; label: string; start: Date; end: Date };

const TOP = 10;
const TOP_GIVERS = 5;
/** カードの左の線の色（金） */
const GOLD = 0xd4a017;
const MEDAL = ['🥇', '🥈', '🥉'];

/** 日本時間のその月（key: 2026-09、label: 2026年9月） */
export function jstMonth(now: Date, offset = 0): JstMonth {
  const jst = new Date(now.getTime() + 9 * 3_600_000);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth() + offset;
  const start = new Date(Date.UTC(y, m, 1) - 9 * 3_600_000);
  const end = new Date(Date.UTC(y, m + 1, 1) - 9 * 3_600_000);
  const s = new Date(start.getTime() + 9 * 3_600_000);
  const key = `${s.getUTCFullYear()}-${String(s.getUTCMonth() + 1).padStart(2, '0')}`;
  return { key, label: `${s.getUTCFullYear()}年${s.getUTCMonth() + 1}月`, start, end };
}

/** 在籍中の人（退出した人・BOT は載せない） */
const present = (col: typeof shuin.receiverId | typeof shuin.giverId) => [eq(members.id, col), isNull(members.leftAt), eq(members.isBot, false)];

async function goenRanking(db: Db, where: SQL[]): Promise<BanzukeEntry[]> {
  const total = sql<number>`sum(${shuin.weight})::int`;
  const rows = await db
    .select({ memberId: shuin.receiverId, name: members.displayName, value: total })
    .from(shuin)
    .innerJoin(members, and(...present(shuin.receiverId)))
    .where(and(isNull(shuin.revokedAt), ...where))
    .groupBy(shuin.receiverId, members.displayName)
    .orderBy(desc(total), asc(shuin.receiverId))
    .limit(TOP);
  return rows.map((r) => ({ ...r, value: Number(r.value) }));
}

export async function banzukeData(db: Db, month: JstMonth): Promise<BanzukeData> {
  const inMonth = [gte(shuin.createdAt, month.start), lt(shuin.createdAt, month.end)];
  const n = count();
  const givers = await db
    .select({ memberId: shuin.giverId, name: members.displayName, value: n })
    .from(shuin)
    .innerJoin(members, and(...present(shuin.giverId)))
    .where(and(isNull(shuin.revokedAt), ...inMonth))
    .groupBy(shuin.giverId, members.displayName)
    .orderBy(desc(n), asc(shuin.giverId))
    .limit(TOP_GIVERS);
  return {
    month,
    monthly: await goenRanking(db, inMonth),
    total: await goenRanking(db, []),
    givers: givers.map((r) => ({ ...r, value: Number(r.value) })),
  };
}

/** 名前に * や _ があっても太字などにならないように */
const escapeMd = (s: string) => s.replace(/([\\*_~`|>#-])/g, '\\$1');

/** 同じ数なら同じ順位（1, 1, 3） */
function lines(entries: BanzukeEntry[], unit: (v: number) => string): string {
  if (!entries.length) return '-# まだありません';
  let rank = 0;
  return entries
    .map((e, i) => {
      if (i === 0 || e.value !== entries[i - 1]!.value) rank = i + 1;
      const head = MEDAL[rank - 1] ?? `**${rank}.**`;
      return `${head} ${escapeMd(e.name)} … ${unit(e.value)}`;
    })
    .join('\n');
}

export function renderBanzuke(d: BanzukeData, opts: { final?: boolean } = {}): MessageBody {
  const parts = [
    `### 🌸 ${opts.final ? '' : '今月の'}ご縁`,
    lines(d.monthly, (v) => `ご縁 ${v}`),
    ...(opts.final ? [] : ['### 🏆 累計のご縁', lines(d.total, (v) => `ご縁 ${v}`)]),
    `### 🚶 ${opts.final ? '' : '今月'}たくさん朱印を押した人`,
    lines(d.givers, (v) => `${v} 人`),
    '',
    opts.final ? `-# ${d.month.label}の番付はこれで確定です` : '-# 10 分ごとに更新します。朱印を押す・もらうと載ります',
  ];
  return {
    content: '',
    embeds: [{ title: `📜 番付 ― ${d.month.label}${opts.final ? '（確定）' : ''}`, description: parts.join('\n'), color: GOLD }],
  };
}

// ───────── 貼る・書き換える ─────────

type BanzukeState = { channelId: string; messageId: string; month: string; text: string };
const KEY = 'banzuke';

async function loadState(db: Db): Promise<BanzukeState | undefined> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  const v = row?.value as Partial<BanzukeState> | undefined;
  return v?.channelId && v.messageId && v.month ? (v as BanzukeState) : undefined;
}

async function saveState(db: Db, value: BanzukeState): Promise<void> {
  await db
    .insert(settings)
    .values({ key: KEY, value, updatedBy: 'system' })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: 'system', updatedAt: new Date() } });
}

/** #番付 のチャンネル（設定になければ「番付」という名前のテキストチャンネル） */
export async function banzukeChannelId(cfg: GuildConfig, discord: DiscordActions): Promise<string | undefined> {
  if (cfg.channels.banzuke) return cfg.channels.banzuke;
  const channels = await guildChannelsCached(discord, cfg.guildId);
  return channels.find((c) => c.type === 0 && c.name === '番付')?.id;
}

export type BanzukeResult = 'posted' | 'edited' | 'unchanged' | 'no_channel';

/** 10 分ごとに呼ぶ */
export async function updateBanzuke(ctx: { db: Db; cfg: GuildConfig; discord: DiscordActions }, now: Date): Promise<BanzukeResult> {
  const channelId = await banzukeChannelId(ctx.cfg, ctx.discord);
  if (!channelId) return 'no_channel';
  let state = await loadState(ctx.db);
  if (state && state.channelId !== channelId) state = undefined;
  const month = jstMonth(now);

  // 月が変わった: 先月の番付を「確定」にして残し、今月の分は新しく貼る
  if (state && state.month !== month.key) {
    const prev = jstMonth(now, -1);
    try {
      await ctx.discord.editMessage(channelId, state.messageId, renderBanzuke(await banzukeData(ctx.db, prev), { final: true }));
    } catch (err) {
      if (!(err instanceof DiscordHttpError && err.status === 404)) throw err;
    }
    state = undefined;
  }

  const body = renderBanzuke(await banzukeData(ctx.db, month));
  const text = body.embeds![0]!.description!;
  if (state?.text === text) return 'unchanged';

  if (state) {
    try {
      await ctx.discord.editMessage(channelId, state.messageId, body);
      await saveState(ctx.db, { ...state, text });
      return 'edited';
    } catch (err) {
      // 手で消されていたら、貼り直す
      if (!(err instanceof DiscordHttpError && err.status === 404)) throw err;
    }
  }
  const { id } = await ctx.discord.sendMessage(channelId, body);
  await saveState(ctx.db, { channelId, messageId: id, month: month.key, text });
  return 'posted';
}

/** BOT から呼ぶ（失敗してもほかの処理を止めない） */
export async function updateBanzukeQuietly(ctx: { db: Db; cfg: GuildConfig; discord: DiscordActions }, now = new Date()): Promise<void> {
  try {
    const r = await updateBanzuke(ctx, now);
    if (r === 'posted') logger.info('banzuke posted');
  } catch (err) {
    logger.warn({ err }, 'banzuke update failed');
  }
}

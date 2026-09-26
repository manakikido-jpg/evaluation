import { asc, eq, max } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { notices, type Notice } from '../db/schema.js';
import { DiscordHttpError, type DiscordActions, type GuildChannel, type MessageBody } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { audit } from './audit.js';
import { DEFAULT_NOTICES } from './noticeDefaults.js';
import { omikujiRange } from './omikuji.js';

/**
 * 掲示: #鳥居・#しきたり などに BOT が投稿する文面。
 * 本文は {免罪符の値段} などの差し込みを含むひな形で、投稿・書き換えのたびに今の設定で置き換える。
 * 設定を変えたら syncPostedNotices で投稿済みのメッセージも書き換える。
 */

export type NoticeCtx = { db: Db; cfg: GuildConfig; discord: DiscordActions };

export type NoticeStyle = 'embed' | 'text';

/** 見せ方ごとの名前と文字数の上限（Discord の決まり: 普通のメッセージ 2000・カードの本文 4096） */
export const NOTICE_STYLES: Record<NoticeStyle, { label: string; max: number }> = {
  embed: { label: 'カード（1 つずつ区切られて見やすい）', max: 4096 },
  text: { label: '普通のメッセージ', max: 2000 },
};

export const maxLengthOf = (style: string) => NOTICE_STYLES[style === 'text' ? 'text' : 'embed'].max;
export const isNoticeStyle = (v: unknown): v is NoticeStyle => v === 'embed' || v === 'text';

/** カードの左の線の色（朱色） */
const SHU = 0xd7003a;

function messageBody(style: string, text: string): MessageBody {
  // 見せ方を切り替えたときに前の形が残らないよう、使わないほうは空にする
  return style === 'text' ? { content: text, embeds: [] } : { content: '', embeds: [{ description: text, color: SHU }] };
}

const tooLong = (style: string, text: string) => !text.trim() || text.length > maxLengthOf(style);

/** チャンネルとして選べる種類（テキスト・お知らせ） */
const POSTABLE = new Set([0, 5]);

// ───────── 差し込み ─────────

export type NoticeVariable = { name: string; value: string; note: string };

/** 本文で使える {名前} と、いまの値 */
export function noticeVariables(cfg: GuildConfig): NoticeVariable[] {
  const e = cfg.economy;
  const ranks = [...cfg.ranks].sort((a, b) => a.weight - b.weight);
  const firstAuto = ranks.filter((r) => r.auto).sort((a, b) => a.requiredGoen - b.requiredGoen)[0];
  const rankLine = (r: (typeof ranks)[number]) => {
    const how = !r.auto ? (r.key === 'guji' ? '鯖主' : '運営') : r === firstAuto ? '入ったとき' : `ご縁 ${r.requiredGoen}`;
    return `- ${r.emoji} **${r.name}** … ${how} ・ 格 ${r.weight}`;
  };
  return [
    { name: '通貨', value: e.currencyName, note: '通貨の名前' },
    { name: '通貨絵文字', value: e.currencyEmoji, note: '通貨の絵文字' },
    { name: '免罪符の値段', value: String(e.menzaifuPrice), note: '' },
    { name: '免罪符の回数', value: String(e.menzaifuMaxUses), note: '1 人が買える回数' },
    { name: '通話10分', value: String(e.voicePer10Min), note: '通話 10 分ごとにもらえる量' },
    { name: '通話の上限', value: String(e.voiceDailyCap), note: '通話でもらえる 1 日の上限' },
    { name: '朱印を押すと', value: String(e.shuinGive), note: '朱印を押すともらえる量' },
    { name: '朱印を頂くと', value: String(e.shuinReceive), note: '朱印を頂くともらえる量' },
    { name: '初期配布', value: String(e.joinBonus), note: '入鯖が承認されたときに配る量' },
    { name: 'おみくじの花びら', value: omikujiRange(e), note: 'おみくじでもらえる量（凶〜大吉）' },
    { name: 'お参り期間', value: String(cfg.omairi.days), note: '日数' },
    { name: 'お参り延長', value: String(cfg.omairi.extendDays), note: '自動で延ばす日数' },
    ...ranks.filter((r) => r.auto).map((r) => ({ name: `${r.name}のご縁`, value: String(r.requiredGoen), note: '昇格に必要なご縁' })),
    ...ranks.map((r) => ({ name: `${r.name}の格`, value: String(r.weight), note: '朱印 1 回のご縁' })),
    { name: '役職一覧', value: [...ranks].map(rankLine).join('\n'), note: '役職・昇格ライン・格の箇条書き' },
  ];
}

export type Rendered = { text: string; unknown: string[] };

/**
 * {名前} を今の値に、{#チャンネル名} をチャンネルへのリンクに置き換える。
 * forPreview のときはリンクの代わりに「#チャンネル名」と表示する。知らない名前はそのまま残す。
 */
export function renderNotice(body: string, cfg: GuildConfig, channels: GuildChannel[], opts: { forPreview?: boolean } = {}): Rendered {
  const vars = new Map(noticeVariables(cfg).map((v) => [v.name, v.value]));
  const unknown = new Set<string>();
  const text = body.replace(/\{(#?)([^{}\n]{1,40})\}/g, (whole, hash: string, rawName: string) => {
    const name = rawName.trim();
    if (hash) {
      const ch = findChannel(channels, name);
      if (!ch) {
        unknown.add(`#${name}`);
        return `#${name}`;
      }
      return opts.forPreview ? `#${ch.name}` : `<#${ch.id}>`;
    }
    const v = vars.get(name);
    if (v === undefined) {
      unknown.add(name);
      return whole;
    }
    return v;
  });
  return { text, unknown: [...unknown] };
}

function findChannel(channels: GuildChannel[], name: string): GuildChannel | undefined {
  const n = name.toLowerCase();
  const same = channels.filter((c) => c.name.toLowerCase() === n && c.type !== 4);
  // 宵宮のように同じ名前のテキストと通話があるときは、テキストを選ぶ
  return same.find((c) => POSTABLE.has(c.type)) ?? same[0];
}

/** 投稿先に選べるチャンネル（カテゴリ順） */
export function postableChannels(channels: GuildChannel[]): (GuildChannel & { category: string | null })[] {
  const cats = new Map(channels.filter((c) => c.type === 4).map((c) => [c.id, c]));
  const catPos = (c: GuildChannel) => (c.parent_id ? (cats.get(c.parent_id)?.position ?? 0) + 1 : 0);
  return channels
    .filter((c) => POSTABLE.has(c.type))
    .sort((a, b) => catPos(a) - catPos(b) || a.position - b.position)
    .map((c) => ({ ...c, category: c.parent_id ? (cats.get(c.parent_id)?.name ?? null) : null }));
}

// ───────── チャンネル一覧（プレビューのたびに Discord に聞かないよう、少しだけ覚えておく） ─────────

const channelCache = new WeakMap<DiscordActions, { at: number; guildId: string; list: GuildChannel[] }>();
const CACHE_MS = 30_000;

export async function guildChannelsCached(discord: DiscordActions, guildId: string, fresh = false): Promise<GuildChannel[]> {
  const hit = channelCache.get(discord);
  if (!fresh && hit && hit.guildId === guildId && Date.now() - hit.at < CACHE_MS) return hit.list;
  const list = await discord.guildChannels(guildId);
  channelCache.set(discord, { at: Date.now(), guildId, list });
  return list;
}

// ───────── 保存 ─────────

export async function listNotices(db: Db): Promise<Notice[]> {
  return db.select().from(notices).orderBy(asc(notices.channelId), asc(notices.position), asc(notices.id));
}

export async function getNotice(db: Db, id: number): Promise<Notice | undefined> {
  const [row] = await db.select().from(notices).where(eq(notices.id, id));
  return row;
}

export async function createNotice(
  db: Db,
  input: { channelId: string; title: string; body: string; style?: NoticeStyle; by: string },
): Promise<Notice> {
  const [last] = await db
    .select({ p: max(notices.position) })
    .from(notices)
    .where(eq(notices.channelId, input.channelId));
  const [row] = await db
    .insert(notices)
    .values({
      channelId: input.channelId,
      position: (last?.p ?? -1) + 1,
      title: input.title,
      body: input.body,
      style: input.style ?? 'embed',
      updatedBy: input.by,
    })
    .returning();
  await audit(db, { actorId: input.by, action: 'notice.create', detail: { id: row!.id, title: input.title }, via: 'web' });
  return row!;
}

export async function updateNotice(db: Db, id: number, input: { title: string; body: string; style?: NoticeStyle; by: string }): Promise<void> {
  await db
    .update(notices)
    .set({ title: input.title, body: input.body, ...(input.style ? { style: input.style } : {}), updatedBy: input.by, updatedAt: new Date() })
    .where(eq(notices.id, id));
  await audit(db, { actorId: input.by, action: 'notice.update', detail: { id, title: input.title }, via: 'web' });
}

/** 同じチャンネルの中で 1 つ上・下と入れ替える（Discord の並びは「投稿し直す」で反映） */
export async function moveNotice(db: Db, id: number, dir: 'up' | 'down'): Promise<void> {
  const n = await getNotice(db, id);
  if (!n) return;
  const list = await db.select().from(notices).where(eq(notices.channelId, n.channelId)).orderBy(asc(notices.position), asc(notices.id));
  const i = list.findIndex((x) => x.id === id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= list.length) return;
  const order = [...list];
  [order[i], order[j]] = [order[j]!, order[i]!];
  await db.transaction(async (tx) => {
    for (const [pos, x] of order.entries()) await tx.update(notices).set({ position: pos }).where(eq(notices.id, x.id));
  });
}

export async function deleteNotice(ctx: NoticeCtx, id: number, by: string): Promise<void> {
  const n = await getNotice(ctx.db, id);
  if (!n) return;
  if (n.messageId) await deleteMessageQuietly(ctx.discord, n.channelId, n.messageId);
  await ctx.db.delete(notices).where(eq(notices.id, id));
  await audit(ctx.db, { actorId: by, action: 'notice.delete', detail: { id, title: n.title }, via: 'web' });
}

// ───────── 投稿 ─────────

export type PublishResult = 'posted' | 'edited' | 'reposted' | 'unchanged' | 'too_long';

/** 未投稿なら投稿、投稿済みなら書き換える。Discord 側で消されていたら投稿し直す */
export async function publishNotice(ctx: NoticeCtx, id: number, by: string): Promise<PublishResult> {
  const n = await getNotice(ctx.db, id);
  if (!n) throw new Error(`notice ${id} not found`);
  const { text } = renderNotice(n.body, ctx.cfg, await guildChannelsCached(ctx.discord, ctx.cfg.guildId));
  if (tooLong(n.style, text)) return 'too_long';
  if (noticeStatus(n, text) === 'posted') return 'unchanged';
  const body = messageBody(n.style, text);

  let result: PublishResult;
  let messageId = n.messageId;
  if (messageId) {
    try {
      await ctx.discord.editMessage(n.channelId, messageId, body);
      result = 'edited';
    } catch (err) {
      if (!(err instanceof DiscordHttpError && err.status === 404)) throw err;
      messageId = (await ctx.discord.sendMessage(n.channelId, body)).id;
      result = 'reposted';
    }
  } else {
    messageId = (await ctx.discord.sendMessage(n.channelId, body)).id;
    result = 'posted';
  }
  await ctx.db.update(notices).set({ messageId, postedText: text, postedStyle: n.style }).where(eq(notices.id, id));
  await audit(ctx.db, { actorId: by, action: 'notice.publish', detail: { id, title: n.title, result }, via: by === 'system' ? 'system' : 'web' });
  return result;
}

/** まだ反映していないもの（未投稿・変更あり）を全部反映する */
export async function publishAll(ctx: NoticeCtx, by: string): Promise<{ done: number; tooLong: string[] }> {
  const channels = await guildChannelsCached(ctx.discord, ctx.cfg.guildId, true);
  let done = 0;
  const tooLong: string[] = [];
  for (const n of await listNotices(ctx.db)) {
    if (noticeStatus(n, renderNotice(n.body, ctx.cfg, channels).text) === 'posted') continue;
    const r = await publishNotice(ctx, n.id, by);
    if (r === 'too_long') tooLong.push(n.title);
    else if (r !== 'unchanged') done++;
  }
  return { done, tooLong };
}

/** チャンネルの掲示を全部消して、順番どおりに投稿し直す（並べ替え・途中に追加したとき用） */
export async function repostChannel(ctx: NoticeCtx, channelId: string, by: string): Promise<{ done: number; tooLong: string[] }> {
  const list = await ctx.db.select().from(notices).where(eq(notices.channelId, channelId)).orderBy(asc(notices.position), asc(notices.id));
  const channels = await guildChannelsCached(ctx.discord, ctx.cfg.guildId, true);
  const rendered = list.map((n) => ({ n, text: renderNotice(n.body, ctx.cfg, channels).text }));
  const over = rendered.filter((r) => tooLong(r.n.style, r.text)).map((r) => r.n.title);
  if (over.length) return { done: 0, tooLong: over };

  for (const { n } of rendered) {
    if (n.messageId) await deleteMessageQuietly(ctx.discord, channelId, n.messageId);
    await ctx.db.update(notices).set({ messageId: null, postedText: null, postedStyle: null }).where(eq(notices.id, n.id));
  }
  for (const { n, text } of rendered) {
    const { id } = await ctx.discord.sendMessage(channelId, messageBody(n.style, text));
    await ctx.db.update(notices).set({ messageId: id, postedText: text, postedStyle: n.style }).where(eq(notices.id, n.id));
  }
  await audit(ctx.db, { actorId: by, action: 'notice.repost', detail: { channelId, count: rendered.length }, via: 'web' });
  return { done: rendered.length, tooLong: [] };
}

/**
 * 設定を変えたあとに呼ぶ: 投稿済みの掲示のうち、差し込んだ数字が変わったものを書き換える。
 * 手で書き換えた本文の「未反映」はそのまま（本文を編集中のものは勝手に反映しない）。
 */
export async function syncPostedNotices(ctx: NoticeCtx, before: GuildConfig): Promise<number> {
  let channels: GuildChannel[];
  try {
    channels = await guildChannelsCached(ctx.discord, ctx.cfg.guildId);
  } catch (err) {
    logger.warn({ err }, 'notice sync: could not load channels');
    return 0;
  }
  let changed = 0;
  for (const n of await listNotices(ctx.db)) {
    if (!n.messageId) continue;
    // 設定を変える前の値で差し込んだものが、投稿済みの本文と同じもの（＝本文は反映済み）だけ
    if (noticeStatus(n, renderNotice(n.body, before, channels).text) !== 'posted') continue;
    const text = renderNotice(n.body, ctx.cfg, channels).text;
    if (text === n.postedText || tooLong(n.style, text)) continue;
    try {
      await publishNotice(ctx, n.id, 'system');
      changed++;
    } catch (err) {
      logger.warn({ err, id: n.id }, 'notice sync failed');
    }
  }
  return changed;
}

export type NoticeStatus = 'draft' | 'posted' | 'changed';

export function noticeStatus(n: Notice, renderedText: string): NoticeStatus {
  if (!n.messageId) return 'draft';
  return n.postedText === renderedText && n.postedStyle === n.style ? 'posted' : 'changed';
}

/** 標準の文面を入れる。チャンネルは名前で探す。すでに掲示があるチャンネルには入れない */
export async function seedDefaultNotices(ctx: NoticeCtx, by: string): Promise<{ created: number; missing: string[] }> {
  const channels = await guildChannelsCached(ctx.discord, ctx.cfg.guildId, true);
  // 標準の文面を入れる前から掲示があるチャンネルには入れない（同じチャンネルに続けて入れるので、先に数えておく）
  const existing = new Set((await listNotices(ctx.db)).map((n) => n.channelId));
  const missing = new Set<string>();
  let created = 0;
  for (const t of DEFAULT_NOTICES) {
    const ch = findChannel(channels, t.channelName);
    if (!ch || !POSTABLE.has(ch.type)) {
      missing.add(t.channelName);
      continue;
    }
    if (existing.has(ch.id)) continue;
    await createNotice(ctx.db, { channelId: ch.id, title: t.title, body: t.body, by });
    created++;
  }
  return { created, missing: [...missing] };
}

async function deleteMessageQuietly(discord: DiscordActions, channelId: string, messageId: string): Promise<void> {
  try {
    await discord.deleteMessage(channelId, messageId);
  } catch (err) {
    // すでに消されていれば何もしない
    if (!(err instanceof DiscordHttpError && err.status === 404)) throw err;
  }
}


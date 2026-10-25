import { eq } from 'drizzle-orm';
import { CHANGELOG, LATEST_CHANGE_ID, type ChangelogEntry, type ChangelogKind } from '../changelog.js';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';
import type { DiscordActions, GuildChannel, MessageBody } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { audit } from './audit.js';
import { findChannel } from './notices.js';
import { UPDATE_ANNOUNCEMENTS } from '../updateAnnouncements.js';

/**
 * 📰 更新速報: 更新履歴（src/changelog.ts）を Discord の #更新速報 にカードで出す。
 * 自動にしておくと、BOT が起動したとき（自動更新のたびに起動し直す）に、前に出したものより新しい更新を出す。
 */

export type NewsScope = 'discord' | 'all';
export type UpdateNewsSettings = {
  /** 更新が入ったら自動で出す */
  enabled: boolean;
  /** 決めていなければ名前に「更新速報」を含むチャンネル */
  channelId?: string;
  /** discord = メンバーにも見える変更だけ / all = 社務所Web・運用も */
  scope: NewsScope;
  /** 自動で出したいちばん新しい更新 */
  lastId?: string;
};

export const NEWS_CHANNEL = '更新速報';
const KEY = 'update_news';
const snowflake = (v: unknown) => (typeof v === 'string' && /^\d{17,20}$/.test(v) ? v : undefined);

export async function loadUpdateNews(db: Db): Promise<UpdateNewsSettings> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  const v = (row?.value ?? {}) as Record<string, unknown>;
  return {
    enabled: v.enabled === true,
    channelId: snowflake(v.channelId),
    scope: v.scope === 'all' ? 'all' : 'discord',
    lastId: typeof v.lastId === 'string' ? v.lastId : undefined,
  };
}

export async function saveUpdateNews(db: Db, value: UpdateNewsSettings, by: string): Promise<void> {
  const v = { enabled: value.enabled, channelId: value.channelId ?? null, scope: value.scope, lastId: value.lastId ?? null };
  await db
    .insert(settings)
    .values({ key: KEY, value: v, updatedBy: by })
    .onConflictDoUpdate({ target: settings.key, set: { value: v, updatedBy: by, updatedAt: new Date() } });
}

/** 出す先のチャンネル（選んだものが消えていたら名前で探す） */
export function newsChannelOf(s: UpdateNewsSettings, channels: GuildChannel[]): GuildChannel | undefined {
  const text = (c: GuildChannel) => c.type === 0 || c.type === 5;
  const picked = s.channelId ? channels.find((c) => c.id === s.channelId && text(c)) : undefined;
  if (picked) return picked;
  const named = findChannel(channels, NEWS_CHANNEL);
  return named && text(named) ? named : undefined;
}

export const inScope = (e: ChangelogEntry, scope: NewsScope) => scope === 'all' || e.where.includes('Discord');

// ───────── 見た目 ─────────

export const NEWS_KIND: Record<ChangelogKind, { label: string; color: number }> = {
  new: { label: '✨ 新しい機能', color: 0xd7003a },
  improve: { label: '🔧 使いやすくなりました', color: 0x3cb371 },
  fix: { label: '🩹 直しました', color: 0xe0a030 },
};

const WHERE_LABEL: Record<string, string> = { Discord: 'Discord', 社務所Web: '社務所Web（運営）', 運用: 'サーバーの裏側' };
export const fmtNewsDay = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;

const clip = (s: string, max: number) => s.length > max ? s.slice(0, max - 1) + '…' : s;

/** 周知担当が読む制作メモ。未確認の手順は作らず、元の変更点をたたき台にする。 */
export function announcementFields(e: ChangelogEntry): NonNullable<NonNullable<MessageBody['embeds']>[number]['fields']> {
  const a = e.announcement ?? UPDATE_ANNOUNCEMENTS[e.id];
  const judgment = a ? ({ required: '🔴 周知をお願いします', optional: '🟡 必要に応じて周知', none: '⚪ メンバーへの周知は不要（運営内で確認）' })[a.priority] : '🔎 要確認：周知するか運営と相談';
  const fields = [
    { name: '周知の判断', value: judgment },
    { name: '誰に伝える？', value: clip(a?.audience || (e.where.includes('Discord') ? 'サーバーのメンバー（詳しい対象は要確認）' : '運営・管理画面を使う人'), 160) },
    { name: '案内する操作・手順', value: clip(a?.steps.length ? a.steps.map((s, i) => (i + 1) + '. ' + s).join('\n') : 'この速報には操作手順の記載がありません。周知前に運営へ確認してください。', 700) },
  ];
  if (a?.priority !== 'none') fields.push(
    { name: '周知文のたたき台', value: clip(a?.postText || [e.title, ...e.items].join('\n'), 1000) },
    { name: '画像制作の指示', value: clip(a?.imagePrompt || '画像が必要か運営と相談してください。作る場合は「' + clip(e.title, 100) + '」を見出しにし、この速報で確認できる変更点だけを短く載せます。未記載の操作や料金は追加しないでください。', 800) },
  );
  if (a?.notes) fields.push({ name: '周知前に確認すること', value: clip(a.notes, 350) });
  return fields;
}

/** 1 つの更新のカード */
export function newsEmbed(e: ChangelogEntry): NonNullable<MessageBody['embeds']>[number] {
  return {
    author: { name: NEWS_KIND[e.kind].label },
    title: clip(e.title, 256),
    description: clip(e.items.map((t) => `- ${t}`).join('\n'), 1600),
    fields: announcementFields(e),
    color: NEWS_KIND[e.kind].color,
    footer: { text: clip(`${fmtNewsDay(e.date)} ・ ${e.where.map((w) => WHERE_LABEL[w] ?? w).join('・')}`, 160) },
  };
}

/** 更新をメッセージに分ける（1 通にカード 10 枚・合わせて 6000 文字まで）。古い順に並べる */
export function newsMessages(entries: ChangelogEntry[]): MessageBody[] {
  const sorted = [...entries].reverse();
  const out: MessageBody[] = [];
  let embeds: NonNullable<MessageBody['embeds']> = [];
  let size = 0;
  const flush = () => {
    if (!embeds.length) return;
    const first = out.length === 0;
    const days = [...new Set(sorted.map((e) => fmtNewsDay(e.date)))];
    out.push({
      ...(first ? { content: `## 📰 更新速報\n-# ${clip(days.join('・'), 1200)}のアップデート（${sorted.length} 件）\n周知担当の方へ：各カードの判断・対象・手順を確認し、案内文と画像制作の指示を使って準備してください。` } : {}),
      embeds,
      allowed_mentions: { parse: [] },
    });
    embeds = [];
    size = 0;
  };
  for (const e of sorted) {
    const card = newsEmbed(e);
    const len = (card.title?.length ?? 0) + (card.description?.length ?? 0) + (card.footer?.text.length ?? 0) + (card.author?.name.length ?? 0) + (card.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0);
    if (embeds.length >= 10 || size + len > 5500) flush();
    embeds.push(card);
    size += len;
  }
  flush();
  return out;
}

// ───────── 出す ─────────

export type NewsCtx = { db: Db; discord: DiscordActions; channels: GuildChannel[] };

/** 更新を出す（出したメッセージの数）。出す先がなければ undefined */
export async function postNews(ctx: NewsCtx, entries: ChangelogEntry[], by: string): Promise<number | undefined> {
  const s = await loadUpdateNews(ctx.db);
  const ch = newsChannelOf(s, ctx.channels);
  if (!ch) return undefined;
  const messages = newsMessages(entries);
  for (const m of messages) await ctx.discord.sendMessage(ch.id, m);
  await audit(ctx.db, { actorId: by, action: 'updates.news', detail: { channelId: ch.id, ids: entries.map((e) => e.id) }, via: by === 'system' ? 'system' : 'web' });
  return messages.length;
}

/** まだ自動で出していない更新（新しい順）。前に出した印がなければ空（最初に全部を出さない） */
export function pendingNews(s: UpdateNewsSettings, all: ChangelogEntry[] = CHANGELOG): ChangelogEntry[] {
  if (!s.lastId) return [];
  const i = all.findIndex((e) => e.id === s.lastId);
  if (i < 0) return [];
  return all.slice(0, i).filter((e) => inScope(e, s.scope));
}

/** BOT の起動時: 自動にしていれば、新しい更新を出して印を進める */
export async function announceUpdates(ctx: NewsCtx): Promise<number> {
  const s = await loadUpdateNews(ctx.db);
  if (!s.enabled) return 0;
  const pending = pendingNews(s);
  // 印を先に進める（出している途中で落ちても、同じものを何度も出さない）
  if (s.lastId !== LATEST_CHANGE_ID) await saveUpdateNews(ctx.db, { ...s, lastId: LATEST_CHANGE_ID }, 'system');
  if (!pending.length) return 0;
  try {
    const n = await postNews(ctx, pending, 'system');
    if (n === undefined) logger.warn('update news: channel not found');
    return pending.length;
  } catch (err) {
    logger.warn({ err }, 'update news failed');
    return 0;
  }
}

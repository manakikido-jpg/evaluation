import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { interviews, settings, type Interview } from '../db/schema.js';
import type { DiscordActions, GuildChannel, MessageBody } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { audit } from './audit.js';

/**
 * 面談告知: 社務所Web で日時を決めるだけで、決めた定型文を #面談-告知 に流す。
 * 定型文の {日時} などは、流すときに埋める。
 */

export const DEFAULT_INTERVIEW_TEMPLATE = `# 🍵 面談のお知らせ
**{日時}** から、運営との面談をおこないます（{あと}）。
- 場所: {場所}
- 相談したいこと・気になることがあれば、気軽に来てください
{一言}`;

export const DEFAULT_REMINDER_TEMPLATE = `⏰ **{時刻}** から面談です（{あと}）
- 場所: {場所}`;

const templateSchema = z.object({ name: z.string().min(1).max(30), body: z.string().min(1).max(1800) });
export type InterviewTemplate = z.infer<typeof templateSchema>;

export const DEFAULT_TEMPLATES: InterviewTemplate[] = [{ name: 'いつもの面談', body: DEFAULT_INTERVIEW_TEMPLATE }];

const rawSchema = z.object({
  /** 流すチャンネル（なければ名前に「面談」を含むチャンネル） */
  channelId: z
    .string()
    .regex(/^\d{17,20}$/)
    .optional(),
  /** 定型文（いくつか持てる。いちばん上がはじめに選ばれる） */
  templates: z.array(templateSchema).min(1).max(10).default(DEFAULT_TEMPLATES),
  /** リマインドの文（1 時間前・10 分前に流す） */
  reminderTemplate: z.string().min(1).max(1000).default(DEFAULT_REMINDER_TEMPLATE),
  /** リマインドでも通知を鳴らす（はじめは鳴らさない） */
  remindMention: z.boolean().default(false),
  /** 前に選んだ時刻・場所（次に開いたときに選んでおく） */
  lastTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  lastPlaceChannelId: z
    .string()
    .regex(/^\d{17,20}$/)
    .optional(),
  /** 通知: none なし / here @here / everyone @everyone / ranks すべての役職 / role 決めたロール */
  mention: z.enum(['none', 'here', 'everyone', 'ranks', 'role']).default('none'),
  roleId: z
    .string()
    .regex(/^\d{17,20}$/)
    .optional(),
});

/** 前の版は定型文が 1 つ（template）だった */
export const interviewSchema = z.preprocess((v) => {
  if (!v || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  if (o.templates === undefined && typeof o.template === 'string' && o.template.trim()) {
    const { template, ...rest } = o;
    return { ...rest, templates: [{ name: 'いつもの面談', body: template }] };
  }
  return v;
}, rawSchema);
export type InterviewSettings = z.infer<typeof rawSchema>;

const KEY = 'interview';

export async function loadInterview(db: Db): Promise<InterviewSettings> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  const parsed = interviewSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : interviewSchema.parse({});
}

export async function saveInterview(db: Db, value: InterviewSettings, by: string): Promise<void> {
  await db
    .insert(settings)
    .values({ key: KEY, value, updatedBy: by })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: by, updatedAt: new Date() } });
}

/** 面談告知のチャンネル（決めていなければ、名前に「面談」を含むテキストチャンネル。告知を含むものを先に） */
export function interviewChannelOf(s: InterviewSettings, channels: GuildChannel[]): GuildChannel | undefined {
  const text = channels.filter((c) => c.type === 0 || c.type === 5);
  if (s.channelId) return text.find((c) => c.id === s.channelId);
  const named = text.filter((c) => c.name.includes('面談'));
  return named.find((c) => c.name.includes('告知')) ?? named[0];
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

/** 日本時間の「9月28日（日）」「21:00」 */
export function jstParts(at: Date): { date: string; time: string } {
  const j = new Date(at.getTime() + 9 * 3_600_000);
  const hh = String(j.getUTCHours()).padStart(2, '0');
  const mm = String(j.getUTCMinutes()).padStart(2, '0');
  return { date: `${j.getUTCMonth() + 1}月${j.getUTCDate()}日（${WEEK[j.getUTCDay()]}）`, time: `${hh}:${mm}` };
}

/** 画面の「2026-09-28T21:00」（日本時間）を Date に */
export function parseJstLocal(v: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v.trim());
  if (!m) return undefined;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]) - 9, Number(m[5])));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * 定型文を埋める: {日時} {日付} {時刻} {あと}（Discord で「あと 2 時間」のように出る）{場所} {一言}。
 * {場所}・{一言} が空なら、その行ごと消す。
 */
export function renderInterview(template: string, v: { at: Date; place?: string; note?: string }): string {
  const { date, time } = jstParts(v.at);
  const unix = Math.floor(v.at.getTime() / 1000);
  const place = v.place?.trim() ?? '';
  const note = v.note?.trim() ?? '';
  return template
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !(line.includes('{場所}') && !place) && !(line.includes('{一言}') && !note))
    .join('\n')
    .replaceAll('{日時}', `${date} ${time}`)
    .replaceAll('{日付}', date)
    .replaceAll('{時刻}', time)
    .replaceAll('{あと}', `<t:${unix}:R>`)
    .replaceAll('{場所}', place)
    .replaceAll('{一言}', note)
    .trim();
}

/** 流すメッセージ（通知つき） */
export function interviewMessage(s: InterviewSettings, text: string, rankRoleIds: readonly string[] = []): MessageBody {
  if (s.mention === 'ranks' && rankRoleIds.length) {
    const ids = [...new Set(rankRoleIds)];
    return { content: `${ids.map((id) => `<@&${id}>`).join(' ')}\n${text}`.slice(0, 2000), allowed_mentions: { parse: [], roles: ids } };
  }
  const head = s.mention === 'here' ? '@here\n' : s.mention === 'everyone' ? '@everyone\n' : s.mention === 'role' && s.roleId ? `<@&${s.roleId}>\n` : '';
  const allowed: MessageBody['allowed_mentions'] =
    s.mention === 'here' || s.mention === 'everyone' ? { parse: ['everyone'] } : s.mention === 'role' && s.roleId ? { roles: [s.roleId] } : { parse: [] };
  return { content: `${head}${text}`.slice(0, 2000), allowed_mentions: allowed };
}


// ───────── 面談（予約・リマインド・変更・中止） ─────────

/** rankRoleIds: 「すべての役職」に通知するときの役職のロール */
export type InterviewCtx = { db: Db; discord: DiscordActions; rankRoleIds?: readonly string[] };

/** {場所} に入れる文字（通話チャンネルならリンク） */
export const placeOf = (i: Pick<Interview, 'placeChannelId' | 'placeText'>, forPreview?: (id: string) => string | undefined) =>
  i.placeChannelId ? (forPreview ? `🔊 ${forPreview(i.placeChannelId) ?? '通話'}` : `🔊 <#${i.placeChannelId}>`) : i.placeText;

export const interviewText = (i: Pick<Interview, 'template' | 'at' | 'placeChannelId' | 'placeText' | 'note'>) =>
  renderInterview(i.template, { at: i.at, place: placeOf(i), note: i.note });

export type NewInterview = {
  at: Date;
  placeChannelId?: string;
  placeText?: string;
  note?: string;
  template: InterviewTemplate;
  channelId: string;
  /** 流す日時（今か前なら、すぐ流す） */
  postAt: Date;
  remind60: boolean;
  remind10: boolean;
};

export async function createInterview(db: Db, input: NewInterview, by: string): Promise<Interview> {
  const [row] = await db
    .insert(interviews)
    .values({
      at: input.at,
      placeChannelId: input.placeChannelId ?? null,
      placeText: input.placeText ?? '',
      note: input.note ?? '',
      templateName: input.template.name,
      template: input.template.body,
      channelId: input.channelId,
      postAt: input.postAt,
      remind60: input.remind60,
      remind10: input.remind10,
      createdBy: by,
    })
    .returning();
  return row!;
}

export async function getInterview(db: Db, id: number): Promise<Interview | undefined> {
  const [row] = await db.select().from(interviews).where(eq(interviews.id, id));
  return row;
}

/** 面談の一覧（新しい日時から） */
export async function listInterviews(db: Db, limit = 30): Promise<Interview[]> {
  return db.select().from(interviews).orderBy(desc(interviews.at), desc(interviews.id)).limit(limit);
}

/** 告知を流す（予約していたもの・今すぐのもの）。通知は設定のとおり */
export async function postInterview(ctx: InterviewCtx, id: number, st: InterviewSettings, now = new Date()): Promise<Interview | undefined> {
  const i = await getInterview(ctx.db, id);
  if (!i || i.status !== 'scheduled') return i;
  const { id: messageId } = await ctx.discord.sendMessage(i.channelId, interviewMessage(st, interviewText(i), ctx.rankRoleIds));
  const [row] = await ctx.db
    .update(interviews)
    .set({ status: 'posted', messageId, postedAt: now, updatedAt: now })
    .where(and(eq(interviews.id, id), eq(interviews.status, 'scheduled')))
    .returning();
  const p = jstParts(i.at);
  await audit(ctx.db, { actorId: i.createdBy, action: 'interview.post', detail: { id, channelId: i.channelId, at: i.at.toISOString(), label: `${p.date} ${p.time}` }, via: 'web' });
  return row;
}

/**
 * 日時・場所・一言を変える。流したあとなら Discord のメッセージも書き換える（通知は鳴らさない）。
 * 日時を変えたら、まだ先のリマインドはもう一度流す
 */
export async function updateInterview(
  ctx: InterviewCtx,
  id: number,
  patch: { at: Date; placeChannelId?: string; placeText?: string; note?: string; postAt?: Date; remind60: boolean; remind10: boolean },
  by: string,
  now = new Date(),
): Promise<'ok' | 'not_found' | 'cancelled'> {
  const i = await getInterview(ctx.db, id);
  if (!i) return 'not_found';
  if (i.status === 'cancelled') return 'cancelled';
  const moved = i.at.getTime() !== patch.at.getTime();
  const next = {
    at: patch.at,
    placeChannelId: patch.placeChannelId ?? null,
    placeText: patch.placeText ?? '',
    note: patch.note ?? '',
    remind60: patch.remind60,
    remind10: patch.remind10,
    ...(i.status === 'scheduled' && patch.postAt ? { postAt: patch.postAt } : {}),
    ...(moved ? { remind60At: null, remind10At: null } : {}),
    updatedAt: now,
  };
  await ctx.db.update(interviews).set(next).where(eq(interviews.id, id));
  if (i.status === 'posted' && i.messageId) {
    const text = interviewText({ ...i, ...next });
    await ctx.discord.editMessage(i.channelId, i.messageId, { content: `${moved ? '🔁 **日時が変わりました**\n' : ''}${text}` });
  }
  const p = jstParts(patch.at);
  await audit(ctx.db, { actorId: by, action: 'interview.update', detail: { id, at: patch.at.toISOString(), label: `${p.date} ${p.time}`, moved }, via: 'web' });
  return 'ok';
}

/** 中止: 流したあとなら、Discord のメッセージを「中止しました」に書き換える */
export async function cancelInterview(ctx: InterviewCtx, id: number, reason: string, by: string, now = new Date()): Promise<'ok' | 'not_found'> {
  const i = await getInterview(ctx.db, id);
  if (!i || i.status === 'cancelled') return 'not_found';
  await ctx.db.update(interviews).set({ status: 'cancelled', cancelReason: reason || null, updatedAt: now }).where(eq(interviews.id, id));
  if (i.status === 'posted' && i.messageId) {
    const p = jstParts(i.at);
    const text = [`🙏 **${p.date} ${p.time} の面談は中止になりました。**`, ...(reason ? [`> ${reason.replace(/\n+/g, ' ')}`] : []), '-# また改めてお知らせします'].join('\n');
    await ctx.discord.editMessage(i.channelId, i.messageId, { content: text }).catch((err: unknown) => logger.warn({ err, id }, 'interview cancel edit failed'));
  }
  const p = jstParts(i.at);
  await audit(ctx.db, { actorId: by, action: 'interview.cancel', detail: { id, label: `${p.date} ${p.time}`, reason }, via: 'web' });
  return 'ok';
}

/** リマインドの文 */
export function reminderMessage(st: InterviewSettings, i: Interview, rankRoleIds: readonly string[] = []): MessageBody {
  const text = renderInterview(st.reminderTemplate, { at: i.at, place: placeOf(i), note: i.note });
  return st.remindMention ? interviewMessage(st, text, rankRoleIds) : { content: text, allowed_mentions: { parse: [] } };
}

/**
 * 1 分ごと（BOT）: 予約した告知を流し、1 時間前・10 分前のリマインドを流す。
 * BOT が止まっていて時間を過ぎたリマインドは流さない（印だけ付ける）
 */
export async function interviewTick(ctx: InterviewCtx, st: InterviewSettings, now = new Date()): Promise<{ posted: number; reminded: number }> {
  let posted = 0;
  let reminded = 0;
  const due = await ctx.db
    .select()
    .from(interviews)
    .where(and(eq(interviews.status, 'scheduled'), lte(interviews.postAt, now)));
  for (const i of due) {
    // 面談の時間を過ぎてしまった予約は、流さずに残す（中止か変更を運営が選ぶ）
    if (i.at.getTime() <= now.getTime()) continue;
    try {
      await postInterview(ctx, i.id, st, now);
      posted++;
    } catch (err) {
      logger.warn({ err, id: i.id }, 'interview scheduled post failed');
    }
  }
  const soon = await ctx.db
    .select()
    .from(interviews)
    .where(and(eq(interviews.status, 'posted'), gte(interviews.at, now), lte(interviews.at, new Date(now.getTime() + 61 * 60_000))));
  for (const i of soon) {
    const left = (i.at.getTime() - now.getTime()) / 60_000;
    const send = async (col: 'remind60At' | 'remind10At') => {
      await ctx.db.update(interviews).set({ [col]: now }).where(eq(interviews.id, i.id));
      await ctx.discord.sendMessage(i.channelId, reminderMessage(st, i, ctx.rankRoleIds)).catch((err: unknown) => logger.warn({ err, id: i.id }, 'interview reminder failed'));
      reminded++;
    };
    // 1 時間前（10 分前を過ぎていたら、1 時間前は出さない）
    if (i.remind60 && !i.remind60At && left <= 60 && left > 10) await send('remind60At');
    else if (i.remind10 && !i.remind10At && left <= 10) await send('remind10At');
  }
  return { posted, reminded };
}

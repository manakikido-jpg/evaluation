import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';
import type { GuildChannel, MessageBody } from '../lib/discordRest.js';

/**
 * 面談告知: 社務所Web で日時を決めるだけで、決めた定型文を #面談-告知 に流す。
 * 定型文の {日時} などは、流すときに埋める。
 */

export const DEFAULT_INTERVIEW_TEMPLATE = `# 🍵 面談のお知らせ
**{日時}** から、運営との面談をおこないます（{あと}）。
- 場所: {場所}
- 相談したいこと・気になることがあれば、気軽に来てください
{一言}`;

export const interviewSchema = z.object({
  /** 流すチャンネル（なければ名前に「面談」を含むチャンネル） */
  channelId: z
    .string()
    .regex(/^\d{17,20}$/)
    .optional(),
  template: z.string().min(1).max(1800).default(DEFAULT_INTERVIEW_TEMPLATE),
  /** 通知: none なし / here @here / everyone @everyone / role 決めたロール */
  mention: z.enum(['none', 'here', 'everyone', 'role']).default('none'),
  roleId: z
    .string()
    .regex(/^\d{17,20}$/)
    .optional(),
});
export type InterviewSettings = z.infer<typeof interviewSchema>;

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
export function interviewMessage(s: InterviewSettings, text: string): MessageBody {
  const head = s.mention === 'here' ? '@here\n' : s.mention === 'everyone' ? '@everyone\n' : s.mention === 'role' && s.roleId ? `<@&${s.roleId}>\n` : '';
  const allowed: MessageBody['allowed_mentions'] =
    s.mention === 'here' || s.mention === 'everyone' ? { parse: ['everyone'] } : s.mention === 'role' && s.roleId ? { roles: [s.roleId] } : { parse: [] };
  return { content: `${head}${text}`.slice(0, 2000), allowed_mentions: allowed };
}

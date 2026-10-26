import { and, eq, gte, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { guideThreads, settings, type GuideThread } from '../db/schema.js';
import { jstDate } from './activity.js';

/**
 * 🧵 入った人の案内スレッド。
 * 入った瞬間に、本人と案内人だけのプライベートスレッドを作り、あいさつと時間のボタンを送る。
 * 時間は日ごとに社務所Web で変えられる（決めていない日は、いつもの時間）。
 */
const KEY = 'guide.thread';
const TIME = /^([01]?\d|2[0-9]):([0-5]\d)$/;
export const DEFAULT_GUIDE_MESSAGE = [
  'ようこそ、咲楽ノ宮へ！',
  'ご案内（面談）は、案内所の通話で行います。',
  '',
  '【ご案内の受け方】',
  '・来られる時間のボタンを押してください。その時間に案内所へお越しください。',
  '・「今から」を押すと、待っている案内人を呼びます。',
  '・ボタンの時間以外がよいときは「時間外」を押して、ご希望の日時を書いてください。',
].join('\n');
export const guideThreadConfigSchema = z.object({
  enabled: z.boolean().default(false),
  channelId: z.string().regex(/^(\d{17,20})?$/).default(''),
  message: z.string().max(1500).default(DEFAULT_GUIDE_MESSAGE),
  defaultTimes: z.array(z.string().regex(TIME)).max(8).default(['21:00', '22:00', '23:00', '24:00']),
  days: z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.array(z.string().regex(TIME)).max(8)).default({}),
});
export type GuideThreadConfig = z.infer<typeof guideThreadConfigSchema>;

export async function guideThreadConfig(db: Db): Promise<GuideThreadConfig> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  const r = guideThreadConfigSchema.safeParse(row?.value ?? {});
  return r.success ? r.data : guideThreadConfigSchema.parse({});
}
export async function saveGuideThreadConfig(db: Db, input: GuideThreadConfig, by: string, now = new Date()) {
  const value = guideThreadConfigSchema.parse(input);
  // 過ぎた日は残さない
  const today = jstDate(now);
  value.days = Object.fromEntries(Object.entries(value.days).filter(([d]) => d >= today));
  await db.insert(settings).values({ key: KEY, value, updatedBy: by }).onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: by, updatedAt: now } });
  return value;
}

/** 「21:00 22:00、24:00」→ ['21:00','22:00','24:00']。「なし」「-」は空。読めないものがあれば undefined */
export function parseTimes(text: string): string[] | undefined {
  const t = text.trim();
  if (t === 'なし' || t === '-') return [];
  const list = t.split(/[\s,、]+/).filter(Boolean).map(x => x.replace(/^(\d)(?=:)/, '0$1'));
  if (list.some(x => !TIME.test(x)) || list.length > 8) return undefined;
  return [...new Set(list)].sort();
}
/** 日付（日本時間）と「24:00」のような時刻から、その時の Date（24 時以降は次の日） */
export function slotDate(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [h, min] = time.split(':').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, d) - 9 * 3_600_000 + (h * 60 + min) * 60_000);
}
export const timesFor = (c: GuideThreadConfig, date: string) => c.days[date] ?? c.defaultTimes;
export const slotLabel = (date: string, time: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日 ${time}`;
const addDay = (date: string, n: number) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);

/** いま選べる時間（今日のまだ来ていない時間。なければ明日の時間）。5 つまで */
export function openSlots(c: GuideThreadConfig, now = new Date()): { date: string; time: string; label: string; tomorrow: boolean }[] {
  const today = jstDate(now);
  for (const [date, tomorrow] of [[today, false], [addDay(today, 1), true]] as const) {
    const list = timesFor(c, date).filter(t => slotDate(date, t).getTime() > now.getTime()).slice(0, 5);
    if (list.length) return list.map(time => ({ date, time, label: slotLabel(date, time), tomorrow }));
  }
  return [];
}
/** 押された時間が、いまも選べる時間か */
export function validSlot(c: GuideThreadConfig, date: string, time: string, now = new Date()): boolean {
  return openSlots(c, now).some(s => s.date === date && s.time === time);
}

export async function threadOf(db: Db, memberId: string): Promise<GuideThread | undefined> {
  const [row] = await db.select().from(guideThreads).where(eq(guideThreads.memberId, memberId));
  return row;
}
export async function threadById(db: Db, threadId: string): Promise<GuideThread | undefined> {
  const [row] = await db.select().from(guideThreads).where(eq(guideThreads.threadId, threadId));
  return row;
}
/** 作ったスレッドを覚える（入りなおした人は、新しいスレッドに置きかえる） */
export async function recordThread(db: Db, memberId: string, threadId: string, watched: boolean, now = new Date()) {
  const values = { memberId, threadId, watched, slotAt: null, slotLabel: null, reminded: false, createdAt: now, closedAt: null };
  await db.insert(guideThreads).values(values).onConflictDoUpdate({ target: guideThreads.memberId, set: values });
}
export async function bookSlot(db: Db, memberId: string, date: string, time: string) {
  await db.update(guideThreads).set({ slotAt: slotDate(date, time), slotLabel: slotLabel(date, time), reminded: false }).where(eq(guideThreads.memberId, memberId));
}
export const openThreads = (db: Db) => db.select().from(guideThreads).where(isNull(guideThreads.closedAt));
/** 10 分前のお知らせがまだの予約（1 回だけ取り出す） */
export async function takeDueReminders(db: Db, now = new Date()): Promise<GuideThread[]> {
  return db.update(guideThreads).set({ reminded: true })
    .where(and(isNull(guideThreads.closedAt), eq(guideThreads.reminded, false), lte(guideThreads.slotAt, new Date(now.getTime() + 10 * 60_000)), gte(guideThreads.slotAt, new Date(now.getTime() - 15 * 60_000))))
    .returning();
}
export async function closeThread(db: Db, memberId: string, now = new Date()) {
  await db.update(guideThreads).set({ closedAt: now }).where(and(eq(guideThreads.memberId, memberId), isNull(guideThreads.closedAt)));
}

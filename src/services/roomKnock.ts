import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';

export const KNOCK_MS = 3 * 60_000;
export const ROOM_MODES = { open: '🟢 出入り自由', knock: '🔔 こんこん歓迎', busy: '🌙 取り込み中' } as const;
export type RoomMode = keyof typeof ROOM_MODES;
const pendingSchema = z.object({ id: z.string(), users: z.array(z.string()).max(20), expires: z.number(), messageId: z.string().optional(), answered: z.boolean().default(false) });
const stateSchema = z.object({ mode: z.enum(['open', 'knock', 'busy']).default('open'), last: z.record(z.string(), z.number()).default({}), pending: pendingSchema.optional(), controlId: z.string().optional() });
export type KnockState = z.infer<typeof stateSchema>;
const key = (room: string) => `room_knock:${room}`;

/** 🚪 社務所Web で変えられる設定（止める・始める、パネルのチャンネル、時間） */
const CONFIG_KEY = 'room_knock.config';
export const knockConfigSchema = z.object({
  enabled: z.boolean().default(true),
  channelId: z.string().regex(/^(\d{17,20})?$/).default(''),
  cooldownSec: z.number().int().min(30).max(3600).default(180),
  windowSec: z.number().int().min(30).max(3600).default(180),
});
export type KnockConfig = z.infer<typeof knockConfigSchema>;
export async function roomKnockConfig(db: Db): Promise<KnockConfig> {
  const [row] = await db.select().from(settings).where(eq(settings.key, CONFIG_KEY));
  const r = knockConfigSchema.safeParse(row?.value ?? {});
  return r.success ? r.data : knockConfigSchema.parse({});
}
export async function saveRoomKnockConfig(db: Db, input: KnockConfig, by: string) {
  const value = knockConfigSchema.parse(input);
  await db.insert(settings).values({ key: CONFIG_KEY, value, updatedBy: by }).onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: by, updatedAt: new Date() } });
  return value;
}
/** 「3分」「90秒」のように時間を書く */
export const fmtSec = (sec: number) => sec % 60 === 0 ? `${sec / 60}分` : sec > 60 ? `${Math.floor(sec / 60)}分${sec % 60}秒` : `${sec}秒`;
/** いま受付の状態を持っている部屋（一覧用） */
export async function roomKnockStates(db: Db): Promise<{ room: string; state: KnockState }[]> {
  const rows = await db.select().from(settings).where(sql`${settings.key} like 'room\_knock:%'`);
  return rows.flatMap(r => { const p = stateSchema.safeParse(r.value); return p.success ? [{ room: r.key.slice('room_knock:'.length), state: p.data }] : []; });
}
export async function roomKnockState(db: Db, room: string): Promise<KnockState> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key(room)));
  return stateSchema.parse(row?.value ?? {});
}
async function change<T>(db: Db, room: string, fn: (s: KnockState) => T): Promise<T> {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key(room)}))`);
    const state = await roomKnockState(tx as Db, room);
    const result = fn(state);
    await tx.insert(settings).values({ key: key(room), value: state, updatedBy: 'system' }).onConflictDoUpdate({ target: settings.key, set: { value: state, updatedBy: 'system', updatedAt: new Date() } });
    return result;
  });
}
export async function setRoomKnockMode(db: Db, room: string, mode: RoomMode) {
  return change(db, room, s => { s.mode = mode; if (mode !== 'knock') delete s.pending; });
}
export async function resetRoomKnock(db: Db, room: string) {
  return change(db, room, s => { s.mode = 'open'; delete s.pending; });
}
export async function setKnockControl(db: Db, room: string, id: string) {
  return change(db, room, s => { s.controlId = id; });
}
export async function requestRoomKnock(db: Db, room: string, user: string, id: string, now = Date.now(), opts: { cooldownMs?: number; windowMs?: number } = {}) {
  const cooldown = opts.cooldownMs ?? KNOCK_MS, windowMs = opts.windowMs ?? KNOCK_MS;
  return change(db, room, s => {
    s.last = Object.fromEntries(Object.entries(s.last).filter(([, at]) => now - at < cooldown));
    if (s.mode !== 'knock') return { status: 'unavailable' as const };
    if (s.last[user] !== undefined) return { status: 'cooldown' as const, seconds: Math.ceil((s.last[user]! + cooldown - now) / 1000) };
    if (!s.pending || s.pending.expires <= now || s.pending.answered) s.pending = { id, users: [], expires: now + windowMs, answered: false };
    if (s.pending.users.length >= 20) return { status: 'full' as const };
    s.pending.users.push(user);
    s.last[user] = now;
    return { status: 'ok' as const, pending: structuredClone(s.pending) };
  });
}
export async function recordKnockMessage(db: Db, room: string, nonce: string, messageId: string) {
  return change(db, room, s => { if (s.pending?.id === nonce) s.pending.messageId = messageId; });
}
export async function cancelKnock(db: Db, room: string, nonce: string) {
  return change(db, room, s => { if (s.pending?.id === nonce) delete s.pending; });
}
export async function answerRoomKnock(db: Db, room: string, nonce: string, now = Date.now()) {
  return change(db, room, s => {
    if (s.mode !== 'knock' || !s.pending || s.pending.id !== nonce || s.pending.answered || s.pending.expires <= now) return undefined;
    s.pending.answered = true;
    return structuredClone(s.pending);
  });
}

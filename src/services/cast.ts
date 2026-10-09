import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { and, asc, desc, eq, gte, inArray, lt, lte, or, sql } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { castImages, castSessions, casts, members, settings, type Cast, type CastSession } from '../db/schema.js';
import { addCoins, spendWithin, walletOf } from './economy.js';
import { detectImage } from './notices.js';

/**
 * 🎀 キャスト: 寝落ち・雑談などの通話を、銭で受ける人（18 歳以上・運営が承認）。
 * - 指名すると、銭は社務所が先に預かり、終わったらキャストに渡す（手数料を引く。手数料の分は消える）
 * - 2 人だけの部屋・寝落ち・予約は 18 歳以上どうしだけ。未成年（と年齢の分からない）人は、
 *   運営も見える公開の部屋での雑談だけ（1 回 60 分まで・6 時〜22 時）
 * - 返事がない・断られた・取り消しは全額戻す。通報すると銭を止めて、運営が決める
 */

export type CastPlan = '30' | '60' | 'night';
export const PLAN_LABEL: Record<CastPlan, string> = { '30': '30 分', '60': '1 時間', night: '🌙 寝落ち（朝 7 時まで）' };
export const CAST_TAGS = ['寝落ち', '雑談', 'ゲーム', '相談', '歌', 'ASMR', '作業通話'] as const;

/** 未成年の人の決まり */
export const MINOR = { startHour: 6, endHour: 22, maxMinutes: 60 } as const;
const NIGHT_END_HOUR = 7;
const MIN = 60_000;
const JST = 9 * 3_600_000;

// ───────── 設定 ─────────

export type CastConfig = {
  channelId?: string;
  panelMessageId?: string;
  roleId?: string;
  /** 2 人だけの部屋を作るカテゴリ（遊郭など） */
  privateCategoryId?: string;
  /** 公開の部屋を作るカテゴリ */
  publicCategoryId?: string;
  priceMin: number;
  priceMax: number;
  feePercent: number;
  /** 今すぐの指名の返事を待つ分 */
  acceptMinutes: number;
};
export const CAST_DEFAULTS: CastConfig = { priceMin: 100, priceMax: 30_000, feePercent: 10, acceptMinutes: 10 };
const KEY = 'cast';
const sf = (x: unknown) => (typeof x === 'string' && /^\d{17,20}$/.test(x) ? x : undefined);
const int = (x: unknown, d: number, lo: number, hi: number) => (typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi ? x : d);

export async function loadCastConfig(db: Db): Promise<CastConfig> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  const v = (row?.value ?? {}) as Record<string, unknown>;
  const d = CAST_DEFAULTS;
  const priceMin = int(v.priceMin, d.priceMin, 1, 1_000_000);
  return {
    channelId: sf(v.channelId),
    panelMessageId: sf(v.panelMessageId),
    roleId: sf(v.roleId),
    privateCategoryId: sf(v.privateCategoryId),
    publicCategoryId: sf(v.publicCategoryId),
    priceMin,
    priceMax: Math.max(priceMin, int(v.priceMax, d.priceMax, 1, 1_000_000)),
    feePercent: int(v.feePercent, d.feePercent, 0, 90),
    acceptMinutes: int(v.acceptMinutes, d.acceptMinutes, 1, 60),
  };
}

export async function saveCastConfig(db: Db, c: CastConfig, by: string): Promise<void> {
  const value = { ...c };
  await db
    .insert(settings)
    .values({ key: KEY, value, updatedBy: by })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: by, updatedAt: new Date() } });
}

export const castFee = (c: Pick<CastConfig, 'feePercent'>, price: number) => Math.floor((price * c.feePercent) / 100);

// ───────── メニューの画像 ─────────

export async function saveMenuImage(db: Db, data: Uint8Array): Promise<string | undefined> {
  const kind = detectImage(data);
  if (!kind) return undefined;
  const hash = createHash('sha256').update(data).digest('hex').slice(0, 16);
  await db
    .insert(castImages)
    .values({ key: 'menu', contentType: kind.type, data, hash })
    .onConflictDoUpdate({ target: castImages.key, set: { contentType: kind.type, data, hash, updatedAt: new Date() } });
  return hash;
}

export async function loadMenuImage(db: Db): Promise<{ contentType: string; data: Uint8Array; hash: string } | undefined> {
  const [row] = await db.select().from(castImages).where(eq(castImages.key, 'menu'));
  return row && { contentType: row.contentType, data: row.data, hash: row.hash };
}

export async function deleteMenuImage(db: Db): Promise<void> {
  await db.delete(castImages).where(eq(castImages.key, 'menu'));
}

/** 紹介用の写真。Discord に送りやすい大きさにして、名前や位置情報は残さない。 */
export async function saveCastPhoto(db: Db, memberId: string, data: Uint8Array): Promise<string | undefined> {
  if (!sf(memberId) || data.length > 8 * 1024 * 1024 || !detectImage(data)) return undefined;
  const cast = await getCast(db, memberId);
  if (!cast || cast.status === 'removed') return undefined;
  let photo: Buffer;
  try {
    photo = await sharp(data, { limitInputPixels: 40_000_000 }).rotate().resize(600, 600, { fit: 'cover' }).png().toBuffer();
  } catch { return undefined; }
  const hash = createHash('sha256').update(photo).digest('hex').slice(0, 16);
  await db.insert(castImages).values({ key: `profile:${memberId}`, contentType: 'image/png', data: photo, hash })
    .onConflictDoUpdate({ target: castImages.key, set: { contentType: 'image/png', data: photo, hash, updatedAt: new Date() } });
  return hash;
}

export async function loadCastPhoto(db: Db, memberId: string) {
  if (!sf(memberId)) return undefined;
  const [row] = await db.select().from(castImages).where(eq(castImages.key, `profile:${memberId}`));
  return row && { contentType: row.contentType, data: row.data, hash: row.hash };
}

export async function deleteCastPhoto(db: Db, memberId: string): Promise<void> {
  if (sf(memberId)) await db.delete(castImages).where(eq(castImages.key, `profile:${memberId}`));
}

// ───────── 年齢・時刻 ─────────

/** 18 歳以上か（年齢区分が大人か、宵参りのロールがある）。分からない人は未成年として扱う */
export async function isAdult(db: Db, cfg: GuildConfig, id: string, roleIds: readonly string[]): Promise<boolean> {
  if (cfg.roles.yoimairi && roleIds.includes(cfg.roles.yoimairi)) return true;
  const [m] = await db.select({ ageGroup: members.ageGroup }).from(members).where(eq(members.id, id));
  return m?.ageGroup === 'adult';
}

const jstHour = (d: Date) => new Date(d.getTime() + JST).getUTCHours();
/** 日本時間のその日の h 時 */
function jstAt(d: Date, h: number): Date {
  const j = new Date(d.getTime() + JST);
  return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate(), h) - JST);
}

/** 寝落ちの終わり: 次の朝 7 時（あと 1 時間もなければ、その次の朝） */
export function nightEnd(start: Date): Date {
  let end = jstAt(start, NIGHT_END_HOUR);
  while (end.getTime() - start.getTime() < 60 * MIN) end = new Date(end.getTime() + 24 * 60 * MIN);
  return end;
}

/** 未成年の人の雑談が、6 時〜22 時に収まるか */
export function minorWindowOk(start: Date, minutes: number): boolean {
  const end = new Date(start.getTime() + minutes * MIN);
  return jstHour(start) >= MINOR.startHour && end.getTime() <= jstAt(start, MINOR.endHour).getTime();
}

export function planMinutes(plan: CastPlan, start: Date): number {
  return plan === '30' ? 30 : plan === '60' ? 60 : Math.round((nightEnd(start).getTime() - start.getTime()) / MIN);
}

export const priceOfPlan = (c: Pick<Cast, 'price30' | 'price60' | 'priceNight'>, plan: CastPlan) => (plan === '30' ? c.price30 : plan === '60' ? c.price60 : c.priceNight);

// ───────── メニュー（キャストごと。内容・時間・値段） ─────────

export type CastMenuItem = Cast['menu'][number];
/** 1 人のメニューの数（Discord の選ぶ欄に入る数） */
export const MENU_MAX = 20;
export const MENU_MINUTES = { min: 10, max: 720 } as const;

/** そのキャストのメニュー。まだ作っていなければ、前の 30 分・1 時間・寝落ちの値段から作る（番号は 30 / 60 / night） */
export function menuOf(c: Pick<Cast, 'menu' | 'price30' | 'price60' | 'priceNight'>): CastMenuItem[] {
  if (c.menu.length) return c.menu;
  const out: CastMenuItem[] = [];
  if (c.price30 > 0) out.push({ id: '30', name: '30 分', note: '', minutes: 30, price: c.price30, night: false });
  if (c.price60 > 0) out.push({ id: '60', name: '1 時間', note: '', minutes: 60, price: c.price60, night: false });
  if (c.priceNight > 0) out.push({ id: 'night', name: '寝落ち', note: '', minutes: 0, price: c.priceNight, night: true });
  return out;
}

const durationText = (m: number) => (m % 60 === 0 ? `${m / 60} 時間` : m > 60 ? `${Math.floor(m / 60)} 時間 ${m % 60} 分` : `${m} 分`);
/** 「雑談（30 分）」「🌙 寝落ち（朝 7 時まで）」 */
export const menuLabel = (m: Pick<CastMenuItem, 'name' | 'minutes' | 'night'>) => (m.night ? `🌙 ${m.name}（朝 7 時まで）` : `${m.name}（${durationText(m.minutes)}）`);
/** 指名の名前（前の指名はプランの名前） */
export const sessionLabel = (s: Pick<CastSession, 'plan' | 'menuName'>) => s.menuName || PLAN_LABEL[s.plan as CastPlan] || s.plan;
/** 18 歳未満の人も選べるメニューか（寝落ちでなく、60 分まで） */
export const minorMenuOk = (m: CastMenuItem) => !m.night && m.minutes <= MINOR.maxMinutes;
/** メニューを 1 行で（紹介・一覧） */
export const menuText = (c: Pick<Cast, 'menu' | 'price30' | 'price60' | 'priceNight'>) => menuOf(c).map((m) => `${menuLabel(m)} ${m.price.toLocaleString('ja-JP')}`).join('・');

export type MenuInput = { name: string; note: string; minutes: number; price: number; night: boolean };

export function validMenuItem(c: CastConfig, m: MenuInput): boolean {
  return (
    m.name.length >= 1 && m.name.length <= 30 && m.note.length <= 100 &&
    Number.isInteger(m.price) && m.price >= c.priceMin && m.price <= c.priceMax &&
    (m.night || (Number.isInteger(m.minutes) && m.minutes >= MENU_MINUTES.min && m.minutes <= MENU_MINUTES.max))
  );
}

const newMenuId = () => Math.random().toString(36).slice(2, 8);
const asItem = (m: MenuInput): CastMenuItem => ({ id: newMenuId(), name: m.name, note: m.note, minutes: m.night ? 0 : m.minutes, price: m.price, night: m.night });

/** メニューを足す（運営）。前の値段から作ったメニューは、そのまま引きつぐ */
export async function addMenuItem(db: Db, c: CastConfig, castId: string, m: MenuInput): Promise<'ok' | 'invalid' | 'full' | 'not_cast'> {
  if (!validMenuItem(c, m)) return 'invalid';
  return db.transaction(async (tx) => {
    const [cast] = await tx.select().from(casts).where(eq(casts.memberId, castId)).for('update');
    if (!cast || cast.status === 'removed') return 'not_cast' as const;
    const menu = menuOf(cast);
    if (menu.length >= MENU_MAX) return 'full' as const;
    await tx.update(casts).set({ menu: [...menu, asItem(m)], price30: 0, price60: 0, priceNight: 0 }).where(eq(casts.memberId, castId));
    return 'ok' as const;
  });
}

/** メニューを外す（運営）。もう入っている指名・予約はそのまま */
export async function removeMenuItem(db: Db, castId: string, itemId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [cast] = await tx.select().from(casts).where(eq(casts.memberId, castId)).for('update');
    if (!cast) return false;
    const menu = menuOf(cast);
    if (!menu.some((m) => m.id === itemId)) return false;
    await tx.update(casts).set({ menu: menu.filter((m) => m.id !== itemId), price30: 0, price60: 0, priceNight: 0 }).where(eq(casts.memberId, castId));
    return true;
  });
}

// ───────── キャスト ─────────

export async function getCast(db: Db, id: string): Promise<Cast | undefined> {
  const [row] = await db.select().from(casts).where(eq(casts.memberId, id));
  return row;
}

export async function listCasts(db: Db, statuses: Cast['status'][] = ['active']): Promise<Cast[]> {
  return db.select().from(casts).where(inArray(casts.status, statuses)).orderBy(casts.appliedAt);
}

export type ProfileInput = { bio: string; tags: string[]; price30: number; price60: number; priceNight: number; minorOk: boolean };

export function validProfile(c: CastConfig, p: ProfileInput): boolean {
  // 値段は前の決まった 3 つ（今はメニューで決める）。0 は「なし」
  const ok = (n: number) => n === 0 || (Number.isInteger(n) && n >= c.priceMin && n <= c.priceMax);
  return p.bio.length <= 300 && ok(p.price30) && ok(p.price60) && ok(p.priceNight) && p.tags.length <= 7;
}

/** 読みやすい数（全角・カンマ・「枚」も読む。空は 0） */
export function parsePrice(raw: string): number {
  const t = raw.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).replace(/[,，\s枚]/g, '');
  if (!t) return 0;
  return /^\d+$/.test(t) ? Number(t) : NaN;
}

export function parseTags(raw: string): string[] {
  return [...new Set(raw.split(/[、,，・\s/]+/).map((t) => t.trim()).filter(Boolean))].slice(0, 7).map((t) => t.slice(0, 12));
}

export type ApplyCastResult = { status: 'ok'; cast: Cast } | { status: 'not_adult' | 'invalid' | 'already' };

/** キャストに申し込む（18 歳以上の人だけ）。外された人は申し込み直せる */
export async function applyCast(db: Db, c: CastConfig, who: { id: string; adult: boolean }, p: ProfileInput, now = new Date()): Promise<ApplyCastResult> {
  if (!who.adult) return { status: 'not_adult' };
  if (!validProfile(c, p)) return { status: 'invalid' };
  const cur = await getCast(db, who.id);
  if (cur && cur.status !== 'removed') return { status: 'already' };
  const values = { memberId: who.id, status: 'pending' as const, ...p, appliedAt: now, approvedAt: null, approvedBy: null };
  const [row] = await db.insert(casts).values(values).onConflictDoUpdate({ target: casts.memberId, set: values }).returning();
  return { status: 'ok', cast: row! };
}

export async function updateProfile(db: Db, c: CastConfig, id: string, p: ProfileInput): Promise<Cast | undefined> {
  if (!validProfile(c, p)) return undefined;
  const [row] = await db.update(casts).set(p).where(eq(casts.memberId, id)).returning();
  return row;
}

export type RegisterCastResult = { status: 'ok'; cast: Cast } | { status: 'not_adult' | 'invalid' | 'already' };

/** 運営が社務所Web でキャストを登録する（すぐ承認ずみ。18 歳以上の人だけ）。外された人・申し込み中の人も登録できる */
export async function registerCast(db: Db, c: CastConfig, who: { id: string; adult: boolean }, p: Pick<ProfileInput, 'bio' | 'tags' | 'minorOk'>, first: MenuInput, by: string, now = new Date()): Promise<RegisterCastResult> {
  if (!who.adult) return { status: 'not_adult' };
  const profile = { ...p, price30: 0, price60: 0, priceNight: 0 };
  if (!validProfile(c, profile) || !validMenuItem(c, first)) return { status: 'invalid' };
  const cur = await getCast(db, who.id);
  if (cur && (cur.status === 'active' || cur.status === 'paused')) return { status: 'already' };
  const values = { memberId: who.id, status: 'active' as const, available: 'off' as const, ...profile, menu: [asItem(first)], appliedAt: now, approvedAt: now, approvedBy: by };
  const [row] = await db.insert(casts).values(values).onConflictDoUpdate({ target: casts.memberId, set: values }).returning();
  return { status: 'ok', cast: row! };
}

/** 運営: 承認・お休み・外す（断る） */
export async function setCastStatus(db: Db, id: string, status: Cast['status'], by: string, now = new Date()): Promise<Cast | undefined> {
  const [row] = await db
    .update(casts)
    .set({ status, ...(status === 'active' ? { approvedAt: now, approvedBy: by } : { available: 'off' as const }) })
    .where(eq(casts.memberId, id))
    .returning();
  return row;
}

/** 待機する（hours 時間。0 でお休み） */
export async function setWaiting(db: Db, id: string, hours: number, now = new Date()): Promise<Cast | undefined> {
  const [row] = await db
    .update(casts)
    .set(hours > 0 ? { available: 'waiting', waitingUntil: new Date(now.getTime() + hours * 60 * MIN) } : { available: 'off', waitingUntil: null })
    .where(and(eq(casts.memberId, id), eq(casts.status, 'active')))
    .returning();
  return row;
}

export async function setBlocked(db: Db, castId: string, customerId: string, on: boolean): Promise<Cast | undefined> {
  const cur = await getCast(db, castId);
  if (!cur) return undefined;
  const blocked = on ? [...new Set([...cur.blocked, customerId])].slice(-100) : cur.blocked.filter((x) => x !== customerId);
  const [row] = await db.update(casts).set({ blocked }).where(eq(casts.memberId, castId)).returning();
  return row;
}

// ───────── 指名 ─────────

const OPEN: CastSession['status'][] = ['reserved', 'accepted', 'requested', 'active'];

/** そのキャストが今通話中・返事待ちか */
export async function busyCast(db: Db, castId: string): Promise<CastSession | undefined> {
  const [row] = await db
    .select()
    .from(castSessions)
    .where(and(eq(castSessions.castId, castId), inArray(castSessions.status, ['requested', 'active'])));
  return row;
}

export type RequestResult =
  | { status: 'ok'; session: CastSession; balance: number }
  | { status: 'insufficient'; price: number; balance: number }
  | { status: 'not_cast' | 'self' | 'blocked' | 'busy' | 'no_plan' | 'minor_plan' | 'minor_hours' | 'minor_off' | 'minor_reserve' | 'has_open' | 'bad_time' | 'overlap' };

/** 同じキャストの利用時間が重なるか（終わりと次の始まりが同じならよい） */
async function overlaps(tx: Db, castId: string, start: Date, end: Date, now: Date, except?: number): Promise<boolean> {
  const sessions = await tx.select().from(castSessions).where(and(eq(castSessions.castId, castId), inArray(castSessions.status, OPEN)));
  return sessions.some((s) => {
    if (s.id === except) return false;
    const from = s.startedAt ?? s.startAt ?? s.createdAt;
    const until = s.endsAt ?? (s.plan === 'night' ? nightEnd(s.startAt ?? s.acceptBy ?? from) : new Date((s.startAt ?? s.acceptBy ?? from).getTime() + s.minutes * MIN));
    // 返事の期限が切れた指名は、すぐに払い戻されるので数えない
    if ((s.status === 'requested' || s.status === 'reserved') && s.acceptBy && s.acceptBy <= now) return false;
    return from < end && start < until;
  });
}

async function lockCast(tx: Db, castId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'cast:' + castId}))`);
}

/**
 * 指名する（今すぐ、または予約 startAt）。銭を預かる。
 * 未成年（か年齢の分からない）人: 30 分・1 時間の雑談だけ・公開の部屋・6 時〜22 時・予約なし
 */
export async function requestSession(
  db: Db,
  c: CastConfig,
  input: { castId: string; customerId: string; customerAdult: boolean; /** メニューの番号 */ plan: string; startAt?: Date },
  now = new Date(),
): Promise<RequestResult> {
  const cast = await getCast(db, input.castId);
  if (!cast || cast.status !== 'active') return { status: 'not_cast' };
  if (input.castId === input.customerId) return { status: 'self' };
  if (cast.blocked.includes(input.customerId)) return { status: 'blocked' };
  const item = menuOf(cast).find((m) => m.id === input.plan);
  if (!item || item.price <= 0) return { status: 'no_plan' };
  const price = item.price;
  const plan = item.night ? 'night' : item.id;
  const start = input.startAt ?? now;
  if (input.startAt && (input.startAt.getTime() < now.getTime() + 10 * MIN || input.startAt.getTime() > now.getTime() + 7 * 24 * 60 * MIN)) return { status: 'bad_time' };
  const minutes = item.night ? planMinutes('night', start) : item.minutes;
  if (!input.customerAdult) {
    if (input.startAt) return { status: 'minor_reserve' };
    if (!minorMenuOk(item)) return { status: 'minor_plan' };
    if (!cast.minorOk) return { status: 'minor_off' };
    if (!minorWindowOk(start, minutes)) return { status: 'minor_hours' };
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'cast-customer:' + input.customerId}))`);
    await lockCast(tx, input.castId);
    const mine = await tx
      .select({ id: castSessions.id })
      .from(castSessions)
      .where(and(eq(castSessions.customerId, input.customerId), inArray(castSessions.status, OPEN)));
    if (mine.length) return { status: 'has_open' as const };
    if (!input.startAt) {
      const [busy] = await tx
        .select({ id: castSessions.id })
        .from(castSessions)
        .where(and(eq(castSessions.castId, input.castId), inArray(castSessions.status, ['requested', 'active'])));
      if (busy) return { status: 'busy' as const };
    }
    const latestStart = input.startAt ?? new Date(now.getTime() + c.acceptMinutes * MIN);
    const end = item.night ? nightEnd(latestStart) : new Date(latestStart.getTime() + minutes * MIN);
    if (await overlaps(tx, input.castId, start, end, now)) return { status: 'overlap' as const };
    if (!(await spendWithin(tx, input.customerId, price, 'cast_pay', { castId: input.castId, plan, menu: item.name }))) {
      return { status: 'insufficient' as const, price, balance: (await walletOf(tx, input.customerId)).balance };
    }
    const [session] = await tx
      .insert(castSessions)
      .values({
        castId: input.castId,
        customerId: input.customerId,
        plan,
        menuName: cast.menu.length ? item.name : '',
        minutes,
        price,
        status: input.startAt ? 'reserved' : 'requested',
        isPublic: !input.customerAdult,
        ...(input.startAt ? { startAt: input.startAt, acceptBy: input.startAt } : { acceptBy: new Date(now.getTime() + c.acceptMinutes * MIN) }),
        createdAt: now,
      })
      .returning();
    return { status: 'ok' as const, session: session!, balance: (await walletOf(tx, input.customerId)).balance };
  });
}

export async function getSession(db: Db, id: number): Promise<CastSession | undefined> {
  const [row] = await db.select().from(castSessions).where(eq(castSessions.id, id));
  return row;
}

export async function setSessionPlace(db: Db, id: number, v: { channelId?: string; threadId?: string }): Promise<void> {
  await db.update(castSessions).set(v).where(eq(castSessions.id, id));
}

/** 状態を変える（from のときだけ）。変わらなければ undefined */
async function move(tx: Db, id: number, from: CastSession['status'][], set: Partial<typeof castSessions.$inferInsert>): Promise<CastSession | undefined> {
  const [row] = await tx.update(castSessions).set(set).where(and(eq(castSessions.id, id), inArray(castSessions.status, from))).returning();
  return row;
}

/** キャストが受ける: 今すぐ → 通話中（時間が動く）/ 予約 → 受けた */
export async function acceptSession(db: Db, id: number, castId: string, now = new Date()): Promise<CastSession | undefined> {
  const before = await getSession(db, id);
  if (!before || before.castId !== castId) return undefined;
  return db.transaction(async (tx) => {
    await lockCast(tx, castId);
    const s = (await tx.select().from(castSessions).where(eq(castSessions.id, id)).for('update'))[0];
    if (!s) return undefined;
    if (s.status === 'reserved') {
      if (s.acceptBy && s.acceptBy <= now) return undefined;
      return move(tx, id, ['reserved'], { status: 'accepted', acceptBy: null });
    }
    if (s.acceptBy && s.acceptBy <= now) return undefined;
    const endsAt = s.plan === 'night' ? nightEnd(now) : new Date(now.getTime() + s.minutes * MIN);
    if (await overlaps(tx, castId, now, endsAt, now, id)) return undefined;
    return move(tx, id, ['requested'], { status: 'active', startedAt: now, endsAt, acceptBy: null });
  });
}

/** 断る（キャスト）・取り消す（お客。始まる前だけ）・返事がない: 全額戻す */
export async function cancelSession(db: Db, id: number, by: string, reason: 'declined' | 'canceled', now = new Date()): Promise<CastSession | undefined> {
  return db.transaction(async (tx) => {
    const s = (await tx.select().from(castSessions).where(eq(castSessions.id, id)).for('update'))[0];
    if (!s) return undefined;
    if (by !== 'system' && by !== (reason === 'declined' ? s.castId : s.customerId)) return undefined;
    const row = await move(tx, id, ['reserved', 'accepted', 'requested'], { status: reason, closedAt: now, decidedBy: by, deleteAt: now });
    if (!row) return undefined;
    if (s.price > 0) await addCoins(tx, s.customerId, s.price, 'cast_refund', { sessionId: id, reason });
    return row;
  });
}

/** 予約の時刻が来た: 通話中にする */
export async function startReserved(db: Db, id: number, now = new Date()): Promise<CastSession | undefined> {
  const before = await getSession(db, id);
  if (!before) return undefined;
  return db.transaction(async (tx) => {
    await lockCast(tx, before.castId);
    const s = (await tx.select().from(castSessions).where(eq(castSessions.id, id)).for('update'))[0];
    if (!s || s.status !== 'accepted' || !s.startAt || s.startAt > now) return undefined;
    const endsAt = s.plan === 'night' ? nightEnd(s.startAt) : new Date(s.startAt.getTime() + s.minutes * MIN);
    if (endsAt <= now || await overlaps(tx, s.castId, now, endsAt, now, id)) return undefined;
    return move(tx, id, ['accepted'], { status: 'active', startedAt: now, endsAt });
  });
}

export type ExtendResult = { status: 'ok'; session: CastSession; balance: number } | { status: 'insufficient'; price: number; balance: number } | { status: 'not_active' | 'minor_limit' | 'not_customer' | 'already_extended' | 'overlap' };

/** 30 分のばす（お客）。未成年の人は合わせて 60 分・22 時まで */
export async function extendSession(db: Db, id: number, customerId: string, now = new Date(), expectedExtensions?: number): Promise<ExtendResult> {
  const before = await getSession(db, id);
  if (!before) return { status: 'not_active' };
  const expected = expectedExtensions ?? before.extensions;
  return db.transaction(async (tx) => {
    await lockCast(tx, before.castId);
    const s = (await tx.select().from(castSessions).where(eq(castSessions.id, id)).for('update'))[0];
    if (!s || s.status !== 'active' || !s.endsAt || s.endsAt <= now) return { status: 'not_active' as const };
    if (s.customerId !== customerId) return { status: 'not_customer' as const };
    if (!Number.isSafeInteger(expected) || expected < 0 || s.extensions !== expected) return { status: 'already_extended' as const };
    const cast = await getCast(tx, s.castId);
    // 30 分のばす値段: 前のプランは 30 分の値段。メニューの指名は、その指名と同じ割合（1 分あたり）
    const add = !cast ? 0 : s.menuName ? Math.ceil((s.price * 30) / Math.max(1, s.minutes)) : cast.price30 || Math.ceil((s.price * 30) / Math.max(1, s.minutes));
    if (!cast || add <= 0) return { status: 'not_active' as const };
    if (s.isPublic && (s.minutes + 30 > MINOR.maxMinutes || !minorWindowOk(s.startedAt ?? now, s.minutes + 30))) return { status: 'minor_limit' as const };
    const endsAt = new Date(s.endsAt.getTime() + 30 * MIN);
    if (await overlaps(tx, s.castId, now, endsAt, now, id)) return { status: 'overlap' as const };
    if (!(await spendWithin(tx, customerId, add, 'cast_pay', { sessionId: id, extend: true }))) return { status: 'insufficient' as const, price: add, balance: (await walletOf(tx, customerId)).balance };
    const row = await move(tx, id, ['active'], {
      minutes: s.minutes + 30, price: s.price + add, extensions: s.extensions + 1, endsAt, warned: false,
    });
    if (!row) throw new Error('session ended while extending');
    return { status: 'ok' as const, session: row, balance: (await walletOf(tx, customerId)).balance };
  });
}

/**
 * 終える: 時間が来た・お客が終えた → 全額（手数料を引いて）キャストに。
 * キャストが途中で終えた → 話した時間の分だけキャストに、残りはお客に戻す
 */
export async function finishSession(db: Db, c: CastConfig, id: number, by: string, now = new Date()): Promise<CastSession | undefined> {
  return db.transaction(async (tx) => {
    const s = (await tx.select().from(castSessions).where(eq(castSessions.id, id)).for('update'))[0];
    if (!s || s.status !== 'active') return undefined;
    if (by === 'system' && s.endsAt && s.endsAt > now) return undefined;
    if (by !== 'system' && by !== s.castId && by !== s.customerId) return undefined;
    let earned = s.price;
    if (by === s.castId && s.startedAt && s.endsAt && now < s.endsAt) {
      const total = s.endsAt.getTime() - s.startedAt.getTime();
      const used = Math.max(0, now.getTime() - s.startedAt.getTime());
      earned = Math.min(s.price, Math.ceil((s.price * used) / Math.max(1, total)));
    }
    const pay = earned - castFee(c, earned);
    const row = await move(tx, id, ['active'], { status: 'done', closedAt: now, endsAt: now < (s.endsAt ?? now) ? now : s.endsAt, paid: pay, decidedBy: by, deleteAt: new Date(now.getTime() + 5 * MIN) });
    if (!row) return undefined;
    if (pay > 0) await addCoins(tx, s.castId, pay, 'cast_reward', { sessionId: id, from: s.customerId, fee: earned - pay });
    if (s.price - earned > 0) await addCoins(tx, s.customerId, s.price - earned, 'cast_refund', { sessionId: id, early: true });
    return row;
  });
}

/** 🚨 通報（お客かキャスト）: 銭を止めて、運営が決める */
export async function disputeSession(db: Db, id: number, by: string): Promise<CastSession | undefined> {
  const s = await getSession(db, id);
  if (!s || (by !== s.castId && by !== s.customerId)) return undefined;
  // 部屋は時間が来たら片付ける（銭は運営が決めるまで止めたまま）
  return move(db, id, ['active', 'accepted'], { status: 'disputed', deleteAt: new Date((s.endsAt ?? new Date()).getTime() + 5 * MIN) });
}

/** 運営: 通報された指名を、キャストに渡す（手数料を引く）か、お客に戻す */
export async function resolveSession(db: Db, c: CastConfig, id: number, action: 'pay' | 'refund', by: string, now = new Date()): Promise<CastSession | undefined> {
  return db.transaction(async (tx) => {
    const s = (await tx.select().from(castSessions).where(eq(castSessions.id, id)).for('update'))[0];
    if (!s || s.status !== 'disputed') return undefined;
    const pay = action === 'pay' ? s.price - castFee(c, s.price) : 0;
    const row = await move(tx, id, ['disputed'], { status: action === 'pay' ? 'done' : 'refunded', closedAt: now, paid: pay, decidedBy: by, deleteAt: now });
    if (!row) return undefined;
    if (action === 'pay' && pay > 0) await addCoins(tx, s.castId, pay, 'cast_reward', { sessionId: id, from: s.customerId, fee: s.price - pay, staff: by });
    if (action === 'refund' && s.price > 0) await addCoins(tx, s.customerId, s.price, 'cast_refund', { sessionId: id, staff: by });
    return row;
  });
}

/** ⭐ 評価（お客・1 回だけ・1〜5） */
export async function rateSession(db: Db, id: number, customerId: string, stars: number): Promise<CastSession | undefined> {
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return undefined;
  const [row] = await db
    .update(castSessions)
    .set({ rating: stars })
    .where(and(eq(castSessions.id, id), eq(castSessions.customerId, customerId), eq(castSessions.status, 'done'), sql`${castSessions.rating} is null`))
    .returning();
  return row;
}

// ───────── 1 分ごと ─────────

export type TickResult = {
  /** 返事がなかった・予約を受けなかった（戻した） */
  expired: CastSession[];
  /** 予約の時刻が来た（部屋を作る） */
  started: CastSession[];
  /** 終わりの 5 分前 */
  warn: CastSession[];
  /** 時間が来て終えた（渡した） */
  finished: CastSession[];
  /** 部屋を消す */
  cleanup: CastSession[];
  /** 待機の時間が切れた */
  waitingOff: number;
};

export async function castTick(db: Db, c: CastConfig, now = new Date(), prepareRoom?: (s: CastSession) => Promise<boolean>): Promise<TickResult> {
  const out: TickResult = { expired: [], started: [], warn: [], finished: [], cleanup: [], waitingOff: 0 };
  for (const s of await db.select().from(castSessions).where(and(inArray(castSessions.status, ['requested', 'reserved']), lte(castSessions.acceptBy, now)))) {
    const r = await cancelSession(db, s.id, 'system', 'declined', now);
    if (r) out.expired.push(r);
  }
  for (const s of await db.select().from(castSessions).where(and(eq(castSessions.status, 'accepted'), lte(castSessions.startAt, now)))) {
    const ready = prepareRoom ? await prepareRoom(s).catch(() => false) : true;
    const r = ready ? await startReserved(db, s.id, now) : undefined;
    if (r) out.started.push(r);
    else {
      const refunded = await cancelSession(db, s.id, 'system', 'declined', now);
      if (refunded) out.expired.push(refunded);
    }
  }
  const soon = new Date(now.getTime() + 5 * MIN);
  for (const s of await db.select().from(castSessions).where(and(eq(castSessions.status, 'active'), eq(castSessions.warned, false), lte(castSessions.endsAt, soon)))) {
    if (s.endsAt && s.endsAt > now) {
      await db.update(castSessions).set({ warned: true }).where(eq(castSessions.id, s.id));
      out.warn.push(s);
    }
  }
  for (const s of await db.select().from(castSessions).where(and(eq(castSessions.status, 'active'), lte(castSessions.endsAt, now)))) {
    const r = await finishSession(db, c, s.id, 'system', now);
    if (r) out.finished.push(r);
  }
  out.cleanup = await db
    .select()
    .from(castSessions)
    .where(and(lte(castSessions.deleteAt, now), sql`${castSessions.channelId} is not null`));
  const off = await db
    .update(casts)
    .set({ available: 'off', waitingUntil: null })
    .where(and(eq(casts.available, 'waiting'), lte(casts.waitingUntil, now)))
    .returning();
  out.waitingOff = off.length;
  return out;
}

/** 部屋を消したら印を外す */
export async function roomDeleted(db: Db, id: number): Promise<void> {
  await db.update(castSessions).set({ channelId: null, deleteAt: null }).where(eq(castSessions.id, id));
}

// ───────── 見る ─────────

export type CastStat = { castId: string; count: number; earned: number; ratingAvg: number | null; ratings: number };

/** since からの指名数・売り上げ・評価（終わったものだけ） */
export async function castStats(db: Db, since: Date, castId?: string, until?: Date): Promise<CastStat[]> {
  const rows = await db
    .select({
      castId: castSessions.castId,
      count: sql<number>`count(*)::int`,
      earned: sql<number>`coalesce(sum(${castSessions.paid}), 0)::int`,
      ratingAvg: sql<number | null>`avg(${castSessions.rating})::float`,
      ratings: sql<number>`count(${castSessions.rating})::int`,
    })
    .from(castSessions)
    .where(and(eq(castSessions.status, 'done'), gte(castSessions.closedAt, since), castId ? eq(castSessions.castId, castId) : undefined, until ? lt(castSessions.closedAt, until) : undefined))
    .groupBy(castSessions.castId);
  return rows.map((r) => ({ ...r, ratingAvg: r.ratingAvg === null ? null : Math.round(r.ratingAvg * 10) / 10 })).sort((a, b) => b.count - a.count || b.earned - a.earned);
}

/** 日本時間の今月 1 日 */
export function monthStart(now = new Date()): Date {
  const j = new Date(now.getTime() + JST);
  return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), 1) - JST);
}

export type CastReception = {
  cast: Cast;
  state: 'waiting' | 'busy' | 'off' | 'pending' | 'paused';
  current: CastSession[];
  today: CastSession[];
  stat: CastStat;
  now: Date;
};

/** キャスト本人の受付。予約の日付と売上の月は日本時間で数える */
export async function loadCastReception(db: Db, castId: string, now = new Date()): Promise<CastReception | undefined> {
  const cast = await getCast(db, castId);
  if (!cast || cast.status === 'removed') return undefined;
  const j = new Date(now.getTime() + JST);
  const start = new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate()) - JST);
  const end = new Date(start.getTime() + 24 * 60 * MIN);
  const [current, today, stats] = await Promise.all([
    db.select().from(castSessions).where(and(eq(castSessions.castId, castId), inArray(castSessions.status, ['requested', 'active']))).orderBy(asc(castSessions.createdAt)),
    db.select().from(castSessions).where(and(eq(castSessions.castId, castId), gte(castSessions.startAt, start), lt(castSessions.startAt, end), inArray(castSessions.status, ['reserved', 'accepted', 'active', 'done', 'disputed']))).orderBy(asc(castSessions.startAt)),
    castStats(db, monthStart(now), castId, new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth() + 1, 1) - JST)),
  ]);
  const state = cast.status === 'pending' ? 'pending' : cast.status === 'paused' ? 'paused' : current.length ? 'busy' : cast.available === 'waiting' && cast.waitingUntil && cast.waitingUntil > now ? 'waiting' : 'off';
  return { cast, state, current, today, stat: stats[0] ?? { castId, count: 0, earned: 0, ratingAvg: null, ratings: 0 }, now };
}

export async function recentSessions(db: Db, limit = 100): Promise<CastSession[]> {
  return db
    .select()
    .from(castSessions)
    .orderBy(sql`case when ${castSessions.status} = 'disputed' then 0 when ${castSessions.status} in ('active','requested','reserved','accepted') then 1 else 2 end`, desc(castSessions.createdAt))
    .limit(limit);
}

/** キャストの今の状態（📞 通話中 > 🟢 待機中 > 💤 お休み） */
export async function castStates(db: Db): Promise<Map<string, 'busy' | 'waiting' | 'off'>> {
  const list = await listCasts(db);
  const busy = new Set(
    (await db.select({ castId: castSessions.castId }).from(castSessions).where(or(eq(castSessions.status, 'active'), eq(castSessions.status, 'requested')))).map((r) => r.castId),
  );
  return new Map(list.map((x) => [x.memberId, busy.has(x.memberId) ? 'busy' : x.available === 'waiting' ? 'waiting' : 'off']));
}

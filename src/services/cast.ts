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
  /** 男性キャストのメニューを出すチャンネル（#キャスト一覧） */
  channelId?: string;
  panelMessageId?: string;
  /** 女性キャストのメニューを出すチャンネル */
  femaleChannelId?: string;
  femalePanelMessageId?: string;
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
  /** メニューのテンプレ（登録のときやボタン 1 つでキャストに入れる）。なければ DEFAULT_MENU_TEMPLATE */
  menuTemplate?: CastMenuItem[];
};
export const CAST_DEFAULTS: CastConfig = { priceMin: 1, priceMax: 30_000, feePercent: 10, acceptMinutes: 10 };
const KEY = 'cast';
const sf = (x: unknown) => (typeof x === 'string' && /^\d{17,20}$/.test(x) ? x : undefined);
const int = (x: unknown, d: number, lo: number, hi: number) => (typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi ? x : d);

export async function loadCastConfig(db: Db): Promise<CastConfig> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  const v = (row?.value ?? {}) as Record<string, unknown>;
  const d = CAST_DEFAULTS;
  // 値段の下限はいつも 1 銭（前に保存した下限は使わない）
  const priceMin = d.priceMin;
  return {
    channelId: sf(v.channelId),
    panelMessageId: sf(v.panelMessageId),
    femaleChannelId: sf(v.femaleChannelId),
    femalePanelMessageId: sf(v.femalePanelMessageId),
    roleId: sf(v.roleId),
    privateCategoryId: sf(v.privateCategoryId),
    publicCategoryId: sf(v.publicCategoryId),
    priceMin,
    priceMax: Math.max(priceMin, int(v.priceMax, d.priceMax, 1, 1_000_000)),
    feePercent: int(v.feePercent, d.feePercent, 0, 90),
    acceptMinutes: int(v.acceptMinutes, d.acceptMinutes, 1, 60),
    ...(Array.isArray(v.menuTemplate) ? { menuTemplate: (v.menuTemplate as unknown[]).filter(isMenuItem).slice(0, MENU_MAX) } : {}),
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

// ───────── 男性・女性 ─────────

export type CastGroup = 'male' | 'female';
export const CAST_GROUPS: CastGroup[] = ['male', 'female'];
export const GROUP_LABEL: Record<CastGroup, string> = { male: '👨 男性キャスト', female: '👩 女性キャスト' };
export const isCastGroup = (x: unknown): x is CastGroup => x === 'male' || x === 'female';
/** そのメニューに出るキャストか（まだ決めていない人は両方に出る） */
export const inGroup = (c: Pick<Cast, 'gender'>, g: CastGroup) => c.gender === g || c.gender === '';
/** そのメニューのチャンネルと出したメッセージ */
export const groupPlace = (c: CastConfig, g: CastGroup) => (g === 'female' ? { channelId: c.femaleChannelId, messageId: c.femalePanelMessageId } : { channelId: c.channelId, messageId: c.panelMessageId });
/** そのキャストの相談・予約のスレッドを作るチャンネル（自分のメニューのチャンネル。なければもう片方） */
export const castHomeChannel = (c: CastConfig, cast: Pick<Cast, 'gender'>) => (cast.gender === 'female' ? (c.femaleChannelId ?? c.channelId) : (c.channelId ?? c.femaleChannelId));

export async function setCastGender(db: Db, id: string, gender: Cast['gender']): Promise<Cast | undefined> {
  const [row] = await db.update(casts).set({ gender }).where(eq(casts.memberId, id)).returning();
  return row;
}

// ───────── メニューの画像 ─────────

const imageKey = (g: CastGroup) => (g === 'female' ? 'menu:female' : 'menu');

export async function saveMenuImage(db: Db, data: Uint8Array, g: CastGroup = 'male'): Promise<string | undefined> {
  const kind = detectImage(data);
  if (!kind) return undefined;
  const hash = createHash('sha256').update(data).digest('hex').slice(0, 16);
  await db
    .insert(castImages)
    .values({ key: imageKey(g), contentType: kind.type, data, hash })
    .onConflictDoUpdate({ target: castImages.key, set: { contentType: kind.type, data, hash, updatedAt: new Date() } });
  return hash;
}

export async function loadMenuImage(db: Db, g: CastGroup = 'male'): Promise<{ contentType: string; data: Uint8Array; hash: string } | undefined> {
  const [row] = await db.select().from(castImages).where(eq(castImages.key, imageKey(g)));
  return row && { contentType: row.contentType, data: row.data, hash: row.hash };
}

export async function deleteMenuImage(db: Db, g: CastGroup = 'male'): Promise<void> {
  await db.delete(castImages).where(eq(castImages.key, imageKey(g)));
}

/** 紹介用の写真。切りぬかずに全体を残し、長い辺 1600px までに小さくする。名前や位置情報は残さない。 */
export async function saveCastPhoto(db: Db, memberId: string, data: Uint8Array): Promise<string | undefined> {
  if (!sf(memberId) || data.length > 8 * 1024 * 1024 || !detectImage(data)) return undefined;
  const cast = await getCast(db, memberId);
  if (!cast || cast.status === 'removed') return undefined;
  let photo: Buffer;
  try {
    photo = await sharp(data, { limitInputPixels: 40_000_000 }).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
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

/** 時間フリー（時間 0 で作ったメニュー）。終えるまで続く。念のため、この分で自動で終わる */
export const FREE_MINUTES = 12 * 60;
/** 時間フリーのメニューか（寝落ち・相談でなく、時間 0） */
export const isFreeMenu = (m: Pick<CastMenuItem, 'minutes' | 'night' | 'consult'> & { delivery?: boolean }) => !m.night && !m.consult && !m.delivery && m.minutes === 0;
/** 📦 納品の指名か（番号が dlv: で始まる） */
export const isDeliverySession = (s: Pick<CastSession, 'plan'>) => s.plan.startsWith('dlv:');
/** 納品の期限（注文から）と、納品してからお客が受け取らないときに自動で渡すまで */
export const DELIVERY = { deadlineHours: 24, autoReceiveHours: 72, gachaMax: 20 } as const;
/** 時間フリーの指名か（番号が free: で始まる） */
export const isFreeSession = (s: Pick<CastSession, 'plan'>) => s.plan.startsWith('free:');
const durationText = (m: number) => (m % 60 === 0 ? `${m / 60} 時間` : m > 60 ? `${Math.floor(m / 60)} 時間 ${m % 60} 分` : `${m} 分`);
/** 「雑談（30 分）」「🌙 寝落ち（朝 7 時まで）」 */
export const menuLabel = (m: Pick<CastMenuItem, 'name' | 'minutes' | 'night' | 'consult'> & { delivery?: boolean; gacha?: string[] }) =>
  m.delivery ? (m.gacha?.length ? `🎰 ${m.name}（ガチャ・${m.gacha.length} 種）` : `📦 ${m.name}（納品）`) : m.consult ? `💬 ${m.name}（内容により相談）` : m.night ? `🌙 ${m.name}（朝 7 時まで）` : m.minutes === 0 ? `${m.name}（時間フリー）` : `${m.name}（${durationText(m.minutes)}）`;
/** 値段を出すところ（相談は「相談」） */
export const menuPriceText = (m: Pick<CastMenuItem, 'price' | 'consult'>) => (m.consult ? '相談' : `${m.price.toLocaleString('ja-JP')} 枚`);
/** 指名の名前（前の指名はプランの名前） */
export const sessionLabel = (s: Pick<CastSession, 'plan' | 'menuName'> & { optionNames?: string[] }) =>
  (s.menuName || PLAN_LABEL[s.plan as CastPlan] || s.plan) + (s.optionNames?.length ? `＋${s.optionNames.join('・')}` : '');
/** 18 歳未満の人も選べるメニューか（寝落ちでなく、60 分まで） */
export const minorMenuOk = (m: CastMenuItem) => !m.delivery && !m.night && !m.consult && !isFreeMenu(m) && m.minutes <= MINOR.maxMinutes;
/** メニューを 1 行で（紹介・一覧） */
export const menuText = (c: Pick<Cast, 'menu' | 'price30' | 'price60' | 'priceNight'>) =>
  menuOf(c).map((m) => (m.consult ? `${m.name} 相談` : `${menuLabel(m)} ${m.price.toLocaleString('ja-JP')}`)).join('・');

export type MenuInput = { name: string; note: string; minutes: number; price: number; night: boolean; consult?: boolean; /** 📦 納品 */ delivery?: boolean; /** 納品のガチャの中身 */ gacha?: string[] };

const validMinutes = (n: number) => Number.isInteger(n) && n >= MENU_MINUTES.min && n <= MENU_MINUTES.max;
const validPrice = (c: CastConfig, n: number) => Number.isInteger(n) && n >= c.priceMin && n <= c.priceMax;

export function validMenuItem(c: CastConfig, m: MenuInput): boolean {
  if (m.name.length < 1 || m.name.length > 30 || m.note.length > 100) return false;
  // 相談は、値段と時間をそのつど決める
  if (m.consult) return true;
  if (m.delivery) return validPrice(c, m.price) && (m.gacha ?? []).length <= DELIVERY.gachaMax && (m.gacha ?? []).every((g) => g.length >= 1 && g.length <= 50);
  // 時間 0 は時間フリー
  return validPrice(c, m.price) && (m.night || m.minutes === 0 || validMinutes(m.minutes));
}

/** 相談のメニューで、キャストが出す時間と値段 */
export const validQuote = (c: CastConfig, minutes: number, price: number) => validMinutes(minutes) && validPrice(c, price);

const newMenuId = () => Math.random().toString(36).slice(2, 8);
const asItem = (m: MenuInput): CastMenuItem => ({
  id: newMenuId(), name: m.name, note: m.note,
  minutes: m.night || m.consult || m.delivery ? 0 : m.minutes, price: m.consult ? 0 : m.price, night: !m.consult && !m.delivery && m.night,
  ...(m.consult && !m.delivery ? { consult: true } : {}),
  ...(m.delivery ? { delivery: true, ...(m.gacha?.length ? { gacha: m.gacha } : {}) } : {}),
});

/** メニューを足す（運営。1 回に何こでも＝同じ内容の 30 分と 1 時間など）。前の値段から作ったメニューは、そのまま引きつぐ */
export async function addMenuItem(db: Db, c: CastConfig, castId: string, input: MenuInput | MenuInput[]): Promise<'ok' | 'invalid' | 'full' | 'not_cast'> {
  const items = Array.isArray(input) ? input : [input];
  if (!items.length || !items.every((m) => validMenuItem(c, m))) return 'invalid';
  return db.transaction(async (tx) => {
    const [cast] = await tx.select().from(casts).where(eq(casts.memberId, castId)).for('update');
    if (!cast || cast.status === 'removed') return 'not_cast' as const;
    const menu = menuOf(cast);
    if (menu.length + items.length > MENU_MAX) return 'full' as const;
    await tx.update(casts).set({ menu: [...menu, ...items.map(asItem)], price30: 0, price60: 0, priceNight: 0 }).where(eq(casts.memberId, castId));
    return 'ok' as const;
  });
}

/** メニューを外す（運営）。もう入っている指名・予約はそのまま */
// ───────── オプション（指名に足す追加。キャストごと） ─────────

export type CastOption = Cast['options'][number];
/** 1 人のオプションの数（選んだ番号をボタンに入れるので少なめ） */
export const OPTION_MAX = 8;

export function validOption(c: CastConfig, o: { name: string; price: number }): boolean {
  return o.name.length >= 1 && o.name.length <= 30 && Number.isInteger(o.price) && o.price >= 1 && o.price <= c.priceMax;
}

/** オプションを足す（運営） */
export async function addOption(db: Db, c: CastConfig, castId: string, o: { name: string; price: number }): Promise<'ok' | 'invalid' | 'full' | 'not_cast'> {
  if (!validOption(c, o)) return 'invalid';
  return db.transaction(async (tx) => {
    const [cast] = await tx.select().from(casts).where(eq(casts.memberId, castId)).for('update');
    if (!cast || cast.status === 'removed') return 'not_cast' as const;
    if (cast.options.length >= OPTION_MAX) return 'full' as const;
    await tx.update(casts).set({ options: [...cast.options, { id: newMenuId(), name: o.name, price: o.price }] }).where(eq(casts.memberId, castId));
    return 'ok' as const;
  });
}

/** オプションを外す（運営）。もう入っている指名はそのまま */
export async function removeOption(db: Db, castId: string, optionId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [cast] = await tx.select().from(casts).where(eq(casts.memberId, castId)).for('update');
    if (!cast || !cast.options.some((o) => o.id === optionId)) return false;
    await tx.update(casts).set({ options: cast.options.filter((o) => o.id !== optionId) }).where(eq(casts.memberId, castId));
    return true;
  });
}

/** 選んだオプション（知らない番号・重なりは除く） */
export const pickOptions = (cast: Pick<Cast, 'options'>, ids: readonly string[] = []) => cast.options.filter((o) => ids.includes(o.id));

// ───────── メニューのテンプレ・書きかえ ─────────

const tpl = (id: string, name: string, minutes: number, price: number, extra: Partial<CastMenuItem> = {}): CastMenuItem => ({ id, name, note: '', minutes, price, night: false, ...extra });
/** はじめのテンプレ（社務所Web で変えられる） */
export const DEFAULT_MENU_TEMPLATE: CastMenuItem[] = [
  tpl('t1', 'ツーショット', 30, 200),
  tpl('t2', 'ツーショット', 60, 350),
  tpl('t3', '寝かしつけ', 30, 300),
  tpl('t4', 'メンケア', 30, 250),
  tpl('t5', 'メンケア', 60, 450),
  tpl('t6', 'おねがい', 0, 0, { consult: true }),
];
export const templateOf = (c: CastConfig) => c.menuTemplate ?? DEFAULT_MENU_TEMPLATE;

function isMenuItem(x: unknown): x is CastMenuItem {
  const m = x as CastMenuItem;
  return !!m && typeof m.id === 'string' && typeof m.name === 'string' && typeof m.note === 'string' && Number.isInteger(m.minutes) && Number.isInteger(m.price) && typeof m.night === 'boolean';
}

/** テンプレをそのキャストのメニューに入れる（今のメニューは入れかえる） */
export async function applyTemplate(db: Db, c: CastConfig, castId: string): Promise<boolean> {
  const menu = templateOf(c).map((m) => ({ ...m, id: newMenuId() }));
  if (!menu.length) return false;
  const [row] = await db.update(casts).set({ menu, price30: 0, price60: 0, priceNight: 0 }).where(and(eq(casts.memberId, castId), inArray(casts.status, ['pending', 'active', 'paused']))).returning();
  return Boolean(row);
}

/** テンプレに足す・外す・書きかえる（設定に保存する） */
export async function editTemplate(db: Db, c: CastConfig, by: string, op: { add: MenuInput[] } | { remove: string } | { update: string; input: MenuInput }): Promise<'ok' | 'invalid' | 'full' | 'none'> {
  const cur = templateOf(c);
  let next: CastMenuItem[];
  if ('add' in op) {
    if (!op.add.length || !op.add.every((m) => validMenuItem(c, m))) return 'invalid';
    if (cur.length + op.add.length > MENU_MAX) return 'full';
    next = [...cur, ...op.add.map(asItem)];
  } else if ('remove' in op) {
    if (!cur.some((m) => m.id === op.remove)) return 'none';
    next = cur.filter((m) => m.id !== op.remove);
  } else {
    const old = cur.find((m) => m.id === op.update);
    if (!old) return 'none';
    const input = { ...op.input, night: old.night, consult: old.consult, delivery: old.delivery, gacha: op.input.gacha ?? old.gacha };
    if (!validMenuItem(c, input)) return 'invalid';
    next = cur.map((m) => (m.id === op.update ? { ...asItem(input), id: m.id } : m));
  }
  await saveCastConfig(db, { ...c, menuTemplate: next }, by);
  return 'ok';
}

/** キャストのメニューを 1 つ書きかえる（内容・説明・時間・値段。寝落ち・相談はそのまま）。もう入っている指名はそのまま */
export async function updateMenuItem(db: Db, c: CastConfig, castId: string, itemId: string, input: MenuInput): Promise<'ok' | 'invalid' | 'none'> {
  return db.transaction(async (tx) => {
    const [cast] = await tx.select().from(casts).where(eq(casts.memberId, castId)).for('update');
    if (!cast) return 'none' as const;
    const menu = menuOf(cast);
    const old = menu.find((m) => m.id === itemId);
    if (!old) return 'none' as const;
    const fixed = { ...input, night: old.night, consult: old.consult, delivery: old.delivery, gacha: input.gacha ?? old.gacha };
    if (!validMenuItem(c, fixed)) return 'invalid' as const;
    await tx.update(casts).set({ menu: menu.map((m) => (m.id === itemId ? { ...asItem(fixed), id: m.id } : m)), price30: 0, price60: 0, priceNight: 0 }).where(eq(casts.memberId, castId));
    return 'ok' as const;
  });
}

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
export async function registerCast(db: Db, c: CastConfig, who: { id: string; adult: boolean }, p: Pick<ProfileInput, 'bio' | 'tags' | 'minorOk'> & { gender?: Cast['gender'] }, firstInput: MenuInput | MenuInput[], by: string, now = new Date()): Promise<RegisterCastResult> {
  if (!who.adult) return { status: 'not_adult' };
  const { gender = '', ...rest } = p;
  const profile = { ...rest, price30: 0, price60: 0, priceNight: 0 };
  const first = Array.isArray(firstInput) ? firstInput : [firstInput];
  if (!validProfile(c, profile) || !first.length || first.length > MENU_MAX || !first.every((m) => validMenuItem(c, m))) return { status: 'invalid' };
  const cur = await getCast(db, who.id);
  if (cur && (cur.status === 'active' || cur.status === 'paused')) return { status: 'already' };
  const values = { memberId: who.id, status: 'active' as const, available: 'off' as const, ...profile, gender, menu: first.map(asItem), appliedAt: now, approvedAt: now, approvedBy: by };
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
  | { status: 'ok'; session: CastSession; balance: number; /** ガチャで出たもの */ drawn?: string }
  | { status: 'insufficient'; price: number; balance: number }
  | { status: 'not_cast' | 'self' | 'blocked' | 'busy' | 'no_plan' | 'minor_plan' | 'minor_hours' | 'minor_off' | 'minor_reserve' | 'has_open' | 'bad_time' | 'overlap' | 'self_overlap' };

/** 同じキャストの利用時間が重なるか（終わりと次の始まりが同じならよい） */
/** 1 人のお客が同時に持てる指名（予約・返事待ち・通話中）の数 */
export const CUSTOMER_OPEN_MAX = 5;

async function overlaps(tx: Db, castId: string, start: Date, end: Date, now: Date, except?: number, by: 'cast' | 'customer' = 'cast'): Promise<boolean> {
  const who = by === 'cast' ? eq(castSessions.castId, castId) : eq(castSessions.customerId, castId);
  const sessions = await tx.select().from(castSessions).where(and(who, inArray(castSessions.status, OPEN)));
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
  input: { castId: string; customerId: string; customerAdult: boolean; /** メニューの番号 */ plan: string; startAt?: Date; /** 📦 納品の注文のお願い */ request?: string; /** 相談のメニュー: キャストが出した時間と値段 */ quote?: { minutes: number; price: number }; /** 付けるオプションの番号 */ options?: string[] },
  now = new Date(),
  rand: () => number = Math.random,
): Promise<RequestResult> {
  const cast = await getCast(db, input.castId);
  if (!cast || cast.status !== 'active') return { status: 'not_cast' };
  if (input.castId === input.customerId) return { status: 'self' };
  if (cast.blocked.includes(input.customerId)) return { status: 'blocked' };
  const found = menuOf(cast).find((m) => m.id === input.plan);
  // 相談のメニューは、キャストが出した時間と値段で（ほかのメニューに値段は付けられない）
  const item = found?.consult ? (input.quote && validQuote(c, input.quote.minutes, input.quote.price) ? { ...found, ...input.quote } : undefined) : input.quote ? undefined : found;
  if (!item || item.price <= 0) return { status: 'no_plan' };
  if (item.delivery) return input.startAt || input.quote || input.options?.length ? { status: 'no_plan' } : orderDelivery(db, cast.memberId, item, input, now, rand);
  const opts = pickOptions(cast, input.options);
  if (input.options && opts.length !== new Set(input.options).size) return { status: 'no_plan' };
  const optionPrice = opts.reduce((n, o) => n + o.price, 0);
  const price = item.price + optionPrice;
  const free = isFreeMenu(item);
  const plan = item.night ? 'night' : free ? `free:${item.id}` : item.id;
  const start = input.startAt ?? now;
  if (input.startAt && (input.startAt.getTime() < now.getTime() + 10 * MIN || input.startAt.getTime() > now.getTime() + 7 * 24 * 60 * MIN)) return { status: 'bad_time' };
  const minutes = item.night ? planMinutes('night', start) : free ? FREE_MINUTES : item.minutes;
  if (!input.customerAdult) {
    // 18 歳未満の人も予約できる（公開の部屋・60 分まで・22 時までに終わる）
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
    // 時間が重ならなければ何件でも（5 件まで）。重なるかは下で確かめる
    if (mine.length >= CUSTOMER_OPEN_MAX) return { status: 'has_open' as const };
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
    // 同じお客の、ほかの指名と時間が重なる
    if (await overlaps(tx, input.customerId, start, end, now, undefined, 'customer')) return { status: 'self_overlap' as const };
    if (!(await spendWithin(tx, input.customerId, price, 'cast_pay', { castId: input.castId, plan, menu: item.name, ...(opts.length ? { options: opts.map((o) => o.name) } : {}) }))) {
      return { status: 'insufficient' as const, price, balance: (await walletOf(tx, input.customerId)).balance };
    }
    const [session] = await tx
      .insert(castSessions)
      .values({
        castId: input.castId,
        customerId: input.customerId,
        plan,
        menuName: cast.menu.length ? (item.consult ? `${item.name}（相談）` : item.name) : '',
        optionNames: opts.map((o) => o.name),
        optionPrice,
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

/** 📦 納品の注文: 銭を預かり、キャストの納品を待つ（期限 24 時間）。18 歳以上だけ。通話の時間とは重ならない */
async function orderDelivery(db: Db, castId: string, item: CastMenuItem, input: { customerId: string; customerAdult: boolean }, now: Date, rand: () => number): Promise<RequestResult> {
  if (!input.customerAdult) return { status: 'minor_plan' };
  const drawn = item.gacha?.length ? item.gacha[Math.min(item.gacha.length - 1, Math.floor(rand() * item.gacha.length))] : undefined;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'cast-customer:' + input.customerId}))`);
    const mine = await tx.select({ id: castSessions.id }).from(castSessions).where(and(eq(castSessions.customerId, input.customerId), inArray(castSessions.status, ['ordered', 'delivered'])));
    if (mine.length >= CUSTOMER_OPEN_MAX) return { status: 'has_open' as const };
    if (!(await spendWithin(tx, input.customerId, item.price, 'cast_pay', { castId, plan: `dlv:${item.id}`, menu: item.name, ...(drawn ? { drawn } : {}) }))) {
      return { status: 'insufficient' as const, price: item.price, balance: (await walletOf(tx, input.customerId)).balance };
    }
    const [session] = await tx
      .insert(castSessions)
      .values({
        castId, customerId: input.customerId, plan: `dlv:${item.id}`,
        menuName: drawn ? `${item.name}：${drawn}` : item.name,
        minutes: 0, price: item.price, status: 'ordered',
        acceptBy: new Date(now.getTime() + DELIVERY.deadlineHours * 60 * MIN), createdAt: now,
      })
      .returning();
    return { status: 'ok' as const, session: session!, balance: (await walletOf(tx, input.customerId)).balance, ...(drawn ? { drawn } : {}) };
  });
}

/** 📦 キャストが「納品した」: お客の受け取り待ちにする（受け取らないままなら 72 時間で自動で渡す） */
export async function deliverSession(db: Db, id: number, castId: string, now = new Date()): Promise<CastSession | undefined> {
  const s = await getSession(db, id);
  if (!s || s.castId !== castId || (s.acceptBy && s.acceptBy <= now)) return undefined;
  return move(db, id, ['ordered'], { status: 'delivered', acceptBy: null, endsAt: new Date(now.getTime() + DELIVERY.autoReceiveHours * 60 * MIN) });
}

/** 📦 お客が「受け取った」（か、自動で渡す時刻が来た）: 手数料を引いてキャストに渡す */
export async function receiveSession(db: Db, c: CastConfig, id: number, by: string, now = new Date()): Promise<CastSession | undefined> {
  return db.transaction(async (tx) => {
    const s = (await tx.select().from(castSessions).where(eq(castSessions.id, id)).for('update'))[0];
    if (!s || s.status !== 'delivered') return undefined;
    if (by === 'system' ? !s.endsAt || s.endsAt > now : by !== s.customerId) return undefined;
    const pay = s.price - castFee(c, s.price);
    const row = await move(tx, id, ['delivered'], { status: 'done', closedAt: now, paid: pay, decidedBy: by });
    if (!row) return undefined;
    if (pay > 0) await addCoins(tx, s.castId, pay, 'cast_reward', { sessionId: id, from: s.customerId, fee: s.price - pay, delivery: true });
    return row;
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
    // 納品の注文は、お客からは取り消せない（キャストが作り始めているかもしれない）
    if (s.status === 'ordered' && reason === 'canceled' && by !== 'system') return undefined;
    const row = await move(tx, id, ['reserved', 'accepted', 'requested', 'ordered'], { status: reason, closedAt: now, decidedBy: by, deleteAt: now });
    if (!row) return undefined;
    if (s.price > 0) await addCoins(tx, s.customerId, s.price, 'cast_refund', { sessionId: id, reason });
    return row;
  });
}

export type RescheduleResult = { status: 'ok'; session: CastSession } | { status: 'not_found' | 'not_customer' | 'bad_time' | 'minor_hours' | 'overlap' | 'self_overlap' };

/**
 * キャストが出した別の日時に、お客が「この日時にする」: 予約の時刻を変えて、受けた（確定）にする。
 * キャストとお客のほかの指名と重ならないか・18 歳未満の人は 22 時までに終わるかを確かめる
 */
export async function rescheduleSession(db: Db, id: number, customerId: string, startAt: Date, now = new Date()): Promise<RescheduleResult> {
  const before = await getSession(db, id);
  if (!before) return { status: 'not_found' };
  return db.transaction(async (tx) => {
    await lockCast(tx, before.castId);
    const s = (await tx.select().from(castSessions).where(eq(castSessions.id, id)).for('update'))[0];
    if (!s || (s.status !== 'reserved' && s.status !== 'accepted')) return { status: 'not_found' as const };
    if (s.customerId !== customerId) return { status: 'not_customer' as const };
    if (startAt.getTime() < now.getTime() + 10 * MIN || startAt.getTime() > now.getTime() + 7 * 24 * 60 * MIN) return { status: 'bad_time' as const };
    const minutes = s.plan === 'night' ? planMinutes('night', startAt) : s.minutes;
    if (s.isPublic && !minorWindowOk(startAt, minutes)) return { status: 'minor_hours' as const };
    const end = s.plan === 'night' ? nightEnd(startAt) : new Date(startAt.getTime() + minutes * MIN);
    if (await overlaps(tx, s.castId, startAt, end, now, id)) return { status: 'overlap' as const };
    if (await overlaps(tx, s.customerId, startAt, end, now, id, 'customer')) return { status: 'self_overlap' as const };
    const row = await move(tx, id, ['reserved', 'accepted'], { status: 'accepted', startAt, acceptBy: null, minutes });
    return row ? { status: 'ok' as const, session: row } : { status: 'not_found' as const };
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
    // 時間フリーは、のばさない（終えるまで続く）
    if (isFreeSession(s)) return { status: 'not_active' as const };
    const cast = await getCast(tx, s.castId);
    // 30 分のばす値段: 前のプランは 30 分の値段。メニューの指名は、その指名と同じ割合（1 分あたり）
    // オプションの分は、のばす値段に入れない
    const base = s.price - s.optionPrice;
    const add = !cast ? 0 : s.menuName ? Math.ceil((base * 30) / Math.max(1, s.minutes)) : cast.price30 || Math.ceil((base * 30) / Math.max(1, s.minutes));
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
    // 時間フリーは、キャストが終えても全額（時間で割らない）
    if (by === s.castId && s.startedAt && s.endsAt && now < s.endsAt && !isFreeSession(s)) {
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
  return move(db, id, ['active', 'accepted', 'ordered', 'delivered'], { status: 'disputed', deleteAt: new Date((s.endsAt ?? new Date()).getTime() + 5 * MIN) });
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
  for (const s of await db.select().from(castSessions).where(and(inArray(castSessions.status, ['requested', 'reserved', 'ordered']), lte(castSessions.acceptBy, now)))) {
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
  for (const s of await db.select().from(castSessions).where(and(eq(castSessions.status, 'delivered'), lte(castSessions.endsAt, now)))) {
    const r = await receiveSession(db, c, s.id, 'system', now);
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

/** 当日に先に部屋を立ててよいか: 受けた予約で、キャストかお客で、日本時間で同じ日・まだ始まる前 */
export function earlyRoomOk(s: CastSession, userId: string, now = new Date()): 'ok' | 'not_member' | 'not_accepted' | 'not_today' {
  if (s.castId !== userId && s.customerId !== userId) return 'not_member';
  if (s.status !== 'accepted' || !s.startAt) return 'not_accepted';
  if (jstAt(now, 0).getTime() !== jstAt(s.startAt, 0).getTime()) return 'not_today';
  return 'ok';
}

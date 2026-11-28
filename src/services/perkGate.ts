import { eq } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';
import { highestRank } from '../domain/ranks.js';
import { emaPromotionEnabled } from './emaPromotion.js';
import { newSystemStartedAt } from './shuin.js';
import { isBoosting } from './rooms.js';
import { newSystemRoles } from './ujikoKeep.js';

/**
 * 🎁 特典のゲート（新制度⑤）：カジノ・宿を「氏子から」にするスイッチ。宮司が社務所Webで切り替える。
 * 既定は OFF＝今までどおり（参拝者から）。ON＝氏子以上だけ。
 */
const KEY = 'perk_ujiko';

export async function perkUjikoEnabled(db: Db): Promise<boolean> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  return (row?.value as { on?: boolean } | undefined)?.on === true;
}

export async function setPerkUjiko(db: Db, on: boolean, by: string): Promise<void> {
  await db
    .insert(settings)
    .values({ key: KEY, value: { on }, updatedBy: by })
    .onConflictDoUpdate({ target: settings.key, set: { value: { on }, updatedBy: by, updatedAt: new Date() } });
}

/** その人が氏子以上か（役職の格で判定） */
export function meetsUjiko(cfg: GuildConfig, roleIds: Iterable<string>): boolean {
  const ujikoWeight = cfg.ranks.find((r) => r.key === 'ujiko')?.weight;
  if (ujikoWeight === undefined) return true;
  const rank = highestRank(cfg.ranks, roleIds);
  return rank !== undefined && rank.weight >= ujikoWeight;
}

/** 宿だけの利用条件。奉納中は階級にかかわらず利用できる（厄・部屋主・入室権限は呼び出し側で確認）。 */
export async function canUseRoomFeatures(db: Db, cfg: GuildConfig, memberId: string, roleIds: Iterable<string>): Promise<boolean> {
  return meetsUjiko(cfg, roleIds) || await isBoosting(db, memberId);
}

/** 新制度が始まっているか（③絵馬での昇格が ON・④ご縁のリセットずみ） */
export async function newSystemActive(db: Db): Promise<boolean> {
  return Boolean(await newSystemStartedAt(db)) && (await emaPromotionEnabled(db));
}

/**
 * 🏨 宿・シクレの作成に、氏子以上または奉納中という条件を使うか。
 * 新制度が始まったら、氏子以上か奉納中の人だけ。その前は⑤のスイッチで決める。
 */
export async function roomsUjikoOnly(db: Db): Promise<boolean> {
  return (await perkUjikoEnabled(db)) || (await newSystemActive(db));
}

/**
 * 🎰 新制度の、ロールごとのカジノの1日の上限（本人の決定 2026-11-27）。
 * 荒魂＝aramitamaDailyBetLimit（500）／参拝者・元氏子＝sanpaishaDailyBetLimit（5,000）。氏子以上は null（ふつうの上限）。
 * 当てはまる人は、大勝負の札でも上がらない。新制度が始まるまでは null。
 */
export async function casinoRoleLimit(db: Db, cfg: GuildConfig, roleIds: readonly string[]): Promise<{ limit: number; who: 'aramitama' | 'sanpaisha' } | null> {
  if (!(await newSystemActive(db))) return null;
  const ara = (await newSystemRoles(db)).aramitama;
  if (ara && roleIds.includes(ara)) return { limit: cfg.casino.aramitamaDailyBetLimit, who: 'aramitama' };
  if (meetsUjiko(cfg, roleIds)) return null;
  // 位のロールがない人（運営だけのロールなど）は、今までどおり
  if (!highestRank(cfg.ranks, roleIds)) return null;
  return { limit: cfg.casino.sanpaishaDailyBetLimit, who: 'sanpaisha' };
}

/** 🔥 荒魂のロール ID（新制度が始まっていて、設定ずみのときだけ）。カジノに入れる人の判定に使う */
export async function aramitamaAccessRole(db: Db): Promise<string | undefined> {
  if (!(await newSystemActive(db))) return undefined;
  return (await newSystemRoles(db)).aramitama;
}

import { eq } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';
import { highestRank } from '../domain/ranks.js';

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

import { z } from 'zod';
import { coreTimeSchema, guildConfigSchema, roomsSchema, type GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';
import { logger } from '../lib/logger.js';

/**
 * 管理画面（宮司）から変えられる設定。config/guild.json の値を上書きする。
 * ID（チャンネル・ロール）は変えられない（間違えると BOT が動かなくなるため、ファイルで管理する）。
 */
export const overridesSchema = z.object({
  economy: z
    .object({
      currencyName: z.string().min(1).max(20),
      currencyEmoji: z.string().max(10),
      voicePer10Min: z.number().int().min(0).max(1000),
      voiceDailyCap: z.number().int().min(0).max(100000),
      shuinGive: z.number().int().min(0).max(1000),
      shuinReceive: z.number().int().min(0).max(1000),
      menzaifuPrice: z.number().int().positive().max(1_000_000),
      menzaifuMaxUses: z.number().int().min(0).max(100),
      omikujiBase: z.number().int().min(0).max(10000),
      joinBonus: z.number().int().min(0).max(1_000_000),
      giftMin: z.number().int().positive().max(1_000_000),
      giftMax: z.number().int().positive().max(1_000_000),
      giftDailyLimit: z.number().int().min(0).max(10_000_000),
      boostThanks: z.number().int().min(0).max(1_000_000),
      boostDiscountPercent: z.number().int().min(0).max(90),
      coreTimePercent: z.number().int().min(100).max(500),
    })
    .partial()
    .default({}),
  /** 役職キーごとの格・昇格ライン */
  ranks: z
    .record(
      z.string(),
      z.object({ weight: z.number().int().positive().max(100), requiredGoen: z.number().int().min(0).max(1_000_000) }).partial(),
    )
    .default({}),
  omairi: z.object({ days: z.number().int().positive().max(365), extendDays: z.number().int().min(0).max(365) }).partial().default({}),
  coreTime: coreTimeSchema.partial().default({}),
  rooms: roomsSchema.partial().default({}),
  boost: z.object({ announceText: z.string().min(1).max(1000), dmText: z.string().min(1).max(1000) }).partial().default({}),
  applications: z.object({ autoApproveAccountDays: z.number().int().min(0).max(3650), kickOnReject: z.boolean() }).partial().default({}),
});

export type Overrides = z.infer<typeof overridesSchema>;

const KEY = 'overrides';

/** ファイルの設定に上書きを重ねる。おかしな組み合わせ（昇格ラインの重複など）はエラー */
export function applyOverrides(base: GuildConfig, o: Overrides): GuildConfig {
  return guildConfigSchema.parse({
    ...base,
    economy: { ...base.economy, ...o.economy },
    omairi: { ...base.omairi, ...o.omairi },
    boost: { ...base.boost, ...o.boost },
    coreTime: { ...base.coreTime, ...o.coreTime },
    rooms: { ...base.rooms, ...o.rooms },
    applications: { ...base.applications, ...o.applications },
    ranks: base.ranks.map((r) => {
      const x = o.ranks[r.key] ?? {};
      return { ...r, ...(x.weight !== undefined ? { weight: x.weight } : {}), ...(r.auto && x.requiredGoen !== undefined ? { requiredGoen: x.requiredGoen } : {}) };
    }),
  });
}

export async function loadOverrides(db: Db): Promise<Overrides> {
  const rows = await db.select().from(settings);
  const row = rows.find((r) => r.key === KEY);
  const parsed = overridesSchema.safeParse(row?.value ?? {});
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, 'invalid settings in DB, ignored');
    return overridesSchema.parse({});
  }
  return parsed.data;
}

export async function saveOverrides(db: Db, value: Overrides, by: string): Promise<void> {
  await db
    .insert(settings)
    .values({ key: KEY, value, updatedBy: by })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: by, updatedAt: new Date() } });
}

/**
 * いま有効な設定を持つ。BOT と管理画面の両方が 1 分ごとに読み直すので、
 * 管理画面で変えた値は最長 1 分で BOT にも反映される。
 */
export class ConfigStore {
  private cfg: GuildConfig;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly db: Db,
    private readonly base: GuildConfig,
  ) {
    this.cfg = base;
  }

  get current(): GuildConfig {
    return this.cfg;
  }

  get fileConfig(): GuildConfig {
    return this.base;
  }

  async refresh(): Promise<void> {
    try {
      this.cfg = applyOverrides(this.base, await loadOverrides(this.db));
    } catch (err) {
      logger.warn({ err }, 'failed to apply settings, keeping previous');
    }
  }

  start(intervalMs = 60_000): void {
    this.timer = setInterval(() => void this.refresh(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

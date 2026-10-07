import { z } from 'zod';
import { casinoGachaSchema, CASINO_GAMES, CASINO_GAMES_V1, casinoSchema, omikujiSpecialSchema, omikujiTextsSchema, notifySchema, streakRewardSchema, coreTimeSchema, economyOpsSchema, opsWatchSchema, guildConfigSchema, rankSchema, marketSchema, roomsSchema, bellSchema, gachaSchema, voiceChatSchema, voiceGroupSchema, webAccessEntrySchema, type GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { activeEvents, applyEvents } from './economyEvents.js';

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
      omikujiVoiceOnly: z.boolean(),
      joinBonus: z.number().int().min(0).max(1_000_000),
      joinBonusNotify: z.boolean(),
      /** null: #記録 に戻す */
      joinBonusChannelId: z.string().regex(/^\d{17,20}$/).nullable(),
      giftMin: z.number().int().positive().max(1_000_000),
      giftMax: z.number().int().positive().max(1_000_000),
      giftDailyLimit: z.number().int().min(0).max(10_000_000),
      boostDiscountPercent: z.number().int().min(0).max(90),
      coreTimePercent: z.number().int().min(100).max(500),
      onboardingReward: z.number().int().min(0).max(1_000_000),
      inviteReward: z.number().int().min(0).max(1_000_000),
      inviteActiveReward: z.number().int().min(0).max(1_000_000),
      inviteActiveDays: z.number().int().min(1).max(365),
    })
    .partial()
    .default({}),
  /** 役職キーごとの格・昇格ライン・名前・絵文字・ロール（役職のページで変える） */
  ranks: z
    .record(
      z.string(),
      z
        .object({
          weight: z.number().int().positive().max(100),
          requiredGoen: z.number().int().min(0).max(1_000_000),
          voicePercent: z.number().int().min(0).max(1000),
          /** null: 「通話の銭」と同じに戻す */
          voiceCapPercent: z.number().int().min(0).max(1000).nullable(),
          name: z.string().trim().min(1).max(20),
          emoji: z.string().max(16),
          roleId: z.string().regex(/^\d{17,20}$/),
          /** 前の名前（掲示の {前の名前のご縁} なども使えるように） */
          formerNames: z.array(z.string()).max(20),
          /** true = ご縁で自動 / false = 任命制（ファイルと変えたときだけ） */
          auto: z.boolean(),
        })
        .partial(),
    )
    .default({}),
  /** 社務所Web で足した役職 */
  extraRanks: z.array(rankSchema.extend({ weight: z.number().int().positive().max(100), name: z.string().trim().min(1).max(20) })).max(20).default([]),
  /** 🔔 通知 OK／NG のロール（社務所Web で作る） */
  notify: notifySchema.default({}),
  /** おみくじの連続日数のおまけ（送られたときは全部置きかえる） */
  omikujiStreak: z.object({ rewards: z.array(streakRewardSchema).max(5) }).partial().default({}),
  /** 🎴 運営吉（送られたときは全部置きかえる） */
  omikujiSpecial: omikujiSpecialSchema.optional(),
  /** ⛩ おみくじの文と紙（送られたときは全部置きかえる） */
  omikujiTexts: omikujiTextsSchema.optional(),
  omairi: z.object({ days: z.number().int().positive().max(365), extendDays: z.number().int().min(0).max(365) }).partial().default({}),
  coreTime: coreTimeSchema.partial().default({}),
  rooms: roomsSchema.partial().default({}),
  market: marketSchema.partial().default({}),
  /** 自動で増える通話（送られたときは全部置きかえる） */
  voiceGroups: z.array(voiceGroupSchema).max(10).optional(),
  /** 社務所Web に入れる人（shinshokuRoleIds: 前の形・全部のページ / entries: ロール・人ごとに見られるページ） */
  webAccess: z.object({ shinshokuRoleIds: z.array(z.string().regex(/^\d{17,20}$/)).max(20), entries: z.array(webAccessEntrySchema).max(50) }).partial().default({}),
  voiceChat: voiceChatSchema.partial().default({}),
  /** 呼び鈴（channelId を空にすると #記録 へ） */
  bell: bellSchema.extend({ channelId: z.string().regex(/^\d{17,20}$/).nullable() }).partial().default({}),
  /** 物御籤（送られたときは全部置きかえる） */
  gacha: gachaSchema.optional(),
  casinoGacha: casinoGachaSchema.optional(),
  boost: z.object({ announceText: z.string().min(1).max(1000), dmText: z.string().min(1).max(1000) }).partial().default({}),
  applications: z.object({ autoApproveAccountDays: z.number().int().min(0).max(3650), kickOnReject: z.boolean() }).partial().default({}),
  /** 募集の荒らし対策（募集ボタンの置き場所はファイルで決める） */
  recruit: z
    .object({
      cooldownMinutes: z.number().int().min(0).max(120),
      channelCooldownMinutes: z.number().int().min(0).max(120),
      cooldownSeconds: z.number().int().min(0).max(7200),
      channelCooldownSeconds: z.number().int().min(0).max(7200),
      requireRank: z.boolean(),
      blockYakudoshi: z.boolean(),
      newMemberDays: z.number().int().min(0).max(90),
      spamAlertCount: z.number().int().min(0).max(50),
    })
    .partial()
    .default({}),
  /** 経済の見守り（channelId を空にすると #記録 へ） */
  economyOps: economyOpsSchema.extend({ channelId: z.string().regex(/^\d{17,20}$/).nullable() }).partial().default({}),
  /** 運営の見守り（channelId を空にすると #記録 へ） */
  opsWatch: opsWatchSchema.extend({ channelId: z.string().regex(/^\d{17,20}$/).nullable() }).partial().default({}),
  /** カジノ */
  casino: casinoSchema.partial().default({}),
});

export type Overrides = z.infer<typeof overridesSchema>;

const KEY = 'overrides';

/** ファイルの設定に上書きを重ねる。おかしな組み合わせ（昇格ラインの重複など）はエラー */
export function applyOverrides(base: GuildConfig, o: Overrides): GuildConfig {
  const vip = o.rooms.vip ?? base.rooms.vip;
  return guildConfigSchema.parse({
    ...base,
    // 💎 極の入口（社務所Web で作ったもの）を、通話部屋の入口に足す
    tempVoice: {
      ...base.tempVoice,
      hubs: [
        ...base.tempVoice.hubs.filter((h) => h.channelId !== vip?.hubId),
        ...(vip ? [{ channelId: vip.hubId, name: '💎 {name}の極の部屋', plan: 'free' as const }] : []),
      ],
    },
    economy: (() => {
      const { joinBonusChannelId, ...rest } = o.economy;
      const merged = { ...base.economy, ...rest };
      // null は「決めない（#記録 へ）」
      if (joinBonusChannelId === null) delete (merged as { joinBonusChannelId?: string }).joinBonusChannelId;
      else if (joinBonusChannelId) merged.joinBonusChannelId = joinBonusChannelId;
      return merged;
    })(),
    omikujiStreak: { ...base.omikujiStreak, ...o.omikujiStreak },
    omikujiSpecial: o.omikujiSpecial ?? base.omikujiSpecial,
    omikujiTexts: o.omikujiTexts ?? base.omikujiTexts,
    notify: { ...base.notify, ...o.notify },
    omairi: { ...base.omairi, ...o.omairi },
    boost: { ...base.boost, ...o.boost },
    coreTime: { ...base.coreTime, ...o.coreTime },
    rooms: { ...base.rooms, ...o.rooms },
    market: { ...base.market, ...o.market },
    voiceGroups: o.voiceGroups ?? base.voiceGroups,
    webAccess: { ...base.webAccess, ...o.webAccess },
    voiceChat: { ...base.voiceChat, ...o.voiceChat },
    bell: (() => {
      const { channelId, ...rest } = o.bell;
      const merged = { ...base.bell, ...rest };
      // null は「決めない（#記録 へ）」
      if (channelId === null) delete (merged as { channelId?: string }).channelId;
      else if (channelId) merged.channelId = channelId;
      return merged;
    })(),
    gacha: o.gacha ?? base.gacha,
    recruit: { ...base.recruit, ...o.recruit },
    economyOps: (() => {
      const { channelId, ...rest } = o.economyOps;
      const merged = { ...base.economyOps, ...rest };
      if (channelId === null) delete (merged as { channelId?: string }).channelId;
      else if (channelId) merged.channelId = channelId;
      return merged;
    })(),
    opsWatch: (() => {
      const { channelId, ...rest } = o.opsWatch;
      const merged = { ...base.opsWatch, ...rest };
      if (channelId === null) delete (merged as { channelId?: string }).channelId;
      else if (channelId) merged.channelId = channelId;
      return merged;
    })(),
    applications: { ...base.applications, ...o.applications },
    casinoGacha: o.casinoGacha ?? base.casinoGacha,
    casino: (() => {
      const merged = { ...base.casino, ...o.casino };
      // 一覧を保存したあとに足したゲームは、遊べるようにしておく
      if (o.casino.games) {
        const known = new Set(o.casino.knownGames ?? CASINO_GAMES_V1);
        merged.games = CASINO_GAMES.filter((g) => o.casino.games!.includes(g) || !known.has(g));
      }
      return merged;
    })(),
    ranks: [
      ...base.ranks.map((r) => {
        const x = o.ranks[r.key] ?? {};
        const name = x.name ?? r.name;
        const auto = x.auto ?? r.auto;
        return {
          ...r,
          name,
          auto,
          ...(name !== r.name ? { formerNames: [...new Set([...(r.formerNames ?? []), ...(x.formerNames ?? []), r.name])].filter((n) => n !== name) } : {}),
          ...(x.emoji !== undefined ? { emoji: x.emoji } : {}),
          ...(x.roleId !== undefined ? { roleId: x.roleId } : {}),
          ...(x.weight !== undefined ? { weight: x.weight } : {}),
          ...(auto && x.requiredGoen !== undefined ? { requiredGoen: x.requiredGoen } : {}),
          ...(x.voicePercent !== undefined ? { voicePercent: x.voicePercent } : {}),
          ...(x.voiceCapPercent === null ? { voiceCapPercent: undefined } : x.voiceCapPercent !== undefined ? { voiceCapPercent: x.voiceCapPercent } : {}),
        };
      }),
      // ファイルの役職と同じキーのものは使わない
      ...o.extraRanks.filter((e) => !base.ranks.some((b) => b.key === e.key)),
    ],
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
      // 期間限定イベント（ボーナス週間・セール）は、その間だけ設定に入れる
      this.cfg = applyEvents(applyOverrides(this.base, await loadOverrides(this.db)), await activeEvents(this.db).catch(() => []));
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

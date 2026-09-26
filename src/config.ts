import { readFileSync } from 'node:fs';
import { z } from 'zod';

const snowflake = z.string().regex(/^\d{17,20}$/, 'Discord の ID（17〜20 桁の数字）を入れてください');

export const rankSchema = z.object({
  /** プログラム内で使う名前（英小文字） */
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  /** 表示名（例: 世話役） */
  name: z.string().min(1),
  emoji: z.string().default(''),
  roleId: snowflake,
  /** 朱印の格（1 回で渡せるご縁） */
  weight: z.number().int().positive(),
  /** true: ご縁で自動昇格する役職 / false: 任命制（神職・宮司） */
  auto: z.boolean(),
  /** 自動昇格に必要なご縁（auto の役職のみ） */
  requiredGoen: z.number().int().min(0).default(0),
});

export type Rank = z.infer<typeof rankSchema>;

export const economySchema = z.object({
  /** 通貨の名前と絵文字 */
  currencyName: z.string().default('花びら'),
  currencyEmoji: z.string().default('🌸'),
  /** 通話 10 分ごとにもらえる量（2 人以上いる通話のみ） */
  voicePer10Min: z.number().int().min(0).default(5),
  /** 通話でもらえる 1 日の上限 */
  voiceDailyCap: z.number().int().min(0).default(150),
  /** 数えない通話チャンネル（AFK など） */
  excludedVoiceChannelIds: z.array(snowflake).default([]),
  /** 朱印を押した人・押された人がもらえる量 */
  shuinGive: z.number().int().min(0).default(3),
  shuinReceive: z.number().int().min(0).default(5),
  /** 免罪符の値段（考え中のため仮の値） */
  menzaifuPrice: z.number().int().positive().default(300),
  /** 免罪符を買える回数（1 人あたり、ずっと） */
  menzaifuMaxUses: z.number().int().min(0).default(1),
  /** 贈り物（ショップ）: 1 回に贈れる量と、1 人が 1 日に贈れる合計 */
  giftMin: z.number().int().positive().default(10),
  giftMax: z.number().int().positive().default(1000),
  giftDailyLimit: z.number().int().min(0).default(1000),
  /** 初期配布: 入鯖が承認されたときに 1 回だけ配る量（入り直しても 2 回目はない。0 で配らない） */
  joinBonus: z.number().int().min(0).default(3000),
  /** おみくじ（1 日 1 回のログボ）の基本の量。吉でこの量、大吉は 3 倍、凶は半分（0 なら花びらなし） */
  omikujiBase: z.number().int().min(0).default(10),
  /** ブースト（奉納）のお礼: 奉納してくれたときと、続けてくれている間 30 日ごとに贈る量（0 で贈らない） */
  boostThanks: z.number().int().min(0).default(1500),
  /** 奉納している人の授与品の割引（%。免罪符・贈り物はのぞく。0 で割引なし） */
  boostDiscountPercent: z.number().int().min(0).max(90).default(20),
});

export type EconomyConfig = z.infer<typeof economySchema>;

export const DEFAULT_BOOST_ANNOUNCE = '🏮 **{名前}** さんが、咲楽ノ宮に奉納（サーバーブースト）してくださいました。\nありがとうございます！';
export const DEFAULT_BOOST_DM = '🏮 咲楽ノ宮に奉納（サーバーブースト）してくださり、ありがとうございます。';

export const boostSchema = z.object({
  /** #慶事 に出すお知らせ */
  announceText: z.string().min(1).max(1000).default(DEFAULT_BOOST_ANNOUNCE),
  /** 本人への DM の最初の文（お礼の花びら・割引の案内は BOT が下に足す） */
  dmText: z.string().min(1).max(1000).default(DEFAULT_BOOST_DM),
});

export const applicationsSchema = z.object({
  /**
   * 半自動承認: Discord アカウントを作ってからこの日数以上たっている人は自動で承認する。
   * 0 なら全員を神職が承認する（手動）
   */
  autoApproveAccountDays: z.number().int().min(0).default(0),
  /** 却下した人をキックする */
  kickOnReject: z.boolean().default(true),
});

export const omairiSchema = z.object({
  /** お参り期間の日数 */
  days: z.number().int().positive().default(14),
  /** 期間内に氏子に届かなかったとき、1 回だけ自動で延ばす日数（0 で延ばさない） */
  extendDays: z.number().int().min(0).default(7),
});

/** 一発 BAN の理由（定型） */
export const DEFAULT_INSTANT_BAN_REASONS = [
  '18 歳未満への恋愛・性的な目的での接触',
  '個人情報の晒し',
  '荒らし・レイド・スパムの大量投稿',
  'なりすまし・詐欺',
  '違法な内容の投稿',
];

/** 厄の理由（定型） */
export const DEFAULT_YAKU_REASONS = [
  '誹謗中傷',
  '迷惑行為（通話）',
  '大人の話題を全年齢の場所で',
  'スパム・宣伝',
];

export const guildConfigSchema = z
  .object({
    guildId: snowflake,
    channels: z.object({
      /** #慶事: 昇格の発表 */
      keiji: snowflake,
      /** #記録: BOT のログ（任意） */
      log: snowflake.optional(),
      /** #絵馬: 自己紹介に御朱印帳ボタンを付ける（任意） */
      ema: snowflake.optional(),
      /** #申請受付: 入鯖・宵参り申請のカードが届く（運営のみ） */
      applications: snowflake.optional(),
      /** #お参り判定: お参り期間が終わっても氏子に届かなかった人の通知（運営のみ） */
      omairi: snowflake.optional(),
      /** #相談窓口: 匿名相談が届く（運営のみ） */
      soudan: snowflake.optional(),
      /** #番付: ご縁のランキングを BOT が貼る（省略時は「番付」という名前のチャンネル） */
      banzuke: snowflake.optional(),
      /** #おみくじ: /おみくじ を引く場所（省略時は「おみくじ」という名前のチャンネル） */
      omikuji: snowflake.optional(),
      /** #境内: 花吹雪（ショップ）を出す場所（省略時は「境内」という名前のチャンネル） */
      keidai: snowflake.optional(),
    }),
    roles: z
      .object({
        /** 👹 厄年: 朱印を押せない（任意） */
        yakudoshi: snowflake.optional(),
        /** 🔞 宵参り: 成人エリアに入れる（任意） */
        yoimairi: snowflake.optional(),
        /** お守り: 募集の通知を受け取りたい人が #授与所 のボタンで付け外しするロール */
        omamori: z
          .array(
            z.object({
              roleId: snowflake,
              /** ボタンの文字（例: 寝落ち） */
              label: z.string().min(1).max(40),
              emoji: z.string().max(10).default(''),
              /** 何の募集が届くか（パネルに書く） */
              description: z.string().max(100).default(''),
              /** 宵参りの人だけ付けられる */
              adultOnly: z.boolean().default(false),
            }),
          )
          .default([]),
      })
      .default({ omamori: [] }),
    ranks: z.array(rankSchema).min(1),
    economy: economySchema.default(economySchema.parse({})),
    applications: applicationsSchema.default(applicationsSchema.parse({})),
    omairi: omairiSchema.default(omairiSchema.parse({})),
    /** ブースト（奉納）のお礼の文面。{名前} は奉納した人（メンションになるが通知は飛ばない） */
    boost: boostSchema.default(boostSchema.parse({})),
    /** 募集: チャンネルのいちばん下に「募集する」ボタンを置き、押した人の募集をお守りの人に知らせる */
    recruit: z
      .object({
        /** 同じ人が続けて募集できるまでの分 */
        cooldownMinutes: z.number().int().min(0).default(10),
        panels: z
          .array(
            z.object({
              channelId: snowflake,
              /** 何の募集か（例: 寝落ち） */
              label: z.string().min(1).max(40),
              emoji: z.string().max(10).default(''),
              /** 知らせるお守りのロール */
              roleId: snowflake.optional(),
              /** 通話にいないときに案内する「➕ ○○をひらく」 */
              hubId: snowflake.optional(),
              /** 宵参りの人だけ募集できる */
              adultOnly: z.boolean().default(false),
            }),
          )
          .default([]),
      })
      .default({ cooldownMinutes: 10, panels: [] }),
    /** ショップ: セットアップが作った色守り・称号のロール（BOT が起動時に品物として並べる） */
    shop: z
      .object({
        colors: z.array(z.object({ roleId: snowflake, name: z.string(), emoji: z.string().default('') })).default([]),
        titles: z.array(z.object({ roleId: snowflake, name: z.string(), emoji: z.string().default('') })).default([]),
      })
      .default({ colors: [], titles: [] }),
    /** 自分の通話部屋: ここに入ると、その人の通話が同じカテゴリにでき、全員抜けると消える */
    tempVoice: z
      .object({
        hubs: z
          .array(
            z.object({
              channelId: snowflake,
              /** できる通話の名前。{name} が入った人の表示名になる */
              name: z.string().min(1).max(90),
            }),
          )
          .default([]),
      })
      .default({ hubs: [] }),
    moderation: z
      .object({
        yakuReasons: z.array(z.string().min(1)).default(DEFAULT_YAKU_REASONS),
        instantBanReasons: z.array(z.string().min(1)).default(DEFAULT_INSTANT_BAN_REASONS),
      })
      .default({ yakuReasons: DEFAULT_YAKU_REASONS, instantBanReasons: DEFAULT_INSTANT_BAN_REASONS }),
    /** 管理画面に入れるロール（省略時は役職キー shinshoku / guji のロール） */
    admin: z
      .object({
        shinshokuRoleIds: z.array(snowflake).default([]),
        gujiRoleIds: z.array(snowflake).default([]),
      })
      .optional(),
  })
  .superRefine((cfg, ctx) => {
    const keys = new Set<string>();
    const roleIds = new Set<string>();
    for (const r of cfg.ranks) {
      if (keys.has(r.key)) ctx.addIssue({ code: 'custom', message: `役職キーが重複しています: ${r.key}` });
      if (roleIds.has(r.roleId)) ctx.addIssue({ code: 'custom', message: `ロール ID が重複しています: ${r.roleId}` });
      keys.add(r.key);
      roleIds.add(r.roleId);
    }
    const auto = cfg.ranks.filter((r) => r.auto);
    if (!auto.some((r) => r.requiredGoen === 0)) {
      ctx.addIssue({ code: 'custom', message: 'ご縁 0 の自動役職（参拝者）が必要です' });
    }
    const goens = auto.map((r) => r.requiredGoen);
    if (new Set(goens).size !== goens.length) {
      ctx.addIssue({ code: 'custom', message: '自動役職の requiredGoen が重複しています' });
    }
  });

export type GuildConfig = z.infer<typeof guildConfigSchema>;

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN を設定してください'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL を設定してください'),
  GUILD_CONFIG: z.string().default('config/guild.json'),
  HEALTH_PORT: z.coerce.number().int().min(0).default(8080),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  /** 管理画面の URL（/member の結果から管理画面へリンクする。任意） */
  WEB_BASE_URL: z
    .string()
    .optional()
    .transform((u) => (u ? u.replace(/\/+$/, '') : undefined)),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(env);
}

const webEnvSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN を設定してください'),
  DISCORD_CLIENT_ID: z.string().regex(/^\d{17,20}$/, 'DISCORD_CLIENT_ID を設定してください'),
  DISCORD_CLIENT_SECRET: z.string().min(1, 'DISCORD_CLIENT_SECRET を設定してください'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL を設定してください'),
  GUILD_CONFIG: z.string().default('config/guild.json'),
  /** 管理画面の URL（例: https://shamusho.example.com）。末尾の / なし */
  WEB_BASE_URL: z.url().transform((u) => u.replace(/\/+$/, '')),
  WEB_PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

export function loadWebEnv(env: NodeJS.ProcessEnv = process.env): WebEnv {
  return webEnvSchema.parse(env);
}

export type AdminLevel = 'shinshoku' | 'guji';

/** ロールから管理画面の権限を決める（宮司が上） */
export function adminLevelOf(cfg: GuildConfig, roleIds: readonly string[]): AdminLevel | undefined {
  const byKey = (key: string) => cfg.ranks.filter((r) => r.key === key).map((r) => r.roleId);
  const guji = cfg.admin?.gujiRoleIds.length ? cfg.admin.gujiRoleIds : byKey('guji');
  const shinshoku = cfg.admin?.shinshokuRoleIds.length ? cfg.admin.shinshokuRoleIds : byKey('shinshoku');
  if (roleIds.some((id) => guji.includes(id))) return 'guji';
  if (roleIds.some((id) => shinshoku.includes(id))) return 'shinshoku';
  return undefined;
}

export function parseGuildConfig(json: unknown): GuildConfig {
  return guildConfigSchema.parse(json);
}

export function loadGuildConfig(file: string): GuildConfig {
  return parseGuildConfig(JSON.parse(readFileSync(file, 'utf8')));
}

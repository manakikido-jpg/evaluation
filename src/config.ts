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
    }),
    roles: z
      .object({
        /** 👹 厄年: 朱印を押せない（任意） */
        yakudoshi: snowflake.optional(),
      })
      .default({}),
    ranks: z.array(rankSchema).min(1),
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
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(env);
}

export function parseGuildConfig(json: unknown): GuildConfig {
  return guildConfigSchema.parse(json);
}

export function loadGuildConfig(file: string): GuildConfig {
  return parseGuildConfig(JSON.parse(readFileSync(file, 'utf8')));
}

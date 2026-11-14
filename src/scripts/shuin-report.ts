/**
 * 📊 御朱印の昇格条件を考えるための集計（読むだけ。DB・Discord・設定は何も変えない）。名前・ID は出さない。
 *
 *   docker compose exec bot node dist/scripts/shuin-report.js
 *   docker compose exec bot node dist/scripts/shuin-report.js --plan 参拝者=0,氏子=15,世話役=50
 *   docker compose exec bot node dist/scripts/shuin-report.js --grades 案内人
 *
 * --plan は比べたい案（役職の名前かキー＝必要なご縁）。社務所Web で変えた設定もふくめて、いまの条件を読む。
 * --grades は「階級ごと」に足すロールの名前の一部（カンマ区切り）。
 * 階級ごとを出すために、Discord からロールの一覧を読む（読むだけ。読めなければ、その節を飛ばす）
 */
import { loadEnv, loadGuildConfig } from '../config.js';
import { connectDb } from '../db/client.js';
import { createDiscordActions } from '../lib/discordRest.js';
import { ConfigStore } from '../services/settings.js';
import { buildShuinReport } from '../services/shuinReport.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const { db, close } = await connectDb(env.DATABASE_URL);
  try {
    const store = new ConfigStore(db, loadGuildConfig(env.GUILD_CONFIG));
    await store.refresh();
    const cfg = store.current;
    const at = process.argv.indexOf('--plan');
    let proposal: Record<string, number> | undefined;
    if (at >= 0) {
      proposal = {};
      for (const part of (process.argv[at + 1] ?? '').split(',')) {
        const [name, value] = part.split('=');
        const rank = cfg.ranks.find((r) => r.name === name?.trim() || r.key === name?.trim());
        if (!rank || !value || !/^\d+$/.test(value.trim())) throw new Error(`--plan が読めません: ${part}（例: 参拝者=0,氏子=15,世話役=50）`);
        proposal[rank.key] = Number(value);
      }
    }
    const arg = (name: string) => {
      const i = process.argv.indexOf(name);
      return i >= 0 ? (process.argv[i + 1] ?? '') : undefined;
    };
    const grades = arg('--grades')?.split(',').map((s) => s.trim()).filter(Boolean);
    // 階級ごとのために、ロールの名前を読む（読めなくても、ほかの節は出す）
    const roleNames = await createDiscordActions(env.DISCORD_TOKEN)
      .guildRoles(cfg.guildId)
      .then((roles) => new Map(roles.map((r) => [r.id, r.name])))
      .catch(() => undefined);
    console.log(await buildShuinReport(db, cfg, { proposal, grades, roleNames }));
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

/**
 * 📊 サーバーのようすの集計（読むだけ。DB・Discord・設定は何も変えない）。名前・ID は出さない。
 *
 *   docker compose exec bot node dist/scripts/server-report.js
 *   docker compose exec bot node dist/scripts/server-report.js --days 7 --weeks 12
 *
 * --days は見る日数（はじめは 30・365 まで）。--weeks は週ごとの推移の週の数（はじめは 8・26 まで）
 */
import { loadEnv, loadGuildConfig } from '../config.js';
import { connectDb } from '../db/client.js';
import { buildServerReport } from '../services/serverReport.js';
import { ConfigStore } from '../services/settings.js';

const numArg = (name: string): number | undefined => {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  const v = process.argv[i + 1] ?? '';
  if (!/^\d+$/.test(v)) throw new Error(`${name} が読めません: ${v}（例: ${name} 30）`);
  return Number(v);
};

async function main(): Promise<void> {
  const env = loadEnv();
  const { db, close } = await connectDb(env.DATABASE_URL);
  try {
    const store = new ConfigStore(db, loadGuildConfig(env.GUILD_CONFIG));
    await store.refresh();
    console.log(await buildServerReport(db, store.current, { days: numArg('--days'), weeks: numArg('--weeks') }));
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

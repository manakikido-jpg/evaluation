import { serve } from '@hono/node-server';
import { loadGuildConfig, loadWebEnv } from '../config.js';
import { connectDb } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { explainStartupError } from '../lib/startupErrors.js';
import { createWebApp } from './app.js';
import { createDiscordApi } from './discordApi.js';
import { createDiscordActions } from '../lib/discordRest.js';
import { ConfigStore } from '../services/settings.js';

async function main(): Promise<void> {
  const env = loadWebEnv();
  const fileCfg = loadGuildConfig(env.GUILD_CONFIG);
  const { db, close } = await connectDb(env.DATABASE_URL);
  // 設定画面で変えた値を重ねる
  const store = new ConfigStore(db, fileCfg);
  await store.refresh();
  store.start();

  const app = createWebApp({
    db,
    cfg: () => store.current,
    fileCfg,
    onSettingsSaved: () => store.refresh(),
    api: createDiscordApi({
      clientId: env.DISCORD_CLIENT_ID,
      clientSecret: env.DISCORD_CLIENT_SECRET,
      botToken: env.DISCORD_TOKEN,
    }),
    discord: createDiscordActions(env.DISCORD_TOKEN),
    baseUrl: env.WEB_BASE_URL,
  });

  const server = serve({ fetch: app.fetch, port: env.WEB_PORT }, (info) =>
    logger.info({ port: info.port, url: env.WEB_BASE_URL }, 'shamusho web started'),
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close();
    store.stop();
    await close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  // よくある設定ミスは、直し方を日本語で出す
  const hint = explainStartupError(err);
  if (hint) console.error(`\n❌ 起動できませんでした。\n${hint}\n`);
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});

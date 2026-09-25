import { serve } from '@hono/node-server';
import { loadGuildConfig, loadWebEnv } from '../config.js';
import { connectDb } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { createWebApp } from './app.js';
import { createDiscordApi } from './discordApi.js';

async function main(): Promise<void> {
  const env = loadWebEnv();
  const cfg = loadGuildConfig(env.GUILD_CONFIG);
  const { db, close } = await connectDb(env.DATABASE_URL);

  const app = createWebApp({
    db,
    cfg,
    api: createDiscordApi({
      clientId: env.DISCORD_CLIENT_ID,
      clientSecret: env.DISCORD_CLIENT_SECRET,
      botToken: env.DISCORD_TOKEN,
    }),
    baseUrl: env.WEB_BASE_URL,
  });

  const server = serve({ fetch: app.fetch, port: env.WEB_PORT }, (info) =>
    logger.info({ port: info.port, url: env.WEB_BASE_URL }, 'shamusho web started'),
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close();
    await close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});

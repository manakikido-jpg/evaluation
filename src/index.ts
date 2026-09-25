import { createServer } from 'node:http';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { loadEnv, loadGuildConfig } from './config.js';
import { connectDb } from './db/client.js';
import { ShuinApp } from './discord/app.js';
import { commandDefinitions } from './discord/commands.js';
import { logger } from './lib/logger.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const cfg = loadGuildConfig(env.GUILD_CONFIG);
  const { db, close } = await connectDb(env.DATABASE_URL);
  logger.info('database ready');

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildVoiceStates,
    ],
  });
  const app = new ShuinApp(client, db, cfg);

  client.once(Events.ClientReady, async (c) => {
    logger.info({ user: c.user.tag }, 'logged in');
    const guild = await c.guilds.fetch(cfg.guildId).catch(() => undefined);
    if (!guild) {
      logger.error({ guildId: cfg.guildId }, 'BOT がこのサーバーに参加していません');
      return;
    }
    await guild.commands.set(commandDefinitions());
    logger.info({ guild: guild.name }, 'commands registered');
    // 管理画面用に全員を同期（BOT が止まっていた間の参加・退出も反映）
    const all = await guild.members.fetch();
    await app.syncAll(all.values()).catch((err) => logger.error({ err }, 'member sync failed'));
  });
  client.on(Events.GuildMemberAdd, (m) => void app.onMemberAdd(m));
  client.on(Events.GuildMemberRemove, (m) => void app.onMemberRemove(m.guild.id, m.id));
  client.on(Events.GuildMemberUpdate, (_old, m) => void app.onMemberUpdate(m));
  client.on(Events.VoiceStateUpdate, (before, after) => {
    // 通話に入った・移動したとき
    if (after.channelId && after.channelId !== before.channelId && after.member) {
      void app.onActivity(after.guild.id, after.id, after.member.user.bot);
    }
  });
  client.on(Events.InteractionCreate, (i) => void app.onInteraction(i));
  client.on(Events.MessageCreate, (m) => void app.onMessage(m));
  client.on(Events.Error, (err) => logger.error({ err }, 'client error'));

  const health =
    env.HEALTH_PORT > 0
      ? createServer((_req, res) => {
          const ok = client.isReady();
          res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok }));
        }).listen(env.HEALTH_PORT)
      : undefined;

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    health?.close();
    await client.destroy();
    await close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await client.login(env.DISCORD_TOKEN);
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});

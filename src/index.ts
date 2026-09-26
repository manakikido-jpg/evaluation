import { createServer } from 'node:http';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { loadEnv, loadGuildConfig } from './config.js';
import { connectDb } from './db/client.js';
import { ShuinApp } from './discord/app.js';
import { StaffApp } from './discord/staff.js';
import { AdmissionApp } from './discord/admission.js';
import { TempVoiceApp } from './discord/tempVoice.js';
import { updateBanzukeQuietly } from './services/banzuke.js';
import { ConfigStore } from './services/settings.js';
import { createDiscordActions } from './lib/discordRest.js';
import { commandDefinitions } from './discord/commands.js';
import { logger } from './lib/logger.js';
import { explainStartupError } from './lib/startupErrors.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const fileCfg = loadGuildConfig(env.GUILD_CONFIG);
  const { db, close } = await connectDb(env.DATABASE_URL);
  logger.info('database ready');
  // 管理画面で変えた設定を重ねる（1 分ごとに読み直す）
  const store = new ConfigStore(db, fileCfg);
  await store.refresh();
  store.start();
  const cfg = () => store.current;

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildVoiceStates,
    ],
  });
  const app = new ShuinApp(client, db, cfg);
  const actions = createDiscordActions(env.DISCORD_TOKEN);
  const staff = new StaffApp(client, db, cfg, actions, env.WEB_BASE_URL);
  const admission = new AdmissionApp(client, db, cfg, actions);
  const tempVoice = new TempVoiceApp(db, cfg);
  let ticker: NodeJS.Timeout | undefined;
  let omairiTicker: NodeJS.Timeout | undefined;

  client.once(Events.ClientReady, async (c) => {
    logger.info({ user: c.user.tag }, 'logged in');
    const guild = await c.guilds.fetch(fileCfg.guildId).catch(() => undefined);
    if (!guild) {
      logger.error({ guildId: fileCfg.guildId }, 'BOT がこのサーバーに参加していません');
      return;
    }
    await guild.commands.set(commandDefinitions(cfg()));
    logger.info({ guild: guild.name }, 'commands registered');
    // 管理画面用に全員を同期（BOT が止まっていた間の参加・退出も反映）
    const all = await guild.members.fetch();
    await app.syncAll(all.values()).catch((err) => logger.error({ err }, 'member sync failed'));
    // 自分の通話部屋: 止まっていた間に空になったものを消す
    await tempVoice.attach(guild);
    // 1 分ごと: 通話時間・花びら・発言数、空の通話部屋の片付け（念のため）
    ticker = setInterval(() => {
      void app.everyMinute(guild);
      void tempVoice.cleanup();
    }, 60_000);
    // 10 分ごと: お参り期間の判定
    const omairi = () => void admission.checkOmairi().catch((err) => logger.warn({ err }, 'omairi check failed'));
    // 10 分ごと: 番付の書き換え
    const banzuke = () => void updateBanzukeQuietly({ db, cfg: cfg(), discord: actions });
    const every10 = () => {
      omairi();
      banzuke();
    };
    every10();
    omairiTicker = setInterval(every10, 10 * 60_000);
  });
  client.on(Events.GuildMemberAdd, (m) => void app.onMemberAdd(m));
  client.on(Events.GuildMemberRemove, (m) => void app.onMemberRemove(m.guild.id, m.id));
  client.on(Events.GuildMemberUpdate, (_old, m) => void app.onMemberUpdate(m));
  client.on(Events.VoiceStateUpdate, (before, after) => {
    // 通話に入った・移動したとき
    if (after.channelId && after.channelId !== before.channelId && after.member) {
      void app.onActivity(after.guild.id, after.id, after.member.user.bot);
    }
    void tempVoice.onVoiceStateUpdate(before, after);
  });
  client.on(Events.InteractionCreate, (i) => {
    void app.onInteraction(i);
    void staff.onInteraction(i);
    void admission.onInteraction(i);
  });
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
    if (ticker) clearInterval(ticker);
    if (omairiTicker) clearInterval(omairiTicker);
    store.stop();
    await client.destroy();
    await close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await client.login(env.DISCORD_TOKEN);
}

main().catch((err) => {
  // よくある設定ミスは、直し方を日本語で出す
  const hint = explainStartupError(err);
  if (hint) console.error(`\n❌ 起動できませんでした。\n${hint}\n`);
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});

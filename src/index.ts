import { createServer } from 'node:http';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { loadEnv, loadGuildConfig } from './config.js';
import { connectDb } from './db/client.js';
import { ShuinApp } from './discord/app.js';
import { StaffApp } from './discord/staff.js';
import { AdmissionApp } from './discord/admission.js';
import { TempVoiceApp } from './discord/tempVoice.js';
import { OmikujiApp } from './discord/omikuji.js';
import { OmamoriApp } from './discord/omamori.js';
import { RecruitApp } from './discord/recruit.js';
import { ShopApp } from './discord/shop.js';
import { updateBanzukeQuietly } from './services/banzuke.js';
import { boostTick } from './services/boost.js';
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
  const omikuji = new OmikujiApp(db, cfg);
  const omamori = new OmamoriApp(cfg);
  const recruit = new RecruitApp(db, cfg);
  const shop = new ShopApp(db, cfg, actions);
  let ticker: NodeJS.Timeout | undefined;
  let omairiTicker: NodeJS.Timeout | undefined;

  client.once(Events.ClientReady, async (c) => {
    logger.info({ user: c.user.tag }, 'logged in');
    const guild = await c.guilds.fetch(fileCfg.guildId).catch(() => undefined);
    if (!guild) {
      logger.error({ guildId: fileCfg.guildId }, 'BOT がこのサーバーに参加していません');
      return;
    }
    // どれかが失敗しても（Discord が混んでいるなど）、止まらずに続ける
    await guild.commands
      .set(commandDefinitions(cfg()))
      .then(() => logger.info({ guild: guild.name }, 'commands registered'))
      .catch((err) => logger.error({ err }, 'command registration failed'));
    // 管理画面用に全員を同期（BOT が止まっていた間の参加・退出も反映）
    await guild.members
      .fetch()
      .then((all) => app.syncAll(all.values()))
      .catch((err) => logger.error({ err }, 'member sync failed'));
    // 自分の通話部屋: 止まっていた間に空になったものを消す
    await tempVoice.attach(guild).catch((err) => logger.warn({ err }, 'temp voice attach failed'));
    // ショップ: 最初の品物を並べる
    await shop.attach(guild).catch((err) => logger.warn({ err }, 'shop attach failed'));
    // 募集ボタン: なければ置く
    await recruit.attach(guild).catch((err) => logger.warn({ err }, 'recruit panels failed'));
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
      // 期限が来た授与品（色守り・絵馬のピン留め）を外す
      void shop.expire().catch((err) => logger.warn({ err }, 'shop expire failed'));
      // ブースト（奉納）のお礼と奉納板（止まっていた間の分もここで拾う）
      void boostTick({ db, cfg: cfg(), discord: actions });
    };
    every10();
    omairiTicker = setInterval(every10, 10 * 60_000);
  });
  client.on(Events.GuildMemberAdd, (m) => void app.onMemberAdd(m));
  client.on(Events.GuildMemberRemove, (m) => void app.onMemberRemove(m.guild.id, m.id));
  client.on(Events.GuildMemberUpdate, (old, m) => {
    void (async () => {
      await app.onMemberUpdate(m);
      // ブースト（奉納）を始めた・やめたら、すぐお礼と奉納板を
      if ((old.premiumSince?.getTime() ?? null) !== (m.premiumSince?.getTime() ?? null)) await boostTick({ db, cfg: cfg(), discord: actions }, new Date(), m.id);
    })();
  });
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
    void omikuji.onInteraction(i);
    void omamori.onInteraction(i);
    void recruit.onInteraction(i);
    void shop.onInteraction(i);
  });
  client.on(Events.MessageCreate, (m) => {
    void app.onMessage(m);
    recruit.onMessage(m);
  });
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

// 取りこぼした失敗で BOT ごと止まらないように（記録だけ残す）
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));

main().catch((err) => {
  // よくある設定ミスは、直し方を日本語で出す
  const hint = explainStartupError(err);
  if (hint) console.error(`\n❌ 起動できませんでした。\n${hint}\n`);
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});

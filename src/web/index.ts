import { streamConfig, streamEvent, changeStream, kickPublisher } from '../services/eventStream.js';
import { deliverOfficePush, pushAccess } from '../services/officeNotifications.js';
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

  const api = createDiscordApi({ clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET, botToken: env.DISCORD_TOKEN });
  let notifying = false;
  const notifications = setInterval(() => {
    if (notifying) return;
    notifying = true;
    void deliverOfficePush(db, pushAccess(db, () => store.current, api), env.WEB_BASE_URL)
      .catch(() => logger.warn('office notification check failed'))
      .finally(() => { notifying = false; });
  }, 60_000);
  notifications.unref();

  const eventStream = streamConfig({secret:env.EVENT_STREAM_SECRET,ingestUrl:env.EVENT_STREAM_INGEST_URL,mediaUrl:env.EVENT_STREAM_MEDIA_URL,apiUrl:env.EVENT_STREAM_API_URL});
  if(env.EVENT_STREAM_SECRET&&!eventStream)throw new Error('イベント配信の接続設定を確認してください。');
  let endingStream=false;
  const streamExpiry=setInterval(()=>{
    if(!eventStream||endingStream)return;
    endingStream=true;
    void (async()=>{const event=await streamEvent(db);if(event&&(event.status==='closed'||event.expiresAt<=Date.now())){
      if(event.status!=='closed')
      await changeStream(db,{action:'stop',actorId:'system:event-stream',id:event.id,version:event.version,via:'system'},new Date());
      await kickPublisher(eventStream,event.id);
    }})().catch(()=>logger.warn('event stream expiry check failed')).finally(()=>{endingStream=false;});
  },30000);
  streamExpiry.unref();
  const app = createWebApp({
    eventStream,
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
    botId: env.DISCORD_CLIENT_ID,
    discordLogin: env.WEB_DISCORD_LOGIN === 'on',
    ...(env.WEB_ENTRY_KEY ? { entryKey: env.WEB_ENTRY_KEY } : {}),
  });

  const server = serve({ fetch: app.fetch, port: env.WEB_PORT }, (info) =>
    logger.info({ port: info.port, url: env.WEB_BASE_URL, entry: Boolean(env.WEB_ENTRY_KEY), discordLogin: env.WEB_DISCORD_LOGIN }, 'shamusho web started'),
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close();
    store.stop();
    clearInterval(notifications);
    clearInterval(streamExpiry);
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

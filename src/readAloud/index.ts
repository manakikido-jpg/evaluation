import { Client, Events, GatewayIntentBits } from 'discord.js';
import { loadReadAloudEnv } from '../config.js';
import { logger } from '../lib/logger.js';
import { ReadAloudApp, readAloudCommand } from './app.js';
import { DiscordSpeechWorker } from './discordWorker.js';
import { SpeechPool } from './pool.js';

async function main(): Promise<void> {
  const cfg = loadReadAloudEnv();
  if (cfg.READ_ALOUD_ENABLED !== 'on') { logger.info('read aloud is disabled'); return; }
  const clients = cfg.tokens.map(() => new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] }));
  let pool: SpeechPool;
  const workers = clients.map((client) => new DiscordSpeechWorker(client, cfg, (channelId) => pool.stop(channelId)));
  pool = new SpeechPool(workers, cfg.READ_ALOUD_QUEUE_LIMIT, () => logger.warn('read aloud synthesis or playback failed'));
  const app = new ReadAloudApp(cfg, pool);
  const leader = clients[0]!;
  // 受付は先頭の専用BOTだけ。複数の接続で同じ投稿を重ねて読まない。
  leader.on(Events.MessageCreate, (m) => app.message(m));
  leader.on(Events.VoiceStateUpdate, (before, after) => app.voice(before, after));
  const stop = () => { pool.close(); for (const client of clients) void client.destroy(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  for (const client of clients) {
    client.on(Events.InteractionCreate, (i) => { if (i.isChatInputCommand()) void app.interaction(i).catch(() => logger.warn('read aloud command failed')); });
    client.on(Events.Error, () => logger.warn('read aloud gateway error'));
    client.on(Events.ShardDisconnect, () => pool.close());
    client.on(Events.VoiceStateUpdate, (before, after) => {
      if (after.id === client.user?.id && before.channelId && before.channelId !== after.channelId) pool.stop(before.channelId);
    });
  }
  try {
    await Promise.all(clients.map(async (client, index) => {
      await client.login(cfg.tokens[index]);
      if (!client.isReady()) await new Promise<void>((resolve) => client.once(Events.ClientReady, () => resolve()));
    }));
    if (new Set(clients.map((c) => c.user!.id)).size !== clients.length) throw Error();
    const guild = leader.guilds.cache.get(cfg.READ_ALOUD_GUILD_ID);
    if (!guild || clients.some((c) => !c.guilds.cache.has(guild.id))) throw Error();
    // このアプリ専用のBOTにだけ登録する。社務所BOTのコマンドは変更しない。
    await guild.commands.create(readAloudCommand.toJSON());
    logger.info({ workers: clients.length }, 'read aloud ready');
  } catch { stop(); throw new Error('読み上げを起動できません。専用BOTの設定・招待・Intentを確認してください。'); }
}
void main().catch(() => { logger.error('read aloud startup failed; check dedicated bot configuration and intents'); process.exitCode = 1; });

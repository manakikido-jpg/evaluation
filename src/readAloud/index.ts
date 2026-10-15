import { Client, Events, GatewayIntentBits } from 'discord.js';
import { loadReadAloudEnv } from '../config.js';
import { logger } from '../lib/logger.js';
import { ReadAloudApp, readAloudCommand } from './app.js';
import { DiscordSpeechWorker } from './discordWorker.js';
import { SpeechPool } from './pool.js';
import { STAGE_HINT, startupReason, type StartupStage } from './diagnose.js';

/** どこで失敗したか（何番目の BOT か）。秘密は入れない */
class StartupError extends Error {
  constructor(readonly stage: StartupStage, readonly bot: number | undefined, readonly reason: string, readonly failed: { bot: number; reason: string }[] = []) { super(stage); }
}

async function main(): Promise<void> {
  let cfg;
  try { cfg = loadReadAloudEnv(); } catch { throw new StartupError('env', undefined, 'invalid'); }
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
    // 全部の BOT を試してから、失敗した BOT をまとめて知らせる（1 体ずつ直さなくてよいように）
    const results = await Promise.allSettled(clients.map(async (client, index) => {
      await client.login(cfg.tokens[index]);
      if (!client.isReady()) await new Promise<void>((resolve) => client.once(Events.ClientReady, () => resolve()));
    }));
    const failed = results.flatMap((r, i) => (r.status === 'rejected' ? [{ bot: i + 1, reason: startupReason(r.reason) }] : []));
    if (failed.length) throw new StartupError('login', failed[0]!.bot, failed[0]!.reason, failed);
    const ids = clients.map((c) => c.user!.id);
    const dup = ids.findIndex((id, i) => ids.indexOf(id) !== i);
    if (dup >= 0) throw new StartupError('duplicate', dup + 1, 'same_bot');
    const missing = clients.findIndex((c) => !c.guilds.cache.has(cfg.READ_ALOUD_GUILD_ID));
    if (missing >= 0) throw new StartupError('guild', missing + 1, 'not_in_guild');
    const guild = leader.guilds.cache.get(cfg.READ_ALOUD_GUILD_ID)!;
    // このアプリ専用のBOTにだけ登録する。社務所BOTのコマンドは変更しない。
    try { await guild.commands.create(readAloudCommand.toJSON()); } catch (err) { throw new StartupError('command', 1, startupReason(err)); }
    logger.info({ workers: clients.length }, 'read aloud ready');
  } catch (err) { stop(); throw err; }
}
void main().catch((err) => {
  // 何番目の BOT が、どこで、なぜ失敗したかだけを出す（トークンや本文は出さない）
  const e = err instanceof StartupError ? err : new StartupError('login', undefined, 'unknown');
  logger.error({ stage: e.stage, bot: e.bot, reason: e.reason, ...(e.failed.length > 1 ? { failed: e.failed } : {}), hint: STAGE_HINT[e.stage] }, 'read aloud startup failed');
  process.exitCode = 1;
});

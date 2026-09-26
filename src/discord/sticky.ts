import type { Message } from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { restickNotice, stickyNotices } from '../services/notices.js';

/** 書き込みが続いている間は置き直さず、落ち着いてから下へ */
const RESTICK_AFTER_MS = 60_000;
/** どのチャンネルに「いちばん下に表示し続ける」掲示があるか、読み直す間隔 */
const REFRESH_MS = 60_000;

/**
 * 「いちばん下に表示し続ける」掲示（#絵馬 のひな形など）。
 * 誰かが書き込んだら、1 分落ち着いてから、掲示を消して下に出し直す。
 */
export class StickyApp {
  private channels = new Set<string>();
  private loadedAt = 0;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  /** チャンネルごとに 1 つずつ */
  private readonly queue = new Map<string, Promise<void>>();

  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
    private readonly discord: DiscordActions,
  ) {}

  private async stickyChannels(): Promise<Set<string>> {
    if (Date.now() - this.loadedAt > REFRESH_MS) {
      this.channels = new Set((await stickyNotices(this.db)).map((n) => n.channelId));
      this.loadedAt = Date.now();
    }
    return this.channels;
  }

  async onMessage(msg: Message): Promise<void> {
    if (!msg.inGuild() || msg.guildId !== this.cfg().guildId || msg.author.id === msg.client.user.id) return;
    try {
      if (!(await this.stickyChannels()).has(msg.channelId)) return;
    } catch (err) {
      logger.warn({ err }, 'sticky lookup failed');
      return;
    }
    clearTimeout(this.timers.get(msg.channelId));
    const channel = msg.channel;
    this.timers.set(
      msg.channelId,
      setTimeout(() => void this.restick(msg.channelId, () => channel.lastMessageId), RESTICK_AFTER_MS),
    );
  }

  /** 掲示がすでにいちばん下なら何もしない */
  restick(channelId: string, lastMessageId: () => string | null): Promise<void> {
    const prev = this.queue.get(channelId) ?? Promise.resolve();
    const next = prev
      .then(async () => {
        const list = await stickyNotices(this.db, channelId);
        if (!list.length || list.at(-1)!.messageId === lastMessageId()) return;
        const ctx = { db: this.db, cfg: this.cfg(), discord: this.discord };
        for (const n of list) await restickNotice(ctx, n.id);
      })
      .catch((err) => logger.warn({ err, channelId }, 'sticky restick failed'));
    this.queue.set(channelId, next);
    return next;
  }
}

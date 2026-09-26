import { GuildSystemChannelFlags, type Guild, type Message } from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { BOOST_MESSAGE_TYPES, boostCatchupSince, boostCountOf, boostTick, thankBoostMessage, updateBoard } from '../services/boost.js';

/** 起動したときに読み直す日数（BOT が止まっていた間のブーストを拾う） */
const CATCHUP_MS = 24 * 3_600_000;

/**
 * ブースト（奉納）のお礼の Discord 側。
 * ブースト 1 回ごとのお礼は、Discord がシステムメッセージチャンネルに出す「ブーストしました」のメッセージで数える。
 */
export class BoostApp {
  private guild?: Guild;

  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
    private readonly discord: DiscordActions,
  ) {}

  private ctx() {
    return { db: this.db, cfg: this.cfg(), discord: this.discord };
  }

  /** 「ブーストしました」のメッセージが出る設定か（出ないなら、1 人が始めたときに 1 回分だけ贈る） */
  byMessage(): boolean {
    const g = this.guild;
    return Boolean(g?.systemChannelId && !g.systemChannelFlags.has(GuildSystemChannelFlags.SuppressPremiumSubscriptions));
  }

  async attach(guild: Guild): Promise<void> {
    this.guild = guild;
    if (!this.byMessage()) {
      logger.warn('サーバー設定で「ブーストされたときにメッセージを送信」が OFF のため、ブースト 1 回ごとのお礼はできません（1 人 1 回分になります）');
      return;
    }
    // 止まっていた間の「ブーストしました」を拾う（同じメッセージでは 2 回贈らない）
    const since = Math.max((await boostCatchupSince(this.db)).getTime(), Date.now() - CATCHUP_MS);
    const channel = guild.systemChannel;
    const recent = await channel?.messages.fetch({ limit: 50 }).catch(() => undefined);
    for (const m of [...(recent?.values() ?? [])].reverse()) {
      if (m.createdTimestamp >= since) await this.onMessage(m);
    }
  }

  async onMessage(m: Message): Promise<void> {
    if (!BOOST_MESSAGE_TYPES.has(m.type) || m.guildId !== this.cfg().guildId || m.author.bot) return;
    try {
      const r = await thankBoostMessage(this.ctx(), { messageId: m.id, memberId: m.author.id, count: boostCountOf(m.content) });
      if (r.status === 'ok') logger.info({ memberId: m.author.id, granted: r.granted }, 'boost thanked');
      await updateBoard(this.ctx());
    } catch (err) {
      logger.warn({ err }, 'boost message thanks failed');
    }
  }

  /** 10 分ごと・ブーストを始めた／やめたとき: 30 日ごとのお礼と奉納板 */
  tick(only?: string): Promise<void> {
    return boostTick(this.ctx(), new Date(), only, { byMessage: this.byMessage() });
  }
}

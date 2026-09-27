import { ChannelType, type Guild, type VoiceBasedChannel, type VoiceState } from 'discord.js';
import type { GuildConfig } from '../config.js';
import { logger } from '../lib/logger.js';

/** Discord がまとめて消せるのは 14 日以内の書き込み（少し余裕を見る） */
const BULK_MAX_AGE_MS = 14 * 86_400_000 - 60 * 60_000;
/** 1 回に消す上限（古いものを 1 件ずつ消すと遅いので、残りは次に空になったときに） */
const MAX_ROUNDS = 10;
const MAX_SINGLE = 50;

type Purgeable = Pick<VoiceBasedChannel, 'id' | 'members'> & {
  messages: VoiceBasedChannel['messages'];
  bulkDelete: (ids: string[], filterOld?: boolean) => Promise<unknown>;
};

const humans = (ch: Pick<VoiceBasedChannel, 'members'>) => ch.members.filter((m) => !m.user.bot).size;

/**
 * 人がいなくなった通話のチャット（通話チャンネルの中のテキスト）を消す。
 * いなくなってから決めた分（標準 1 分）待って、まだだれもいなければ消す。ピン留めは残す。
 */
export class VoiceChatClearApp {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly cfg: () => GuildConfig,
    private readonly now = () => Date.now(),
  ) {}

  /** 起動したとき: 止まっていた間に空になった通話も片付ける */
  attach(guild: Guild): void {
    if (!this.cfg().voiceChat.clearWhenEmpty) return;
    for (const ch of guild.channels.cache.values()) {
      if ((ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice) && ch.lastMessageId && humans(ch) === 0) this.schedule(ch);
    }
  }

  onVoiceStateUpdate(before: VoiceState, after: VoiceState): void {
    if (before.channelId === after.channelId || after.guild.id !== this.cfg().guildId) return;
    // だれかが入ったら、消すのをやめる
    if (after.channelId) this.cancel(after.channelId);
    const left = before.channel;
    if (!left || !this.cfg().voiceChat.clearWhenEmpty || humans(left) > 0) return;
    this.schedule(left);
  }

  private cancel(channelId: string): void {
    clearTimeout(this.timers.get(channelId));
    this.timers.delete(channelId);
  }

  private schedule(channel: Purgeable): void {
    this.cancel(channel.id);
    const delay = this.cfg().voiceChat.delayMinutes * 60_000;
    this.timers.set(
      channel.id,
      setTimeout(() => {
        this.timers.delete(channel.id);
        if (humans(channel) > 0 || !this.cfg().voiceChat.clearWhenEmpty) return;
        // 自分の通話部屋などで、もう消えた通話ならなにもしない
        const guild = (channel as Partial<Pick<VoiceBasedChannel, 'guild'>>).guild;
        if (guild && !guild.channels.cache.has(channel.id)) return;
        void this.purge(channel).catch((err: unknown) => logger.warn({ err, channelId: channel.id }, 'voice chat clear failed'));
      }, delay),
    );
  }

  /** ピン留め以外を消す。14 日以内はまとめて、それより古いものは 1 件ずつ（50 件まで） */
  async purge(channel: Purgeable): Promise<number> {
    let removed = 0;
    let single = 0;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      // 途中でだれか入ったらやめる
      if (humans(channel) > 0) break;
      const batch = await channel.messages.fetch({ limit: 100 });
      const targets = [...batch.values()].filter((m) => !m.pinned);
      if (!targets.length) break;
      const recent = targets.filter((m) => this.now() - m.createdTimestamp < BULK_MAX_AGE_MS);
      const old = targets.filter((m) => this.now() - m.createdTimestamp >= BULK_MAX_AGE_MS);
      if (recent.length >= 2) await channel.bulkDelete(recent.map((m) => m.id), true);
      else for (const m of recent) await m.delete();
      removed += recent.length;
      for (const m of old) {
        if (single >= MAX_SINGLE) break;
        await m.delete().catch(() => undefined);
        single++;
        removed++;
      }
      if (single >= MAX_SINGLE || targets.length < 100) break;
    }
    if (removed) logger.info({ channelId: channel.id, removed }, 'voice chat cleared');
    return removed;
  }
}

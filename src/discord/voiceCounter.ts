import { ChannelType, type Guild, type VoiceChannel } from 'discord.js';
import type { GuildConfig } from '../config.js';
import { logger } from '../lib/logger.js';
import { counterName, countInGroups, VOICE_COUNTER_INTERVAL_MS } from '../services/voiceCounter.js';

/**
 * 👥 縁側にいる人数を、決めたチャンネルの名前に出す。
 * 1 分ごとに数えて、名前が変わるときだけ書きかえる（前に書きかえてから 5 分あける）。
 */
export class VoiceCounterApp {
  private guild?: Guild;
  private lastRename = 0;
  private busy = false;

  constructor(private readonly cfg: () => GuildConfig, private readonly now = () => Date.now()) {}

  attach(guild: Guild): void {
    this.guild = guild;
  }

  async tick(): Promise<void> {
    const g = this.guild;
    const vc = this.cfg().voiceCounter;
    if (!g || !vc?.channelId || this.busy) return;
    const target = g.channels.cache.get(vc.channelId);
    if (!target) return;
    const channels = [...g.channels.cache.values()]
      .filter((c): c is VoiceChannel => c.type === ChannelType.GuildVoice)
      .map((c) => ({ id: c.id, name: c.name, position: c.rawPosition, members: c.members.filter((m) => !m.user.bot).size }));
    const name = counterName(vc, countInGroups(channels, this.cfg().voiceGroups, vc.match));
    if (target.name === name || this.now() - this.lastRename < VOICE_COUNTER_INTERVAL_MS) return;
    this.busy = true;
    this.lastRename = this.now();
    try {
      await target.setName(name, '縁側の人数');
    } catch (err) {
      logger.warn({ err }, 'voice counter rename failed');
    } finally {
      this.busy = false;
    }
  }
}

import type { Guild, VoiceState } from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { afkMutedIds, markAfkMuted } from '../services/afkMute.js';

/**
 * 奥の院（サーバーの AFK チャンネル）に入った人を、自動でサーバーミュートする。
 * 寝落ちした人を入れる所なので、寝息などが流れないように。
 * ほかの通話へ移ったら外す。通話を抜けた人は外せない（Discord の決まり）ので覚えておき、次にどこかの通話に入ったときに外す。
 * もとから運営がミュートしていた人は、BOT は外さない。
 */
export class AfkMuteApp {
  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
  ) {}

  /** 起動したとき: 止まっていた間に奥の院から出た人のミュートを外す */
  async attach(guild: Guild): Promise<void> {
    if (guild.id !== this.cfg().guildId) return;
    for (const id of await afkMutedIds(this.db)) {
      const v = guild.voiceStates.cache.get(id);
      if (v?.channelId && v.channelId !== guild.afkChannelId) await this.unmute(v);
    }
  }

  async onVoiceStateUpdate(before: VoiceState, after: VoiceState): Promise<void> {
    if (after.guild.id !== this.cfg().guildId || before.channelId === after.channelId || !after.channelId) return;
    const afk = after.guild.afkChannelId;
    if (!afk || after.member?.user.bot) return;
    try {
      if (after.channelId === afk) {
        if (after.serverMute) return;
        await markAfkMuted(this.db, after.id, true);
        await after.setMute(true, '奥の院（寝落ち）に入ったため');
      } else if ((await afkMutedIds(this.db)).includes(after.id)) {
        await this.unmute(after);
      }
    } catch (err) {
      logger.warn({ err }, 'afk mute failed');
    }
  }

  private async unmute(v: VoiceState): Promise<void> {
    // 外せたときだけ忘れる（外せなければ、次に入ったときにもう一度）
    const ok = await v.setMute(false, '奥の院から出たため').then(() => true, (err: unknown) => (logger.warn({ err }, 'afk unmute failed'), false));
    if (ok) await markAfkMuted(this.db, v.id, false);
  }
}

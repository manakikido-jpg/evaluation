import type { GuildMember } from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { watchOf } from '../services/securityWatch.js';

/**
 * 🛡 荒らし対策（入口）: 要注意リストの人が入ったら、運営のログに知らせる。
 * 案内待ちのまま止める（案内人のロール付与は guideReception で断る）
 */
export class SecurityApp {
  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
    private readonly discord: Pick<DiscordActions, 'sendMessage'>,
  ) {}

  async onMemberAdd(m: GuildMember): Promise<void> {
    if (m.guild.id !== this.cfg().guildId || m.user.bot) return;
    const w = await watchOf(this.db, m.id);
    if (!w) return;
    const ch = this.cfg().channels.log;
    logger.warn({ memberId: m.id }, 'watched member joined');
    if (!ch) return;
    await this.discord
      .sendMessage(ch, {
        content: [
          `🛡 **要注意リストの人が入りました**: <@${m.id}>（${m.user.username}・ID ${m.id}）`,
          `理由: ${w.reason}`,
          '案内待ちのまま止めています。案内人はロールを付けられません。対応は神職・宮司で決めてください（社務所Web の「🛡 荒らし対策」）。',
        ].join('\n'),
        allowed_mentions: { parse: [] },
      })
      .catch((err: unknown) => logger.warn({ err }, 'watch alert failed'));
  }
}

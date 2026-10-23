import { MessageFlags, type Interaction } from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { createLoginLink } from '../services/casino/loginLinks.js';
import { loadUpdatePostConfig } from '../services/updatePosts.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] as never[] } } as const;

/** /投稿文: まとめ係のロールの人に、投稿文の下書きページへ入る 1 回きりのリンクを出す（本人にだけ） */
export class UpdateDeskApp {
  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
    private readonly baseUrl?: string,
  ) {}

  async onInteraction(i: Interaction): Promise<void> {
    if (!i.isChatInputCommand() || i.commandName !== 'toukoubun') return;
    if (!i.inCachedGuild() || i.guildId !== this.cfg().guildId) return;
    try {
      await i.deferReply(EPHEMERAL);
      const conf = await loadUpdatePostConfig(this.db);
      if (!conf.roleId || !i.member.roles.cache.has(conf.roleId)) return void (await i.editReply({ content: 'まとめ係のロールの人だけが使えます。', allowedMentions: { parse: [] } }));
      if (!this.baseUrl) return void (await i.editReply({ content: 'いまは使えません（社務所Web の場所が決まっていません）。', allowedMentions: { parse: [] } }));
      const token = await createLoginLink(this.db, { id: i.user.id, displayName: i.member.displayName, avatarUrl: i.member.displayAvatarURL({ size: 128 }) });
      await i.editReply({ content: `📝 投稿文の下書きページへのリンクです（10 分だけ・1 回だけ使えます。人に渡さないでください）。\n${this.baseUrl}/update-desk/link/${token}`, allowedMentions: { parse: [] } });
    } catch (err) {
      logger.warn({ err }, 'update desk link failed');
      await i.editReply({ content: 'リンクを出せませんでした。時間をおいてもう一度お試しください。', allowedMentions: { parse: [] } }).catch(() => undefined);
    }
  }
}

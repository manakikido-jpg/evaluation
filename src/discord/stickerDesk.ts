import { MessageFlags, type Interaction } from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { createLoginLink } from '../services/casino/loginLinks.js';
import { stickerCreatorRole } from '../services/stickers.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] as never[] } } as const;

/** /スタンプ製作: スタンプ製作者のロールの人に、スタンプの製作ページへ入る 1 回きりのリンクを出す（本人にだけ） */
export class StickerDeskApp {
  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
    private readonly baseUrl?: string,
  ) {}

  async onInteraction(i: Interaction): Promise<void> {
    if (!i.isChatInputCommand() || i.commandName !== 'stickerdesk') return;
    if (!i.inCachedGuild() || i.guildId !== this.cfg().guildId) return;
    try {
      await i.deferReply(EPHEMERAL);
      const roles = [...i.guild.roles.cache.values()];
      const roleId = await stickerCreatorRole(this.db, roles);
      const member = await i.guild.members.fetch({ user: i.user.id, force: true });
      if (!roleId || !member.roles.cache.has(roleId)) return void (await i.editReply({ content: 'スタンプ製作者のロールの人だけが使えます。', allowedMentions: { parse: [] } }));
      if (!this.baseUrl) return void (await i.editReply({ content: 'いまは使えません（社務所Web の場所が決まっていません）。', allowedMentions: { parse: [] } }));
      const token = await createLoginLink(this.db, { id: i.user.id, displayName: i.member.displayName, avatarUrl: i.member.displayAvatarURL({ size: 128 }) });
      await i.editReply({ content: `📝 スタンプの製作ページへのリンクです（10 分だけ・1 回だけ使えます。人に渡さないでください）。\n${this.baseUrl}/sticker-desk/link/${token}`, allowedMentions: { parse: [] } });
    } catch (err) {
      logger.warn({ err }, 'sticker desk link failed');
      await i.editReply({ content: 'リンクを出せませんでした。時間をおいてもう一度お試しください。', allowedMentions: { parse: [] } }).catch(() => undefined);
    }
  }
}

import type { Client } from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { panelByMessage, roleFor } from '../services/reactionRoles.js';
import { dangerLabels } from '../services/roles.js';

type ReactionEvent = {
  user_id: string;
  message_id: string;
  guild_id?: string;
  emoji: { id?: string | null; name?: string | null };
  member?: { user?: { bot?: boolean } };
};

/**
 * 🎭 スタンプでロールを付ける・外す。
 * キャッシュにない古いメッセージでも動くように、Discord から届いた生のできごと（raw）を見る。
 */
export class ReactionRoleApp {
  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
  ) {}

  attach(client: Client): void {
    client.on('raw', (packet: { t?: string; d?: unknown }) => {
      if (packet.t !== 'MESSAGE_REACTION_ADD' && packet.t !== 'MESSAGE_REACTION_REMOVE') return;
      void this.onReaction(client, packet.t === 'MESSAGE_REACTION_ADD', packet.d as ReactionEvent).catch((err) => logger.warn({ err }, 'reaction role failed'));
    });
  }

  async onReaction(client: Pick<Client, 'user' | 'guilds'>, add: boolean, d: ReactionEvent): Promise<'added' | 'removed' | undefined> {
    if (d.guild_id !== this.cfg().guildId || d.user_id === client.user?.id || d.member?.user?.bot) return;
    const panel = await panelByMessage(this.db, d.message_id);
    if (!panel) return;
    const roleId = roleFor(panel, d.emoji);
    if (!roleId) return;
    const guild = client.guilds.cache.get(d.guild_id);
    const member = await guild?.members.fetch(d.user_id).catch(() => undefined);
    if (!member || member.user.bot) return;
    // あとから強い権限が付いたロールは、付けない（作ったときに確かめたが、念のため毎回）
    const role = guild!.roles.cache.get(roleId);
    if (!role || role.managed || dangerLabels(role.permissions.bitfield).length) return;
    if (add) {
      if (member.roles.cache.has(roleId)) return;
      await member.roles.add(roleId, '🎭 スタンプでロールを選んだ');
      return 'added';
    }
    if (!member.roles.cache.has(roleId)) return;
    await member.roles.remove(roleId, '🎭 スタンプを外した');
    return 'removed';
  }
}

import { MessageFlags, type Interaction } from 'discord.js';
import { adminLevelOf, type GuildConfig } from '../config.js';
import { logger } from '../lib/logger.js';
import { isYakudoshi, yakuBlocks, YAKU_BLOCKED } from '../services/yakuGate.js';

/**
 * 👹 厄のあいだ止める操作か（ほかの機能に渡す前に見る）。運営（神職・宮司）は止めない。
 */
export function yakuInteractionBlocked(cfg: GuildConfig, i: Interaction): boolean {
  if (!i.inCachedGuild() || i.guildId !== cfg.guildId || i.user.bot) return false;
  const roleIds = [...i.member.roles.cache.keys()];
  if (!isYakudoshi(cfg, roleIds) || adminLevelOf(cfg, roleIds)) return false;
  const command = i.isChatInputCommand() || i.isAutocomplete() ? i.commandName : undefined;
  const customId = 'customId' in i ? i.customId : undefined;
  return yakuBlocks({ command, customId });
}

/** 止めたことを本人だけに知らせる */
export async function replyYakuBlocked(i: Interaction): Promise<void> {
  try {
    if (i.isAutocomplete()) await i.respond([]);
    else if (i.isRepliable()) await i.reply({ content: YAKU_BLOCKED, flags: MessageFlags.Ephemeral });
  } catch (err) {
    logger.warn({ err }, 'yaku gate reply failed');
  }
}

import { MessageFlags, type Interaction } from 'discord.js';
import { adminLevelOf, type GuildConfig } from '../config.js';
import { logger } from '../lib/logger.js';

/**
 * 🔥 荒魂のあいだ止める操作（本人の決定 2026-11-27）。
 * 絵馬（贈る・受け取る）・結び・キャスト（給仕と利用）は使えない。縁側・宿への参加・カジノ（1日500銭まで）は使える。
 * 荒魂のロール ID は社務所Web で入れる（setRole で渡す。未設定なら何も止めない）。
 */
export const ARAMITAMA_BLOCKED = '🔥 荒魂のあいだは使えません。使えるのは、縁側・宿への参加・カジノ（1日500銭まで）です。3人を招待すると参拝者に戻れます。';

const COMMANDS: ReadonlySet<string> = new Set(['cast', 'ema']);
const PREFIXES: readonly string[] = ['control:musubi:', 'control:ema:', 'cast:', 'ema:give:', 'ema:modal:', 'ema:pick:', 'ema:edit:', 'ema:to:', 'ema:vote:', 'shuin:give:', 'shuin:unmet:', 'shuin:pick'];

export function aramitamaBlocks(action: { command?: string; customId?: string }): boolean {
  if (action.command && COMMANDS.has(action.command)) return true;
  const id = action.customId;
  return Boolean(id && PREFIXES.some((p) => id.startsWith(p)));
}

export class AramitamaGate {
  private roleId: string | null = null;
  /** 荒魂のロール ID を入れ直す（10分ごとの見回りから） */
  setRole(roleId: string | null): void { this.roleId = roleId; }

  /** 止める操作か。運営（神職・宮司）は止めない */
  blocked(cfg: GuildConfig, i: Interaction): boolean {
    if (!this.roleId || !i.inCachedGuild() || i.guildId !== cfg.guildId || i.user.bot) return false;
    const roleIds = [...i.member.roles.cache.keys()];
    if (!roleIds.includes(this.roleId) || adminLevelOf(cfg, roleIds)) return false;
    const command = i.isChatInputCommand() || i.isAutocomplete() ? i.commandName : undefined;
    const customId = 'customId' in i ? i.customId : undefined;
    return aramitamaBlocks({ command, customId });
  }

  async reply(i: Interaction): Promise<void> {
    try {
      if (i.isAutocomplete()) await i.respond([]);
      else if (i.isRepliable()) await i.reply({ content: ARAMITAMA_BLOCKED, flags: MessageFlags.Ephemeral });
    } catch (err) {
      logger.warn({ err }, 'aramitama gate reply failed');
    }
  }
}

import { MessageFlags, type Interaction } from 'discord.js';
import { adminLevelOf, type GuildConfig } from '../config.js';
import { logger } from '../lib/logger.js';
import { commandList, helpEmbeds } from '../services/commandList.js';
import { commandDefinitions } from './commands.js';

/** ⌨ /コマンド: 使えるコマンドの一覧（運営には運営のコマンドも。公開なら、だれでも使えるものだけ） */
export class HelpApp {
  constructor(private readonly cfg: () => GuildConfig) {}

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'help') return;
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    try {
      const pub = interaction.options.getBoolean('public') ?? false;
      const staff = !pub && Boolean(adminLevelOf(this.cfg(), [...interaction.member.roles.cache.keys()]));
      const embeds = helpEmbeds(commandList(commandDefinitions(this.cfg())), { staff });
      await interaction.reply({ embeds, ...(pub ? {} : { flags: MessageFlags.Ephemeral }) });
    } catch (err) {
      logger.warn({ err }, 'help failed');
    }
  }
}

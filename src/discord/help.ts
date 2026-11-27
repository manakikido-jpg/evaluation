import { controlAccess, parseControlId } from './controlPanel.js';
import { MessageFlags, type Interaction } from 'discord.js';
import { adminLevelOf, type GuildConfig } from '../config.js';
import { logger } from '../lib/logger.js';
import { commandList, helpEmbeds } from '../services/commandList.js';
import { highestRank, rankLabel } from '../domain/ranks.js';
import { commandDefinitions } from './commands.js';

/** ⌨ /コマンド: 使えるコマンドの一覧（運営には運営のコマンドも。公開なら、だれでも使えるものだけ） */
export class HelpApp {
  constructor(private readonly cfg: () => GuildConfig) {}

  async onInteraction(interaction: Interaction): Promise<void> {
    const command = interaction.isChatInputCommand() && interaction.commandName === 'help';
    const panel = !command && interaction.isButton() ? parseControlId(interaction.customId) : undefined;
    if (!command && panel?.action !== 'help') return;
    if (!interaction.isRepliable() || !interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    try {
      const cfg = this.cfg();
      if (panel && interaction.isButton()) {
        const blocked = controlAccess(interaction, panel);
        if (blocked) return void await interaction.reply({ content: blocked, flags: MessageFlags.Ephemeral });
      }
      const pub = interaction.isChatInputCommand() ? interaction.options.getBoolean('public') ?? false : false;
      const roleIds = [...interaction.member.roles.cache.keys()];
      const rank = highestRank(cfg.ranks, roleIds);
      // 公開のときは、入鯖が承認された人向けのもの（運営・厄のものは出さない）
      const viewer = pub
        ? { member: true, yakudoshi: false, staff: false }
        : { member: Boolean(rank), yakudoshi: Boolean(cfg.roles.yakudoshi && roleIds.includes(cfg.roles.yakudoshi)), staff: Boolean(adminLevelOf(cfg, roleIds)), rankLabel: rank ? rankLabel(rank) : '（まだ承認されていません）' };
      const embeds = helpEmbeds(commandList(commandDefinitions(cfg)), viewer);
      await interaction.reply({ embeds, allowedMentions: { parse: [] }, ...(pub ? {} : { flags: MessageFlags.Ephemeral }) });
    } catch (err) {
      logger.warn({ err }, 'help failed');
    }
  }
}

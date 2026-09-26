import { MessageFlags, type Interaction } from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { claimOnboarding, onboardingOf, onboardingText } from '../services/onboarding.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

/** /はじめて: はじめての参拝の進み具合（本人にだけ見える）。全部できていればお祝いも */
export class OnboardingApp {
  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
  ) {}

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'hajimete') return;
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    try {
      await interaction.deferReply(EPHEMERAL);
      const cfg = this.cfg();
      const roleIds = [...interaction.member.roles.cache.keys()];
      const claimed = await claimOnboarding(this.db, cfg, interaction.user.id, roleIds);
      const p = await onboardingOf(this.db, cfg, interaction.user.id, roleIds);
      await interaction.editReply({ content: onboardingText(cfg, p, claimed) });
    } catch (err) {
      logger.error({ err }, 'onboarding failed');
      await interaction.editReply({ content: '読み込めませんでした。時間をおいてもう一度お試しください。' }).catch(() => undefined);
    }
  }
}

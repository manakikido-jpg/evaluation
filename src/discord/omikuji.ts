import { MessageFlags, type ChatInputCommandInteraction, type Interaction } from 'discord.js';
import type { EconomyConfig, GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { drawOmikuji, type OmikujiResult } from '../services/omikuji.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

/** 引いた結果のカード（みんなに見える） */
export function omikujiEmbed(r: Extract<OmikujiResult, { status: 'drawn' }>, name: string, economy: EconomyConfig) {
  const coin = `${economy.currencyEmoji}${economy.currencyName}`;
  const lines = [
    `**${name}** さんの運勢`,
    r.fortune.message,
    '',
    ...r.sayings.map((s) => `${s.label} … ${s.text}`),
    '',
    ...(r.amount > 0 ? [`${coin} **+${r.amount}**（いま ${r.balance} 枚）`] : []),
    '-# おみくじは 1 日 1 回。日本時間の 0 時にまた引けます',
  ];
  return { title: `⛩ おみくじ ― ${r.fortune.name}`, description: lines.join('\n'), color: r.fortune.color };
}

/** /おみくじ（1 日 1 回のログボ） */
export class OmikujiApp {
  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
  ) {}

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'omikuji') return;
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    try {
      await this.draw(interaction);
    } catch (err) {
      logger.error({ err }, 'omikuji failed');
      const msg = { content: 'おみくじを引けませんでした。時間をおいてもう一度お試しください。', ...EPHEMERAL };
      await (interaction.replied || interaction.deferred ? interaction.followUp(msg) : interaction.reply(msg)).catch(() => undefined);
    }
  }

  private async draw(i: ChatInputCommandInteraction<'cached'>): Promise<void> {
    const cfg = this.cfg();
    // #おみくじ があれば、そこで引いてもらう（ほかのチャンネルが流れないように）
    const home = cfg.channels.omikuji ?? i.guild.channels.cache.find((c) => c.isTextBased() && c.name === 'おみくじ')?.id;
    if (home && i.channelId !== home) {
      await i.reply({ content: `おみくじは <#${home}> で引けます。`, ...EPHEMERAL });
      return;
    }
    const r = await drawOmikuji(this.db, cfg.economy, i.user.id, new Date());
    if (r.status === 'already') {
      await i.reply({ content: `今日はもう引きました（${r.fortune.name}）。日本時間の 0 時にまた引けます。`, ...EPHEMERAL });
      return;
    }
    await i.reply({ embeds: [omikujiEmbed(r, i.member.displayName, cfg.economy)], allowedMentions: { parse: [] } });
  }
}

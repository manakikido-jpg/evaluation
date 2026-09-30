import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, type Interaction } from 'discord.js';
import type { GuildConfig } from '../config.js';
import { logger } from '../lib/logger.js';

/** /カジノ: 社務所Web のカジノへのリンク（本人にだけ） */
export function casinoReply(cfg: GuildConfig, baseUrl: string | undefined) {
  const c = cfg.casino;
  if (!baseUrl) return { content: 'カジノの場所（WEB_BASE_URL）がまだ決まっていません。運営に知らせてください。', flags: MessageFlags.Ephemeral } as const;
  if (!c.enabled) return { content: '🌙 いまカジノはお休みです。', flags: MessageFlags.Ephemeral } as const;
  const coin = `${cfg.economy.currencyEmoji}${cfg.economy.currencyName}`;
  return {
    embeds: [
      {
        title: '🌸 咲楽ノ宮カジノ',
        description: [
          'ブラックジャック・ハイ＆ロー・バカラ・スロット・ルーレット・オセロ（CPU・メンバー対戦）で遊べます。',
          `賭けるのはサーバーの${coin}（1 回 ${c.minBet.toLocaleString('ja-JP')}〜${c.maxBet.toLocaleString('ja-JP')}）。`,
          '下のボタンから開いて、Discord でログインしてください。',
        ].join('\n'),
        color: 0xe2b340,
      },
    ],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('カジノを開く').setEmoji('🎰').setURL(`${baseUrl}/casino`))],
    flags: MessageFlags.Ephemeral,
  } as const;
}

export class CasinoApp {
  constructor(
    private readonly cfg: () => GuildConfig,
    private readonly baseUrl: string | undefined,
  ) {}

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'casino') return;
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    await interaction.reply(casinoReply(this.cfg(), this.baseUrl)).catch((err: unknown) => logger.warn({ err }, 'casino reply failed'));
  }
}

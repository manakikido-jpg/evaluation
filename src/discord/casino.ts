import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, type Interaction } from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { createLoginLink, LINK_MINUTES } from '../services/casino/loginLinks.js';

/** /カジノ: 社務所Web のカジノへのリンク（本人にだけ）。link: ログインなしで入るリンク（1 回きり） */
export function casinoReply(cfg: GuildConfig, baseUrl: string | undefined, link?: string) {
  const c = cfg.casino;
  if (!baseUrl) return { content: 'カジノの場所（WEB_BASE_URL）がまだ決まっていません。運営に知らせてください。', flags: MessageFlags.Ephemeral } as const;
  if (!c.enabled) return { content: '🌙 いまカジノはお休みです。', flags: MessageFlags.Ephemeral } as const;
  const coin = `${cfg.economy.currencyEmoji}${cfg.economy.currencyName}`;
  return {
    embeds: [
      {
        title: '🌸 咲楽ノ宮カジノ',
        description: [
          'スロット・ブラックジャック・ルーレット・ちんちろ・ポーカー・大富豪などで遊べます。',
          `賭けるのはサーバーの${coin}（1 回 ${c.minBet.toLocaleString('ja-JP')}〜${c.maxBet.toLocaleString('ja-JP')}）。`,
          link
            ? `「🎰 カジノに入る」を押すと、ログインしなくても入れます（このボタンはあなたにだけ見えます。${LINK_MINUTES} 分・1 回きり。人に渡さないでください）。`
            : '下のボタンから開いて、Discord でログインしてください。',
        ].join('\n'),
        color: 0xe2b340,
      },
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...(link ? [new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('カジノに入る').setEmoji('🎰').setURL(`${baseUrl}/casino/link/${link}`)] : []),
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(link ? 'Discord でログインして入る' : 'カジノを開く').setEmoji(link ? '🔑' : '🎰').setURL(`${baseUrl}/casino`),
      ),
    ],
    flags: MessageFlags.Ephemeral,
  } as const;
}

export class CasinoApp {
  constructor(
    private readonly cfg: () => GuildConfig,
    private readonly baseUrl: string | undefined,
    private readonly db?: Db,
  ) {}

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'casino') return;
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    let link: string | undefined;
    if (this.db && this.baseUrl && this.cfg().casino.enabled) {
      const m = interaction.member;
      link = await createLoginLink(this.db, { id: m.id, displayName: m.displayName, avatarUrl: m.displayAvatarURL({ size: 128 }) }).catch((err: unknown) => {
        logger.warn({ err }, 'casino link create failed');
        return undefined;
      });
    }
    await interaction.reply(casinoReply(this.cfg(), this.baseUrl, link)).catch((err: unknown) => logger.warn({ err }, 'casino reply failed'));
  }
}

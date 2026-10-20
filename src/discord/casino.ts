import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, type Interaction } from 'discord.js';
import { adminLevelOf, type GuildConfig } from '../config.js';
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
    if (!interaction.isChatInputCommand() || !['casino', 'shinpu', 'mypage'].includes(interaction.commandName)) return;
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    // 👘 /マイページ: 本人だけのページへの 1 回きりのリンク
    if (interaction.commandName === 'mypage') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      let link: string | undefined;
      if (this.db && this.baseUrl) {
        const m = interaction.member;
        link = await createLoginLink(this.db, { id: m.id, displayName: m.displayName, avatarUrl: m.displayAvatarURL({ size: 128 }) }).catch((err: unknown) => {
          logger.warn({ err }, 'mypage link create failed');
          return undefined;
        });
      }
      await interaction.editReply(myPageReply(this.baseUrl, link)).catch((err: unknown) => logger.warn({ err }, 'mypage reply failed'));
      return;
    }
    if (interaction.commandName === 'shinpu') {
      if (!adminLevelOf(this.cfg(), [...interaction.member.roles.cache.keys()])) {
        await interaction.reply({ content: '神符合戦のテストは、宮司・神職だけが遊べます。', flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      let testLink: string | undefined;
      if (this.db && this.baseUrl) {
        const m = interaction.member;
        testLink = await createLoginLink(this.db, { id: m.id, displayName: m.displayName, avatarUrl: m.displayAvatarURL({ size: 128 }) }).catch((err: unknown) => { logger.warn({ err }, 'shinpu test link create failed'); return undefined; });
      }
      await interaction.editReply(shinpuTestReply(this.baseUrl, testLink));
      return;
    }
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

/** 運営本人だけに渡す入口。Webでも運営ロールを確かめる。 */
export function shinpuTestReply(baseUrl: string | undefined, token?: string) {
  if (!baseUrl) return { content: 'Webの場所がまだ決まっていません。', allowedMentions: { parse: [] as const } };
  return { content: '神符合戦・運営テスト\n運営同士で対戦し、空いている席は式神CPUで埋められます。サーバーの銭は使いません。\n' + (token ? 'リンクは10分・1回きりです。人に渡さないでください。' : 'ボタンから開いて、Discordで認証してください。'), allowedMentions: { parse: [] as const }, components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('テストプレイに入る').setURL(`${baseUrl}/casino/shinpu${token ? `/link/${token}` : ''}`))] };
}

/** 👘 /マイページ: 本人だけに出す、マイページへの 1 回きりのリンク */
export function myPageReply(baseUrl: string | undefined, token?: string) {
  if (!baseUrl || !token) return { content: 'マイページを開けませんでした。少し待ってから、もう一度お試しください。', allowedMentions: { parse: [] as const } };
  return {
    content: `👘 **マイページ**\n持っている色守り・称号を、つける・外すを自分で選べます。\n-# このボタンはあなたにだけ見えます（${LINK_MINUTES} 分・1 回きり。人に渡さないでください）`,
    allowedMentions: { parse: [] as const },
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('マイページを開く').setEmoji('👘').setURL(`${baseUrl}/mypage/link/${token}`))],
  };
}

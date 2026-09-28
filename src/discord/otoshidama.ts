import { MessageFlags, type Interaction } from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { bagMessage, bagState, claimBag, CLAIM_MESSAGES, expireBags } from '../services/otoshidama.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

/** 🧧 お年玉袋: 「もらう」ボタンと、期限が来た袋の片付け（置くのは授与所から） */
export class OtoshidamaApp {
  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
    private readonly discord: DiscordActions,
  ) {}

  private coin() {
    const e = this.cfg().economy;
    return { name: e.currencyName, emoji: e.currencyEmoji };
  }

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isButton() || !interaction.customId.startsWith('otoshi:claim:')) return;
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    const bagId = Number(interaction.customId.split(':')[2]);
    try {
      const r = await claimBag(this.db, this.cfg(), bagId, { id: interaction.user.id, roleIds: [...interaction.member.roles.cache.keys()], bot: interaction.user.bot });
      if (r.status !== 'ok') return void (await interaction.reply({ content: CLAIM_MESSAGES[r.status], ...EPHEMERAL }));
      const state = await bagState(this.db, bagId);
      if (state) await interaction.update({ ...bagMessage(state.bag, state.claims, this.coin()), allowedMentions: { parse: [] } } as Parameters<typeof interaction.update>[0]);
      else await interaction.deferUpdate();
      const e = this.cfg().economy;
      const lucky = state && r.amount === Math.max(...state.bag.shares) ? '（いちばん多い袋！）' : '';
      await interaction.followUp({ content: `🧧 お年玉袋から ${e.currencyEmoji}**${r.amount.toLocaleString('ja-JP')} 枚** 受け取りました${lucky}。`, ...EPHEMERAL });
    } catch (err) {
      logger.error({ err, bagId }, 'otoshidama claim failed');
      if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: 'うまくいきませんでした。もう一度押してください。', ...EPHEMERAL }).catch(() => undefined);
    }
  }

  /** 1 分ごと: 期限が来た袋を閉じて、残りを置いた人に戻す */
  async tick(now = new Date()): Promise<void> {
    for (const bag of await expireBags(this.db, now)) {
      if (!bag.messageId) continue;
      const state = await bagState(this.db, bag.id);
      if (!state) continue;
      await this.discord
        .editMessage(bag.channelId, bag.messageId, bagMessage(state.bag, state.claims, this.coin(), now))
        .catch((err: unknown) => logger.warn({ err, bagId: bag.id }, 'otoshidama expire edit failed'));
    }
  }
}

import { MessageFlags, type ChatInputCommandInteraction, type GuildMember, type Interaction } from 'discord.js';
import type { EconomyConfig, GuildConfig, OmikujiStreakConfig, StreakReward } from '../config.js';
import type { Db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { drawOmikuji, nextStreakReward, streakRewardText, type OmikujiResult } from '../services/omikuji.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

/** 連続日数の行（「🔥 連続 6 日目 ・ あと 1 日で 7 日のおまけ」） */
export function streakLines(streak: number, bonus: readonly StreakReward[], cfg: OmikujiStreakConfig | undefined, economy: EconomyConfig): string[] {
  if (!streak) return [];
  const next = cfg ? nextStreakReward(cfg, streak) : undefined;
  return [
    `🔥 連続 **${streak}** 日目${next ? ` ・ あと ${next.left} 日で ${next.reward.days} 日のおまけ` : ''}`,
    ...bonus.map((b) => `🎁 **${b.days} 日続いたおまけ**: ${streakRewardText(b, economy)}`),
  ];
}

/** 通話に入っていないと引けないとき、その案内（引けるなら undefined）。AFK・数えない通話は入っていないのと同じ */
export function omikujiVoiceBlock(economy: Pick<EconomyConfig, 'omikujiVoiceOnly' | 'excludedVoiceChannelIds'>, member: Pick<GuildMember, 'voice' | 'guild'>): string | undefined {
  if (!economy.omikujiVoiceOnly) return undefined;
  const ch = member.voice.channelId;
  if (ch && ch !== member.guild.afkChannelId && !economy.excludedVoiceChannelIds.includes(ch)) return undefined;
  return '🔊 おみくじは **通話に入っているときだけ** 引けます。どこかの通話に入ってから、もう一度どうぞ（AFK の通話はのぞく）。';
}

/** 引いた結果のカード（みんなに見える） */
export function omikujiEmbed(r: Extract<OmikujiResult, { status: 'drawn' }>, name: string, economy: EconomyConfig, streak?: OmikujiStreakConfig) {
  const coin = `${economy.currencyEmoji}${economy.currencyName}`;
  const lines = [
    `**${name}** さんの運勢`,
    r.fortune.message,
    '',
    ...r.sayings.map((s) => `${s.label} … ${s.text}`),
    '',
    ...(r.amount > 0 ? [`${coin} **+${r.amount}**（いま ${r.balance} 枚）`] : []),
    ...streakLines(r.streak, r.bonus, streak, economy),
    `-# おみくじは 1 日 1 回。日本時間の 0 時にまた引けます${streak?.rewards.length ? '（毎日続けるとおまけがあります。1 日空けると 1 日目から）' : ''}`,
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
    const blocked = omikujiVoiceBlock(cfg.economy, i.member);
    if (blocked) {
      await i.reply({ content: blocked, ...EPHEMERAL });
      return;
    }
    const r = await drawOmikuji(this.db, cfg.economy, i.user.id, new Date(), Math.random, { streak: cfg.omikujiStreak });
    if (r.status === 'already') {
      const streak = r.streak ? `（🔥 連続 ${r.streak} 日目）` : '';
      await i.reply({ content: `今日はもう引きました（${r.fortune.name}）${streak}。日本時間の 0 時にまた引けます。`, ...EPHEMERAL });
      return;
    }
    await i.reply({ embeds: [omikujiEmbed(r, i.member.displayName, cfg.economy, cfg.omikujiStreak)], allowedMentions: { parse: [] } });
    // おまけの称号ロール（もう持っていれば何もしない）
    for (const b of r.bonus) {
      if (!b.roleId || i.member.roles.cache.has(b.roleId)) continue;
      await i.member.roles.add(b.roleId, `おみくじ ${b.days} 日続いたおまけ`).catch((err) => logger.warn({ err, roleId: b.roleId }, 'omikuji streak role failed'));
    }
  }
}

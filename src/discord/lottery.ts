import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, type Interaction, type Message } from 'discord.js';
import { adminLevelOf, type GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { audit } from '../services/audit.js';
import { claimLotteryResults, lotteryChannel, lotteryDm, lotteryPanelMessage, lotteryWinnerPost, roundWinners, setLotteryChannel } from '../services/casino/lotteryNotice.js';
import { createLoginLink, LINK_MINUTES } from '../services/casino/loginLinks.js';

/**
 * 🎫 宝くじ売り場（Discord 側）。
 * - /パネル 宝くじ: 置いたチャンネルに「売り場に入る」ボタン。そのチャンネルを売り場として覚える（当選の知らせもここ）
 * - ボタン: ログインなしで入れる、本人だけの 1 回きりのリンクを返す（カジノの /カジノ と同じ）
 * - 日曜 21 時の抽選のあと: 買った人みんなに当たり・はずれを DM。当たった人は売り場に出す
 */

export function lotteryPanel() {
  return {
    embeds: [
      {
        title: '🎫 宝くじ売り場',
        description: ['毎日のスクラッチと、週末宝くじが買えます。', '週末宝くじは **日曜 21 時** に抽選。結果は当たりもはずれも DM でお知らせします。', '下のボタンから入ってください（あなただけのリンクが出ます）。'].join('\n'),
        color: 0xd4a017,
      },
    ],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('lottery:enter').setStyle(ButtonStyle.Success).setEmoji('🎫').setLabel('宝くじ売り場に入る'))],
    allowedMentions: { parse: [] as const },
  };
}

export function lotteryLinkReply(baseUrl: string | undefined, token: string | undefined) {
  if (!baseUrl || !token) return { content: '入口を作れませんでした。少し待ってから、もう一度押してください。', allowedMentions: { parse: [] as const } };
  return {
    content: `🎫 宝くじ売り場への入口です（${LINK_MINUTES} 分・1 回だけ使えます。人に渡さないでください）。`,
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('売り場に入る').setURL(`${baseUrl}/lottery/link/${token}`))],
    allowedMentions: { parse: [] as const },
  };
}

export class LotteryApp {
  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
    private readonly discord: Pick<DiscordActions, 'sendDm' | 'sendMessage'>,
    private readonly baseUrl: string | undefined,
  ) {}

  async onInteraction(i: Interaction): Promise<void> {
    if (!i.inCachedGuild() || i.guildId !== this.cfg().guildId) return;
    try {
      if (i.isChatInputCommand() && i.commandName === 'panel' && i.options.getSubcommand(false) === 'lottery') {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        if (!adminLevelOf(this.cfg(), [...i.member.roles.cache.keys()])) return void (await i.editReply('神職・宮司のみ置けます。'));
        if (!i.channel?.isSendable()) return void (await i.editReply('このチャンネルには置けません。'));
        const old = await lotteryPanelMessage(this.db);
        const sent = await i.channel.send(lotteryPanel());
        await setLotteryChannel(this.db, i.channelId, i.user.id, sent.id);
        if (old?.messageId && old.messageId !== sent.id) await i.client.channels.fetch(old.channelId).then(ch => (ch?.isTextBased() ? ch.messages.delete(old.messageId!) : undefined)).catch(() => undefined);
        await audit(this.db, { actorId: i.user.id, action: 'lottery.panel', detail: { channelId: i.channelId }, via: 'discord' });
        return void (await i.editReply('🎫 宝くじ売り場のボタンを置きました。当選の知らせも、このチャンネルに出します。'));
      }
      if (i.isButton() && i.customId === 'lottery:enter') {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        const m = i.member;
        const token = this.baseUrl ? await createLoginLink(this.db, { id: m.id, displayName: m.displayName, avatarUrl: m.displayAvatarURL({ size: 128 }) }).catch((err: unknown) => (logger.warn({ err }, 'lottery link create failed'), undefined)) : undefined;
        await i.editReply(lotteryLinkReply(this.baseUrl, token));
      }
    } catch (err) {
      logger.warn({ err }, 'lottery interaction failed');
    }
  }

  private restickTimer: NodeJS.Timeout | undefined;
  private restickQueue: Promise<void> = Promise.resolve();
  /** 売り場のチャンネルに書き込み（当選の知らせも）があったら、3 秒落ち着いてからパネルをいちばん下に置き直す */
  async onMessage(msg: Message): Promise<void> {
    if (!msg.inGuild() || msg.guildId !== this.cfg().guildId) return;
    // 自分が置いたパネル自身では動かない（置き直しをくり返さない）
    if (msg.author.id === msg.client.user.id && msg.components.some(r => 'components' in r && r.components.some(c => 'customId' in c && c.customId === 'lottery:enter'))) return;
    const panel = await lotteryPanelMessage(this.db).catch(() => undefined);
    if (!panel?.messageId || panel.channelId !== msg.channelId || msg.id === panel.messageId) return;
    clearTimeout(this.restickTimer);
    const channel = msg.channel;
    this.restickTimer = setTimeout(() => {
      this.restickQueue = this.restickQueue.then(async () => {
        const now = await lotteryPanelMessage(this.db);
        if (!now?.messageId || now.channelId !== channel.id || channel.lastMessageId === now.messageId) return;
        const sent = await channel.send(lotteryPanel());
        await setLotteryChannel(this.db, channel.id, 'system', sent.id);
        await channel.messages.delete(now.messageId).catch(() => undefined);
      }).catch(err => logger.warn({ err }, 'lottery panel restick failed'));
    }, 3_000);
  }

  /** 抽選が終わった回の結果を知らせる（1 分ごとに呼ぶ）。DM を送った人数を返す */
  async notify(now = new Date()): Promise<number> {
    const results = await claimLotteryResults(this.db, now);
    if (!results.length) return 0;
    const e = this.cfg().economy;
    const coin = `${e.currencyEmoji}${e.currencyName}`;
    const channelId = await lotteryChannel(this.db);
    let sent = 0;
    for (const r of results) {
      for (const h of r.holders) if (await this.discord.sendDm(h.memberId, lotteryDm(r.round, h, coin))) sent++;
      // 当たった人にだけ通知が届く（ほかの人には飛ばさない）
      const post = lotteryWinnerPost(r.round, coin);
      if (post && channelId) await this.discord.sendMessage(channelId, { content: post, allowed_mentions: { parse: [], users: [...new Set(roundWinners(r.round).map((w) => w.memberId))].slice(0, 100) } }).catch((err: unknown) => logger.warn({ err }, 'lottery winner post failed'));
    }
    return sent;
  }
}

import { randomBytes } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Interaction,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import { adminLevelOf, type AdminLevel, type GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { walletOf } from '../services/economy.js';
import { getMember } from '../services/members.js';
import {
  clearYaku,
  giveYaku,
  instantBan,
  kickMember,
  purchaseMenzaifu,
  writeMemo,
  type Actor,
  type Denied,
  type ModCtx,
} from '../services/moderation.js';
import { goshuinchoOf } from '../services/shuin.js';
import { activeYakuCount, memosOf, membersWithYaku, menzaifuUsed } from '../services/yaku.js';
import { rankLabel, highestRank } from '../domain/ranks.js';
import { SHU } from './views.js';

const NO_MENTIONS = { parse: [] as const };
const mention = (id: string) => `<@${id}>`;
const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

const DENIED: Record<Denied, string> = {
  self: '自分自身には使えません。',
  protected: 'この方には使えません（神職は神職・宮司に、宮司は宮司に操作できません）。',
  not_found: 'その方の記録が見つかりません。',
};

type Pending = { actorId: string; targetId: string; reason: string; expires: number };

/** 神職用のコマンド（厄・BAN・キック・メモ・メンバー情報）と、全員用の /menzaifu */
export class StaffApp {
  /** 2 つ目の厄（= BAN）の確認待ち */
  private pending = new Map<string, Pending>();

  constructor(
    private readonly client: Client,
    private readonly db: Db,
    cfg: GuildConfig | (() => GuildConfig),
    private readonly discord: DiscordActions,
    private readonly webBaseUrl?: string,
  ) {
    this.getCfg = typeof cfg === 'function' ? cfg : () => cfg;
  }

  private readonly getCfg: () => GuildConfig;
  private get cfg(): GuildConfig {
    return this.getCfg();
  }

  private get ctx(): ModCtx {
    return { db: this.db, cfg: this.cfg, discord: this.discord };
  }

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg.guildId) return;
    try {
      if (interaction.isChatInputCommand()) {
        switch (interaction.commandName) {
          case 'menzaifu':
            return await this.menzaifu(interaction);
          case 'yaku':
          case 'ban':
          case 'kick':
          case 'memo':
          case 'member':
            return await this.staffCommand(interaction);
        }
      } else if (interaction.isButton()) {
        if (interaction.customId === 'menzaifu:buy') return await this.buyMenzaifu(interaction);
        if (interaction.customId.startsWith('yaku:confirm:')) return await this.confirmYaku(interaction);
        if (interaction.customId.startsWith('yaku:cancel:')) {
          this.pending.delete(interaction.customId.split(':')[2] ?? '');
          await interaction.update({ content: 'やめました。', components: [] });
        }
      }
    } catch (err) {
      logger.error({ err }, 'staff interaction failed');
      if (interaction.isRepliable()) {
        const msg = { content: '申し訳ありません、うまく処理できませんでした。', ...EPHEMERAL };
        await (interaction.deferred || interaction.replied ? interaction.followUp(msg) : interaction.reply(msg)).catch(() => undefined);
      }
    }
  }

  private actorOf(interaction: ChatInputCommandInteraction<'cached'> | ButtonInteraction<'cached'>): Actor | undefined {
    const level: AdminLevel | undefined = adminLevelOf(this.cfg, [...interaction.member.roles.cache.keys()]);
    return level ? { id: interaction.user.id, level, via: 'discord' } : undefined;
  }

  // ───────── 神職用 ─────────

  private async staffCommand(i: ChatInputCommandInteraction<'cached'>): Promise<void> {
    const actor = this.actorOf(i);
    if (!actor) {
      await i.reply({ content: '神職・宮司のみ使えます。', ...EPHEMERAL });
      return;
    }
    await i.deferReply(EPHEMERAL);
    const target = i.options.getUser('user');
    const say = (content: string, extra: object = {}) => i.editReply({ content, allowedMentions: NO_MENTIONS, ...extra });

    if (i.commandName === 'yaku') {
      const sub = i.options.getSubcommand();
      if (sub === 'list') return void (await say(await this.yakuList()));
      if (!target) return;
      if (sub === 'add') {
        const reason = this.reasonOf(i.options.getString('reason', true), i.options.getString('note'));
        const r = await giveYaku(this.ctx, actor, target.id, reason, false);
        if (r.status === 'needs_confirm') {
          const nonce = randomBytes(9).toString('base64url');
          this.pending.set(nonce, { actorId: actor.id, targetId: target.id, reason, expires: Date.now() + 5 * 60_000 });
          const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`yaku:confirm:${nonce}`).setLabel('BAN する（厄 2 つ目）').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`yaku:cancel:${nonce}`).setLabel('やめる').setStyle(ButtonStyle.Secondary),
          );
          return void (await say(`⚠️ ${mention(target.id)} さまにはすでに厄が 1 つあります。付けると **BAN** になります。\n理由: ${reason}`, { components: [row] }));
        }
        return void (await say(this.yakuResultText(target.id, r)));
      }
      if (sub === 'clear') {
        const r = await clearYaku(this.ctx, actor, target.id, i.options.getString('note', true));
        const text =
          r.status === 'denied' ? DENIED[r.reason] : r.status === 'none' ? `${mention(target.id)} さまに厄はありません。` : `${mention(target.id)} さまの厄を 1 つ取り消しました（残り ${r.remaining}）。`;
        return void (await say(text));
      }
    }

    if (!target) return;
    if (i.commandName === 'ban') {
      const r = await instantBan(this.ctx, actor, target.id, i.options.getString('reason', true), i.options.getString('note') ?? '');
      if (r.status === 'denied') return void (await say(DENIED[r.reason]));
      await this.log(`⛔ 一発 BAN ${mention(target.id)}（${i.options.getString('reason', true)}）by ${mention(actor.id)}`);
      return void (await say(r.banOk ? `⛔ ${mention(target.id)} さまを BAN しました。` : '⚠️ BAN に失敗しました。BOT の権限（メンバーを BAN）と、ロールの位置を確認してください。記録は残しています。'));
    }
    if (i.commandName === 'kick') {
      const r = await kickMember(this.ctx, actor, target.id, i.options.getString('reason', true));
      if (r.status === 'denied') return void (await say(DENIED[r.reason]));
      return void (await say(r.kickOk ? `${mention(target.id)} さまをキックしました。` : '⚠️ キックに失敗しました。BOT の権限を確認してください。'));
    }
    if (i.commandName === 'memo') {
      const r = await writeMemo(this.ctx, actor, target.id, i.options.getString('body', true));
      return void (await say(r === 'ok' ? `📝 ${mention(target.id)} さまにメモを残しました。` : DENIED.not_found));
    }
    if (i.commandName === 'member') {
      return void (await i.editReply({ embeds: [await this.memberEmbed(target.id)], allowedMentions: NO_MENTIONS }));
    }
  }

  private reasonOf(reason: string, note: string | null): string {
    return note ? `${reason}（${note}）` : reason;
  }

  private yakuResultText(targetId: string, r: Awaited<ReturnType<typeof giveYaku>>): string {
    switch (r.status) {
      case 'denied':
        return DENIED[r.reason];
      case 'needs_confirm':
        return '確認が必要です。';
      case 'warned':
        return `👹 ${mention(targetId)} さまに厄を付けました（1 つ目・注意）。${r.dmSent ? '本人に DM で知らせました。' : '⚠️ DM は届きませんでした（DM を受け取らない設定の可能性）。'}${r.roleOk ? '' : '\n⚠️ 厄年ロールを付けられませんでした。BOT のロールの位置を確認してください。'}`;
      case 'banned':
        return r.banOk ? `⛔ ${mention(targetId)} さまは厄 2 つ目で BAN になりました。` : '⚠️ BAN に失敗しました。BOT の権限（メンバーを BAN）を確認してください。記録は残しています。';
    }
  }

  private async confirmYaku(i: ButtonInteraction<'cached'>): Promise<void> {
    const nonce = i.customId.split(':')[2] ?? '';
    const p = this.pending.get(nonce);
    const actor = this.actorOf(i);
    if (!p || p.expires < Date.now() || !actor || p.actorId !== actor.id) {
      await i.update({ content: '確認の期限が切れました。もう一度コマンドを使ってください。', components: [] });
      return;
    }
    this.pending.delete(nonce);
    await i.deferUpdate();
    const r = await giveYaku(this.ctx, actor, p.targetId, p.reason, true);
    if (r.status === 'banned') await this.log(`⛔ 厄 2 つ目で BAN ${mention(p.targetId)}（${p.reason}）by ${mention(actor.id)}`);
    await i.editReply({ content: this.yakuResultText(p.targetId, r), components: [], allowedMentions: NO_MENTIONS });
  }

  private async yakuList(): Promise<string> {
    const rows = await membersWithYaku(this.db);
    if (!rows.length) return '厄が付いている方はいません。';
    const lines = rows.slice(0, 25).map((r) => `👹 ${mention(r.memberId)}（${r.displayName ?? '?'}）厄 ${r.active}`);
    return `**厄が付いている方（${rows.length} 人）**\n${lines.join('\n')}${rows.length > 25 ? `\nほか ${rows.length - 25} 人は管理画面で確認してください。` : ''}`;
  }

  private async memberEmbed(userId: string) {
    const [m, card, wallet, yakuCount, memos] = await Promise.all([
      getMember(this.db, userId),
      goshuinchoOf(this.db, userId),
      walletOf(this.db, userId),
      activeYakuCount(this.db, userId),
      memosOf(this.db, userId, 3),
    ]);
    const e = this.cfg.economy;
    const embed = new EmbedBuilder()
      .setColor(SHU)
      .setTitle(m ? `${m.displayName}（@${m.username}）` : `ID ${userId}`)
      .setDescription(
        [
          m ? rankLabel(highestRank(this.cfg.ranks, m.roleIds)) : '記録なし',
          `ご縁 **${card.goen}** ・ ${e.currencyEmoji}${e.currencyName} ${wallet.balance}`,
          `厄 ${yakuCount}${yakuCount ? ' 👹' : ''}`,
          m?.joinedAt ? `参加 <t:${Math.floor(m.joinedAt.getTime() / 1000)}:D>` : '',
          m?.lastActiveAt ? `最後の活動 <t:${Math.floor(m.lastActiveAt.getTime() / 1000)}:R>` : '最後の活動 記録なし',
          m?.leftAt ? `退出 <t:${Math.floor(m.leftAt.getTime() / 1000)}:D>` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    if (memos.length) {
      embed.addFields({ name: '最近のメモ', value: memos.map((x) => `・${x.body.slice(0, 200)}`).join('\n').slice(0, 1024) });
    }
    if (this.webBaseUrl) embed.setURL(`${this.webBaseUrl}/members/${userId}`);
    return embed.toJSON();
  }

  // ───────── 全員用: 免罪符 ─────────

  private async menzaifu(i: ChatInputCommandInteraction<'cached'>): Promise<void> {
    await i.deferReply(EPHEMERAL);
    const e = this.cfg.economy;
    const [yakuCount, used, wallet] = await Promise.all([
      activeYakuCount(this.db, i.user.id),
      menzaifuUsed(this.db, i.user.id),
      walletOf(this.db, i.user.id),
    ]);
    const left = Math.max(0, e.menzaifuMaxUses - used);
    const lines = [
      `今の厄: ${yakuCount}${yakuCount ? ' 👹' : ''}`,
      `免罪符の値段: ${e.currencyEmoji}${e.currencyName} ${e.menzaifuPrice}`,
      `持っている${e.currencyName}: ${e.currencyEmoji} ${wallet.balance}`,
      `あと買える回数: ${left} 回`,
    ];
    const canBuy = yakuCount > 0 && left > 0 && wallet.balance >= e.menzaifuPrice;
    const embed = new EmbedBuilder().setColor(SHU).setTitle('📜 免罪符').setDescription(lines.join('\n'));
    const components = canBuy
      ? [
          new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
            new ButtonBuilder().setCustomId('menzaifu:buy').setLabel('免罪符を購入して厄を祓う').setStyle(ButtonStyle.Primary),
          ),
        ]
      : [];
    const note = yakuCount === 0 ? '厄は付いていません。' : left === 0 ? '免罪符はもう買えません。' : wallet.balance < e.menzaifuPrice ? `${e.currencyName}が足りません。通話や朱印で貯まります。` : '';
    await i.editReply({ content: note || null, embeds: [embed.toJSON()], components });
  }

  private async buyMenzaifu(i: ButtonInteraction<'cached'>): Promise<void> {
    await i.deferUpdate();
    const e = this.cfg.economy;
    const r = await purchaseMenzaifu(this.ctx, i.user.id);
    const text =
      r.status === 'ok'
        ? `📜 免罪符を購入し、厄を 1 つ祓いました（${e.currencyEmoji}-${r.price}）。${r.remaining ? `残りの厄: ${r.remaining}` : '厄はなくなりました。'}`
        : r.status === 'no_yaku'
          ? '厄は付いていません。'
          : r.status === 'used_up'
            ? '免罪符はもう買えません。'
            : `${e.currencyName}が足りません（必要 ${r.price} / 持っている ${r.balance}）。`;
    if (r.status === 'ok') await this.log(`📜 免罪符 ${mention(i.user.id)} が厄を祓いました（残り ${r.remaining}）`);
    await i.editReply({ content: text, embeds: [], components: [] });
  }

  private async log(content: string): Promise<void> {
    const id = this.cfg.channels.log;
    if (!id) return;
    try {
      const ch = await this.client.channels.fetch(id);
      if (ch?.isSendable()) await ch.send({ content, allowedMentions: NO_MENTIONS });
    } catch (err) {
      logger.warn({ err }, 'log send failed');
    }
  }
}

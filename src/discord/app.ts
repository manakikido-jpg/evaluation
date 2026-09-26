import {
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type Interaction,
  type Message,
  type UserContextMenuCommandInteraction,
} from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { decidePromotion, type Promotion } from '../domain/ranks.js';
import { KeyedLock } from '../lib/lock.js';
import { logger } from '../lib/logger.js';
import { giveFlow, revokeFlow, type MemberInfo } from '../services/flows.js';
import { addMessageCounts, eligibleVoiceMembers, voiceTick } from '../services/activity.js';
import { walletOf } from '../services/economy.js';
import { setOmairiStatus } from '../services/applications.js';
import { ActivityTracker, recordJoin, recordLeave, recordPromotion, syncAllMembers, upsertMember, type MemberSnapshot } from '../services/members.js';
import { giversOf, goenOf, goshuinchoOf, receivedCountOf, stampedBy } from '../services/shuin.js';
import { COMMAND, parseShuinId } from './ids.js';
import {
  giveLog,
  giveReply,
  giversReply,
  goshuinchoReply,
  promotionAnnouncement,
  promotionLog,
  revokeLog,
  revokeReply,
  vcList,
  type Reply,
} from './views.js';

const NO_MENTIONS = { parse: [] as const };

type Repliable = ChatInputCommandInteraction<'cached'> | UserContextMenuCommandInteraction<'cached'> | ButtonInteraction<'cached'>;

function toInfo(m: GuildMember): MemberInfo {
  return { id: m.id, isBot: m.user.bot, roleIds: [...m.roles.cache.keys()] };
}

export function toSnapshot(m: GuildMember): MemberSnapshot {
  return {
    id: m.id,
    username: m.user.username,
    displayName: m.displayName,
    avatarUrl: m.displayAvatarURL({ size: 128 }),
    // @everyone（サーバー ID と同じ）は除く
    roleIds: [...m.roles.cache.keys()].filter((id) => id !== m.guild.id),
    isBot: m.user.bot,
    joinedAt: m.joinedAt,
    boostingSince: m.premiumSince,
  };
}

/** 朱印 BOT の本体。Discord のイベントを受けて、services の処理と表示をつなぐ */
export class ShuinApp {
  private readonly lock = new KeyedLock();
  private readonly activity: ActivityTracker;
  /** 発言数（1 分ごとにまとめて DB へ） */
  private messageCounts = new Map<string, number>();

  constructor(
    private readonly client: Client,
    private readonly db: Db,
    cfg: GuildConfig | (() => GuildConfig),
  ) {
    this.activity = new ActivityTracker(db);
    this.getCfg = typeof cfg === 'function' ? cfg : () => cfg;
  }

  /** 管理画面で設定が変わると中身が入れ替わる（ConfigStore） */
  private readonly getCfg: () => GuildConfig;
  private get cfg(): GuildConfig {
    return this.getCfg();
  }

  // ───────── メンバーの同期（管理画面用） ─────────

  async syncAll(guildMembers: Iterable<GuildMember>): Promise<void> {
    const result = await syncAllMembers(this.db, [...guildMembers].map(toSnapshot));
    logger.info(result, 'members synced');
  }

  async onMemberAdd(m: GuildMember): Promise<void> {
    if (m.guild.id !== this.cfg.guildId) return;
    await recordJoin(this.db, toSnapshot(m)).catch((err) => logger.error({ err }, 'recordJoin failed'));
  }

  async onMemberRemove(guildId: string, userId: string): Promise<void> {
    if (guildId !== this.cfg.guildId) return;
    await recordLeave(this.db, userId).catch((err) => logger.error({ err }, 'recordLeave failed'));
  }

  async onMemberUpdate(m: GuildMember): Promise<void> {
    if (m.guild.id !== this.cfg.guildId) return;
    await upsertMember(this.db, toSnapshot(m)).catch((err) => logger.error({ err }, 'upsertMember failed'));
  }

  /** 1 分ごと: 発言数を書き込み、通話している人に通話時間と花びらを足す */
  async everyMinute(guild: Guild, now = new Date()): Promise<void> {
    const counts = this.messageCounts;
    this.messageCounts = new Map();
    await addMessageCounts(this.db, counts, now).catch((err) => logger.warn({ err }, 'message count flush failed'));

    const excluded = new Set(this.cfg.economy.excludedVoiceChannelIds);
    if (guild.afkChannelId) excluded.add(guild.afkChannelId);
    const channels = [...guild.channels.cache.values()]
      .filter((c) => c.isVoiceBased())
      .map((c) => ({
        id: c.id,
        members: [...c.members.values()].map((m) => ({ id: m.id, bot: m.user.bot, deaf: Boolean(m.voice.deaf) })),
      }));
    const ids = eligibleVoiceMembers(channels, excluded);
    if (!ids.length) return;
    const awarded = await voiceTick(this.db, this.cfg.economy, ids, now).catch((err) => {
      logger.warn({ err }, 'voice tick failed');
      return [];
    });
    if (awarded.length) logger.debug({ awarded: awarded.length }, 'voice coins awarded');
  }

  /** 発言・通話に入ったときに「最後の活動」を更新 */
  async onActivity(guildId: string | null, userId: string, isBot: boolean): Promise<void> {
    if (guildId !== this.cfg.guildId || isBot) return;
    await this.activity.touch(userId).catch((err) => logger.warn({ err }, 'activity update failed'));
  }

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg.guildId) return;
    try {
      if (interaction.isUserContextMenuCommand()) {
        if (interaction.commandName === COMMAND.giveMenu) return await this.give(interaction, interaction.targetId);
        if (interaction.commandName === COMMAND.cardMenu) return await this.card(interaction, interaction.targetId, false);
      } else if (interaction.isChatInputCommand() && interaction.commandName === COMMAND.goshuin) {
        const target = interaction.options.getUser('user') ?? interaction.user;
        const isPublic = interaction.options.getBoolean('public') ?? false;
        return await this.card(interaction, target.id, isPublic);
      } else if (interaction.isButton()) {
        const parsed = parseShuinId(interaction.customId);
        if (!parsed) return;
        switch (parsed.action) {
          case 'give':
            return await this.give(interaction, parsed.userId);
          case 'revoke':
            return await this.revoke(interaction, parsed.userId);
          case 'card':
            return await this.card(interaction, parsed.userId, false);
          case 'list':
            return await this.list(interaction, parsed.userId);
          case 'vc':
            return await this.vcList(interaction, parsed.userId);
        }
      }
    } catch (err) {
      logger.error({ err, id: interaction.id }, 'interaction failed');
      if (interaction.isRepliable()) {
        const msg = { content: '申し訳ありません、うまく処理できませんでした。時間をおいてもう一度お試しください。' };
        await (interaction.deferred || interaction.replied
          ? interaction.followUp({ ...msg, flags: MessageFlags.Ephemeral })
          : interaction.reply({ ...msg, flags: MessageFlags.Ephemeral })
        ).catch(() => undefined);
      }
    }
  }

  async onMessage(message: Message): Promise<void> {
    await this.onActivity(message.guildId, message.author.id, message.author.bot);
    if (message.guildId === this.cfg.guildId && !message.author.bot) {
      this.messageCounts.set(message.author.id, (this.messageCounts.get(message.author.id) ?? 0) + 1);
    }
    // 自己紹介（#絵馬-男性 など）には何も付けない（ひな形がいちばん下に出るだけ。2026-09 に御朱印帳ボタンをやめた）
  }

  private async fetchMember(interaction: Repliable, userId: string): Promise<GuildMember | undefined> {
    return interaction.guild.members.fetch(userId).catch(() => undefined);
  }

  private async reply(interaction: Repliable, body: Reply, ephemeral = true): Promise<void> {
    const payload = { ...body, allowedMentions: NO_MENTIONS };
    if (interaction.deferred) {
      await interaction.editReply(payload);
    } else {
      await interaction.reply({ ...payload, ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}) });
    }
  }

  private async give(interaction: Repliable, receiverId: string): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const receiver = await this.fetchMember(interaction, receiverId);

    // 同じ相手への処理は 1 つずつ（昇格の二重発表を防ぐ）
    const outcome = await this.lock.run(receiverId, async () => {
      const giver = toInfo(interaction.member);
      const result = await giveFlow(this.db, this.cfg, giver, receiver && toInfo(receiver));
      if (result.kind === 'given' && result.promotion && receiver) {
        await this.promoteIfNeeded(receiver, result.goen);
      }
      return result;
    });

    await this.reply(interaction, giveReply(receiverId, outcome));
    if (outcome.kind === 'given') {
      await this.log(giveLog(interaction.user.id, outcome.giverRank, receiverId, outcome.weight, outcome.goen));
    }
  }

  private async revoke(interaction: Repliable, receiverId: string): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await this.lock.run(receiverId, () => revokeFlow(this.db, interaction.user.id, receiverId));
    await this.reply(interaction, revokeReply(receiverId, result));
    if (result.status === 'revoked') {
      await this.log(revokeLog(interaction.user.id, receiverId, result.weight, result.goen));
    }
  }

  /** 通話のチャットのボタン: 今同じ通話にいる人を並べる（自分が入っている通話。いなければボタンの通話） */
  private async vcList(interaction: ButtonInteraction<'cached'>, channelId: string): Promise<void> {
    const channel = interaction.member.voice.channel ?? interaction.guild.channels.cache.get(channelId);
    const others = channel?.isVoiceBased() ? [...channel.members.values()].filter((m) => !m.user.bot && m.id !== interaction.user.id) : [];
    const stamped = await stampedBy(this.db, interaction.user.id, others.map((m) => m.id));
    const people = others
      .map((m) => ({ id: m.id, name: m.displayName, stamped: stamped.has(m.id) }))
      // まだ押していない人を先に
      .sort((a, b) => Number(a.stamped) - Number(b.stamped));
    await interaction.reply({ ...vcList(people, others.length), flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS });
  }

  private async card(interaction: Repliable, ownerId: string, isPublic: boolean): Promise<void> {
    await interaction.deferReply(isPublic ? {} : { flags: MessageFlags.Ephemeral });
    const owner = await this.fetchMember(interaction, ownerId);
    if (!owner) {
      await this.reply(interaction, { content: 'その方は咲楽ノ宮にいらっしゃらないようです。' });
      return;
    }
    // 表示のついでに昇格漏れ（BOT 停止中・ロール付与の失敗など）を直す
    await this.lock.run(ownerId, () => this.ensurePromotion(owner));

    const [data, wallet] = await Promise.all([goshuinchoOf(this.db, ownerId), walletOf(this.db, ownerId)]);
    const e = this.cfg.economy;
    await this.reply(
      interaction,
      goshuinchoReply(
        this.cfg.ranks,
        {
          id: owner.id,
          displayName: owner.displayName,
          avatarUrl: owner.displayAvatarURL({ size: 128 }),
          roleIds: [...owner.roles.cache.keys()],
        },
        data,
        { emoji: e.currencyEmoji, name: e.currencyName, balance: wallet.balance },
      ),
    );
  }

  private async list(interaction: Repliable, ownerId: string): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const [givers, total] = await Promise.all([giversOf(this.db, ownerId, 100), receivedCountOf(this.db, ownerId)]);
    await this.reply(interaction, giversReply(ownerId, givers, total));
  }

  private async ensurePromotion(member: GuildMember): Promise<void> {
    await this.promoteIfNeeded(member, await goenOf(this.db, member.id));
  }

  /**
   * 昇格が必要なら行う。
   * ロールの付け替えはキャッシュにすぐ反映されないことがあるため、
   * 昇格しそうなときだけ Discord から最新のロールを取り直して確かめる（二重昇格・二重発表を防ぐ）。
   */
  private async promoteIfNeeded(member: GuildMember, goen: number): Promise<void> {
    if (!decidePromotion(this.cfg.ranks, member.roles.cache.keys(), goen)) return;
    const fresh = await member.guild.members.fetch({ user: member.id, force: true }).catch(() => undefined);
    if (!fresh) return;
    const promotion = decidePromotion(this.cfg.ranks, fresh.roles.cache.keys(), goen);
    if (promotion) await this.promote(fresh, promotion, goen);
  }

  /** 役職ロールを付け替えて #慶事 で発表する */
  private async promote(member: GuildMember, promotion: Promotion, goen: number): Promise<void> {
    const reason = `ご縁 ${goen} で ${promotion.to.name} に昇格`;
    try {
      await member.roles.add(promotion.to.roleId, reason);
    } catch (err) {
      // BOT のロールが役職ロールより下にある、権限がない など
      logger.error({ err, userId: member.id, to: promotion.to.key }, 'promotion role update failed');
      await this.log(`⚠️ ${member} さまの昇格（${promotion.to.name}）でロールを変更できませんでした。BOT のロールの位置と権限を確認してください。`);
      return;
    }
    // 新しい役職は付いた。古い役職を外せなくても、昇格の発表と記録はする（あとから手で外せばよい）
    if (promotion.removeRoleIds.length) {
      await member.roles.remove(promotion.removeRoleIds, reason).catch(async (err) => {
        logger.warn({ err, userId: member.id }, 'old rank role removal failed');
        await this.log(`⚠️ ${member} さまの前の役職ロールを外せませんでした。手で外してください。`);
      });
    }
    await this.send(this.cfg.channels.keiji, promotionAnnouncement(member.id, promotion, goen), [member.id]);
    await this.log(promotionLog(member.id, promotion, goen));
    await recordPromotion(this.db, member.id, promotion.from.key, promotion.to.key, goen).catch((err) =>
      logger.warn({ err }, 'recordPromotion failed'),
    );
    // お参り期間中なら完了にする
    await setOmairiStatus(this.db, member.id, 'promoted', 'system').catch((err) => logger.warn({ err }, 'omairi close failed'));
  }

  private async log(content: string): Promise<void> {
    const id = this.cfg.channels.log;
    if (id) await this.send(id, content);
  }

  private async send(channelId: string, content: string, pingUserIds: string[] = []): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (channel?.isSendable()) {
        await channel.send({ content, allowedMentions: { parse: [], users: pingUserIds } });
      } else {
        logger.warn({ channelId }, 'channel is not sendable');
      }
    } catch (err) {
      logger.warn({ err, channelId }, 'send failed');
    }
  }
}

import { promotionHold, rankMutation, runUjikoDemotions } from '../services/ujikoDemotion.js';
import { eligibleVisitMembers, recordVisitMinute } from '../services/visitProfile.js';
import { ReturnerRoles } from './returnerRoles.js';
import { pingRoleIds } from '../services/notify.js';
import { saveVoiceNow } from '../services/meetings.js';
import { recordCoreTime } from '../services/coreTimeAttendance.js';
import { recordBoostTime } from '../services/boostTimes.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type PartialGuildMember,
  type Interaction,
  type Message,
  type MessageCreateOptions,
  type UserContextMenuCommandInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { channelPosters, posterPage, type Poster } from '../services/posters.js';
import { SHUIN_PICK_ID } from '../services/notices.js';
import { awardLongVoiceBonuses, notifyLongVoiceBonuses } from '../services/longVoiceBonus.js';
import { isEvaluationUnmuted } from '../domain/voiceEvaluation.js';
import { isEngawaName, recordPresence } from '../services/voiceUsage.js';
import { ujikoEvaluation } from '../services/ujikoEvaluation.js';
import { issueInitialCurrency } from '../services/initialCurrency.js';
import { autoRanks } from '../domain/ranks.js';
import { reconcileInviteRewards, rewardInviteRanks } from '../services/invites.js';
import { genderOfRoles } from '../services/admission.js';
import { CONTACT_LEVEL_EMOJI, CONTACT_LEVEL_LABEL, contactOfRoles } from '../services/contact.js';
import { introOf, introUrl } from '../services/intros.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { currentAutoRank, decidePromotion, highestRank, voiceCapPercentOf, voicePercentOf, type Promotion } from '../domain/ranks.js';
import { emaStepFrom, EMA_PROMOTION_BURST, EMA_TIER_LABEL } from '../domain/ema.js';
import { w, isMusubiMode } from '../domain/terms.js';
import { collectEmaKeepWarnings, emaPromotable, emaPromotionEnabled, emaStepProgress } from '../services/emaPromotion.js';
import { ujikoProgress } from '../services/ujikoRequirement.js';
import { candidateStatus, closeDueSewayakuElections, currentElectionOf, finishSewayakuElection, hasSewayakuVote, listSewayakuElections, openSewayakuElections, scheduleSewayakuElections, setSewayakuElectionMessage, toggleSewayakuVote, voterStatus } from '../services/sewayakuElection.js';
import { grantGoenPerks } from '../services/goenPerks.js';
import { KeyedLock } from '../lib/lock.js';
import { logger } from '../lib/logger.js';
import { giveFlow, revokeFlow, type MemberInfo } from '../services/flows.js';
import { addHourlyActivity, addMessageCounts, eligibleVoiceMembers, voiceTick } from '../services/activity.js';
import { walletOf } from '../services/economy.js';
import { ticketsOf } from '../services/tickets.js';
import { customHoldingsOf } from '../services/customTickets.js';
import { allTicketsLine } from './gacha.js';
import { listPrizes } from '../services/gacha.js';
import { activeCoreTime, coreTimeBonus } from '../services/coreTime.js';
import { setOmairiStatus } from '../services/applications.js';
import { ActivityTracker, getMember, leaveNotice, namesOf, recordJoin, recordLeave, recordPromotion, syncAllMembers, upsertMember, type MemberSnapshot } from '../services/members.js';
import { giversOf, goenOf, goshuinchoOf, metCollection, newSystemStartedAt, receivedCountOf, stampedBy } from '../services/shuin.js';
import { checkGiveEma, giveEma, emaMessagesOf, validEmaCountOf } from '../services/ema.js';
import { takeUncheckedSpecialGoen } from '../services/specialGoen.js';
import { COMMAND, parseEmaId, parseShuinId } from './ids.js';
import {
  emaGiveReply,
  emaModal,
  giveLog,
  giveReply,
  giversReply,
  goshuinchoReply,
  type ProfileExtra,
  promotionAnnouncement,
  promotionBurstAnnouncement,
  sewayakuInfoReply,
  type SewayakuCardInfo,
  type CardMode,
  sewayakuElectionPost,
  sewayakuElectionResultPost,
  sewayakuVoteReply,
  promotionLog,
  revokeLog,
  revokeReply,
  vcList,
  type Reply,
} from './views.js';

const NO_MENTIONS = { parse: [] as const };

type Repliable = ChatInputCommandInteraction<'cached'> | UserContextMenuCommandInteraction<'cached'> | ButtonInteraction<'cached'> | StringSelectMenuInteraction<'cached'>;

/** 「🌸 朱印を押す」ボタン（#絵馬 のひな形など）: そのチャンネルに投稿している人から選ぶ欄・ページ送り */
const SHUIN_PICK_ONE_ID = 'shuin:pickone';
const SHUIN_PICK_PAGE_PREFIX = 'shuin:pickpage:';
/** 投稿した人を探すときに読む最近のメッセージ（100 件 × この回数） */
const POSTER_PAGES = 5;

/** 選ぶ欄とページ送り（本人にだけ） */
export function posterPicker(list: Poster[], page: number) {
  if (!list.length) return { content: w('🌸 このチャンネルには、まだ朱印を押せる人の投稿がありません。', '🧵 このチャンネルには、まだ結べる人の投稿がありません。'), components: [] };
  const p = posterPage(list, page);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(SHUIN_PICK_ONE_ID)
    .setPlaceholder(w('朱印を押す相手', '結ぶ相手'))
    .addOptions(p.items.map((x) => ({ label: x.name.slice(0, 100) || x.id, value: x.id })));
  const nav =
    p.pages > 1
      ? [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`${SHUIN_PICK_PAGE_PREFIX}${p.page - 1}`)
              .setLabel('◀ 前')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(p.page === 0),
            new ButtonBuilder()
              .setCustomId(`${SHUIN_PICK_PAGE_PREFIX}${p.page + 1}`)
              .setLabel('次 ▶')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(p.page >= p.pages - 1),
          ),
        ]
      : [];
  return {
    content: `${w('🌸 朱印を押す相手', '🧵 結ぶ相手')}を選んでください（このチャンネルに投稿している ${list.length} 人・新しく投稿した順${p.pages > 1 ? `・${p.page + 1}/${p.pages} ページ` : ''}）。`,
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu), ...nav],
  };
}

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
  private readonly returnerRoles: ReturnerRoles;
  /** 発言数（1 分ごとにまとめて DB へ） */
  private messageCounts = new Map<string, number>();

  constructor(
    private readonly client: Client,
    private readonly db: Db,
    cfg: GuildConfig | (() => GuildConfig),
  ) {
    this.activity = new ActivityTracker(db);
    this.returnerRoles = new ReturnerRoles(db);
    this.getCfg = typeof cfg === 'function' ? cfg : () => cfg;
  }

  /** 管理画面で設定が変わると中身が入れ替わる（ConfigStore） */
  private readonly getCfg: () => GuildConfig;
  private get cfg(): GuildConfig {
    return this.getCfg();
  }

  // ───────── メンバーの同期（管理画面用） ─────────

  async syncAll(guildMembers: Iterable<GuildMember>): Promise<void> {
    const all = [...guildMembers];
    const result = await syncAllMembers(this.db, all.map(toSnapshot));
    logger.info(result, 'members synced');
    await this.returnerRoles.sync(all.filter(m => m.guild.id === this.cfg.guildId)).catch(err => logger.warn({ err }, 'returner roles sync failed'));
    const guild = all[0]?.guild;
    if (guild) await this.reconcileInviteRewards(guild);
  }

  async onMemberAdd(m: GuildMember): Promise<void> {
    if (m.guild.id !== this.cfg.guildId) return;
    try {
      const kind = await recordJoin(this.db, toSnapshot(m));
      if (kind === 'rejoin') await this.returnerRoles.onDetected(m);
    } catch (err) { logger.error({ err }, 'recordJoin failed'); }
  }

  async onMemberRemove(guildId: string, userId: string): Promise<void> {
    if (guildId !== this.cfg.guildId) return;
    const before = await getMember(this.db, userId).catch(() => undefined);
    await recordLeave(this.db, userId).catch((err) => logger.error({ err }, 'recordLeave failed'));
    // 🚪 抜けた人を #記録 にすぐ出す（BOT はのぞく）
    const log = this.cfg.channels.log;
    if (!log || !before || before.isBot) return;
    const rank = highestRank(this.cfg.ranks, before.roleIds);
    try {
      const ch = await this.client.channels.fetch(log);
      if (ch?.isSendable()) await ch.send(leaveNotice(before, rank ? `${rank.emoji}${rank.name}` : undefined));
    } catch (err) {
      logger.warn({ err }, 'leave notice failed');
    }
  }

  async onMemberUpdate(m: GuildMember, old?: GuildMember | PartialGuildMember): Promise<void> {
    if (m.guild.id !== this.cfg.guildId) return;
    await upsertMember(this.db, toSnapshot(m)).catch((err) => logger.error({ err }, 'upsertMember failed'));
    await this.returnerRoles.onMemberUpdate(m).catch(err => logger.warn({ err }, 'returner role retry failed'));
    const cfg = this.cfg;
    const visitor = autoRanks(cfg.ranks)[0];
    if (!m.user.bot && visitor && m.roles.cache.has(visitor.roleId) && (!old || !old.roles.cache.has(visitor.roleId))) {
      await issueInitialCurrency(this.db, cfg, {
        sendDm: async (_id, content) => { await m.send({ content, allowedMentions: { parse: [] } }); return true; },
        sendMessage: async (channelId, body) => {
          const ch = await this.client.channels.fetch(channelId);
          if (!ch?.isSendable()) throw new Error('初期通貨のお知らせ先に投稿できません。');
          const sent = await ch.send({ content: body.content ?? undefined, allowedMentions: { parse: [] } });
          return { id: sent.id };
        },
      }, m.id).catch((err) => logger.error({ err }, 'initial currency failed'));
    }
    await this.rewardInvites(m);
  }

  private inviteRewardContext() {
    return { db: this.db, cfg: this.cfg, discord: {
      sendDm: async (id: string, content: string) => { const user = await this.client.users.fetch(id); await user.send({ content, allowedMentions: { parse: [] as never[] } }); return true; },
      sendMessage: async (channelId: string, body: { content?: string }) => {
        const ch = await this.client.channels.fetch(channelId);
        if (!ch?.isSendable()) throw new Error('招待報酬の記録先に投稿できません。');
        const message = await ch.send({ content: body.content ?? undefined, allowedMentions: { parse: [] } });
        return { id: message.id };
      },
    } };
  }

  private async rewardInvites(m: GuildMember): Promise<void> {
    await rewardInviteRanks(this.inviteRewardContext(), m.id, [...m.roles.cache.keys()])
      .catch((err) => logger.warn({ err }, 'invite rank reward failed'));
  }

  private checkingInviteRewards = false;

  /** 起動時と10分ごと。未払いは現在の役職・在籍を取り直してから確認する。 */
  async reconcileInviteRewards(guild: Guild): Promise<void> {
    if (guild.id !== this.cfg.guildId || this.checkingInviteRewards) return;
    this.checkingInviteRewards = true;
    try {
      // もうサーバーにいない人（Unknown Member）は、抜けた扱いにして飛ばす（毎回エラーにしない）
      const fetchOrLeft = async (userId: string) => {
        try { return await guild.members.fetch({ user: userId, force: true }); }
        catch (err) {
          if ((err as { code?: number }).code !== 10007) throw err;
          await recordLeave(this.db, userId);
          return undefined;
        }
      };
      await reconcileInviteRewards(this.inviteRewardContext(), async (id, inviterId) => {
        const [member, inviter] = await Promise.all([fetchOrLeft(id), fetchOrLeft(inviterId)]);
        if (!member || !inviter) return undefined;
        await upsertMember(this.db, toSnapshot(member), { leftAt: null });
        await upsertMember(this.db, toSnapshot(inviter), { leftAt: null });
        return [...member.roles.cache.keys()];
      });
    } finally { this.checkingInviteRewards = false; }
  }

  /** 1 分ごと: 発言数を書き込み、通話している人に通話時間と花びらを足す */
  private voiceNowTimer?: NodeJS.Timeout;
  /** 通話に出入りしたら、少し待って（まとめて）「いま通話にいる人」を残す。社務所Web のホームにすぐ出す */
  voiceChanged(guild: Guild): void {
    if (guild.id !== this.cfg.guildId) return;
    clearTimeout(this.voiceNowTimer);
    this.voiceNowTimer = setTimeout(() => {
      const channels = [...guild.channels.cache.values()]
        .filter((c) => c.isVoiceBased() && c.id !== guild.afkChannelId)
        .map((c) => ({ id: c.id, name: c.name, memberIds: c.isVoiceBased() ? [...c.members.values()].filter((m) => !m.user.bot).map((m) => m.id) : [] }));
      void saveVoiceNow(this.db, channels).catch((err) => logger.warn({ err }, 'voice now save failed'));
    }, 3000);
  }

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
    // 通話の記録（浮上時間）: AFK 以外の通話にいる人（BOT をのぞく）。1 人でも記録する
    const presence = [...guild.channels.cache.values()]
      .filter((c) => c.isVoiceBased() && c.id !== guild.afkChannelId)
      .map((c) => ({
        id: c.id,
        name: c.name,
        categoryId: c.parentId ?? null,
        categoryName: c.parent?.name ?? null,
        memberIds: c.isVoiceBased() ? [...c.members.values()].filter((m) => !m.user.bot).map((m) => m.id) : [],
        sanpaishaMemberIds: c.isVoiceBased() ? [...c.members.values()].filter((m) => !m.user.bot && highestRank(this.cfg.ranks, m.roles.cache.keys())?.key === 'sanpaisha').map((m) => m.id) : [],
        evaluationEligibleMemberIds: c.isVoiceBased() ? [...c.members.values()].filter(m => !m.user.bot && isEvaluationUnmuted(m.voice)).map(m => m.id) : [],
      }));
    await recordPresence(this.db, presence, now).catch((err) => logger.warn({ err }, 'voice presence record failed'));
    await this.checkEvaluationPromotions(guild, now).catch(err => logger.warn({ err }, 'evaluation promotion check failed'));
    await this.checkGoenPerks(guild, now).catch(err => logger.warn({ err }, 'goen perk check failed'));
    await this.checkEmaKeep(guild, now).catch(err => logger.warn({ err }, 'ema keep check failed'));
    await this.checkSewayakuElection(guild, now).catch(err => logger.warn({ err }, 'sewayaku election check failed'));
    await awardLongVoiceBonuses(this.db, this.cfg, now).catch(err => logger.warn({ err }, 'long voice bonus tick failed'));
    await notifyLongVoiceBonuses(this.db, this.cfg, { sendMessage: async (channelId, body) => {
      const ch = await this.client.channels.fetch(channelId);
      if (!ch?.isSendable()) throw new Error('浮上ボーナスの通知先に投稿できません。');
      const message = await ch.send({ content: body.content ?? undefined, allowedMentions: { parse: [], users: body.allowed_mentions?.users ?? [] } });
      return { id: message.id };
    } }, now).catch(err => logger.warn({ err }, 'long voice bonus notices failed'));
    // 浮上の時間帯（1 時間ごと）: この 1 分の発言と、通話にいる人
    const engawaPresence = presence.filter((c) => isEngawaName(c.name));
    await addHourlyActivity(this.db, counts, new Set(presence.flatMap((c) => c.memberIds)), now,
      new Set(engawaPresence.flatMap((c) => c.memberIds)),
      new Set(engawaPresence.flatMap((c) => c.evaluationEligibleMemberIds ?? [])),
    ).catch((err) => logger.warn({ err }, 'hourly activity failed'));
    // 議事録の「参加した人」を、いま通話にいる人から入れられるように
    await saveVoiceNow(this.db, presence.map((c) => ({ id: c.id, name: c.name, memberIds: c.memberIds })), now).catch((err) => logger.warn({ err }, 'voice now save failed'));

    // 参拝ランクは独立した条件・記録を使う。既存の通貨報酬は変えない。
    const visitChannels = [...guild.channels.cache.values()].filter(c => c.type === ChannelType.GuildVoice).map(c => ({
      id: c.id, name: c.name, categoryName: c.parent?.name,
      members: [...c.members.values()].map(m => ({ id: m.id, bot: m.user.bot, serverMute: Boolean(m.voice.serverMute), deaf: Boolean(m.voice.deaf) })),
    }));
    await recordVisitMinute(this.db, eligibleVisitMembers(visitChannels, excluded), now).catch(err => logger.warn({ err }, 'visit rank record failed'));
    const ids = eligibleVoiceMembers(channels, excluded);
    if (!ids.length) return;
    // ⏰ コアタイムに通話に上がった人を記録（花びらがもらえる人と同じ人）
    await recordCoreTime(this.db, this.cfg.coreTime, ids, now).catch((err) => logger.warn({ err }, 'core time attendance failed'));
    // ⏱ 浮上の記録の時間（社務所Web で作ったもの）にいた分
    const rooms = channels.map((ch) => ({ channelId: ch.id, parentId: guild.channels.cache.get(ch.id)?.parentId ?? null, memberIds: eligibleVoiceMembers([ch], excluded) }));
    await recordBoostTime(this.db, rooms, now).catch((err) => logger.warn({ err }, 'boost time attendance failed'));
    // コアタイム中は、10 分ごとの花びらが増える
    const coreBonus = activeCoreTime(this.cfg.coreTime, now) ? coreTimeBonus(this.cfg.economy) : 0;
    // 役職ごとの倍率（いちばん格の高い役職の %）
    const rolesOf = (id: string) => guild.members.cache.get(id)?.roles.cache.keys() ?? [];
    const percentOf = (id: string) => voicePercentOf(this.cfg.ranks, rolesOf(id));
    const capPercentOf = (id: string) => voiceCapPercentOf(this.cfg.ranks, rolesOf(id));
    const awarded = await voiceTick(this.db, this.cfg.economy, ids, now, { coreBonus, percentOf, capPercentOf }).catch((err) => {
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
        if (interaction.commandName === COMMAND.profileMenu || interaction.commandName === COMMAND.cardMenu) return await this.card(interaction, interaction.targetId, false);
        if (interaction.commandName === COMMAND.giveMenu) return await this.give(interaction, interaction.targetId);
      } else if (interaction.isChatInputCommand() && interaction.commandName === COMMAND.goshuin) {
        const target = interaction.options.getUser('user') ?? interaction.user;
        const isPublic = interaction.options.getBoolean('public') ?? false;
        // ③ON のときは /ご縁帳＝ご縁だけ（まとめは右クリックの「プロフィール」）
        return await this.card(interaction, target.id, isPublic, 'goen');
      } else if (interaction.isChatInputCommand() && interaction.commandName === COMMAND.ema) {
        const target = interaction.options.getUser('user') ?? interaction.user;
        const isPublic = interaction.options.getBoolean('public') ?? false;
        return await this.card(interaction, target.id, isPublic, 'ema');
      } else if (interaction.isChatInputCommand() && interaction.commandName === COMMAND.sewayaku) {
        return await this.sewayakuInfo(interaction);
      } else if (interaction.isButton() && interaction.customId === SHUIN_PICK_ID) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        return void (await interaction.editReply(posterPicker(await this.posters(interaction), 0)));
      } else if (interaction.isButton() && interaction.customId.startsWith(SHUIN_PICK_PAGE_PREFIX)) {
        const page = Number(interaction.customId.slice(SHUIN_PICK_PAGE_PREFIX.length));
        await interaction.deferUpdate();
        return void (await interaction.editReply(posterPicker(await this.posters(interaction), Number.isInteger(page) ? page : 0)));
      } else if (interaction.isStringSelectMenu() && interaction.customId === SHUIN_PICK_ONE_ID) {
        const target = interaction.values[0];
        if (target) return await this.give(interaction, target);
      } else if (interaction.isButton() && interaction.customId.startsWith('ema:')) {
        const parsed = parseEmaId(interaction.customId);
        if (parsed?.kind === 'give') return await this.emaGive(interaction, parsed.userId);
        if (parsed?.kind === 'vote') return await this.sewayakuVote(interaction, parsed.userId);
        if (parsed?.kind === 'card') return await this.card(interaction, parsed.userId, false, 'ema');
      } else if (interaction.isModalSubmit() && interaction.customId.startsWith('ema:')) {
        const parsed = parseEmaId(interaction.customId);
        if (parsed?.kind === 'modal') return await this.emaSubmit(interaction, parsed.userId);
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
          case 'unmet':
            return await this.unmetPick(interaction, parsed.userId);
          case 'goen':
            return await this.card(interaction, parsed.userId, false, 'goen');
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

  /** このチャンネルに投稿している人（最近のメッセージ・自己紹介の記録。1 分だけ覚える） */
  private readonly posterCache = new Map<string, { at: number; recent: { authorId: string; at: number }[] }>();
  private async posters(interaction: ButtonInteraction<'cached'>): Promise<Poster[]> {
    const channel = interaction.channel;
    const hit = this.posterCache.get(interaction.channelId);
    let recent = hit && Date.now() - hit.at < 60_000 ? hit.recent : undefined;
    if (!recent) {
      recent = [];
      if (channel && 'messages' in channel) {
        let before: string | undefined;
        for (let n = 0; n < POSTER_PAGES; n++) {
          const batch = [...(await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => new Map())).values()] as Message[];
          for (const m of batch) if (!m.author.bot) recent.push({ authorId: m.author.id, at: m.createdTimestamp });
          if (batch.length < 100) break;
          before = batch.at(-1)!.id;
        }
      }
      this.posterCache.set(interaction.channelId, { at: Date.now(), recent });
    }
    return channelPosters(this.db, interaction.channelId, recent, interaction.user.id);
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
      await this.log(giveLog(interaction.user.id, outcome.giverRank, receiverId, outcome.weight, outcome.goen, outcome.addedGoen));
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
    const giverRank = highestRank(this.cfg.ranks, toInfo(interaction.member).roleIds);
    // 🧵 新制度の結びは1回きり（押し直しなし）なので、取り消していなければ「結んだ」（✅）。旧御朱印は今の格で押したものだけ ✅
    const musubi = Boolean(await newSystemStartedAt(this.db));
    const stamped = await stampedBy(this.db, interaction.user.id, others.map((m) => m.id), musubi ? 0 : giverRank?.weight ?? 0);
    const people = others
      .map((m) => ({ id: m.id, name: m.displayName, stamped: stamped.has(m.id) }))
      // まだ押していない人を先に
      .sort((a, b) => Number(a.stamped) - Number(b.stamped));
    await interaction.reply({ ...vcList(people, others.length), flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS });
  }

  /** 🎐 「絵馬を贈る」ボタン: 氏子以上・条件を満たしていれば一言のモーダルを出す。だめなら理由を出す */
  private async emaGive(interaction: ButtonInteraction<'cached'>, receiverId: string): Promise<void> {
    // 🎐 絵馬は③（絵馬での昇格）が ON になるまで使わない（前に出したボタンが残っていても）
    if (!(await emaPromotionEnabled(this.db))) return void (await interaction.reply({ content: '🎐 絵馬は、新制度が始まってからです。', flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS }));
    const check = await checkGiveEma(this.db, this.cfg, interaction.user.id, receiverId);
    if (!check.ok) {
      await interaction.reply({ ...emaGiveReply(receiverId, check), flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS });
      return;
    }
    const receiver = await this.fetchMember(interaction, receiverId);
    await interaction.showModal(emaModal(receiverId, receiver?.displayName ?? 'その方'));
  }

  /** 🎐 絵馬の一言のモーダルを受けて贈る（匿名・1 人 1 枚・贈り直し可） */
  private async emaSubmit(interaction: ModalSubmitInteraction<'cached'>, receiverId: string): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!(await emaPromotionEnabled(this.db))) return void (await interaction.editReply({ content: '🎐 絵馬は、新制度が始まってからです。', allowedMentions: NO_MENTIONS }));
    const message = interaction.fields.getTextInputValue('message');
    const result = await this.lock.run(receiverId, () => giveEma(this.db, this.cfg, interaction.user.id, receiverId, message));
    if (result.ok) await this.log(`🎐 絵馬 <@${interaction.user.id}> → <@${receiverId}>（${EMA_TIER_LABEL[result.tier]}・${result.created ? '新規' : '贈り直し'}・票 ${result.count}）`);
    await interaction.editReply({ ...emaGiveReply(receiverId, result), allowedMentions: NO_MENTIONS });
    // 🎐 絵馬での昇格が ON なら、必要枚数に届いた相手をすぐ昇格させる（次の見回りを待たない）。
    // emaPromote の中で、相手の今の役職に応じた票の種類と必要枚数を確かめる。
    if (result.ok && (await emaPromotionEnabled(this.db))) {
      const receiver = await interaction.guild.members.fetch(receiverId).catch(() => undefined);
      if (receiver) await this.lock.run(receiverId, () => this.emaPromote(receiver)).catch((err) => logger.warn({ err, receiverId }, 'ema promote after give failed'));
    }
  }

  /** 🗳 世話役の選挙の投票（ご縁帳のボタン）。押すと投票・もう一度で取り消し。匿名なので #記録 にも出さない */
  private async sewayakuVote(interaction: ButtonInteraction<'cached'>, candidateId: string): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!(await emaPromotionEnabled(this.db))) {
      await interaction.editReply({ content: '世話役の選挙は、新制度が始まってからです。', allowedMentions: NO_MENTIONS });
      return;
    }
    const result = await toggleSewayakuVote(this.db, this.cfg, interaction.user.id, candidateId);
    await interaction.editReply({ ...sewayakuVoteReply(candidateId, result, this.cfg.emaThresholds), allowedMentions: NO_MENTIONS });
  }

  /** 🗳 /世話役の投票：投票中・これからの選挙と、自分が投票できるか（自分にだけ表示） */
  private async sewayakuInfo(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!(await emaPromotionEnabled(this.db))) {
      await interaction.editReply({ content: '🗳 世話役の選挙は、新制度が始まってからです。', allowedMentions: NO_MENTIONS });
      return;
    }
    const [elections, voter] = await Promise.all([listSewayakuElections(this.db, ['open', 'scheduled']), voterStatus(this.db, this.cfg, interaction.user.id)]);
    const me = interaction.user.id;
    const open = await Promise.all(
      elections.filter((e) => e.status === 'open').map(async (e) => ({
        candidateId: e.candidateId,
        endsAt: e.endsAt,
        canVote: (e.voterIds ?? []).includes(me),
        voted: await hasSewayakuVote(this.db, e.id, me),
      })),
    );
    const scheduled = elections.filter((e) => e.status === 'scheduled').map((e) => ({ candidateId: e.candidateId, startsAt: e.startsAt, endsAt: e.endsAt }));
    await interaction.editReply({ ...sewayakuInfoReply(open, scheduled, voter, this.cfg.emaThresholds), allowedMentions: NO_MENTIONS });
  }

  private checkingSewayaku = false;
  private lastSewayakuScan = 0;
  /**
   * 🗳 世話役の選挙の見回り（「絵馬での昇格」が ON のときだけ）。
   * - 10分ごと：条件を満たした氏子の選挙を決める（その週か次の週の金・土・日）。
   * - 毎分：金曜0時をすぎた選挙をはじめて #慶事 で知らせる／月曜0時をすぎた選挙を締め、票が投票できる人の6割を超えたら世話役にする。
   * 結果（票の数と投票できる人の数だけ。だれが投票したかは出さない）を #記録 に残す。落ちたことは #慶事 には出さない。
   */
  async checkSewayakuElection(guild: Guild, now = new Date()): Promise<void> {
    if (guild.id !== this.cfg.guildId || this.checkingSewayaku) return;
    this.checkingSewayaku = true;
    try {
      if (!(await emaPromotionEnabled(this.db))) return;
      const th = this.cfg.emaThresholds;
      const day = (d: Date) => d.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short' });
      if (now.getTime() - this.lastSewayakuScan >= 10 * 60_000) {
        this.lastSewayakuScan = now.getTime();
        for (const e of await scheduleSewayakuElections(this.db, this.cfg, now)) {
          await this.log(`🗳 世話役の選挙が決まりました：<@${e.candidateId}>（${day(e.startsAt)}〜${day(new Date(e.endsAt.getTime() - 1))}）`);
        }
      }
      for (const e of await openSewayakuElections(this.db, this.cfg, now)) {
        const channelId = this.sewayakuElectionChannel(guild);
        const msg = channelId ? await this.sendAndGet(channelId, sewayakuElectionPost(e.candidateId, e.endsAt, e.voterIds?.length ?? 0, th)) : undefined;
        if (channelId && msg) await setSewayakuElectionMessage(this.db, e.id, channelId, msg.id);
        await this.log(`🗳 世話役の選挙をはじめました：<@${e.candidateId}>（投票できる人 ${e.voterIds?.length ?? 0} 人）${channelId ? ` <#${channelId}>` : ''}`);
      }
      const to = this.cfg.ranks.find((r) => r.key === 'sewayaku');
      for (const c of await closeDueSewayakuElections(this.db, this.cfg, now)) {
        const id = c.election.candidateId;
        let ok = false;
        if (c.passes && to) {
          const fresh = await guild.members.fetch({ user: id, force: true }).catch(() => undefined);
          const current = fresh ? currentAutoRank(this.cfg.ranks, fresh.roles.cache.keys()) : undefined;
          if (fresh && !fresh.user.bot && current?.key === 'ujiko' && highestRank(this.cfg.ranks, fresh.roles.cache.keys())?.key === 'ujiko') {
            const held = new Set(fresh.roles.cache.keys());
            const removeRoleIds = autoRanks(this.cfg.ranks).filter((x) => x.key !== to.key && held.has(x.roleId)).map((x) => x.roleId);
            ok = await this.lock.run(id, async () => this.promote(fresh, { from: current, to, removeRoleIds }, await goenOf(this.db, fresh.id), undefined, { vote: { votes: c.votes, voters: c.voters } }))
              .catch((err) => { logger.warn({ err, memberId: id }, 'sewayaku election promotion failed'); return false; });
          }
        }
        await finishSewayakuElection(this.db, c.election.id, ok ? 'passed' : 'failed', now);
        // #世話役選挙 の投稿を結果に書きかえる（ボタンを外す。届かなかったときは票の数を出さない）
        if (c.election.channelId && c.election.messageId) {
          const ch = await this.client.channels.fetch(c.election.channelId).catch(() => null);
          if (ch?.isTextBased?.() && 'messages' in ch) {
            const m = await ch.messages.fetch(c.election.messageId).catch(() => undefined);
            await m?.edit(sewayakuElectionResultPost(id, ok, c.votes, c.voters)).catch((err) => logger.warn({ err, electionId: c.election.id }, 'sewayaku election post edit failed'));
          }
        }
        await this.log(
          `🗳 世話役の選挙を締めました：<@${id}> ${c.votes} 票／投票できる人 ${c.voters} 人（${th.sewayakuVotePercent}% を超えたら昇格）→ ${ok ? '世話役に昇格' : c.passes ? '票は届いたが昇格できず（役職を確かめてください）' : c.voters < th.sewayakuMinVoters ? `不成立（投票できる人が ${th.sewayakuMinVoters} 人未満）` : `届かず（縁側 ${Math.floor(th.sewayakuRetryMinutes / 60)} 時間でまた候補）`}`,
        );
      }
    } finally { this.checkingSewayaku = false; }
  }

  /** 🧵 まだ結んでいない人（結びのコレクション）: 自分のプロフィールから。選ぶと結べる（SHUIN_PICK_ONE で give） */
  private async unmetPick(interaction: ButtonInteraction<'cached'>, viewerId: string): Promise<void> {
    if (interaction.user.id !== viewerId) {
      await interaction.reply({ content: w('🧵 「まだ結んでいない人」は、ご自身のプロフィール（御朱印帳）から見てください。', '🧵 「まだ結んでいない人」は、ご自身のご縁帳から見てください。'), flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    // 結びは④（新制度のご縁の時代）が始まってから（前に出したボタンが残っていても）
    if (!isMusubiMode()) return void (await interaction.editReply({ content: '🧵 結びは、新制度が始まってからです。', components: [] }));
    const { total, met, unmet } = await metCollection(this.db, viewerId);
    if (!total) return void (await interaction.editReply({ content: '🧵 まだ通話でいっしょになった方がいません。通話でいっしょに過ごした方が、ここに出ます。', components: [] }));
    if (!unmet.length) {
      await interaction.editReply({ content: `🧵 通話でいっしょになったみなさんと結びました（${met} / ${total} 人・コンプリート！）。`, components: [] });
      return;
    }
    const menu = new StringSelectMenuBuilder()
      .setCustomId(SHUIN_PICK_ONE_ID)
      .setPlaceholder('結ぶ相手をえらぶ')
      .addOptions(unmet.map((x) => ({ label: x.name.slice(0, 100) || x.id, value: x.id })));
    await interaction.editReply({
      content: `🧵 通話でいっしょになったのに、まだ結んでいない人（いま ${met} / ${total} 人）。最近きた順に ${unmet.length} 人出しています。えらぶと結べます。`,
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    });
  }

  private async card(interaction: Repliable, ownerId: string, isPublic: boolean, mode: CardMode = 'profile'): Promise<void> {
    await interaction.deferReply(isPublic ? {} : { flags: MessageFlags.Ephemeral });
    const owner = await this.fetchMember(interaction, ownerId);
    if (!owner) {
      await this.reply(interaction, { content: 'その方は咲楽ノ宮にいらっしゃらないようです。' });
      return;
    }
    // 表示のついでに昇格漏れ（BOT 停止中・ロール付与の失敗など）を直す
    await this.lock.run(ownerId, () => this.ensurePromotion(owner));

    // 残高は、自分の御朱印帳を自分だけに見えるように開いたときだけ（ほかの人の残高は見せない）
    const showCoins = interaction.user.id === ownerId && !isPublic;
    // 🎐 絵馬は、その人の「次の段」の票を数える（参拝者=氏子の票／氏子=氏子の票（維持）／世話役=総代の票）
    const ownerStep = emaStepFrom(highestRank(this.cfg.ranks, owner.roles.cache.keys())?.key, this.cfg.emaThresholds);
    const emaTier = ownerStep?.tier ?? 'ujiko';
    const [data, wallet, tickets, emaCount, emaMessages, emaMode] = await Promise.all([
      goshuinchoOf(this.db, ownerId),
      showCoins ? walletOf(this.db, ownerId) : undefined,
      showCoins ? ticketsOf(this.db, ownerId) : undefined,
      validEmaCountOf(this.db, ownerId, undefined, emaTier),
      emaMessagesOf(this.db, ownerId, undefined, emaTier),
      emaPromotionEnabled(this.db),
    ]);
    // 参拝者→氏子は「お参り期間中の票＋招待の補い」と「毎週きまる必要数」で案内する
    const stepProgress = ownerStep && emaMode ? await emaStepProgress(this.db, this.cfg, ownerId, ownerStep) : undefined;
    const emaStepInfo = ownerStep
      ? {
          toName: this.cfg.ranks.find((r) => r.key === ownerStep.to)?.name ?? ownerStep.to,
          need: stepProgress?.need ?? ownerStep.promote,
          have: stepProgress?.count,
          inPeriod: ownerStep.from === 'sanpaisha',
        }
      : undefined;
    // 🗳 氏子：世話役の選挙（候補までの道のり・決まった選挙）。投票は #世話役選挙 の投稿のボタンで
    const ownerKey = highestRank(this.cfg.ranks, owner.roles.cache.keys())?.key;
    let sewayakuInfo: SewayakuCardInfo | undefined;
    if (emaMode && ownerKey === 'ujiko') {
      const [cand, election] = await Promise.all([candidateStatus(this.db, this.cfg, ownerId), currentElectionOf(this.db, ownerId)]);
      sewayakuInfo = { status: cand, ...(election ? { election: { status: election.status, startsAt: election.startsAt, endsAt: election.endsAt } } : {}), showVote: false, voted: false };
    }
    // 参拝者：お参り期間・毎週の数・招待の補いをくわしく／氏子・世話役・総代：世話役の選挙の投票権
    const ujiko = emaMode && ownerKey === 'sanpaisha' ? await ujikoProgress(this.db, this.cfg, ownerId) : undefined;
    const voter = emaMode && (ownerKey === 'ujiko' || ownerKey === 'sewayaku' || ownerKey === 'sodai') ? await voterStatus(this.db, this.cfg, ownerId) : undefined;
    // 次のご縁の節目（ご縁帳）
    const nextPerk = [...this.cfg.goenPerks].sort((a, b) => a.goen - b.goen).find((p) => p.goen > data.goen);
    const perkNext = nextPerk ? { goen: nextPerk.goen, label: nextPerk.label || `${nextPerk.coins} ${this.cfg.economy.currencyName}` } : undefined;
    const ticketText = tickets ? allTicketsLine(tickets, await customHoldingsOf(this.db, ownerId)) : undefined;
    // 🧵 結びのコレクションは自分のプロフィールだけ
    const collection = interaction.user.id === ownerId ? await metCollection(this.db, ownerId) : undefined;
    const e = this.cfg.economy;
    await this.reply(
      interaction,
      goshuinchoReply(
        this.cfg.ranks,
        {
          id: owner.id,
          displayName: owner.displayName,
          avatarUrl: owner.displayAvatarURL({ size: 256 }),
          roleIds: [...owner.roles.cache.keys()],
        },
        data,
        wallet ? { emoji: e.currencyEmoji, name: e.currencyName, balance: wallet.balance } : undefined,
        { ...(await this.profileOf(owner, interaction.user.id === ownerId)), ...(ticketText ? { tickets: ticketText } : {}) },
        {
          count: emaCount, messages: emaMessages, promoteMode: emaMode, th: this.cfg.emaThresholds, tierLabel: EMA_TIER_LABEL[emaTier],
          ...(emaStepInfo ? { step: emaStepInfo } : {}), ...(sewayakuInfo ? { sewayaku: sewayakuInfo } : {}), ...(ujiko ? { ujiko } : {}), ...(voter ? { voter } : {}),
        },
        collection ? { total: collection.total, met: collection.met } : undefined,
        { mode, ...(perkNext ? { perkNext } : {}) },
      ),
    );
  }

  /** プロフィールに出すこと（性別・DM・フレンド・称号・入った日・自己紹介） */
  private async profileOf(owner: GuildMember, self: boolean): Promise<ProfileExtra> {
    const roleIds = [...owner.roles.cache.keys()];
    const gender = genderOfRoles(this.cfg, roleIds);
    const level = (kind: 'dm' | 'friend') => {
      const l = contactOfRoles(this.cfg, kind, roleIds);
      return l ? `${CONTACT_LEVEL_EMOJI[l]} ${CONTACT_LEVEL_LABEL[l]}` : undefined;
    };
    const intro = await introOf(this.db, owner.id).catch(() => undefined);
    // 物御籤の中身の限定ロール（まだ中身を作っていなければ設定の roleIds）
    const prizeRoles = (await listPrizes(this.db).catch(() => [])).flatMap((p) => (p.kind === 'role' && p.roleId ? [p.roleId] : []));
    const gachaRoles = [...new Set([...prizeRoles, ...this.cfg.gacha.roleIds])];
    // バナーは、ユーザーを取り直さないと分からない（なければ出さない）
    let bannerUrl: string | undefined;
    try {
      const user = await owner.user.fetch(true);
      bannerUrl = owner.displayBannerURL?.({ size: 1024 }) ?? user.bannerURL({ size: 1024 }) ?? undefined;
    } catch {
      // 取れなければバナーなし
    }
    return {
      ...(bannerUrl ? { bannerUrl } : {}),
      self,
      ...(gender ? { gender: gender === 'female' ? '♀ 女性' : '♂ 男性' } : {}),
      ...(level('dm') ? { dm: level('dm') } : {}),
      ...(level('friend') ? { friend: level('friend') } : {}),
      titles: [
        ...this.cfg.shop.titles.filter((t) => roleIds.includes(t.roleId)).map((t) => `${t.emoji}${t.name}`),
        // 物御籤限定のロール
        ...gachaRoles
          .filter((id) => roleIds.includes(id))
          .map((id) => owner.guild.roles.cache.get(id)?.name ?? '')
          .filter(Boolean),
      ],
      joinedAt: owner.joinedAt,
      ...(intro ? { intro: { url: introUrl(this.cfg.guildId, intro), excerpt: intro.excerpt } } : {}),
    };
  }

  private async list(interaction: Repliable, ownerId: string): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const [givers, total] = await Promise.all([giversOf(this.db, ownerId, 100), receivedCountOf(this.db, ownerId)]);
    const names = await namesOf(this.db, [ownerId, ...givers.map((g) => g.giverId)]);
    await this.reply(interaction, giversReply(ownerId, givers, total, names));
  }

  private checkingUjikoDemotions = false;
  /** リストで確認された氏子だけを、最新の在籍と役職を見て変更する。 */
  async checkUjikoDemotions(guild: Guild): Promise<void> {
    if (this.checkingUjikoDemotions || guild.id !== this.cfg.guildId) return;
    this.checkingUjikoDemotions = true;
    try {
      await runUjikoDemotions(this.db, this.cfg, {
        fetch: async id => {
          const m = await guild.members.fetch({ user: id, force: true }).catch((e: {code?: number}) => { if(e.code===10007)return null;throw e; });
          return m ? {id:m.id,name:m.displayName,roles:[...m.roles.cache.keys()],bot:m.user.bot,protected:m.id===guild.ownerId||m.permissions.has(8n)} : null;
        },
        add: async(id,role,reason)=>{await (await guild.members.fetch({user:id,force:true})).roles.add(role,reason);},
        remove: async(id,role,reason)=>{await (await guild.members.fetch({user:id,force:true})).roles.remove(role,reason);},
      }, (id,fn)=>this.lock.run(id,fn));
    } finally { this.checkingUjikoDemotions=false; }
  }

  /** 1 分ごと: ✨ 特別ご縁を振られた人の昇格を確かめる（社務所Web から振ったもの） */
  async checkSpecialGoen(guild: Guild): Promise<void> {
    for (const id of await takeUncheckedSpecialGoen(this.db)) {
      const member = await guild.members.fetch(id).catch(() => undefined);
      if (!member || member.user.bot) continue;
      await this.lock.run(id, () => this.ensurePromotion(member)).catch((err) => logger.warn({ err, memberId: id }, 'special goen promotion failed'));
    }
  }

  private async ensurePromotion(member: GuildMember, now = new Date(), alreadyMet = false): Promise<void> {
    // 🎐 絵馬での昇格が ON のときは、絵馬の昇格（emaPromote）で昇格漏れを直す（ご縁では上げない）
    if (await emaPromotionEnabled(this.db)) {
      await this.emaPromote(member, now);
      return;
    }
    await this.promoteIfNeeded(member, await goenOf(this.db, member.id), now, alreadyMet);
  }

  private checkingGoenPerks = false;
  /**
   * 🎁 ご縁の節目特典（新制度⑦）: 絵馬での昇格が ON で、かつ ④ご縁のリセットが済んでから。
   * 節目に届いた人へ銭・称号ロールを 1 回ずつ。
   * リセット前に動くと、旧制度のご縁で特典が一斉に払われ、受け取り記録も残ってしまうので待つ。
   */
  async checkGoenPerks(guild: Guild, now = new Date()): Promise<void> {
    if (guild.id !== this.cfg.guildId || this.checkingGoenPerks) return;
    if (!(await emaPromotionEnabled(this.db))) return;
    if (!(await newSystemStartedAt(this.db))) return;
    this.checkingGoenPerks = true;
    try {
      const grants = await grantGoenPerks(this.db, this.cfg, now);
      const e = this.cfg.economy;
      for (const g of grants) {
        if (g.roleId) {
          const member = await guild.members.fetch(g.memberId).catch(() => undefined);
          if (member) await member.roles.add(g.roleId, `ご縁 ${g.goen} の特典`).catch((err) => logger.warn({ err, memberId: g.memberId }, 'goen perk role add failed'));
        }
        const parts = [g.coins > 0 ? `${e.currencyEmoji}${g.coins}${e.currencyName}` : '', g.roleId ? g.label || '称号' : ''].filter(Boolean).join('・');
        await this.client.users.fetch(g.memberId).then((u) => u.send({ content: `🎁 ご縁 ${g.goen} に届きました。おめでとうございます！${parts ? `（${parts}）` : ''}`, allowedMentions: { parse: [] as never[] } })).catch(() => undefined);
        await this.log(`🎁 ご縁の節目特典 <@${g.memberId}>（ご縁 ${g.goen}）${parts ? `：${parts}` : ''}`);
      }
    } finally { this.checkingGoenPerks = false; }
  }

  private checkingEmaKeep = false;
  /**
   * 🎐 維持の注意（新制度③⑧）: 絵馬での昇格が ON のときだけ。
   * 氏子の票が維持の枚数を割った氏子（一度は届いたことがある人）へ、本人にやさしくDM＋運営へ記録を、1回ずつ。
   * 自動降格はしない。据え置きで0枚のままの氏子には知らせない。
   */
  async checkEmaKeep(guild: Guild, now = new Date()): Promise<void> {
    if (guild.id !== this.cfg.guildId || this.checkingEmaKeep) return;
    if (!(await emaPromotionEnabled(this.db))) return;
    this.checkingEmaKeep = true;
    try {
      const keep = this.cfg.emaThresholds.ujikoKeep;
      for (const w of await collectEmaKeepWarnings(this.db, this.cfg, now)) {
        await this.client.users
          .fetch(w.id)
          .then((u) => u.send({
            content: `🎐 絵馬（氏子の票）が今 **${w.count} 枚**になりました。氏子でい続けるには **${keep} 枚**あると安心です。また通話でいっしょになった方から絵馬をいただけます。（すぐに降格になるわけではありません）`,
            allowedMentions: { parse: [] as never[] },
          }))
          .catch(() => undefined);
        await this.log(`🎐 維持の注意 <@${w.id}>（氏子の票 ${w.count} 枚・維持 ${keep} 枚）— 本人へお知らせしました（自動降格はしません）。`);
      }
    } finally { this.checkingEmaKeep = false; }
  }

  private checkingEvaluationPromotions = false;
  /** 時間が最後の条件だった人も、追加の朱印操作なしで昇格を確かめる。 */
  async checkEvaluationPromotions(guild: Guild, now = new Date()): Promise<void> {
    if (guild.id !== this.cfg.guildId || this.checkingEvaluationPromotions) return;
    this.checkingEvaluationPromotions = true;
    try {
      // 🎐 絵馬での昇格が ON のときは、昇格を全部「絵馬」で決める（ご縁・縁側時間は使わない）。
      // 参拝者→氏子（お参り期間中・毎週きまる数・招待で補える）／世話役→総代（総代の票）。氏子→世話役は候補ごとの選挙（checkSewayakuElection）。
      if (await emaPromotionEnabled(this.db)) {
        const ids = await emaPromotable(this.db, this.cfg, now);
        // 🌸 切り替えた直後など、いっぺんに大勢が上がるときは、1人ずつの発表で役職の通知を鳴らしつづけない。
        // 発表のカードは1人ずつ出すが通知は付けず、最後に「◯名が昇格」を1回だけ通知する。
        const burst = ids.length > EMA_PROMOTION_BURST;
        let promoted = 0;
        for (const id of ids) {
          const member = await guild.members.fetch(id).catch(() => undefined);
          if (!member || member.user.bot) continue;
          const ok = await this.lock.run(id, () => this.emaPromote(member, now, { quiet: burst }))
            .catch(err => { logger.warn({ err, memberId: id }, 'ema promotion failed'); return false; });
          if (ok) promoted++;
        }
        if (burst && promoted > 0) await this.send(this.cfg.channels.keiji, promotionBurstAnnouncement(promoted, pingRoleIds(this.cfg)));
        return;
      }
      const data = await ujikoEvaluation(this.db, this.cfg, { q: '', status: 'met' }, now);
      for (const row of data.rows) {
        const member = await guild.members.fetch(row.memberId).catch(() => undefined);
        if (!member || member.user.bot) continue;
        // この一覧（status:'met'）に出た時点でご縁40・縁側20時間は満たしているので、
        // promoteIfNeeded で同じ評価をもう一度全走査しなくてよい（alreadyMet=true）。
        await this.lock.run(row.memberId, () => this.ensurePromotion(member, now, true))
          .catch(err => logger.warn({ err, memberId: row.memberId }, 'evaluation promotion failed'));
      }
    } finally { this.checkingEvaluationPromotions = false; }
  }

  /**
   * 🎐 絵馬での昇格。いまの役職の段に応じて票の種類と必要枚数を見る：
   * 参拝者→氏子（お参り期間中・毎週きまる数・招待で補える）／世話役→総代（総代の票）。氏子→世話役は候補ごとの選挙。
   * ご縁・縁側時間は見ない。自動降格はしない。運営（最上位が自動役職でない人）は対象外。
   */
  private async emaPromote(member: GuildMember, now = new Date(), opts: { quiet?: boolean } = {}): Promise<boolean> {
    if (member.user.bot) return false;
    // まずキャッシュの役職で「段があり、必要枚数に届いている」かを安く確かめる（毎回の force 取得を避ける）
    const cachedStep = emaStepFrom(highestRank(this.cfg.ranks, member.roles.cache.keys())?.key, this.cfg.emaThresholds);
    if (!cachedStep) return false;
    {
      const p = await emaStepProgress(this.db, this.cfg, member.id, cachedStep, now);
      if (p.count < p.need) return false;
    }
    // 昇格しそうなときだけ、最新の役職を取り直して二重昇格を防ぐ
    const fresh = await member.guild.members.fetch({ user: member.id, force: true }).catch(() => undefined);
    if (!fresh || fresh.user.bot) return false;
    // 段は「いちばん格の高い役職」で決める（最上位が運営なら昇格させない）
    const step = emaStepFrom(highestRank(this.cfg.ranks, fresh.roles.cache.keys())?.key, this.cfg.emaThresholds);
    const current = currentAutoRank(this.cfg.ranks, fresh.roles.cache.keys());
    if (!step || !current || current.key !== step.from) return false;
    const to = this.cfg.ranks.find((r) => r.key === step.to);
    if (!to) return false;
    const { count, need } = await emaStepProgress(this.db, this.cfg, fresh.id, step, now);
    if (count < need) return false;
    const held = new Set(fresh.roles.cache.keys());
    const removeRoleIds = autoRanks(this.cfg.ranks).filter((r) => r.key !== step.to && held.has(r.roleId)).map((r) => r.roleId);
    return this.promote(fresh, { from: current, to, removeRoleIds }, await goenOf(this.db, fresh.id), count, opts);
  }

  /**
   * 昇格が必要なら行う。
   * ロールの付け替えはキャッシュにすぐ反映されないことがあるため、
   * 昇格しそうなときだけ Discord から最新のロールを取り直して確かめる（二重昇格・二重発表を防ぐ）。
   */
  private async promoteIfNeeded(member: GuildMember, goen: number, now = new Date(), alreadyMet = false): Promise<void> {
    // 🎐 絵馬での昇格が ON のときは、昇格は全部「絵馬」で決める（emaPromote）。ご縁では一切上げない。
    if (await emaPromotionEnabled(this.db)) return;
    if (!decidePromotion(this.cfg.ranks, member.roles.cache.keys(), goen)) return;
    const fresh = await member.guild.members.fetch({ user: member.id, force: true }).catch(() => undefined);
    if (!fresh) return;
    const promotion = decidePromotion(this.cfg.ranks, fresh.roles.cache.keys(), goen);
    if (!promotion) return;
    if (promotion.from.key === 'sanpaisha' && !alreadyMet) {
      // ご縁40と縁側20時間の両方を、評価と同じ既定の全縁側・控除後の値で確かめる。
      // 評価一覧（checkEvaluationPromotions）から来た場合は確認済みなので、全走査を繰り返さない。
      const data = await ujikoEvaluation(this.db, this.cfg, { q: fresh.id, status: 'met' }, now);
      if (!data.rows.some(row => row.memberId === fresh.id)) return;
    }
    await this.promote(fresh, promotion, goen);
  }

  /**
   * 役職ロールを付け替えて #慶事 で発表する（emaCount を渡すと「絵馬◯枚で昇格」になる）。
   * quiet: 発表のカードに役職の通知を付けない（大勢がいっぺんに上がるとき。通知はまとめて1回）。昇格できたら true。
   */
  private async promote(member: GuildMember, promotion: Promotion, goen: number, emaCount?: number, opts: { quiet?: boolean; vote?: { votes: number; voters: number } } = {}): Promise<boolean> {
    const reason = opts.vote
      ? `投票（${opts.vote.voters} 人中 ${opts.vote.votes} 票）で ${promotion.to.name} に昇格`
      : emaCount !== undefined ? `絵馬 ${emaCount} 枚で ${promotion.to.name} に昇格` : `ご縁 ${goen} で ${promotion.to.name} に昇格`;
    let removeError: unknown;
    try {
      const changed = await rankMutation(this.db, member.id, async tx => {
        if (await promotionHold(tx, member.id)) return false;
        await member.roles.add(promotion.to.roleId, reason);
        if (promotion.removeRoleIds.length) await member.roles.remove(promotion.removeRoleIds, reason).catch(err => { removeError = err; });
        return true;
      });
      if (!changed) return false;
    } catch (err) {
      logger.error({ err, userId: member.id, to: promotion.to.key }, 'promotion role update failed');
      await this.log(`⚠️ ${member} さまの昇格（${promotion.to.name}）でロールを変更できませんでした。BOT のロールの位置と権限を確認してください。`);
      return false;
    }
    await this.rewardInvites(member);
    if (removeError) {
      logger.warn({ err: removeError, userId: member.id }, 'old rank role removal failed');
      await this.log(`⚠️ ${member} さまの前の役職ロールを外せませんでした。手で外してください。`);
    }
    await this.send(this.cfg.channels.keiji, promotionAnnouncement(member.id, promotion, goen, opts.quiet ? [] : pingRoleIds(this.cfg), member.displayAvatarURL(), emaCount, opts.vote));
    await this.log(opts.vote
      ? `⬆️ 昇格 <@${member.id}> ${promotion.from.name} → ${promotion.to.name}（世話役の投票 ${opts.vote.voters} 人中 ${opts.vote.votes} 票）`
      : emaCount !== undefined ? `⬆️ 昇格 <@${member.id}> ${promotion.from.name} → ${promotion.to.name}（絵馬 ${emaCount} 枚）` : promotionLog(member.id, promotion, goen));
    await recordPromotion(this.db, member.id, promotion.from.key, promotion.to.key, goen).catch((err) =>
      logger.warn({ err }, 'recordPromotion failed'),
    );
    // お参り期間中なら完了にする
    await setOmairiStatus(this.db, member.id, 'promoted', 'system').catch((err) => logger.warn({ err }, 'omairi close failed'));
    return true;
  }

  /** 🗳 #世話役選挙：設定 → 「世話役選挙」という名前のチャンネル → #慶事 */
  private sewayakuElectionChannel(guild: Guild): string | undefined {
    if (this.cfg.channels.sewayakuElection) return this.cfg.channels.sewayakuElection;
    const byName = guild.channels?.cache?.find((c) => c.isTextBased?.() && !c.isThread?.() && c.name.includes('世話役選挙'));
    return byName?.id ?? this.cfg.channels.keiji;
  }

  /** 投稿して、その投稿を返す（書きかえ用） */
  private async sendAndGet(channelId: string, message: MessageCreateOptions): Promise<{ id: string } | undefined> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (channel?.isSendable()) return await channel.send(message);
    } catch (err) {
      logger.warn({ err, channelId }, 'send failed');
    }
    return undefined;
  }

  private async log(content: string): Promise<void> {
    const id = this.cfg.channels.log;
    if (id) await this.send(id, content);
  }

  private async send(channelId: string, message: string | MessageCreateOptions): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (channel?.isSendable()) {
        await channel.send(typeof message === 'string' ? { content: message, allowedMentions: { parse: [], users: [] } } : message);
      } else {
        logger.warn({ channelId }, 'channel is not sendable');
      }
    } catch (err) {
      logger.warn({ err, channelId }, 'send failed');
    }
  }
}

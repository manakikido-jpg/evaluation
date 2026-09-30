import { saveVoiceNow } from '../services/meetings.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type Interaction,
  type Message,
  type UserContextMenuCommandInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { channelPosters, posterPage, type Poster } from '../services/posters.js';
import { SHUIN_PICK_ID } from '../services/notices.js';
import { recordPresence } from '../services/voiceUsage.js';
import { genderOfRoles } from '../services/admission.js';
import { CONTACT_LEVEL_EMOJI, CONTACT_LEVEL_LABEL, contactOfRoles } from '../services/contact.js';
import { introOf, introUrl } from '../services/intros.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { decidePromotion, highestRank, type Promotion } from '../domain/ranks.js';
import { KeyedLock } from '../lib/lock.js';
import { logger } from '../lib/logger.js';
import { giveFlow, revokeFlow, type MemberInfo } from '../services/flows.js';
import { addMessageCounts, eligibleVoiceMembers, voiceTick } from '../services/activity.js';
import { walletOf } from '../services/economy.js';
import { ticketsOf } from '../services/tickets.js';
import { customHoldingsOf } from '../services/customTickets.js';
import { allTicketsLine } from './gacha.js';
import { listPrizes } from '../services/gacha.js';
import { activeCoreTime, coreTimeBonus } from '../services/coreTime.js';
import { setOmairiStatus } from '../services/applications.js';
import { ActivityTracker, getMember, leaveNotice, recordJoin, recordLeave, recordPromotion, syncAllMembers, upsertMember, type MemberSnapshot } from '../services/members.js';
import { giversOf, goenOf, goshuinchoOf, receivedCountOf, stampedBy } from '../services/shuin.js';
import { COMMAND, parseShuinId } from './ids.js';
import {
  giveLog,
  giveReply,
  giversReply,
  goshuinchoReply,
  type ProfileExtra,
  promotionAnnouncement,
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
  if (!list.length) return { content: '🌸 このチャンネルには、まだ朱印を押せる人の投稿がありません。', components: [] };
  const p = posterPage(list, page);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(SHUIN_PICK_ONE_ID)
    .setPlaceholder('朱印を押す相手')
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
    content: `🌸 朱印を押す相手を選んでください（このチャンネルに投稿している ${list.length} 人・新しく投稿した順${p.pages > 1 ? `・${p.page + 1}/${p.pages} ページ` : ''}）。`,
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
    // 通話の記録（浮上時間）: AFK 以外の通話にいる人（BOT をのぞく）。1 人でも記録する
    const presence = [...guild.channels.cache.values()]
      .filter((c) => c.isVoiceBased() && c.id !== guild.afkChannelId)
      .map((c) => ({
        id: c.id,
        name: c.name,
        categoryId: c.parentId ?? null,
        categoryName: c.parent?.name ?? null,
        memberIds: c.isVoiceBased() ? [...c.members.values()].filter((m) => !m.user.bot).map((m) => m.id) : [],
      }));
    await recordPresence(this.db, presence, now).catch((err) => logger.warn({ err }, 'voice presence record failed'));
    // 議事録の「参加した人」を、いま通話にいる人から入れられるように
    await saveVoiceNow(this.db, presence.map((c) => ({ id: c.id, name: c.name, memberIds: c.memberIds })), now).catch((err) => logger.warn({ err }, 'voice now save failed'));

    const ids = eligibleVoiceMembers(channels, excluded);
    if (!ids.length) return;
    // コアタイム中は、10 分ごとの花びらが増える
    const coreBonus = activeCoreTime(this.cfg.coreTime, now) ? coreTimeBonus(this.cfg.economy) : 0;
    const awarded = await voiceTick(this.db, this.cfg.economy, ids, now, { coreBonus }).catch((err) => {
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
        return await this.card(interaction, target.id, isPublic);
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

    // 残高は、自分の御朱印帳を自分だけに見えるように開いたときだけ（ほかの人の残高は見せない）
    const showCoins = interaction.user.id === ownerId && !isPublic;
    const [data, wallet, tickets] = await Promise.all([
      goshuinchoOf(this.db, ownerId),
      showCoins ? walletOf(this.db, ownerId) : undefined,
      showCoins ? ticketsOf(this.db, ownerId) : undefined,
    ]);
    const ticketText = tickets ? allTicketsLine(tickets, await customHoldingsOf(this.db, ownerId)) : undefined;
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

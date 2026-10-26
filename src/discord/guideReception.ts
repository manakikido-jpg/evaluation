import { GuideWaitingNames } from './guideWaitingName.js';
import { GUIDE_HOLD_ROLE_NAME, watchReason } from '../services/inviteGuard.js';
import { adminLevelOf } from '../config.js';
import { watchOf } from '../services/securityWatch.js';
import { isNewAccount, raidState } from '../services/raid.js';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, MessageFlags, type Guild, type GuildMember, type Interaction, type Message, type VoiceState } from 'discord.js';
import type { Db } from '../db/client.js';
import type { GuildConfig } from '../config.js';
import type { DiscordActions, MessageBody } from '../lib/discordRest.js';
import { guideEmployees, guideReceptions } from '../db/schema.js';
import { addGuidePanelChannel, guidePanelChannels, assignGuide, completeGuide, leaveGuideReception, loadGuideConfig, openGuideReception, registerGuide, setGuideWaiting, activeGuides, listedGuides, setGuideDuty, guideDuty, guideDutySince, guideDutyChannelName, type GuideConfig } from '../services/guideReception.js';
import { guideRoleOf } from './guidePending.js';
import { autoRanks } from '../domain/ranks.js';
import { audit } from '../services/audit.js';
import { issueInitialCurrency } from '../services/initialCurrency.js';
import { logger } from '../lib/logger.js';
const btn = (id: string, label: string, disabled = false) => ({ type: 2, custom_id: id, label, style: 2, disabled });
export const guideEmployeePanel = (): MessageBody => ({
  content: '**案内人の受付**\n登録申請は運営が承認します。承認後に待機を切り替えてください。',
  allowed_mentions: { parse: [] },
  components: [
    { type: 1, components: [btn('guide:register', '登録を申請'), btn('guide:wait', '待機する'), btn('guide:off', '受付停止'), btn('guide:salary', '給与を確認'), btn('guide:who', '👀 待機中の人')] },
    // 🙋 案内担当（押すと、チャンネル名と、ほかの案内人への知らせが変わる）
    { type: 1, components: [{ ...btn('guide:duty', '🙋 案内を担当する'), style: 3 }, { ...btn('guide:dutyoff', '🔚 案内担当を終了する'), style: 4 }] },
  ],
});
export function guideVisitorPanel(r: typeof guideReceptions.$inferSelect, config: GuideConfig, roleGranted = false): MessageBody {
  const label = r.status === 'assigned' ? `対応中：<@${r.guideId}>` : r.status === 'done' ? '案内完了' : r.status === 'left' ? '退出済み' : '案内人の対応待ち';
  return {
    content: [`**🌸 咲楽ノ宮へようこそ**`, `<@${r.visitorId}> さん、案内人が来るまでに、こちらをご確認ください。`, ...config.links.map(l => `<:${l.emojiName}:${l.emojiId}> ${l.channelIds.map(id => `<#${id}>`).join(' ・ ')}`), `**案内状況：${label}**`, ...(roleGranted ? ['参拝者ロールを付与し、案内待ちを外しました。'] : [])].join('\n\n'),
    allowed_mentions: { parse: [], users: r.status === 'waiting' ? [r.visitorId] : [] },
    components: [{ type: 1, components: [btn(`guide:claim:${r.id}`, '案内を開始する', r.status !== 'waiting'), btn(`guide:done:${r.id}`, '案内完了', r.status !== 'assigned')] }, { type: 1, components: [btn(`guide:role:${r.id}`, 'ロールを付与する', r.status !== 'assigned' || roleGranted), btn(`guide:nickname:${r.id}`, '📝 名前を変更', r.status === 'done' || r.status === 'left')] }],
  };
}
/** 案内人の受付のパネルか（自分の BOT のメッセージで「登録を申請」のボタンがある） */
export const isGuidePanel = (m: Pick<Message, 'components'>) =>
  m.components.some((r) => 'components' in r && r.components.some((c) => 'customId' in c && c.customId === 'guide:register'));
/** 書き込みがあってから、パネルを下に置き直すまで */
const RESTICK_MS = 3_000;
/** ロールを付けてから、戻されていないか確かめるまで */
const RECHECK_MS = 15_000;

/** 「案内停止」ロールが付いているか */
const heldGuide = (m: { roles?: { cache?: { values?: () => Iterable<{ name?: string }> } } } | null | undefined) =>
  typeof m?.roles?.cache?.values === 'function' && [...m.roles.cache.values()].some((r) => r?.name === GUIDE_HOLD_ROLE_NAME);

export class GuideReceptionApp {
  private ticking = false;
  private readonly waitingNames: GuideWaitingNames;
  private visitorMessages = new Set<string>();
  private panelChannels = new Set<string>();
  private panelLoadedAt = 0;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly queue = new Map<string, Promise<void>>();
  constructor(private db: Db, private cfg: () => GuildConfig, private discord: DiscordActions, private presence = false) { this.waitingNames = new GuideWaitingNames(db, presence); }
  private async options(guild: Guild) {
    const c = await loadGuideConfig(this.db);
    const matches = guild.roles.cache.filter(r => r.name.includes('案内人'));
    return { ...c, pendingRoleId: guideRoleOf(this.cfg(), guild.roles.cache.values()), staffChannelId: c.staffChannelId ?? this.cfg().channels.log, roleId: c.roleId ?? (matches.size === 1 ? matches.first()!.id : undefined) };
  }
  private isVisitor(member: GuildMember | null | undefined, config: GuideConfig & { pendingRoleId?: string }) {
    return Boolean(member && !member.user.bot && config.pendingRoleId && member.roles.cache.has(config.pendingRoleId) && (!config.roleId || !member.roles.cache.has(config.roleId)));
  }
  private async refresh(r: typeof guideReceptions.$inferSelect, config: GuideConfig, roleGranted = false) {
    if (r.messageId) {
      this.visitorMessages.delete(r.messageId);
      await this.discord.editMessage(r.channelId, r.messageId, guideVisitorPanel(r, config, roleGranted));
      this.visitorMessages.add(r.messageId);
    }
  }
  /** 同じ受付のロール操作を直列にし、担当・現在のロールをもう一度確認する */
  private async grantVisitorRole(guild: Guild, id: number, actorId: string) {
    const c = await this.options(guild);
    const first = autoRanks(this.cfg().ranks)[0];
    if (!first || !c.pendingRoleId || first.roleId === c.pendingRoleId) return { error: '参拝者・案内待ちのロール設定を運営に確認してください。' };
    return this.db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`guide:role:${id}`}))`);
      const [r] = await tx.select().from(guideReceptions).where(eq(guideReceptions.id, id)).for('update');
      if (!r || r.status !== 'assigned' || r.departedAt || r.guideId !== actorId || r.visitorId === actorId) return { error: '案内を開始した担当者だけが、案内中にロールを付与できます。' };
      const actor = await guild.members.fetch({ user: actorId, force: true });
      let visitor = await guild.members.fetch({ user: r.visitorId, force: true });
      if (actor.user.bot || !c.roleId || !actor.roles.cache.has(c.roleId)) return { error: '案内人ロールが必要です。運営に確認してください。' };
      if (visitor.user.bot || !c.voiceChannelIds.includes(r.channelId) || actor.voice.channelId !== r.channelId || visitor.voice.channelId !== r.channelId) return { error: '担当者と利用者が、同じ案内VCにいるときに操作してください。' };
      const ids = { addedRoleId: first.roleId, removedRoleId: c.pendingRoleId! };
      if (visitor.roles.cache.has(first.roleId) && !visitor.roles.cache.has(c.pendingRoleId!)) return { reception: r, changed: false, ...ids };
      if (!visitor.roles.cache.has(c.pendingRoleId!)) return { error: '案内待ちロールの人だけに参拝者ロールを付与できます。' };
      // 🚨 警戒モードの間は、案内人ではロールを付けられない
      if (await raidState(tx as Db)) {
        await audit(tx as Db, { actorId, targetId: r.visitorId, action: 'guide.role_blocked', detail: { receptionId: id, reason: 'raid' }, via: 'discord' });
        return { error: 'いまは警戒モード（レイドのおそれ）なので、案内人はロールを付与できません。神職・宮司に知らせてください。' };
      }
      // 🛡 要注意リストの人は、案内人ではロールを付けられない（神職・宮司が決める）
      if (await watchOf(tx as Db, r.visitorId)) {
        await audit(tx as Db, { actorId, targetId: r.visitorId, action: 'guide.role_blocked', detail: { receptionId: id, reason: 'watch' }, via: 'discord' });
        return { error: 'この人は要注意リストに入っているため、案内人はロールを付与できません。神職・宮司に知らせてください。' };
      }
      try {
        if (!visitor.roles.cache.has(first.roleId)) await this.discord.addRole(guild.id, r.visitorId, first.roleId, '案内人が参拝者ロールを付与');
        visitor = await guild.members.fetch({ user: r.visitorId, force: true });
        if (!visitor.roles.cache.has(first.roleId)) return { error: '参拝者ロールを確認できませんでした。案内待ちは残しています。時間をおいてもう一度押してください。' };
      } catch (err) {
        logger.warn({ err, receptionId: id }, 'guide visitor role add failed');
        return { error: '参拝者ロールを付与できませんでした。BOTの「ロールの管理」と、参拝者ロールより上にBOTがいるか確認してください。' };
      }
      try {
        if (visitor.roles.cache.has(c.pendingRoleId!)) await this.discord.removeRole(guild.id, r.visitorId, c.pendingRoleId!, '参拝者になったため案内待ちを外す');
        visitor = await guild.members.fetch({ user: r.visitorId, force: true });
        if (visitor.roles.cache.has(c.pendingRoleId!)) throw new Error('案内待ちが残っています');
      } catch (err) {
        logger.warn({ err, receptionId: id }, 'guide pending role remove failed');
        return { error: '参拝者ロールは付きましたが、案内待ちを外せませんでした。BOTの権限・ロールの位置を確認して、もう一度押してください。' };
      }
      await audit(tx as Db, { actorId, targetId: r.visitorId, action: 'guide.role_grant', detail: { receptionId: id, roleId: first.roleId, removedRoleId: c.pendingRoleId }, via: 'discord' });
      return { reception: r, changed: true, ...ids };
    });
  }
  /** 付けたあと少し待って、ロールが戻されていないか確かめる（ほかの BOT・サーバーの設定が戻すことがある） */
  private recheckRoles(guild: Guild, visitorId: string, addedRoleId: string, removedRoleId: string, staffChannelId?: string, waitMs = RECHECK_MS) {
    setTimeout(() => {
      void (async () => {
        const m = await guild.members.fetch({ user: visitorId, force: true }).catch(() => undefined);
        if (!m) return;
        const hasAdded = m.roles.cache.has(addedRoleId), hasRemoved = m.roles.cache.has(removedRoleId);
        if (hasAdded && !hasRemoved) return;
        logger.warn({ visitorId, hasAdded, hasRemoved }, 'guide roles reverted');
        if (staffChannelId) await this.discord.sendMessage(staffChannelId, { content: `⚠️ <@${visitorId}> さんのロールが戻っています（<@&${addedRoleId}>: ${hasAdded ? 'あり' : 'なし'} ・ <@&${removedRoleId}>: ${hasRemoved ? 'あり' : 'なし'}）。ほかの BOT やサーバーの設定が戻していないか、Discord の監査ログで確かめてください。`, allowed_mentions: { parse: [] } });
      })().catch((err) => logger.warn({ err }, 'guide role recheck failed'));
    }, waitMs).unref?.();
  }
  async onVoiceStateUpdate(before: VoiceState, after: VoiceState) {
    if (before.channelId === after.channelId || after.guild.id !== this.cfg().guildId || after.member?.user.bot) return;
    try {
      const c = await this.options(after.guild);
      if (before.channelId && c.voiceChannelIds.includes(before.channelId)) {
        for (const r of await leaveGuideReception(this.db, after.id)) await this.refresh(r, c).catch(err => logger.warn({ err }, 'guide exit display failed'));
      }
      if (after.channelId && c.voiceChannelIds.includes(after.channelId)) {
        // 👁 要注意の人（見張る人・警戒中の人に招待された人）: 本人には何もしない。案内人は呼ばず、運営だけに知らせる
        const watch = await watchReason(this.db, after.id);
        if (watch || heldGuide(after.member)) {
          const log = this.cfg().channels.log;
          const why = watch ? `${watch.why === 'alert' ? '警戒中の人' : '見張る人'}（<@${watch.inviterId}>）の招待` : '「案内停止」ロール';
          if (log) await this.discord.sendMessage(log, { content: `👁 要注意の <@${after.id}> さんが案内所（<#${after.channelId}>）に入りました（${why}）。案内人には知らせていません。運営で対応してください。`, allowed_mentions: { parse: [] } }).catch(() => undefined);
          return;
        }
        if (!this.isVisitor(after.member, c)) return;
        await openGuideReception(this.db, after.id, after.channelId);
        await this.tick(after.guild);
      }
    } catch (err) { logger.warn({ err }, 'guide voice event failed'); }
  }
  /** 未通知の受付を再送する。再起動時の在室者も確認する */
  async tick(guild: Guild) {
    if (this.ticking || guild.id !== this.cfg().guildId) return;
    this.ticking = true;
    try {
      const c = await this.options(guild);
      await this.waitingNames.sync(guild, c).catch(err => logger.warn({ err }, 'guide waiting sync failed'));
      if (!c.voiceChannelIds.length) return;
      for (const channelId of c.voiceChannelIds) {
        const ch = guild.channels.cache.get(channelId);
        if (ch?.type !== ChannelType.GuildVoice) continue;
        for (const member of ch.members.values()) {
          if (this.isVisitor(member, c) && !heldGuide(member) && !(await watchReason(this.db, member.id))) await openGuideReception(this.db, member.id, channelId);
        }
      }
      const rows = await this.db.select().from(guideReceptions).where(isNull(guideReceptions.departedAt));
      const activeMessages = new Set(rows.filter(r => r.status === 'waiting' || r.status === 'assigned').map(r => r.messageId).filter((id): id is string => Boolean(id)));
      this.visitorMessages = new Set([...this.visitorMessages].filter(id => activeMessages.has(id)));
      for (let r of rows) {
        const visitor = guild.members.cache.get(r.visitorId);
        if (!c.voiceChannelIds.includes(r.channelId) || visitor?.voice.channelId !== r.channelId || (r.status === 'waiting' && !this.isVisitor(visitor, c))) {
          for (const left of await leaveGuideReception(this.db, r.visitorId)) await this.refresh(left, c).catch(() => undefined);
          continue;
        }
        if (r.status === 'done' || r.status === 'left') continue;
        try {
          if (!r.messageId) {
            const message = await this.discord.sendMessage(r.channelId, guideVisitorPanel(r, c));
            [r] = await this.db.update(guideReceptions).set({ messageId: message.id }).where(eq(guideReceptions.id, r.id)).returning() as [typeof r];
            this.visitorMessages.add(message.id);
          } else if (!this.visitorMessages.has(r.messageId)) {
            const first = autoRanks(this.cfg().ranks)[0];
            const granted = Boolean(first && visitor?.roles.cache.has(first.roleId) && c.pendingRoleId && !visitor.roles.cache.has(c.pendingRoleId));
            await this.refresh(r, c, granted);
          }
          if (!r.notifiedAt && c.staffChannelId && c.roleId) {
            const watched = await watchOf(this.db, r.visitorId);
            const visitorUser = guild.members?.cache?.get(r.visitorId)?.user;
            const fresh = visitorUser?.createdAt instanceof Date ? isNewAccount(visitorUser.createdAt, this.cfg().security?.newAccountDays ?? 0) : false;
            await this.discord.sendMessage(c.staffChannelId, { content: `<@&${c.roleId}>\n<@${r.visitorId}> さんが <#${r.channelId}> に来ました。${watched ? '\n🛡 **要注意リストの人です。** 案内人はロールを付けられません。神職・宮司に知らせてください。' : ''}${fresh ? '\n🐣 作ったばかりのアカウントです。サブアカウントや荒らしでないか気をつけてください。' : ''}\nhttps://discord.com/channels/${guild.id}/${r.channelId}/${r.messageId}`, allowed_mentions: { parse: [], roles: [c.roleId] } });
            await this.db.update(guideReceptions).set({ notifiedAt: new Date() }).where(eq(guideReceptions.id, r.id));
            const employees = await this.db.select().from(guideEmployees).where(and(eq(guideEmployees.status, 'active'), eq(guideEmployees.waiting, true)));
            for (const e of employees) {
              const member = await guild.members.fetch({ user: e.memberId, force: true }).catch(() => undefined);
              if (member && !member.user.bot && member.roles.cache.has(c.roleId)) await this.discord.sendDm(e.memberId, `<@${e.memberId}> さん、案内の受付です。<@${r.visitorId}> さんが <#${r.channelId}> に来ました。\nhttps://discord.com/channels/${guild.id}/${r.channelId}/${r.messageId}`).catch(err => logger.warn({ err }, 'guide dm failed'));
            }
          }
        } catch (err) { logger.warn({ err, receptionId: r.id }, 'guide notification failed'); }
      }
    } finally { this.ticking = false; }
  }
  /** パネルのチャンネルで書きこみがあったら、少し待ってパネルをいちばん下に置き直す */
  async onMessage(msg: Message) {
    if (!msg.inGuild() || msg.guildId !== this.cfg().guildId) return;
    if (Date.now() - this.panelLoadedAt > 60_000) {
      this.panelChannels = new Set(await guidePanelChannels(this.db));
      this.panelLoadedAt = Date.now();
    }
    if (!this.panelChannels.has(msg.channelId)) return;
    if (msg.author.id === msg.client.user.id && isGuidePanel(msg)) return;
    clearTimeout(this.timers.get(msg.channelId));
    this.timers.set(msg.channelId, setTimeout(() => {
      this.timers.delete(msg.channelId);
      const prev = this.queue.get(msg.channelId) ?? Promise.resolve();
      this.queue.set(msg.channelId, prev.then(() => this.restick(msg)).catch((err: unknown) => logger.warn({ err }, 'guide panel restick failed')));
    }, RESTICK_MS));
  }

  private async restick(msg: Message) {
    const ch = msg.channel;
    if (!ch.isSendable()) return;
    const me = msg.client.user.id;
    const recent = await ch.messages.fetch({ limit: 20 }).catch(() => undefined);
    const mine = (m: Message) => m.author.id === me && isGuidePanel(m);
    const last = recent?.first();
    if (last && mine(last)) return;
    await this.discord.sendMessage(ch.id, guideEmployeePanel());
    for (const m of recent?.values() ?? []) if (mine(m)) await m.delete().catch(() => undefined);
  }

  /** 名前の変更は案内人だけ。同じ案内VCの案内待ち・参拝者に限定する。 */
  private async nicknameInteraction(i: Interaction): Promise<void> {
    if (!i.inCachedGuild() || !(i.isButton() || i.isUserSelectMenu() || i.isModalSubmit())) return;
    try {
      const c = await this.options(i.guild);
      const actor = await i.guild.members.fetch({ user: i.user.id, force: true });
      if (actor.user.bot || !c.roleId || !actor.roles.cache.has(c.roleId)) {
        await i.reply({ content: '案内人ロールの人だけが使えます。', flags: MessageFlags.Ephemeral });
        return;
      }
      // 案内のパネルのボタンは、その案内を受けている人の名前を変える
      const fromPanel = i.isButton() ? /^guide:nickname:(\d+)$/.exec(i.customId) : null;
      let panelTarget: string | undefined;
      if (fromPanel) {
        const [r] = await this.db.select().from(guideReceptions).where(eq(guideReceptions.id, Number(fromPanel[1])));
        if (!r || r.status === 'done' || r.status === 'left') {
          await i.reply({ content: 'この案内はもう終わっています。', flags: MessageFlags.Ephemeral });
          return;
        }
        panelTarget = r.visitorId;
      } else if (i.isButton()) {
        await i.reply({ content: '同じ案内VCにいる案内待ち・参拝者を選んでください。', flags: MessageFlags.Ephemeral,
          components: [{ type: 1, components: [{ type: 5, custom_id: 'guide:nickname:pick', placeholder: '名前を変更する利用者', min_values: 1, max_values: 1 }] }] });
        return;
      }
      const targetId = panelTarget ?? (i.isUserSelectMenu() ? i.values[0] : i.customId.slice('guide:nickname:save:'.length));
      const target = targetId ? await i.guild.members.fetch({ user: targetId, force: true }) : undefined;
      const first = autoRanks(this.cfg().ranks)[0];
      const ids = target ? [...target.roles.cache.keys()] : [];
      const eligible = target && target.id !== actor.id && !target.user.bot &&
        !adminLevelOf(this.cfg(), ids) && !target.roles.cache.has(c.roleId) &&
        !this.cfg().ranks.some(r => r.roleId !== first?.roleId && target.roles.cache.has(r.roleId)) &&
        ((c.pendingRoleId && target.roles.cache.has(c.pendingRoleId)) || (first && target.roles.cache.has(first.roleId)));
      if (!eligible || !actor.voice.channelId || !c.voiceChannelIds.includes(actor.voice.channelId) || target.voice.channelId !== actor.voice.channelId) {
        await i.reply({ content: '同じ案内VCにいる案内待ち・参拝者だけを選んでください。案内人・上位の役職・BOTの名前は変えられません。', flags: MessageFlags.Ephemeral });
        return;
      }
      if (i.isUserSelectMenu() || i.isButton()) {
        const input = new TextInputBuilder().setCustomId('nickname').setLabel('新しいサーバー内の名前').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(1).setMaxLength(32).setValue(target.displayName.slice(0, 32));
        await i.showModal(new ModalBuilder().setCustomId(`guide:nickname:save:${target.id}`).setTitle('利用者の名前を変更').addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input)));
        return;
      }
      if (!i.isModalSubmit()) return;
      const nickname = i.fields.getTextInputValue('nickname').trim();
      if (!nickname || nickname.length > 32 || /[\r\n\x00-\x1f\x7f]/.test(nickname)) {
        await i.reply({ content: '名前は1〜32文字で、改行を入れずに入力してください。', flags: MessageFlags.Ephemeral });
        return;
      }
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      if (!target.manageable) {
        await i.editReply('BOTからこの人の名前を変更できません。BOTの役職の位置と「ニックネームの管理」権限を運営に確認してください。');
        return;
      }
      try { await target.setNickname(nickname, `案内人による名前変更（操作した人: ${actor.id}）`); }
      catch (err) {
        logger.warn({ err, actorId: actor.id, targetId: target.id }, 'guide nickname change failed');
        await i.editReply('名前を変更できませんでした。BOTの「ニックネームの管理」権限と役職の位置を運営に確認してください。');
        return;
      }
      try { await audit(this.db, { actorId: actor.id, targetId: target.id, action: 'guide.nickname', detail: { channelId: actor.voice.channelId }, via: 'discord' }); }
      catch (err) {
        logger.warn({ err, actorId: actor.id, targetId: target.id }, 'guide nickname audit failed');
        await i.editReply('名前は変更しましたが、操作の記録を保存できませんでした。運営に知らせてください。');
        return;
      }
      await i.editReply({ content: '利用者の名前を変更しました。', allowedMentions: { parse: [] } });
    } catch (err) {
      logger.warn({ err }, 'guide nickname interaction failed');
      const content = '利用者・権限を確認できませんでした。時間をおいてもう一度操作してください。';
      if (i.deferred || i.replied) await i.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
      else await i.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
  }

  async onInteraction(i: Interaction) {
    if ('customId' in i && typeof i.customId === 'string' && (i.customId === 'guide:nickname' || i.customId.startsWith('guide:nickname:'))) {
      if (i.guildId === this.cfg().guildId) await this.nicknameInteraction(i);
      return;
    }
    if (!i.isButton() || !i.customId.startsWith('guide:') || !i.inCachedGuild() || i.guildId !== this.cfg().guildId) return;
    // 前に出したパネルも、押されたらそのチャンネルを覚えて、いちばん下に置き直す
    if (i.message && isGuidePanel(i.message) && !this.panelChannels.has(i.channelId)) {
      this.panelChannels.add(i.channelId);
      void addGuidePanelChannel(this.db, i.channelId).catch(() => undefined);
    }
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const c = await this.options(i.guild);
      const member = await i.guild.members.fetch({ user: i.user.id, force: true });
      const action = i.customId.split(':')[1];
      if (action === 'register') {
        await registerGuide(this.db, i.user.id);
        return void await i.editReply('案内人の登録申請を受け付けました。運営の承認をお待ちください。');
      }
      // 👀 いま待機中の案内人（パネルを見られる人ならだれでも。通知は飛ばさない）
      if (action === 'who') {
        const cfgNow = this.cfg();
        const guides = await activeGuides(this.db);
        // ロールを確かめるため、まだ手元にない人も読みこむ（読めなくても続ける）
        if (guides.length) await i.guild.members.fetch({ user: guides.map((g) => g.id) }).catch(() => undefined);
        const { staff, others } = listedGuides(guides, (id) => {
          const m = i.guild.members.cache.get(id);
          const status = m?.presence?.status;
          return {
            staff: Boolean(m && adminLevelOf(cfgNow, [...m.roles.cache.keys()])),
            // オンラインかどうかを見ない設定なら、待機を押しているかだけで決める
            online: this.presence ? Boolean(status && status !== 'offline') : undefined,
          };
        });
        const duty = await guideDuty(this.db);
        const since = await guideDutySince(this.db);
        const lines = [
          duty.length ? `🙋 案内担当: ${duty.map((id) => `<@${id}>${since.get(id) ? `（<t:${Math.floor(since.get(id)!.getTime() / 1000)}:R>から）` : ''}`).join('・')}` : '🙋 案内担当: なし',
          `👀 いま対応できる案内人（${staff.length + others.length} 人）`,
          ...(staff.length ? ['🛡 運営（いつも）', ...staff.map((id) => `・<@${id}>`)] : []),
          ...(others.length ? [this.presence ? '🟢 オンラインで待機中' : '🟢 待機中', ...others.map((id) => `・<@${id}>`)] : []),
          ...(staff.length + others.length ? [] : ['いま対応できる案内人はいません。']),
        ];
        return void await i.editReply({ content: lines.join('\n'), allowedMentions: { parse: [] } });
      }
      if (member.user.bot || !c.roleId || !member.roles.cache.has(c.roleId)) return void await i.editReply('案内人ロールが必要です。運営に確認してください。');
      // 🙋 案内担当を始める・終える（チャンネル名を変えて、案内人に知らせる）
      if (action === 'duty' || action === 'dutyoff') {
        const on = action === 'duty';
        const r = await setGuideDuty(this.db, i.user.id, on, i.user.id);
        if (!r.changed) {
          await i.editReply(on ? 'もう案内担当になっています。' : '案内担当ではありません。');
          await this.waitingNames.sync(i.guild, c).catch(err => logger.warn({ err }, 'guide waiting sync failed'));
          return;
        }
        await i.guild.members.fetch({ user: r.after }).catch(() => undefined);
        const nameOf = (id: string) => i.guild.members.cache.get(id)?.displayName ?? '案内人';
        const channel = i.channel;
        // 社務所Web で決めたチャンネルの名前を変える（Discord の決まりで 10 分に 2 回まで。こえた分は少し待ってから変わる）
        const named = c.dutyChannelId ? i.guild.channels.cache.get(c.dutyChannelId) : undefined;
        if (named && 'setName' in named) void named.setName(guideDutyChannelName(r.after.map(nameOf)), '案内担当が変わった').catch((err: unknown) => logger.warn({ err }, 'guide duty rename failed'));
        const ping = c.roleId ? `<@&${c.roleId}> ` : '';
        const content = on
          ? `${ping}🙋 ${nameOf(i.user.id)} **が案内担当をはじめました。**`
          : r.after.length
            ? `🔚 ${nameOf(i.user.id)} が案内担当を終了しました（いまの担当: ${r.after.map(nameOf).join('・')}）。`
            : `${ping}⚠️ **案内担当が不在です。案内できるかたは「🙋 案内を担当する」を押してください。**`;
        if (channel?.isSendable()) await channel.send({ content, allowedMentions: { parse: [], roles: c.roleId && (on || !r.after.length) ? [c.roleId] : [] } }).catch((err: unknown) => logger.warn({ err }, 'guide duty notice failed'));
        await i.editReply(on ? '案内担当をはじめました。終わるときは「🔚 案内担当を終了する」を押してください。' : '案内担当を終了しました。');
        await this.waitingNames.sync(i.guild, c).catch(err => logger.warn({ err }, 'guide waiting sync failed'));
        return;
      }
      if (action === 'wait' || action === 'off') {
        const ok = await setGuideWaiting(this.db, i.user.id, action === 'wait');
        await i.editReply(ok ? (action === 'wait' ? '待機中にしました。入室があるとDMで知らせます。' : '受付を停止しました。') : '案内人の登録と承認が必要です。');
        if (ok) await this.waitingNames.sync(i.guild, c).catch(err => logger.warn({ err }, 'guide waiting sync failed'));
        return;
      }
      if (action === 'salary') {
        const { employeePayroll } = await import('../db/schema.js');
        const rows = await this.db.select().from(employeePayroll).where(eq(employeePayroll.memberId, i.user.id));
        const month = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 7);
        const current = rows.filter(r => r.date.startsWith(month));
        return void await i.editReply(`今月の給与：${current.reduce((n, r) => n + r.amount, 0).toLocaleString('ja-JP')}銭（支払済み）\n有給の案内：${current.length}件`);
      }
      const id = Number(i.customId.split(':')[2]);
      if (!Number.isSafeInteger(id) || id <= 0) return void await i.editReply('受付が見つかりません。');
      const [r] = await this.db.select().from(guideReceptions).where(eq(guideReceptions.id, id));
      if (!r) return void await i.editReply('受付が見つかりません。');
      const visitor = await i.guild.members.fetch({ user: r.visitorId, force: true }).catch(() => undefined);
      if (visitor?.voice.channelId !== r.channelId || member.voice.channelId !== r.channelId) return void await i.editReply('案内を受ける人と担当者が、同じ案内VCにいるときに操作してください。');
      if (!c.voiceChannelIds.includes(r.channelId)) return void await i.editReply('この部屋は現在、案内VCに設定されていません。');
      if (action === 'role') {
        const result = await this.grantVisitorRole(i.guild, id, i.user.id);
        if (!('reception' in result)) return void await i.editReply(result.error);
        await issueInitialCurrency(this.db, this.cfg(), this.discord, result.reception.visitorId).catch(err => logger.warn({ err }, 'guide initial currency failed'));
        await this.refresh(result.reception, c, true).catch(err => logger.warn({ err }, 'guide role display failed'));
        if (result.changed && c.staffChannelId) await this.discord.sendMessage(c.staffChannelId, { content: `参拝者ロール付与：<@${i.user.id}> さん → <@${result.reception.visitorId}> さん\n案内待ちを外しました。`, allowed_mentions: { parse: [] } }).catch(err => logger.warn({ err }, 'guide role notice failed'));
        // どのロールを動かしたかを見せる（設定のロールがちがうときに気づけるように）
        const which = `（付けた: <@&${result.addedRoleId}> ・ 外した: <@&${result.removedRoleId}>）`;
        if (result.changed) this.recheckRoles(i.guild, result.reception.visitorId, result.addedRoleId, result.removedRoleId, c.staffChannelId);
        return void await i.editReply({ content: (result.changed ? '参拝者ロールを付与し、案内待ちを外しました。案内が終わったら「案内完了」を押してください。' : '参拝者ロールは付与済みで、案内待ちも外れています。') + '\n' + which, allowedMentions: { parse: [] } });
      }
      if (action === 'claim') {
        if (!this.isVisitor(visitor, c)) return void await i.editReply('案内待ちロールの人だけ案内を開始できます。');
        const assigned = await assignGuide(this.db, id, i.user.id, { roleVerified: true });
        if (assigned) {
          await this.refresh(assigned, c).catch(() => undefined);
          if (c.staffChannelId) await this.discord.sendMessage(c.staffChannelId, { content: `案内開始：<@${i.user.id}> さん → <@${assigned.visitorId}> さん\n場所：<#${assigned.channelId}>`, allowed_mentions: { parse: [] } }).catch(err => logger.warn({ err }, 'guide start notice failed'));
        }
        return void await i.editReply(assigned ? '案内を開始しました。あなたを担当者として記録しました。終わったら「案内完了」を押してください。' : '担当済み、または退出済みです。');
      }
      if (action === 'done') {
        const done = await completeGuide(this.db, id, i.user.id);
        if (!done) return void await i.editReply('完了済み、またはあなたの担当ではありません。');
        // 案内が終わったら、VC のチャットに出した案内リンクのメッセージを消す（消せなければ「案内完了」に書きかえる）
        const rr = done.reception;
        if (rr.messageId) await Promise.resolve().then(() => this.discord.deleteMessage(rr.channelId, rr.messageId!)).catch(() => this.refresh(rr, c).catch(() => undefined));
        const message = `案内完了：<@${i.user.id}> さん → <@${r.visitorId}> さん\n給与：${done.amount}銭${done.amount ? '（支払済み）' : '（給与停止中、または同じ利用者の本日分は支払済み）'}`;
        if (c.staffChannelId) await this.discord.sendMessage(c.staffChannelId, { content: message, allowed_mentions: { parse: [] } }).catch(err => logger.warn({ err }, 'guide completion notice failed'));
        await this.discord.sendDm(i.user.id, message).catch(() => false);
        await i.editReply(`案内を完了しました。給与：${done.amount}銭。`);
      }
    } catch (err) { logger.warn({ err }, 'guide interaction failed'); await i.editReply('処理に失敗しました。時間をおいてもう一度お試しください。').catch(() => undefined); }
  }
}

import { and, eq, isNull } from 'drizzle-orm';
import { ChannelType, MessageFlags, type Guild, type GuildMember, type Interaction, type Message, type VoiceState } from 'discord.js';
import type { Db } from '../db/client.js';
import type { GuildConfig } from '../config.js';
import type { DiscordActions, MessageBody } from '../lib/discordRest.js';
import { guideEmployees, guideReceptions } from '../db/schema.js';
import { addGuidePanelChannel, guidePanelChannels, assignGuide, completeGuide, leaveGuideReception, loadGuideConfig, openGuideReception, registerGuide, setGuideWaiting, type GuideConfig } from '../services/guideReception.js';
import { guideRoleOf } from './guidePending.js';
import { logger } from '../lib/logger.js';
const btn = (id: string, label: string, disabled = false) => ({ type: 2, custom_id: id, label, style: 2, disabled });
export const guideEmployeePanel = (): MessageBody => ({
  content: '**案内人の受付**\n登録申請は運営が承認します。承認後に待機を切り替えてください。',
  allowed_mentions: { parse: [] },
  components: [{ type: 1, components: [btn('guide:register', '登録を申請'), btn('guide:wait', '待機する'), btn('guide:off', '受付停止'), btn('guide:salary', '給与を確認')] }],
});
export function guideVisitorPanel(r: typeof guideReceptions.$inferSelect, config: GuideConfig): MessageBody {
  const label = r.status === 'assigned' ? `対応中：<@${r.guideId}>` : r.status === 'done' ? '案内完了' : r.status === 'left' ? '退出済み' : '案内人の対応待ち';
  return {
    content: [`**🌸 咲楽ノ宮へようこそ**`, `<@${r.visitorId}> さん、案内人が来るまでに、こちらをご確認ください。`, ...config.links.map(l => `<:${l.emojiName}:${l.emojiId}> ${l.channelIds.map(id => `<#${id}>`).join(' ・ ')}`), `**案内状況：${label}**`].join('\n\n'),
    allowed_mentions: { parse: [], users: r.status === 'waiting' ? [r.visitorId] : [] },
    components: [{ type: 1, components: [btn(`guide:claim:${r.id}`, '案内を開始する', r.status !== 'waiting'), btn(`guide:done:${r.id}`, '案内完了', r.status !== 'assigned')] }],
  };
}
/** 案内人の受付のパネルか（自分の BOT のメッセージで「登録を申請」のボタンがある） */
export const isGuidePanel = (m: Pick<Message, 'components'>) =>
  m.components.some((r) => 'components' in r && r.components.some((c) => 'customId' in c && c.customId === 'guide:register'));
/** 書き込みがあってから、パネルを下に置き直すまで */
const RESTICK_MS = 3_000;

export class GuideReceptionApp {
  private ticking = false;
  private panelChannels = new Set<string>();
  private panelLoadedAt = 0;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly queue = new Map<string, Promise<void>>();
  constructor(private db: Db, private cfg: () => GuildConfig, private discord: DiscordActions) {}
  private async options(guild: Guild) {
    const c = await loadGuideConfig(this.db);
    const matches = guild.roles.cache.filter(r => r.name.includes('案内人'));
    return { ...c, pendingRoleId: guideRoleOf(this.cfg(), guild.roles.cache.values()), staffChannelId: c.staffChannelId ?? this.cfg().channels.log, roleId: c.roleId ?? (matches.size === 1 ? matches.first()!.id : undefined) };
  }
  private isVisitor(member: GuildMember | null | undefined, config: GuideConfig & { pendingRoleId?: string }) {
    return Boolean(member && !member.user.bot && config.pendingRoleId && member.roles.cache.has(config.pendingRoleId) && (!config.roleId || !member.roles.cache.has(config.roleId)));
  }
  private async refresh(r: typeof guideReceptions.$inferSelect, config: GuideConfig) {
    if (r.messageId) await this.discord.editMessage(r.channelId, r.messageId, guideVisitorPanel(r, config));
  }
  async onVoiceStateUpdate(before: VoiceState, after: VoiceState) {
    if (before.channelId === after.channelId || after.guild.id !== this.cfg().guildId || after.member?.user.bot) return;
    try {
      const c = await this.options(after.guild);
      if (before.channelId && c.voiceChannelIds.includes(before.channelId)) {
        for (const r of await leaveGuideReception(this.db, after.id)) await this.refresh(r, c).catch(err => logger.warn({ err }, 'guide exit display failed'));
      }
      if (after.channelId && c.voiceChannelIds.includes(after.channelId)) {
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
      if (!c.voiceChannelIds.length) return;
      for (const channelId of c.voiceChannelIds) {
        const ch = guild.channels.cache.get(channelId);
        if (ch?.type !== ChannelType.GuildVoice) continue;
        for (const member of ch.members.values()) {
          if (this.isVisitor(member, c)) await openGuideReception(this.db, member.id, channelId);
        }
      }
      const rows = await this.db.select().from(guideReceptions).where(isNull(guideReceptions.departedAt));
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
          }
          if (!r.notifiedAt && c.staffChannelId && c.roleId) {
            await this.discord.sendMessage(c.staffChannelId, { content: `<@&${c.roleId}>\n<@${r.visitorId}> さんが <#${r.channelId}> に来ました。\nhttps://discord.com/channels/${guild.id}/${r.channelId}/${r.messageId}`, allowed_mentions: { parse: [], roles: [c.roleId] } });
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

  async onInteraction(i: Interaction) {
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
      if (member.user.bot || !c.roleId || !member.roles.cache.has(c.roleId)) return void await i.editReply('案内人ロールが必要です。運営に確認してください。');
      if (action === 'wait' || action === 'off') {
        const ok = await setGuideWaiting(this.db, i.user.id, action === 'wait');
        return void await i.editReply(ok ? (action === 'wait' ? '待機中にしました。入室があるとDMで知らせます。' : '受付を停止しました。') : '案内人の登録と承認が必要です。');
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
        await this.refresh(done.reception, c).catch(() => undefined);
        const message = `案内完了：<@${i.user.id}> さん → <@${r.visitorId}> さん\n給与：${done.amount}銭${done.amount ? '（支払済み）' : '（給与停止中、または同じ利用者の本日分は支払済み）'}`;
        if (c.staffChannelId) await this.discord.sendMessage(c.staffChannelId, { content: message, allowed_mentions: { parse: [] } }).catch(err => logger.warn({ err }, 'guide completion notice failed'));
        await this.discord.sendDm(i.user.id, message).catch(() => false);
        await i.editReply(`案内を完了しました。給与：${done.amount}銭。`);
      }
    } catch (err) { logger.warn({ err }, 'guide interaction failed'); await i.editReply('処理に失敗しました。時間をおいてもう一度お試しください。').catch(() => undefined); }
  }
}

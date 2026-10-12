import { ChannelType, MessageFlags, PermissionFlagsBits, type Guild, type Interaction, type Message, type ThreadChannel } from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { buyDiary, changeDiaryMode, clearDiaryThread, createDiary, diaryActive, diaryForThread, diaryOf, diaryTick, mayPostDiary, setDiaryAutoRenew, type DiaryMode } from '../services/diary.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const buttons = (threadId?: string) => [{ type: 1 as const, components: [
  { type: 2 as const, style: 1 as const, label: '公開・本人だけ投稿', custom_id: threadId ? `diary:mode:owner:${threadId}` : 'diary:create:owner' },
  { type: 2 as const, style: 2 as const, label: '公開・みんな投稿OK', custom_id: threadId ? `diary:mode:everyone:${threadId}` : 'diary:create:everyone' },
] }];
const unix = (d: Date) => Math.floor(d.getTime() / 1000);
const panel = (c: GuildConfig) => ({ content: `📖 **日記の受付**\n${c.diary.days}日ごとに${c.diary.price}銭（自動で更新・いつでも止められる）。1人1つ、自分の日記を作れます。\nどちらもこのチャンネルを見られる人に公開します。投稿を本人だけにするか、みんなのコメントを受け付けるかを選べます。`, components: [{ type: 1 as const, components: [{ type: 2 as const, style: 1 as const, label: '日記の権利・自分の日記を開く', custom_id: 'diary:open' }] }], allowedMentions: { parse: [] as [] } });
export class DiaryApp {
  private guild?: Guild;
  constructor(private db: Db, private cfg: () => GuildConfig, private discord?: Pick<DiscordActions, 'sendDm'>) {}
  private plan() { return { price: this.cfg().diary.price, days: this.cfg().diary.days }; }

  /** 期限が切れた日記は鍵をかける（読めるが書けない）。また払ったら外す */
  private async setLock(threadId: string | null, locked: boolean) {
    if (!threadId || !this.guild) return;
    const t = await this.guild.channels.fetch(threadId).catch(() => null);
    if (!t?.isThread()) return;
    if (!locked && t.archived) await t.setArchived(false).catch(() => undefined);
    await t.setLocked(locked, locked ? '日記の期限が切れた' : '日記をまた始めた').catch((err: unknown) => logger.warn({ err, threadId }, 'diary lock failed'));
  }

  /** 1 分ごと: 前の日の知らせ・自動更新・期限切れ */
  async tick(now = new Date()) {
    if (!this.guild) return;
    const c = this.cfg().diary;
    const r = await diaryTick(this.db, this.plan(), now);
    for (const x of r.remind) await this.discord?.sendDm(x.memberId, `📖 日記は <t:${unix(x.paidUntil)}:f> に自動で更新します（${c.price}銭）。止めるときは日記の受付の「自動更新を止める」から。`).catch(() => false);
    for (const x of r.renewed) await this.discord?.sendDm(x.memberId, `📖 日記を更新しました（${c.price}銭）。次は <t:${unix(x.paidUntil)}:f> です。`).catch(() => false);
    for (const x of r.expired) {
      await this.setLock(x.threadId, true);
      await this.discord?.sendDm(x.memberId, x.reason === 'poor'
        ? `📖 銭が足りず、日記を更新できませんでした。日記は残っていますが、書きこめないようにしました。日記の受付から${c.price}銭でまた始められます。`
        : `📖 日記の期間が終わりました。日記は残っていますが、書きこめないようにしました。日記の受付からまた始められます。`).catch(() => false);
    }
  }
  async attach(guild: Guild) {
    this.guild = guild;
    const channel = await guild.channels.fetch(this.cfg().diary.channelId);
    if (channel?.type === ChannelType.GuildText) {
      const recent = await channel.messages.fetch({ limit: 50 });
      if (!recent.some(m => m.author.id === guild.client.user.id && m.components.some(r => 'components' in r && r.components.some(b => 'customId' in b && b.customId === 'diary:open')))) await channel.send(panel(this.cfg()));
    } else if (channel?.type === ChannelType.GuildForum) {
      const active = await channel.threads.fetchActive();
      if (!active.threads.some(t => t.ownerId === guild.client.user.id && t.name === '📖 日記の受付')) await channel.threads.create({ name: '📖 日記の受付', message: panel(this.cfg()) });
    } else throw new Error('日記の場所はテキストかフォーラムを選んでください');
  }
  async onInteraction(i: Interaction) {
    if (!i.isButton() || !i.inCachedGuild() || i.guildId !== this.cfg().guildId || !i.customId.startsWith('diary:')) return;
    await i.deferReply(EPHEMERAL);
    try {
      const [, action, rawMode, id] = i.customId.split(':');
      if (action === 'open' || action === 'buy') {
        const c = this.cfg().diary;
        if (action === 'buy') {
          const result = await buyDiary(this.db, i.user.id, this.plan());
          if (result === 'poor') return void await i.editReply({ content: `日記には${c.price}銭が必要です。`, components: [] });
          if (result === 'ok') await this.setLock((await diaryOf(this.db, i.user.id))?.threadId ?? null, false);
        }
        const d = await diaryOf(this.db, i.user.id);
        const offer = { content: `📖 日記は${c.days}日ごとに${c.price}銭です（自動で更新・いつでも止められる）。受けたあとに投稿の設定を選べます。`, components: [{ type: 1 as const, components: [{ type: 2 as const, style: 1 as const, label: `${c.price}銭で日記を始める`, custom_id: 'diary:buy' }] }], allowedMentions: { parse: [] as [] } };
        if (!d) return void await i.editReply(offer);
        if (!diaryActive(d)) return void await i.editReply({ ...offer, content: `📖 日記の期間が終わっています（日記は残っていて、読めます）。${c.price}銭でまた ${c.days} 日書けるようにします。` });
        if (d.threadId) {
          const thread = await i.guild.channels.fetch(d.threadId).catch((error: unknown) => {
            if (error && typeof error === 'object' && 'code' in error && error.code === 10003) return null;
            throw error;
          });
          if (!thread) {
            await clearDiaryThread(this.db, d.threadId);
            return void await i.editReply({ content: '前の日記は削除されています。権利を使って作り直せます。', components: buttons(), allowedMentions: { parse: [] } });
          }
          if (thread.isThread() && thread.archived && !thread.locked) await thread.setArchived(false);
          return void await i.editReply({ content: `📖 日記はこちら：<#${d.threadId}>\n現在は「${d.mode === 'owner' ? '本人だけ投稿' : 'みんな投稿OK'}」です。本人がここで変更できます。\n${this.term(d)}`, components: [...buttons(d.threadId), ...this.renewRow(d)], allowedMentions: { parse: [] } });
        }
        return void await i.editReply({ content: '日記の権利を持っています。公開日記の投稿設定を選んで作成してください。', components: buttons(), allowedMentions: { parse: [] } });
      }
      if (action === 'auto') {
        const ok = await setDiaryAutoRenew(this.db, i.user.id, rawMode === 'on');
        const d = await diaryOf(this.db, i.user.id);
        return void await i.editReply({ content: ok && d ? `${rawMode === 'on' ? '自動更新をまた始めました。' : '自動更新を止めました。今の期限までは書けます。'}\n${this.term(d)}` : '期限なしの日記は、更新はありません。', components: d ? this.renewRow(d) : [], allowedMentions: { parse: [] } });
      }
      if (rawMode !== 'owner' && rawMode !== 'everyone') return void await i.editReply('投稿の設定を確認してください。');
      const mode: DiaryMode = rawMode;
      if (mode === 'owner') {
        const parent = await i.guild.channels.fetch(this.cfg().diary.channelId);
        const bot = i.guild.members.me ?? await i.guild.members.fetchMe();
        if (!parent || (parent.type !== ChannelType.GuildText && parent.type !== ChannelType.GuildForum) || !parent.permissionsFor(bot)?.has(PermissionFlagsBits.ManageMessages)) {
          return void await i.editReply({ content: '本人だけ投稿にするには、BOTの「メッセージを管理」権限が必要です。運営に確認してください。', components: [] });
        }
      }
      if (action === 'mode' && id) {
        const ok = await changeDiaryMode(this.db, i.user.id, id, mode);
        return void await i.editReply({ content: ok ? `投稿設定を「${mode === 'owner' ? '本人だけ投稿' : 'みんな投稿OK'}」に変更しました。過去のコメントは残ります。` : 'この日記の本人だけが変更できます。', components: [], allowedMentions: { parse: [] } });
      }
      if (action !== 'create') return void await i.editReply('この操作は使えません。');
      let created: ThreadChannel | undefined;
      let registered = false;
      try {
        const result = await createDiary(this.db, i.user.id, mode, async () => {
          const parent = await i.guild.channels.fetch(this.cfg().diary.channelId);
          const name = `📖 ${i.member.displayName}の日記`.slice(0, 100);
          const message = { content: `📖 <@${i.user.id}>の日記\n作成時の投稿設定は「${mode === 'owner' ? '本人だけ投稿' : 'みんな投稿OK'}」。誰でも読めます。変更は日記の受付から。\n本人だけ投稿では、他の人の書き込みをBOTが削除します。`, allowedMentions: { parse: [] as [] } };
          if (parent?.type === ChannelType.GuildForum) created = await parent.threads.create({ name, message });
          else if (parent?.type === ChannelType.GuildText) {
            created = await parent.threads.create({ name, type: ChannelType.PublicThread, reason: '日記の権利による作成' });
            await created.send(message);
          } else throw new Error('日記の場所が見つかりません');
          return created.id;
        });
        registered = true;
        await i.editReply({ content: result.status === 'no_right' ? '先に日記の権利を購入してください。' : `📖 日記はこちら：<#${result.threadId}>`, components: [], allowedMentions: { parse: [] } });
      } catch (error) {
        if (created && !registered) await created.delete('日記の作成に失敗したため').catch(err => logger.warn({ err }, 'diary cleanup failed'));
        throw error;
      }
    } catch (err) {
      logger.warn({ err }, 'diary operation failed');
      await i.editReply({ content: '日記の操作に失敗しました。購入済みの権利は残っています。運営に確認するか、もう一度試してください。', components: [] });
    }
  }
  /** 期限・自動更新の一行 */
  private term(d: { paidUntil: Date | null; autoRenew: boolean }) {
    const c = this.cfg().diary;
    if (!d.paidUntil) return '-# 前に期限なしで受けた日記です（ずっと使えます）。';
    return d.autoRenew ? `-# 次の更新：<t:${unix(d.paidUntil)}:f>（${c.price}銭・自動）` : `-# <t:${unix(d.paidUntil)}:f> まで（自動更新は止めています）`;
  }
  private renewRow(d: { paidUntil: Date | null; autoRenew: boolean }) {
    if (!d.paidUntil) return [];
    return [{ type: 1 as const, components: [d.autoRenew
      ? { type: 2 as const, style: 2 as const, label: '自動更新を止める', custom_id: 'diary:auto:off' }
      : { type: 2 as const, style: 1 as const, label: '自動更新をまた始める', custom_id: 'diary:auto:on' }] }];
  }

  async onMessage(m: Message) {
    if (m.guildId !== this.cfg().guildId || !m.channel.isThread() || m.channel.parentId !== this.cfg().diary.channelId) return;
    const d = await diaryForThread(this.db, m.channelId);
    if (d && !mayPostDiary(d, m.author.id, m.client.user!.id)) await m.delete();
  }
  async onThreadDelete(thread: ThreadChannel) {
    if (thread.guild.id === this.cfg().guildId && thread.parentId === this.cfg().diary.channelId) await clearDiaryThread(this.db, thread.id);
  }
}

import { ChannelType, MessageFlags, PermissionFlagsBits, type Guild, type Interaction, type Message, type ThreadChannel } from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { buyDiary, changeDiaryMode, clearDiaryThread, createDiary, diaryForThread, diaryOf, DIARY_PRICE, mayPostDiary, type DiaryMode } from '../services/diary.js';
import { logger } from '../lib/logger.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const buttons = (threadId?: string) => [{ type: 1 as const, components: [
  { type: 2 as const, style: 1 as const, label: '公開・本人だけ投稿', custom_id: threadId ? `diary:mode:owner:${threadId}` : 'diary:create:owner' },
  { type: 2 as const, style: 2 as const, label: '公開・みんな投稿OK', custom_id: threadId ? `diary:mode:everyone:${threadId}` : 'diary:create:everyone' },
] }];
const panel = () => ({ content: `📖 **日記の受付**\n権利は${DIARY_PRICE}銭・期限なし。1人1つ、自分の日記を作れます。\nどちらもこのチャンネルを見られる人に公開します。投稿を本人だけにするか、みんなのコメントを受け付けるかを選べます。`, components: [{ type: 1 as const, components: [{ type: 2 as const, style: 1 as const, label: '日記の権利・自分の日記を開く', custom_id: 'diary:open' }] }], allowedMentions: { parse: [] as [] } });
export class DiaryApp {
  constructor(private db: Db, private cfg: () => GuildConfig) {}
  async attach(guild: Guild) {
    const channel = await guild.channels.fetch(this.cfg().diary.channelId);
    if (channel?.type === ChannelType.GuildText) {
      const recent = await channel.messages.fetch({ limit: 50 });
      if (!recent.some(m => m.author.id === guild.client.user.id && m.components.some(r => 'components' in r && r.components.some(b => 'customId' in b && b.customId === 'diary:open')))) await channel.send(panel());
    } else if (channel?.type === ChannelType.GuildForum) {
      const active = await channel.threads.fetchActive();
      if (!active.threads.some(t => t.ownerId === guild.client.user.id && t.name === '📖 日記の受付')) await channel.threads.create({ name: '📖 日記の受付', message: panel() });
    } else throw new Error('日記の場所はテキストかフォーラムを選んでください');
  }
  async onInteraction(i: Interaction) {
    if (!i.isButton() || !i.inCachedGuild() || i.guildId !== this.cfg().guildId || !i.customId.startsWith('diary:')) return;
    await i.deferReply(EPHEMERAL);
    try {
      const [, action, rawMode, id] = i.customId.split(':');
      if (action === 'open' || action === 'buy') {
        if (action === 'buy') {
          const result = await buyDiary(this.db, i.user.id);
          if (result === 'poor') return void await i.editReply({ content: `日記の権利には${DIARY_PRICE}銭が必要です。`, components: [] });
        }
        const d = await diaryOf(this.db, i.user.id);
        if (!d) return void await i.editReply({ content: `📖 日記の権利は${DIARY_PRICE}銭・期限なしです。購入後に投稿の設定を選べます。`, components: [{ type: 1, components: [{ type: 2, style: 1, label: `${DIARY_PRICE}銭で権利を購入`, custom_id: 'diary:buy' }] }], allowedMentions: { parse: [] } });
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
          return void await i.editReply({ content: `📖 日記はこちら：<#${d.threadId}>\n現在は「${d.mode === 'owner' ? '本人だけ投稿' : 'みんな投稿OK'}」です。本人がここで変更できます。`, components: buttons(d.threadId), allowedMentions: { parse: [] } });
        }
        return void await i.editReply({ content: '日記の権利を持っています。公開日記の投稿設定を選んで作成してください。', components: buttons(), allowedMentions: { parse: [] } });
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
  async onMessage(m: Message) {
    if (m.guildId !== this.cfg().guildId || !m.channel.isThread() || m.channel.parentId !== this.cfg().diary.channelId) return;
    const d = await diaryForThread(this.db, m.channelId);
    if (d && !mayPostDiary(d, m.author.id, m.client.user!.id)) await m.delete();
  }
  async onThreadDelete(thread: ThreadChannel) {
    if (thread.guild.id === this.cfg().guildId && thread.parentId === this.cfg().diary.channelId) await clearDiaryThread(this.db, thread.id);
  }
}

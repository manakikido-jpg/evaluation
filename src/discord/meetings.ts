import { MessageFlags, type ChatInputCommandInteraction, type Interaction } from 'discord.js';
import { adminLevelOf, type GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import {
  addTodo,
  appendToMeeting,
  createMeeting,
  currentMeetingId,
  getMeeting,
  parseDue,
  postSummary,
  setCurrentMeeting,
  summaryMessage,
} from '../services/meetings.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const NONE = '開いている議事録がありません。`/議事録 始める` で始めてください。';

/** 📓 /議事録: 会議の最中に Discord から書く（いま開いている議事録は 1 つ。社務所Web の議事録と同じもの） */
export class MeetingApp {
  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
    private readonly discord: DiscordActions,
    private readonly webBaseUrl?: string,
  ) {}

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'minutes') return;
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    try {
      if (!adminLevelOf(this.cfg(), [...interaction.member.roles.cache.keys()])) {
        return void (await interaction.reply({ content: '神職・宮司だけが使えます。', ...EPHEMERAL }));
      }
      await this.handle(interaction);
    } catch (err) {
      logger.error({ err }, 'minutes command failed');
      if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: 'うまくいきませんでした。時間をおいてもう一度お試しください。', ...EPHEMERAL }).catch(() => undefined);
    }
  }

  private url(id: number): string | undefined {
    return this.webBaseUrl ? `${this.webBaseUrl}/minutes/${id}` : undefined;
  }

  private async handle(i: ChatInputCommandInteraction<'cached'>): Promise<void> {
    const sub = i.options.getSubcommand();
    const by = i.user.id;
    if (sub === 'start') {
      const title = i.options.getString('title', true).trim().slice(0, 100);
      const picked = i.options.getChannel('voice');
      const voice = picked && 'isVoiceBased' in picked && picked.isVoiceBased() ? picked : i.member.voice.channel;
      const people = voice ? [...voice.members.values()].filter((m) => !m.user.bot).map((m) => m.id) : [];
      const attendees = [...new Set([...people, by])];
      const m = await createMeeting(this.db, { title, heldAt: new Date(), placeChannelId: voice?.id ?? null, attendees, agenda: '', notes: '', decisions: '' }, [], by);
      await setCurrentMeeting(this.db, m.id, by);
      return void (await i.reply({
        content: [
          `📓 **${title}** の議事録を始めました${voice ? `（📍 <#${voice.id}>・👥 ${attendees.length} 人）` : ''}`,
          '-# `/議事録 決定` 決まったこと・`/議事録 やること` 担当と期限・`/議事録 メモ` 話したこと・`/議事録 終わる` でまとめを出す',
        ].join('\n'),
        allowedMentions: { parse: [] },
      }));
    }
    const id = await currentMeetingId(this.db);
    const found = id ? await getMeeting(this.db, id) : undefined;
    if (!id || !found) return void (await i.reply({ content: NONE, ...EPHEMERAL }));
    if (sub === 'note') {
      await appendToMeeting(this.db, id, 'notes', i.options.getString('text', true).trim(), by);
      return void (await i.reply({ content: `📝 メモしました（${found.meeting.title}）。`, ...EPHEMERAL }));
    }
    if (sub === 'decide') {
      const text = i.options.getString('text', true).trim();
      await appendToMeeting(this.db, id, 'decisions', text, by);
      return void (await i.reply({ content: `✅ **決まったこと**: ${text}`, allowedMentions: { parse: [] } }));
    }
    if (sub === 'todo') {
      const text = i.options.getString('text', true).trim();
      const who = i.options.getUser('who');
      const dueRaw = i.options.getString('due');
      const due = dueRaw ? parseDue(dueRaw) : null;
      if (dueRaw && !due) return void (await i.reply({ content: `期限「${dueRaw}」が読めませんでした（10/5・2026-10-05・明日・3日後 のように書いてください）。`, ...EPHEMERAL }));
      await addTodo(this.db, id, { body: text, assigneeId: who?.id ?? null, due: due ?? null }, by);
      const dueText = due ? `（〆 ${Number(due.slice(5, 7))}/${Number(due.slice(8, 10))}）` : '';
      return void (await i.reply({
        content: `📌 **やること**: ${text}${who ? ` … ${who}` : ''}${dueText}`,
        // 担当の人には通知が届く
        allowedMentions: { users: who ? [who.id] : [] },
      }));
    }
    if (sub === 'now') {
      return void (await i.reply({ embeds: summaryMessage(found.meeting, found.todos, { url: this.url(id) }).embeds, ...EPHEMERAL }));
    }
    // end
    const post = i.options.getBoolean('post') ?? true;
    await setCurrentMeeting(this.db, null, by);
    if (post && i.channel?.isTextBased()) {
      await i.deferReply(EPHEMERAL);
      const r = await postSummary({ db: this.db, discord: this.discord }, id, i.channel.id, by, { url: this.url(id) }).catch((err) => {
        logger.warn({ err }, 'minutes summary post failed');
        return undefined;
      });
      return void (await i.editReply(r ? `📓 議事録を閉じて、まとめを出しました。${this.url(id) ? `あとで直すときは ${this.url(id)}` : ''}` : '議事録は閉じましたが、まとめを出せませんでした（BOT がこのチャンネルに書き込めるか確かめてください）。'));
    }
    await i.reply({ content: `📓 議事録を閉じました。${this.url(id) ? `あとで直すときは ${this.url(id)}` : ''}`, ...EPHEMERAL });
  }
}

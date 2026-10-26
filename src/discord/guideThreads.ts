import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, type Guild, type GuildMember, type Interaction, type ThreadChannel } from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { loadGuideConfig } from '../services/guideReception.js';
import { setScheduleMessage, bookSlot, closeThread, guideThreadConfig, openSlots, openThreads, recordThread, takeDueReminders, threadById, threadOf, validSlot, type GuideThreadConfig } from '../services/guideThreads.js';
import { watchReason } from '../services/inviteGuard.js';
import { guideRoleIdsOf, guideRoleOf, scheduleChannelOf } from './guidePending.js';

const PRIVATE = { flags: MessageFlags.Ephemeral } as const;

/** スレッドに送る、あいさつと時間のボタン */
export function guideThreadMessage(c: GuideThreadConfig, memberId: string, now = new Date(), guideRoleId?: string) {
  const slots = openSlots(c, now);
  const timeRow = slots.length ? [new ActionRowBuilder<ButtonBuilder>().addComponents(slots.map(s => new ButtonBuilder().setCustomId(`gth:slot:${s.date}:${s.time}`).setLabel((s.tomorrow ? '明日 ' : '') + s.time).setStyle(ButtonStyle.Primary)))] : [];
  return {
    // @案内人 を呼ぶと、そのロールの人がスレッドに入る（人数の上限なし・あとから案内人になった人も呼べば入る）
    content: `<@${memberId}> さん${guideRoleId ? `\n<@&${guideRoleId}> 新しい方が来ました。` : ''}`,
    embeds: [{ description: c.message.slice(0, 4000), color: 0xf4a7b9 }],
    components: [...timeRow, new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('gth:now').setLabel('今から').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('gth:other').setLabel('時間外').setStyle(ButtonStyle.Secondary),
    )],
    allowedMentions: { users: [memberId], roles: guideRoleId ? [guideRoleId] : [] },
  };
}

/** 🧵 入った人の案内スレッド（本人と案内人だけ） */
export class GuideThreadApp {
  private ticking = false;
  constructor(private db: Db, private cfg: () => GuildConfig) {}

  /** @案内人 のロール（案内の設定のロール。なければ、名前に「案内人」が入るロールが 1 つだけのとき） */
  private async guideRole(guild: Guild): Promise<string | undefined> {
    const set = (await loadGuideConfig(this.db)).roleId;
    if (set) return set;
    const ids = [...guideRoleIdsOf(guild.roles.cache.values())];
    return ids.length === 1 ? ids[0] : undefined;
  }
  /** 案内所の通話（「今から」の案内に出す） */
  private async lobby(): Promise<string> {
    const ids = (await loadGuideConfig(this.db)).voiceChannelIds;
    return ids.length ? ids.map(id => `<#${id}>`).join('・') : '案内所';
  }

  async onMemberAdd(m: GuildMember): Promise<void> {
    if (m.guild.id !== this.cfg().guildId || m.user.bot) return;
    const c = await guideThreadConfig(this.db);
    if (!c.enabled || !c.channelId) return;
    // もう承認された人（役職・絵馬待ちがある人）には作らない。Discord のオンボーディングで付くロールなどは気にしない
    const cfg = this.cfg();
    const roleIds = [...m.roles.cache.keys()];
    if (cfg.ranks.some(r => roleIds.includes(r.roleId)) || (cfg.roles.emaPending && roleIds.includes(cfg.roles.emaPending))) return void logger.info({ memberId: m.id }, 'guide thread skipped: already approved');
    const parent = m.guild.channels.cache.get(c.channelId);
    if (parent?.type !== ChannelType.GuildText) return void logger.warn({ channelId: c.channelId }, 'guide thread parent is not a text channel');
    // 入りなおした人: 前のスレッドが閉じる前でも、閉じて新しく作る
    const old = await threadOf(this.db, m.id);
    if (old && !old.closedAt) {
      await closeThread(this.db, m.id);
      await this.removeSchedule(m.guild, old.scheduleMessageId);
      const t = await m.guild.channels.fetch(old.threadId).catch(() => null);
      if (t?.isThread()) await t.edit({ locked: true, archived: true, reason: '入りなおした（新しいスレッドを作る）' }).catch(() => undefined);
    }
    // 👁 要注意の人: 本人には同じように見せるが、案内人は入れず、知らせは運営の記録へ
    const watched = Boolean(await watchReason(this.db, m.id));
    const thread = await parent.threads.create({ name: `🌸 ${m.displayName} さんのご案内`.slice(0, 100), type: ChannelType.PrivateThread, invitable: false, autoArchiveDuration: 10080, reason: '入った人の案内スレッド' });
    await recordThread(this.db, m.id, thread.id, watched);
    await thread.members.add(m.id);
    await thread.send(guideThreadMessage(c, m.id, new Date(), watched ? undefined : await this.guideRole(m.guild)));
  }

  /** 案内人に知らせる（要注意の人は運営の記録へ） */
  private async notify(thread: ThreadChannel, watched: boolean, memberId: string, text: string) {
    const role = await this.guideRole(thread.guild);
    if (watched) {
      const log = this.cfg().channels.log;
      const ch = log ? thread.guild.channels.cache.get(log) : undefined;
      if (ch?.isTextBased()) await ch.send({ content: `👁 要注意の <@${memberId}> さん（案内スレッド ${thread.toString()}）: ${text}。案内人には知らせていません。`, allowedMentions: { parse: [] } });
      // 本人からは、ほかの人と同じに見えるように（案内人は呼ばない）
      await thread.send({ content: `<@${memberId}> さん: ${text}`, allowedMentions: { users: [memberId] } });
      return;
    }
    await thread.send({ content: `${role ? `<@&${role}> ` : ''}<@${memberId}> さん: ${text}`, allowedMentions: { users: [memberId], roles: role ? [role] : [] } });
  }

  async onInteraction(i: Interaction) {
    if (!(i.isButton() || i.isModalSubmit()) || !i.customId.startsWith('gth:') || !i.inCachedGuild() || i.guildId !== this.cfg().guildId) return;
    const thread = i.channel;
    if (!thread?.isThread()) return;
    const row = await threadById(this.db, thread.id);
    if (!row || row.closedAt) return void await i.reply({ content: 'このご案内は終わっています。', ...PRIVATE });
    if (row.memberId !== i.user.id) return void await i.reply({ content: 'このボタンは、ご案内を受ける本人だけが押せます。', ...PRIVATE });
    const parts = i.customId.split(':');
    try {
      if (i.isButton() && parts[1] === 'other') {
        return void await i.showModal(new ModalBuilder().setCustomId('gth:otherform').setTitle('ご希望の日時').addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId('when').setLabel('来られる日時（例: 10月28日 20時ごろ）').setStyle(TextInputStyle.Paragraph).setMaxLength(200).setRequired(true))));
      }
      await i.deferReply(PRIVATE);
      if (i.isButton() && parts[1] === 'slot') {
        const date = parts[2] ?? '', time = parts.slice(3).join(':');
        const c = await guideThreadConfig(this.db);
        if (!validSlot(c, date, time)) return void await i.editReply('その時間は、もう選べません。いまのボタンから選び直してください。');
        await bookSlot(this.db, row.memberId, date, time);
        const label = `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日 ${time}`;
        await this.notify(thread, row.watched, row.memberId, `**${label}** を希望しました`);
        await i.editReply(`${label} で受け付けました。その時間に ${await this.lobby()} へお越しください（10 分前にお知らせします）。`);
      } else if (i.isButton() && parts[1] === 'now') {
        await this.notify(thread, row.watched, row.memberId, '**今から** のご案内を希望しています');
        await i.editReply(`${await this.lobby()} に入ってお待ちください。案内人が来ます。`);
      } else if (i.isModalSubmit() && parts[1] === 'otherform') {
        const when = i.fields.getTextInputValue('when').trim().slice(0, 200);
        await this.notify(thread, row.watched, row.memberId, `ほかの日時を希望しています：「${when}」`);
        // 📅 #案内希望日程 にも、名前と希望の日時を出す（要注意の人は出さない）
        if (!row.watched) await this.postSchedule(thread, row.memberId, row.scheduleMessageId, when).catch(err => logger.warn({ err }, 'guide schedule post failed'));
        await i.editReply('受け付けました。案内人からのお返事をお待ちください。');
      }
    } catch (err) {
      logger.warn({ err }, 'guide thread interaction failed');
      if (i.deferred) await i.editReply('うまく受け付けられませんでした。少し待ってからもう一度お試しください。').catch(() => undefined);
    }
  }

  /** #案内希望日程 に、名前と希望の日時を出す（前に出した分は書きかえる） */
  private async postSchedule(thread: ThreadChannel, memberId: string, oldId: string | null, when: string) {
    const id = scheduleChannelOf(this.cfg(), thread.guild.channels.cache.values());
    const ch = id ? thread.guild.channels.cache.get(id) : undefined;
    if (!ch || ch.type !== ChannelType.GuildText) return;
    const member = thread.guild.members.cache.get(memberId);
    const body = { content: `📅 **${member?.displayName ?? '参拝者'}**（<@${memberId}>）さん
希望の日時：${when}
案内スレッド：${thread.toString()}`, allowedMentions: { parse: [] as never[] } };
    const old = oldId ? await ch.messages.fetch(oldId).catch(() => undefined) : undefined;
    if (old) return void await old.edit(body);
    const sent = await ch.send(body);
    await setScheduleMessage(this.db, memberId, sent.id);
  }
  /** 閉じるときに、#案内希望日程 の BOT の書き込みを消す */
  private async removeSchedule(guild: Guild, messageId: string | null) {
    if (!messageId) return;
    const id = scheduleChannelOf(this.cfg(), guild.channels.cache.values());
    const ch = id ? guild.channels.cache.get(id) : undefined;
    if (ch?.type === ChannelType.GuildText) await ch.messages.delete(messageId).catch(err => logger.warn({ err }, 'guide schedule delete failed'));
  }

  /** 毎分: 10 分前のお知らせと、案内が終わった人・抜けた人のスレッドを閉じる */
  async tick(guild: Guild, now = new Date()) {
    if (this.ticking || guild.id !== this.cfg().guildId) return;
    this.ticking = true;
    try {
      const pending = guideRoleOf(this.cfg(), guild.roles.cache.values());
      for (const row of pending ? await openThreads(this.db) : []) {
        const m = guild.members.cache.get(row.memberId);
        if (m && pending && m.roles.cache.has(pending)) continue;
        if (!m && !(await guild.members.fetch(row.memberId).then(() => false).catch((err: { code?: number }) => err?.code === 10007))) continue;
        await closeThread(this.db, row.memberId, now);
        await this.removeSchedule(guild, row.scheduleMessageId);
        const t = await guild.channels.fetch(row.threadId).catch(() => null);
        if (t?.isThread()) await t.edit({ locked: true, archived: true, reason: m ? '案内が終わった' : 'サーバーを抜けた' }).catch(err => logger.warn({ err }, 'guide thread close failed'));
      }
      for (const row of await takeDueReminders(this.db, now)) {
        const t = await guild.channels.fetch(row.threadId).catch(() => null);
        if (t?.isThread()) await this.notify(t, row.watched, row.memberId, `まもなく **${row.slotLabel}** のご案内です。${await this.lobby()} へお越しください`).catch(err => logger.warn({ err }, 'guide thread reminder failed'));
      }
    } finally { this.ticking = false; }
  }
}

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags, PermissionFlagsBits, StringSelectMenuBuilder, escapeMarkdown, type Guild, type GuildMember, type Interaction, type VoiceChannel, type VoiceState } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import type { GuildConfig } from '../config.js';
import { settings } from '../db/schema.js';
import { KeyedLock } from '../lib/lock.js';
import { logger } from '../lib/logger.js';
import { fmtSec, roomKnockConfig, ROOM_MODES, answerRoomKnock, cancelKnock, recordKnockMessage, requestRoomKnock, resetRoomKnock, roomKnockState, setKnockControl, setRoomKnockMode, type KnockState, type RoomMode } from '../services/roomKnock.js';

const PRIVATE = { flags: MessageFlags.Ephemeral } as const;
const noPing = { parse: [] as never[] };
const button = (id: string, label: string, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const row = (...buttons: ButtonBuilder[]) => new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
const humans = (ch: VoiceChannel) => ch.members.filter(m => !m.user.bot);
const link = (ch: VoiceChannel) => new ButtonBuilder().setLabel('部屋を開く').setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${ch.guild.id}/${ch.id}`);
const REPLIES = { yes: '⭕ どうぞ', wait: '⏳ 少し待ってね', no: '🌙 今はごめんね' } as const;
export const roomDirectoryPanel = () => ({ content: '**🌸 お部屋案内**\n宿のお部屋を選んでください。部屋一覧と操作は、押した本人だけに表示します。\n🟢 出入り自由　🔔 こんこん歓迎　🌙 取り込み中\nこんこんは入室前の声かけです。入室の権限は変わりません。', components: [row(button('rkn:list:0', '🌸 部屋一覧を見る', ButtonStyle.Primary))], allowedMentions: noPing });
export function roomKnockControls(room: string, mode: RoomMode) {
  return { content: `**🌸 この部屋の受付：${ROOM_MODES[mode]}**\n在室している人が切り替えられます。全員退出すると「出入り自由」に戻ります。`, components: [row(...(Object.keys(ROOM_MODES) as RoomMode[]).map(m => button(`rkn:mode:${room}:${m}`, ROOM_MODES[m], m === mode ? ButtonStyle.Primary : ButtonStyle.Secondary)))], allowedMentions: noPing };
}
function notice(room: string, p: NonNullable<KnockState['pending']>, result?: string, window = '3分') {
  return { content: `🔔 **こんこん**\n${p.users.map(id => `<@${id}>`).join(' ')} さんが声をかけています。\n${result ?? '入っても大丈夫ですか？ 在室者だけが返事できます（${window}以内）。'}`, components: result ? [] : [row(...(Object.keys(REPLIES) as (keyof typeof REPLIES)[]).map(k => button(`rkn:reply:${room}:${p.id}:${k}`, REPLIES[k])))], allowedMentions: noPing };
}
/** 公開の入口から本人用の一覧を出し、部屋外の人だけがこんこんできる。 */
export class RoomKnockApp {
  private readonly lock = new KeyedLock();
  private ticking = false;
  constructor(private db: Db, private cfg: () => GuildConfig, private included: (id: string) => Promise<boolean> = async () => false) {}
  private async eligible(ch: VoiceChannel) {
    const cfg = this.cfg();
    return ch.id !== ch.guild.afkChannelId && !cfg.tempVoice.hubs.some(h => h.channelId === ch.id) && (await this.included(ch.id));
  }
  private canEnter(ch: VoiceChannel, member: GuildMember) {
    return !member.user.bot && Boolean(ch.permissionsFor(member)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]));
  }
  private async available(guild: Guild, member: GuildMember) {
    const found: VoiceChannel[] = [];
    for (const ch of guild.channels.cache.values()) if (ch.type === ChannelType.GuildVoice && this.canEnter(ch, member) && await this.eligible(ch)) found.push(ch);
    return found.sort((a, b) => a.rawPosition - b.rawPosition);
  }
  async tick(guild: Guild) {
    if (this.ticking || guild.id !== this.cfg().guildId) return;
    this.ticking = true;
    try {
      // 同名が複数あるときは誤投稿しない。
      const conf = await roomKnockConfig(this.db);
      if (!conf.enabled) return;
      // 社務所Web でチャンネルを選んでいれば、そこに出す
      const targets = conf.channelId ? [guild.channels.cache.get(conf.channelId)].filter(ch => ch?.type === ChannelType.GuildText) as import('discord.js').TextChannel[] : [...guild.channels.cache.values()].filter(ch => ch.type === ChannelType.GuildText && ch.name.replace(/[\s\u200b-\u200f\u2060\ufeff｜|・-]/g, '') === '🌸お部屋案内');
      if (targets.length !== 1) return;
      const target = targets[0]!;
      if (target.type !== ChannelType.GuildText) return;
      const [saved] = await this.db.select().from(settings).where(eq(settings.key, 'room_knock_directory'));
      const info = saved?.value as { channelId?: string; messageId?: string } | undefined;
      const message = info?.channelId === target.id && info.messageId ? await target.messages.fetch(info.messageId).catch(() => undefined) : undefined;
      if (!message || message.author.id !== guild.client.user.id) {
        // 保存直前に止まった場合は直近の自分の入口を再利用する。
        const recent = await target.messages.fetch({ limit: 30 });
        const existing = recent.find(m => m.author.id === guild.client.user.id && m.components.some(r => 'components' in r && r.components.some(c => 'customId' in c && c.customId === 'rkn:list:0')));
        const sent = existing ?? await target.send(roomDirectoryPanel());
        await this.db.insert(settings).values({ key: 'room_knock_directory', value: { channelId: target.id, messageId: sent.id }, updatedBy: 'system' }).onConflictDoUpdate({ target: settings.key, set: { value: { channelId: target.id, messageId: sent.id }, updatedAt: new Date() } });
      }
      for (const ch of guild.channels.cache.values()) if (ch.type === ChannelType.GuildVoice && await this.eligible(ch)) await this.lock.run(ch.id, async () => {
        let s = await roomKnockState(this.db, ch.id);
        if (!humans(ch).size && (s.mode !== 'open' || s.pending)) {
          if (s.pending?.messageId) await ch.messages.edit(s.pending.messageId, notice(ch.id, s.pending, '部屋が空になったため受付を終了しました。')).catch(() => undefined);
          if (s.controlId) await ch.messages.edit(s.controlId, roomKnockControls(ch.id, 'open')).catch(() => undefined);
          await resetRoomKnock(this.db, ch.id);
          s = await roomKnockState(this.db, ch.id);
        }
        if (s.pending && (s.pending.answered || s.pending.expires <= Date.now())) {
          if (s.pending.messageId && !s.pending.answered) await ch.messages.edit(s.pending.messageId, notice(ch.id, s.pending, '受付時間が終了しました。')).catch(() => undefined);
          await cancelKnock(this.db, ch.id, s.pending.id);
        }
        if (humans(ch).size) await this.control(ch);
      }).catch(err => logger.warn({ err, channelId: ch.id }, 'room knock control failed'));
    } finally { this.ticking = false; }
  }
  private async control(ch: VoiceChannel) {
    const s = await roomKnockState(this.db, ch.id);
    const msg = s.controlId ? await ch.messages.fetch(s.controlId).catch(() => undefined) : undefined;
    const body = roomKnockControls(ch.id, s.mode);
    if (msg?.author.id === ch.guild.client.user.id) {
      if (msg.content !== body.content) await msg.edit(body);
      return;
    }
    const recent = await ch.messages.fetch({ limit: 30 });
    const existing = recent.find(m => m.author.id === ch.guild.client.user.id && m.components.some(r => 'components' in r && r.components.some(c => 'customId' in c && c.customId === `rkn:mode:${ch.id}:open`)));
    const sent = existing ? await existing.edit(body) : await ch.send(body);
    await setKnockControl(this.db, ch.id, sent.id);
  }
  async onVoiceStateUpdate(before: VoiceState, after: VoiceState) {
    if (after.guild.id !== this.cfg().guildId || before.channelId === after.channelId) return;
    const left = before.channel;
    if (left?.type === ChannelType.GuildVoice && !humans(left).size) await this.lock.run(left.id, async () => {
      const s = await roomKnockState(this.db, left.id);
      if (s.pending?.messageId) await left.messages.edit(s.pending.messageId, notice(left.id, s.pending, '部屋が空になったため受付を終了しました。')).catch(() => undefined);
      if (s.mode !== 'open' || s.pending) await resetRoomKnock(this.db, left.id);
      if (s.controlId) await left.messages.edit(s.controlId, roomKnockControls(left.id, 'open')).catch(() => undefined);
    });
    const joined = after.channel;
    if (joined?.type === ChannelType.GuildVoice && (await roomKnockConfig(this.db)).enabled && await this.eligible(joined)) await this.lock.run(joined.id, () => this.control(joined));
  }
  private async list(guild: Guild, member: GuildMember, page: number) {
    const rooms = await this.available(guild, member);
    const max = Math.max(0, Math.ceil(rooms.length / 20) - 1);
    page = Math.max(0, Math.min(max, page));
    const slice = rooms.slice(page * 20, page * 20 + 20);
    const options = [];
    for (const ch of slice) {
      const s = await roomKnockState(this.db, ch.id);
      options.push({ label: ch.name.slice(0, 100), value: ch.id, description: `${humans(ch).size}人｜${humans(ch).size ? ROOM_MODES[s.mode] : '空室・出入り自由'}` });
    }
    const components: (ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>)[] = [];
    if (options.length) components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId('rkn:select').setPlaceholder('部屋を選ぶ').addOptions(options)));
    components.push(row(button(`rkn:list:${Math.max(0, page - 1)}`, '前へ').setDisabled(page === 0), button(`rkn:list:${Math.min(max, page + 1)}`, '次へ').setDisabled(page === max), button(`rkn:list:${page}`, '🔄 更新')));
    return { content: `**🌸 お部屋一覧（${page + 1}/${max + 1}）**\n${options.length ? '部屋を選ぶと、受付の状態と操作が表示されます。' : '利用できる宿のお部屋はありません。'}`, components, allowedMentions: noPing };
  }
  async onInteraction(i: Interaction) {
    if (!(i.isButton() || i.isStringSelectMenu()) || !i.customId.startsWith('rkn:') || !i.inCachedGuild() || i.guildId !== this.cfg().guildId) return;
    await i.deferReply(PRIVATE);
    const conf = await roomKnockConfig(this.db);
    if (!conf.enabled) return void await i.editReply('いま、こんこんとお部屋案内はお休みしています。');
    try {
      const actor = await i.guild.members.fetch({ user: i.user.id, force: true });
      const parts = i.customId.split(':');
      if (parts[1] === 'list') return void await i.editReply(await this.list(i.guild, actor, /^\d{1,4}$/.test(parts[2] ?? '') ? Number(parts[2]) : 0));
      const id = i.isStringSelectMenu() && parts[1] === 'select' ? i.values[0] : parts[2];
      const ch = id ? i.guild.channels.cache.get(id) : undefined;
      if (ch?.type !== ChannelType.GuildVoice || !this.canEnter(ch, actor) || !(await this.eligible(ch))) return void await i.editReply('この部屋は利用できません。部屋一覧を更新してください。');
      await this.lock.run(ch.id, async () => {
        // 操作待ちの間に部屋を移動した場合も、現在の在室状況を使う。
        const s = await roomKnockState(this.db, ch.id);
        const inside = actor.voice.channelId === ch.id && ch.members.has(actor.id);
        if (parts[1] === 'select') {
          const occupied = humans(ch).size > 0;
          const components = [row(link(ch))];
          if (!inside && occupied && s.mode === 'knock') components.unshift(row(button(`rkn:knock:${ch.id}`, '🚪 こんこんする', ButtonStyle.Primary)));
          if (inside) components.push(roomKnockControls(ch.id, s.mode).components[0]!);
          await i.editReply({ content: `**${escapeMarkdown(ch.name)}**\n${occupied ? `${humans(ch).size}人｜${ROOM_MODES[s.mode]}` : '空室・自由に利用できます。'}${s.mode === 'busy' && occupied ? '\nいまは入室をお待ちください。' : ''}`, components, allowedMentions: noPing });
        } else if (parts[1] === 'mode') {
          if (!inside) return void await i.editReply('部屋にいる人だけが切り替えられます。');
          const mode = parts[3];
          if (mode !== 'open' && mode !== 'knock' && mode !== 'busy') return void await i.editReply('受付の状態を選び直してください。');
          if (mode !== 'knock' && s.pending?.messageId) await ch.messages.edit(s.pending.messageId, notice(ch.id, s.pending, '受付の状態が変わりました。')).catch(() => undefined);
          await setRoomKnockMode(this.db, ch.id, mode);
          await this.control(ch);
          await i.editReply(`${ROOM_MODES[mode]}にしました。`);
        } else if (parts[1] === 'knock') {
          if (inside || !humans(ch).size) return void await i.editReply(inside ? 'この部屋にいる人はこんこんできません。' : '空室です。こんこんせずに利用できます。');
          const r = await requestRoomKnock(this.db, ch.id, actor.id, i.id, Date.now(), { cooldownMs: conf.cooldownSec * 1000, windowMs: conf.windowSec * 1000 });
          if (r.status !== 'ok') return void await i.editReply(r.status === 'cooldown' ? `次のこんこんまで${r.seconds}秒お待ちください。` : r.status === 'full' ? '受付が混み合っています。少し待ってください。' : '今はこんこんを受け付けていません。部屋一覧を更新してください。');
          try {
            const body = notice(ch.id, r.pending, undefined, fmtSec(conf.windowSec));
            if (r.pending.messageId) await ch.messages.edit(r.pending.messageId, body);
            else {
              const recipients = [...humans(ch).keys()].slice(0, 50);
              const sent = await ch.send({ ...body, content: `${recipients.map(id => `<@${id}>`).join(' ')}\n${body.content}`, allowedMentions: { parse: [], users: recipients } });
              await recordKnockMessage(this.db, ch.id, r.pending.id, sent.id);
            }
            await i.editReply(`こんこんを送りました。返事はDMで届きます（受付は${fmtSec(conf.windowSec)}間）。DMを受け取れる設定にしてください。`);
          } catch (err) {
            await cancelKnock(this.db, ch.id, r.pending.id);
            logger.warn({ err, channelId: ch.id }, 'room knock notification failed');
            await i.editReply(`通知の送信を確認できませんでした。二重送信を避けるため、${fmtSec(conf.cooldownSec)}後にもう一度お試しください。`);
          }
        } else if (parts[1] === 'reply') {
          const reply = parts[4] as keyof typeof REPLIES;
          if (!inside || !Object.hasOwn(REPLIES, reply)) return void await i.editReply('現在この部屋にいる人だけが返事できます。');
          const p = await answerRoomKnock(this.db, ch.id, parts[3] ?? '');
          if (!p) return void await i.editReply('返事済み、または受付時間が終了しています。');
          if (p.messageId) await ch.messages.edit(p.messageId, notice(ch.id, p, REPLIES[reply])).catch(() => undefined);
          let failed = 0;
          for (const user of p.users) {
            if (ch.members.has(user)) continue;
            const recipient = await i.guild.members.fetch({ user, force: true }).catch(() => undefined);
            if (!recipient || !this.canEnter(ch, recipient)) continue;
            await i.client.users.send(user, { content: `🌸 ${escapeMarkdown(ch.name)}からの返事：**${REPLIES[reply]}**\nhttps://discord.com/channels/${i.guild.id}/${ch.id}\n入室の権限は変わりません。`, allowedMentions: noPing }).catch(() => { failed++; });
          }
          await i.editReply(`「${REPLIES[reply]}」と返事しました。${failed ? ` DMを届けられなかった人が${failed}人います。` : ''}`);
        } else await i.editReply('部屋一覧から選び直してください。');
      });
    } catch (err) {
      logger.warn({ err }, 'room knock interaction failed');
      await i.editReply('部屋や権限を確認できませんでした。少し待ってからお試しください。').catch(() => undefined);
    }
  }
}

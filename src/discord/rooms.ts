import {
  ActionRowBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  MessageFlags,
  type ButtonInteraction,
  type Guild,
  type ModalSubmitInteraction,
  type Interaction,
  type VoiceState,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
  type VoiceChannel,
} from 'discord.js';
import type { GuildConfig, TicketKind } from '../config.js';
import { ticketName } from '../services/tickets.js';
import type { Db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import {
  addInvites,
  changeRoomKind,
  hourlyPerPerson,
  listRooms,
  payEntry,
  isRoomKind,
  planOf,
  priceLabel,
  roomOf,
  roomOverwrites,
  ROOM_KINDS,
  startRoom,
  transferRoom,
  type Overwrite,
  type RoomKind,
  type RoomRow,
} from '../services/rooms.js';
import { OWNER_ALLOW } from './tempVoice.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
/** 名前の変更は Discord が 10 分に 2 回までにしているので、待ちすぎないように */
const EDIT_TIMEOUT_MS = 5000;

type PanelRow = Pick<RoomRow, 'ownerId' | 'hubId' | 'kind' | 'kindLocked' | 'invited'> & { payerId?: string | null };
type Btn = { type: 2; style: 1 | 2 | 3 | 4; label: string; custom_id: string; emoji?: { name: string }; disabled?: boolean };
const button = (custom_id: string, label: string, emoji: string, style: Btn['style'] = 2, disabled = false): Btn => ({
  type: 2,
  style,
  label,
  custom_id,
  emoji: { name: emoji },
  ...(disabled ? { disabled } : {}),
});
const buttons = (...list: Btn[]) => ({ type: 1 as const, components: list });

/** 部屋のチャットに出す案内（だれでも見える）。設定は「⚙ 部屋の設定」を押した作った人にだけ出る */
/** 使った券の説明（一日券で無料・無料券を使った・半額券を使った） */
export function ticketUsedText(r: { ticketKind?: TicketKind; pass?: boolean; charged: number; ticket?: boolean }): string {
  if (!r.ticketKind) return '';
  if (r.pass) return `${ticketName(r.ticketKind)}を使っているので無料です`;
  return r.ticket ? `${ticketName(r.ticketKind)}を 1 枚使いました（部屋代は無料です）` : `${ticketName(r.ticketKind)}を 1 枚使いました（${r.charged} 枚を払いました）`;
}

export function roomNotice(cfg: GuildConfig, row: Pick<RoomRow, 'ownerId' | 'hubId'>) {
  const plan = planOf(cfg, row.hubId);
  const lines = [`<@${row.ownerId}> さんの部屋です。設定は、部屋を作った人だけが「⚙ 部屋の設定」から変えられます。`];
  if (plan !== 'none') {
    const how =
      plan === 'hourly'
        ? '入っている人それぞれが 1 時間ごとに払います（入ったときに最初の 1 時間。払えなくなると、5 分後に通話から抜けます）'
        : '作った人が、ひらくたびに 1 回（種類を選んだら差額）';
    lines.push(
      '',
      ...(Object.keys(ROOM_KINDS) as RoomKind[]).map((key) => `${ROOM_KINDS[key].emoji} ${ROOM_KINDS[key].label} … ${priceLabel(cfg, plan, key)}（${ROOM_KINDS[key].description}）`),
      `-# ${cfg.economy.currencyEmoji} ${cfg.economy.currencyName}: ${how}`,
      ...(cfg.rooms.boosterDiscountPercent > 0
        ? [`-# 🏮 奉納（ブースト）している人は、部屋代が${cfg.rooms.boosterDiscountPercent >= 100 ? '無料' : ` ${cfg.rooms.boosterDiscountPercent}% 引き`}`]
        : []),
      '-# 部屋の種類は 1 回だけ選べます（あとから公開・非公開は切り替えられません）。招待限定・シークレット・ツーショットの部屋には、運営も入れません',
    );
  }
  return {
    embeds: [{ title: '🚪 部屋', description: lines.join('\n'), color: 0x6b5b95 }],
    components: [buttons(button('room:open', '部屋の設定', '⚙', 1))],
    allowedMentions: { parse: [] as const },
  };
}

/** 作った人にだけ見える、部屋の設定（参考: チャンネル名・ステータス・人数制限・入室許可者・閉じる） */
export function roomPanel(cfg: GuildConfig, row: PanelRow, ch: { name: string; userLimit: number }, note?: string) {
  const plan = planOf(cfg, row.hubId);
  const k = ROOM_KINDS[row.kind];
  const canChoose = plan !== 'none' && !row.kindLocked;
  const lines = [
    ...(note ? [`✅ ${note}`, ''] : []),
    `・チャンネル名: **${ch.name}**`,
    ...(plan !== 'none' ? [`・部屋の種類: ${k.emoji} ${k.label}${row.kindLocked ? '（決定済み）' : '（まだ 1 回選べます）'}`] : []),
    `・人数制限: ${ch.userLimit ? `${ch.userLimit} 人まで` : 'なし'}`,
    `・入室許可者: ${row.invited.length ? row.invited.map((id) => `<@${id}>`).join(' ') : 'なし'}`,
    ...(plan !== 'none' && row.payerId && row.payerId !== row.ownerId ? [`・部屋主の分の部屋代: <@${row.payerId}> さんが持っています`] : []),
    '',
    '変更したい項目のボタンを押してください：',
  ];
  return {
    embeds: [{ title: '⚙ 部屋の設定', description: lines.join('\n'), color: 0x6b5b95 }],
    components: [
      buttons(button('room:name', 'チャンネル名', '📝'), button('room:status', 'ステータス', '💬'), button('room:limit', '人数制限', '👥', 2, row.kind === 'twoshot')),
      buttons(
        button('room:invite', '入室許可者を追加', '➕', 1),
        ...(canChoose ? [button('room:kind', '部屋の種類を選ぶ（1 回だけ）', '🔒', 2)] : []),
        button('room:xfer', '権限を譲渡', '👑'),
        button('room:close', '閉じる', '✖️'),
      ),
    ],
    allowedMentions: { parse: [] as const },
  };
}

/** Discord が混んでいても待ちすぎない（名前の変更など） */
async function withTimeout<T>(p: Promise<T>): Promise<T | 'timeout'> {
  let t: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>((resolve) => (t = setTimeout(() => resolve('timeout'), EDIT_TIMEOUT_MS)));
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(t);
  }
}

type RoomInteraction =
  | ButtonInteraction<'cached'>
  | StringSelectMenuInteraction<'cached'>
  | UserSelectMenuInteraction<'cached'>
  | ModalSubmitInteraction<'cached'>;

export class RoomApp {
  private guild?: Guild;

  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
    /** 部屋を閉じる（TempVoiceApp） */
    private readonly close: (channelId: string) => Promise<void>,
  ) {}

  attach(guild: Guild): void {
    this.guild = guild;
  }

  private voice(channelId: string): VoiceChannel | undefined {
    const ch = this.guild?.channels.cache.get(channelId);
    return ch?.isVoiceBased() && ch.isTextBased() && 'userLimit' in ch ? (ch as VoiceChannel) : undefined;
  }

  /** 部屋ができたとき（宿坊・宵宮だけ。縁側・屋台などには出さない）: 公開の値段を払い、部屋の案内を出す */
  async onCreated(channelId: string, ownerId: string): Promise<void> {
    const cfg = this.cfg();
    const row = await roomOf(this.db, channelId);
    if (!row || planOf(cfg, row.hubId) === 'none') return;
    const ch = this.voice(channelId);
    const r = await startRoom(this.db, cfg, channelId);
    if (r.status === 'insufficient') {
      await ch?.send({ content: `<@${ownerId}> さん、${this.cfg().economy.currencyName}が足りないため部屋をひらけませんでした（${r.price} 枚必要）。`, allowedMentions: { users: [ownerId] } }).catch(() => undefined);
      await this.close(channelId);
      return;
    }
    await ch?.send(roomNotice(cfg, row));
    if (r.ticketKind) await ch?.send({ content: `<@${ownerId}> さん: ${ticketUsedText(r)}。`, allowedMentions: { parse: [] } }).catch(() => undefined);
  }

  /** 種類に合わせて、見える・入れる範囲を付け直す */
  private async apply(ch: VoiceChannel, row: RoomRow, kind: RoomKind): Promise<void> {
    const parent = ch.parent;
    const base: Overwrite[] = parent
      ? parent.permissionOverwrites.cache.map((o) => ({ id: o.id, type: o.type as 0 | 1, allow: o.allow.bitfield, deny: o.deny.bitfield }))
      : [];
    const list = roomOverwrites(base, kind, { ownerId: row.ownerId, botId: ch.client.user.id, invited: row.invited, ownerAllow: OWNER_ALLOW });
    await ch.permissionOverwrites.set(
      list.map((o) => ({ id: o.id, type: o.type, allow: o.allow, deny: o.deny })),
      `部屋の種類: ${ROOM_KINDS[kind].label}`,
    );
    if (kind === 'twoshot') await ch.setUserLimit(2);
    else if (row.kind === 'twoshot') await ch.setUserLimit(0);
  }

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    if (!(interaction.isButton() || interaction.isStringSelectMenu() || interaction.isUserSelectMenu() || interaction.isModalSubmit())) return;
    if (!interaction.customId.startsWith('room:')) return;
    const i = interaction as RoomInteraction;
    try {
      const row = await roomOf(this.db, i.channelId ?? '');
      const ch = this.voice(i.channelId ?? '');
      if (!row || !ch || planOf(this.cfg(), row.hubId) === 'none') return void (await i.reply({ content: 'この部屋はもうありません。', ...EPHEMERAL }));
      // 操作は部屋を作った本人だけ
      if (i.user.id !== row.ownerId) return void (await i.reply({ content: '部屋の設定は、部屋を作った人だけが使えます。', ...EPHEMERAL }));
      const id = i.customId;
      if (i.isButton()) {
        if (id === 'room:open') return void (await i.reply({ ...roomPanel(this.cfg(), row, ch), ...EPHEMERAL }));
        if (id === 'room:back') return void (await i.update(roomPanel(this.cfg(), row, ch)));
        if (id === 'room:close') return await this.closePanel(i);
        if (id === 'room:name') return await this.textModal(i, 'room:namemodal', 'チャンネル名', ch.name, 100);
        if (id === 'room:status') return await this.textModal(i, 'room:statusmodal', 'ステータス（通話の下に出る一言。空で消す）', '', 500, false);
        if (id === 'room:limit') return await this.textModal(i, 'room:limitmodal', '人数制限（0 でなし・99 まで）', String(ch.userLimit), 2);
        if (id === 'room:invite') return void (await i.update(this.invitePicker(row)));
        if (id === 'room:kind') return void (await i.update(this.kindPicker(row)));
        if (id === 'room:xfer') return await this.transferPicker(i, row, ch);
        if (id.startsWith('room:xferok:')) {
          const [, , to, pay] = id.split(':');
          if (to && (pay === 'new' || pay === 'keep')) return await this.transfer(i, row, ch, to, pay === 'keep');
        }
      }
      if (i.isModalSubmit()) {
        const v = i.fields.getTextInputValue('value').trim();
        if (id === 'room:namemodal') return await this.rename(i, row, ch, v);
        if (id === 'room:statusmodal') return await this.setStatus(i, row, ch, v);
        if (id === 'room:limitmodal') return await this.limit(i, row, ch, v);
      }
      if (i.isStringSelectMenu() && id === 'room:kindpick') return await this.kind(i, row, ch);
      if (i.isUserSelectMenu() && id === 'room:invitepick') return await this.invite(i, row, ch);
      if (i.isStringSelectMenu() && id === 'room:xferpick') return await this.transferConfirm(i, row, ch);
    } catch (err) {
      logger.warn({ err }, 'room settings failed');
      const content = 'うまくいきませんでした。BOT に「チャンネルの管理」「ロールの管理」の権限があるか、神職に確かめてもらってください。';
      await (i.deferred || i.replied ? i.followUp({ content, ...EPHEMERAL }) : i.reply({ content, ...EPHEMERAL })).catch(() => undefined);
    }
  }

  /** パネルを閉じる（本人にだけ見えるメッセージを消す） */
  private async closePanel(i: ButtonInteraction<'cached'>): Promise<void> {
    await i.deferUpdate();
    await i.deleteReply().catch(() => i.editReply({ content: '閉じました。', embeds: [], components: [] }));
  }

  private async textModal(i: ButtonInteraction<'cached'>, customId: string, label: string, value: string, max: number, required = true): Promise<void> {
    const input = new TextInputBuilder().setCustomId('value').setLabel(label).setStyle(TextInputStyle.Short).setMaxLength(max).setRequired(required);
    if (value) input.setValue(value);
    await i.showModal(new ModalBuilder().setCustomId(customId).setTitle('部屋の設定').addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input)));
  }

  /** 変えたあと: パネルを書き換える（パネルから開いたフォームなら、そのパネルを） */
  private async done(i: RoomInteraction, row: RoomRow, ch: { name: string; userLimit: number }, note: string): Promise<void> {
    const panel = roomPanel(this.cfg(), row, ch, note);
    if (i.isModalSubmit() && i.isFromMessage()) await i.update(panel);
    else if (i.isMessageComponent()) await i.update(panel);
    else await i.reply({ ...panel, ...EPHEMERAL });
  }

  private async rename(i: ModalSubmitInteraction<'cached'>, row: RoomRow, ch: VoiceChannel, name: string): Promise<void> {
    if (!name) return void (await i.reply({ content: '名前を入れてください。', ...EPHEMERAL }));
    await i.deferUpdate();
    const r = await withTimeout(ch.setName(name.slice(0, 100), '部屋の名前（作った人）'));
    const note = r === 'timeout' ? 'チャンネル名を変えています（Discord が混んでいるので、反映まで少しかかります。名前は 10 分に 2 回まで変えられます）' : `チャンネル名を「${name}」にしました`;
    await i.editReply(roomPanel(this.cfg(), row, { name: r === 'timeout' ? ch.name : name.slice(0, 100), userLimit: ch.userLimit }, note));
  }

  private async setStatus(i: ModalSubmitInteraction<'cached'>, row: RoomRow, ch: VoiceChannel, status: string): Promise<void> {
    await ch.client.rest.put(`/channels/${ch.id}/voice-status`, { body: { status }, reason: '部屋のステータス（作った人）' });
    await this.done(i, row, ch, status ? `ボイスステータスを「${status}」にしました` : 'ボイスステータスを消しました');
  }

  private async limit(i: ModalSubmitInteraction<'cached'>, row: RoomRow, ch: VoiceChannel, v: string): Promise<void> {
    if (row.kind === 'twoshot') return void (await i.reply({ content: 'ツーショットの部屋は 2 人までです。', ...EPHEMERAL }));
    const n = Number(v || '0');
    if (!Number.isInteger(n) || n < 0 || n > 99) return void (await i.reply({ content: '人数は 0〜99 で入れてください（0 でなし）。', ...EPHEMERAL }));
    await ch.setUserLimit(n, '部屋の人数（作った人）');
    await this.done(i, row, { name: ch.name, userLimit: n }, n ? `人数制限を ${n} 人にしました` : '人数制限をなくしました');
  }

  private invitePicker(row: RoomRow) {
    return {
      embeds: [{ title: '➕ 入室許可者を追加', description: `入ってよい人を選んでください（最大 10 人ずつ）。${row.kind === 'twoshot' ? '\nツーショットの部屋は 1 人だけです。' : ''}`, color: 0x6b5b95 }],
      components: [
        new ActionRowBuilder<UserSelectMenuBuilder>()
          .addComponents(new UserSelectMenuBuilder().setCustomId('room:invitepick').setPlaceholder('入室を許可する人を選ぶ').setMinValues(1).setMaxValues(10))
          .toJSON(),
        buttons(button('room:back', '設定一覧に戻る', '↩️')),
      ],
    };
  }

  private kindPicker(row: RoomRow) {
    const cfg = this.cfg();
    const plan = planOf(cfg, row.hubId);
    return {
      embeds: [
        {
          title: '🔒 部屋の種類を選ぶ',
          description: '部屋の種類は **1 回だけ** 選べます。選んだあとは、公開・非公開を切り替えられません。',
          color: 0x6b5b95,
        },
      ],
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>()
          .addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('room:kindpick')
              .setPlaceholder('部屋の種類を選ぶ（1 回だけ）')
              .addOptions(
                (Object.keys(ROOM_KINDS) as RoomKind[]).map((key) => ({
                  label: `${ROOM_KINDS[key].label}（${priceLabel(cfg, plan, key)}）`,
                  value: key,
                  description: ROOM_KINDS[key].description,
                  emoji: ROOM_KINDS[key].emoji,
                })),
              ),
          )
          .toJSON(),
        buttons(button('room:back', '設定一覧に戻る', '↩️')),
      ],
    };
  }

  private async kind(i: StringSelectMenuInteraction<'cached'>, row: RoomRow, ch: VoiceChannel): Promise<void> {
    const kind = i.values[0];
    if (!isRoomKind(kind)) return;
    if (row.kindLocked) return void (await i.reply({ content: '部屋の種類はもう決まっています（1 回だけ選べます）。', ...EPHEMERAL }));
    if (kind === 'twoshot' && ch.members.filter((m) => !m.user.bot).size > 2) {
      return void (await i.reply({ content: '今 3 人以上いるので、ツーショットにはできません。', ...EPHEMERAL }));
    }
    const r = await changeRoomKind(this.db, this.cfg(), ch.id, kind);
    if (r.status === 'not_found') return void (await i.reply({ content: 'この部屋はもうありません。', ...EPHEMERAL }));
    if (r.status === 'locked') return void (await i.reply({ content: '部屋の種類はもう決まっています（1 回だけ選べます）。', ...EPHEMERAL }));
    if (r.status === 'insufficient') return void (await i.reply({ content: `${this.cfg().economy.currencyName}が足りません（${r.price} 枚必要）。`, ...EPHEMERAL }));
    if (kind !== row.kind) await this.apply(ch, row, kind);
    const k = ROOM_KINDS[kind];
    const paid = r.ticketKind ? `（${ticketUsedText(r)}）` : r.charged ? `（${this.cfg().economy.currencyName} ${r.charged} 枚を払いました）` : '';
    const limit = kind === 'twoshot' ? 2 : row.kind === 'twoshot' ? 0 : ch.userLimit;
    await this.done(i, { ...row, kind, kindLocked: true }, { name: ch.name, userLimit: limit }, `${k.emoji} ${k.label}にしました${paid}${kind === 'public' ? '' : '。入ってほしい人は「入室許可者を追加」から'}`);
  }

  /** 譲渡できる人（今この部屋にいる人。BOT と自分はのぞく） */
  private transferable(row: RoomRow, ch: VoiceChannel) {
    return [...ch.members.values()].filter((m) => !m.user.bot && m.id !== row.ownerId).slice(0, 25);
  }

  private async transferPicker(i: ButtonInteraction<'cached'>, row: RoomRow, ch: VoiceChannel): Promise<void> {
    const people = this.transferable(row, ch);
    if (!people.length) return void (await i.reply({ content: '譲渡できる人がいません（今この部屋にいる人から選べます）。', ...EPHEMERAL }));
    await i.update({
      embeds: [{ title: '👑 権限を譲渡', description: '部屋の設定を使える人（部屋主）を、今この部屋にいる人から選んでください。', color: 0x6b5b95 }],
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>()
          .addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('room:xferpick')
              .setPlaceholder('譲渡する人を選ぶ')
              .addOptions(people.map((m) => ({ label: m.displayName.slice(0, 100), value: m.id }))),
          )
          .toJSON(),
        buttons(button('room:back', '設定一覧に戻る', '↩️')),
      ],
    });
  }

  /** 選んだあと: 部屋代をどうするか（値段のない部屋は確認だけ） */
  private async transferConfirm(i: StringSelectMenuInteraction<'cached'>, row: RoomRow, ch: VoiceChannel): Promise<void> {
    const to = i.values[0];
    if (!to || !this.transferable(row, ch).some((m) => m.id === to)) return void (await i.reply({ content: 'その人は今この部屋にいません。', ...EPHEMERAL }));
    const paid = planOf(this.cfg(), row.hubId) !== 'none';
    await i.update({
      embeds: [
        {
          title: '👑 権限を譲渡',
          description: paid
            ? `<@${to}> さんに部屋主の権限を譲渡します。\nこれからの部屋主の分の部屋代はどうしますか？`
            : `<@${to}> さんに部屋主の権限を譲渡します。よろしいですか？`,
          color: 0x6b5b95,
        },
      ],
      components: [
        paid
          ? buttons(button(`room:xferok:${to}:new`, 'これからは相手が払う', '🤝', 1), button(`room:xferok:${to}:keep`, '部屋代は自分が持つ', '💰', 3), button('room:back', 'やめる', '↩️'))
          : buttons(button(`room:xferok:${to}:new`, '譲渡する', '👑', 1), button('room:back', 'やめる', '↩️')),
      ],
      allowedMentions: { parse: [] },
    });
  }

  private async transfer(i: ButtonInteraction<'cached'>, row: RoomRow, ch: VoiceChannel, to: string, keepPaying: boolean): Promise<void> {
    if (!this.transferable(row, ch).some((m) => m.id === to)) return void (await i.reply({ content: 'その人は今この部屋にいません。', ...EPHEMERAL }));
    const r = await transferRoom(this.db, ch.id, row.ownerId, to, keepPaying);
    if (r.status !== 'ok') return void (await i.reply({ content: '譲渡できませんでした（もう部屋主ではないかもしれません）。', ...EPHEMERAL }));
    await this.apply(ch, r.row, r.row.kind);
    const paid = planOf(this.cfg(), row.hubId) !== 'none';
    const money = !paid ? '' : keepPaying ? `（部屋主の分の部屋代は <@${r.row.payerId ?? row.ownerId}> さんが持ちます）` : `（これからの部屋主の分の部屋代は <@${to}> さんが払います）`;
    await i.update({ content: `👑 <@${to}> さんに権限を譲渡しました。${money}`, embeds: [], components: [], allowedMentions: { parse: [] } });
    await ch.send({ content: `👑 <@${row.ownerId}> さんから <@${to}> さんに、部屋主の権限を譲渡しました。${money}\n-# 部屋の設定は「⚙ 部屋の設定」から <@${to}> さんが使えます`, allowedMentions: { users: [to] } });
  }

  private async invite(i: UserSelectMenuInteraction<'cached'>, row: RoomRow, ch: VoiceChannel): Promise<void> {
    const ids = i.values.filter((id) => id !== row.ownerId && !i.users.get(id)?.bot);
    if (!ids.length) return void (await i.reply({ content: '招待できる人がいません（自分・BOT は選べません）。', ...EPHEMERAL }));
    if (row.kind === 'twoshot' && new Set([...row.invited, ...ids]).size > 1) {
      return void (await i.reply({ content: 'ツーショットの部屋に招待できるのは 1 人だけです。', ...EPHEMERAL }));
    }
    const updated = await addInvites(this.db, ch.id, ids);
    if (!updated) return;
    await this.apply(ch, updated, updated.kind);
    await this.done(i, updated, ch, `${ids.map((id) => `<@${id}>`).join(' ')} さんの入室を許可しました`);
    // 招待された人に通知（この部屋のチャットで呼ぶ）
    await ch.send({ content: `${ids.map((id) => `<@${id}>`).join(' ')} さん、<@${row.ownerId}> さんから <#${ch.id}> への招待です。`, allowedMentions: { users: ids } });
  }

  /** 1 時間ごとの部屋（宵宮）に入ったとき: その人の最初の 1 時間を払う。足りなければ通話から抜けてもらう */
  async onVoiceStateUpdate(before: VoiceState, after: VoiceState): Promise<void> {
    const member = after.member;
    if (!after.channelId || after.channelId === before.channelId || !member || member.user.bot) return;
    if (after.guild.id !== this.cfg().guildId) return;
    try {
      const r = await payEntry(this.db, this.cfg(), after.channelId, member.id);
      if (r.status !== 'insufficient') return;
      await member.voice.disconnect(`${this.cfg().economy.currencyName}が足りない（宵宮の部屋）`).catch(() => undefined);
      await this.voice(after.channelId)
        ?.send({ content: `<@${member.id}> さん、${this.cfg().economy.currencyName}が足りないため入れませんでした（1 時間 ${r.price} 枚）。`, allowedMentions: { users: [member.id] } })
        .catch(() => undefined);
    } catch (err) {
      logger.warn({ err }, 'room entry payment failed');
    }
  }

  /** 1 分ごと: 1 時間ごとの部屋（宵宮）に今いる人それぞれの支払い */
  async tick(): Promise<void> {
    const cfg = this.cfg();
    const present = (await listRooms(this.db)).flatMap((r) => {
      const ch = this.voice(r.channelId);
      return ch ? [{ channelId: r.channelId, memberIds: [...ch.members.values()].filter((m) => !m.user.bot).map((m) => m.id) }] : [];
    });
    for (const a of await hourlyPerPerson(this.db, cfg, present)) {
      const ch = this.voice(a.channelId);
      try {
        if (a.action === 'warned') {
          await ch?.send({ content: `<@${a.memberId}> さん、次の 1 時間の${this.cfg().economy.currencyName}（${a.price} 枚）が足りません。5 分以内に払えないと、通話から抜けます。`, allowedMentions: { users: [a.memberId] } });
        } else if (a.action === 'kick') {
          await ch?.members.get(a.memberId)?.voice.disconnect(`${this.cfg().economy.currencyName}が足りない（宵宮の部屋）`);
          await ch?.send({ content: `<@${a.memberId}> さんは、${this.cfg().economy.currencyName}が足りないため通話から抜けました。`, allowedMentions: { parse: [] } });
        }
      } catch (err) {
        logger.warn({ err, channelId: a.channelId }, 'room hourly action failed');
      }
    }
  }
}

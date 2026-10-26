import {
  ActionRowBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  MessageFlags,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type Message,
  type ModalSubmitInteraction,
  type Interaction,
  type VoiceState,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
  type VoiceChannel,
} from 'discord.js';
import { adminLevelOf, type GuildConfig, type TicketKind } from '../config.js';
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
  staffSetRoomKind,
  startRoom,
  transferRoom,
  type Overwrite,
  type RoomKind,
  type RoomRow,
} from '../services/rooms.js';
import { OWNER_ALLOW } from './tempVoice.js';
import { KeyedLock } from '../lib/lock.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
/** 名前の変更は Discord が 10 分に 2 回までにしているので、待ちすぎないように */
const EDIT_TIMEOUT_MS = 5000;

/** シクレの目印は名前を変えても残す。運営が公開に戻したら外す */
export function roomChannelName(name: string, kind: RoomKind): string {
  const prefix = '🤫 シクレ｜';
  let base = name;
  while (base.startsWith(prefix)) base = base.slice(prefix.length);
  const head = kind === 'secret' ? prefix : '';
  return head + base.slice(0, 100 - head.length);
}

type PanelRow = Pick<RoomRow, 'ownerId' | 'hubId' | 'kind' | 'kindLocked' | 'invited'> & { payerId?: string | null; keepUntil?: Date | null };
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

export function roomNotice(cfg: GuildConfig, row: Pick<RoomRow, 'ownerId' | 'hubId'> & { keepUntil?: Date | null; renewHourly?: boolean }, opts: { secret?: boolean } = {}) {
  const plan = planOf(cfg, row.hubId);
  const lines = [`<@${row.ownerId}> さんの部屋です。設定は、部屋を作った人（と運営）が「⚙ 部屋の設定」から変えられます。`];
  if (opts.secret) {
    // 🤫 シクレ部屋: はじめからシクレ。種類は変えない（名前・人数・入室許可者は変えられる）
    lines.push('', '🤫 **シクレ部屋**です（自分と、入室許可した人にだけ見えます）。種類は変えられません。', '-# 全員が抜けたら消えます');
  } else if (row.keepUntil) {
    // 🏨 買った 24 時間の宿: 種類は何度でも、追加の部屋代なしで変えられる
    lines.push(
      '',
      row.renewHourly
        ? `⏱ **1時間ごとの宿**です（1 時間ごとに <@${row.ownerId}> さんが ${cfg.rooms.stayHourlyPrice.toLocaleString('ja-JP')} ${cfg.economy.currencyName}を自動で払います（🏮 奉納している人は無料）。払う時刻にだれもいないか、${cfg.economy.currencyName}が足りなければ、宿は消えます）。`
        : `🏨 **24時間残る宿**です（${row.keepUntil.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} まで、だれもいなくても残ります）。`,
      ...(Object.keys(ROOM_KINDS) as RoomKind[]).map((key) => `${ROOM_KINDS[key].emoji} ${ROOM_KINDS[key].label}（${ROOM_KINDS[key].description}）`),
      '-# 部屋の種類（オープン・招待のみ・シクレなど）は、何度でも変えられます。追加の部屋代はかかりません',
    );
  } else if (plan === 'free') {
    lines.push(
      '',
      '💎 **極の部屋**です（極の VIP の人だけが見える・入れる）。部屋代はかかりません。',
      ...(Object.keys(ROOM_KINDS) as RoomKind[]).map((key) => `${ROOM_KINDS[key].emoji} ${ROOM_KINDS[key].label}（${ROOM_KINDS[key].description}）`),
      '-# 部屋の種類は 1 回だけ選べます。招待した人は VIP でなくても入れます',
    );
  } else if (plan !== 'none') {
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
      '-# 部屋の種類は 1 回だけ選べます（あとから公開・非公開は切り替えられません）。招待限定・シークレットの部屋には、運営も入れません',
    );
  }
  return {
    embeds: [{ title: '🚪 部屋', description: lines.join('\n'), color: 0x6b5b95 }],
    components: [buttons(button('room:open', '部屋の設定', '⚙', 1))],
    allowedMentions: { parse: [] as const },
  };
}

/**
 * どの部屋のパネルか（部屋のチャット以外から開いたとき、ボタンの ID の後ろに「|部屋の ID」を付ける）と、
 * 運営として開いているか（部屋主でない神職・宮司。種類は決まっていても変えられ、差額は取らない）
 */
export type PanelView = { staff?: boolean; at?: string };
const sid = (id: string, v: PanelView) => (v.at ? `${id}|${v.at}` : id);

/** 作った人（と運営）にだけ見える、部屋の設定（参考: チャンネル名・ステータス・人数制限・入室許可者・閉じる） */
export function roomPanel(cfg: GuildConfig, row: PanelRow, ch: { name: string; userLimit: number }, note?: string, v: PanelView = {}) {
  const plan = planOf(cfg, row.hubId);
  const k = ROOM_KINDS[row.kind];
  const canChoose = plan !== 'none' && (!row.kindLocked || v.staff);
  const lines = [
    ...(v.staff ? [`🛡 運営として開いています（<@${row.ownerId}> さんの部屋）`, ''] : []),
    ...(note ? [`✅ ${note}`, ''] : []),
    `・チャンネル名: **${ch.name}**`,
    ...(plan !== 'none' ? [`・部屋の種類: ${k.emoji} ${k.label}${row.keepUntil && !row.kindLocked ? '（🏨 何度でも変えられます）' : row.kindLocked ? '（決定済み）' : '（まだ 1 回選べます）'}`] : []),
    `・人数制限: ${ch.userLimit ? `${ch.userLimit} 人まで` : 'なし'}`,
    `・入室許可者: ${row.invited.length ? row.invited.map((id) => `<@${id}>`).join(' ') : 'なし'}`,
    ...(plan !== 'none' && row.payerId && row.payerId !== row.ownerId ? [`・部屋主の分の部屋代: <@${row.payerId}> さんが持っています`] : []),
    '',
    '変更したい項目のボタンを押してください：',
  ];
  return {
    embeds: [{ title: '⚙ 部屋の設定', description: lines.join('\n'), color: 0x6b5b95 }],
    components: [
      buttons(
        button(sid('room:name', v), 'チャンネル名', '📝'),
        button(sid('room:status', v), 'ステータス', '💬'),
        button(sid('room:limit', v), '人数制限', '👥', 2),
      ),
      buttons(
        button(sid('room:invite', v), '入室許可者を追加', '➕', 1),
        ...(canChoose ? [button(sid('room:kind', v), v.staff ? '部屋の種類を変える（運営）' : '部屋の種類を選ぶ（1 回だけ）', '🔒', 2)] : []),
        button(sid('room:xfer', v), '権限を譲渡', '👑'),
        button(sid('room:close', v), '閉じる', '✖️'),
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
  private readonly noticeIds = new Map<string, string>();
  private readonly noticeLock = new KeyedLock();
  private restoringNotices = false;

  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
    /** 部屋を閉じる（TempVoiceApp） */
    private readonly close: (channelId: string) => Promise<void>,
  ) {}

  async attach(guild: Guild): Promise<void> {
    this.guild = guild;
    await this.restoreRoomNotices();
  }

  /** 宿は名前を変えても、部屋の記録と入口の設定で保護する。 */
  async preservesMessages(channelId: string): Promise<boolean> {
    const cfg = this.cfg();
    const row = await roomOf(this.db, channelId);
    if (row && (row.keepUntil || planOf(cfg, row.hubId) !== 'none')) return true;
    if (planOf(cfg, channelId) !== 'none') return true;
    return this.voice(channelId)?.parent?.name.includes('宿坊') ?? false;
  }

  /** 一度送ったパネルのIDを覚える。元の投稿は消さない。 */
  private async sendNotice(ch: VoiceChannel, row: RoomRow, opts: { secret?: boolean } = {}): Promise<void> {
    await this.noticeLock.run(ch.id, async () => {
      if (this.noticeIds.has(ch.id)) return;
      const sent = await ch.send(roomNotice(this.cfg(), row, opts));
      this.noticeIds.set(ch.id, sent.id);
    });
  }

  /** 古い案内に廃止した種類が残っていれば、同じ投稿を書きかえる。 */
  private async refreshLegacyNotice(message: Message, row: RoomRow) {
    if (!message.embeds?.some(e => e.description?.includes('ツーショット'))) return;
    const current = await roomOf(this.db, row.channelId);
    if (!current) return;
    const secret = this.cfg().tempVoice.hubs.find(h => h.channelId === current.hubId)?.kind === 'secret';
    await message.edit(roomNotice(this.cfg(), current, { secret }));
  }

  /** 消えていた設定入口だけを復旧する。購入や設定の変更はしない。 */
  async restoreRoomNotices(): Promise<void> {
    if (!this.guild || this.restoringNotices) return;
    this.restoringNotices = true;
    try {
      const rows = await listRooms(this.db);
      const alive = new Set(rows.map(row => row.channelId));
      for (const id of this.noticeIds.keys()) if (!alive.has(id)) this.noticeIds.delete(id);
      for (const row of rows) {
        if (!row.keepUntil && planOf(this.cfg(), row.hubId) === 'none') continue;
        const ch = this.voice(row.channelId);
        if (!ch) continue;
        await this.noticeLock.run(ch.id, async () => {
          const known = this.noticeIds.get(ch.id);
          if (known) {
            try { const message = await ch.messages.fetch({ message: known, force: true }); await this.refreshLegacyNotice(message, row); return; }
            catch (err) {
              if (!(err && typeof err === 'object' && 'code' in err && err.code === 10008)) throw err;
              this.noticeIds.delete(ch.id);
            }
          }
          const recent = await ch.messages.fetch({ limit: 100 });
          const existing = recent.find(message => message.author.id === this.guild!.client.user.id &&
            message.components.some(group => 'components' in group && group.components.some(component =>
              'customId' in component && component.customId === 'room:open')));
          if (existing) { await this.refreshLegacyNotice(existing, row); this.noticeIds.set(ch.id, existing.id); return; }
          const current = await roomOf(this.db, ch.id);
          if (!current) return;
          const secret = this.cfg().tempVoice.hubs.find(h => h.channelId === current.hubId)?.kind === 'secret';
          const sent = await ch.send(roomNotice(this.cfg(), current, { secret }));
          this.noticeIds.set(ch.id, sent.id);
        }).catch(err => logger.warn({ err, channelId: row.channelId }, 'room control panel restore failed'));
      }
    } finally { this.restoringNotices = false; }
  }

  private voice(channelId: string): VoiceChannel | undefined {
    const ch = this.guild?.channels.cache.get(channelId);
    return ch?.isVoiceBased() && ch.isTextBased() && 'userLimit' in ch ? (ch as VoiceChannel) : undefined;
  }

  /** 部屋ができたとき（宿坊・宵宮だけ。縁側・屋台などには出さない）: 公開の値段を払い、部屋の案内を出す */
  async onCreated(channelId: string, ownerId: string, opts: { secret?: boolean; stay?: boolean } = {}): Promise<void> {
    const cfg = this.cfg();
    const row = await roomOf(this.db, channelId);
    if (!row || planOf(cfg, row.hubId) === 'none') return;
    const ch = this.voice(channelId);
    // 🏨 24 時間の宿: 宿代はパネルで払った。案内だけ出す
    if (opts.stay) {
      if (ch) await this.sendNotice(ch, row);
      return;
    }
    // 🤫 シクレの入口: はじめからシークレットの部屋代を払い、種類を決める（部屋は作ったときから見えない）
    const secretHub = opts.secret || cfg.tempVoice.hubs.find((h) => h.channelId === row.hubId)?.kind === 'secret';
    const r = secretHub ? await changeRoomKind(this.db, cfg, channelId, 'secret') : await startRoom(this.db, cfg, channelId);
    if (r.status === 'not_found' || r.status === 'locked') return;
    if (secretHub && ch) {
      const fresh = await roomOf(this.db, channelId);
      if (fresh) await this.apply(ch, { ...fresh, kind: 'public' }, 'secret').catch((err: unknown) => logger.warn({ err, channelId }, 'secret hub room apply failed'));
    }
    if (r.status === 'insufficient') {
      await ch?.send({ content: `<@${ownerId}> さん、${this.cfg().economy.currencyName}が足りないため部屋をひらけませんでした（${r.price} 枚必要）。`, allowedMentions: { users: [ownerId] } }).catch(() => undefined);
      await this.close(channelId);
      return;
    }
    if (ch) await this.sendNotice(ch, row, { secret: secretHub });
    if (r.ticketKind) await ch?.send({ content: `<@${ownerId}> さん: ${ticketUsedText(r)}。`, allowedMentions: { parse: [] } }).catch(() => undefined);
  }

  /** 種類に合わせて、見える・入れる範囲を付け直す */
  private async apply(ch: VoiceChannel, row: RoomRow, kind: RoomKind): Promise<void> {
    // もとにする見える範囲: カテゴリ（宵宮なら宵参りの人だけ）。💎 極の部屋は入口と同じ（VIP だけ）
    const hub = this.cfg().rooms.vip?.hubId === row.hubId ? this.guild?.channels.cache.get(row.hubId) : undefined;
    const source = hub && 'permissionOverwrites' in hub ? hub : ch.parent;
    const base: Overwrite[] = source
      ? source.permissionOverwrites.cache.map((o) => ({ id: o.id, type: o.type as 0 | 1, allow: o.allow.bitfield, deny: o.deny.bitfield }))
      : [];
    const list = roomOverwrites(base, kind, { ownerId: row.ownerId, botId: ch.client.user.id, invited: row.invited, ownerAllow: OWNER_ALLOW });
    await ch.permissionOverwrites.set(
      list.map((o) => ({ id: o.id, type: o.type, allow: o.allow, deny: o.deny })),
      `部屋の種類: ${ROOM_KINDS[kind].label}`,
    );
    const name = roomChannelName(ch.name, kind);
    if (name !== ch.name) {
      // 名前の制限待ちで、権限の変更や返事を止めない
      await withTimeout(ch.setName(name, '部屋の種類の目印')).catch((err) => logger.warn({ err, channelId: ch.id }, '部屋の目印を変更できませんでした'));
    }
  }

  /** 運営（神職・宮司） */
  private isStaff(i: { member: { roles: { cache: Map<string, unknown> } } }): boolean {
    return Boolean(adminLevelOf(this.cfg(), [...i.member.roles.cache.keys()]));
  }

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    // 🛡 /部屋の設定（運営）: 見えない部屋（シークレットなど）も、ここから設定を開ける
    if (interaction.isAutocomplete() && interaction.commandName === 'roomadmin') return void (await this.suggestRooms(interaction).catch(() => undefined));
    if (interaction.isChatInputCommand() && interaction.commandName === 'roomadmin') return void (await this.openAsStaff(interaction).catch((err) => logger.warn({ err }, 'room admin failed')));
    if (!(interaction.isButton() || interaction.isStringSelectMenu() || interaction.isUserSelectMenu() || interaction.isModalSubmit())) return;
    if (!interaction.customId.startsWith('room:')) return;
    const i = interaction as RoomInteraction;
    try {
      // 「|部屋の ID」が付いていればその部屋（/部屋の設定 から開いたパネル）、なければボタンのある部屋
      const [id, at] = i.customId.split('|') as [string, string | undefined];
      const roomId = at ?? i.channelId ?? '';
      const row = await roomOf(this.db, roomId);
      const ch = this.voice(roomId);
      if (!row || !ch || planOf(this.cfg(), row.hubId) === 'none') return void (await i.reply({ content: 'この部屋はもうありません。', ...EPHEMERAL }));
      // 操作は部屋を作った本人と、運営（神職・宮司）だけ
      const staff = i.user.id !== row.ownerId && this.isStaff(i);
      if (i.user.id !== row.ownerId && !staff) return void (await i.reply({ content: '部屋の設定は、部屋を作った人と運営だけが使えます。', ...EPHEMERAL }));
      const v: PanelView = { staff, ...(at ? { at } : {}) };
      if (i.isButton()) {
        if (id === 'room:open') return void (await i.reply({ ...roomPanel(this.cfg(), row, ch, undefined, v), ...EPHEMERAL }));
        if (id === 'room:back') return void (await i.update(roomPanel(this.cfg(), row, ch, undefined, v)));
        if (id === 'room:close') return await this.closePanel(i);
        if (id === 'room:name') return await this.textModal(i, sid('room:namemodal', v), 'チャンネル名', ch.name, 100);
        if (id === 'room:status') return await this.textModal(i, sid('room:statusmodal', v), 'ステータス（通話の下に出る一言。空で消す）', '', 500, false);
        if (id === 'room:limit') return await this.textModal(i, sid('room:limitmodal', v), '人数制限（0 でなし・99 まで）', String(ch.userLimit), 2);
        if (id === 'room:invite') return void (await i.update(this.invitePicker(row, v)));
        if (id === 'room:kind') return void (await i.update(this.kindPicker(row, v)));
        if (id === 'room:xfer') return await this.transferPicker(i, row, ch, v);
        if (id.startsWith('room:xferok:')) {
          const [, , to, pay] = id.split(':');
          if (to && (pay === 'new' || pay === 'keep')) return await this.transfer(i, row, ch, to, pay === 'keep' && !staff, v);
        }
      }
      if (i.isModalSubmit()) {
        const value = i.fields.getTextInputValue('value').trim();
        if (id === 'room:namemodal') return await this.rename(i, row, ch, value, v);
        if (id === 'room:statusmodal') return await this.setStatus(i, row, ch, value, v);
        if (id === 'room:limitmodal') return await this.limit(i, row, ch, value, v);
      }
      if (i.isStringSelectMenu() && id === 'room:kindpick') return await this.kind(i, row, ch, v);
      if (i.isUserSelectMenu() && id === 'room:invitepick') return await this.invite(i, row, ch, v);
      if (i.isStringSelectMenu() && id === 'room:xferpick') return await this.transferConfirm(i, row, ch, v);
    } catch (err) {
      logger.warn({ err }, 'room settings failed');
      const content = 'うまくいきませんでした。BOT に「チャンネルの管理」「ロールの管理」の権限があるか、神職に確かめてもらってください。';
      await (i.deferred || i.replied ? i.followUp({ content, ...EPHEMERAL }) : i.reply({ content, ...EPHEMERAL })).catch(() => undefined);
    }
  }

  /** 今ある部屋（宿坊・宵宮）: 名前か部屋主の名前で探す */
  private async suggestRooms(i: AutocompleteInteraction<'cached'>): Promise<void> {
    if (!this.isStaff(i)) return void (await i.respond([]));
    const q = i.options.getFocused().trim().toLowerCase();
    const cfg = this.cfg();
    const list = (await listRooms(this.db)).flatMap((r) => {
      const ch = this.voice(r.channelId);
      if (!ch || planOf(cfg, r.hubId) === 'none') return [];
      const owner = i.guild.members.cache.get(r.ownerId)?.displayName ?? r.ownerId;
      const k = ROOM_KINDS[r.kind];
      return [{ name: `${k.emoji} ${ch.name}（${owner} さん・${ch.members.size} 人）`.slice(0, 100), value: r.channelId }];
    });
    await i.respond(list.filter((x) => !q || x.name.toLowerCase().includes(q)).slice(0, 25));
  }

  private async openAsStaff(i: ChatInputCommandInteraction<'cached'>): Promise<void> {
    if (!this.isStaff(i)) return void (await i.reply({ content: '神職・宮司だけが使えます。', ...EPHEMERAL }));
    const roomId = i.options.getString('room', true);
    const row = /^\d{17,20}$/.test(roomId) ? await roomOf(this.db, roomId) : undefined;
    const ch = this.voice(roomId);
    if (!row || !ch || planOf(this.cfg(), row.hubId) === 'none') return void (await i.reply({ content: 'その部屋は見つかりませんでした（候補から選んでください）。', ...EPHEMERAL }));
    await i.reply({ ...roomPanel(this.cfg(), row, ch, undefined, { staff: i.user.id !== row.ownerId, at: row.channelId }), ...EPHEMERAL });
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
  private async done(i: RoomInteraction, row: RoomRow, ch: { name: string; userLimit: number }, note: string, v: PanelView = {}): Promise<void> {
    const panel = roomPanel(this.cfg(), row, ch, note, v);
    if (i.deferred) await i.editReply(panel);
    else if (i.isModalSubmit() && i.isFromMessage()) await i.update(panel);
    else if (i.isMessageComponent()) await i.update(panel);
    else await i.reply({ ...panel, ...EPHEMERAL });
  }

  private async rename(i: ModalSubmitInteraction<'cached'>, row: RoomRow, ch: VoiceChannel, name: string, v: PanelView = {}): Promise<void> {
    if (!name) return void (await i.reply({ content: '名前を入れてください。', ...EPHEMERAL }));
    await i.deferUpdate();
    name = roomChannelName(name, row.kind);
    const r = await withTimeout(ch.setName(name.slice(0, 100), v.staff ? '部屋の名前（運営）' : '部屋の名前（作った人）'));
    const note = r === 'timeout' ? 'チャンネル名を変えています（Discord が混んでいるので、反映まで少しかかります。名前は 10 分に 2 回まで変えられます）' : `チャンネル名を「${name}」にしました`;
    await i.editReply(roomPanel(this.cfg(), row, { name: r === 'timeout' ? ch.name : name.slice(0, 100), userLimit: ch.userLimit }, note, v));
  }

  private async setStatus(i: ModalSubmitInteraction<'cached'>, row: RoomRow, ch: VoiceChannel, status: string, v: PanelView = {}): Promise<void> {
    await ch.client.rest.put(`/channels/${ch.id}/voice-status`, { body: { status }, reason: v.staff ? '部屋のステータス（運営）' : '部屋のステータス（作った人）' });
    await this.done(i, row, ch, status ? `ボイスステータスを「${status}」にしました` : 'ボイスステータスを消しました', v);
  }

  private async limit(i: ModalSubmitInteraction<'cached'>, row: RoomRow, ch: VoiceChannel, value: string, v: PanelView = {}): Promise<void> {
    const n = Number(value || '0');
    if (!Number.isInteger(n) || n < 0 || n > 99) return void (await i.reply({ content: '人数は 0〜99 で入れてください（0 でなし）。', ...EPHEMERAL }));
    await ch.setUserLimit(n, v.staff ? '部屋の人数（運営）' : '部屋の人数（作った人）');
    await this.done(i, row, { name: ch.name, userLimit: n }, n ? `人数制限を ${n} 人にしました` : '人数制限をなくしました', v);
  }

  private invitePicker(row: RoomRow, v: PanelView = {}) {
    return {
      embeds: [{ title: '➕ 入室許可者を追加', description: `入ってよい人を選んでください（最大 10 人ずつ）。`, color: 0x6b5b95 }],
      components: [
        new ActionRowBuilder<UserSelectMenuBuilder>()
          .addComponents(new UserSelectMenuBuilder().setCustomId(sid('room:invitepick', v)).setPlaceholder('入室を許可する人を選ぶ').setMinValues(1).setMaxValues(10))
          .toJSON(),
        buttons(button(sid('room:back', v), '設定一覧に戻る', '↩️')),
      ],
    };
  }

  private kindPicker(row: RoomRow, v: PanelView = {}) {
    const cfg = this.cfg();
    const plan = planOf(cfg, row.hubId);
    return {
      embeds: [
        {
          title: '🔒 部屋の種類を選ぶ',
          description: v.staff
            ? `🛡 運営として変えます（決まっていても変えられ、部屋代の差額は取りません）。いまは ${ROOM_KINDS[row.kind].emoji} ${ROOM_KINDS[row.kind].label}です。`
            : '部屋の種類は **1 回だけ** 選べます。選んだあとは、公開・非公開を切り替えられません。',
          color: 0x6b5b95,
        },
      ],
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>()
          .addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(sid('room:kindpick', v))
              .setPlaceholder(v.staff ? '部屋の種類を選ぶ' : '部屋の種類を選ぶ（1 回だけ）')
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
        buttons(button(sid('room:back', v), '設定一覧に戻る', '↩️')),
      ],
    };
  }

  private async kind(i: StringSelectMenuInteraction<'cached'>, row: RoomRow, ch: VoiceChannel, v: PanelView = {}): Promise<void> {
    const kind = i.values[0];
    if (!isRoomKind(kind)) return void (await i.reply({ content: 'その部屋の種類は使えません。設定を開き直してください。', ...EPHEMERAL }));
    if (row.kindLocked && !v.staff) return void (await i.reply({ content: '部屋の種類はもう決まっています（1 回だけ選べます）。', ...EPHEMERAL }));
    if (v.staff) {
      // 運営: 決まっていても変えられ、差額は取らない
      const updated = await staffSetRoomKind(this.db, ch.id, kind);
      if (!updated) return void (await i.reply({ content: 'この部屋はもうありません。', ...EPHEMERAL }));
      await i.deferUpdate();
      if (kind !== row.kind) await this.apply(ch, row, kind);
      const k = ROOM_KINDS[kind];
      const limit = ch.userLimit;
      logger.info({ channelId: ch.id, by: i.user.id, kind }, 'room kind changed by staff');
      await ch.send({ content: `🛡 運営が部屋の種類を ${k.emoji} ${k.label}にしました。`, allowedMentions: { parse: [] } }).catch(() => undefined);
      return this.done(i, updated, { name: ch.name, userLimit: limit }, `${k.emoji} ${k.label}にしました（運営として・部屋代の差額はなし）`, v);
    }
    const r = await changeRoomKind(this.db, this.cfg(), ch.id, kind);
    if (r.status === 'not_found') return void (await i.reply({ content: 'この部屋はもうありません。', ...EPHEMERAL }));
    if (r.status === 'locked') return void (await i.reply({ content: '部屋の種類はもう決まっています（1 回だけ選べます）。', ...EPHEMERAL }));
    if (r.status === 'insufficient') return void (await i.reply({ content: `${this.cfg().economy.currencyName}が足りません（${r.price} 枚必要）。`, ...EPHEMERAL }));
    await i.deferUpdate();
    if (kind !== row.kind) await this.apply(ch, row, kind);
    const k = ROOM_KINDS[kind];
    const paid = r.ticketKind ? `（${ticketUsedText(r)}）` : r.charged ? `（${this.cfg().economy.currencyName} ${r.charged} 枚を払いました）` : '';
    const limit = ch.userLimit;
    await this.done(i, { ...row, kind, kindLocked: !row.keepUntil }, { name: ch.name, userLimit: limit }, `${k.emoji} ${k.label}にしました${paid}${kind === 'public' ? '' : '。入ってほしい人は「入室許可者を追加」から'}`, v);
  }

  /** 譲渡できる人（今この部屋にいる人。BOT と自分はのぞく） */
  private transferable(row: RoomRow, ch: VoiceChannel) {
    return [...ch.members.values()].filter((m) => !m.user.bot && m.id !== row.ownerId).slice(0, 25);
  }

  private async transferPicker(i: ButtonInteraction<'cached'>, row: RoomRow, ch: VoiceChannel, v: PanelView = {}): Promise<void> {
    const people = this.transferable(row, ch);
    if (!people.length) return void (await i.reply({ content: '譲渡できる人がいません（今この部屋にいる人から選べます）。', ...EPHEMERAL }));
    await i.update({
      embeds: [{ title: '👑 権限を譲渡', description: '部屋の設定を使える人（部屋主）を、今この部屋にいる人から選んでください。', color: 0x6b5b95 }],
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>()
          .addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(sid('room:xferpick', v))
              .setPlaceholder('譲渡する人を選ぶ')
              .addOptions(people.map((m) => ({ label: m.displayName.slice(0, 100), value: m.id }))),
          )
          .toJSON(),
        buttons(button(sid('room:back', v), '設定一覧に戻る', '↩️')),
      ],
    });
  }

  /** 選んだあと: 部屋代をどうするか（値段のない部屋は確認だけ） */
  private async transferConfirm(i: StringSelectMenuInteraction<'cached'>, row: RoomRow, ch: VoiceChannel, v: PanelView = {}): Promise<void> {
    const to = i.values[0];
    if (!to || !this.transferable(row, ch).some((m) => m.id === to)) return void (await i.reply({ content: 'その人は今この部屋にいません。', ...EPHEMERAL }));
    // 運営が譲渡するときは、これからの部屋代は新しい部屋主が払う（前の部屋主に持たせない）
    const plan = planOf(this.cfg(), row.hubId);
    const paid = plan !== 'none' && plan !== 'free' && !v.staff;
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
          ? buttons(
              button(sid(`room:xferok:${to}:new`, v), 'これからは相手が払う', '🤝', 1),
              button(sid(`room:xferok:${to}:keep`, v), '部屋代は自分が持つ', '💰', 3),
              button(sid('room:back', v), 'やめる', '↩️'),
            )
          : buttons(button(sid(`room:xferok:${to}:new`, v), '譲渡する', '👑', 1), button(sid('room:back', v), 'やめる', '↩️')),
      ],
      allowedMentions: { parse: [] },
    });
  }

  private async transfer(i: ButtonInteraction<'cached'>, row: RoomRow, ch: VoiceChannel, to: string, keepPaying: boolean, v: PanelView = {}): Promise<void> {
    if (!this.transferable(row, ch).some((m) => m.id === to)) return void (await i.reply({ content: 'その人は今この部屋にいません。', ...EPHEMERAL }));
    const r = await transferRoom(this.db, ch.id, row.ownerId, to, keepPaying);
    if (r.status !== 'ok') return void (await i.reply({ content: '譲渡できませんでした（もう部屋主ではないかもしれません）。', ...EPHEMERAL }));
    await this.apply(ch, r.row, r.row.kind);
    const plan = planOf(this.cfg(), row.hubId);
    const paid = plan !== 'none' && plan !== 'free';
    const money = !paid ? '' : keepPaying ? `（部屋主の分の部屋代は <@${r.row.payerId ?? row.ownerId}> さんが持ちます）` : `（これからの部屋主の分の部屋代は <@${to}> さんが払います）`;
    await i.update({ content: `👑 <@${to}> さんに権限を譲渡しました。${money}`, embeds: [], components: [], allowedMentions: { parse: [] } });
    await ch.send({
      content: `👑 ${v.staff ? '運営が、' : ''}<@${row.ownerId}> さんから <@${to}> さんに、部屋主の権限を譲渡しました。${money}\n-# 部屋の設定は「⚙ 部屋の設定」から <@${to}> さんが使えます`,
      allowedMentions: { users: [to] },
    });
  }

  private async invite(i: UserSelectMenuInteraction<'cached'>, row: RoomRow, ch: VoiceChannel, v: PanelView = {}): Promise<void> {
    const ids = i.values.filter((id) => id !== row.ownerId && !i.users.get(id)?.bot);
    if (!ids.length) return void (await i.reply({ content: '招待できる人がいません（自分・BOT は選べません）。', ...EPHEMERAL }));
    const updated = await addInvites(this.db, ch.id, ids);
    if (!updated) return;
    await this.apply(ch, updated, updated.kind);
    await this.done(i, updated, ch, `${ids.map((id) => `<@${id}>`).join(' ')} さんの入室を許可しました`, v);
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

import { createHash } from 'node:crypto';
import { castIntroId, castIntroPosts, forgetCastIntroPost, saveCastIntroPost, withCastIntroLock } from '../services/castIntroPosts.js';
import { DiscordHttpError } from '../lib/discordRest.js';
import sharp from 'sharp';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  OverwriteType,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Guild,
  type GuildMember,
  type Interaction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
  type VoiceChannel,
} from 'discord.js';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { Cast, CastSession } from '../db/schema.js';
import type { DiscordActions, MessageBody } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { audit } from '../services/audit.js';
import {
  acceptSession,
  cancelSession,
  castFee,
  castStates,
  castStats,
  castTick,
  disputeSession,
  extendSession,
  finishSession,
  getCast,
  getSession,
  isAdult,
  listCasts,
  loadCastConfig,
  loadCastReception,
  loadCastPhoto,
  loadMenuImage,
  MINOR,
  monthStart,
  parsePrice,
  parseTags,
  MENU_MINUTES,
  menuLabel,
  rescheduleSession,
  deliverSession,
  receiveSession,
  isDeliverySession,
  DELIVERY,
  earlyRoomOk,
  CUSTOMER_OPEN_MAX,
  isFreeSession,
  pickOptions,
  CAST_GROUPS,
  GROUP_LABEL,
  castHomeChannel,
  groupPlace,
  inGroup,
  isCastGroup,
  type CastGroup,
  menuPriceText,
  validQuote,
  menuOf,
  menuText,
  minorMenuOk,
  sessionLabel,
  rateSession,
  requestSession,
  roomDeleted,
  saveCastConfig,
  setBlocked,
  setSessionPlace,
  setWaiting,
  updateProfile,
  type CastConfig,
  type CastReception,
  type ProfileInput,
} from '../services/cast.js';
import { staffRoleIds } from '../services/meetings.js';
import { namesOf } from '../services/members.js';
import { loadReceptionAvatar, renderCastReception } from '../services/castReceptionImage.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const PINK = 0xe86a92;
const fmt = (n: number) => n.toLocaleString('ja-JP');
const unix = (d: Date) => Math.floor(d.getTime() / 1000);
const jstTime = (d: Date) => new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(11, 16);
type Btn = { type: 2; style: 1 | 2 | 3 | 4; label: string; custom_id: string; emoji?: { name: string }; disabled?: boolean };
const button = (custom_id: string, label: string, style: Btn['style'] = 2, emoji?: string, disabled = false): Btn => ({
  type: 2,
  style,
  label,
  custom_id,
  ...(emoji ? { emoji: { name: emoji } } : {}),
  ...(disabled ? { disabled } : {}),
});
type LinkBtn = { type: 2; style: 5; label: string; url: string };
export const castRoomName = (name: string) => `🌸 ${name.slice(0, 90)}の間`;
export const roomEntry = (guildId: string, channelId: string): LinkBtn => ({ type: 2, style: 5, label: '部屋へ入る', url: `https://discord.com/channels/${guildId}/${channelId}` });
const row = (...b: (Btn | LinkBtn)[]) => ({ type: 1 as const, components: b });
const STATE = { busy: { emoji: '📞', label: '通話中' }, waiting: { emoji: '🟢', label: '予約受付中' }, off: { emoji: '💤', label: '受付停止' } } as const;
const pricesText = (c: Pick<Cast, 'menu' | 'price30' | 'price60' | 'priceNight'>) => menuText(c) || 'メニューなし';
/** メニューを選ぶ欄（内容・時間・値段） */
const menuSelect = (custom_id: string, placeholder: string, items: ReturnType<typeof menuOf>) => ({
  type: 1 as const,
  components: [
    {
      type: 3 as const,
      custom_id,
      placeholder,
      options: items.slice(0, 25).map((m) => ({ label: `${menuLabel(m)} ${m.consult ? '' : menuPriceText(m)}`.trim().slice(0, 100), value: m.id, ...(m.note ? { description: m.note.slice(0, 100) } : {}) })),
    },
  ],
});
/** 同じ内容の時間と料金をまとめる。説明が違うものは別にする */
export function castMenuText(menu: ReturnType<typeof menuOf>): string {
  const groups = new Map<string, typeof menu>();
  for (const item of menu) {
    const key = JSON.stringify([item.name, item.note, !!item.consult, item.night, item.id && item.delivery ? item.id : '']);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].map((items) => {
    const first = items[0]!;
    const prices = first.consult ? '内容・料金は相談' : items.map((m) => {
      if (m.delivery) return `${m.gacha?.length ? `🎰 ガチャ（${m.gacha.join('・')} のどれか）` : '📦 納品'} **${fmt(m.price)}銭**`;
      const time = m.night ? '朝7時まで' : m.minutes === 0 ? '時間フリー' : m.minutes % 60 === 0 ? `${m.minutes / 60}時間` : m.minutes > 60 ? `${Math.floor(m.minutes / 60)}時間${m.minutes % 60}分` : `${m.minutes}分`;
      return `${time} **${fmt(m.price)}銭**`;
    }).join(' ／ ');
    return `**${first.name}**\n${prices}${first.note ? `\n${first.note}` : ''}`;
  }).join('\n\n') || 'メニューなし';
}
/** オプションを 1 行で（なければ空） */
export const castOptionsText = (cast: Pick<Cast, 'options'>) => (cast.options.length ? `**➕ オプション**\n${cast.options.map((o) => `${o.name} **+${fmt(o.price)}銭**`).join(' ／ ')}` : '');
const RULES = '-# 本物のお金のやり取り・性的な内容・連絡先の交換・録音は禁止です（しきたり）。困ったら部屋の「🚨 通報」を';

// ───────── メニュー（画像の下に、指名するメニュー） ─────────

/** #キャスト一覧 のメニュー: 上げた画像と、ランキング・キャストの方のボタン（予約・注文は 1 人ずつの紹介パネルから） */
export function castPanel(list: { cast: Cast; name: string; state: 'busy' | 'waiting' | 'off' }[], image?: { data: Uint8Array; contentType: string }, group?: CastGroup): MessageBody {
  const ext = image?.contentType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
  const open = list.filter((x) => x.state !== 'off').length;
  return {
    embeds: [
      {
        title: group ? `🎀 ${GROUP_LABEL[group]}` : '🎀 キャスト',
        description: [
          '下の紹介から、メニューを選んで予約・注文できます。',
          `🟢 予約受付中 **${open}** 人 ・ 在籍 ${list.length} 人`,
          '-# 銭は社務所が預かり、受けてもらえなければ全額戻ります',
          '-# 2 人だけの部屋・寝落ち・納品は 18 歳以上だけ。18 歳未満の方は、公開の部屋での雑談（1 時間まで・22 時まで）を予約できます',
        ].join('\n'),
        color: PINK,
        ...(image ? { image: { url: `attachment://cast-menu.${ext}` } } : {}),
      },
    ],
    ...(image ? { files: [{ name: `cast-menu.${ext}`, contentType: image.contentType, data: image.data }], attachments: [] } : {}),
    components: [row(button(group ? `cast:rank:${group}` : 'cast:rank', '今月のランキング', 2, '🏆'), button('cast:me', 'キャストの方', 2, '⚙'))],
  };
}

/** メニューを出す・書き換える（社務所Web・BOT の両方から）。出せたら true */
export async function refreshCastPanel(db: Db, discord: Pick<DiscordActions, 'sendMessage' | 'editMessage'>, opts: { repost?: boolean; by?: string } = {}): Promise<boolean> {
  let c = await loadCastConfig(db);
  if (!c.channelId && !c.femaleChannelId) return false;
  const [list, states] = await Promise.all([listCasts(db), castStates(db)]);
  const names = await namesOf(db, list.map((x) => x.memberId));
  // 男性・女性のチャンネルが両方あれば分けて出す。片方だけなら、そこに全員を出す
  const split = Boolean(c.channelId && c.femaleChannelId);
  let posted = false;
  for (const g of CAST_GROUPS) {
    const place = groupPlace(c, g);
    if (!place.channelId) continue;
    const image = (await loadMenuImage(db, g)) ?? (g === 'female' ? await loadMenuImage(db, 'male') : undefined);
    const body = castPanel(
      list.filter((cast) => !split || inGroup(cast, g)).map((cast) => ({ cast, name: names.get(cast.memberId) ?? cast.memberId, state: states.get(cast.memberId) ?? 'off' })),
      image,
      split ? g : undefined,
    );
    if (place.messageId && !opts.repost) {
      try {
        await discord.editMessage(place.channelId, place.messageId, body);
        posted = true;
        continue;
      } catch (err) {
        logger.warn({ err }, 'cast panel edit failed, posting again');
      }
    }
    const { id } = await discord.sendMessage(place.channelId, body);
    c = { ...(await loadCastConfig(db)), ...(g === 'female' ? { femalePanelMessageId: id } : { panelMessageId: id }) };
    await saveCastConfig(db, c, opts.by ?? 'system');
    posted = true;
  }
  return posted;
}

/**
 * 🎀 キャストごとの紹介パネル（みんなに見える。社務所Web から出す）: 名前・紹介・メニュー・写真の全体と、指名の選ぶ欄・予約。
 * 選んだあとのやり取りは、押した人にだけ見える形で返す（パネルは書き換えない）
 */
async function castIntroBody(db: Db, castId: string) {
  const cast = await getCast(db, castId);
  if (!cast) return undefined;
  const [name, photo, stats] = await Promise.all([namesOf(db, [castId]).then((m) => m.get(castId) ?? castId), loadCastPhoto(db, castId), castStats(db, monthStart())]);
  const st = stats.find((x) => x.castId === castId);
  const menu = menuOf(cast).filter((m) => m.price > 0 || m.consult);
  const header = [`## ${name}`, cast.tags.length ? cast.tags.map((t) => `#${t}`).join(' ') : '', cast.bio].filter(Boolean).join('\n');
  const body: MessageBody = {
    flags: MessageFlags.IsComponentsV2,
    allowed_mentions: { parse: [] },
    attachments: [],
    ...(photo ? { files: [{ name: 'cast-profile.png', contentType: photo.contentType, data: photo.data }] } : {}),
    components: [
      { type: 14, divider: true, spacing: 2 },
      { type: 10, content: header },
      ...(photo ? [{ type: 12, items: [{ media: { url: 'attachment://cast-profile.png' }, description: `${name}のメニュー画像` }] }] : []),
      { type: 10, content: castMenuText(menu) },
      ...(cast.options.length ? [{ type: 10, content: castOptionsText(cast) }] : []),
      ...(st ? [{ type: 10, content: `🏆 今月 ${st.count} 回${st.ratingAvg !== null ? ` ・ ⭐ ${st.ratingAvg}（${st.ratings} 件）` : ''}` }] : []),
      ...(cast.status === 'active' && cast.available === 'waiting' && menu.length ? [menuSelect(`cast:plansel:${castId}`, 'メニュー・時間を選ぶ', menu), row(button(`cast:rsv:${castId}`, '日時を指定して予約', 2, '📅'))] : []),
      { type: 10, content: cast.status === 'active' && cast.available === 'waiting' ? '-# 選択後、あなただけに確認画面が表示されます。' : '-# 現在は受付を停止しています。' },
      { type: 14, divider: true, spacing: 2 },
    ],
  };
  const hash = createHash('sha256').update(JSON.stringify({ components: body.components, photo: photo?.hash ?? null })).digest('hex');
  return { body, hash, active: cast.status === 'active' };
}


/** 投稿済みなら同じメッセージを書き換える。消されているときだけ、操作した人の指定先に出す */
export async function postCastIntro(db: Db, discord: Pick<DiscordActions, 'sendMessage' | 'editMessage'>, castId: string, channelId: string, _coin: string): Promise<boolean> {
  return withCastIntroLock(db, castId, async locked => {
    const view = await castIntroBody(locked, castId);
    if (!view?.active) return false;
    const old = (await castIntroPosts(locked, castId)).find(p => p.channelId === channelId);
    let messageId = old?.messageId;
    if (messageId) {
      try { await discord.editMessage(channelId, messageId, { ...view.body, content: null, embeds: [] }); }
      catch (err) {
        if (!(err instanceof DiscordHttpError) || err.status !== 404) throw err;
        messageId = undefined;
      }
    }
    if (!messageId) messageId = (await discord.sendMessage(channelId, view.body)).id;
    await saveCastIntroPost(locked, { castId, channelId, messageId, hash: view.hash });
    return true;
  });
}

/** 写真やメニューを変えたときに更新する。失敗した投稿は毎分の確認で再試行する */
export async function refreshCastIntros(db: Db, discord: Pick<DiscordActions, 'editMessage'>, castId?: string): Promise<boolean> {
  let ok = true;
  const ids = [...new Set((await castIntroPosts(db, castId)).map(p => p.castId))];
  for (const id of ids) {
    await withCastIntroLock(db, id, async locked => {
      const view = await castIntroBody(locked, id);
      if (!view) return;
      for (const post of await castIntroPosts(locked, id)) {
        if (post.hash === view.hash) continue;
        try {
          await discord.editMessage(post.channelId, post.messageId, { ...view.body, content: null, embeds: [] });
          await saveCastIntroPost(locked, { ...post, hash: view.hash });
        } catch (err) {
          if (err instanceof DiscordHttpError && err.status === 404) await forgetCastIntroPost(locked, post);
          else { ok = false; logger.warn({ err, castId: id }, 'cast intro sync failed'); }
        }
      }
    });
  }
  return ok;
}

/** 部屋のチャットに出す、指名の知らせ・通話中の操作・終わり */
export function sessionMessage(s: CastSession, c: CastConfig, coin: string) {
  const who = `<@${s.customerId}> さん → <@${s.castId}> さん`;
  const plan = `${sessionLabel(s)}${s.extensions ? `＋延長 ${s.extensions * 30} 分` : ''}`;
  const lines: string[] = [`${who} ・ ${plan} ・ ${coin} ${fmt(s.price)} 枚（社務所が預かり中）`];
  let buttons: Btn[] = [];
  let title = '🎀 指名';
  if (s.status === 'requested') {
    title = '🎀 指名が入りました';
    lines.push(`<@${s.castId}> さん、受けますか？ ${s.acceptBy ? `<t:${unix(s.acceptBy)}:R> までに返事がなければ、取り消して銭を戻します。` : ''}`);
    buttons = [button(`cast:accept:${s.id}`, '受ける', 3, '✅'), button(`cast:decline:${s.id}`, '断る', 4), button(`cast:cancel:${s.id}`, '取り消す（お客）')];
  } else if (s.status === 'active') {
    title = '📞 通話中';
    lines.push(s.endsAt ? `⏰ <t:${unix(s.endsAt)}:t> まで（<t:${unix(s.endsAt)}:R>）。時間が来たら終わって、キャストに ${fmt(s.price - castFee(c, s.price))} 枚を渡します。` : '');
    if (s.isPublic) lines.push(`-# 公開の部屋です（18 歳未満の方との雑談。${MINOR.maxMinutes} 分・${MINOR.endHour} 時まで）`);
    buttons = [...(isFreeSession(s) ? [] : [button(`cast:ext:${s.id}:${s.extensions}`, '30 分のばす（お客）', 1, '⏰')]), button(`cast:end:${s.id}`, '終える'), button(`cast:report:${s.id}`, '通報', 4, '🚨')];
  } else if (s.status === 'done') {
    title = '🎉 おつかれさまでした';
    lines.push(`キャストに ${coin} ${fmt(s.paid)} 枚を渡しました。<@${s.customerId}> さん、よければ評価をお願いします（この部屋は少しあとに消えます）。`);
    buttons = [1, 2, 3, 4, 5].map((n) => button(`cast:rate:${s.id}:${n}`, '⭐'.repeat(n), n === 5 ? 1 : 2));
  } else if (s.status === 'declined') {
    title = '🙇 今回は受けられませんでした';
    lines.push('預かっていた銭は全部戻しました。');
  } else if (s.status === 'canceled') {
    title = '取り消しました';
    lines.push('預かっていた銭は全部戻しました。');
  } else if (s.status === 'disputed') {
    title = '🚨 通報がありました';
    lines.push('運営が確認します。銭は、運営が決めるまで預かったままにします。');
  }
  lines.push(RULES);
  const rows = buttons.length > 5 ? [row(...buttons.slice(0, 5))] : buttons.length ? [row(...buttons)] : [];
  return { embeds: [{ title, description: lines.filter(Boolean).join('\n'), color: s.status === 'disputed' ? 0xd7003a : PINK }], components: rows };
}

/** キャスト本人だけに表示する画像と受付ボタン */
export function castReceptionBody(d: CastReception, name: string, names: ReadonlyMap<string, string>, currency: string, guildId: string, avatar?: Uint8Array) {
  const png = renderCastReception({ reception: d, name, names, currency, avatar });
  const off = d.cast.status !== 'active';
  const state = { waiting: '予約受付中', busy: '対応中', off: '受付停止', pending: '運営の確認待ち', paused: '運営による休止' }[d.state];
  const summary = name + 'さんの受付。' + state + '。今日の予約' + d.today.length + '件。現在の指名' + d.current.length + '件。今月の受取額' + fmt(d.stat.earned) + currency + '、指名' + d.stat.count + '回。';
  return {
    content: '',
    embeds: [{ title: 'キャスト受付', image: { url: 'attachment://cast-reception.png' }, color: PINK }],
    files: [new AttachmentBuilder(png, { name: 'cast-reception.png', description: summary.slice(0, 1000) })],
    attachments: [],
    allowedMentions: { parse: [] as never[] },
    components: [
      row(button('cast:wait:1', '予約を受け付ける', 3, '🟢', off || d.cast.available === 'waiting'), button('cast:wait:0', '受付停止', 2, '💤', off || d.cast.available !== 'waiting'), button('cast:refresh', '更新', 1, '🔄')),
      row(...d.current.filter((s) => s.channelId).slice(0, 2).map((s, k) => ({ ...roomEntry(guildId, s.channelId!), label: k ? '部屋へ入る（2）' : '部屋へ入る' })), button('cast:schedule:0', '予約一覧', 2, '📅')),
      row(button('cast:edit', '紹介を変える', 1, '✏️'), button('cast:minor', d.cast.minorOk ? '18歳未満の雑談を受けない' : '18歳未満の雑談を受ける'), button('cast:blockui', 'ブロック', 4), button('cast:unblockui', 'ブロックを外す')),
    ],
  };
}

/** 社務所からキャストへの DM で押せるボタン・フォーム */
const DM_ACTIONS = new Set(['accept', 'decline', 'propose', 'pmodal', 'dlv']);

export class CastApp {
  private guild?: Guild;
  private ticking = false;
  private introsDiscovered = false;
  private syncingIntros = false;

  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
    private readonly discord: DiscordActions,
  ) {}

  attach(guild: Guild): void {
    this.guild = guild;
  }

  /** 従来の紹介投稿も、キャスト用チャンネルの最新100件から引き継ぐ */
  private async discoverIntros(): Promise<void> {
    if (this.introsDiscovered || !this.guild) return;
    const c = await loadCastConfig(this.db);
    const ids = [...new Set([c.channelId, c.femaleChannelId].filter((id): id is string => !!id))];
    let ok = true;
    for (const channelId of ids) {
      try {
        const channel = await this.guild.channels.fetch(channelId);
        if (!channel?.isTextBased() || !('messages' in channel)) continue;
        const messages = await channel.messages.fetch({ limit: 100 });
        const seen = new Set<string>();
        for (const message of messages.values()) {
          if (message.author.id !== this.guild.client.user.id) continue;
          const id = castIntroId(message.components.map(c => c.toJSON()));
          if (!id || seen.has(id) || !await getCast(this.db, id)) continue;
          seen.add(id);
          await saveCastIntroPost(this.db, { castId: id, channelId, messageId: message.id, hash: '' }, true);
        }
      } catch (err) { ok = false; logger.warn({ err }, 'cast old intros lookup failed'); }
    }
    this.introsDiscovered = ok && ids.length > 0;
  }

  /** 画像の更新が予約や通話の終了処理を待たせないよう、別に動かす */
  async syncIntros(): Promise<void> {
    if (!this.guild || this.syncingIntros) return;
    this.syncingIntros = true;
    try {
      await this.discoverIntros();
      await refreshCastIntros(this.db, this.discord);
    } finally { this.syncingIntros = false; }
  }

  private coin(): string {
    const e = this.cfg().economy;
    return `${e.currencyEmoji}${e.currencyName}`;
  }

  private roles(i: { member: GuildMember }): string[] {
    return [...i.member.roles.cache.keys()];
  }

  private refresh(): void {
    void refreshCastIntros(this.db, this.discord).catch(err => logger.warn({ err }, 'cast intros refresh failed'));
    void refreshCastPanel(this.db, this.discord).catch((err: unknown) => logger.warn({ err }, 'cast panel refresh failed'));
  }

  async onInteraction(interaction: Interaction): Promise<void> {
    if (!('customId' in interaction) || !interaction.customId.startsWith('cast:')) return;
    const [, action, a, b, ...rest] = interaction.customId.split(':');
    // 社務所からキャストへの DM のボタン（受ける・別の日時を提案・断る・納品した）
    if (!interaction.guildId) {
      if (!DM_ACTIONS.has(action ?? '')) return;
      try {
        return await this.onDm(interaction, action ?? '', Number(a));
      } catch (err) {
        logger.warn({ err, id: interaction.customId }, 'cast dm failed');
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) await interaction.reply({ content: 'うまくいきませんでした。時間をおいてもう一度お試しください。' }).catch(() => undefined);
        return;
      }
    }
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    try {
      if (interaction.isStringSelectMenu()) {
        if (action === 'pick') return await this.pick(interaction, interaction.values[0] ?? '');
        if (action === 'plansel') return await this.confirm(interaction, a ?? '', interaction.values[0] ?? '');
        if (action === 'opts') return await this.confirm(interaction, a ?? '', b ?? '', interaction.values);
        if (action === 'rplansel') return await this.reserveModal(interaction, a ?? '', interaction.values[0] ?? '');
        return;
      }
      if (interaction.isUserSelectMenu()) {
        if (action === 'block' || action === 'unblock') return await this.block(interaction, action === 'block');
        return;
      }
      if (interaction.isModalSubmit()) {
        if (action === 'applymodal') return void (await interaction.reply({ content: '🎀 キャストは、運営が登録します。キャストになりたい方は、運営に声をかけてください。', ...EPHEMERAL }));
        if (action === 'editmodal') return await this.profileSubmit(interaction);
        if (action === 'pmodal') return await this.proposeSubmit(interaction, Number(a));
        if (action === 'rmodal') return await this.reserveSubmit(interaction, a ?? '', b ?? '', rest[0] ? rest[0].split(',') : undefined);
        if (action === 'qrmodal') {
          const [customerId, minutes, price] = rest;
          if (interaction.user.id !== customerId) return void (await interaction.reply({ content: 'この提案で予約できるのは、相談した人だけです。', ...EPHEMERAL }));
          return await this.reserveSubmit(interaction, a ?? '', b ?? '', undefined, { minutes: Number(minutes), price: Number(price) });
        }
        if (action === 'omodal') return await this.orderSubmit(interaction, a ?? '', b ?? '');
        if (action === 'cmodal') return await this.consultSubmit(interaction, a ?? '', b ?? '');
        if (action === 'qmodal') return await this.quoteSubmit(interaction, a ?? '', b ?? '', rest[0] ?? '');
        return;
      }
      if (!interaction.isButton()) return;
      if (action === 'now') return await this.waitingList(interaction, isCastGroup(a) ? a : undefined);
      if (action === 'rank') return await this.ranking(interaction, isCastGroup(a) ? a : undefined);
      if (action === 'apply') return await this.applyModal(interaction);
      if (action === 'me') return await this.mine(interaction);
      if (action === 'refresh') return await this.mine(interaction, true);
      if (action === 'schedule') return await this.schedule(interaction, Number(a ?? 0));
      if (action === 'edit') return await this.editModal(interaction);
      if (action === 'wait') return await this.wait(interaction, Number(a));
      if (action === 'minor') return await this.toggleMinor(interaction);
      if (action === 'blockui' || action === 'unblockui') return await this.blockPicker(interaction, action === 'blockui');
      if (action === 'plan') return await this.confirm(interaction, a ?? '', b ?? '');
      // キャストは予約だけ（前のメッセージに残った「指名する」も、日時を入れる予約にする）
      if (action === 'go') return await this.reserveModal(interaction, a ?? '', b ?? '', rest[0] ? rest[0].split(',') : undefined);
      if (action === 'quote') return await this.quoteModal(interaction, a ?? '', b ?? '', rest[0] ?? '');
      if (action === 'qgo') return await this.quoteGo(interaction, a ?? '', b ?? '', rest);
      if (action === 'rsv') return await this.reservePlans(interaction, a ?? '');
      if (action === 'rplan') return await this.reserveModal(interaction, a ?? '', b ?? '', rest[0] ? rest[0].split(',') : undefined);
      const id = Number(a);
      if (!Number.isSafeInteger(id)) return;
      if (action === 'accept') return await this.accept(interaction, id);
      if (action === 'propose') return await this.proposeModal(interaction, id);
      if (action === 'early') return await this.earlyRoom(interaction, id);
      if (action === 'dlv') return await this.deliver(interaction, id);
      if (action === 'rcv') return await this.receive(interaction, id);
      if (action === 'pok') return await this.proposeAccept(interaction, id, Number(b));
      if (action === 'decline' || action === 'cancel') return await this.cancel(interaction, id, action === 'decline' ? 'declined' : 'canceled');
      if (action === 'ext') return await this.extend(interaction, id, b === undefined ? 0 : Number(b));
      if (action === 'end') return await this.end(interaction, id);
      if (action === 'report') return await this.report(interaction, id);
      if (action === 'rate') return await this.rate(interaction, id, Number(b));
    } catch (err) {
      logger.warn({ err, id: interaction.customId }, 'cast failed');
      if (interaction.isRepliable()) {
        const content = 'うまくいきませんでした。時間をおいてもう一度お試しください。';
        await (interaction.deferred || interaction.replied ? interaction.followUp({ content, ...EPHEMERAL }) : interaction.reply({ content, ...EPHEMERAL })).catch(() => undefined);
      }
    }
  }

  // ───────── 見る ─────────

  private async castCard(cast: Cast, adult: boolean) {
    const [states, stats] = await Promise.all([castStates(this.db), castStats(this.db, monthStart())]);
    const name = (await namesOf(this.db, [cast.memberId])).get(cast.memberId) ?? cast.memberId;
    const photo = await loadCastPhoto(this.db, cast.memberId);
    const state = STATE[states.get(cast.memberId) ?? 'off'];
    const st = stats.find((x) => x.castId === cast.memberId);
    const plans = menuOf(cast).filter((m) => (m.price > 0 || m.consult) && (adult || (minorMenuOk(m) && cast.minorOk)));
    // カードにせず、文と写真（切りぬかない全体）をそのまま出す
    return {
      content: [
            `## ${name}`,
            `${state.emoji} ${state.label}${cast.tags.length ? ` ・ ${cast.tags.map((t) => `#${t}`).join(' ')}` : ''}`,
            cast.bio,
            '',
            `💰 **メニュー**（${this.coin()}）`,
            castMenuText(menuOf(cast)),
            castOptionsText(cast),
            st ? `🏆 今月 ${st.count} 回${st.ratingAvg !== null ? ` ・ ⭐ ${st.ratingAvg}（${st.ratings} 件）` : ''}` : '',
            adult ? '' : !cast.minorOk ? '-# このキャストは、18 歳未満の方の指名を受けていません' : `-# 18 歳未満の方は、公開の部屋での雑談（30 分・1 時間・${MINOR.endHour} 時まで）だけです`,
          ]
            .filter((l, i) => l || i === 3)
            .join('\n'),
      embeds: [],
      allowedMentions: { parse: [] as never[] },
      ...(photo ? { files: [new AttachmentBuilder(Buffer.from(photo.data), { name: 'cast-profile.png' })] } : {}),
      components: plans.length
        ? [menuSelect(`cast:plansel:${cast.memberId}`, '📅 メニューを選んで予約する', plans)]
        : [],
    };
  }

  private async pick(i: StringSelectMenuInteraction<'cached'>, castId: string): Promise<void> {
    const cast = await getCast(this.db, castId);
    if (!cast || cast.status !== 'active') return void (await i.reply({ content: 'このキャストは、いまは指名できません。', ...EPHEMERAL }));
    const adult = await isAdult(this.db, this.cfg(), i.user.id, this.roles(i));
    await i.deferReply(EPHEMERAL);
    await i.editReply({ ...(await this.castCard(cast, adult)), allowedMentions: { parse: [] } });
  }

  private async waitingList(i: ButtonInteraction<'cached'>, group?: CastGroup): Promise<void> {
    const [list, states] = await Promise.all([listCasts(this.db), castStates(this.db)]);
    const waiting = list.filter((x) => states.get(x.memberId) === 'waiting' && (!group || inGroup(x, group)));
    const names = await namesOf(this.db, waiting.map((x) => x.memberId));
    await i.reply({
      content: waiting.length
        ? ['🟢 **いま話せるキャスト**', ...waiting.map((x) => `- ${names.get(x.memberId) ?? x.memberId} … ${pricesText(x)}${x.tags.length ? `（${x.tags.join('・')}）` : ''}`), '-# 上のメニューから選んで指名できます'].join('\n')
        : 'いま待機中のキャストはいません。予約もできます（上のメニューからキャストを選んでください）。',
      ...EPHEMERAL,
    });
  }

  private async ranking(i: ButtonInteraction<'cached'>, group?: CastGroup): Promise<void> {
    const all = await castStats(this.db, monthStart());
    const members = group ? new Map((await listCasts(this.db, ['active', 'paused'])).map((x) => [x.memberId, x])) : undefined;
    const stats = all.filter((x) => !members || (members.get(x.castId) && inGroup(members.get(x.castId)!, group!))).slice(0, 10);
    const names = await namesOf(this.db, stats.map((x) => x.castId));
    const medal = ['🥇', '🥈', '🥉'];
    await i.reply({
      content: stats.length
        ? [`🏆 **今月の${group ? GROUP_LABEL[group].slice(3) : 'キャスト'}**（指名の多い順）`, ...stats.map((x, n) => `${medal[n] ?? `${n + 1}.`} ${names.get(x.castId) ?? x.castId} … ${x.count} 回${x.ratingAvg !== null ? ` ・ ⭐ ${x.ratingAvg}` : ''}`)].join('\n')
        : '今月はまだ指名がありません。',
      ...EPHEMERAL,
    });
  }

  // ───────── キャストになる・設定 ─────────

  private profileModal(id: string, title: string, cur?: Cast) {
    const input = (key: string, label: string, style: TextInputStyle, max: number, required: boolean, value = '', placeholder = '') => {
      const t = new TextInputBuilder().setCustomId(key).setLabel(label).setStyle(style).setMaxLength(max).setRequired(required);
      if (value) t.setValue(value);
      if (placeholder) t.setPlaceholder(placeholder);
      return new ActionRowBuilder<TextInputBuilder>().addComponents(t);
    };
    return new ModalBuilder()
      .setCustomId(id)
      .setTitle(title)
      .addComponents(
        input('bio', 'ひとこと紹介（どんな通話ができるか）', TextInputStyle.Paragraph, 300, true, cur?.bio ?? ''),
        input('tags', '得意なこと（、で区切る）', TextInputStyle.Short, 80, false, cur?.tags.join('、') ?? '', '寝落ち、雑談、ゲーム'),
      );
  }

  private async applyModal(i: ButtonInteraction<'cached'>): Promise<void> {
    // 前のメニューに残っているボタン。キャストは運営が社務所Web で登録する
    await i.reply({ content: '🎀 キャストは、運営が登録します。キャストになりたい方は、運営に声をかけてください。', ...EPHEMERAL });
  }

  private async editModal(i: ButtonInteraction<'cached'>): Promise<void> {
    const cur = await getCast(this.db, i.user.id);
    if (!cur || cur.status === 'removed') return void (await i.reply({ content: 'キャストの方だけが使えます。', ...EPHEMERAL }));
    await i.showModal(this.profileModal('cast:editmodal', '🎀 紹介を変える', cur));
  }

  private async profileSubmit(i: ModalSubmitInteraction<'cached'>): Promise<void> {
    await i.deferReply(EPHEMERAL);
    const c = await loadCastConfig(this.db);
    const cur = await getCast(this.db, i.user.id);
    const p: ProfileInput = {
      bio: i.fields.getTextInputValue('bio').trim(),
      tags: parseTags(i.fields.getTextInputValue('tags')),
      // 値段はメニュー（運営が社務所Web で決める）。前の値段はそのまま
      price30: cur?.price30 ?? 0,
      price60: cur?.price60 ?? 0,
      priceNight: cur?.priceNight ?? 0,
      minorOk: cur?.minorOk ?? true,
    };
    const bad = '紹介は 300 文字までで入れてください。';
    const r = await updateProfile(this.db, c, i.user.id, p);
    if (!r) return void (await i.editReply(bad));
    this.refresh();
    await i.editReply('紹介を変えました（メニューと値段は運営が決めます）。');
  }

  private async receptionView(member: GuildMember) {
    const d = await loadCastReception(this.db, member.id);
    if (!d) return { content: 'キャストの方だけが使えます。キャストは運営が登録します。', embeds: [], components: [], attachments: [], allowedMentions: { parse: [] as never[] } };
    const [names, avatar] = await Promise.all([
      namesOf(this.db, [...d.current, ...d.today].map((s) => s.customerId)),
      // 受付の画像のアイコンは、写真のまん中を正方形に切りぬいて使う
      loadCastPhoto(this.db, member.id).then(async (photo) => (photo ? new Uint8Array(await sharp(photo.data).resize(264, 264, { fit: 'cover' }).png().toBuffer()) : loadReceptionAvatar(member.displayAvatarURL({ extension: 'png', size: 128 })))),
    ]);
    return castReceptionBody(d, member.displayName, names, this.cfg().economy.currencyName, this.cfg().guildId, avatar);
  }

  private async mine(i: ButtonInteraction<'cached'>, refresh = false): Promise<void> {
    if (refresh) await i.deferUpdate();
    else await i.deferReply(EPHEMERAL);
    await i.editReply(await this.receptionView(i.member));
  }

  private async wait(i: ButtonInteraction<'cached'>, hours: number): Promise<void> {
    await i.deferUpdate();
    // 前の「2時間待機」「4時間待機」のボタンも、受付中にする
    const r = await setWaiting(this.db, i.user.id, hours > 0 ? 1 : 0);
    if (!r) return void (await i.followUp({ content: '承認されたキャストの方だけが切り替えられます。', ...EPHEMERAL }));
    await i.editReply(await this.receptionView(i.member));
    this.refresh();
  }

  private async toggleMinor(i: ButtonInteraction<'cached'>): Promise<void> {
    await i.deferUpdate();
    const cur = await getCast(this.db, i.user.id);
    if (!cur || cur.status === 'removed') return void (await i.followUp({ content: 'キャストの方だけが使えます。', ...EPHEMERAL }));
    const c = await loadCastConfig(this.db);
    const r = await updateProfile(this.db, c, i.user.id, { bio: cur.bio, tags: cur.tags, price30: cur.price30, price60: cur.price60, priceNight: cur.priceNight, minorOk: !cur.minorOk });
    if (r) await i.editReply(await this.receptionView(i.member));
  }

  private async schedule(i: ButtonInteraction<'cached'>, page: number): Promise<void> {
    await i.deferUpdate();
    const d = await loadCastReception(this.db, i.user.id);
    if (!d) return void (await i.editReply({ content: 'キャストの方だけが使えます。', embeds: [], components: [], attachments: [] }));
    const pages = Math.max(1, Math.ceil(d.today.length / 10));
    const selected = Number.isSafeInteger(page) ? Math.max(0, Math.min(page, pages - 1)) : 0;
    const bookings = d.today.slice(selected * 10, (selected + 1) * 10);
    const names = await namesOf(this.db, bookings.map((s) => s.customerId));
    const description = bookings.map((s) => (s.startAt ? jstTime(s.startAt) : '') + ' ｜ ' + (names.get(s.customerId) ?? '利用者').replace(/[@*_~`<>|\r\n]/g, '').slice(0, 28) + ' さん ｜ ' + sessionLabel(s) + ' ｜ ' + ({ reserved: '返事待ち', accepted: '確定', active: '通話中', done: '終了', disputed: '運営確認中' } as Record<string, string>)[s.status]).join('\n');
    await i.editReply({
      content: '', attachments: [],
      embeds: [{ title: '今日の予約（日本時間） ' + (selected + 1) + '/' + pages, description: description || '今日の予約はありません。', color: PINK }],
      components: [row(button('cast:schedule:' + (selected - 1), '前へ', 2, undefined, selected === 0), button('cast:schedule:' + (selected + 1), '次へ', 2, undefined, selected === pages - 1), button('cast:refresh', '受付に戻る', 1))],
      allowedMentions: { parse: [] },
    });
  }

  private async blockPicker(i: ButtonInteraction<'cached'>, on: boolean): Promise<void> {
    await i.reply({
      content: on ? 'ブロックする人を選んでください（その人からは指名されなくなります）。' : 'ブロックを外す人を選んでください。',
      components: [{ type: 1, components: [{ type: 5, custom_id: on ? 'cast:block' : 'cast:unblock', placeholder: '人を選ぶ', max_values: 5 }] }],
      ...EPHEMERAL,
    });
  }

  private async block(i: UserSelectMenuInteraction<'cached'>, on: boolean): Promise<void> {
    let r: Cast | undefined;
    for (const id of i.values) if (id !== i.user.id) r = await setBlocked(this.db, i.user.id, id, on);
    await i.update({ content: r ? (on ? `🚫 ${i.values.length} 人をブロックしました。` : `ブロックを外しました。`) : 'キャストの方だけが使えます。', components: [] });
  }

  // ───────── 指名 ─────────

  /** 押した人にだけ見えるメッセージなら書き換え、みんなに見えるパネル（紹介パネル）なら押した人にだけ返事する */
  private async answer(i: ButtonInteraction<'cached'> | StringSelectMenuInteraction<'cached'>, body: Record<string, unknown>): Promise<void> {
    if (i.message.flags.has(MessageFlags.Ephemeral)) await i.update(body as never);
    else {
      const { attachments: _a, ...rest } = body;
      await i.reply({ ...rest, ...EPHEMERAL } as never);
    }
  }

  private async confirm(i: ButtonInteraction<'cached'> | StringSelectMenuInteraction<'cached'>, castId: string, plan: string, chosen: string[] = []): Promise<void> {
    const cast = await getCast(this.db, castId);
    const item = cast && menuOf(cast).find((m) => m.id === plan);
    if (!cast || cast.status !== 'active' || !item) return void (await this.answer(i, { content: 'このキャストは、いまは指名できません（メニューが変わったかもしれません）。', embeds: [], components: [], attachments: [] }));
    const adult = await isAdult(this.db, this.cfg(), i.user.id, this.roles(i));
    if (item.consult) {
      if (!adult) return void (await this.answer(i, { content: '相談のメニューは 18 歳以上の方だけです。', embeds: [], components: [], attachments: [] }));
      return void (await i.showModal(
        new ModalBuilder()
          .setCustomId(`cast:cmodal:${castId}:${item.id}`)
          .setTitle(`💬 ${item.name}（内容により相談）`.slice(0, 45))
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder().setCustomId('wish').setLabel('お願いしたいこと（キャストが時間と値段を出します）').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500),
            ),
          ),
      ));
    }
    if (item.delivery) {
      if (!adult) return void (await this.answer(i, { content: '📦 納品のメニューは 18 歳以上の方だけです。', embeds: [], components: [], attachments: [] }));
      return void (await i.showModal(
        new ModalBuilder()
          .setCustomId(`cast:omodal:${castId}:${item.id}`)
          .setTitle(`${item.gacha?.length ? '🎰' : '📦'} ${item.name}（${fmt(item.price)} 枚）`.slice(0, 45))
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId('wish')
                .setLabel(item.gacha?.length ? 'ひとこと（呼んでほしい名前など・なくてもよい）' : 'お願いの内容（呼んでほしい名前・シチュエーションなど）')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(!item.gacha?.length)
                .setMaxLength(500),
            ),
          ),
      ));
    }
    const opts = pickOptions(cast, chosen);
    const price = item.price + opts.reduce((n, o) => n + o.price, 0);
    const optionRow = cast.options.length
      ? [{
          type: 1 as const,
          components: [{
            type: 3 as const,
            custom_id: `cast:opts:${castId}:${plan}`,
            placeholder: '➕ オプションを付ける（いくつでも・なくてもよい）',
            min_values: 0,
            max_values: cast.options.length,
            options: cast.options.map((o) => ({ label: `${o.name} +${fmt(o.price)} 枚`.slice(0, 100), value: o.id, default: chosen.includes(o.id) })),
          }],
        }]
      : [];
    const goId = `cast:rplan:${castId}:${plan}${opts.length ? `:${opts.map((o) => o.id).join(',')}` : ''}`;
    await this.answer(i, {
      content: [
        `🎀 <@${castId}> さんを **${menuLabel(item)}**${opts.length ? ` ＋ ${opts.map((o) => o.name).join('・')}` : ''} ・ ${this.coin()} **${fmt(price)} 枚** で予約しますか？（次に日時を入れます）`,
        adult ? '-# 2 人だけの部屋ができます（運営は見守りのために見られます）' : `-# 公開の部屋での雑談になります（${MINOR.maxMinutes} 分・${MINOR.endHour} 時まで）`,
        '-# キャストは予約だけです。銭は社務所が預かり、受けてもらえなければ全額戻ります。途中でのばすこともできます',
        RULES,
      ].join('\n'),
      embeds: [],
      components: [...optionRow, row(button(goId, `📅 日時を決めて予約する（${fmt(price)} 枚）`, 3))],
      attachments: [],
      allowedMentions: { parse: [] },
    });
  }

  // ───────── 💬 相談のメニュー: お客がお願いを書く → キャストが時間と値段を出す → お客がその値段で指名する ─────────

  private async consultSubmit(i: ModalSubmitInteraction<'cached'>, castId: string, itemId: string): Promise<void> {
    await i.deferReply(EPHEMERAL);
    const cast = await getCast(this.db, castId);
    const item = cast && menuOf(cast).find((m) => m.id === itemId && m.consult);
    if (!cast || cast.status !== 'active' || !item) return void (await i.editReply('このメニューは、いまは選べません。'));
    if (cast.blocked.includes(i.user.id) || castId === i.user.id) return void (await i.editReply('このキャストには相談できません。'));
    if (!(await isAdult(this.db, this.cfg(), i.user.id, this.roles(i)))) return void (await i.editReply('相談のメニューは 18 歳以上の方だけです。'));
    const wish = i.fields.getTextInputValue('wish').trim().slice(0, 500);
    const c = await loadCastConfig(this.db);
    const home = castHomeChannel(c, cast);
    const panel = home ? this.guild?.channels.cache.get(home) : undefined;
    if (panel?.type !== ChannelType.GuildText) return void (await i.editReply('相談の場所を作れませんでした。神職に知らせてください。'));
    const thread = await panel.threads.create({ name: `💬 相談 ${item.name}`.slice(0, 90), type: ChannelType.PrivateThread, invitable: false, reason: 'キャストの相談' }).catch(() => undefined);
    if (!thread) return void (await i.editReply('相談の場所を作れませんでした。神職に知らせてください。'));
    await thread.members.add(castId).catch(() => undefined);
    await thread.members.add(i.user.id).catch(() => undefined);
    await thread.send({
      content: [`<@${castId}> さん、<@${i.user.id}> さんから **${item.name}** の相談です。`, `> ${wish.replace(/\n/g, '\n> ')}`, '時間と値段を決めたら「値段を出す」を押してください（お客がその値段で指名すると、いつもの指名と同じように始まります）。', RULES].join('\n'),
      components: [row(button(`cast:quote:${castId}:${item.id}:${i.user.id}`, '値段を出す（キャスト）', 1, '💬'))],
      allowedMentions: { users: [castId] },
    });
    await this.discord.sendDm(castId, `💬 ${item.name} の相談が届きました。<#${thread.id}> で値段を出してください。`).catch(() => false);
    await i.editReply(`💬 相談をお願いしました。キャストの返事は <#${thread.id}> に届きます（まだ銭は払っていません）。`);
  }

  private async quoteModal(i: ButtonInteraction<'cached'>, castId: string, itemId: string, customerId: string): Promise<void> {
    if (i.user.id !== castId) return void (await i.reply({ content: '値段を出せるのはキャストだけです。', ...EPHEMERAL }));
    await i.showModal(
      new ModalBuilder()
        .setCustomId(`cast:qmodal:${castId}:${itemId}:${customerId}`)
        .setTitle('💬 時間と値段を出す')
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('minutes').setLabel('時間（分）').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(4).setPlaceholder('30')),
          new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('price').setLabel('値段（銭）').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(9).setPlaceholder('500')),
        ),
    );
  }

  private async quoteSubmit(i: ModalSubmitInteraction<'cached'>, castId: string, itemId: string, customerId: string): Promise<void> {
    if (i.user.id !== castId) return void (await i.reply({ content: '値段を出せるのはキャストだけです。', ...EPHEMERAL }));
    const c = await loadCastConfig(this.db);
    const minutes = parsePrice(i.fields.getTextInputValue('minutes'));
    const price = parsePrice(i.fields.getTextInputValue('price'));
    if (!validQuote(c, minutes, price)) return void (await i.reply({ content: `時間は ${MENU_MINUTES.min}〜${MENU_MINUTES.max} 分、値段は ${fmt(c.priceMin)}〜${fmt(c.priceMax)} 枚で入れてください。`, ...EPHEMERAL }));
    await i.reply({
      content: `💬 <@${customerId}> さん、<@${castId}> さんから **${minutes} 分 ・ ${this.coin()} ${fmt(price)} 枚** の提案です。よければ「この値段で指名する」を押してください。`,
      components: [row(button(`cast:qgo:${castId}:${itemId}:${customerId}:${minutes}:${price}`, `${fmt(price)} 枚で予約する（お客）`, 3, '📅'))],
      allowedMentions: { users: [customerId] },
    });
  }

  private async quoteGo(i: ButtonInteraction<'cached'>, castId: string, itemId: string, rest: string[]): Promise<void> {
    const [customerId, minutes, price] = rest;
    if (i.user.id !== customerId) return void (await i.reply({ content: 'この提案で予約できるのは、相談した人だけです。', ...EPHEMERAL }));
    await this.reserveModal(i, castId, itemId, undefined, { customerId: customerId!, minutes: Number(minutes), price: Number(price) });
  }

  private async go(i: ButtonInteraction<'cached'>, castId: string, plan: string, quote?: { minutes: number; price: number }, options?: string[]): Promise<void> {
    await i.deferUpdate();
    const c = await loadCastConfig(this.db);
    const adult = await isAdult(this.db, this.cfg(), i.user.id, this.roles(i));
    const r = await requestSession(this.db, c, { castId, customerId: i.user.id, customerAdult: adult, plan, ...(quote ? { quote } : {}), ...(options ? { options } : {}) });
    if (r.status !== 'ok') return void (await i.editReply({ content: this.requestError(r), components: [] }));
    const room = await this.openRoom(r.session).then(async (room) => {
      if (room) await room.send({ content: `<@${castId}>`, ...sessionMessage(r.session, c, this.coin()), allowedMentions: { users: [castId] } } as Parameters<typeof room.send>[0]);
      return room;
    }).catch((err: unknown) => (logger.warn({ err }, 'cast room failed'), undefined));
    if (!room) {
      await cancelSession(this.db, r.session.id, 'system', 'declined');
      return void (await i.editReply({ content: '部屋を作れなかったので、取り消して銭を戻しました。神職に知らせてください。', components: [] }));
    }
    await this.discord.sendDm(castId, `🎀 指名が入りました（${sessionLabel(r.session)}）。<#${room.id}> で「受ける」を押してください。`).catch(() => false);
    this.refresh();
    await i.editReply({ content: `🎀 指名しました。<#${room.id}> に入って、キャストの返事を待ってください（残り ${fmt(r.balance)} 枚）。`, components: [row(roomEntry(i.guildId, room.id))] });
  }

  private requestError(r: Exclude<Awaited<ReturnType<typeof requestSession>>, { status: 'ok' }>): string {
    const map: Record<string, string> = {
      not_cast: 'このキャストは、いまは指名できません。',
      self: '自分は指名できません。',
      blocked: 'このキャストは指名できません。',
      closed: 'このキャストは、いまは予約・注文の受付を止めています。',
      busy: 'このキャストは、いま通話中か返事待ちです。少しあとか、予約でどうぞ。',
      no_plan: 'このキャストは、その時間では受けていません。',
      minor_plan: '寝落ちは 18 歳以上の方だけです。',
      minor_off: 'このキャストは、18 歳未満の方の指名を受けていません。',
      minor_hours: `18 歳未満の方の雑談は ${MINOR.startHour} 時〜${MINOR.endHour} 時に終わる時間だけです。`,
      has_open: `指名（返事待ち・通話中・予約）は 1 人 ${CUSTOMER_OPEN_MAX} 件までです。終わってからどうぞ。`,
      self_overlap: 'あなたのほかの指名・予約と時間が重なっています。ちがう時間にしてください。',
      overlap: 'その時間は、ほかの指名か予約と重なっています。時間を変えてください。',
      bad_time: '予約は 10 分後〜7 日後の時刻にしてください。',
    };
    return r.status === 'insufficient' ? `${this.cfg().economy.currencyName}が足りません（${fmt(r.price)} 枚必要・いま ${fmt(r.balance)} 枚）。` : (map[r.status] ?? 'いまは指名できません。');
  }

  /** 通話の部屋を作る（2 人だけ: 運営も見られる / 公開: カテゴリのまま・2 人まで） */
  private async openRoom(s: CastSession): Promise<VoiceChannel | undefined> {
    const g = this.guild;
    if (!g) return undefined;
    if (s.channelId) return this.voice(s.channelId);
    const c = await loadCastConfig(this.db);
    const homeId = c.channelId ?? c.femaleChannelId;
    const panel = homeId ? g.channels.cache.get(homeId) : undefined;
    const fallback = panel && 'parentId' in panel ? panel.parentId : null;
    const parentId = (s.isPublic ? c.publicCategoryId : c.privateCategoryId) ?? fallback ?? null;
    const parent = parentId ? g.channels.cache.get(parentId) : undefined;
    const name = (await namesOf(this.db, [s.castId])).get(s.castId) ?? 'キャスト';
    const IN = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Connect | PermissionFlagsBits.Speak;
    const me = g.members.me;
    const people = [
      { id: s.castId, type: OverwriteType.Member, allow: IN | PermissionFlagsBits.SendMessages },
      { id: s.customerId, type: OverwriteType.Member, allow: IN | PermissionFlagsBits.SendMessages },
      ...(me ? [{ id: me.id, type: OverwriteType.Member, allow: IN | PermissionFlagsBits.ManageChannels | PermissionFlagsBits.MoveMembers | PermissionFlagsBits.SendMessages }] : []),
    ];
    const overwrites = s.isPublic
      ? [...(parent && 'permissionOverwrites' in parent ? parent.permissionOverwrites.cache.map((o) => ({ id: o.id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield })) : []), ...people]
      : [
          { id: g.id, type: OverwriteType.Role, deny: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Connect },
          ...[...staffRoleIds(this.cfg())].map((id) => ({ id, type: OverwriteType.Role, allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Connect })),
          ...people,
        ];
    const room = await g.channels.create({
      name: castRoomName(name),
      type: ChannelType.GuildVoice,
      parent: parent?.id ?? null,
      userLimit: 2,
      permissionOverwrites: overwrites,
      reason: `キャストの指名 #${s.id}`,
    });
    try {
      await setSessionPlace(this.db, s.id, { channelId: room.id });
    } catch (err) {
      await room.delete('指名の部屋を保存できませんでした').catch(() => undefined);
      throw err;
    }
    return room;
  }

  private voice(id: string | null): VoiceChannel | undefined {
    const ch = id ? this.guild?.channels.cache.get(id) : undefined;
    return ch?.type === ChannelType.GuildVoice ? ch : undefined;
  }

  private async accept(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const c = await loadCastConfig(this.db);
    const s = await acceptSession(this.db, id, i.user.id);
    if (!s) return void (await i.reply({ content: '受けられるのは、指名されたキャストだけです（もう終わっているかもしれません）。', ...(i.guildId ? EPHEMERAL : {}) }));
    if (s.status === 'accepted') {
      await this.afterCast(i, s);
      await this.discord.sendDm(s.customerId, `📅 予約を受けてもらえました（<t:${unix(s.startAt!)}:f>）。時刻になったら部屋ができます。`).catch(() => false);
      return;
    }
    await i.update({ ...sessionMessage(s, c, this.coin()), allowedMentions: { parse: [] } } as Parameters<typeof i.update>[0]);
    const room = this.voice(s.channelId);
    await room?.send({ content: `<@${s.customerId}> さん、始まります 🎀`, allowedMentions: { users: [s.customerId] } }).catch(() => undefined);
    this.refresh();
  }

  private async cancel(i: ButtonInteraction<'cached'>, id: number, reason: 'declined' | 'canceled'): Promise<void> {
    const s = await cancelSession(this.db, id, i.user.id, reason);
    if (!s) return void (await i.reply({ content: reason === 'declined' ? '断れるのは、指名されたキャストだけです。' : '取り消せるのは、指名した人だけです（始まる前まで。納品の注文は取り消せません）。', ...(i.guildId ? EPHEMERAL : {}) }));
    const c = await loadCastConfig(this.db);
    await this.afterCast(i, s, s.threadId ? this.reserveMessage(s) : sessionMessage(s, c, this.coin()));
    await this.discord.sendDm(reason === 'declined' ? s.customerId : s.castId, reason === 'declined' ? `🙇 今回の指名は受けられませんでした。${fmt(s.price)} 枚を戻しました。` : '🎀 指名が取り消されました。').catch(() => false);
    this.refresh();
  }

  private async extend(i: ButtonInteraction<'cached'>, id: number, expected: number): Promise<void> {
    await i.deferUpdate();
    const r = await extendSession(this.db, id, i.user.id, new Date(), expected);
    if (r.status !== 'ok') {
      if (r.status === 'already_extended') {
        const current = await getSession(this.db, id);
        if (current) await i.editReply({ ...sessionMessage(current, await loadCastConfig(this.db), this.coin()), allowedMentions: { parse: [] } } as Parameters<typeof i.editReply>[0]);
      }
      const text = r.status === 'insufficient'
        ? `${this.cfg().economy.currencyName}が足りません（${fmt(r.price)} 枚必要・いま ${fmt(r.balance)} 枚）。`
        : ({
            already_extended: 'このボタンの延長は、もう済んでいます。新しいボタンを使ってください。',
            overlap: '次の予約と重なるので、のばせません。銭は使っていません。',
            minor_limit: `18 歳未満の方は ${MINOR.maxMinutes} 分・${MINOR.endHour} 時までです。`,
            not_customer: 'のばせるのは、指名した人だけです。',
            not_active: 'もう終わっています。',
          })[r.status];
      return void (await i.followUp({ content: text, ...EPHEMERAL }));
    }
    await i.editReply({ ...sessionMessage(r.session, await loadCastConfig(this.db), this.coin()), allowedMentions: { parse: [] } } as Parameters<typeof i.editReply>[0]);
    await i.followUp({ content: `⏰ 30 分のばしました（残り ${fmt(r.balance)} 枚）。`, ...EPHEMERAL });
  }

  private async end(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const c = await loadCastConfig(this.db);
    const s = await finishSession(this.db, c, id, i.user.id);
    if (!s) return void (await i.reply({ content: '終えられるのは、キャストと指名した人だけです（もう終わっているかもしれません）。', ...EPHEMERAL }));
    await i.update({ ...sessionMessage(s, c, this.coin()), allowedMentions: { parse: [] } } as Parameters<typeof i.update>[0]);
    await audit(this.db, { actorId: i.user.id, action: 'cast.end', detail: { sessionId: id, paid: s.paid }, via: 'discord' });
    this.refresh();
  }

  private async report(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const s = await disputeSession(this.db, id, i.user.id);
    if (!s) return void (await i.reply({ content: '通報できるのは、キャストと指名した人だけです（通話中・予約中）。', ...EPHEMERAL }));
    await i.update({ ...(isDeliverySession(s) ? this.reserveMessage(s) : sessionMessage(s, await loadCastConfig(this.db), this.coin())), allowedMentions: { parse: [] } } as Parameters<typeof i.update>[0]);
    await audit(this.db, { actorId: i.user.id, action: 'cast.report', detail: { sessionId: id }, via: 'discord' });
    const log = this.cfg().channels.log;
    if (log) {
      await this.discord
        .sendMessage(log, { content: `🚨 キャストの指名 #${id} に通報がありました（<@${i.user.id}> さんから）。${s.channelId ? `部屋: <#${s.channelId}>。` : ''}社務所Web の「🎀 キャスト」で決めてください。` })
        .catch(() => undefined);
    }
    await i.followUp({ content: '🚨 運営に知らせました。つらいときは、部屋から抜けて大丈夫です。', ...EPHEMERAL });
  }

  private async rate(i: ButtonInteraction<'cached'>, id: number, stars: number): Promise<void> {
    const s = await rateSession(this.db, id, i.user.id, stars);
    if (!s) return void (await i.reply({ content: '評価できるのは、指名した人が 1 回だけです。', ...EPHEMERAL }));
    await i.reply({ content: `⭐ ${'⭐'.repeat(stars - 1)} ありがとうございました。`, ...EPHEMERAL });
  }

  // ───────── 予約 ─────────

  private async reservePlans(i: ButtonInteraction<'cached'>, castId: string): Promise<void> {
    const cast = await getCast(this.db, castId);
    if (!cast || cast.status !== 'active') return void (await this.answer(i, { content: 'このキャストは、いまは指名できません。', embeds: [], components: [] }));
    const adult = await isAdult(this.db, this.cfg(), i.user.id, this.roles(i));
    // 18 歳未満の人は、公開の部屋で 60 分までのメニューだけ
    const plans = menuOf(cast).filter((m) => m.price > 0 && !m.consult && !m.delivery && (adult || (minorMenuOk(m) && cast.minorOk)));
    if (!plans.length) return void (await this.answer(i, { content: 'このキャストは、いま予約できるメニューがありません。', embeds: [], components: [], attachments: [] }));
    await this.answer(i, { content: '📅 予約するメニューを選んでください。', embeds: [], components: [menuSelect(`cast:rplansel:${castId}`, '📅 予約するメニュー', plans)], attachments: [] });
  }

  private async reserveModal(
    i: ButtonInteraction<'cached'> | StringSelectMenuInteraction<'cached'>,
    castId: string,
    plan: string,
    options?: string[],
    quote?: { customerId: string; minutes: number; price: number },
  ): Promise<void> {
    const cast = await getCast(this.db, castId);
    const item = cast && menuOf(cast).find((m) => m.id === plan);
    if (!item) return void (await this.answer(i, { content: 'そのメニューは、いまはありません。', embeds: [], components: [], attachments: [] }));
    const id = quote ? `cast:qrmodal:${castId}:${plan}:${quote.customerId}:${quote.minutes}:${quote.price}` : `cast:rmodal:${castId}:${plan}${options?.length ? `:${options.join(',')}` : ''}`;
    await i.showModal(
      new ModalBuilder()
        .setCustomId(id)
        .setTitle(`📅 予約（${menuLabel(item)}）`.slice(0, 45))
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder().setCustomId('when').setLabel('日時（例: 21:00 ／ 10/5 21:00）').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20),
          ),
        ),
    );
  }

  private reserveMessage(s: CastSession, castButtons = false) {
    if (isDeliverySession(s)) return this.deliveryMessage(s, castButtons);
    const when = s.startAt ? `<t:${unix(s.startAt)}:f>（<t:${unix(s.startAt)}:R>）` : '';
    const map: Partial<Record<CastSession['status'], { title: string; line: string; buttons: Btn[] }>> = {
      reserved: {
        title: '📅 予約のお願い',
        line: castButtons ? `<@${s.castId}> さん、${when} から ${sessionLabel(s)} の予約です。受けますか？（始まる時刻までに返事がなければ取り消します）` : `${when} から ${sessionLabel(s)} の予約です。キャストの返事を待っています（始まる時刻までに返事がなければ取り消して戻します）。`,
        // キャストの返事は社務所からの DM で（DM が届かないときだけ、ここにもボタンを出す）
        buttons: [...(castButtons ? [button(`cast:accept:${s.id}`, '受ける', 3, '✅'), button(`cast:propose:${s.id}`, '別の日時を提案', 1, '🗓'), button(`cast:decline:${s.id}`, '断る', 4)] : []), button(`cast:cancel:${s.id}`, '取り消す（お客）')],
      },
      accepted: { title: '📅 予約を受けました', line: `${when} から ${sessionLabel(s)}。時刻になったら部屋ができて、ここで知らせます。当日なら「部屋を立てる」で先に 2 人だけの部屋を作れます。`, buttons: [button(`cast:early:${s.id}`, '部屋を立てる（当日）', 3, '🚪'), button(`cast:cancel:${s.id}`, '取り消す（お客）'), button(`cast:report:${s.id}`, '通報', 4, '🚨')] },
      declined: { title: '🙇 予約は受けられませんでした', line: '預かっていた銭は全部戻しました。', buttons: [] },
      canceled: { title: '予約を取り消しました', line: '預かっていた銭は全部戻しました。', buttons: [] },
    };
    const m = map[s.status] ?? { title: '📅 予約', line: when, buttons: [] };
    return { embeds: [{ title: m.title, description: [`<@${s.customerId}> さん → <@${s.castId}> さん ・ ${this.coin()} ${fmt(s.price)} 枚（社務所が預かり中）`, m.line, RULES].join('\n'), color: PINK }], components: m.buttons.length ? [row(...m.buttons)] : [] };
  }

  /** 📦 納品のスレッドのメッセージ（お客が見る。castButtons でキャストのボタンも） */
  private deliveryMessage(s: CastSession, castButtons = false) {
    const due = s.acceptBy ? `<t:${unix(s.acceptBy)}:f>（<t:${unix(s.acceptBy)}:R>）` : '';
    const auto = s.endsAt ? `<t:${unix(s.endsAt)}:R>` : '';
    const map: Partial<Record<CastSession['status'], { title: string; line: string; buttons: Btn[] }>> = {
      ordered: {
        title: '📦 納品の注文',
        line: `${sessionLabel(s)} の注文です。キャストが ${due} までに、このスレッドに出して「納品した」を押します。間に合わなければ全額戻します。`,
        buttons: [...(castButtons ? [button(`cast:dlv:${s.id}`, '納品した（キャスト）', 3, '📦'), button(`cast:decline:${s.id}`, '断る（キャスト）', 4)] : []), button(`cast:report:${s.id}`, '通報', 4, '🚨')],
      },
      delivered: {
        title: '📦 納品されました',
        line: `<@${s.customerId}> さん、届いたものを確かめたら「受け取った」を押してください（押すとキャストに渡します。押さなくても ${auto} に自動で渡します）。困ったときは「通報」。`,
        buttons: [button(`cast:rcv:${s.id}`, '受け取った（お客）', 3, '✅'), button(`cast:report:${s.id}`, '通報', 4, '🚨')],
      },
      done: { title: '🎉 受け取りました', line: `ありがとうございました。キャストに渡しました。`, buttons: [1, 2, 3, 4, 5].map((n) => button(`cast:rate:${s.id}:${n}`, '⭐'.repeat(n))) },
      declined: { title: '🙇 納品できませんでした', line: '預かっていた銭は全部戻しました。', buttons: [] },
      disputed: { title: '🚨 運営が確認しています', line: '銭は止めています。運営が決めるまで待ってください。', buttons: [] },
      refunded: { title: '運営が戻しました', line: '預かっていた銭は全部戻しました。', buttons: [] },
    };
    const m = map[s.status] ?? { title: '📦 納品', line: sessionLabel(s), buttons: [] };
    const components = s.status === 'done' && s.rating !== null ? [] : m.buttons.length ? [row(...m.buttons)] : [];
    return { embeds: [{ title: m.title, description: [`<@${s.customerId}> さん → <@${s.castId}> さん ・ ${this.coin()} ${fmt(s.price)} 枚（社務所が預かり中）`, m.line].join('\n'), color: PINK }], components };
  }

  /** 社務所からキャストへの DM（予約の返事・納品）。状態が変わったら、同じ DM を書き換える */
  private castDmMessage(s: CastSession) {
    const where = s.threadId ? `やり取り: <#${s.threadId}>` : '';
    const when = s.startAt ? `<t:${unix(s.startAt)}:f>（<t:${unix(s.startAt)}:R>）` : '';
    const head = isDeliverySession(s) ? `📦 <@${s.customerId}> さんから **${sessionLabel(s)}** の注文（${fmt(s.price)} 枚）` : `📅 <@${s.customerId}> さんから **${when}** に **${sessionLabel(s)}** の予約（${fmt(s.price)} 枚）`;
    const map: Partial<Record<CastSession['status'], { line: string; buttons: Btn[] }>> = {
      reserved: { line: '受けますか？ 都合が悪ければ「別の日時を提案」もできます（始まる時刻までに返事がなければ取り消します）。', buttons: [button(`cast:accept:${s.id}`, '受ける', 3, '✅'), button(`cast:propose:${s.id}`, '別の日時を提案', 1, '🗓'), button(`cast:decline:${s.id}`, '断る', 4)] },
      accepted: { line: '✅ 受けました。時刻になったら部屋ができます（当日ならスレッドの「部屋を立てる」で先に作れます）。', buttons: [] },
      ordered: { line: `${s.acceptBy ? `<t:${unix(s.acceptBy)}:f>` : '期限'} までに、スレッドに出して「納品した」を押してください。`, buttons: [button(`cast:dlv:${s.id}`, '納品した', 3, '📦'), button(`cast:decline:${s.id}`, '断る', 4)] },
      delivered: { line: '📦 納品しました。お客が受け取ると渡します（受け取らなくても 3 日で自動で渡します）。', buttons: [] },
      done: { line: `🎉 終わりました（${fmt(s.paid)} 枚をお渡ししました）。`, buttons: [] },
      declined: { line: '断りました（お客に全額戻しました）。', buttons: [] },
      canceled: { line: 'お客が取り消しました。', buttons: [] },
    };
    const m = map[s.status] ?? { line: '', buttons: [] };
    return { content: [head, m.line, where].filter(Boolean).join('\n'), components: m.buttons.length ? [row(...m.buttons)] : [], allowedMentions: { parse: [] as never[] } };
  }

  /** キャストに DM でボタンを送る。届かなければ false（そのときはスレッドにボタンを出す） */
  private async dmCast(s: CastSession): Promise<boolean> {
    const client = this.guild?.client;
    if (!client) return false;
    return client.users.send(s.castId, this.castDmMessage(s) as never).then(() => true, () => false);
  }

  /** キャストの返事のあと: DM ならその DM を書き換え、スレッドにお客向けを出す。スレッドならそのメッセージを書き換える */
  private async afterCast(i: ButtonInteraction | ModalSubmitInteraction, s: CastSession, guildBody?: Record<string, unknown>): Promise<void> {
    if (!i.guildId) {
      if (i.isButton()) await i.update(this.castDmMessage(s) as never);
      else await i.reply(this.castDmMessage(s) as never);
      if (s.threadId) await this.discord.sendMessage(s.threadId, { ...this.reserveMessage(s), allowed_mentions: { parse: [] } } as MessageBody).catch(() => undefined);
      return;
    }
    if (i.isButton()) await i.update({ ...(guildBody ?? this.reserveMessage(s)), allowedMentions: { parse: [] } } as never);
  }

  private async onDm(i: Interaction, action: string, id: number): Promise<void> {
    if (!Number.isSafeInteger(id)) return;
    if (i.isModalSubmit() && action === 'pmodal') return this.proposeSubmit(i as never, id);
    if (!i.isButton()) return;
    if (action === 'accept') return this.accept(i as never, id);
    if (action === 'decline') return this.cancel(i as never, id, 'declined');
    if (action === 'propose') return this.proposeModal(i as never, id);
    if (action === 'dlv') return this.deliver(i, id);
  }

  /** 📦 注文する（お客） */
  private async orderSubmit(i: ModalSubmitInteraction<'cached'>, castId: string, plan: string): Promise<void> {
    await i.deferReply(EPHEMERAL);
    const c = await loadCastConfig(this.db);
    const adult = await isAdult(this.db, this.cfg(), i.user.id, this.roles(i));
    const wish = i.fields.getTextInputValue('wish').trim();
    const r = await requestSession(this.db, c, { castId, customerId: i.user.id, customerAdult: adult, plan });
    if (r.status !== 'ok') return void (await i.editReply({ content: r.status === 'has_open' ? `納品待ちの注文は ${CUSTOMER_OPEN_MAX} 件までです。届いてから次を注文してください。` : this.requestError(r), components: [] }));
    const thread = await this.openThread(r.session, `📦 ${r.drawn ? 'ガチャ' : '納品'} #${r.session.id}`);
    if (!thread) {
      await cancelSession(this.db, r.session.id, 'system', 'declined');
      return void (await i.editReply({ content: 'やり取りの場所を作れなかったので、取り消して銭を戻しました。神職に知らせてください。', components: [] }));
    }
    const s = (await getSession(this.db, r.session.id)) ?? r.session;
    await thread.send({ content: [r.drawn ? `🎰 ガチャの結果: **${r.drawn}**` : '', wish ? `📝 お願い:\n> ${wish.replace(/\n/g, '\n> ')}` : ''].filter(Boolean).join('\n') || '📦 注文', allowedMentions: { parse: [] } }).catch(() => undefined);
    const dm = await this.dmCast(s);
    await thread.send({ ...(dm ? {} : { content: `<@${castId}>` }), ...this.reserveMessage(s, !dm), allowedMentions: { users: dm ? [] : [castId] } } as never).catch(() => undefined);
    await i.editReply({ content: `${r.drawn ? `🎰 ガチャの結果は **${r.drawn}** でした！ ` : '📦 '}注文しました。キャストが ${DELIVERY.deadlineHours} 時間以内に <#${thread.id}> へ届けます（残り ${fmt(r.balance)} 枚）。`, components: [] });
  }

  /** 予約・納品のやり取りのスレッド（キャストのメニューのチャンネルの中） */
  private async openThread(s: CastSession, name: string) {
    const c = await loadCastConfig(this.db);
    const castRow = await getCast(this.db, s.castId);
    const home = castRow ? castHomeChannel(c, castRow) : c.channelId;
    const panel = home ? this.guild?.channels.cache.get(home) : undefined;
    if (panel?.type !== ChannelType.GuildText) return undefined;
    const thread = await panel.threads
      .create(
        // 18 歳未満の人の予約は、2 人だけにしない（みんなに見えるスレッド。部屋も公開）
        s.isPublic
          ? { name, type: ChannelType.PublicThread, reason: 'キャストの予約（公開）' }
          : { name, type: ChannelType.PrivateThread, invitable: false, reason: 'キャストの予約・納品' },
      )
      .catch(() => undefined);
    if (!thread) return undefined;
    await thread.members.add(s.castId).catch(() => undefined);
    await thread.members.add(s.customerId).catch(() => undefined);
    await setSessionPlace(this.db, s.id, { threadId: thread.id });
    return thread;
  }

  /** 📦 納品した（キャスト。DM かスレッドから） */
  private async deliver(i: ButtonInteraction, id: number): Promise<void> {
    const s = await deliverSession(this.db, id, i.user.id);
    if (!s) return void (await i.reply({ content: '納品できるのは、注文を受けたキャストだけです（期限が過ぎたか、もう納品ずみかもしれません）。', ...(i.guildId ? EPHEMERAL : {}) }));
    await this.afterCast(i, s);
    await this.discord.sendDm(s.customerId, `📦 ${sessionLabel(s)} が届きました。${s.threadId ? `<#${s.threadId}> で確かめて「受け取った」を押してください。` : ''}`).catch(() => false);
  }

  /** ✅ 受け取った（お客） */
  private async receive(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const s = await receiveSession(this.db, await loadCastConfig(this.db), id, i.user.id);
    if (!s) return void (await i.reply({ content: '受け取りを押せるのは、注文した人だけです（もう受け取りずみかもしれません）。', ...EPHEMERAL }));
    await i.update({ ...this.reserveMessage(s), allowedMentions: { parse: [] } } as never);
    await this.discord.sendDm(s.castId, `🎉 ${sessionLabel(s)} を受け取ってもらえました。${this.coin()} ${fmt(s.paid)} 枚をお渡ししました。`).catch(() => false);
  }

  // ───────── 🗓 別の日時を提案（断るかわりに） ─────────

  private async proposeModal(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const s = await getSession(this.db, id);
    if (!s || (s.status !== 'reserved' && s.status !== 'accepted')) return void (await i.reply({ content: 'この予約は、もう変えられません。', ...(i.guildId ? EPHEMERAL : {}) }));
    if (i.user.id !== s.castId) return void (await i.reply({ content: '別の日時を出せるのはキャストだけです。', ...(i.guildId ? EPHEMERAL : {}) }));
    await i.showModal(
      new ModalBuilder()
        .setCustomId(`cast:pmodal:${id}`)
        .setTitle('🗓 別の日時を提案')
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('when').setLabel('日時（例: 21:00 ／ 10/5 21:00）').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20)),
          new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('note').setLabel('ひとこと（なくてもよい）').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100)),
        ),
    );
  }

  private async proposeSubmit(i: ModalSubmitInteraction, id: number): Promise<void> {
    const s = await getSession(this.db, id);
    if (!s || i.user.id !== s.castId) return void (await i.reply({ content: '別の日時を出せるのはキャストだけです。', ...EPHEMERAL }));
    const at = this.parseWhen(i.fields.getTextInputValue('when'));
    if (!at) return void (await i.reply({ content: '日時が読めませんでした（例: 21:00 ／ 10/5 21:00）。', ...EPHEMERAL }));
    const note = i.fields.getTextInputValue('note').trim();
    const body = {
      content: [`🗓 <@${s.customerId}> さん、<@${s.castId}> さんから **<t:${unix(at)}:f>（<t:${unix(at)}:R>）** の提案です。よければ「この日時にする」を押してください（今の予約の時刻が変わります）。`, ...(note ? [`> ${note}`] : [])].join('\n'),
      components: [row(button(`cast:pok:${id}:${unix(at)}`, 'この日時にする（お客）', 3, '✅'))],
    };
    // DM から出したときは、スレッドにお客向けを出す
    if (!i.guildId) {
      if (!s.threadId) return void (await i.reply({ content: 'やり取りのスレッドが見つかりませんでした。' }));
      await this.discord.sendMessage(s.threadId, { ...body, allowed_mentions: { users: [s.customerId] } } as MessageBody);
      return void (await i.reply({ content: `🗓 <t:${unix(at)}:f> を提案しました。お客が選ぶと決まります（<#${s.threadId}>）。` }));
    }
    await i.reply({ ...body, allowedMentions: { users: [s.customerId] } });
  }

  private async proposeAccept(i: ButtonInteraction<'cached'>, id: number, at: number): Promise<void> {
    await i.deferReply(EPHEMERAL);
    const r = await rescheduleSession(this.db, id, i.user.id, new Date(at * 1000));
    const msg: Record<string, string> = {
      not_found: 'この予約は、もう変えられません。',
      not_customer: 'この提案を受けられるのは、予約した人だけです。',
      bad_time: 'この日時は、もう選べません（10 分後〜7 日後まで）。キャストにもう一度提案してもらってください。',
      minor_hours: '18 歳未満の方は、22 時までに終わる時間だけです。',
      overlap: 'キャストのほかの予約と重なりました。キャストにもう一度提案してもらってください。',
      self_overlap: 'あなたのほかの予約と重なっています。',
    };
    if (r.status !== 'ok') return void (await i.editReply(msg[r.status] ?? 'うまくいきませんでした。'));
    await i.editReply('✅ 予約の日時を変えました。');
    const ch = i.channel;
    if (ch?.isSendable()) await ch.send({ ...this.reserveMessage(r.session), allowedMentions: { parse: [] } } as never).catch(() => undefined);
    await this.discord.sendDm(r.session.castId, `📅 予約 #${id} は、提案した <t:${at}:f> に決まりました。`).catch(() => false);
  }

  /** 当日に、2 人だけの部屋を先に立てる（話す時間・お金は予約の時刻から） */
  private async earlyRoom(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    await i.deferReply(EPHEMERAL);
    const s = await getSession(this.db, id);
    const ok = s ? earlyRoomOk(s, i.user.id) : 'not_accepted';
    const msg = { not_member: 'この予約のキャストとお客だけが使えます。', not_accepted: 'キャストが受けた予約だけ、部屋を立てられます。', not_today: '部屋を先に立てられるのは、予約の日（日本時間）だけです。' } as const;
    if (!s || ok !== 'ok') return void (await i.editReply(msg[ok === 'ok' ? 'not_accepted' : ok]));
    const had = Boolean(s.channelId && this.voice(s.channelId));
    const room = await this.openRoom(s).catch((err: unknown) => { logger.warn({ err }, 'cast early room failed'); return undefined; });
    if (!room) return void (await i.editReply('部屋を作れませんでした。運営に知らせてください。'));
    await i.editReply({ content: `🚪 2 人だけの部屋です: <#${room.id}>（時間とお金は <t:${unix(s.startAt!)}:t> から数えます）`, components: [row(roomEntry(this.guild!.id, room.id))] });
    if (had) return;
    const ch = i.channel;
    if (ch?.isSendable()) await ch.send({ content: `🚪 <@${i.user.id}> さんが部屋を立てました。<#${room.id}> へどうぞ（始まりは <t:${unix(s.startAt!)}:t>）。`, components: [row(roomEntry(this.guild!.id, room.id))], allowedMentions: { parse: [] } } as never).catch(() => undefined);
    const other = i.user.id === s.castId ? s.customerId : s.castId;
    await this.discord.sendDm(other, `🚪 予約 #${id} の部屋ができました。${roomEntry(this.guild!.id, room.id).url}`).catch(() => false);
  }

  /** 「21:00」「10/5 21:00」を、日本時間の次のその時刻に */
  private parseWhen(raw: string, now = new Date()): Date | undefined {
    const t = raw.replace(/[０-９：／]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).trim();
    const m = /^(?:(\d{1,2})\/(\d{1,2})\s+)?(\d{1,2}):(\d{2})$/.exec(t);
    if (!m) return undefined;
    const [, mo, d, h, mi] = m;
    const j = new Date(now.getTime() + 9 * 3_600_000);
    let at = new Date(Date.UTC(j.getUTCFullYear(), mo ? Number(mo) - 1 : j.getUTCMonth(), d ? Number(d) : j.getUTCDate(), Number(h), Number(mi)) - 9 * 3_600_000);
    if (Number(h) > 23 || Number(mi) > 59) return undefined;
    if (!mo && at <= now) at = new Date(at.getTime() + 24 * 3_600_000);
    if (mo && at <= now) at = new Date(Date.UTC(j.getUTCFullYear() + 1, Number(mo) - 1, Number(d), Number(h), Number(mi)) - 9 * 3_600_000);
    return at;
  }

  private async reserveSubmit(i: ModalSubmitInteraction<'cached'>, castId: string, plan: string, options?: string[], quote?: { minutes: number; price: number }): Promise<void> {
    if (i.isFromMessage()) await i.deferUpdate();
    else await i.deferReply(EPHEMERAL);
    const at = this.parseWhen(i.fields.getTextInputValue('when'));
    if (!at) return void (await i.editReply({ content: '日時が読めませんでした（例: 21:00 ／ 10/5 21:00）。', components: [] }));
    const c = await loadCastConfig(this.db);
    const adult = await isAdult(this.db, this.cfg(), i.user.id, this.roles(i));
    const r = await requestSession(this.db, c, { castId, customerId: i.user.id, customerAdult: adult, plan, startAt: at, ...(options ? { options } : {}), ...(quote ? { quote } : {}) });
    if (r.status !== 'ok') return void (await i.editReply({ content: this.requestError(r), components: [] }));
    // やり取りは、そのキャストのメニューのチャンネルの中の、2 人だけのスレッドで。キャストの返事は社務所からの DM で
    const thread = await this.openThread(r.session, `📅 予約 #${r.session.id}`);
    const threadId = thread?.id;
    if (thread) {
      const s = (await getSession(this.db, r.session.id)) ?? r.session;
      const dm = await this.dmCast(s);
      await thread.send({ ...(dm ? {} : { content: `<@${castId}>` }), ...this.reserveMessage(s, !dm), allowedMentions: { users: dm ? [] : [castId] } } as Parameters<typeof thread.send>[0]);
    }
    if (!threadId) {
      await cancelSession(this.db, r.session.id, 'system', 'declined');
      return void (await i.editReply({ content: '予約のやり取りの場所を作れなかったので、取り消して銭を戻しました。神職に知らせてください。', components: [] }));
    }
    await i.editReply({ content: `📅 予約をお願いしました（<t:${unix(at)}:f>）。返事は <#${threadId}> に届きます（残り ${fmt(r.balance)} 枚）。`, components: [] });
  }

  // ───────── 1 分ごと ─────────


  async tick(now = new Date()): Promise<void> {
    if (!this.guild || this.ticking) return;
    this.ticking = true;
    try { await this.runTick(now); } finally { this.ticking = false; }
  }

  private async runTick(now: Date): Promise<void> {
    const c = await loadCastConfig(this.db);
    const r = await castTick(this.db, c, now, async (s) => Boolean(await this.openRoom(s).catch((err: unknown) => { logger.warn({ err }, 'cast reserved room failed'); return undefined; })));
    let changed = r.waitingOff > 0;
    for (const s of r.expired) {
      changed = true;
      await this.discord.sendDm(s.customerId, `🙇 指名を始められなかったので、取り消して ${fmt(s.price)} 枚を戻しました。`).catch(() => false);
      if (s.threadId) await this.discord.sendMessage(s.threadId, { ...this.reserveMessage(s) } as MessageBody).catch(() => undefined);
    }
    for (const s of r.started) {
      changed = true;
      const room = this.voice(s.channelId);
      if (!room) continue;
      await this.discord.sendDm(s.customerId, `📅 予約の部屋ができました。${roomEntry(this.guild!.id, room.id).url}`).catch(() => false);
      await room.send({ content: `<@${s.castId}> <@${s.customerId}>`, ...sessionMessage(s, c, this.coin()), allowedMentions: { users: [s.castId, s.customerId] } } as Parameters<typeof room.send>[0]).catch(() => undefined);
      if (s.threadId) await this.discord.sendMessage(s.threadId, { content: `📅 予約の時間です。<#${room.id}> へどうぞ。`, components: [row(roomEntry(this.guild!.id, room.id))], allowed_mentions: { parse: [] } }).catch(() => undefined);
    }
    for (const s of r.warn) {
      const room = this.voice(s.channelId);
      await room?.send({ content: `⏰ あと 5 分です。${s.isPublic ? '' : 'のばすときは「30 分のばす」を。'}`, allowedMentions: { parse: [] } }).catch(() => undefined);
    }
    for (const s of r.finished) {
      changed = true;
      const room = this.voice(s.channelId);
      await room?.send({ ...sessionMessage(s, c, this.coin()), allowedMentions: { parse: [] } } as Parameters<typeof room.send>[0]).catch(() => undefined);
      if (isDeliverySession(s) && s.threadId) await this.discord.sendMessage(s.threadId, { ...this.reserveMessage(s), allowed_mentions: { parse: [] } } as MessageBody).catch(() => undefined);
      if (s.paid > 0) await this.discord.sendDm(s.castId, `🎀 指名 #${s.id} が終わりました。${this.coin()} ${fmt(s.paid)} 枚をお渡ししました。`).catch(() => false);
    }
    for (const s of r.cleanup) {
      const room = s.channelId ? this.guild?.channels.cache.get(s.channelId) : undefined;
      if (room) {
        try { await room.delete('キャストの指名が終わった'); }
        catch (err) { logger.warn({ err }, 'cast room delete failed'); continue; }
      }
      await roomDeleted(this.db, s.id);
    }
    if (changed) this.refresh();
  }

}

import { closeFinishedReservationThreads } from '../services/castThreadClose.js';
import { refreshCastLeaderboard, castLeaderboardBody } from './castLeaderboard.js';
import { castLeaderboard } from '../services/castLeaderboard.js';
import { CHAMPAGNES, champagneOf, prepareChampagne, buyChampagne, announceChampagne, assertChampagneActive, ChampagneError, champagneError } from '../services/castChampagne.js';
import { champagneAnimation, champagnePreview } from '../services/castChampagneImage.js';
import { createHash, randomUUID } from 'node:crypto';
import { createLoginLink } from '../services/casino/loginLinks.js';
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
  type Message,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
  type VoiceChannel,
  type TextChannel,
} from 'discord.js';
import { adminLevelOf, type GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { Cast, CastChampagne, CastSession } from '../db/schema.js';
import type { DiscordActions, MessageBody } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { audit } from '../services/audit.js';
import {
  acceptSession,
  cancelSession,
  busySlots,
  lateCancelShare,
  parseSchedule,
  reportNoShow,
  scheduleInput,
  scheduleText,
  setSchedule,
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
  changeableReservations,
  openReservationsWithThread,
  roomMates,
  roomInUse,
  CUSTOMER_TOGETHER_MAX,
  proposeSessionTime,
  acceptSessionTime,
  castStatement,
  monthRange,
  deliverSession,
  receiveSession,
  isDeliverySession,
  DELIVERY,
  earlyRoomOk,
  isFreeSession,
  pickOptions,
  activeOptions,
  extensionPriceOf,
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
  sessionTime,
  rateSession,
  requestSession,
  roomDeleted,
  saveCastConfig,
  setBlocked,
  setSessionPlace,
  saveReservationHub,
  setWaiting,
  updateProfile,
  type CastConfig,
  type CastReception,
  type ProfileInput,
} from '../services/cast.js';
import { awardCastRank, pastRankWinners } from '../services/castRank.js';
import { staffRoleIds } from '../services/meetings.js';
import { namesOf } from '../services/members.js';
import { loadReceptionAvatar, renderCastReception } from '../services/castReceptionImage.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const PINK = 0xe86a92;
const fmt = (n: number) => n.toLocaleString('ja-JP');
const unix = (d: Date) => Math.floor(d.getTime() / 1000);
const jstTime = (d: Date) => new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(11, 16);
const jstDay = (d: Date) => new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(5, 10).replace('-', '/');
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
/** 書き込みがあってから、メニューをいちばん下へ出し直すまで（続けて書き込まれている間は待つ） */
export const PANEL_BOTTOM_AFTER_MS = 5_000;

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
export const castOptionsText = (cast: Pick<Cast, 'options'>) => (activeOptions(cast).length ? `**➕ オプション**\n${activeOptions(cast).map((o) => `${o.name} **+${fmt(o.price)}銭**${o.note ? `（${o.note}）` : ""}`).join(' ／ ')}` : '');
const RULES = '-# 本物のお金のやり取り・性的な内容・連絡先の交換・録音は禁止です（しきたり）。困ったら部屋の「🚨 通報」を';

// ───────── メニュー（画像の下に、指名するメニュー） ─────────

/** #キャスト一覧 のメニュー: 上げた画像と、ランキング・キャストの方のボタン（予約・注文は 1 人ずつの紹介パネルから） */
export function castPanel(list: { cast: Cast; name: string; state: 'busy' | 'waiting' | 'off' }[], image?: { data: Uint8Array; contentType: string }, group?: CastGroup, /** 🏆 今月の上位（指名の多い順） */ top: { name: string; count: number }[] = []): MessageBody {
  const ext = image?.contentType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
  const open = list.filter((x) => x.state !== 'off').length;
  const medal = ['🥇', '🥈', '🥉'];
  return {
    embeds: [
      {
        title: group ? `🎀 ${GROUP_LABEL[group]}` : '🎀 キャスト',
        description: [
          '下の紹介から、メニューを選んで予約・注文できます。',
          `🟢 予約受付中 **${open}** 人 ・ 在籍 ${list.length} 人`,
          ...(top.length ? [`🏆 今月の上位: ${top.slice(0, 3).map((t, k) => `${medal[k]} ${t.name}（${t.count} 回）`).join('　')}`] : []),
          '-# 銭は社務所が預かり、受けてもらえなければ全額戻ります',
          '-# 2 人だけの部屋・寝落ち・納品は 18 歳以上だけ。18 歳未満の方は、公開の部屋での雑談（1 時間まで・22 時まで）を予約できます',
        ].join('\n'),
        color: PINK,
        ...(image ? { image: { url: `attachment://cast-menu.${ext}` } } : {}),
      },
    ],
    ...(image ? { files: [{ name: `cast-menu.${ext}`, contentType: image.contentType, data: image.data }], attachments: [] } : {}),
    components: [row(button(group ? `cast:rank:${group}` : 'cast:rank', '今月のランキング', 2, '🏆'), button('cast:me', 'キャストの方', 2, '⚙'), button('cast:changes:0', '予約を確認・日時変更', 2, '📅'), button(group ? `cast:group:${group}` : 'cast:group', '2〜3 人まとめて予約', 1, '👥'))],
  };
}

/** メニューを出す・書き換える（社務所Web・BOT の両方から）。出せたら true */
export async function refreshCastPanel(
  db: Db,
  discord: Pick<DiscordActions, 'sendMessage' | 'editMessage'> & Partial<Pick<DiscordActions, 'deleteMessage'>>,
  /** bottom: このチャンネルのメニューだけ、いちばん下に出し直す（前のものは消す） */
  opts: { repost?: boolean; by?: string; bottom?: ReadonlySet<string> } = {},
): Promise<boolean> {
  let c = await loadCastConfig(db);
  if (!c.channelId && !c.femaleChannelId) return false;
  const [list, states, stats] = await Promise.all([listCasts(db), castStates(db), castStats(db, monthStart())]);
  const names = await namesOf(db, list.map((x) => x.memberId));
  // 男性・女性のチャンネルが両方あれば分けて出す。片方だけなら、そこに全員を出す
  const split = Boolean(c.channelId && c.femaleChannelId);
  let posted = false;
  for (const g of CAST_GROUPS) {
    const place = groupPlace(c, g);
    if (!place.channelId) continue;
    const image = (await loadMenuImage(db, g)) ?? (g === 'female' ? await loadMenuImage(db, 'male') : undefined);
    const shown = list.filter((cast) => !split || inGroup(cast, g));
    const ids = new Set(shown.map((x) => x.memberId));
    const top = stats.filter((x) => x.count > 0 && ids.has(x.castId)).slice(0, 3).map((x) => ({ name: names.get(x.castId) ?? x.castId, count: x.count }));
    const body = castPanel(
      shown.map((cast) => ({ cast, name: names.get(cast.memberId) ?? cast.memberId, state: states.get(cast.memberId) ?? 'off' })),
      image,
      split ? g : undefined,
      top,
    );
    const toBottom = opts.bottom?.has(place.channelId) ?? false;
    if (opts.bottom && !toBottom) continue;
    if (place.messageId && !opts.repost && !toBottom) {
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
    // いちばん下に出し直したときは、前のメニューを消す（チャットに何枚もたまらないように）
    if (toBottom && place.messageId && place.messageId !== id) await discord.deleteMessage?.(place.channelId, place.messageId).catch(() => undefined);
    posted = true;
  }
  return posted;
}

/**
 * 📋 /パネル キャスト一覧: キャスト一覧のパネルを、このチャンネルに出し直す（神職）。
 * group を決めなければ、ここが女性のチャンネルなら女性、ほかは男性（共通）。前の場所のパネルは消す
 */
export async function placeCastPanel(db: Db, discord: Pick<DiscordActions, 'sendMessage' | 'editMessage' | 'deleteMessage'>, channelId: string, group: CastGroup | undefined, by: string): Promise<CastGroup> {
  const c = await loadCastConfig(db);
  const g: CastGroup = group ?? (c.femaleChannelId === channelId ? 'female' : 'male');
  const old = groupPlace(c, g);
  if (old.channelId && old.messageId) await discord.deleteMessage(old.channelId, old.messageId).catch((err: unknown) => logger.warn({ err }, 'old cast panel delete failed'));
  await saveCastConfig(db, { ...c, ...(g === 'female' ? { femaleChannelId: channelId, femalePanelMessageId: undefined } : { channelId, panelMessageId: undefined }) }, by);
  await refreshCastPanel(db, discord, { by });
  return g;
}

/** 🗓 出勤予定と、これから 7 日の埋まっている時間（紹介パネル・予約の画面に出す） */
export function shiftText(schedule: Cast['schedule'], busy: { from: Date; until: Date }[]): string {
  const lines = [`🗓 **出勤予定**: ${scheduleText(schedule)}`];
  if (busy.length) lines.push(`-# 埋まっている時間: ${busy.slice(0, 6).map((b) => `<t:${unix(b.from)}:f>〜<t:${unix(b.until)}:t>`).join('、')}${busy.length > 6 ? ' ほか' : ''}`);
  return lines.join('\n');
}

/**
 * 🎀 キャストごとの紹介パネル（みんなに見える。社務所Web から出す）: 名前・紹介・メニュー・写真の全体と、指名の選ぶ欄・予約。
 * 選んだあとのやり取りは、押した人にだけ見える形で返す（パネルは書き換えない）
 */
async function castIntroBody(db: Db, castId: string) {
  const cast = await getCast(db, castId);
  if (!cast) return undefined;
  const [name, photo, stats, busy] = await Promise.all([namesOf(db, [castId]).then((m) => m.get(castId) ?? castId), loadCastPhoto(db, castId), castStats(db, monthStart()), busySlots(db, castId)]);
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
      ...(activeOptions(cast).length ? [{ type: 10, content: castOptionsText(cast) }] : []),
      { type: 10, content: shiftText(cast.schedule, busy) },
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
/** キャストの内容を変えたら、紹介とメニュー（パネル）を両方書きかえる */
export async function refreshCastViews(db: Db, discord: Pick<DiscordActions, 'sendMessage' | 'editMessage'>, castId?: string): Promise<boolean> {
  const intros = await refreshCastIntros(db, discord, castId).catch((err: unknown) => (logger.warn({ err }, 'cast intros refresh failed'), false));
  const panel = await refreshCastPanel(db, discord).then(() => true, (err: unknown) => (logger.warn({ err }, 'cast panel refresh failed'), false));
  return intros && panel;
}

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

/** ⭐ 評価のボタン（1〜5） */
const rateButtons = (id: number) => [1, 2, 3, 4, 5].map((n) => button(`cast:rate:${id}:${n}`, '⭐'.repeat(n), n === 5 ? 1 : 2));

/** 部屋のチャットに出す、指名の知らせ・通話中の操作・終わり */
export function sessionMessage(s: CastSession, c: CastConfig, coin: string, opts: { rateInRoom?: boolean } = {}) {
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
    lines.push(`-# 始まってから ${c.noShowMinutes} 分たっても相手が来ないときは「🚫 相手が来ない」（来ている人だけ押せます）。`);
    buttons = [...(isFreeSession(s) ? [] : [button(`cast:ext:${s.id}:${s.extensions}`, '30 分のばす（お客）', 1, '⏰')]), button(`cast:end:${s.id}`, '終える'), button(`cast:noshow:${s.id}`, '相手が来ない', 2, '🚫'), button(`cast:report:${s.id}`, '通報', 4, '🚨'), button(`cast:champagne:${s.id}`, 'シャンパンを贈る（お客）', 1, '🍾')];
  } else if (s.status === 'done') {
    title = '🎉 おつかれさまでした';
    if (opts.rateInRoom === false) {
      // ⭐ 評価のお願いは、お客に DM で送った（部屋は少しあとに消えるので）
      lines.push(`キャストに ${coin} ${fmt(s.paid)} 枚を渡しました。<@${s.customerId}> さん、評価のお願いを DM で送りました（この部屋は少しあとに消えます）。`);
    } else {
      lines.push(`キャストに ${coin} ${fmt(s.paid)} 枚を渡しました。<@${s.customerId}> さん、よければ評価をお願いします（この部屋は少しあとに消えます）。`);
      buttons = rateButtons(s.id);
    }
  } else if (s.status === 'declined') {
    title = '🙇 今回は受けられませんでした';
    lines.push('預かっていた銭は全部戻しました。');
  } else if (s.status === 'canceled') {
    title = '取り消しました';
    lines.push(s.paid > 0 ? `直前の取り消しのため、キャストに ${fmt(s.paid)} 枚（手数料を引いたあと）を渡し、残りを戻しました。` : '預かっていた銭は全部戻しました。');
  } else if (s.status === 'noshow_cast') {
    title = '🚫 キャストが来ませんでした';
    lines.push('預かっていた銭は全部戻しました。');
  } else if (s.status === 'noshow_customer') {
    title = '🚫 お客が来ませんでした';
    lines.push(`決まりにより、キャストに ${fmt(s.paid)} 枚（手数料を引いたあと）を渡し、残りを戻しました。`);
  } else if (s.status === 'disputed') {
    title = '🚨 通報がありました';
    lines.push('運営が確認します。銭は、運営が決めるまで預かったままにします。');
  }
  lines.push(RULES);
  const rows = buttons.length > 5 ? [row(...buttons.slice(0, 5))] : buttons.length ? [row(...buttons)] : [];
  return { embeds: [{ title, description: lines.filter(Boolean).join('\n'), color: s.status === 'disputed' ? 0xd7003a : PINK }], components: rows };
}

/** キャスト本人だけに表示する画像と受付ボタン */
export function castReceptionBody(d: CastReception, name: string, names: ReadonlyMap<string, string>, currency: string, guildId: string, avatar?: Uint8Array, /** キャスト用 社務所（メニュー・写真の編集）へのリンク */ officeUrl?: string) {
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
      row(button('cast:wait:1', '予約を受け付ける', 3, '🟢', off || d.cast.available === 'waiting'), button('cast:wait:0', '受付停止', 2, '💤', off || d.cast.available !== 'waiting'), button('cast:refresh', '更新', 1, '🔄'), button('cast:changes:0', '予約日時の変更', 2, '📅')),
      row(...d.current.filter((s) => s.channelId).slice(0, 2).map((s, k) => ({ ...roomEntry(guildId, s.channelId!), label: k ? '部屋へ入る（2）' : '部屋へ入る' })), button('cast:schedule:0', '予約一覧', 2, '📅'), button('cast:sales:0', '売上の明細', 2, '💰'), button('cast:shift', '出勤予定', 2, '🗓')),
      row(button('cast:edit', '紹介を変える', 1, '✏️'), ...(officeUrl ? [{ type: 2 as const, style: 5 as const, label: '🖊 メニュー・写真を編集', url: officeUrl }] : []), button('cast:minor', d.cast.minorOk ? '18歳未満の雑談を受けない' : '18歳未満の雑談を受ける'), button('cast:blockui', 'ブロック', 4), button('cast:unblockui', 'ブロックを外す')),
    ],
  };
}

/** 💬 相談の種類と、通話で選べる時間（分） */
type ConsultKind = 'call' | 'dlv' | 'other';
const CONSULT_LABEL: Record<ConsultKind, string> = { call: '📞 通話', dlv: '📦 納品', other: '✏️ そのほか' };
export const CONSULT_MINUTES = [30, 60, 90, 120, 180, 240];

/** 社務所からキャストへの DM で押せるボタン・フォーム */
const DM_ACTIONS = new Set(['accept', 'decline', 'propose', 'pmodal', 'dlv', 'rate']);

export class CastApp {
  private guild?: Guild;
  private ticking = false;
  private leaderboardChecked = false;
  private introsDiscovered = false;
  private syncingIntros = false;
  /** 起動して 1 回だけ、進行中の予約のスレッドのメッセージを、いまの形（ボタン・時間の表示）に書き換えた */
  private threadsRefreshed = false;
  private creatingReservationHub?: Promise<TextChannel | undefined>;

  constructor(
    private readonly db: Db,
    private readonly cfg: () => GuildConfig,
    private readonly discord: DiscordActions,
    /** 社務所Web の場所（キャスト用 社務所へのリンク） */
    private readonly baseUrl?: string,
    /** メッセージの中身・添付が見えるか（MESSAGE CONTENT INTENT）。見えれば納品のファイルを確かめる */
    private readonly messageContent = false,
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

  /** 📌 メニューをいちばん下へ出し直すのを待っているチャンネル（書き込みが続く間は待つ） */
  private readonly bottomTimers = new Map<string, NodeJS.Timeout>();
  private bottomQueue: Promise<unknown> = Promise.resolve();

  /** #キャスト一覧 に書き込み（BOT の紹介パネルもふくむ）があったら、少しあとにメニューをいちばん下へ */
  onMessage(m: Message): void {
    if (!m.inGuild() || m.guildId !== this.cfg().guildId) return;
    const channelId = m.channelId;
    void loadCastConfig(this.db).then((c) => {
      const place = CAST_GROUPS.map((g) => groupPlace(c, g)).find((p) => p.channelId === channelId);
      if (!place || place.messageId === m.id) return;
      clearTimeout(this.bottomTimers.get(channelId));
      this.bottomTimers.set(channelId, setTimeout(() => {
        this.bottomTimers.delete(channelId);
        void this.keepPanelAtBottom([channelId]);
      }, PANEL_BOTTOM_AFTER_MS));
    }).catch(() => undefined);
  }

  /** メニューがいちばん下になければ、出し直す（channelIds を省くと全部のメニューを確かめる） */
  keepPanelAtBottom(channelIds?: string[]): Promise<unknown> {
    this.bottomQueue = this.bottomQueue.then(async () => {
      const c = await loadCastConfig(this.db);
      const need = new Set<string>();
      for (const g of CAST_GROUPS) {
        const p = groupPlace(c, g);
        if (!p.channelId || !p.messageId || (channelIds && !channelIds.includes(p.channelId))) continue;
        const ch = this.guild?.channels.cache.get(p.channelId);
        const last = ch && 'lastMessageId' in ch ? ch.lastMessageId : undefined;
        if (last && last !== p.messageId) need.add(p.channelId);
      }
      if (need.size) await refreshCastPanel(this.db, this.discord, { bottom: need });
    }).catch((err: unknown) => logger.warn({ err }, 'cast panel bottom failed'));
    return this.bottomQueue;
  }

  private roles(i: { member: GuildMember }): string[] {
    return [...i.member.roles.cache.keys()];
  }

  private refresh(): void {
    void refreshCastLeaderboard(this.db, this.discord, this.cfg().economy.currencyName).catch((err: unknown) => logger.warn({ err }, 'cast leaderboard refresh failed'));
    void refreshCastIntros(this.db, this.discord).catch(err => logger.warn({ err }, 'cast intros refresh failed'));
    void refreshCastPanel(this.db, this.discord).catch((err: unknown) => logger.warn({ err }, 'cast panel refresh failed'));
  }

  async onInteraction(interaction: Interaction): Promise<void> {
    // /キャスト: キャスト本人の受付（待機の切り替え・予約一覧・メニュー編集へのリンク）を自分にだけ出す
    if ('commandName' in interaction && interaction.commandName === 'cast' && interaction.isChatInputCommand()) {
      if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
      try {
        await interaction.deferReply(EPHEMERAL);
        await interaction.editReply(await this.receptionView(interaction.member));
      } catch (err) {
        logger.warn({ err }, 'cast command failed');
        await interaction.editReply({ content: 'うまくいきませんでした。時間をおいてもう一度お試しください。' }).catch(() => undefined);
      }
      return;
    }
    if ('commandName' in interaction && interaction.commandName === 'panel' && interaction.isChatInputCommand() && interaction.options.getSubcommand(false) === 'cast-ranking') {
      if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
      await interaction.deferReply(EPHEMERAL);
      try {
        if (!adminLevelOf(this.cfg(), this.roles(interaction))) return void(await interaction.editReply('神職・宮司のみ置けます。'));
        if (!interaction.channel?.isSendable()) return void(await interaction.editReply('このチャンネルには置けません。'));
        await refreshCastLeaderboard(this.db,this.discord,this.cfg().economy.currencyName,{channelId:interaction.channelId,by:interaction.user.id,force:true,via:'discord'});
        await interaction.editReply('🏆 今月の指名本数・売上ランキングを置きました。変更があると自動で更新します。');
      } catch(err) { logger.warn({err},'cast leaderboard place failed'); await interaction.editReply('ランキングを出せませんでした。BOTの書き込み権限を確かめてください。').catch(()=>undefined); }
      return;
    }
    if ('commandName' in interaction && interaction.commandName === 'panel' && interaction.isChatInputCommand() && interaction.options.getSubcommand(false) === 'cast') {
      if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
      await interaction.deferReply(EPHEMERAL);
      try {
        if (!adminLevelOf(this.cfg(), this.roles(interaction))) return void (await interaction.editReply('神職・宮司のみ置けます。'));
        if (!interaction.channel?.isSendable()) return void (await interaction.editReply('このチャンネルには置けません。'));
        const pick = interaction.options.getString('group');
        const g = await placeCastPanel(this.db, this.discord, interaction.channelId, pick === 'male' || pick === 'female' ? pick : undefined, interaction.user.id);
        await audit(this.db, { actorId: interaction.user.id, action: 'cast.panel_place', detail: { channelId: interaction.channelId, group: g }, via: 'discord' });
        await interaction.editReply(`🎀 キャスト一覧（${g === 'female' ? '女性' : '男性・共通'}）のパネルを、このチャンネルに出しました。これからはここが書きかわります。`);
      } catch (err) {
        logger.warn({ err }, 'cast panel command failed');
        await interaction.editReply('パネルを出せませんでした。BOT がこのチャンネルに書けるか確かめてください。').catch(() => undefined);
      }
      return;
    }
    if (!('customId' in interaction) || !interaction.customId.startsWith('cast:')) return;
    const [, action, a, b, ...rest] = interaction.customId.split(':');
    // 社務所からキャストへの DM のボタン（受ける・別の日時を提案・断る・納品した）
    if (!interaction.guildId) {
      if (!DM_ACTIONS.has(action ?? '')) return;
      try {
        return await this.onDm(interaction, action ?? '', Number(a), Number(b));
      } catch (err) {
        logger.warn({ err, id: interaction.customId }, 'cast dm failed');
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) await interaction.reply({ content: 'うまくいきませんでした。時間をおいてもう一度お試しください。' }).catch(() => undefined);
        return;
      }
    }
    if (!interaction.inCachedGuild() || interaction.guildId !== this.cfg().guildId) return;
    try {
      if (interaction.isStringSelectMenu()) {
        if (action === 'changesel') return await this.proposeModal(interaction, Number(interaction.values[0]));
        if (action === 'champagnesel') return await this.champagneSelect(interaction, Number(a), interaction.values[0] ?? '');
        if (action === 'pick') return await this.pick(interaction, interaction.values[0] ?? '');
        if (action === 'plansel') return await this.confirm(interaction, a ?? '', interaction.values[0] ?? '');
        if (action === 'opts') return await this.confirm(interaction, a ?? '', b ?? '', interaction.values);
        if (action === 'rplansel') return await this.reserveModal(interaction, a ?? '', interaction.values[0] ?? '');
        if (action === 'gcasts') return await this.groupMenus(interaction, interaction.values);
        if (action === 'gplans') return await this.groupModal(interaction, interaction.values);
        if (action === 'cmin') return void (await interaction.showModal(this.consultModal(a ?? '', b ?? '', 'call', CONSULT_MINUTES.includes(Number(interaction.values[0])) ? Number(interaction.values[0]) : 60)));
        return;
      }
      if (interaction.isUserSelectMenu()) {
        if (action === 'block' || action === 'unblock') return await this.block(interaction, action === 'block');
        return;
      }
      if (interaction.isModalSubmit()) {
        if (action === 'applymodal') return void (await interaction.reply({ content: '🎀 キャストは、運営が登録します。キャストになりたい方は、運営に声をかけてください。', ...EPHEMERAL }));
        if (action === 'editmodal') return await this.profileSubmit(interaction);
        if (action === 'shiftmodal') return await this.shiftSubmit(interaction);
        if (action === 'pmodal') return await this.proposeSubmit(interaction, Number(a));
        if (action === 'gmodal') return await this.groupSubmit(interaction, a ?? '');
        if (action === 'rmodal') return await this.reserveSubmit(interaction, a ?? '', b ?? '', rest[0] ? rest[0].split(',') : undefined);
        if (action === 'qrmodal') {
          const [customerId, minutes, price] = rest;
          if (interaction.user.id !== customerId) return void (await interaction.reply({ content: 'この提案で予約できるのは、相談した人だけです。', ...EPHEMERAL }));
          return await this.reserveSubmit(interaction, a ?? '', b ?? '', undefined, { minutes: Number(minutes), price: Number(price) });
        }
        if (action === 'omodal') return await this.orderSubmit(interaction, a ?? '', b ?? '');
        if (action === 'cmodal') return await this.consultSubmit(interaction, a ?? '', b ?? '', rest[0], rest[1]);
        if (action === 'qmodal') return await this.quoteSubmit(interaction, a ?? '', b ?? '', rest[0] ?? '', rest[1]);
        return;
      }
      if (!interaction.isButton()) return;
      if (action === 'now') return await this.waitingList(interaction, isCastGroup(a) ? a : undefined);
      if (action === 'live-rank-update') {
        await interaction.deferReply(EPHEMERAL);
        if (!adminLevelOf(this.cfg(), this.roles(interaction))) return void(await interaction.editReply('運営のみ更新できます。ランキングは自動で更新されます。'));
        const ok=await refreshCastLeaderboard(this.db,this.discord,this.cfg().economy.currencyName,{force:true,by:interaction.user.id});
        return void(await interaction.editReply(ok?'ランキングを最新に更新しました。':'先にランキングパネルを置いてください。'));
      }
      if (action === 'rank') return await this.ranking(interaction, isCastGroup(a) ? a : undefined);
      if (action === 'group') return await this.groupCasts(interaction, isCastGroup(a) ? a : undefined);
      if (action === 'apply') return await this.applyModal(interaction);
      if (action === 'me') return await this.mine(interaction);
      if (action === 'refresh') return await this.mine(interaction, true);
      if (action === 'schedule') return await this.schedule(interaction, Number(a ?? 0));
      if (action === 'changes') return await this.changePicker(interaction, Number(a ?? 0));
      if (action === 'timeok') return await this.proposeAccept(interaction, a ?? '');
      if (action === 'sales') return await this.sales(interaction, Number(a ?? 0));
      if (action === 'edit') return await this.editModal(interaction);
      if (action === 'shift') return await this.shiftModal(interaction);
      if (action === 'wait') return await this.wait(interaction, Number(a));
      if (action === 'minor') return await this.toggleMinor(interaction);
      if (action === 'blockui' || action === 'unblockui') return await this.blockPicker(interaction, action === 'blockui');
      if (action === 'plan') return await this.confirm(interaction, a ?? '', b ?? '');
      // キャストは予約だけ（前のメッセージに残った「指名する」も、日時を入れる予約にする）
      if (action === 'go') return await this.reserveModal(interaction, a ?? '', b ?? '', rest[0] ? rest[0].split(',') : undefined);
      if (action === 'quote') return await this.quoteModal(interaction, a ?? '', b ?? '', rest[0] ?? '', rest[1], rest[2]);
      if (action === 'ckind') return await this.consultKind(interaction, a ?? '', b ?? '', rest[0] ?? '');
      if (action === 'qdlv') return await this.quoteDelivery(interaction, a ?? '', b ?? '', rest);
      if (action === 'qgo') return await this.quoteGo(interaction, a ?? '', b ?? '', rest);
      if (action === 'rsv') return await this.reservePlans(interaction, a ?? '');
      if (action === 'rplan') return await this.reserveModal(interaction, a ?? '', b ?? '', rest[0] ? rest[0].split(',') : undefined);
      if (action === 'champagnebuy') return await this.champagneBuy(interaction, a ?? '');
      const id = Number(a);
      if (!Number.isSafeInteger(id)) return;
      if (action === 'champagne') return await this.champagneMenu(interaction, id);
      if (action === 'accept') return await this.accept(interaction, id);
      if (action === 'propose') return await this.proposeModal(interaction, id);
      if (action === 'early') return await this.earlyRoom(interaction, id);
      if (action === 'dlv') return await this.deliver(interaction, id);
      if (action === 'rcv') return await this.receive(interaction, id);
      if (action === 'pok') return void (await interaction.reply({ content: 'この古い提案は使えません。「日時変更を提案」からもう一度提案してください。', ...EPHEMERAL }));
      if (action === 'decline' || action === 'cancel') return await this.cancel(interaction, id, action === 'decline' ? 'declined' : 'canceled');
      if (action === 'cancelok') return await this.cancel(interaction, id, 'canceled', true);
      if (action === 'noshow') return await this.noShow(interaction, id);
      if (action === 'extconfirm') return await this.confirmExtend(interaction, id, b === undefined ? 0 : Number(b), rest[0]);
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
    await i.deferReply(EPHEMERAL);
    const data=await castLeaderboard(this.db);
    const members=group?new Map((await listCasts(this.db,['active','paused'])).map(x=>[x.memberId,x])):undefined;
    const stats=data.rows.filter(x=>!members||(members.get(x.castId)&&inGroup(members.get(x.castId)!,group!)));
    const names=await namesOf(this.db,stats.map(x=>x.castId));
    const body=castLeaderboardBody(data.month,stats,names,this.cfg().economy.currencyName);
    await i.editReply({...body,components:[],allowedMentions:{parse:[]}} as never);
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
    // キャスト用 社務所へは、本人だけの 1 回きりのリンクで入る（Discord のログイン画面を通らない）
    const link = this.baseUrl ? await createLoginLink(this.db, { id: member.id, displayName: member.displayName, avatarUrl: member.displayAvatarURL({ size: 128 }) }).catch(() => undefined) : undefined;
    return castReceptionBody(d, member.displayName, names, this.cfg().economy.currencyName, this.cfg().guildId, avatar, link ? `${this.baseUrl}/cast-office/link/${link}` : undefined);
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

  /** 💰 売上の明細（本人だけ。月ごと・新しい順に 20 件まで） */
  private async sales(i: ButtonInteraction<'cached'>, back: number): Promise<void> {
    await i.deferUpdate();
    if (!(await getCast(this.db, i.user.id))) return void (await i.editReply({ content: 'キャストの方だけが使えます。', embeds: [], components: [], attachments: [] }));
    const months = Number.isSafeInteger(back) ? Math.max(0, Math.min(back, 23)) : 0;
    const range = monthRange(months);
    const st = await castStatement(this.db, i.user.id, range.from, range.to);
    const names = await namesOf(this.db, st.rows.slice(0, 20).map((r) => r.customerId));
    const lines = st.rows.slice(0, 20).map((r) =>
      `${jstDay(r.closedAt)} ｜ ${(names.get(r.customerId) ?? '利用者').replace(/[@*_~`<>|\r\n]/g, '').slice(0, 20)} さん ｜ ${r.delivery ? '📦 ' : ''}${r.label} ｜ ${fmt(r.price)} → **${fmt(r.paid)}**`);
    const coin = this.cfg().economy.currencyName;
    await i.editReply({
      content: '', attachments: [],
      embeds: [{
        title: `💰 売上の明細（${range.label}）`,
        description: [
          `受け取った合計 **${fmt(st.total)} ${coin}** ・ ${st.count} 件`,
          '-# 左が支払額、右が受取額（手数料を引いたあと）。🍾は通話中のシャンパン。指名は途中で終えたときは話した分',
          '',
          ...(lines.length ? lines : ['この月の精算はありません。']),
          ...(st.rows.length > 20 ? [`-# ほか ${st.rows.length - 20} 件`] : []),
        ].join('\n'),
        color: PINK,
      }],
      components: [row(button(`cast:sales:${months + 1}`, '前の月', 2, undefined, months >= 23), button(`cast:sales:${months - 1}`, '次の月', 2, undefined, months === 0), button('cast:refresh', '受付に戻る', 1))],
      allowedMentions: { parse: [] },
    });
  }

  private async schedule(i: ButtonInteraction<'cached'>, page: number): Promise<void> {
    await i.deferUpdate();
    const d = await loadCastReception(this.db, i.user.id);
    if (!d) return void (await i.editReply({ content: 'キャストの方だけが使えます。', embeds: [], components: [], attachments: [] }));
    const pages = Math.max(1, Math.ceil(d.today.length / 10));
    const selected = Number.isSafeInteger(page) ? Math.max(0, Math.min(page, pages - 1)) : 0;
    const bookings = d.today.slice(selected * 10, (selected + 1) * 10);
    const names = await namesOf(this.db, bookings.map((s) => s.customerId));
    const description = bookings.map((s) => (s.startAt ? jstTime(s.startAt) : '') + ' ｜ ' + (names.get(s.customerId) ?? '利用者').replace(/[@*_~`<>|\r\n]/g, '').slice(0, 28) + ' さん ｜ ' + sessionLabel(s) + ' ｜ ' + sessionTime(s) + ' ｜ ' + ({ reserved: '返事待ち', accepted: '確定', active: '通話中', done: '終了', disputed: '運営確認中' } as Record<string, string>)[s.status]).join('\n');
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
      // まず、どんな相談か（通話・納品・そのほか）を選ぶ
      return void (await this.answer(i, {
        content: [`💬 <@${castId}> さんの **${item.name}**（内容により相談）`, 'どんなことを頼みたいですか？ 選ぶと、お願いを書く欄が出ます（まだ銭は払いません。キャストが値段を出します）。'].join('\n'),
        embeds: [],
        components: [row(
          button(`cast:ckind:${castId}:${item.id}:call`, '通話で頼む', 1, '📞'),
          button(`cast:ckind:${castId}:${item.id}:dlv`, '納品（ボイス・イラストなど）', 1, '📦'),
          button(`cast:ckind:${castId}:${item.id}:other`, 'そのほか', 2, '✏️'),
        )],
        attachments: [],
        allowedMentions: { parse: [] },
      }));
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
    const optionRow = activeOptions(cast).length
      ? [{
          type: 1 as const,
          components: [{
            type: 3 as const,
            custom_id: `cast:opts:${castId}:${plan}`,
            placeholder: '➕ オプションを付ける（いくつでも・なくてもよい）',
            min_values: 0,
            max_values: activeOptions(cast).length,
            options: activeOptions(cast).map((o) => ({ label: `${o.name} +${fmt(o.price)} 枚`.slice(0, 100), value: o.id, default: chosen.includes(o.id) })),
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

  // ───────── 💬 相談のメニュー: お客が種類（通話・納品・そのほか）と時間を選んでお願いを書く → キャストが値段を出す → お客がその値段で予約・注文する ─────────

  /** 種類を選んだ: 通話なら時間を選ぶ。納品・そのほかは、そのままお願いを書く */
  private async consultKind(i: ButtonInteraction<'cached'>, castId: string, itemId: string, kind: string): Promise<void> {
    if (kind === 'call') {
      return void (await i.update({
        content: '📞 何分くらい話したいですか？（キャストが値段を出すときの目安になります）',
        components: [{
          type: 1 as const,
          components: [{
            type: 3 as const,
            custom_id: `cast:cmin:${castId}:${itemId}`,
            placeholder: '時間を選ぶ',
            options: CONSULT_MINUTES.map((m) => ({ label: m >= 60 ? `${m / 60} 時間${m % 60 ? ` ${m % 60} 分` : ''}` : `${m} 分`, value: String(m) })),
          }],
        }],
        allowedMentions: { parse: [] },
      } as never));
    }
    await i.showModal(this.consultModal(castId, itemId, kind === 'dlv' ? 'dlv' : 'other'));
  }

  private consultModal(castId: string, itemId: string, kind: ConsultKind, minutes = 0) {
    const label = { call: '話したいこと（話題・雰囲気など）', dlv: '納品してほしいもの（内容・呼んでほしい名前など）', other: 'お願いしたいこと' }[kind];
    const when = { call: '希望の日時（例: 10/25 21時ごろ・なくてもよい）', dlv: '希望の期限（例: 今週中・なくてもよい）', other: '希望の日時・期限（なくてもよい）' }[kind];
    const title = { call: `📞 通話の相談（${minutes} 分）`, dlv: '📦 納品の相談', other: '✏️ 相談' }[kind];
    return new ModalBuilder()
      .setCustomId(`cast:cmodal:${castId}:${itemId}:${kind}:${minutes}`)
      .setTitle(title.slice(0, 45))
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('wish').setLabel(label).setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500)),
        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('when').setLabel(when).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100)),
      );
  }

  private async consultSubmit(i: ModalSubmitInteraction<'cached'>, castId: string, itemId: string, kindRaw = 'other', minutesRaw = '0'): Promise<void> {
    const kind: ConsultKind = kindRaw === 'call' || kindRaw === 'dlv' ? kindRaw : 'other';
    const minutes = kind === 'call' && CONSULT_MINUTES.includes(Number(minutesRaw)) ? Number(minutesRaw) : 0;
    await i.deferReply(EPHEMERAL);
    const cast = await getCast(this.db, castId);
    const item = cast && menuOf(cast).find((m) => m.id === itemId && m.consult);
    if (!cast || cast.status !== 'active' || !item) return void (await i.editReply('このメニューは、いまは選べません。'));
    if (cast.blocked.includes(i.user.id) || castId === i.user.id) return void (await i.editReply('このキャストには相談できません。'));
    if (!(await isAdult(this.db, this.cfg(), i.user.id, this.roles(i)))) return void (await i.editReply('相談のメニューは 18 歳以上の方だけです。'));
    const wish = i.fields.getTextInputValue('wish').trim().slice(0, 500);
    // 前のボタンから開いた欄には「希望」がない
    const when = (() => { try { return i.fields.getTextInputValue('when').trim().slice(0, 100); } catch { return ''; } })();
    const c = await loadCastConfig(this.db);
    const home = castHomeChannel(c, cast);
    const panel = home ? this.guild?.channels.cache.get(home) : undefined;
    if (panel?.type !== ChannelType.GuildText) return void (await i.editReply('相談の場所を作れませんでした。神職に知らせてください。'));
    const thread = await panel.threads.create({ name: `💬 相談 ${item.name}`.slice(0, 90), type: ChannelType.PrivateThread, invitable: false, reason: 'キャストの相談' }).catch(() => undefined);
    if (!thread) return void (await i.editReply('相談の場所を作れませんでした。神職に知らせてください。'));
    await thread.members.add(castId).catch(() => undefined);
    await thread.members.add(i.user.id).catch(() => undefined);
    await thread.send({
      content: [
        `<@${castId}> さん、<@${i.user.id}> さんから **${item.name}** の相談です。`,
        `種類: ${CONSULT_LABEL[kind]}${minutes ? ` ・ 時間: ${minutes} 分` : ''}${when ? ` ・ 希望: ${when}` : ''}`,
        `> ${wish.replace(/\n/g, '\n> ')}`,
        kind === 'dlv'
          ? '値段を決めたら「値段を出す」を押してください（お客がその値段で注文すると、いつもの納品と同じように、このスレッドに届けます）。'
          : '時間と値段を決めたら「値段を出す」を押してください（お客がその値段で予約すると、いつもの指名と同じように始まります）。',
        RULES,
      ].join('\n'),
      components: [row(button(`cast:quote:${castId}:${item.id}:${i.user.id}:${kind}:${minutes}`, '値段を出す（キャスト）', 1, '💬'))],
      allowedMentions: { users: [castId] },
    });
    await this.discord.sendDm(castId, `💬 ${item.name} の相談が届きました。<#${thread.id}> で値段を出してください。`).catch(() => false);
    await i.editReply(`💬 相談をお願いしました。キャストの返事は <#${thread.id}> に届きます（まだ銭は払っていません）。`);
  }

  private async quoteModal(i: ButtonInteraction<'cached'>, castId: string, itemId: string, customerId: string, kind = 'other', minutes = '0'): Promise<void> {
    if (i.user.id !== castId) return void (await i.reply({ content: '値段を出せるのはキャストだけです。', ...EPHEMERAL }));
    const dlv = kind === 'dlv';
    const time = new TextInputBuilder().setCustomId('minutes').setLabel('時間（分）').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(4).setPlaceholder('30');
    // お客が選んだ時間を、はじめから入れておく
    if (Number(minutes) > 0) time.setValue(String(Number(minutes)));
    const modal = new ModalBuilder()
      .setCustomId(`cast:qmodal:${castId}:${itemId}:${customerId}:${dlv ? 'dlv' : 'call'}`)
      .setTitle(dlv ? '📦 納品の値段を出す' : '💬 時間と値段を出す');
    if (!dlv) modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(time));
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('price').setLabel('値段（銭）').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(9).setPlaceholder('500')));
    await i.showModal(modal);
  }

  private async quoteSubmit(i: ModalSubmitInteraction<'cached'>, castId: string, itemId: string, customerId: string, kind = 'call'): Promise<void> {
    if (i.user.id !== castId) return void (await i.reply({ content: '値段を出せるのはキャストだけです。', ...EPHEMERAL }));
    const c = await loadCastConfig(this.db);
    if (kind === 'dlv') {
      const price = parsePrice(i.fields.getTextInputValue('price'));
      if (!Number.isInteger(price) || price < c.priceMin || price > c.priceMax) return void (await i.reply({ content: `値段は ${fmt(c.priceMin)} 枚から（上限なし）、数字で入れてください。`, ...EPHEMERAL }));
      return void (await i.reply({
        content: `📦 <@${customerId}> さん、<@${castId}> さんから **納品 ・ ${this.coin()} ${fmt(price)} 枚** の提案です。よければ「この値段で注文する」を押してください（銭は社務所が預かり、届いて受け取ったらキャストへ渡します）。`,
        components: [row(button(`cast:qdlv:${castId}:${itemId}:${customerId}:${price}`, `${fmt(price)} 枚で注文する（お客）`, 3, '📦'))],
        allowedMentions: { users: [customerId] },
      }));
    }
    const minutes = parsePrice(i.fields.getTextInputValue('minutes'));
    const price = parsePrice(i.fields.getTextInputValue('price'));
    if (!validQuote(c, minutes, price)) return void (await i.reply({ content: `時間は ${MENU_MINUTES.min}〜${MENU_MINUTES.max} 分、値段は ${fmt(c.priceMin)} 枚から（上限なし）で入れてください。`, ...EPHEMERAL }));
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

  /** 📦 納品の相談の提案で注文する（このスレッドに届けてもらう） */
  private async quoteDelivery(i: ButtonInteraction<'cached'>, castId: string, itemId: string, rest: string[]): Promise<void> {
    const [customerId, price] = rest;
    if (i.user.id !== customerId) return void (await i.reply({ content: 'この提案で注文できるのは、相談した人だけです。', ...EPHEMERAL }));
    await i.deferReply(EPHEMERAL);
    const c = await loadCastConfig(this.db);
    const adult = await isAdult(this.db, this.cfg(), i.user.id, this.roles(i));
    const r = await requestSession(this.db, c, { castId, customerId: i.user.id, customerAdult: adult, plan: itemId, quote: { minutes: 0, price: Number(price), delivery: true }, threadId: i.channelId });
    if (r.status !== 'ok') return void (await i.editReply(r.status === 'has_open' ? '納品待ちの注文が、1 人が同時に持てる数の上限です。届いてから次を注文してください。' : this.requestError(r)));
    const s = r.session;
    const dm = await this.dmCast(s);
    await i.channel?.send({ ...(dm ? {} : { content: `<@${castId}>` }), ...this.reserveMessage(s, !dm), allowedMentions: { users: dm ? [] : [castId] } } as never).catch(() => undefined);
    // 押したボタンは消す（二重に注文しない。押しても 2 回目は「注文はもう…」になる）
    await i.message.edit({ components: [] }).catch(() => undefined);
    this.refresh();
    await i.editReply(`📦 注文しました。キャストが ${DELIVERY.deadlineLabel}以内に、このスレッドへ届けます（残り ${fmt(r.balance)} 枚）。`);
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
    await this.discord.sendDm(castId, `🎀 指名が入りました（${sessionLabel(r.session)}・${sessionTime(r.session)}）。<#${room.id}> で「受ける」を押してください。`).catch(() => false);
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
      has_open: '指名（返事待ち・確定・通話中の予約）が、1 人が同時に持てる数の上限です。終わってからどうぞ。',
      already_ordered: 'この相談では、もう注文しています。',
      self_overlap: `同じ時間に指名・予約できるのは、キャスト ${CUSTOMER_TOGETHER_MAX} 人までです。ちがう時間にしてください。`,
      overlap: 'その時間は、ほかの指名か予約と重なっています。時間を変えてください。',
      bad_time: '予約は 10 分後〜7 日後の時刻にしてください。',
      off_hours: 'その時間は、このキャストの出勤予定の外です。紹介パネルの「🗓 出勤予定」の時間にしてください。',
    };
    return r.status === 'insufficient' ? `${this.cfg().economy.currencyName}が足りません（${fmt(r.price)} 枚必要・いま ${fmt(r.balance)} 枚）。` : (map[r.status] ?? 'いまは指名できません。');
  }

  /** 通話の部屋を作る（2 人だけ: 運営も見られる / 公開: カテゴリのまま・2 人まで） */
  private async openRoom(s: CastSession): Promise<VoiceChannel | undefined> {
    const g = this.guild;
    if (!g) return undefined;
    // ふつうの予約が、ほかの指名の部屋につながっていたら（前の版で同じ時刻の予約をまとめていた分）、自分の部屋を作り直す
    const wrong = Boolean(s.channelId && !s.groupKey && (await roomInUse(this.db, s.channelId, s.id)));
    if (s.channelId && !wrong) return this.voice(s.channelId);
    // 👥 「まとめて予約」の、ほかのキャストの予約があれば、その部屋にこのキャストも入れる
    for (const mate of await roomMates(this.db, s)) {
      const shared = this.voice(mate.channelId);
      if (!shared) continue;
      try {
        await shared.permissionOverwrites.edit(s.castId, { ViewChannel: true, Connect: true, Speak: true, SendMessages: true }, { reason: `キャストの指名 #${s.id}（いっしょの部屋）` });
        if (shared.userLimit) await shared.setUserLimit(Math.min(99, shared.userLimit + 1), 'キャストがふえた');
        await setSessionPlace(this.db, s.id, { channelId: shared.id });
        return shared;
      } catch (err) {
        logger.warn({ err, sessionId: s.id }, 'cast shared room join failed');
      }
    }
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

  private async cancel(i: ButtonInteraction<'cached'>, id: number, reason: 'declined' | 'canceled', confirmed = false): Promise<void> {
    const c = await loadCastConfig(this.db);
    // ⏳ 直前の取り消し: 先にいくら戻るかを見せて、もう一度押してもらう
    if (reason === 'canceled' && !confirmed) {
      const before = await getSession(this.db, id);
      const late = before && before.customerId === i.user.id ? lateCancelShare(c, before) : 0;
      if (before && late > 0) {
        return void (await i.reply({
          content: `⏳ 始まる ${c.lateCancelMinutes} 分前を過ぎているので、取り消すと **${fmt(late)} 枚** がキャストに渡り、戻るのは **${fmt(before.price - late)} 枚** です。それでも取り消しますか？`,
          components: [row(button(`cast:cancelok:${id}`, '取り消す', 4))],
          ...EPHEMERAL,
        }));
      }
    }
    const s = await cancelSession(this.db, id, i.user.id, reason, new Date(), c);
    if (!s) return void (await i.reply({ content: reason === 'declined' ? '断れるのは、指名されたキャストだけです。' : '取り消せるのは、指名した人だけです（始まる前まで。納品の注文は取り消せません）。', ...(i.guildId ? EPHEMERAL : {}) }));
    if (confirmed) {
      // 確かめの画面（本人にだけ見える）から押したときは、スレッドのメッセージを書き換えて、確かめの画面を閉じる
      await this.editThreadMessage(s);
      await i.update({ content: s.paid > 0 ? `取り消しました。キャストに ${fmt(s.paid)} 枚を渡し、残りを戻しました。` : '取り消しました。', components: [] });
    } else await this.afterCast(i, s, s.threadId ? this.reserveMessage(s) : sessionMessage(s, c, this.coin()));
    await this.discord.sendDm(reason === 'declined' ? s.customerId : s.castId, reason === 'declined' ? `🙇 今回の指名は受けられませんでした。${fmt(s.price)} 枚を戻しました。` : s.paid > 0 ? `🎀 予約が直前に取り消されました。決まりにより ${fmt(s.paid)} 枚を渡しました。` : '🎀 指名が取り消されました。').catch(() => false);
    this.refresh();
  }

  /** スレッドの予約のメッセージを、いまの状態に書き換える（見つからなければ何もしない） */
  private async editThreadMessage(s: CastSession): Promise<void> {
    const th = s.threadId ? this.guild?.channels.cache.get(s.threadId) ?? (await this.guild?.channels.fetch(s.threadId).catch(() => null)) : undefined;
    if (!th?.isTextBased()) return;
    const msgs = await th.messages.fetch({ limit: 20 }).catch(() => undefined);
    const mine = msgs?.find((m) => m.author.id === th.client.user.id && m.components.some((r) => 'components' in r && r.components.some((x) => 'customId' in x && x.customId?.endsWith(`:${s.id}`))));
    await mine?.edit({ ...this.reserveMessage(s), allowedMentions: { parse: [] } } as Parameters<typeof mine.edit>[0]).catch(() => undefined);
  }

  /** 🚫 相手が来ない（来ている人が押す。押した人が部屋にいて、相手がいないときだけ） */
  private async noShow(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const c = await loadCastConfig(this.db);
    const before = await getSession(this.db, id);
    if (!before || before.status !== 'active') return void (await i.reply({ content: 'この指名は、もう終わっています。', ...EPHEMERAL }));
    if (i.user.id !== before.castId && i.user.id !== before.customerId) return void (await i.reply({ content: '押せるのは、この指名の 2 人だけです。', ...EPHEMERAL }));
    const room = this.voice(before.channelId);
    const other = i.user.id === before.castId ? before.customerId : before.castId;
    if (!room?.members.has(i.user.id)) return void (await i.reply({ content: 'この部屋（通話）に入ってから押してください。', ...EPHEMERAL }));
    if (room.members.has(other)) return void (await i.reply({ content: '相手は部屋にいます。', ...EPHEMERAL }));
    const r = await reportNoShow(this.db, c, id, i.user.id);
    if (r.status === 'too_early') return void (await i.reply({ content: `始まってから ${c.noShowMinutes} 分たつまで待ってください。`, ...EPHEMERAL }));
    if (r.status !== 'ok') return void (await i.reply({ content: 'この指名は、もう終わっています。', ...EPHEMERAL }));
    await i.update({ ...sessionMessage(r.session, c, this.coin()), allowedMentions: { parse: [] } } as Parameters<typeof i.update>[0]);
    const castAbsent = r.session.status === 'noshow_cast';
    await this.discord.sendDm(r.session.customerId, castAbsent ? `🚫 キャストが来なかったので、${fmt(r.refund)} 枚を全部戻しました。` : `🚫 予約の時間に来られなかったので、決まりにより ${fmt(r.session.price - r.refund)} 枚をキャストに渡し、${fmt(r.refund)} 枚を戻しました。`).catch(() => false);
    await this.discord.sendDm(r.session.castId, castAbsent ? '🚫 予約の時間に来られなかったので、お客に全額戻しました。続くときは、運営から連絡することがあります。' : `🚫 お客が来なかったので、${fmt(r.pay)} 枚を渡しました。`).catch(() => false);
    this.refresh();
  }

  /** 🗓 出勤予定を決める（キャスト本人） */
  private async shiftModal(i: ButtonInteraction<'cached'>): Promise<void> {
    const cast = await getCast(this.db, i.user.id);
    if (!cast || cast.status === 'removed') return void (await i.reply({ content: 'キャストの方だけ使えます。', ...EPHEMERAL }));
    await i.showModal(
      new ModalBuilder()
        .setCustomId('cast:shiftmodal')
        .setTitle('🗓 出勤予定（毎週）')
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId('shift')
              .setLabel('1 行に 1 つ。例: 月水金 21:00-24:00 ／ 土 20:00-26:00')
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false)
              .setMaxLength(500)
              .setValue(scheduleInput(cast.schedule))
              .setPlaceholder('空にすると、いつでも予約できます'),
          ),
        ),
    );
  }

  private async shiftSubmit(i: ModalSubmitInteraction<'cached'>): Promise<void> {
    const list = parseSchedule(i.fields.getTextInputValue('shift'));
    if (!list) return void (await i.reply({ content: '読めない行がありました。「月水金 21:00-24:00」のように、曜日と時間（30 分以上・次の日の 6:00 = 30:00 まで）で書いてください。', ...EPHEMERAL }));
    const cast = await setSchedule(this.db, i.user.id, list);
    if (!cast) return void (await i.reply({ content: 'キャストの方だけ使えます。', ...EPHEMERAL }));
    await i.reply({ content: `🗓 出勤予定を ${scheduleText(cast.schedule)} にしました。この時間の外は予約できません（もう入っている予約はそのまま）。`, ...EPHEMERAL });
    this.refresh();
  }

  private champagneHere(s: CastSession): boolean {
    const states = this.guild?.voiceStates.cache;
    return !!s.channelId && states?.get(s.customerId)?.channelId === s.channelId && states?.get(s.castId)?.channelId === s.channelId;
  }

  private async champagneMenu(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    await i.deferReply(EPHEMERAL);
    try {
      const s = await getSession(this.db,id);
      assertChampagneActive(s,{customerId:i.user.id,channelId:i.channelId},s=>this.champagneHere(s),new Date());
      await i.editReply({content:'🍾 キャストとの時間に、ありがとうを。ボトルを選ぶと金額と配分を確認できます。確定するまで銭は使いません。通話時間は延びません。',components:[{type:1,components:[{type:3,custom_id:`cast:champagnesel:${id}`,placeholder:'シャンパンを選ぶ',options:CHAMPAGNES.map(b=>({label:`${b.name} · ${fmt(b.price)} ${this.cfg().economy.currencyName}`,value:b.id,emoji:{name:b.emoji}}))}]}],allowedMentions:{parse:[]}});
    } catch(err) { await i.editReply({content:champagneError(err),components:[]}); }
  }

  private async champagneSelect(i: StringSelectMenuInteraction<'cached'>, id: number, bottleId: string): Promise<void> {
    await i.deferUpdate();
    try {
      const q=await prepareChampagne(this.db,id,bottleId,{customerId:i.user.id,channelId:i.channelId},s=>this.champagneHere(s));
      const image=champagnePreview(q.bottle);
      await i.editReply({content:`${q.bottleName}：${fmt(q.price)} ${this.coin()}\nキャスト受取 ${fmt(q.price-q.fee)}／手数料 ${fmt(q.fee)}。今すぐキャストへ入金します。通話時間は延びません。\nこの確認は5分間有効です。`,embeds:[{image:{url:'attachment://champagne.png'}}],files:[new AttachmentBuilder(image,{name:'champagne.png'})],attachments:[],components:[row(button(`cast:champagnebuy:${q.id}`,'料金を確認して贈る',3,'🍾'))],allowedMentions:{parse:[]}});
    } catch(err) { await i.editReply({content:champagneError(err),components:[],embeds:[],attachments:[]}); }
  }

  private async champagneBuy(i: ButtonInteraction<'cached'>, id: string): Promise<void> {
    await i.deferUpdate();
    let result;
    try { result=await buyChampagne(this.db,id,{customerId:i.user.id,channelId:i.channelId},s=>this.champagneHere(s)); }
    catch(err){await i.editReply({content:champagneError(err),components:err instanceof ChampagneError?[]:[row(button(`cast:champagnebuy:${id}`,'購入結果を確認・再試行',1))],embeds:[],attachments:[]});return;}
    const q=result.purchase;
    void refreshCastLeaderboard(this.db,this.discord,this.cfg().economy.currencyName).catch((err:unknown)=>logger.warn({err},'cast leaderboard refresh failed'));
    let shown=true;
    try {
      await announceChampagne(this.db,q.id,i.user.id,async purchase=>{
        if(!this.voice(purchase.channelId))throw new ChampagneError('表示する部屋がありません。');
        let file;
        try {file={name:'champagne.gif',contentType:'image/gif',data:await champagneAnimation(purchase.bottle)};}
        catch(err){logger.warn({err},'champagne image failed');}
        const b=champagneOf(purchase.bottle);
        const message=await this.discord.sendMessage(purchase.channelId,{embeds:[{title:`${b?.emoji ?? '🍾'} ${purchase.bottleName}で乾杯！`,description:`<@${purchase.customerId}> さんから <@${purchase.castId}> さんへ。\n${fmt(purchase.price)} ${this.coin()}のシャンパンを贈りました。\nキャスト受取 ${fmt(purchase.price-purchase.fee)}／手数料 ${fmt(purchase.fee)}。通話時間は延びません。`,color:parseInt((b?.color ?? '#eac38c').slice(1),16),...(file?{image:{url:'attachment://champagne.gif'}}:{})}],...(file?{files:[file]}:{}),allowed_mentions:{parse:[]},nonce:purchase.id.replaceAll('-','').slice(0,24),enforce_nonce:true});
        return message.id;
      });
    } catch(err){shown=false;logger.warn({err,purchaseId:q.id},'champagne announcement failed');}
    // 🍾 キャスト本人に DM（開栓のムービーつき）。初めて精算したときだけ（再試行で二度送らない）
    if(result.fresh) await this.champagneDm(q).catch((err:unknown)=>logger.warn({err,purchaseId:q.id},'champagne dm failed'));
    await i.editReply({content:`${result.fresh?'贈りました':'この購入は精算済みです（追加の支払いはありません）'}：${q.bottleName}\n支払 ${fmt(q.price)} ${this.coin()}／キャスト受取 ${fmt(q.price-q.fee)}／手数料 ${fmt(q.fee)}。\n残高 ${fmt(result.balance)}。購入番号 ${q.id}。${shown?'':'\n購入と入金は完了しましたが、開栓表示が届いたか確認できません。「開栓表示を確認・再試行」は追加購入になりません。'}`,embeds:[],attachments:[],components:shown?[]:[row(button(`cast:champagnebuy:${q.id}`,'開栓表示を確認・再試行',1))],allowedMentions:{parse:[]}});
  }

  /** 🍾 シャンパンが届いたことを、キャスト本人に DM で知らせる（開栓のムービーつき。作れなければ文だけ） */
  private async champagneDm(q: CastChampagne): Promise<void> {
    const user = await this.guild?.client.users.fetch(q.castId).catch(() => undefined);
    if (!user) return;
    const b = champagneOf(q.bottle);
    let gif: Buffer | undefined;
    try { gif = await champagneAnimation(q.bottle); } catch (err) { logger.warn({ err }, 'champagne image failed'); }
    const name = (await namesOf(this.db, [q.customerId])).get(q.customerId) ?? 'お客';
    await user.send({
      embeds: [{
        title: `${b?.emoji ?? '🍾'} シャンパンが届きました！`,
        description: `${name} さんから **${q.bottleName}** を贈られました。\n${this.coin()} ${fmt(q.price - q.fee)} 枚を受け取りました（値段 ${fmt(q.price)}・手数料 ${fmt(q.fee)}）。`,
        color: parseInt((b?.color ?? '#eac38c').slice(1), 16),
        ...(gif ? { image: { url: 'attachment://champagne.gif' } } : {}),
      }],
      ...(gif ? { files: [new AttachmentBuilder(gif, { name: 'champagne.gif' })] } : {}),
      allowedMentions: { parse: [] },
    });
  }

  private async extend(i: ButtonInteraction<'cached'>, id: number, expected: number): Promise<void> {
    const s = await getSession(this.db, id);
    if (!s || s.customerId !== i.user.id || s.status !== 'active' || !s.endsAt || s.endsAt <= new Date() || s.extensions !== expected || isFreeSession(s)) {
      return void await i.reply({ content: 'この指名は延長できません。最新のボタンを確認してください。', ...EPHEMERAL });
    }
    await i.reply({ content: `30分の延長に ${fmt(extensionPriceOf(s))} ${this.coin()}かかります。確定するまで銭は使いません。`, components: [{ type: 1, components: [button(`cast:extconfirm:${id}:${expected}:${i.message.id}`, '料金を確認して30分延長', 1)] }], allowedMentions: { parse: [] }, ...EPHEMERAL });
  }

  private async confirmExtend(i: ButtonInteraction<'cached'>, id: number, expected: number, originalId?: string): Promise<void> {
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
    if (originalId && /^\d{17,20}$/.test(originalId) && i.channel) {
      const original = await i.channel.messages.fetch(originalId).catch(() => undefined);
      if (original?.author.id === i.client.user.id && original.components.some(row => 'components' in row && row.components.some(component => 'customId' in component && component.customId === `cast:ext:${id}:${expected}`))) {
        await original.edit({ ...sessionMessage(r.session, await loadCastConfig(this.db), this.coin()), allowedMentions: { parse: [] } } as Parameters<typeof original.edit>[0]).catch(() => undefined);
      }
    }
    await audit(this.db, { actorId: i.user.id, targetId: r.session.castId, action: 'cast.extend', detail: { sessionId: id, extensions: r.session.extensions, price: extensionPriceOf(r.session) }, via: 'discord' });
    this.refresh();
    await i.followUp({ content: `⏰ 30 分のばしました（残り ${fmt(r.balance)} 枚）。`, ...EPHEMERAL });
  }

  private async end(i: ButtonInteraction<'cached'>, id: number): Promise<void> {
    const c = await loadCastConfig(this.db);
    const s = await finishSession(this.db, c, id, i.user.id);
    if (!s) return void (await i.reply({ content: '終えられるのは、キャストと指名した人だけです（もう終わっているかもしれません）。', ...EPHEMERAL }));
    await i.deferUpdate();
    const dm = await this.askRating(s);
    await i.editReply({ ...sessionMessage(s, c, this.coin(), { rateInRoom: !dm }), allowedMentions: { parse: [] } } as Parameters<typeof i.editReply>[0]);
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

  private async rate(i: ButtonInteraction, id: number, stars: number): Promise<void> {
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) return;
    const s = await rateSession(this.db, id, i.user.id, stars);
    if (!s) return void (await i.reply({ content: '評価できるのは、指名した人が 1 回だけです。', ...(i.guildId ? EPHEMERAL : {}) }));
    const thanks = `${'⭐'.repeat(stars)} ありがとうございました。`;
    // DM なら、押したお願いのボタンを外して、お礼に書きかえる
    if (!i.guildId) return void (await i.update({ content: thanks, embeds: [], components: [] }));
    await i.reply({ content: thanks, ...EPHEMERAL });
  }

  /** ⭐ 通話が終わったら、お客に DM で評価をお願いする。送れたら true（部屋にはボタンを出さない） */
  private async askRating(s: CastSession): Promise<boolean> {
    if (s.status !== 'done' || isDeliverySession(s)) return false;
    const user = await this.guild?.client.users.fetch(s.customerId).catch(() => undefined);
    if (!user) return false;
    const name = (await namesOf(this.db, [s.castId])).get(s.castId) ?? 'キャスト';
    return user
      .send({
        embeds: [{ title: '⭐ 評価をお願いします', description: `${name} さんとの ${sessionLabel(s)}、おつかれさまでした。\nよければ星を選んでください（1 回だけ・キャストの評価に入ります）。`, color: PINK }],
        components: [row(...rateButtons(s.id))],
        allowedMentions: { parse: [] },
      })
      .then(() => true)
      .catch(() => false);
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
        line: castButtons ? `<@${s.castId}> さん、${when} から ${sessionLabel(s)}（${sessionTime(s)}）の予約です。受けますか？（始まる時刻までに返事がなければ取り消します）` : `${when} から ${sessionLabel(s)}（${sessionTime(s)}）の予約です。キャストの返事を待っています（始まる時刻までに返事がなければ取り消して戻します）。`,
        // キャストの返事は社務所からの DM で（DM が届かないときだけ、ここにもボタンを出す）
        buttons: [...(castButtons ? [button(`cast:accept:${s.id}`, '受ける', 3, '✅'), button(`cast:decline:${s.id}`, '断る', 4)] : []), button(`cast:propose:${s.id}`, '日時変更を提案', 1, '🗓'), button(`cast:cancel:${s.id}`, '取り消す（お客）')],
      },
      accepted: { title: '📅 予約を受けました', line: `${when} から ${sessionLabel(s)}（${sessionTime(s)}）。時刻になったら部屋ができて、ここで知らせます。当日なら「部屋を立てる」で先に 2 人だけの部屋を作れます。`, buttons: [button(`cast:propose:${s.id}`, '日時変更を提案', 1, '🗓'), button(`cast:early:${s.id}`, '部屋を立てる（当日）', 3, '🚪'), button(`cast:cancel:${s.id}`, '取り消す（お客）'), button(`cast:report:${s.id}`, '通報', 4, '🚨')] },
      declined: { title: '🙇 予約は受けられませんでした', line: '預かっていた銭は全部戻しました。', buttons: [] },
      canceled: { title: '予約を取り消しました', line: s.paid > 0 ? `直前の取り消しのため、キャストに ${fmt(s.paid)} 枚（手数料を引いたあと）を渡し、残りを戻しました。` : '預かっていた銭は全部戻しました。', buttons: [] },
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
        // 「納品した」は、いつもスレッドにも出す（DM を見落としても、スレッドに出したその場で押せる。押せるのは注文を受けたキャストだけ）
        buttons: [button(`cast:dlv:${s.id}`, '納品した（キャスト）', 3, '📦'), ...(castButtons ? [button(`cast:decline:${s.id}`, '断る（キャスト）', 4)] : []), button(`cast:report:${s.id}`, '通報', 4, '🚨')],
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
    const head = isDeliverySession(s) ? `📦 <@${s.customerId}> さんから **${sessionLabel(s)}** の注文（${fmt(s.price)} 枚）` : `📅 <@${s.customerId}> さんから **${when}** に **${sessionLabel(s)}**（**${sessionTime(s)}**）の予約（${fmt(s.price)} 枚）`;
    const map: Partial<Record<CastSession['status'], { line: string; buttons: Btn[] }>> = {
      reserved: { line: '受けますか？ 都合が悪ければ「別の日時を提案」もできます（始まる時刻までに返事がなければ取り消します）。', buttons: [button(`cast:accept:${s.id}`, '受ける', 3, '✅'), button(`cast:propose:${s.id}`, '別の日時を提案', 1, '🗓'), button(`cast:decline:${s.id}`, '断る', 4)] },
      accepted: { line: '✅ 受けました。時刻になったら部屋ができます（当日ならスレッドの「部屋を立てる」で先に作れます）。日時の変更は提案して、お客の承認で決まります。', buttons: [button(`cast:propose:${s.id}`, '日時変更を提案', 1, '🗓')] },
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

  private async onDm(i: Interaction, action: string, id: number, extra?: number): Promise<void> {
    if (!Number.isSafeInteger(id)) return;
    if (i.isModalSubmit() && action === 'pmodal') return this.proposeSubmit(i as never, id);
    if (!i.isButton()) return;
    if (action === 'accept') return this.accept(i as never, id);
    if (action === 'decline') return this.cancel(i as never, id, 'declined');
    if (action === 'propose') return this.proposeModal(i as never, id);
    if (action === 'dlv') return this.deliver(i, id);
    if (action === 'rate') return this.rate(i, id, extra ?? 0);
  }

  /** 📦 注文する（お客） */
  private async orderSubmit(i: ModalSubmitInteraction<'cached'>, castId: string, plan: string): Promise<void> {
    await i.deferReply(EPHEMERAL);
    const c = await loadCastConfig(this.db);
    const adult = await isAdult(this.db, this.cfg(), i.user.id, this.roles(i));
    const wish = i.fields.getTextInputValue('wish').trim();
    const r = await requestSession(this.db, c, { castId, customerId: i.user.id, customerAdult: adult, plan });
    if (r.status !== 'ok') return void (await i.editReply({ content: r.status === 'has_open' ? '納品待ちの注文が、1 人が同時に持てる数の上限です。届いてから次を注文してください。' : this.requestError(r), components: [] }));
    const thread = await this.openThread(r.session, `📦 ${r.drawn ? 'ガチャ' : '納品'} #${r.session.id}`);
    if (!thread) {
      await cancelSession(this.db, r.session.id, 'system', 'declined');
      return void (await i.editReply({ content: 'やり取りの場所を作れなかったので、取り消して銭を戻しました。神職に知らせてください。', components: [] }));
    }
    const s = (await getSession(this.db, r.session.id)) ?? r.session;
    await thread.send({ content: [r.drawn ? `🎰 ガチャの結果: **${r.drawn}**` : '', wish ? `📝 お願い:\n> ${wish.replace(/\n/g, '\n> ')}` : ''].filter(Boolean).join('\n') || '📦 注文', allowedMentions: { parse: [] } }).catch(() => undefined);
    const dm = await this.dmCast(s);
    await thread.send({ ...(dm ? {} : { content: `<@${castId}>` }), ...this.reserveMessage(s, !dm), allowedMentions: { users: dm ? [] : [castId] } } as never).catch(() => undefined);
    await i.editReply({ content: `${r.drawn ? `🎰 ガチャの結果は **${r.drawn}** でした！ ` : '📦 '}注文しました。キャストが ${DELIVERY.deadlineLabel}以内に <#${thread.id}> へ届けます（残り ${fmt(r.balance)} 枚）。`, components: [row({ type: 2, style: 5, label: '納品のお部屋はこちら', url: `https://discord.com/channels/${i.guildId}/${thread.id}` })] });
  }

  /** 男女共通の予約窓口。作成中は同じPromiseを使い、連続予約で増やさない。 */
  private async reservationHub(): Promise<TextChannel | undefined> {
    const c = await loadCastConfig(this.db);
    if (c.reservationChannelId) {
      const ch = this.guild?.channels.cache.get(c.reservationChannelId)
        ?? await this.guild?.channels.fetch(c.reservationChannelId).catch(() => null);
      return ch?.type === ChannelType.GuildText ? ch : undefined;
    }
    if (!this.creatingReservationHub) this.creatingReservationHub = this.createReservationHub().finally(() => { this.creatingReservationHub = undefined; });
    return this.creatingReservationHub;
  }

  private async createReservationHub(): Promise<TextChannel | undefined> {
    const g = this.guild;
    if (!g) return undefined;
    let made: TextChannel | undefined;
    try {
      const c = await loadCastConfig(this.db);
      if (c.reservationChannelId) return this.reservationHub();
      const menu = g.channels.cache.get(c.channelId ?? c.femaleChannelId ?? '');
      const READ = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory | PermissionFlagsBits.SendMessagesInThreads;
      const MANAGE = READ | PermissionFlagsBits.SendMessages | PermissionFlagsBits.ManageThreads | PermissionFlagsBits.CreatePrivateThreads;
      const me = g.members.me ?? await g.members.fetchMe();
      made = await g.channels.create({ name: '📅 キャスト予約', type: ChannelType.GuildText, parent: menu?.parentId ?? null,
        topic: '男女共通の予約・納品窓口。キャスト一覧から予約すると、本人・キャスト・運営だけのお部屋へ案内します。',
        permissionOverwrites: [
          { id: g.id, type: OverwriteType.Role, allow: READ, deny: PermissionFlagsBits.SendMessages | PermissionFlagsBits.CreatePublicThreads | PermissionFlagsBits.CreatePrivateThreads | PermissionFlagsBits.ManageThreads },
          ...[...staffRoleIds(this.cfg())].map(id => ({ id, type: OverwriteType.Role, allow: MANAGE })),
          { id: me.id, type: OverwriteType.Member, allow: MANAGE | PermissionFlagsBits.ManageChannels },
        ], reason: '男女共通のキャスト予約窓口',
      });
      let saved: string;
      try { saved = await saveReservationHub(this.db, made.id); }
      catch (err) { await made.delete('予約窓口を保存できなかったため').catch(() => undefined); throw err; }
      if (saved !== made.id) { await made.delete('設定済みの予約窓口を優先').catch(() => undefined); return this.reservationHub(); }
      await audit(this.db, { actorId: 'system', action: 'cast.reservation_hub', detail: { channelId: made.id }, via: 'system' }).catch(err => logger.warn({ err }, 'cast reservation hub audit failed'));
      return made;
    } catch (err) {
      logger.warn({ err }, 'cast reservation hub failed');
      return undefined;
    }
  }

  private async reservationName(s: CastSession, name: string): Promise<string> {
    const names = await namesOf(this.db, [s.castId]);
    const who = (names.get(s.castId) ?? 'キャスト').replace(/[@#`<>\r\n]/g, '').trim().slice(0, 24) || 'キャスト';
    const at = s.startAt ? new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(s.startAt) : '受付';
    return `${name.startsWith('📦') ? '📦 納品' : '📅 予約'}｜${who}｜${at}｜#${s.id}`;
  }

  /**
   * 予約・納品のやり取りは、男女共通の窓口に非公開で作る。
   * 窓口を使えないとき（作れない・本人やキャストが窓口を見られない・スレッドに入れられない）は、
   * 予約を止めないように、前と同じキャストのメニューのチャンネルに非公開で作り、運営の #記録 に理由を知らせる
   */
  private async openThread(s: CastSession, name: string) {
    let why = '';
    const panel = await this.reservationHub();
    if (!panel) why = '📅 キャスト予約 のチャンネルを作れない・見つからない（BOT に「チャンネルの管理」「ロールの管理」「スレッドの管理」「プライベートスレッドの作成」の権限が要ります）';
    else {
      // 親が見えないと、スレッドへ追加しても参加者は開けない。
      if (panel.permissionsFor) {
        for (const id of [s.castId, s.customerId]) {
          const member = await this.guild?.members.fetch(id).catch(() => null);
          if (!member || !panel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory | PermissionFlagsBits.SendMessagesInThreads)) {
            why = `<@${id}> さんが <#${panel.id}> を見られない（チャンネルの権限で、見る・履歴を読む・スレッドで送信 を許してください）`;
            break;
          }
        }
      }
      if (!why) {
        const thread = await this.privateThread(panel, s, await this.reservationName(s, name));
        if (thread) return thread;
        why = `<#${panel.id}> にスレッドを作れない・人を入れられない（BOT に「プライベートスレッドの作成」「スレッドでメッセージを送信」の権限が要ります）`;
      }
    }
    // 前と同じ場所（キャストのメニューのチャンネル）に作る
    const c = await loadCastConfig(this.db);
    const castRow = await getCast(this.db, s.castId);
    const home = castRow ? castHomeChannel(c, castRow) : c.channelId;
    const old = home ? this.guild?.channels.cache.get(home) : undefined;
    // 窓口と同じチャンネルなら、もう試したのでやり直さない
    const thread = old?.type === ChannelType.GuildText && old.id !== panel?.id ? await this.privateThread(old, s, await this.reservationName(s, name)) : undefined;
    logger.warn({ sessionId: s.id, why, fallback: Boolean(thread) }, 'cast reservation hub unavailable');
    await this.warnHub(`${thread ? '⚠️ 予約 #' + s.id + ' のやり取りの場所を、キャスト予約の窓口に作れなかったので、キャストのメニューのチャンネルに作りました。' : '❌ 予約 #' + s.id + ' のやり取りの場所を作れず、予約を取り消しました。'}\n理由: ${why}`);
    return thread;
  }

  /** 非公開スレッドを作り、キャストとお客を入れる（入れられなければ消す） */
  private async privateThread(parent: TextChannel, s: CastSession, title: string) {
    const thread = await Promise.resolve()
      .then(() => parent.threads.create({ name: title, type: ChannelType.PrivateThread, invitable: false, reason: 'キャストの予約・納品（非公開）' }))
      .catch((err: unknown) => (logger.warn({ err, sessionId: s.id }, 'cast reservation thread create failed'), undefined));
    if (!thread) return undefined;
    try {
      await thread.members.add(s.castId);
      await thread.members.add(s.customerId);
      await setSessionPlace(this.db, s.id, { threadId: thread.id });
      return thread;
    } catch (err) {
      await thread.delete('予約のお部屋に参加できなかったため').catch(() => undefined);
      logger.warn({ err, sessionId: s.id }, 'cast reservation join failed');
      return undefined;
    }
  }

  /** 窓口が使えないことを、運営の #記録 に知らせる（同じ理由は 1 時間に 1 回まで） */
  private hubWarnedAt = new Map<string, number>();
  private async warnHub(text: string): Promise<void> {
    const log = this.cfg().channels.log;
    const key = text.split('\n')[1] ?? text;
    const last = this.hubWarnedAt.get(key) ?? 0;
    if (!log || Date.now() - last < 3_600_000) return;
    this.hubWarnedAt.set(key, Date.now());
    await Promise.resolve()
      .then(() => this.discord.sendMessage(log, { content: text, allowed_mentions: { parse: [] } }))
      .catch((err: unknown) => logger.warn({ err }, 'cast hub warning failed'));
  }

  /**
   * 納品の中身がスレッドにあるか: 注文のあとにキャストが出したファイルかリンク。
   * 中身が見えないとき（MESSAGE CONTENT INTENT がオフ）は、キャストが何か書いていればよい。確かめられなければ止めない
   */
  private async deliveryPosted(s: CastSession): Promise<boolean> {
    if (!s.threadId || !this.guild) return true;
    const thread = await this.guild.channels.fetch(s.threadId).catch(() => null);
    if (!thread?.isTextBased()) return true;
    const msgs = await thread.messages.fetch({ limit: 50 }).catch(() => undefined);
    if (!msgs) return true;
    return [...msgs.values()].some((m) => m.author.id === s.castId && m.createdAt >= s.createdAt && (!this.messageContent || m.attachments.size > 0 || /https?:\/\//.test(m.content)));
  }

  /** 📦 納品した（キャスト。DM かスレッドから） */
  private async deliver(i: ButtonInteraction, id: number): Promise<void> {
    const before = await getSession(this.db, id);
    if (before && before.status === 'ordered' && before.castId === i.user.id && !(await this.deliveryPosted(before))) {
      return void (await i.reply({ content: `📦 まだスレッドに納品のファイル（かリンク）が見つかりません。${before.threadId ? `<#${before.threadId}> に出してから` : '出してから'}、もう一度「納品した」を押してください。`, ...(i.guildId ? EPHEMERAL : {}) }));
    }
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

  /** お客・キャスト共通。自分の予約だけを本人向けに選ぶ。 */
  private async changePicker(i: ButtonInteraction<'cached'>, page: number): Promise<void> {
    await i.deferReply(EPHEMERAL);
    const list = await changeableReservations(this.db, i.user.id);
    const pages = Math.max(1, Math.ceil(list.length/25));
    const p = Number.isSafeInteger(page) ? Math.max(0, Math.min(page,pages-1)) : 0;
    const selected = list.slice(p*25,(p+1)*25);
    const names = await namesOf(this.db,selected.flatMap(s=>[s.castId,s.customerId]));
    await i.editReply({ content: selected.length ? `変更したい予約を選んでください（日本時間・${p+1}/${pages}）。相手が承認するまで、元の予約日時のままです。` : '変更できる、開始前の予約はありません。', embeds:[], attachments:[], components: [
      ...(selected.length ? [{type:1 as const,components:[{type:3 as const,custom_id:'cast:changesel',placeholder:'予約を選ぶ',options:selected.map(s=>({label:`${jstDay(s.startAt!)} ${jstTime(s.startAt!)}｜${names.get(s.castId===i.user.id?s.customerId:s.castId)??'予約相手'}｜#${s.id}`.slice(0,100),value:String(s.id),description:sessionLabel(s).slice(0,100)}))}]}] : []),
      ...(pages>1 ? [row(button(`cast:changes:${p-1}`,'前へ',2,undefined,p===0),button(`cast:changes:${p+1}`,'次へ',2,undefined,p===pages-1))] : []),
    ],allowedMentions:{parse:[]} });
  }

  private async proposeModal(i: ButtonInteraction | StringSelectMenuInteraction, id: number): Promise<void> {
    const s = await getSession(this.db,id);
    if (!s || !['reserved','accepted'].includes(s.status) || !s.startAt || s.startAt<=new Date()) return void(await i.reply({content:'開始前の予約だけ変更できます。',...(i.guildId?EPHEMERAL:{})}));
    if (![s.castId,s.customerId].includes(i.user.id)) return void(await i.reply({content:'この予約のお客とキャストだけが提案できます。',...(i.guildId?EPHEMERAL:{})}));
    await i.showModal(new ModalBuilder().setCustomId(`cast:pmodal:${id}`).setTitle('予約の日時変更を提案').addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('when').setLabel('新しい日時（日本時間・例: 10/25 21:00）').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20)),
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('note').setLabel('ひとこと（なくてもよい）').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100)),
    ));
  }

  private timeChangeError(status: string): string {
    return ({not_found:'開始前の予約だけ変更できます。',not_member:'この予約のお客とキャストだけが提案できます。',not_receiver:'承認できるのは提案された相手だけです。自分の提案は承認できません。',already:'この提案はすでに確定済みです。日時を再変更していません。',expired:'提案の期限が切れました。もう一度提案してください。',stale:'予約日時がすでに変わっています。最新の予約から提案し直してください。',bad_time:'日時は10分後〜7日後で、今の予約と異なる時刻を選んでください。',minor_hours:'18歳未満の方は、22時までに終わる時間だけです。',overlap:'キャストのほかの予約と重なっています。別の日時を選んでください。',self_overlap:`お客の同じ時間の予約が、キャスト ${CUSTOMER_TOGETHER_MAX} 人分うまっています。別の日時を選んでください。`} as Record<string,string>)[status]??'変更できませんでした。';
  }

  private async proposeSubmit(i: ModalSubmitInteraction, id: number): Promise<void> {
    await i.deferReply(i.guildId?EPHEMERAL:{});
    const s = await getSession(this.db,id);
    if (!s || ![s.castId,s.customerId].includes(i.user.id)) return void(await i.editReply(this.timeChangeError('not_member')));
    if (!s.threadId) return void(await i.editReply('予約のお部屋が見つかりません。運営に知らせてください。日時は変更していません。'));
    const at = this.parseWhen(i.fields.getTextInputValue('when'));
    if (!at) return void(await i.editReply('日時が読めませんでした（例: 10/25 21:00）。'));
    const r = await proposeSessionTime(this.db,id,i.user.id,at,i.fields.getTextInputValue('note').trim());
    if (r.status!=='ok') return void(await i.editReply(this.timeChangeError(r.status)));
    const p=r.proposal;
    try {
      await this.discord.sendMessage(s.threadId,{content:`🗓 <@${p.approveBy}> さん、<@${p.proposedBy}> さんから予約日時の変更提案です。\n現在：<t:${unix(p.originalStartAt)}:f> → 候補：<t:${unix(p.startAt)}:f>\n相手が承認するまで元の日時のままです。期限：<t:${unix(p.expiresAt)}:f>${p.note?'\n> '+p.note:''}`,components:[row(button(`cast:timeok:${p.id}`,'この日時に変更する（提案された相手）',3,'✅'))],allowed_mentions:{parse:[],users:[p.approveBy]}});
    } catch(err) { logger.warn({err,sessionId:id},'cast time proposal notice failed'); return void(await i.editReply('提案を届けられませんでした。予約日時は変更していません。もう一度提案してください。')); }
    await this.discord.sendDm(p.approveBy,`🗓 予約 #${id} の日時変更の提案です。<t:${unix(p.startAt)}:f>。予約のお部屋 <#${s.threadId}> で確認してください。`).catch(()=>false);
    await i.editReply(`🗓 変更を提案しました。相手が承認すると決まります。予約のお部屋：<#${s.threadId}>`);
  }

  private async proposeAccept(i: ButtonInteraction, proposalId: string): Promise<void> {
    await i.deferReply(i.guildId?EPHEMERAL:{});
    const r = await acceptSessionTime(this.db,proposalId,i.user.id);
    if (r.status!=='ok') return void(await i.editReply(this.timeChangeError(r.status)));
    const s=r.session;
    if (s.threadId) {
      try { const thread = this.guild?.channels.cache.get(s.threadId)??await this.guild?.channels.fetch(s.threadId);if(thread?.isThread())await thread.setName(await this.reservationName(s,'予約')); }
      catch(err){logger.warn({err,sessionId:s.id},'cast reservation rename failed');}
      await this.discord.sendMessage(s.threadId,{...this.reserveMessage(s),allowed_mentions:{parse:[]}} as MessageBody).catch(()=>undefined);
    }
    await i.editReply('✅ 相手の提案を承認し、予約日時を変更しました。');
    for(const member of [s.castId,s.customerId])await this.discord.sendDm(member,`📅 予約 #${s.id} の日時を <t:${unix(s.startAt!)}:f> に変更しました。${s.threadId?`予約のお部屋：<#${s.threadId}>`:''}`).catch(()=>false);
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

  // ───────── 👥 まとめて予約（2〜3 人のキャストを、同じ時間・同じ部屋で） ─────────

  /** ① 呼びたいキャストを 2〜3 人選ぶ */
  private async groupCasts(i: ButtonInteraction<'cached'>, group?: CastGroup): Promise<void> {
    await i.deferReply(EPHEMERAL);
    const list = (await listCasts(this.db, ['active'])).filter((x) => !group || inGroup(x, group)).filter((x) => x.memberId !== i.user.id && menuOf(x).some((m) => m.price > 0 && !m.consult && !m.delivery));
    if (list.length < 2) return void (await i.editReply({ content: 'いま、まとめて予約できるキャストが 2 人いません。' }));
    const names = await namesOf(this.db, list.map((x) => x.memberId));
    await i.editReply({
      content: '👥 **まとめて予約** ― 同じ時間に、1 つの部屋で話すキャストを 2〜3 人選んでください。料金はキャストごとのメニューの値段の合計です。',
      components: [{ type: 1, components: [{ type: 3, custom_id: 'cast:gcasts', placeholder: 'キャストを 2〜3 人選ぶ', min_values: 2, max_values: Math.min(CUSTOMER_TOGETHER_MAX, list.length), options: list.slice(0, 25).map((x) => ({ label: (names.get(x.memberId) ?? 'キャスト').slice(0, 100), value: x.memberId })) }] }],
    } as never);
  }

  /** ② キャストごとのメニューを選ぶ（1 つの選ぶ欄に、キャストごとに並べる） */
  private async groupMenus(i: StringSelectMenuInteraction<'cached'>, castIds: string[]): Promise<void> {
    const ids = [...new Set(castIds)].slice(0, CUSTOMER_TOGETHER_MAX);
    const adult = await isAdult(this.db, this.cfg(), i.user.id, this.roles(i));
    const names = await namesOf(this.db, ids);
    const options: { label: string; value: string; description?: string }[] = [];
    for (const id of ids) {
      const cast = await getCast(this.db, id);
      if (!cast || cast.status !== 'active') continue;
      for (const m of menuOf(cast).filter((m) => m.price > 0 && !m.consult && !m.delivery && (adult || (minorMenuOk(m) && cast.minorOk)))) {
        options.push({ label: `${names.get(id) ?? 'キャスト'} ・ ${menuLabel(m)}`.slice(0, 100), value: `${id}~${m.id}`, description: `${fmt(m.price)} 枚`.slice(0, 100) });
      }
    }
    const casts = new Set(options.map((o) => o.value.split('~')[0]));
    if (casts.size < 2) return void (await this.answer(i, { content: '選んだキャストのうち、予約できるメニューがあるのが 2 人そろいませんでした。', components: [] }));
    await this.answer(i, {
      content: `👥 キャストごとに、メニューを 1 つずつ選んでください（${casts.size} 人分）。`,
      components: [{ type: 1, components: [{ type: 3, custom_id: 'cast:gplans', placeholder: 'キャストごとにメニューを選ぶ', min_values: casts.size, max_values: casts.size, options: options.slice(0, 25) }] }],
    });
  }

  /** ③ 日時を入れる */
  private async groupModal(i: StringSelectMenuInteraction<'cached'>, picks: string[]): Promise<void> {
    const pairs = picks.map((v) => v.split('~')).filter((p): p is [string, string] => p.length === 2 && /^\d{17,20}$/.test(p[0]!) && /^[\w-]{1,20}$/.test(p[1]!));
    if (pairs.length < 2 || new Set(pairs.map((p) => p[0])).size !== pairs.length) return void (await this.answer(i, { content: 'キャスト 1 人につきメニューを 1 つずつ選んでください（同じキャストを 2 つ選ばない）。', components: [] }));
    const id = `cast:gmodal:${pairs.map((p) => p.join('~')).join(',')}`;
    if (id.length > 100) return void (await this.answer(i, { content: '選んだものが多すぎます。キャストを減らしてください。', components: [] }));
    await i.showModal(
      new ModalBuilder()
        .setCustomId(id)
        .setTitle(`👥 まとめて予約（${pairs.length} 人）`)
        .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('when').setLabel('日時（例: 21:00 ／ 10/5 21:00）').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20))),
    );
  }

  /** ④ まとめて予約する。1 人でもだめなら、入れた分も取り消して全部戻す（全員そろうか、何もしないか） */
  private async groupSubmit(i: ModalSubmitInteraction<'cached'>, raw: string): Promise<void> {
    if (i.isFromMessage()) await i.deferUpdate();
    else await i.deferReply(EPHEMERAL);
    const pairs = raw.split(',').map((p) => p.split('~')).filter((p): p is [string, string] => p.length === 2);
    if (pairs.length < 2) return void (await i.editReply({ content: '選んだものが読めませんでした。はじめからやり直してください。', components: [] }));
    const at = this.parseWhen(i.fields.getTextInputValue('when'));
    if (!at) return void (await i.editReply({ content: '日時が読めませんでした（例: 21:00 ／ 10/5 21:00）。', components: [] }));
    const c = await loadCastConfig(this.db);
    const adult = await isAdult(this.db, this.cfg(), i.user.id, this.roles(i));
    const made: CastSession[] = [];
    const groupKey = randomUUID();
    for (const [castId, plan] of pairs) {
      const r = await requestSession(this.db, c, { castId, customerId: i.user.id, customerAdult: adult, plan, startAt: at, groupKey });
      if (r.status !== 'ok') {
        for (const s of made) await cancelSession(this.db, s.id, 'system', 'declined');
        const who = (await namesOf(this.db, [castId])).get(castId) ?? 'キャスト';
        return void (await i.editReply({ content: `${who} さんの予約ができませんでした: ${this.requestError(r)}\nまとめて予約なので、ほかの人の分も入れていません（銭は戻しました）。`, components: [] }));
      }
      made.push(r.session);
    }
    const links: string[] = [];
    for (const s0 of made) {
      const thread = await this.openThread(s0, `📅 予約 #${s0.id}`);
      if (!thread) {
        for (const s of made) await cancelSession(this.db, s.id, 'system', 'declined');
        return void (await i.editReply({ content: '予約のやり取りの場所を作れなかったので、全部取り消して銭を戻しました。神職に知らせてください。', components: [] }));
      }
      const s = (await getSession(this.db, s0.id)) ?? s0;
      const dm = await this.dmCast(s);
      await thread.send({ ...(dm ? {} : { content: `<@${s.castId}>` }), ...this.reserveMessage(s, !dm), allowedMentions: { users: dm ? [] : [s.castId] } } as Parameters<typeof thread.send>[0]);
      links.push(`<#${thread.id}>`);
    }
    const total = made.reduce((n, s) => n + s.price, 0);
    await audit(this.db, { actorId: i.user.id, action: 'cast.group_reserve', detail: { sessions: made.map((s) => s.id), at }, via: 'discord' });
    await i.editReply({ content: `👥 ${made.length} 人まとめて予約をお願いしました（<t:${unix(at)}:f>・合計 ${fmt(total)} 枚）。全員が受けると、時刻に 1 つの部屋でいっしょに話せます。\n返事はそれぞれの予約のお部屋に届きます: ${links.join(' ')}`, components: [] });
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
    // やり取りは男女共通の予約窓口の非公開スレッドで。キャストへの返事の案内はDMで。
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
    await i.editReply({ content: `📅 予約をお願いしました（<t:${unix(at)}:f>）。返事は <#${threadId}> に届きます（残り ${fmt(r.balance)} 枚）。`, components: [row({ type: 2, style: 5, label: '予約のお部屋はこちら', url: `https://discord.com/channels/${i.guildId}/${threadId}` })] });
  }

  // ───────── 1 分ごと ─────────


  async tick(now = new Date()): Promise<void> {
    if (!this.guild || this.ticking) return;
    this.ticking = true;
    try { await this.runTick(now); } finally { this.ticking = false; }
  }

  private async runTick(now: Date): Promise<void> {

    // 更新の前に出した予約のメッセージにも「日時変更を提案」などの新しいボタンを出す（起動して 1 回だけ）
    if (!this.threadsRefreshed) {
      this.threadsRefreshed = true;
      for (const s of await openReservationsWithThread(this.db, now).catch(() => [])) await this.editThreadMessage(s).catch((err: unknown) => logger.warn({ err, sessionId: s.id }, 'cast thread refresh failed'));
    }
    // 📌 メニューがいちばん下になければ出し直す（BOT が止まっていた間の書き込みなど）
    await this.keepPanelAtBottom();
    const c = await loadCastConfig(this.db);
    const r = await castTick(this.db, c, now, async (s) => Boolean(await this.openRoom(s).catch((err: unknown) => { logger.warn({ err }, 'cast reserved room failed'); return undefined; })));
    let changed = r.waitingOff > 0;
    // ⏰ 予約の前の知らせ（キャストとお客に DM・スレッドにも）
    for (const { session: s, stage } of r.remind) {
      const when = `<t:${unix(s.startAt!)}:t>（<t:${unix(s.startAt!)}:R>）`;
      const text = stage === 'hour'
        ? `⏰ 予約の 1 時間前です。${when} から ${sessionLabel(s)}（${sessionTime(s)}）。時刻になったら部屋ができます（当日ならスレッドの「部屋を立てる」で先に作れます）。`
        : `⏰ もうすぐ予約の時間です（${when}）。${sessionLabel(s)}（${sessionTime(s)}）。`;
      for (const id of [s.castId, s.customerId]) await this.discord.sendDm(id, `${text}${s.threadId ? `\n<#${s.threadId}>` : ''}`).catch(() => false);
      if (s.threadId) await this.discord.sendMessage(s.threadId, { content: text, allowed_mentions: { parse: [] } }).catch(() => undefined);
    }
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
      const dm = await this.askRating(s);
      await room?.send({ ...sessionMessage(s, c, this.coin(), { rateInRoom: !dm }), allowedMentions: { parse: [] } } as Parameters<typeof room.send>[0]).catch(() => undefined);
      if (isDeliverySession(s) && s.threadId) await this.discord.sendMessage(s.threadId, { ...this.reserveMessage(s), allowed_mentions: { parse: [] } } as MessageBody).catch(() => undefined);
      if (s.paid > 0) await this.discord.sendDm(s.castId, `🎀 指名 #${s.id} が終わりました。${this.coin()} ${fmt(s.paid)} 枚をお渡ししました。`).catch(() => false);
    }
    for (const s of r.cleanup) {
      // 👥 いっしょの部屋で、まだほかのキャストの指名が続いていれば、部屋は消さない
      if (s.channelId && (await roomInUse(this.db, s.channelId, s.id))) {
        await roomDeleted(this.db, s.id);
        continue;
      }
      const room = s.channelId ? this.guild?.channels.cache.get(s.channelId) : undefined;
      if (room) {
        try { await room.delete('キャストの指名が終わった'); }
        catch (err) { logger.warn({ err }, 'cast room delete failed'); continue; }
      }
      await roomDeleted(this.db, s.id);
    }
    await closeFinishedReservationThreads(this.db, async id => {
      let thread;
      try { thread = await this.guild!.channels.fetch(id); }
      catch (err) {
        // 削除済みだけ完了扱い。権限・通信エラーは次回再試行する。
        if ((err as { code?: number }).code === 10003) return;
        throw err;
      }
      if (!thread) return;
      if (!thread.isThread()) throw new Error('予約のスレッドではありません');
      // アーカイブ済みのスレッドには鍵をかけられない（Thread is archived）ので、いったん開いてから鍵をかけて閉じる
      if (!thread.locked) {
        if (thread.archived) await thread.setArchived(false, '予約終了から15分が経過（鍵をかけるため）');
        await thread.setLocked(true, '予約終了から15分が経過');
      }
      if (!thread.archived || !thread.locked) await thread.setArchived(true, '予約終了から15分が経過');
    }, now).catch((err: unknown) => logger.warn({ err }, 'cast reservation thread close failed'));
    if (changed) this.refresh();
    await this.rankTick(c, now).catch((err: unknown) => logger.warn({ err }, 'cast rank failed'));
    await refreshCastLeaderboard(this.db,this.discord,this.cfg().economy.currencyName,{now,force:!this.leaderboardChecked}).then(()=>{this.leaderboardChecked=true;}).catch((err:unknown)=>logger.warn({err},'cast leaderboard tick failed'));
  }

  /** 🏆 毎月 1 日: 先月の上位 3 人を発表し、1 位にごほうび（銭は awardCastRank が 1 回だけわたす） */
  private async rankTick(c: CastConfig, now: Date): Promise<void> {
    const r = await awardCastRank(this.db, c, now);
    if (!r || !this.guild) return;
    const names = await namesOf(this.db, r.top.map((x) => x.castId));
    const medal = ['🥇', '🥈', '🥉'];
    const [y, m] = r.month.split('-');
    const lines = [
      `🏆 **${Number(y)} 年 ${Number(m)} 月のキャストランキング**（指名の多い順）`,
      ...r.top.map((x, k) => `${medal[k]} <@${x.castId}>（${names.get(x.castId) ?? x.castId}）… ${x.count} 回${x.ratingAvg !== null ? ` ・ ⭐ ${x.ratingAvg}` : ''}`),
      r.winnerId && (r.bonus > 0 || c.rankRoleId) ? `🎁 1 位の <@${r.winnerId}> さんに${[c.rankRoleId ? `<@&${c.rankRoleId}>` : '', r.bonus > 0 ? `${this.coin()} ${fmt(r.bonus)} 枚` : ''].filter(Boolean).join(' と ')}をおくります。` : '',
      'ご指名くださったみなさま、ありがとうございました。',
    ].filter(Boolean);
    const channel = c.rankChannelId ?? c.channelId ?? c.femaleChannelId;
    if (channel) await this.discord.sendMessage(channel, { content: lines.join('\n'), allowed_mentions: { users: r.top.map((x) => x.castId), roles: [] } }).catch((err: unknown) => logger.warn({ err }, 'cast rank post failed'));
    // 称号のロール: 前の 1 位から外して、新しい 1 位へ
    if (c.rankRoleId && r.winnerId) {
      for (const id of await pastRankWinners(this.db)) {
        if (id !== r.winnerId) await this.discord.removeRole(this.guild.id, id, c.rankRoleId, 'キャストの月の 1 位が変わった').catch(() => undefined);
      }
      await this.discord.addRole(this.guild.id, r.winnerId, c.rankRoleId, `キャストの月の 1 位（${r.month}）`).catch((err: unknown) => logger.warn({ err }, 'cast rank role failed'));
    }
    if (r.winnerId && r.bonus > 0) await this.discord.sendDm(r.winnerId, `🏆 ${Number(m)} 月のキャストランキングで 1 位になりました！ ごほうびに ${this.coin()} ${fmt(r.bonus)} 枚をおくりました。`).catch(() => false);
    this.refresh();
  }

}

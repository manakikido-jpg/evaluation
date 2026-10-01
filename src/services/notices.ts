import { and, asc, eq, max } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { createHash } from 'node:crypto';
import { noticeImages, notices, settings, type Notice } from '../db/schema.js';
import { DiscordHttpError, type DiscordActions, type GuildChannel, type MessageBody, type MessageFile } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { audit } from './audit.js';
import { memberCommandsText } from './commandList.js';
import { coreName } from '../lib/names.js';
import { DEFAULT_GUIDES, DEFAULT_NOTICES, PREVIOUS_GUIDE_BODIES, type NoticeTemplate } from './noticeDefaults.js';
import { describeStreakRewards, omikujiRange } from './omikuji.js';
import { coreTimeRate, describeCoreTime } from './coreTime.js';

/**
 * 掲示: #鳥居・#しきたり などに BOT が投稿する文面。
 * 本文は {免罪符の値段} などの差し込みを含むひな形で、投稿・書き換えのたびに今の設定で置き換える。
 * 設定を変えたら syncPostedNotices で投稿済みのメッセージも書き換える。
 */

export type NoticeCtx = { db: Db; cfg: GuildConfig; discord: DiscordActions };

export type NoticeStyle = 'embed' | 'text';

/** 見せ方ごとの名前と文字数の上限（Discord の決まり: 普通のメッセージ 2000・カードの本文 4096） */
export const NOTICE_STYLES: Record<NoticeStyle, { label: string; max: number }> = {
  embed: { label: 'カード（1 つずつ区切られて見やすい）', max: 4096 },
  text: { label: '普通のメッセージ', max: 2000 },
};

export const maxLengthOf = (style: string) => NOTICE_STYLES[style === 'text' ? 'text' : 'embed'].max;
export const isNoticeStyle = (v: unknown): v is NoticeStyle => v === 'embed' || v === 'text';

/** カードの左の線の色（朱色） */
const SHU = 0xd7003a;

type NoticeImage = { file: MessageFile; position: ImagePosition };

/** 「🌸 朱印を押す」ボタン（押すと相手を選んで朱印を押せる） */
export const SHUIN_PICK_ID = 'shuin:pick';
const SHUIN_BUTTON_ROW = { type: 1, components: [{ type: 2, style: 1, label: '朱印を押す', emoji: { name: '🌸' }, custom_id: SHUIN_PICK_ID }] };

function messageBody(style: string, text: string, mention = '', image?: NoticeImage, shuinButton = false): MessageBody {
  const head = mentionHead(mention);
  const files = { ...(image ? { files: [image.file] } : {}), ...(shuinButton ? { components: [SHUIN_BUTTON_ROW] } : {}) };
  // 本文のないボタンだけの掲示（写真もなければ、ボタンだけのメッセージ）
  if (!text.trim() && shuinButton && !image) return { content: head, embeds: [], ...files };
  // 見せ方を切り替えたときに前の形が残らないよう、使わないほうは空にする。カードのメンションはカードの上（本文の外）に出す
  // 普通のメッセージの写真は、Discord の決まりで本文の下に出る
  if (style === 'text') return { content: head ? `${head}\n${text}` : text, embeds: [], ...files };
  if (!image) return { content: head, embeds: [{ description: text, color: SHU }], ...files };
  const picture = { url: `attachment://${image.file.name}` };
  // 上: 写真だけのカードを本文のカードの上に。下: 本文のカードの中、いちばん下に
  const embeds =
    image.position === 'top' ? [{ color: SHU, image: picture }, { description: text, color: SHU }] : [{ description: text, color: SHU, image: picture }];
  return { content: head, embeds, ...files };
}

/** 本文が空（ボタンだけの掲示はよい）か、文字数の上限を超えている */
const tooLong = (style: string, text: string, mention = '', shuinButton = false) =>
  (!text.trim() && !shuinButton) || text.length + (style === 'text' && mention ? mentionHead(mention).length + 1 : 0) > maxLengthOf(style);

// ───────── 写真 ─────────

export type ImagePosition = 'top' | 'bottom';
export const isImagePosition = (v: unknown): v is ImagePosition => v === 'top' || v === 'bottom';

/** 写真の大きさの上限（Discord の BOT が送れるのは 10MB まで） */
export const NOTICE_IMAGE_MAX = 8 * 1024 * 1024;

const IMAGE_TYPES: { type: string; ext: string; test: (d: Uint8Array) => boolean }[] = [
  { type: 'image/png', ext: 'png', test: (d) => d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47 },
  { type: 'image/jpeg', ext: 'jpg', test: (d) => d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff },
  { type: 'image/gif', ext: 'gif', test: (d) => d[0] === 0x47 && d[1] === 0x49 && d[2] === 0x46 && d[3] === 0x38 },
  {
    type: 'image/webp',
    ext: 'webp',
    test: (d) => d[0] === 0x52 && d[1] === 0x49 && d[2] === 0x46 && d[3] === 0x46 && d[8] === 0x57 && d[9] === 0x45 && d[10] === 0x42 && d[11] === 0x50,
  },
];

/** 中身から写真の種類を見分ける（PNG・JPEG・GIF・WebP。ファイル名や申告された種類は信じない） */
export function detectImage(data: Uint8Array): { type: string; ext: string } | undefined {
  const t = IMAGE_TYPES.find((x) => data.length > 12 && x.test(data));
  return t && { type: t.type, ext: t.ext };
}

/** 今の写真と上下（投稿済みのものと比べて「未反映」を見分ける） */
const imageKey = (n: Pick<Notice, 'imageHash' | 'imagePosition'>) => (n.imageHash ? `${n.imageHash}:${n.imagePosition}` : '');

export async function setNoticeImage(db: Db, id: number, data: Uint8Array, by: string): Promise<'ok' | 'bad_type' | 'too_big'> {
  if (data.length > NOTICE_IMAGE_MAX) return 'too_big';
  const kind = detectImage(data);
  if (!kind) return 'bad_type';
  const hash = createHash('sha256').update(data).digest('hex').slice(0, 16);
  await db.transaction(async (tx) => {
    await tx
      .insert(noticeImages)
      .values({ noticeId: id, contentType: kind.type, data, hash })
      .onConflictDoUpdate({ target: noticeImages.noticeId, set: { contentType: kind.type, data, hash, createdAt: new Date() } });
    await tx.update(notices).set({ imageHash: hash, updatedBy: by, updatedAt: new Date() }).where(eq(notices.id, id));
  });
  await audit(db, { actorId: by, action: 'notice.image', detail: { id, bytes: data.length }, via: 'web' });
  return 'ok';
}

export async function removeNoticeImage(db: Db, id: number, by: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(noticeImages).where(eq(noticeImages.noticeId, id));
    await tx.update(notices).set({ imageHash: null, updatedBy: by, updatedAt: new Date() }).where(eq(notices.id, id));
  });
}

export async function getNoticeImage(db: Db, id: number): Promise<{ contentType: string; data: Uint8Array; hash: string } | undefined> {
  const [row] = await db.select().from(noticeImages).where(eq(noticeImages.noticeId, id));
  return row;
}

/** Discord に添付する写真（hash を渡すと、その写真のときだけ） */
async function imageFor(db: Db, n: Notice, position: ImagePosition, hash?: string | null): Promise<NoticeImage | undefined> {
  if (!n.imageHash) return undefined;
  const img = await getNoticeImage(db, n.id);
  if (!img || (hash !== undefined && img.hash !== hash)) return undefined;
  const ext = detectImage(img.data)?.ext ?? 'png';
  return { file: { name: `notice-${n.id}.${ext}`, contentType: img.contentType, data: img.data }, position };
}

// ───────── メンション ─────────

export type NoticeMention = { kind: 'none' } | { kind: 'here' } | { kind: 'everyone' } | { kind: 'ranks' } | { kind: 'roles'; roleIds: string[] };

/** 保存している形（'' / 'here' / 'everyone' / 'ranks' / ロール ID のカンマ区切り）を読む */
export function parseMention(raw: string | null | undefined): NoticeMention {
  const v = (raw ?? '').trim();
  if (v === 'here' || v === 'everyone' || v === 'ranks') return { kind: v };
  const roleIds = [...new Set(v.split(',').filter((x) => /^\d{17,20}$/.test(x)))];
  return roleIds.length ? { kind: 'roles', roleIds } : { kind: 'none' };
}

/** 画面で選んだもの（なし・@here・@everyone・すべての役職・ロール）から保存する形を作る。ロールは選べるものだけ・最大 5 つ */
export function mentionValue(kind: unknown, roleIds: string[], validRoleIds: Set<string>): string {
  if (kind === 'here' || kind === 'everyone' || kind === 'ranks') return kind;
  if (kind !== 'roles') return '';
  return [...new Set(roleIds.filter((id) => validRoleIds.has(id)))].slice(0, 5).join(',');
}

/**
 * 「すべての役職」（'ranks'）を、出すときの役職のロールに置きかえる（役職を足したり消したりしても、出すときの役職になる）。
 * ほかはそのまま。
 */
export function resolveMention(raw: string | null | undefined, rankRoleIds: readonly string[]): string {
  if ((raw ?? '').trim() !== 'ranks') return raw ?? '';
  return [...new Set(rankRoleIds.filter((id) => /^\d{17,20}$/.test(id)))].join(',');
}

const mentionFor = (ctx: Pick<NoticeCtx, 'cfg'>, raw: string | null | undefined) => resolveMention(raw, ctx.cfg.ranks.map((r) => r.roleId));

/** メッセージのいちばん上に付けるメンション */
export function mentionHead(raw: string | null | undefined): string {
  const m = parseMention(raw);
  if (m.kind === 'here') return '@here';
  if (m.kind === 'everyone') return '@everyone';
  if (m.kind === 'roles') return m.roleIds.map((id) => `<@&${id}>`).join(' ');
  return '';
}

/** 通知を届ける相手（選んだものだけ。本文に書いた @everyone などでは鳴らさない） */
export function mentionAllowed(raw: string | null | undefined): NonNullable<MessageBody['allowed_mentions']> {
  const m = parseMention(raw);
  if (m.kind === 'here' || m.kind === 'everyone') return { parse: ['everyone'] };
  if (m.kind === 'roles') return { parse: [], roles: m.roleIds };
  return { parse: [] };
}

/** 管理画面で見せる名前（@ロール名） */
export function mentionLabel(raw: string | null | undefined, roleName: (id: string) => string | undefined): string {
  const m = parseMention(raw);
  if (m.kind === 'here') return '@here';
  if (m.kind === 'everyone') return '@everyone';
  if (m.kind === 'ranks') return '@すべての役職';
  if (m.kind === 'roles') return m.roleIds.map((id) => `@${roleName(id) ?? id}`).join(' ');
  return '';
}

/** チャンネルとして選べる種類（テキスト・お知らせ） */
const POSTABLE = new Set([0, 5]);

// ───────── 差し込み ─────────

export type NoticeVariable = { name: string; value: string; note: string };

/** 本文で使える {名前} と、いまの値 */
/** {コマンド一覧}（コマンドは起動中に変わらないので 1 回だけ作る） */
let commandsCache: string | undefined;
const commandsText = () => (commandsCache ??= memberCommandsText());

export function noticeVariables(cfg: GuildConfig): NoticeVariable[] {
  const e = cfg.economy;
  const ranks = [...cfg.ranks].sort((a, b) => a.weight - b.weight);
  const firstAuto = ranks.filter((r) => r.auto).sort((a, b) => a.requiredGoen - b.requiredGoen)[0];
  const rankLine = (r: (typeof ranks)[number]) => {
    const how = !r.auto ? (r.key === 'guji' ? '鯖主' : '運営') : r === firstAuto ? '入ったとき' : `ご縁 ${r.requiredGoen}`;
    return `- ${r.emoji} **${r.name}** … ${how} ・ 格 ${r.weight}`;
  };
  return [
    { name: '通貨', value: e.currencyName, note: '通貨の名前' },
    { name: '通貨絵文字', value: e.currencyEmoji, note: '通貨の絵文字' },
    { name: '免罪符の値段', value: String(e.menzaifuPrice), note: '' },
    { name: '免罪符の回数', value: String(e.menzaifuMaxUses), note: '1 人が買える回数' },
    { name: '通話10分', value: String(e.voicePer10Min), note: '通話 10 分ごとにもらえる量' },
    { name: '通話の上限', value: String(e.voiceDailyCap), note: '通話でもらえる 1 日の上限' },
    { name: '朱印を押すと', value: String(e.shuinGive), note: '朱印を押すともらえる量' },
    { name: '朱印を頂くと', value: String(e.shuinReceive), note: '朱印を頂くともらえる量' },
    { name: '初期配布', value: String(e.joinBonus), note: '入鯖が承認されたときに配る量' },
    { name: '招待のお礼', value: String(e.inviteReward), note: '招待した人が参拝者になったときにもらえる量' },
    { name: 'おみくじの銭', value: omikujiRange(e), note: 'おみくじでもらえる量（凶〜大吉）' },
    { name: 'おみくじのおまけ', value: describeStreakRewards(cfg.omikujiStreak, e), note: 'おみくじを毎日続けたおまけ（設定の「おみくじを続けたおまけ」）' },
    { name: 'コアタイム', value: describeCoreTime(cfg.coreTime), note: 'コアタイムの曜日と時間' },
    { name: 'コアタイム倍率', value: coreTimeRate(e), note: 'コアタイムの通話でもらえる量の倍率' },
    { name: '奉納割引', value: String(e.boostDiscountPercent), note: 'ブーストしている人の授与品の割引（%）' },
    { name: 'お参り期間', value: String(cfg.omairi.days), note: '日数' },
    { name: 'お参り延長', value: String(cfg.omairi.extendDays), note: '自動で延ばす日数' },
    ...ranks.filter((r) => r.auto).map((r) => ({ name: `${r.name}のご縁`, value: String(r.requiredGoen), note: '昇格に必要なご縁' })),
    ...ranks.map((r) => ({ name: `${r.name}の格`, value: String(r.weight), note: '朱印 1 回のご縁' })),
    { name: '役職一覧', value: [...ranks].map(rankLine).join('\n'), note: '役職・昇格ライン・格の箇条書き' },
    { name: 'コマンド一覧', value: commandsText(), note: 'メンバーが使えるコマンドの箇条書き（コマンドを足すと自動で増える）' },
  ];
}

export type Rendered = { text: string; unknown: string[] };

/**
 * {名前} を今の値に、{#チャンネル名} をチャンネルへのリンクに置き換える。
 * forPreview のときはリンクの代わりに「#チャンネル名」と表示する。知らない名前はそのまま残す。
 */
export function renderNotice(body: string, cfg: GuildConfig, channels: GuildChannel[], opts: { forPreview?: boolean } = {}): Rendered {
  const vars = new Map(noticeVariables(cfg).map((v) => [v.name, v.value]));
  // 前の名前（通貨が花びらだったころの掲示・標準の文面）
  vars.set('おみくじの花びら', vars.get('おみくじの銭')!);
  // 役職の前の名前（社務所Web で名前を変えた役職）
  for (const r of cfg.ranks) {
    for (const old of r.formerNames ?? []) {
      if (r.auto && !vars.has(`${old}のご縁`)) vars.set(`${old}のご縁`, String(r.requiredGoen));
      if (!vars.has(`${old}の格`)) vars.set(`${old}の格`, String(r.weight));
    }
  }
  const unknown = new Set<string>();
  const text = body.replace(/\{(#?)([^{}\n]{1,40})\}/g, (whole, hash: string, rawName: string) => {
    const name = rawName.trim();
    if (hash) {
      const ch = findChannel(channels, name);
      if (!ch) {
        unknown.add(`#${name}`);
        return `#${name}`;
      }
      return opts.forPreview ? `#${ch.name}` : `<#${ch.id}>`;
    }
    const v = vars.get(name);
    if (v === undefined) {
      unknown.add(name);
      return whole;
    }
    return v;
  });
  return { text, unknown: [...unknown] };
}

export function findChannel(channels: GuildChannel[], name: string): GuildChannel | undefined {
  const n = name.toLowerCase();
  const pick = (same: GuildChannel[]) => same.find((c) => POSTABLE.has(c.type)) ?? same[0];
  // 宵宮のように同じ名前のテキストと通話があるときは、テキストを選ぶ
  const exact = pick(channels.filter((c) => c.name.toLowerCase() === n && c.type !== 4));
  if (exact) return exact;
  // 「🪧｜絵馬」のように見た目を変えた名前でも見つける（前からあるほう＝ID の小さいほう）
  const core = coreName(name);
  if (!core) return undefined;
  const loose = channels.filter((c) => c.type !== 4 && coreName(c.name) === core).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  return pick(loose);
}

/** 投稿先に選べるチャンネル（カテゴリ順） */
export function postableChannels(channels: GuildChannel[]): (GuildChannel & { category: string | null })[] {
  const cats = new Map(channels.filter((c) => c.type === 4).map((c) => [c.id, c]));
  const catPos = (c: GuildChannel) => (c.parent_id ? (cats.get(c.parent_id)?.position ?? 0) + 1 : 0);
  return channels
    .filter((c) => POSTABLE.has(c.type))
    .sort((a, b) => catPos(a) - catPos(b) || a.position - b.position)
    .map((c) => ({ ...c, category: c.parent_id ? (cats.get(c.parent_id)?.name ?? null) : null }));
}

// ───────── チャンネル一覧（プレビューのたびに Discord に聞かないよう、少しだけ覚えておく） ─────────

const channelCache = new WeakMap<DiscordActions, { at: number; guildId: string; list: GuildChannel[] }>();
const CACHE_MS = 30_000;

export async function guildChannelsCached(discord: DiscordActions, guildId: string, fresh = false): Promise<GuildChannel[]> {
  const hit = channelCache.get(discord);
  if (!fresh && hit && hit.guildId === guildId && Date.now() - hit.at < CACHE_MS) return hit.list;
  const list = await discord.guildChannels(guildId);
  channelCache.set(discord, { at: Date.now(), guildId, list });
  return list;
}

// ───────── 保存 ─────────

export async function listNotices(db: Db): Promise<Notice[]> {
  return db.select().from(notices).orderBy(asc(notices.channelId), asc(notices.position), asc(notices.id));
}

export async function getNotice(db: Db, id: number): Promise<Notice | undefined> {
  const [row] = await db.select().from(notices).where(eq(notices.id, id));
  return row;
}

export async function createNotice(
  db: Db,
  input: {
    channelId: string;
    title: string;
    body: string;
    style?: NoticeStyle;
    pinned?: boolean;
    sticky?: boolean;
    mention?: string;
    imagePosition?: ImagePosition;
    shuinButton?: boolean;
    by: string;
  },
): Promise<Notice> {
  const [last] = await db
    .select({ p: max(notices.position) })
    .from(notices)
    .where(eq(notices.channelId, input.channelId));
  const [row] = await db
    .insert(notices)
    .values({
      channelId: input.channelId,
      position: (last?.p ?? -1) + 1,
      title: input.title,
      body: input.body,
      style: input.style ?? 'embed',
      pinned: input.pinned ?? false,
      sticky: input.sticky ?? false,
      mention: input.mention ?? '',
      imagePosition: input.imagePosition ?? 'bottom',
      shuinButton: input.shuinButton ?? false,
      updatedBy: input.by,
    })
    .returning();
  await audit(db, { actorId: input.by, action: 'notice.create', detail: { id: row!.id, title: input.title }, via: 'web' });
  return row!;
}

export async function updateNotice(
  db: Db,
  id: number,
  input: {
    title: string;
    body: string;
    style?: NoticeStyle;
    pinned?: boolean;
    sticky?: boolean;
    mention?: string;
    imagePosition?: ImagePosition;
    shuinButton?: boolean;
    by: string;
  },
): Promise<void> {
  await db
    .update(notices)
    .set({
      title: input.title,
      body: input.body,
      ...(input.style ? { style: input.style } : {}),
      ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
      ...(input.sticky !== undefined ? { sticky: input.sticky } : {}),
      ...(input.mention !== undefined ? { mention: input.mention } : {}),
      ...(input.imagePosition ? { imagePosition: input.imagePosition } : {}),
      ...(input.shuinButton !== undefined ? { shuinButton: input.shuinButton } : {}),
      updatedBy: input.by,
      updatedAt: new Date(),
    })
    .where(eq(notices.id, id));
  await audit(db, { actorId: input.by, action: 'notice.update', detail: { id, title: input.title }, via: 'web' });
}

/** 同じチャンネルの中で 1 つ上・下と入れ替える（Discord の並びは「投稿し直す」で反映） */
export async function moveNotice(db: Db, id: number, dir: 'up' | 'down'): Promise<void> {
  const n = await getNotice(db, id);
  if (!n) return;
  const list = await db.select().from(notices).where(eq(notices.channelId, n.channelId)).orderBy(asc(notices.position), asc(notices.id));
  const i = list.findIndex((x) => x.id === id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= list.length) return;
  const order = [...list];
  [order[i], order[j]] = [order[j]!, order[i]!];
  await db.transaction(async (tx) => {
    for (const [pos, x] of order.entries()) await tx.update(notices).set({ position: pos }).where(eq(notices.id, x.id));
  });
}

export async function deleteNotice(ctx: NoticeCtx, id: number, by: string): Promise<void> {
  const n = await getNotice(ctx.db, id);
  if (!n) return;
  if (n.messageId) await deleteMessageQuietly(ctx.discord, n.channelId, n.messageId);
  await ctx.db.delete(notices).where(eq(notices.id, id));
  await audit(ctx.db, { actorId: by, action: 'notice.delete', detail: { id, title: n.title }, via: 'web' });
}

// ───────── 投稿 ─────────

export type PublishResult = 'posted' | 'edited' | 'reposted' | 'unchanged' | 'too_long' | 'pin_failed';

/**
 * 未投稿なら投稿、投稿済みなら書き換える。Discord 側で消されていたら投稿し直す。
 * メンションの通知が届くのは、はじめて投稿したときだけ（書き換え・出し直しでは鳴らさない）
 */
export async function publishNotice(ctx: NoticeCtx, id: number, by: string): Promise<PublishResult> {
  const n = await getNotice(ctx.db, id);
  if (!n) throw new Error(`notice ${id} not found`);
  const { text } = renderNotice(n.body, ctx.cfg, await guildChannelsCached(ctx.discord, ctx.cfg.guildId));
  if (tooLong(n.style, text, mentionFor(ctx, n.mention), n.shuinButton)) return 'too_long';
  if (noticeStatus(n, text) === 'posted') return 'unchanged';
  const image = await imageFor(ctx.db, n, n.imagePosition);
  const body = messageBody(n.style, text, mentionFor(ctx, n.mention), image, n.shuinButton);
  // 写真を外したときは、前の添付も外す。ボタンを外したときも
  if (!image && n.postedImage) body.attachments = [];
  if (!n.shuinButton && n.postedShuinButton) body.components = [];

  let result: PublishResult;
  let messageId = n.messageId;
  // 本文はそのままで、ピン留めだけ変えたとき
  const sameContent =
    Boolean(messageId) &&
    n.postedText === text &&
    n.postedStyle === n.style &&
    (n.postedMention ?? '') === n.mention &&
    (n.postedImage ?? '') === imageKey(n) &&
    n.postedShuinButton === n.shuinButton;
  if (sameContent) {
    result = 'edited';
  } else if (messageId) {
    try {
      await ctx.discord.editMessage(n.channelId, messageId, body);
      result = 'edited';
    } catch (err) {
      if (!(err instanceof DiscordHttpError && err.status === 404)) throw err;
      messageId = (await ctx.discord.sendMessage(n.channelId, body)).id;
      result = 'reposted';
    }
  } else {
    messageId = (await ctx.discord.sendMessage(n.channelId, n.mention ? { ...body, allowed_mentions: mentionAllowed(mentionFor(ctx, n.mention)) } : body)).id;
    result = 'posted';
  }
  // 新しく投稿したメッセージは、まだピン留めされていない
  const wasPinned = result === 'edited' ? n.postedPinned : false;
  const postedPinned = await applyPin(ctx.discord, n.channelId, messageId!, wantPinned(n), wasPinned);
  await ctx.db
    .update(notices)
    .set({ messageId, postedText: text, postedStyle: n.style, postedPinned, postedMention: n.mention, postedImage: image ? imageKey(n) : null, postedShuinButton: n.shuinButton })
    .where(eq(notices.id, id));
  await audit(ctx.db, { actorId: by, action: 'notice.publish', detail: { id, title: n.title, result }, via: by === 'system' ? 'system' : 'web' });
  return postedPinned === wantPinned(n) ? result : 'pin_failed';
}

/** いちばん下に置き直すものは、ピン留めしない（置き直すたびにピン留めのお知らせが出てしまうため） */
const wantPinned = (n: Notice) => n.pinned && !n.sticky;

/** いちばん下に表示し続ける掲示（チャンネルごと） */
export async function stickyNotices(db: Db, channelId?: string): Promise<Notice[]> {
  const rows = await db
    .select()
    .from(notices)
    .where(channelId ? and(eq(notices.sticky, true), eq(notices.channelId, channelId)) : eq(notices.sticky, true))
    .orderBy(asc(notices.position), asc(notices.id));
  return rows.filter((n) => n.messageId);
}

/**
 * 投稿済みの「いちばん下に表示し続ける」掲示を、消して下に出し直す（BOT が、書き込みが落ち着いたあとに呼ぶ）。
 * 本文は投稿済みのもの（未反映の変更は入れない）。
 */
export async function restickNotice(ctx: NoticeCtx, id: number): Promise<boolean> {
  const n = await getNotice(ctx.db, id);
  if (!n?.sticky || !n.messageId || n.postedText === null) return false;
  // 投稿済みの写真（そのあと差し替えていれば、写真なしで出し直す）
  const [hash, pos] = (n.postedImage ?? '').split(':');
  const image = hash ? await imageFor(ctx.db, n, isImagePosition(pos) ? pos : 'bottom', hash) : undefined;
  const { id: messageId } = await ctx.discord.sendMessage(n.channelId, messageBody(n.postedStyle ?? n.style, n.postedText, mentionFor(ctx, n.postedMention), image, n.postedShuinButton));
  await ctx.db
    .update(notices)
    .set({ messageId, postedPinned: false, ...(hash && !image ? { postedImage: null } : {}) })
    .where(eq(notices.id, id));
  await deleteMessageQuietly(ctx.discord, n.channelId, n.messageId);
  return true;
}

/** ピン留めを合わせる。できなければ（権限がないなど）今の状態のまま返す */
async function applyPin(discord: DiscordActions, channelId: string, messageId: string, want: boolean, now: boolean): Promise<boolean> {
  if (want === now) return now;
  try {
    await discord.pinMessage(channelId, messageId, want);
    return want;
  } catch (err) {
    logger.warn({ err, channelId, messageId }, 'notice pin failed');
    return now;
  }
}

/** まだ反映していないもの（未投稿・変更あり）を全部反映する */
export async function publishAll(ctx: NoticeCtx, by: string): Promise<{ done: number; tooLong: string[]; pinFailed: string[] }> {
  const channels = await guildChannelsCached(ctx.discord, ctx.cfg.guildId, true);
  let done = 0;
  const tooLong: string[] = [];
  const pinFailed: string[] = [];
  for (const n of await listNotices(ctx.db)) {
    if (noticeStatus(n, renderNotice(n.body, ctx.cfg, channels).text) === 'posted') continue;
    const r = await publishNotice(ctx, n.id, by);
    if (r === 'too_long') tooLong.push(n.title);
    else if (r === 'pin_failed') pinFailed.push(n.title);
    else if (r !== 'unchanged') done++;
  }
  return { done, tooLong, pinFailed };
}

/** チャンネルの掲示を全部消して、順番どおりに投稿し直す（並べ替え・途中に追加したとき用） */
export async function repostChannel(ctx: NoticeCtx, channelId: string, by: string): Promise<{ done: number; tooLong: string[]; pinFailed: string[] }> {
  const list = await ctx.db.select().from(notices).where(eq(notices.channelId, channelId)).orderBy(asc(notices.position), asc(notices.id));
  const channels = await guildChannelsCached(ctx.discord, ctx.cfg.guildId, true);
  const rendered = list.map((n) => ({ n, text: renderNotice(n.body, ctx.cfg, channels).text }));
  const over = rendered.filter((r) => tooLong(r.n.style, r.text, mentionFor(ctx, r.n.mention), r.n.shuinButton)).map((r) => r.n.title);
  if (over.length) return { done: 0, tooLong: over, pinFailed: [] };

  for (const { n } of rendered) {
    if (n.messageId) await deleteMessageQuietly(ctx.discord, channelId, n.messageId);
    await ctx.db
      .update(notices)
      .set({ messageId: null, postedText: null, postedStyle: null, postedPinned: false, postedMention: null, postedImage: null, postedShuinButton: false })
      .where(eq(notices.id, n.id));
  }
  const pinFailed: string[] = [];
  // 並べ直しなので、メンションの通知は鳴らさない
  for (const { n, text } of rendered) {
    const image = await imageFor(ctx.db, n, n.imagePosition);
    const { id } = await ctx.discord.sendMessage(channelId, messageBody(n.style, text, mentionFor(ctx, n.mention), image, n.shuinButton));
    const postedPinned = await applyPin(ctx.discord, channelId, id, wantPinned(n), false);
    if (postedPinned !== wantPinned(n)) pinFailed.push(n.title);
    await ctx.db
      .update(notices)
      .set({
        messageId: id,
        postedText: text,
        postedStyle: n.style,
        postedPinned,
        postedMention: n.mention,
        postedImage: image ? imageKey(n) : null,
        postedShuinButton: n.shuinButton,
      })
      .where(eq(notices.id, n.id));
  }
  await audit(ctx.db, { actorId: by, action: 'notice.repost', detail: { channelId, count: rendered.length }, via: 'web' });
  return { done: rendered.length, tooLong: [], pinFailed };
}

/**
 * 設定を変えたあとに呼ぶ: 投稿済みの掲示のうち、差し込んだ数字が変わったものを書き換える。
 * 手で書き換えた本文の「未反映」はそのまま（本文を編集中のものは勝手に反映しない）。
 */
export async function syncPostedNotices(ctx: NoticeCtx, before: GuildConfig): Promise<number> {
  let channels: GuildChannel[];
  try {
    channels = await guildChannelsCached(ctx.discord, ctx.cfg.guildId);
  } catch (err) {
    logger.warn({ err }, 'notice sync: could not load channels');
    return 0;
  }
  let changed = 0;
  for (const n of await listNotices(ctx.db)) {
    if (!n.messageId) continue;
    // 設定を変える前の値で差し込んだものが、投稿済みの本文と同じもの（＝本文は反映済み）だけ
    if (noticeStatus(n, renderNotice(n.body, before, channels).text) !== 'posted') continue;
    const text = renderNotice(n.body, ctx.cfg, channels).text;
    if (text === n.postedText || tooLong(n.style, text, mentionFor(ctx, n.mention), n.shuinButton)) continue;
    try {
      await publishNotice(ctx, n.id, 'system');
      changed++;
    } catch (err) {
      logger.warn({ err, id: n.id }, 'notice sync failed');
    }
  }
  return changed;
}

const RENAME_KEY = 'currency_rename_sync';

/**
 * 通貨の名前を変えたあと（移行で花びら → 銭）: 投稿済みの掲示を、新しい名前で出し直す（BOT の起動時に 1 回だけ）。
 * 前の名前で差し込んだものが投稿済みの本文と同じ掲示だけ。出し直した数を返す
 */
export async function syncCurrencyRename(ctx: NoticeCtx): Promise<number> {
  const [row] = await ctx.db.select().from(settings).where(eq(settings.key, RENAME_KEY));
  if (!row) return 0;
  const v = (row.value ?? {}) as { name?: unknown; emoji?: unknown };
  const e = ctx.cfg.economy;
  const before: GuildConfig = {
    ...ctx.cfg,
    economy: { ...e, currencyName: typeof v.name === 'string' ? v.name : '花びら', currencyEmoji: typeof v.emoji === 'string' ? v.emoji : '🌸' },
  };
  const changed = await syncPostedNotices(ctx, before);
  await ctx.db.delete(settings).where(eq(settings.key, RENAME_KEY));
  logger.info({ changed, to: e.currencyName }, 'currency rename: notices synced');
  return changed;
}

export type NoticeStatus = 'draft' | 'posted' | 'changed';

export function noticeStatus(n: Notice, renderedText: string): NoticeStatus {
  if (!n.messageId) return 'draft';
  const same =
    n.postedText === renderedText &&
    n.postedStyle === n.style &&
    n.postedPinned === wantPinned(n) &&
    (n.postedMention ?? '') === n.mention &&
    (n.postedImage ?? '') === imageKey(n) &&
    n.postedShuinButton === n.shuinButton;
  return same ? 'posted' : 'changed';
}

/**
 * チャンネルのいちばん下に「🌸 朱印を押す」ボタンを置く（掲示を作る・付けるだけ）。
 * いちばん下に表示し続ける掲示があれば、それに付ける。なければボタンだけ（本文なし）の掲示を作る
 */
async function ensureShuinButton(db: Db, channelId: string, by: string, all?: Notice[]): Promise<{ updated: number; created?: Notice; ids: number[] }> {
  const sticky = (all ?? (await listNotices(db))).filter((n) => n.channelId === channelId && n.sticky);
  if (!sticky.length) {
    const created = await createNotice(db, { channelId, title: '朱印を押す', body: '', style: 'text', sticky: true, shuinButton: true, by });
    return { updated: 0, created, ids: [created.id] };
  }
  let updated = 0;
  for (const n of sticky.filter((x) => !x.shuinButton)) {
    await db.update(notices).set({ shuinButton: true, updatedBy: by, updatedAt: new Date() }).where(eq(notices.id, n.id));
    updated++;
  }
  return { updated, ids: sticky.map((n) => n.id) };
}

/** /パネル 朱印: このチャンネルのいちばん下にボタンを置いて、すぐ Discord に出す */
export async function placeShuinButton(ctx: NoticeCtx, channelId: string, by: string): Promise<PublishResult[]> {
  const r = await ensureShuinButton(ctx.db, channelId, by);
  const results: PublishResult[] = [];
  for (const id of r.ids) results.push(await publishNotice(ctx, id, by));
  await audit(ctx.db, { actorId: by, action: 'notice.shuin_button', detail: { channelId, created: Boolean(r.created), updated: r.updated }, via: 'discord' });
  return results;
}

/**
 * カテゴリの中のテキストチャンネル全部の、いちばん下に「🌸 朱印を押す」ボタンを置く。
 * いちばん下に表示し続ける掲示（#絵馬 のひな形など）があれば、それにボタンを付ける。なければボタンだけ（本文なし）の掲示を作る。
 * 作る・付けるだけ（Discord への反映は「すべて反映」で）
 */
export async function addShuinButtonsToCategory(ctx: NoticeCtx, categoryId: string, by: string): Promise<{ channels: number; updated: number; created: number }> {
  const channels = await guildChannelsCached(ctx.discord, ctx.cfg.guildId, true);
  const targets = channels.filter((c) => c.type === 0 && c.parent_id === categoryId);
  const all = await listNotices(ctx.db);
  let updated = 0;
  let created = 0;
  for (const ch of targets) {
    const r = await ensureShuinButton(ctx.db, ch.id, by, all);
    updated += r.updated;
    created += r.created ? 1 : 0;
  }
  await audit(ctx.db, { actorId: by, action: 'notice.shuin_buttons', detail: { categoryId, channels: targets.length, updated, created }, via: 'web' });
  return { channels: targets.length, updated, created };
}

/** 標準の文面を入れる。チャンネルは名前で探す。すでに掲示があるチャンネルには入れない */
export async function seedDefaultNotices(ctx: NoticeCtx, by: string): Promise<{ created: number; missing: string[] }> {
  // 標準の文面を入れる前から掲示があるチャンネルには入れない（同じチャンネルに続けて入れるので、先に数えておく）
  const existing = new Set((await listNotices(ctx.db)).map((n) => n.channelId));
  return seedTemplates(ctx, DEFAULT_NOTICES, by, (ch) => !existing.has(ch.id));
}

/**
 * チャンネルの使い方の案内（各チャンネルにピン留め）と、#しきたり の「チャンネル案内」を入れる。
 * 同じチャンネルに同じタイトルの掲示があれば入れない（何度押しても増えない）。
 */
export async function seedChannelGuides(ctx: NoticeCtx, by: string): Promise<{ created: number; updated: number; missing: string[] }> {
  const list = await listNotices(ctx.db);
  const have = new Map(list.map((n) => [`${n.channelId}\n${n.title}`, n]));
  // 前の版の標準の文面のまま（手を加えていない）なら、新しい標準の文面にする（反映は「すべて反映」で）
  let updated = 0;
  const channels = await guildChannelsCached(ctx.discord, ctx.cfg.guildId, true);
  // #鳥居・#しきたり の標準の文面も（文面だけ）、チャンネルの案内は見せ方（ピン留め・いちばん下）も
  for (const [t, isGuide] of [...DEFAULT_NOTICES.map((t) => [t, false] as const), ...DEFAULT_GUIDES.map((t) => [t, true] as const)]) {
    const ch = findChannel(channels, t.channelName);
    const n = ch && have.get(`${ch.id}\n${t.title}`);
    if (!n) continue;
    const untouched = n.body === t.body || (PREVIOUS_GUIDE_BODIES[`${t.channelName}\n${t.title}`] ?? []).includes(n.body);
    const flagsDiffer = isGuide && (n.sticky !== Boolean(t.sticky) || n.pinned !== Boolean(t.pinned) || n.shuinButton !== Boolean(t.shuinButton));
    if (untouched && (n.body !== t.body || flagsDiffer)) {
      await updateNotice(ctx.db, n.id, {
        title: n.title,
        body: t.body,
        ...(isGuide ? { pinned: Boolean(t.pinned), sticky: Boolean(t.sticky), shuinButton: Boolean(t.shuinButton) } : {}),
        by,
      });
      updated++;
    }
  }
  const r = await seedTemplates(ctx, DEFAULT_GUIDES, by, (ch, t) => !have.has(`${ch.id}\n${t.title}`));
  return { ...r, updated };
}

async function seedTemplates(
  ctx: NoticeCtx,
  templates: NoticeTemplate[],
  by: string,
  wanted: (ch: GuildChannel, t: NoticeTemplate) => boolean,
): Promise<{ created: number; missing: string[] }> {
  const channels = await guildChannelsCached(ctx.discord, ctx.cfg.guildId, true);
  const missing = new Set<string>();
  let created = 0;
  for (const t of templates) {
    const ch = findChannel(channels, t.channelName);
    if (!ch || !POSTABLE.has(ch.type)) {
      missing.add(t.channelName);
      continue;
    }
    if (!wanted(ch, t)) continue;
    await createNotice(ctx.db, { channelId: ch.id, title: t.title, body: t.body, pinned: t.pinned, sticky: t.sticky, shuinButton: t.shuinButton, by });
    created++;
  }
  return { created, missing: [...missing] };
}

async function deleteMessageQuietly(discord: DiscordActions, channelId: string, messageId: string): Promise<void> {
  try {
    await discord.deleteMessage(channelId, messageId);
  } catch (err) {
    // すでに消されていれば何もしない
    if (!(err instanceof DiscordHttpError && err.status === 404)) throw err;
  }
}


import { innRow } from './innGuest.js';
import { vcHelpRow } from './vcHelp.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type APIEmbed,
  type MessageCreateOptions,
  type MessageActionRowComponentBuilder,
  type ModalActionRowComponentBuilder,
} from 'discord.js';
import type { Rank } from '../config.js';
import { currentAutoRank, highestRank, nextAutoRank, rankLabel, type Promotion } from '../domain/ranks.js';
import type { GiveDenied, GiveOutcome } from '../services/flows.js';
import type { RevokeResult, GoshuinchoData } from '../services/shuin.js';
import type { GiveEmaResult } from '../services/ema.js';
import { EMA_DAYS_TOGETHER, EMA_MESSAGE_MAX, EMA_MINUTES_TOGETHER, EMA_TIER_LABEL } from '../domain/ema.js';
import { emaGiveId, emaModalId, shuinId } from './ids.js';
import { w } from '../domain/terms.js';

/** 朱色 */
export const SHU = 0xd7003a;
/** 桜色（お祝い） */
export const SAKURA = 0xf7a8b8;

const mention = (id: string) => `<@${id}>`;

type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;

function row(...buttons: ButtonBuilder[]): Row {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(buttons);
}

const giveButton = (userId: string, label = w('朱印を押す', '結ぶ')) =>
  new ButtonBuilder().setCustomId(shuinId('give', userId)).setLabel(label).setEmoji('🌸').setStyle(ButtonStyle.Primary);
const revokeButton = (userId: string) =>
  new ButtonBuilder().setCustomId(shuinId('revoke', userId)).setLabel('取り消す').setStyle(ButtonStyle.Secondary);
const cardButton = (userId: string) =>
  new ButtonBuilder().setCustomId(shuinId('card', userId)).setLabel('プロフィールを見る').setEmoji('📕').setStyle(ButtonStyle.Secondary);
const listButton = (userId: string) =>
  new ButtonBuilder().setCustomId(shuinId('list', userId)).setLabel(w('朱印をくれた人', '結んでくれた人')).setStyle(ButtonStyle.Secondary);
/** 🎐 絵馬（評価の票）を贈るボタン。氏子以上だけが贈れる（押したときに確かめる） */
const emaGiveButton = (userId: string) =>
  new ButtonBuilder().setCustomId(emaGiveId(userId)).setLabel('絵馬を贈る').setEmoji('🎐').setStyle(ButtonStyle.Secondary);
/** 🧵 まだ結んでいない人（結びのコレクション）。自分のプロフィールにだけ出す */
const unmetButton = (userId: string) =>
  new ButtonBuilder().setCustomId(shuinId('unmet', userId)).setLabel('まだ結んでいない人').setEmoji('🧵').setStyle(ButtonStyle.Secondary);

export type Reply = { content?: string; embeds?: APIEmbed[]; components?: Row[]; allowedMentions?: { parse: never[] } };

/** 押せない理由（言葉は呼ぶたびに決まる：④のあとは「結び」） */
const denied = (reason: GiveDenied): string =>
  ({
    self: w('ご自身の御朱印帳には朱印を押せません。', 'ご自身とは結べません。'),
    bot: w('BOT には朱印を押せません。', 'BOT とは結べません。'),
    not_member: 'その方は咲楽ノ宮にいらっしゃらないようです。',
    giver_no_rank: w('まだ参拝者になっていないため、朱印を押せません。', 'まだ参拝者になっていないため、結べません。'),
    yakudoshi: w('👹 厄年のあいだは朱印を押せません。お祓いが済むまでお待ちください。', '👹 厄年のあいだは結べません。お祓いが済むまでお待ちください。'),
    receiver_no_rank: w('その方はまだ参拝者になっていないため、朱印を押せません。', 'その方はまだ参拝者になっていないため、結べません。'),
  })[reason];

/** 朱印を押した（結んだ）結果（本人だけに表示） */
export function giveReply(receiverId: string, outcome: GiveOutcome): Reply {
  switch (outcome.kind) {
    case 'denied':
      return { content: denied(outcome.reason) };
    case 'already':
      return {
        content: w(
          `${mention(receiverId)} さまには、すでに朱印を押しています（格 ${outcome.weight}）。`,
          `${mention(receiverId)} さまとは、もう結んでいます（結びは同じ方と 1 回だけ）。`,
        ),
        components: [row(cardButton(receiverId), revokeButton(receiverId))],
      };
    case 'given': {
      const verb = outcome.restamped ? '押し直しました' : '押しました';
      return {
        content: w(
          `🌸 ${mention(receiverId)} さまに朱印を${verb}（格 ${outcome.weight}・ご縁 +${outcome.addedGoen}）`,
          `🧵 ${mention(receiverId)} さまと${outcome.restamped ? '結び直しました' : '結びました'}（ご縁 +${outcome.addedGoen}）`,
        ),
        components: [row(cardButton(receiverId), revokeButton(receiverId))],
      };
    }
  }
}

/** 取り消した結果（本人だけに表示） */
export function revokeReply(receiverId: string, result: RevokeResult): Reply {
  if (result.status === 'not_found') {
    return { content: w(`${mention(receiverId)} さまには、まだ朱印を押していません。`, `${mention(receiverId)} さまとは、まだ結んでいません。`), components: [row(giveButton(receiverId))] };
  }
  return {
    content: w(`${mention(receiverId)} さまへの朱印を取り消しました（ご縁 -${result.weight}）。`, `${mention(receiverId)} さまとの結びを取り消しました（ご縁 -${result.weight}）。`),
    components: [row(giveButton(receiverId, w('もう一度押す', 'もう一度結ぶ')))],
  };
}

/** 🎐 絵馬の一言を入れるモーダル（匿名で飾られる） */
export function emaModal(receiverId: string, receiverName: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(emaModalId(receiverId))
    .setTitle(`${receiverName} さまへ絵馬を贈る`.slice(0, 45))
    .addComponents(
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('message')
          .setLabel('ひとこと（匿名で飾られます）')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(EMA_MESSAGE_MAX)
          .setRequired(false)
          .setPlaceholder('いっしょに過ごしてうれしかったこと など'),
      ),
    );
}

const EMA_HOURS = Math.round((EMA_MINUTES_TOGETHER / 60) * 10) / 10;

/** 絵馬を贈った結果（本人だけに表示） */
export function emaGiveReply(receiverId: string, result: GiveEmaResult): Reply {
  if (result.ok) {
    const verb = result.created ? '贈りました' : '贈り直しました（ひとことと日付を新しくしました）';
    return { content: `🎐 ${mention(receiverId)} さまに絵馬（${EMA_TIER_LABEL[result.tier]}）を${verb}。あなたが贈ったことは匿名で飾られます。いまの票は **${result.count} 枚**です。` };
  }
  const reasons: Record<Exclude<GiveEmaResult, { ok: true }>['reason'], string> = {
    self: 'ご自身には絵馬を贈れません。',
    no_member: 'その方は咲楽ノ宮にいらっしゃらないようです。',
    bot: 'BOT には絵馬を贈れません。',
    left: 'その方はもう咲楽ノ宮にいらっしゃらないようです。',
    staff_alt: '運営のサブのアカウントには贈れません。',
    giver_not_ujiko: '絵馬を贈れるのは氏子以上の方です。',
    giver_not_sodai: '世話役の方へ絵馬（総代の票）を贈れるのは、総代か運営だけです。',
    receiver_rank: '絵馬を贈れる相手は、参拝者・氏子・世話役の方だけです。',
    not_together: `まだいっしょに過ごした時間が足りません（違う日に ${EMA_DAYS_TOGETHER} 日以上・合計 ${EMA_HOURS} 時間以上、同じ通話にいること）。いまは ${result.days ?? 0} 日・${result.minutes ?? 0} 分です。`,
  };
  return { content: reasons[result.reason] };
}

/** 役職ごとの内訳（格の高い順）。設定から消えた役職キーもそのまま出す */
export function breakdownLine(ranks: readonly Rank[], byRank: Record<string, number>): string {
  const known = [...ranks].sort((a, b) => b.weight - a.weight);
  const parts: string[] = [];
  for (const r of known) {
    const n = byRank[r.key];
    if (n) parts.push(`${rankLabel(r)} ${n}`);
  }
  for (const [key, n] of Object.entries(byRank)) {
    if (!known.some((r) => r.key === key) && n) parts.push(`${key} ${n}`);
  }
  return parts.join(' ・ ');
}

/** プロフィールに出すこと（性別・DM・フレンド・称号・入った日・自己紹介） */
export type ProfileExtra = {
  /** 見ているのが本人（自分には朱印を押せないので、ボタンを出さない） */
  self?: boolean;
  gender?: string;
  dm?: string;
  friend?: string;
  titles?: string[];
  joinedAt?: Date | null;
  intro?: { url: string; excerpt: string };
  /** Discord のプロフィールのバナー（あれば大きく出す） */
  bannerUrl?: string;
  /** 持っている券（本人が自分だけに見えるように開いたときだけ） */
  tickets?: string;
};

const jstDay = (d: Date) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric' }).format(d);

/** プロフィール（御朱印帳）。ここから朱印を押せる */
export function goshuinchoReply(
  ranks: readonly Rank[],
  owner: { id: string; displayName: string; avatarUrl?: string; roleIds: string[] },
  data: GoshuinchoData,
  coins?: { emoji: string; name: string; balance: number },
  profile: ProfileExtra = {},
  ema?: { count: number; messages: { message: string; createdAt: Date }[]; promoteMode?: boolean; step?: { toName: string; need: number } },
  collection?: { total: number; met: number },
): Reply {
  const rank = highestRank(ranks, owner.roleIds);
  const auto = currentAutoRank(ranks, owner.roleIds);
  const next = auto ? nextAutoRank(ranks, data.goen, auto) : undefined;
  // 🎐 絵馬での昇格が ON のときは「次の段」を絵馬の枚数で案内する。OFF のときは従来どおりご縁で。
  let nextText = '';
  if (auto) {
    if (ema?.promoteMode && ema.step) {
      nextText = `（${ema.step.toName}の条件：絵馬 ${ema.step.need} 枚・あと ${Math.max(0, ema.step.need - ema.count)} 枚）`;
    } else if (!ema?.promoteMode && auto.key === 'sanpaisha') {
      nextText = '（氏子の条件：ご縁40＋縁側20時間）';
    } else if (!ema?.promoteMode && next) {
      nextText = `（${next.rank.name}まで あと ${next.remaining}）`;
    }
  }

  const received = data.receivedCount
    ? `${data.receivedCount} 人\n${breakdownLine(ranks, data.byRank)}`
    : 'まだありません';
  const recent = data.recentGiverIds.length ? data.recentGiverIds.map((id) => `${mention(id)} さま`).join('、') : '—';

  const embed = new EmbedBuilder()
    .setColor(SHU)
    .setTitle(w(`📕 ${owner.displayName} さまのプロフィール`, `📕 ${owner.displayName} さまのご縁帳`))
    .setDescription(`${rankLabel(rank)} ・ ご縁 **${data.goen}**${nextText}`);
  // 性別・DM・フレンド（あるものだけ）
  const about = [
    ...(profile.gender ? [{ name: '性別', value: profile.gender, inline: true }] : []),
    ...(profile.dm ? [{ name: 'DM', value: profile.dm, inline: true }] : []),
    ...(profile.friend ? [{ name: 'フレンド追加', value: profile.friend, inline: true }] : []),
    ...(profile.titles?.length ? [{ name: '称号', value: profile.titles.join('・'), inline: true }] : []),
    ...(profile.joinedAt ? [{ name: '参拝した日', value: jstDay(profile.joinedAt), inline: true }] : []),
  ];
  if (about.length) embed.addFields(about);
  embed.addFields({
    name: '自己紹介',
    value: profile.intro ? `${profile.intro.excerpt ? `${profile.intro.excerpt}\n` : ''}[📝 自己紹介を見る](${profile.intro.url})` : 'まだありません',
  });
  embed.addFields(
    { name: w('頂いた朱印', '結んでくれた人'), value: received },
    { name: w('最近の朱印', '最近結んでくれた人'), value: recent },
    { name: w('押した朱印', '結んだ人'), value: `${data.givenCount} 人`, inline: true },
  );
  // 🧵 結びのコレクション（自分のプロフィールだけ）
  if (profile.self && collection) embed.addFields({ name: '🧵 結びのコレクション', value: `${collection.met} / ${collection.total} 人${collection.met < collection.total ? '（下の「まだ結んでいない人」から結べます）' : '（コンプリート！）'}`, inline: true });
  // 🎐 絵馬（評価の票）。参拝者・氏子・世話役にだけ出す（匿名の一言と有効な枚数・次の段の票）
  const emaRelevant = rank?.key === 'sanpaisha' || rank?.key === 'ujiko' || rank?.key === 'sewayaku';
  if (ema && emaRelevant) embed.addFields({ name: '🎐 頂いた絵馬', value: emaField(ema) });
  if (coins) embed.addFields({ name: coins.name, value: `${coins.emoji} ${coins.balance}`, inline: true });
  if (profile.tickets) embed.addFields({ name: '🎟 券', value: profile.tickets });
  if (owner.avatarUrl) embed.setThumbnail(owner.avatarUrl);
  if (profile.bannerUrl) embed.setImage(profile.bannerUrl);

  const buttons = [
    ...(profile.self ? [] : [giveButton(owner.id)]),
    ...(profile.self || !emaRelevant ? [] : [emaGiveButton(owner.id)]),
    ...(profile.self ? [unmetButton(owner.id)] : []),
    listButton(owner.id),
  ];
  return { embeds: [embed.toJSON()], components: [row(...buttons)] };
}

/** 🎐 絵馬の欄（有効な枚数＋匿名の一言を新しい順に少しだけ）。1024 字をこえないようにする */
function emaField(ema: { count: number; messages: { message: string; createdAt: Date }[] }): string {
  if (!ema.count) return 'まだありません（評価の票）';
  const withMsg = ema.messages.filter((m) => m.message.trim());
  const lines: string[] = [`**${ema.count} 枚**（評価の票）`];
  let shown = 0;
  for (const m of withMsg) {
    const text = `> ${m.message.trim().replace(/\n+/g, ' ').slice(0, 80)}`;
    if (lines.join('\n').length + text.length + 1 > 1000 || shown >= 3) break;
    lines.push(text);
    shown++;
  }
  if (withMsg.length > shown) lines.push(`-# ほか ${withMsg.length - shown} 件の一言`);
  return lines.join('\n');
}

/**
 * 朱印をくれた人の一覧。
 * 名前は @メンション ではなく、BOT が覚えている表示名の文字で出す（埋め込みの @ は、相手を知らない端末だと「不明なユーザー」になるため）。
 * names: 人の ID → 表示名（なければ「退出した人」）。
 */
export function giversReply(ownerId: string, givers: { giverId: string }[], total: number, names?: Map<string, string>): Reply {
  const nameOf = (id: string) => names?.get(id) ?? '退出した人';
  if (!givers.length) return { content: w(`${nameOf(ownerId)} さまは、まだ朱印を頂いていません。`, `${nameOf(ownerId)} さまと結んだ方は、まだいません。`), allowedMentions: { parse: [] } };
  const lines = givers.map((g) => `${nameOf(g.giverId)} さま`).join('、');
  const more = total > givers.length ? `\nほか ${total - givers.length} 人` : '';
  const embed = new EmbedBuilder()
    .setColor(SHU)
    .setTitle(w(`朱印をくれた人（${total} 人）`, `結んでくれた人（${total} 人）`))
    .setDescription(`${nameOf(ownerId)} ${w('さまの御朱印帳', 'さまのご縁帳')}\n\n${lines}${more}`);
  return { embeds: [embed.toJSON()], allowedMentions: { parse: [] } };
}

/** #慶事 での昇格の発表（emaCount を渡すと「絵馬◯枚」で飾る） */
export function promotionAnnouncement(userId: string, promotion: Promotion, goen: number, roleIds: readonly string[], avatarUrl?: string, emaCount?: number): MessageCreateOptions {
  const ema = emaCount !== undefined;
  const embed = new EmbedBuilder()
    .setColor(SAKURA)
    .setTitle('🌸 ご昇格おめでとうございます')
    .setDescription(ema
      ? `${mention(userId)} さまに絵馬（評価の票）が集まり、**${rankLabel(promotion.to)}** になられました。`
      : `${mention(userId)} さまのご縁が花ひらき、**${rankLabel(promotion.to)}** になられました。`)
    .addFields(
      { name: '新しい位', value: rankLabel(promotion.to), inline: true },
      ema ? { name: '絵馬', value: `${emaCount} 枚`, inline: true } : { name: 'ご縁', value: String(goen), inline: true },
    )
    .setFooter({ text: '咲楽ノ宮・慶事' });
  if (avatarUrl) embed.setThumbnail(avatarUrl);
  return {
    content: `${roleIds.map((id) => `<@&${id}>`).join(' ')} 新しい仲間をお迎えください。`.trim(),
    embeds: [embed.toJSON()],
    allowedMentions: { parse: [], users: [], roles: [...roleIds] },
  };
}

/** #慶事：大勢がいっぺんに昇格したときの、まとめの通知（1回だけ役職に知らせる。1人ずつのカードは通知なしで上に出ている） */
export function promotionBurstAnnouncement(count: number, roleIds: readonly string[]): MessageCreateOptions {
  return {
    content: `${roleIds.map((id) => `<@&${id}>`).join(' ')} 🌸 新しく **${count} 名**の方が昇格されました（上の発表をご覧ください）。新しい仲間をお迎えください。`.trim(),
    allowedMentions: { parse: [], users: [], roles: [...roleIds] },
  };
}

/** #記録 用のログ */
export function giveLog(giverId: string, giverRank: Rank, receiverId: string, weight: number, goen: number, addedGoen: number): string {
  return w(
    `🌸 朱印 ${mention(giverId)}（${giverRank.name}・格 ${weight}）→ ${mention(receiverId)}　ご縁 ${goen}（+${addedGoen}）`,
    `🧵 結び ${mention(giverId)}（${giverRank.name}・重み ${weight}）→ ${mention(receiverId)}　ご縁 ${goen}（+${addedGoen}）`,
  );
}

export function revokeLog(giverId: string, receiverId: string, weight: number, goen: number): string {
  return `↩️ 取り消し ${mention(giverId)} → ${mention(receiverId)}（-${weight}）　ご縁 ${goen}`;
}

export function promotionLog(userId: string, promotion: Promotion, goen: number): string {
  return `⬆️ 昇格 ${mention(userId)} ${promotion.from.name} → ${promotion.to.name}（ご縁 ${goen}）`;
}

// ───────── 通話のチャット（「この通話の人のプロフィールを見る」） ─────────

/** 1 回に並べる人数（ボタン 5 × 4 行） */
export const VC_LIST_MAX = 20;

/** 通話に入った人がいたら、その通話のチャットのいちばん下に出すカード */
export function vcPanel(channelId: string, help = false, inn = false, profile = true): Reply {
  const lines = [
    ...(profile ? ['📕 **この通話の人のプロフィールを見る**', w('-# 下のボタンを押すと、今この通話にいる人が出ます。プロフィールから朱印も押せます（あなたにだけ見えます）', '-# 下のボタンを押すと、今この通話にいる人が出ます。プロフィールから結べます（あなたにだけ見えます）')] : []),
    ...(help ? ['💤 寝落ちの人がいたら・🛡 困ったときは、下のボタンで衛士に知らせられます。'] : []),
    ...(inn ? ['👤 役職の方は、人を呼んで一時的にこの通話に入れられます。'] : []),
  ];
  return {
    embeds: [new EmbedBuilder().setColor(SAKURA).setDescription(lines.join('\n') || '　').toJSON()],
    components: [
      ...(profile ? [row(new ButtonBuilder().setCustomId(shuinId('vc', channelId)).setLabel('この通話の人のプロフィールを見る').setEmoji('📕').setStyle(ButtonStyle.Primary))] : []),
      ...(help ? [vcHelpRow(channelId)] : []),
      ...(inn ? [innRow(channelId)] : []),
    ],
  };
}

/** 通話のチャットのカードか見分ける ID（どのボタンが出ていても見分けられるように） */
export const vcPanelIds = (channelId: string) => [shuinId('vc', channelId), `vchelp:sleep:${channelId}`, `inn:invite:${channelId}`];

/** 通話にいる人のボタン。押すとその人のプロフィール（そこから朱印を押せる）。今の格で朱印を押した人は ✅。昇格前の朱印は差額を付けられるので 📕 */
export function vcList(people: { id: string; name: string; stamped: boolean }[], total: number): Reply {
  if (!people.length) return { content: '今この通話には、ほかの方がいません。' };
  const buttons = people.slice(0, VC_LIST_MAX).map((p) => {
    const label = p.name.slice(0, 30) || '（名前なし）';
    return new ButtonBuilder()
      .setCustomId(shuinId('card', p.id))
      .setLabel(label)
      .setEmoji(p.stamped ? '✅' : '📕')
      .setStyle(p.stamped ? ButtonStyle.Secondary : ButtonStyle.Primary);
  });
  const rows: Row[] = [];
  for (let i = 0; i < buttons.length; i += 5) rows.push(row(...buttons.slice(i, i + 5)));
  const more = total > VC_LIST_MAX ? `\n-# ほかの方は、名前を右クリック（スマホは長押し）→「アプリ」→「プロフィール」` : '';
  return {
    content: w(
      `📕 プロフィールを見る人を選んでください（プロフィールの「🌸 朱印を押す」で朱印を押せます。今の格で押した人は ✅）
-# 昇格で格が上がったら押し直せます。前のご縁を残し、差額だけ付きます。${more}`,
      `📕 プロフィールを見る人を選んでください（プロフィールの「結ぶ」で結べます。もう結んだ人は ✅）
-# 結びは同じ方と 1 回だけです。${more}`,
    ),
    components: rows,
  };
}

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type APIEmbed,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Rank } from '../config.js';
import { currentAutoRank, highestRank, nextAutoRank, rankLabel, type Promotion } from '../domain/ranks.js';
import type { GiveDenied, GiveOutcome } from '../services/flows.js';
import type { RevokeResult, GoshuinchoData } from '../services/shuin.js';
import { shuinId } from './ids.js';

/** 朱色 */
export const SHU = 0xd7003a;
/** 桜色（お祝い） */
export const SAKURA = 0xf7a8b8;

const mention = (id: string) => `<@${id}>`;

type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;

function row(...buttons: ButtonBuilder[]): Row {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(buttons);
}

const giveButton = (userId: string, label = '朱印を押す') =>
  new ButtonBuilder().setCustomId(shuinId('give', userId)).setLabel(label).setEmoji('🌸').setStyle(ButtonStyle.Primary);
const revokeButton = (userId: string) =>
  new ButtonBuilder().setCustomId(shuinId('revoke', userId)).setLabel('取り消す').setStyle(ButtonStyle.Secondary);
const cardButton = (userId: string) =>
  new ButtonBuilder().setCustomId(shuinId('card', userId)).setLabel('プロフィールを見る').setEmoji('📕').setStyle(ButtonStyle.Secondary);
const listButton = (userId: string) =>
  new ButtonBuilder().setCustomId(shuinId('list', userId)).setLabel('朱印をくれた人').setStyle(ButtonStyle.Secondary);

export type Reply = { content?: string; embeds?: APIEmbed[]; components?: Row[] };

const DENIED: Record<GiveDenied, string> = {
  self: 'ご自身の御朱印帳には朱印を押せません。',
  bot: 'BOT には朱印を押せません。',
  not_member: 'その方は咲楽ノ宮にいらっしゃらないようです。',
  giver_no_rank: 'まだ参拝者になっていないため、朱印を押せません。',
  yakudoshi: '👹 厄年のあいだは朱印を押せません。お祓いが済むまでお待ちください。',
  receiver_no_rank: 'その方はまだ参拝者になっていないため、朱印を押せません。',
};

/** 朱印を押した結果（本人だけに表示） */
export function giveReply(receiverId: string, outcome: GiveOutcome): Reply {
  switch (outcome.kind) {
    case 'denied':
      return { content: DENIED[outcome.reason] };
    case 'already':
      return {
        content: `${mention(receiverId)} さまには、すでに朱印を押しています（格 ${outcome.weight}）。`,
        components: [row(cardButton(receiverId), revokeButton(receiverId))],
      };
    case 'given': {
      const verb = outcome.restamped ? '押し直しました' : '押しました';
      return {
        content: `🌸 ${mention(receiverId)} さまに朱印を${verb}（格 ${outcome.weight}・ご縁 +${outcome.addedGoen}）`,
        components: [row(cardButton(receiverId), revokeButton(receiverId))],
      };
    }
  }
}

/** 取り消した結果（本人だけに表示） */
export function revokeReply(receiverId: string, result: RevokeResult): Reply {
  if (result.status === 'not_found') {
    return { content: `${mention(receiverId)} さまには、まだ朱印を押していません。`, components: [row(giveButton(receiverId))] };
  }
  return {
    content: `${mention(receiverId)} さまへの朱印を取り消しました（ご縁 -${result.weight}）。`,
    components: [row(giveButton(receiverId, 'もう一度押す'))],
  };
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
): Reply {
  const rank = highestRank(ranks, owner.roleIds);
  const auto = currentAutoRank(ranks, owner.roleIds);
  const next = auto ? nextAutoRank(ranks, data.goen, auto) : undefined;
  const nextText = next ? `（${next.rank.name}まで あと ${next.remaining}）` : '';

  const received = data.receivedCount
    ? `${data.receivedCount} 人\n${breakdownLine(ranks, data.byRank)}`
    : 'まだありません';
  const recent = data.recentGiverIds.length ? data.recentGiverIds.map((id) => `${mention(id)} さま`).join('、') : '—';

  const embed = new EmbedBuilder()
    .setColor(SHU)
    .setTitle(`📕 ${owner.displayName} さまのプロフィール`)
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
    { name: '頂いた朱印', value: received },
    { name: '最近の朱印', value: recent },
    { name: '押した朱印', value: `${data.givenCount} 人`, inline: true },
  );
  if (coins) embed.addFields({ name: coins.name, value: `${coins.emoji} ${coins.balance}`, inline: true });
  if (profile.tickets) embed.addFields({ name: '🎟 券', value: profile.tickets });
  if (owner.avatarUrl) embed.setThumbnail(owner.avatarUrl);
  if (profile.bannerUrl) embed.setImage(profile.bannerUrl);

  const buttons = [...(profile.self ? [] : [giveButton(owner.id)]), listButton(owner.id)];
  return { embeds: [embed.toJSON()], components: [row(...buttons)] };
}

/** 朱印をくれた人の一覧 */
export function giversReply(ownerId: string, givers: { giverId: string }[], total: number): Reply {
  if (!givers.length) return { content: `${mention(ownerId)} さまは、まだ朱印を頂いていません。` };
  const lines = givers.map((g) => `${mention(g.giverId)} さま`).join('、');
  const more = total > givers.length ? `\nほか ${total - givers.length} 人` : '';
  const embed = new EmbedBuilder()
    .setColor(SHU)
    .setTitle(`朱印をくれた人（${total} 人）`)
    .setDescription(`${mention(ownerId)} さまの御朱印帳\n\n${lines}${more}`);
  return { embeds: [embed.toJSON()] };
}

/** #慶事 での昇格の発表 */
export function promotionAnnouncement(userId: string, promotion: Promotion, goen: number): string {
  return `🌸 ${mention(userId)} さまのご縁が花ひらき、**${rankLabel(promotion.to)}** になられました。（ご縁 ${goen}）`;
}

/** #記録 用のログ */
export function giveLog(giverId: string, giverRank: Rank, receiverId: string, weight: number, goen: number, addedGoen: number): string {
  return `🌸 朱印 ${mention(giverId)}（${giverRank.name}・格 ${weight}）→ ${mention(receiverId)}　ご縁 ${goen}（+${addedGoen}）`;
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
export function vcPanel(channelId: string): Reply {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(SAKURA)
        .setDescription('📕 **この通話の人のプロフィールを見る**\n-# 下のボタンを押すと、今この通話にいる人が出ます。プロフィールから朱印も押せます（あなたにだけ見えます）')
        .toJSON(),
    ],
    components: [row(new ButtonBuilder().setCustomId(shuinId('vc', channelId)).setLabel('この通話の人のプロフィールを見る').setEmoji('📕').setStyle(ButtonStyle.Primary))],
  };
}

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
  return { content: `📕 プロフィールを見る人を選んでください（プロフィールの「🌸 朱印を押す」で朱印を押せます。今の格で押した人は ✅）
-# 昇格で格が上がったら押し直せます。前のご縁を残し、差額だけ付きます。${more}`, components: rows };
}

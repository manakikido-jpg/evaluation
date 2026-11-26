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
import { emaCardId, emaGiveId, emaModalId, sewayakuVoteId, shuinId } from './ids.js';
import type { CandidateStatus, VoterStatus, VoteResult } from '../services/sewayakuElection.js';
import type { UjikoProgress } from '../services/ujikoRequirement.js';
import type { EmaThresholdCounts } from '../domain/ema.js';
import { w, isMusubiMode } from '../domain/terms.js';

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
/** 🗳 世話役の選挙の投票ボタン（#世話役選挙 の投稿に。押すと投票・もう一度で取り消し） */
const sewayakuVoteButton = (userId: string) =>
  new ButtonBuilder().setCustomId(sewayakuVoteId(userId)).setLabel('お世話役になってほしい').setEmoji('🗳').setStyle(ButtonStyle.Primary);
/** プロフィールから、ご縁帳・絵馬を開くボタン */
const goenCardButton = (userId: string) =>
  new ButtonBuilder().setCustomId(shuinId('goen', userId)).setLabel(w('御朱印帳', 'ご縁帳')).setEmoji('📕').setStyle(ButtonStyle.Secondary);
const emaCardButton = (userId: string) =>
  new ButtonBuilder().setCustomId(emaCardId(userId)).setLabel('絵馬').setEmoji('🎐').setStyle(ButtonStyle.Secondary);
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

/** ご縁帳に出す、世話役の選挙のようす */
export type SewayakuCardInfo = {
  status: CandidateStatus;
  election?: { status: string; startsAt: Date; endsAt: Date };
  showVote: boolean;
  voted: boolean;
};

const jDay = (d: Date) => d.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short' });
const lastDay = (endsAt: Date) => jDay(new Date(endsAt.getTime() - 1));
const hoursOf = (m: number) => Math.floor(m / 60);

const SEWAYAKU_VOTER_KEYS_VIEW: readonly string[] = ['ujiko', 'sewayaku', 'sodai'];
const rankName = (ranks: readonly Rank[], key: string) => {
  const r = ranks.find((x) => x.key === key);
  return r ? rankLabel(r) : key;
};
const rate = (p: number) => (p % 10 === 0 ? `${p / 10}割` : `${p}%`);

/** ご縁帳の「⬆️ 次の役職」：参拝者→氏子（絵馬）／氏子→世話役（選挙）／世話役→総代（絵馬）の条件を全部 */
function nextRankLines(
  ranks: readonly Rank[],
  ema: { count: number; step?: { toName: string; need: number; have?: number; inPeriod?: boolean }; sewayaku?: SewayakuCardInfo; ujiko?: UjikoProgress; th?: EmaThresholdCounts },
): string[] {
  const th = ema.th;
  // 参拝者 → 氏子
  if (ema.ujiko && th) {
    const u = ema.ujiko;
    const left = Math.max(0, u.required - u.total);
    return [
      `**${rankName(ranks, 'ujiko')}まで：絵馬（氏子の票） ${left ? `あと ${left} 枚` : 'そろいました'}**（いま ${u.total} / ${u.required} 枚）`,
      u.inOmairi && u.endsAt ? `・期間：お参り期間（${jDay(u.since)}〜${jDay(u.endsAt)}）にもらった絵馬だけ数えます` : '・お参り期間がないので、直近14日にもらった絵馬で数えています',
      `・要る数：${u.required} 枚（${u.week.slice(5).replace('-', '/')} からの週の数。前の7日間に縁側に${hoursOf(th.ujikoActiveMinutes)}時間以上いた氏子以上 ${u.active} 人の${rate(th.ujikoPercent)}・切り上げ・最低${th.ujikoMin}枚）`,
      `・期間中にもらった絵馬：${u.votes} 枚`,
      `・招待の補い：${u.inviteUsed} / ${th.inviteSubstituteMax}（招待した人が参拝者になると1つ。お参り期間も1日のびます）`,
    ];
  }
  // 氏子 → 世話役（選挙）
  if (ema.sewayaku && th) {
    const info = ema.sewayaku;
    const head = `**${rankName(ranks, 'sewayaku')}まで：選挙**`;
    const e = info.election;
    if (e?.status === 'open') return [head, `・🗳 選挙中：${lastDay(e.endsAt)} 23:59 まで（投票できる人の${rate(th.sewayakuVotePercent)}を超えたら世話役）`];
    if (e?.status === 'scheduled') return [head, `・選挙の日：${jDay(e.startsAt)}〜${lastDay(e.endsAt)}（投票できる人の${rate(th.sewayakuVotePercent)}を超えたら世話役）`];
    if (e?.status === 'closing') return [head, '・選挙を締めています'];
    const c = info.status;
    if (c.reason === 'not_started') return [head, '・新制度が始まってから数えます'];
    if (c.reason === 'rank' || c.reason === 'not_member') return [head, '・氏子になってから数えます'];
    const lines = [head];
    lines.push(c.keptAt && c.keptAt > new Date() ? `・氏子を${th.sewayakuCandidateMonths}か月：${jDay(c.keptAt)} から` : `・氏子を${th.sewayakuCandidateMonths}か月：✅`);
    lines.push(`・氏子になってから縁側：${hoursOf(c.minutes)} / ${hoursOf(c.need)} 時間${c.minutes >= c.need ? ' ✅' : ''}`);
    if (c.retry) lines.push(`・前の選挙のあとの縁側：${hoursOf(c.retry.minutes)} / ${hoursOf(c.retry.need)} 時間${c.retry.minutes >= c.retry.need ? ' ✅' : ''}（届くと、また選挙）`);
    lines.push(c.ok ? '・条件がそろいました。まもなく選挙の日（金・土・日）が決まります' : '・そろうと、その週の金・土・日（金曜より後なら次の週）に選挙があります');
    return lines;
  }
  // 世話役 → 総代（絵馬）
  if (ema.step && !ema.step.inPeriod) {
    const have = ema.step.have ?? ema.count;
    const left = Math.max(0, ema.step.need - have);
    return [`**${ema.step.toName}まで：絵馬（総代の票） ${left ? `あと ${left} 枚` : 'そろいました'}**（いま ${have} / ${ema.step.need} 枚）`, '・総代と運営が贈れます（失効しません）'];
  }
  return [];
}

/** 🗳 世話役の選挙の投票権（直近30日の縁側） */
function voterLine(v: VoterStatus, th: EmaThresholdCounts): string {
  const need = hoursOf(th.sewayakuVoterMinutes);
  return v.ok
    ? `✅ 投票できます（直近30日の縁側 ${hoursOf(v.minutes)} 時間・${need}時間を超えると投票できます）\n-# 選挙がはじまる金曜0時の時点で決まります`
    : `直近30日の縁側 ${hoursOf(v.minutes)} / ${need} 時間（超えると投票できます）\n-# 選挙がはじまる金曜0時の時点で決まります`;
}

/** 🗳 #世話役選挙：選挙がはじまったときの投稿（投票ボタンつき・通知なし） */
export function sewayakuElectionPost(candidateId: string, endsAt: Date, voters: number, th: { sewayakuVotePercent: number; sewayakuVoterMinutes: number }): MessageCreateOptions {
  const embed = new EmbedBuilder()
    .setColor(SAKURA)
    .setTitle('🗳 世話役の選挙')
    .setDescription(`${mention(candidateId)} さまを、世話役に推しますか？`)
    .addFields(
      { name: '期間', value: `${lastDay(endsAt)} 23:59 まで`, inline: true },
      { name: '投票できる人', value: `${voters} 人`, inline: true },
      { name: '決まり方', value: `投票できる人の ${th.sewayakuVotePercent}% を超える「お世話役になってほしい」が集まったら世話役になります。投票は匿名で、もう一度押すと取り消せます。` },
      { name: '投票できる人', value: `選挙がはじまった金曜0時に、直近30日の縁側の浮上が ${hoursOf(th.sewayakuVoterMinutes)} 時間を超えていた氏子・世話役・総代の方` },
    )
    .setFooter({ text: '咲楽ノ宮・世話役選挙' });
  return { embeds: [embed.toJSON()], components: [row(sewayakuVoteButton(candidateId))], allowedMentions: { parse: [], users: [] } };
}

/** 🗳 #世話役選挙：締めたあとの投稿（ボタンを外す。届かなかったときは票の数を出さない） */
export function sewayakuElectionResultPost(candidateId: string, passed: boolean, votes: number, voters: number): { embeds: APIEmbed[]; components: [] } {
  const embed = new EmbedBuilder()
    .setColor(passed ? SAKURA : SHU)
    .setTitle('🗳 世話役の選挙（締め切りました）')
    .setDescription(passed ? `${mention(candidateId)} さまは、${voters} 人中 ${votes} 票で **世話役** になられました。` : `${mention(candidateId)} さまの選挙を締め切りました。今回は世話役にはなりませんでした。`)
    .setFooter({ text: '咲楽ノ宮・世話役選挙' });
  return { embeds: [embed.toJSON()], components: [] };
}

/** 🗳 世話役の選挙の投票の結果（本人だけに表示） */
export function sewayakuVoteReply(candidateId: string, result: VoteResult, th: { sewayakuVotePercent: number; sewayakuVoterMinutes: number }): Reply {
  if (result.ok) {
    return {
      content: result.voted
        ? `🗳 ${mention(candidateId)} さまに「お世話役になってほしい」と投票しました（匿名）。${lastDay(result.endsAt)} 23:59 に締めて、票が投票できる人の ${th.sewayakuVotePercent}% を超えると世話役になります。もう一度押すと取り消せます。`
        : `🗳 ${mention(candidateId)} さまへの投票を取り消しました。`,
    };
  }
  if (result.reason === 'self') return { content: 'ご自身には投票できません。' };
  if (result.reason === 'no_election') {
    return { content: result.scheduled ? `${mention(candidateId)} さまの世話役の選挙は ${jDay(result.scheduled.startsAt)}〜${lastDay(result.scheduled.endsAt)} です。その間に投票できます。` : `${mention(candidateId)} さまは、いま世話役の選挙中ではありません。` };
  }
  const v = result.voter;
  if (v?.reason === 'rank') return { content: 'この選挙で投票できるのは、選挙がはじまったときに氏子・世話役・総代で、直近30日の縁側の浮上が条件を超えていた方です。' };
  return { content: `この選挙で投票できるのは、選挙がはじまったとき（金曜0時）に直近30日の縁側の浮上が ${hoursOf(th.sewayakuVoterMinutes)} 時間を超えていた氏子・世話役・総代の方です（いま ${hoursOf(v?.minutes ?? 0)} 時間）。` };
}

/** 🗳 /世話役の投票：投票中・これからの選挙と、自分が投票できるか（本人だけに表示） */
export function sewayakuInfoReply(
  open: readonly { candidateId: string; endsAt: Date; canVote: boolean; voted: boolean }[],
  scheduled: readonly { candidateId: string; startsAt: Date; endsAt: Date }[],
  voter: VoterStatus,
  th: { sewayakuVotePercent: number; sewayakuVoterMinutes: number; sewayakuCandidateMinutes: number; sewayakuCandidateMonths: number; sewayakuRetryMinutes: number },
): Reply {
  const right = voter.ok
    ? `✅ いまの縁側（直近30日 ${hoursOf(voter.minutes)} 時間）なら、金曜にはじまる選挙で投票できます。`
    : voter.reason === 'time'
      ? `直近30日の縁側の浮上が ${hoursOf(th.sewayakuVoterMinutes)} 時間を超えると投票できます（いま ${hoursOf(voter.minutes)} 時間）。`
      : '投票できるのは、氏子・世話役・総代の方です。';
  const openLines = open.length
    ? open.slice(0, 25).map((e) => `- ${mention(e.candidateId)} さま（${lastDay(e.endsAt)} まで）${e.voted ? ' … ✅ 投票ずみ' : e.canVote ? ' … 投票できます' : ' … この選挙では投票できません'}`).join('\n')
    : 'いま投票中の選挙はありません。';
  const nextLines = scheduled.length ? scheduled.slice(0, 25).map((e) => `- ${mention(e.candidateId)} さま（${jDay(e.startsAt)}〜${lastDay(e.endsAt)}）`).join('\n') : 'ありません。';
  return {
    content: [
      '🗳 **世話役の選挙（匿名）**',
      `氏子を ${th.sewayakuCandidateMonths} か月つづけて、氏子になってから縁側に ${hoursOf(th.sewayakuCandidateMinutes)} 時間いた氏子が候補になり、その週の金・土・日が選挙です。票が「投票できる人」の ${th.sewayakuVotePercent}% を超えると世話役になります（落ちたら、縁側 ${hoursOf(th.sewayakuRetryMinutes)} 時間でもう一度）。`,
      '投票のしかた：#世話役選挙 の、その方の投稿の「🗳 お世話役になってほしい」を押す。もう一度押すと取り消せます。',
      right,
      '**投票中の選挙**',
      openLines,
      '**これからの選挙**',
      nextLines,
    ].join('\n'),
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
export type CardMode = 'profile' | 'goen' | 'ema';

export function goshuinchoReply(
  ranks: readonly Rank[],
  owner: { id: string; displayName: string; avatarUrl?: string; roleIds: string[] },
  data: GoshuinchoData,
  coins?: { emoji: string; name: string; balance: number },
  profile: ProfileExtra = {},
  ema?: { count: number; messages: { message: string; createdAt: Date }[]; promoteMode?: boolean; step?: { toName: string; need: number; have?: number; inPeriod?: boolean }; sewayaku?: SewayakuCardInfo; ujiko?: UjikoProgress; voter?: VoterStatus; th?: EmaThresholdCounts; tierLabel?: string },
  collection?: { total: number; met: number },
  view: { mode?: CardMode; perkNext?: { goen: number; label: string } } = {},
): Reply {
  const mode = view.mode ?? 'profile';
  const rank = highestRank(ranks, owner.roleIds);
  const auto = currentAutoRank(ranks, owner.roleIds);
  const next = auto ? nextAutoRank(ranks, data.goen, auto) : undefined;
  // 🎐 絵馬（評価の票）は参拝者・氏子・世話役にだけ出す
  const emaRelevant = rank?.key === 'sanpaisha' || rank?.key === 'ujiko' || rank?.key === 'sewayaku';
  const promoteMode = Boolean(ema?.promoteMode);
  if (mode === 'ema') {
    if (!promoteMode) return { content: '🎐 絵馬は、新制度が始まってからです。' };
    return emaCardReply(ranks, owner, rank, emaRelevant, profile, ema);
  }

  const received = data.receivedCount
    ? `${data.receivedCount} 人\n${breakdownLine(ranks, data.byRank)}`
    : 'まだありません';
  const recent = data.recentGiverIds.length ? data.recentGiverIds.map((id) => `${mention(id)} さま`).join('、') : '—';
  const about = [
    ...(profile.gender ? [{ name: '性別', value: profile.gender, inline: true }] : []),
    ...(profile.dm ? [{ name: 'DM', value: profile.dm, inline: true }] : []),
    ...(profile.friend ? [{ name: 'フレンド追加', value: profile.friend, inline: true }] : []),
    ...(profile.titles?.length ? [{ name: '称号', value: profile.titles.join('・'), inline: true }] : []),
    ...(profile.joinedAt ? [{ name: '参拝した日', value: jstDay(profile.joinedAt), inline: true }] : []),
  ];
  const introField = {
    name: '自己紹介',
    value: profile.intro ? `${profile.intro.excerpt ? `${profile.intro.excerpt}\n` : ''}[📝 自己紹介を見る](${profile.intro.url})` : 'まだありません',
  };
  const goenFields = [
    { name: w('頂いた朱印', '結んでくれた人'), value: received },
    { name: w('最近の朱印', '最近結んでくれた人'), value: recent },
    { name: w('押した朱印', '結んだ人'), value: `${data.givenCount} 人`, inline: true },
  ];
  // 🧵 結びのコレクションは結びの機能なので、④（新制度のご縁の時代）が始まるまで出さない
  const collectionField = profile.self && collection && isMusubiMode()
    ? { name: '🧵 結びのコレクション', value: `${collection.met} / ${collection.total} 人${collection.met < collection.total ? '（下の「まだ結んでいない人」から結べます）' : '（コンプリート！）'}`, inline: true }
    : undefined;
  const embed = new EmbedBuilder().setColor(SHU);
  if (owner.avatarUrl) embed.setThumbnail(owner.avatarUrl);

  // ── 絵馬での昇格が OFF のあいだは、今までどおり1枚のカード ──
  if (!promoteMode) {
    let nextText = '';
    if (auto?.key === 'sanpaisha') nextText = '（氏子の条件：ご縁40＋縁側20時間）';
    else if (auto && next) nextText = `（${next.rank.name}まで あと ${next.remaining}）`;
    embed.setTitle(w(`📕 ${owner.displayName} さまのプロフィール`, `📕 ${owner.displayName} さまのご縁帳`)).setDescription(`${rankLabel(rank)} ・ ご縁 **${data.goen}**${nextText}`);
    if (about.length) embed.addFields(about);
    embed.addFields(introField, ...goenFields);
    if (collectionField) embed.addFields(collectionField);
    // 🎐 絵馬（新制度）は③が ON になるまで見せない（本人の決定 2026-11-26）
    if (coins) embed.addFields({ name: coins.name, value: `${coins.emoji} ${coins.balance}`, inline: true });
    if (profile.tickets) embed.addFields({ name: '🎟 券', value: profile.tickets });
    if (profile.bannerUrl) embed.setImage(profile.bannerUrl);
    const buttons = [
      ...(profile.self ? [] : [giveButton(owner.id)]),
      ...(profile.self && isMusubiMode() ? [unmetButton(owner.id)] : []),
      listButton(owner.id),
    ];
    return { embeds: [embed.toJSON()], components: [row(...buttons)] };
  }

  // ── /ご縁帳：ご縁のことだけ ──
  if (mode === 'goen') {
    const perk = view.perkNext ? `\n次の節目：ご縁 ${view.perkNext.goen}（${view.perkNext.label}）まで あと **${Math.max(0, view.perkNext.goen - data.goen)}**` : '';
    embed.setTitle(w(`📕 ${owner.displayName} さまの御朱印帳`, `📕 ${owner.displayName} さまのご縁帳`)).setDescription(`ご縁 **${data.goen}**（結ぶとたまる・節目でごほうび。役職には使いません）${perk}`);
    embed.addFields(...goenFields);
    if (collectionField) embed.addFields(collectionField);
    const buttons = [
      ...(profile.self ? (isMusubiMode() ? [unmetButton(owner.id)] : []) : [giveButton(owner.id)]),
      listButton(owner.id),
    ];
    return { embeds: [embed.toJSON()], components: [row(...buttons)] };
  }

  // ── プロフィール：まとめ ──
  embed.setTitle(`📕 ${owner.displayName} さまのプロフィール`).setDescription(`${rankLabel(rank)} ・ ご縁 **${data.goen}**${emaRelevant && ema ? ` ・ 絵馬 **${ema.count}** 枚` : ''}`);
  if (about.length) embed.addFields(about);
  if (ema) {
    const nextLines = nextRankLines(ranks, ema);
    if (nextLines.length) embed.addFields({ name: '⬆️ 次の役職', value: nextLines.join('\n').slice(0, 1024) });
    if (ema.voter && ema.th && SEWAYAKU_VOTER_KEYS_VIEW.includes(rank?.key ?? '')) embed.addFields({ name: '🗳 世話役の選挙の投票権', value: voterLine(ema.voter, ema.th) });
  }
  embed.addFields(introField);
  if (coins) embed.addFields({ name: coins.name, value: `${coins.emoji} ${coins.balance}`, inline: true });
  if (profile.tickets) embed.addFields({ name: '🎟 券', value: profile.tickets });
  if (profile.bannerUrl) embed.setImage(profile.bannerUrl);
  const buttons = [
    ...(profile.self ? [] : [giveButton(owner.id)]),
    ...(profile.self || !emaRelevant ? [] : [emaGiveButton(owner.id)]),
    goenCardButton(owner.id),
    emaCardButton(owner.id),
  ];
  return { embeds: [embed.toJSON()], components: [row(...buttons)] };
}

/** /絵馬：絵馬のことだけ（頂いた絵馬・匿名の一言・絵馬で上がる段の条件） */
function emaCardReply(
  ranks: readonly Rank[],
  owner: { id: string; displayName: string; avatarUrl?: string },
  rank: Rank | undefined,
  emaRelevant: boolean,
  profile: ProfileExtra,
  ema: Parameters<typeof goshuinchoReply>[5],
): Reply {
  const embed = new EmbedBuilder().setColor(SHU).setTitle(`🎐 ${owner.displayName} さまの絵馬`).setDescription(rankLabel(rank));
  if (owner.avatarUrl) embed.setThumbnail(owner.avatarUrl);
  if (!emaRelevant || !ema) {
    embed.addFields({ name: '🎐 絵馬', value: '絵馬（評価の票）は、参拝者・氏子・世話役の方に贈られます。' });
    return { embeds: [embed.toJSON()] };
  }
  embed.addFields({ name: `🎐 頂いた絵馬${ema.tierLabel ? `（${ema.tierLabel}）` : ''}`, value: emaField(ema) });
  if (ema.promoteMode) {
    if (rank?.key === 'ujiko') {
      const keep = ema.th?.ujikoKeep ?? 0;
      embed.addFields({ name: '⬆️ 絵馬と役職', value: [`氏子の票は、氏子でいるための目安です${keep ? `（${keep} 枚あると安心）` : ''}。`, '世話役は絵馬ではなく **選挙** で決まります（#世話役選挙・/世話役の投票）。'].join('\n') });
    } else {
      const lines = nextRankLines(ranks, ema);
      if (lines.length) embed.addFields({ name: '⬆️ 絵馬で次の役職へ', value: lines.join('\n').slice(0, 1024) });
    }
  }
  const buttons = profile.self ? [] : [emaGiveButton(owner.id)];
  return { embeds: [embed.toJSON()], ...(buttons.length ? { components: [row(...buttons)] } : {}) };
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
export function promotionAnnouncement(userId: string, promotion: Promotion, goen: number, roleIds: readonly string[], avatarUrl?: string, emaCount?: number, vote?: { votes: number; voters: number }): MessageCreateOptions {
  const ema = emaCount !== undefined;
  const embed = new EmbedBuilder()
    .setColor(SAKURA)
    .setTitle('🌸 ご昇格おめでとうございます')
    .setDescription(vote
      ? `${mention(userId)} さまに、みなさまの「お世話役になってほしい」が集まり、**${rankLabel(promotion.to)}** になられました。`
      : ema
        ? `${mention(userId)} さまに絵馬（評価の票）が集まり、**${rankLabel(promotion.to)}** になられました。`
        : `${mention(userId)} さまのご縁が花ひらき、**${rankLabel(promotion.to)}** になられました。`)
    .addFields(
      { name: '新しい位', value: rankLabel(promotion.to), inline: true },
      vote
        ? { name: '投票', value: `${vote.voters} 人中 ${vote.votes} 票`, inline: true }
        : ema ? { name: '絵馬', value: `${emaCount} 枚`, inline: true } : { name: 'ご縁', value: String(goen), inline: true },
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

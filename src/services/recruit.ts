import { and, desc, eq, gte } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { recruitPosts } from '../db/schema.js';

/**
 * 募集: チャンネルのいちばん下に「募集する」ボタンを置く。
 * 押した人が一言を書くと、BOT が募集カードを出して、役職のある人みんなに知らせる（そのチャンネルを見られる人だけに届く）。
 */

export type RecruitPanel = GuildConfig['recruit']['panels'][number];

const SHU = 0xd7003a;

/** いちばん下に置くボタン */
export function recruitPanelMessage(p: RecruitPanel) {
  return {
    embeds: [
      {
        description: `${p.emoji} **${p.label}の募集**は下のボタンから。一言を書くと、役職のある人みんなに通知が届きます。`,
        color: SHU,
      },
    ],
    components: [
      {
        type: 1,
        components: [{ type: 2, style: 1, label: `${p.label}を募集する`, custom_id: 'recruit:open', ...(p.emoji ? { emoji: { name: p.emoji } } : {}) }],
      },
    ],
  };
}

export type RecruitDecision =
  | { status: 'ok'; panel: RecruitPanel }
  | { status: 'unknown' }
  | { status: 'adult_only' }
  | { status: 'not_member' }
  | { status: 'yakudoshi' }
  | { status: 'too_new'; days: number }
  | { status: 'cooldown'; seconds: number }
  | { status: 'channel_cooldown'; seconds: number };

/** 待ち時間（秒）。秒で決めていればそれ、なければ分から */
export function recruitWaits(r: GuildConfig['recruit']): { mine: number; channel: number } {
  return { mine: r.cooldownSeconds ?? r.cooldownMinutes * 60, channel: r.channelCooldownSeconds ?? r.channelCooldownMinutes * 60 };
}

/** 「あと 15 秒」「あと 3 分」 */
export function waitText(seconds: number): string {
  return seconds < 60 ? `${seconds} 秒` : `${Math.ceil(seconds / 60)} 分`;
}

export type RecruitMember = {
  roleIds: readonly string[];
  /** サーバーに入った日時（分からなければ undefined） */
  joinedAt?: number;
  /** その人がこの前募集した日時・このチャンネルでこの前だれかが募集した日時 */
  lastAt?: number;
  channelLastAt?: number;
};

/**
 * 募集できるか。
 * 宵宮は宵参りの人だけ／役職（参拝者以上）のある人だけ／厄年の人はだめ／入ってすぐはだめ（決めた日数）／
 * 同じ人は決めた秒数に 1 回／同じチャンネルはだれが押しても決めた秒数に 1 回（recruitWaits）
 */
export function decideRecruit(cfg: GuildConfig, channelId: string, m: RecruitMember, now: number): RecruitDecision {
  const r = cfg.recruit;
  const panel = r.panels.find((p) => p.channelId === channelId);
  if (!panel) return { status: 'unknown' };
  const has = (id: string | undefined) => Boolean(id && m.roleIds.includes(id));
  const staff = cfg.ranks.some((x) => !x.auto && has(x.roleId));
  if (panel.adultOnly && !has(cfg.roles.yoimairi)) return { status: 'adult_only' };
  if (r.requireRank && !cfg.ranks.some((x) => has(x.roleId))) return { status: 'not_member' };
  if (r.blockYakudoshi && has(cfg.roles.yakudoshi)) return { status: 'yakudoshi' };
  if (!staff && r.newMemberDays > 0 && m.joinedAt !== undefined) {
    const left = m.joinedAt + r.newMemberDays * 86_400_000 - now;
    if (left > 0) return { status: 'too_new', days: Math.ceil(left / 86_400_000) };
  }
  const waits = recruitWaits(r);
  const wait = (last: number | undefined, seconds: number) => (last === undefined ? 0 : last + seconds * 1000 - now);
  const mine = wait(m.lastAt, waits.mine);
  if (mine > 0) return { status: 'cooldown', seconds: Math.ceil(mine / 1000) };
  const ch = wait(m.channelLastAt, waits.channel);
  if (ch > 0) return { status: 'channel_cooldown', seconds: Math.ceil(ch / 1000) };
  return { status: 'ok', panel };
}

/** この前の募集（その人・そのチャンネル）。2 時間より前は見ない */
export async function lastRecruits(db: Db, memberId: string, channelId: string, now: number): Promise<{ lastAt?: number; channelLastAt?: number }> {
  const since = new Date(now - 2 * 3_600_000);
  const last = async (where: ReturnType<typeof eq>) => {
    const [row] = await db
      .select({ at: recruitPosts.createdAt })
      .from(recruitPosts)
      .where(and(where, gte(recruitPosts.createdAt, since)))
      .orderBy(desc(recruitPosts.createdAt))
      .limit(1);
    return row?.at.getTime();
  };
  const [lastAt, channelLastAt] = await Promise.all([last(eq(recruitPosts.memberId, memberId)), last(eq(recruitPosts.channelId, channelId))]);
  return { ...(lastAt !== undefined ? { lastAt } : {}), ...(channelLastAt !== undefined ? { channelLastAt } : {}) };
}

export async function recordRecruit(db: Db, memberId: string, channelId: string, at = new Date()): Promise<void> {
  await db.insert(recruitPosts).values({ memberId, channelId, createdAt: at });
}

/** 募集の通知先: 役職のロール全部（Discord は、そのチャンネルを見られる人にだけ知らせる） */
export function recruitMentionRoleIds(cfg: GuildConfig): string[] {
  return [...new Set(cfg.ranks.map((r) => r.roleId))];
}

/** 募集カード（mention: 知らせるロール。通話にいれば、その通話へのボタンを付ける） */
/** avatarUrl: 募集した人のアイコン（サーバーのアイコンがあればそれ）。カードの右上と名前の横に出す */
export function recruitCard(input: { guildId: string; panel: RecruitPanel; mention: string[]; userId: string; name: string; message: string; voiceChannelId?: string | null; avatarUrl?: string }) {
  const { panel, mention } = input;
  const where = input.voiceChannelId
    ? `📞 <#${input.voiceChannelId}> にいます。下のボタンから入れます`
    : panel.hubId
      ? `📞 まだ通話にいません。<#${panel.hubId}> に入ると部屋ができます`
      : '📞 まだ通話にいません';
  const message = input.message.trim();
  return {
    content: mention.map((id) => `<@&${id}>`).join(' '),
    embeds: [
      {
        ...(input.avatarUrl ? { author: { name: `${input.name} さん`, icon_url: input.avatarUrl }, thumbnail: { url: input.avatarUrl } } : {}),
        title: `${panel.emoji} ${panel.label}の募集`.trim(),
        description: [`<@${input.userId}> さんが募集しています`, ...(message ? [`> ${message.replace(/\n+/g, ' ')}`] : []), '', where].join('\n'),
        color: SHU,
      },
    ],
    components: input.voiceChannelId
      ? [
          {
            type: 1,
            components: [
              { type: 2, style: 5, label: '通話に入る', url: `https://discord.com/channels/${input.guildId}/${input.voiceChannelId}` },
            ],
          },
        ]
      : [],
    // 役職のロールにだけ通知（募集した人の @ や @everyone は鳴らさない）
    allowedMentions: { roles: mention, users: [] as string[] },
  };
}

/**
 * 待ち時間中に何度も押す人を数える（決めた回数で 1 回だけ知らせる）。
 * 知らせたら true。待ち時間が終わったら数え直す
 */
export class RecruitSpamCounter {
  private counts = new Map<string, { count: number; until: number; alerted: boolean }>();
  hit(userId: string, now: number, waitMinutes: number, threshold: number): boolean {
    if (threshold <= 0) return false;
    const cur = this.counts.get(userId);
    const c = cur && cur.until > now ? cur : { count: 0, until: now + waitMinutes * 60_000, alerted: false };
    c.count++;
    this.counts.set(userId, c);
    if (c.count >= threshold && !c.alerted) {
      c.alerted = true;
      return true;
    }
    return false;
  }
}

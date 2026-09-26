import type { GuildConfig } from '../config.js';

/**
 * 募集: チャンネルのいちばん下に「募集する」ボタンを置く。
 * 押した人が一言を書くと、BOT が募集カードを出して、そのお守りを持っている人に知らせる。
 */

export type RecruitPanel = GuildConfig['recruit']['panels'][number];

const SHU = 0xd7003a;

/** いちばん下に置くボタン */
export function recruitPanelMessage(p: RecruitPanel) {
  return {
    embeds: [
      {
        description: `${p.emoji} **${p.label}の募集**は下のボタンから。一言を書くと、${p.label}のお守りを持っている人に通知が届きます。`,
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
  | { status: 'cooldown'; minutes: number };

/** 募集できるか（宵宮は宵参りの人だけ。同じ人は cooldownMinutes に 1 回） */
export function decideRecruit(cfg: GuildConfig, channelId: string, memberRoleIds: readonly string[], lastAt: number | undefined, now: number): RecruitDecision {
  const panel = cfg.recruit.panels.find((p) => p.channelId === channelId);
  if (!panel) return { status: 'unknown' };
  if (panel.adultOnly && !(cfg.roles.yoimairi && memberRoleIds.includes(cfg.roles.yoimairi))) return { status: 'adult_only' };
  const wait = lastAt === undefined ? 0 : lastAt + cfg.recruit.cooldownMinutes * 60_000 - now;
  if (wait > 0) return { status: 'cooldown', minutes: Math.ceil(wait / 60_000) };
  return { status: 'ok', panel };
}

/** 募集カード（お守りのロールに通知。通話にいれば、その通話へのボタンを付ける） */
export function recruitCard(input: { guildId: string; panel: RecruitPanel; userId: string; name: string; message: string; voiceChannelId?: string | null }) {
  const { panel } = input;
  const where = input.voiceChannelId
    ? `📞 <#${input.voiceChannelId}> にいます。下のボタンから入れます`
    : panel.hubId
      ? `📞 まだ通話にいません。<#${panel.hubId}> に入ると部屋ができます`
      : '📞 まだ通話にいません';
  const message = input.message.trim();
  return {
    content: panel.roleId ? `<@&${panel.roleId}>` : '',
    embeds: [
      {
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
    // お守りの人にだけ通知（募集した人の @ や @everyone は鳴らさない）
    allowedMentions: { roles: panel.roleId ? [panel.roleId] : [], users: [] as string[] },
  };
}

/** 同じ人の連続した募集を止める（BOT を起動し直すと忘れる） */
export class RecruitCooldown {
  private last = new Map<string, number>();
  lastAt(userId: string): number | undefined {
    return this.last.get(userId);
  }
  mark(userId: string, at: number): void {
    this.last.set(userId, at);
  }
}

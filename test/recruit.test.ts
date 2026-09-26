import { describe, expect, it } from 'vitest';
import { parseGuildConfig, type GuildConfig } from '../src/config.js';
import { decideRecruit, RecruitCooldown, recruitCard, recruitPanelMessage } from '../src/services/recruit.js';
import { cfg as base } from './helpers.js';

const NEOCHI_CH = '950000000000000001';
const YOI_CH = '950000000000000002';
const NEOCHI_ROLE = '950000000000000011';
const YOI_ROLE = '950000000000000012';
const HUB = '950000000000000021';
const YOIMAIRI = '950000000000000031';
const GUILD = base.guildId;

const cfg: GuildConfig = parseGuildConfig({
  ...base,
  roles: { ...base.roles, yoimairi: YOIMAIRI },
  recruit: {
    panels: [
      { channelId: NEOCHI_CH, label: '寝落ち', emoji: '🌙', roleId: NEOCHI_ROLE, hubId: HUB },
      { channelId: YOI_CH, label: '宵宮', emoji: '🔞', roleId: YOI_ROLE, adultOnly: true },
    ],
  },
});
const now = Date.parse('2026-09-27T12:00:00Z');

describe('募集', () => {
  it('ボタンのあるチャンネルでだけ募集できる。宵宮は宵参りの人だけ', () => {
    expect(decideRecruit(cfg, NEOCHI_CH, [], undefined, now).status).toBe('ok');
    expect(decideRecruit(cfg, '950000000000000099', [], undefined, now)).toEqual({ status: 'unknown' });
    expect(decideRecruit(cfg, YOI_CH, [], undefined, now)).toEqual({ status: 'adult_only' });
    expect(decideRecruit(cfg, YOI_CH, [YOIMAIRI], undefined, now).status).toBe('ok');
  });

  it('同じ人は 10 分に 1 回', () => {
    const cd = new RecruitCooldown();
    cd.mark('A', now);
    expect(decideRecruit(cfg, NEOCHI_CH, [], cd.lastAt('A'), now + 60_000)).toEqual({ status: 'cooldown', minutes: 9 });
    expect(decideRecruit(cfg, NEOCHI_CH, [], cd.lastAt('A'), now + 10 * 60_000).status).toBe('ok');
    expect(decideRecruit(cfg, NEOCHI_CH, [], cd.lastAt('B'), now).status).toBe('ok');
  });

  it('カード: お守りのロールにだけ通知。通話にいれば「通話に入る」ボタン', () => {
    const panel = cfg.recruit.panels[0]!;
    const inVoice = recruitCard({ guildId: GUILD, panel, userId: 'U1', name: 'さくら', message: '23 時から\n寝落ちしよ', voiceChannelId: '950000000000000041' });
    expect(inVoice.content).toBe(`<@&${NEOCHI_ROLE}>`);
    expect(inVoice.allowedMentions).toEqual({ roles: [NEOCHI_ROLE], users: [] });
    expect(inVoice.embeds[0]!.title).toBe('🌙 寝落ちの募集');
    expect(inVoice.embeds[0]!.description).toContain('> 23 時から 寝落ちしよ');
    expect(inVoice.embeds[0]!.description).toContain('<#950000000000000041> にいます');
    expect(inVoice.components[0]!.components[0]!.url).toBe(`https://discord.com/channels/${GUILD}/950000000000000041`);

    const noVoice = recruitCard({ guildId: GUILD, panel, userId: 'U1', name: 'さくら', message: '', voiceChannelId: null });
    expect(noVoice.embeds[0]!.description).toContain(`<#${HUB}> に入ると部屋ができます`);
    expect(noVoice.embeds[0]!.description).not.toContain('>  ');
    expect(noVoice.components).toEqual([]);
  });

  it('ボタンのパネル', () => {
    const p = recruitPanelMessage(cfg.recruit.panels[0]!);
    expect(p.components[0]!.components[0]).toMatchObject({ label: '寝落ちを募集する', custom_id: 'recruit:open' });
  });
});

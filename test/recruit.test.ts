import { describe, expect, it } from 'vitest';
import { parseGuildConfig, type GuildConfig } from '../src/config.js';
import {
  decideRecruit,
  lastRecruits,
  recordRecruit,
  recruitCard,
  recruitMentionRoleIds,
  recruitPanelMessage,
  RecruitSpamCounter,
} from '../src/services/recruit.js';
import { applyOverrides, overridesSchema } from '../src/services/settings.js';
import { cfg as base, makeDb, ROLE } from './helpers.js';

const NEOCHI_CH = '950000000000000001';
const YOI_CH = '950000000000000002';
const HUB = '950000000000000021';
const YOIMAIRI = '950000000000000031';
const YAKU = '950000000000000032';
const GUILD = base.guildId;
/** 参拝者（役職あり） */
const M = (...extra: string[]) => ({ roleIds: [ROLE.sanpaisha, ...extra] });

const cfg: GuildConfig = parseGuildConfig({
  ...base,
  roles: { ...base.roles, yoimairi: YOIMAIRI, yakudoshi: YAKU },
  recruit: {
    panels: [
      { channelId: NEOCHI_CH, label: '寝落ち', emoji: '🌙', hubId: HUB },
      { channelId: YOI_CH, label: '宵宮', emoji: '🔞', adultOnly: true },
    ],
  },
});
const now = Date.parse('2026-09-27T12:00:00Z');

describe('募集', () => {
  it('ボタンのあるチャンネルでだけ募集できる。宵宮は宵参りの人だけ', () => {
    expect(decideRecruit(cfg, NEOCHI_CH, M(), now).status).toBe('ok');
    expect(decideRecruit(cfg, '950000000000000099', M(), now)).toEqual({ status: 'unknown' });
    expect(decideRecruit(cfg, YOI_CH, M(), now)).toEqual({ status: 'adult_only' });
    expect(decideRecruit(cfg, YOI_CH, M(YOIMAIRI), now).status).toBe('ok');
  });

  it('同じ人は 10 分に 1 回・同じチャンネルはだれが押しても 5 分に 1 回', () => {
    expect(decideRecruit(cfg, NEOCHI_CH, { ...M(), lastAt: now }, now + 60_000)).toEqual({ status: 'cooldown', seconds: 540 });
    expect(decideRecruit(cfg, NEOCHI_CH, { ...M(), lastAt: now }, now + 10 * 60_000).status).toBe('ok');
    expect(decideRecruit(cfg, NEOCHI_CH, { ...M(), channelLastAt: now }, now + 60_000)).toEqual({ status: 'channel_cooldown', seconds: 240 });
    expect(decideRecruit(cfg, NEOCHI_CH, { ...M(), channelLastAt: now }, now + 5 * 60_000).status).toBe('ok');
  });

  it('秒で決めたら秒（15 秒など）。分より優先', async () => {
    const { waitText } = await import('../src/services/recruit.js');
    const c = { ...cfg, recruit: { ...cfg.recruit, cooldownSeconds: 15, channelCooldownSeconds: 15 } };
    expect(decideRecruit(c, NEOCHI_CH, { ...M(), lastAt: now }, now + 5_000)).toEqual({ status: 'cooldown', seconds: 10 });
    expect(decideRecruit(c, NEOCHI_CH, { ...M(), lastAt: now, channelLastAt: now }, now + 15_000).status).toBe('ok');
    expect(waitText(10)).toBe('10 秒');
    expect(waitText(61)).toBe('2 分');
  });

  it('役職のない人（承認前）・厄年の人・入ってすぐの人は募集できない（運営はいつでも）', () => {
    expect(decideRecruit(cfg, NEOCHI_CH, { roleIds: [] }, now)).toEqual({ status: 'not_member' });
    expect(decideRecruit(cfg, NEOCHI_CH, M(YAKU), now)).toEqual({ status: 'yakudoshi' });
    const strict = { ...cfg, recruit: { ...cfg.recruit, newMemberDays: 3 } };
    expect(decideRecruit(strict, NEOCHI_CH, { ...M(), joinedAt: now - 86_400_000 }, now)).toEqual({ status: 'too_new', days: 2 });
    expect(decideRecruit(strict, NEOCHI_CH, { ...M(), joinedAt: now - 4 * 86_400_000 }, now).status).toBe('ok');
    expect(decideRecruit(strict, NEOCHI_CH, { roleIds: [ROLE.shinshoku], joinedAt: now }, now).status).toBe('ok');
    const loose = { ...cfg, recruit: { ...cfg.recruit, requireRank: false, blockYakudoshi: false } };
    expect(decideRecruit(loose, NEOCHI_CH, { roleIds: [YAKU] }, now).status).toBe('ok');
  });

  it('募集の記録は DB に残る（BOT を起動し直しても待ち時間を忘れない）', async () => {
    const { db, close } = await makeDb();
    try {
      await recordRecruit(db, 'A', NEOCHI_CH, new Date(now));
      expect(await lastRecruits(db, 'A', NEOCHI_CH, now + 60_000)).toEqual({ lastAt: now, channelLastAt: now });
      expect(await lastRecruits(db, 'B', NEOCHI_CH, now + 60_000)).toEqual({ channelLastAt: now });
      expect(await lastRecruits(db, 'A', YOI_CH, now + 60_000)).toEqual({ lastAt: now });
      // 2 時間より前は見ない
      expect(await lastRecruits(db, 'A', NEOCHI_CH, now + 3 * 3_600_000)).toEqual({});
    } finally {
      await close();
    }
  });

  it('待ち時間中に決めた回数押したら 1 回だけ知らせる', () => {
    const c = new RecruitSpamCounter();
    expect([1, 2, 3, 4].map((k) => c.hit('A', now + k * 1000, 5, 3))).toEqual([false, false, true, false]);
    // 待ち時間が終われば数え直す
    expect(c.hit('A', now + 10 * 60_000, 5, 3)).toBe(false);
    expect(new RecruitSpamCounter().hit('A', now, 5, 0)).toBe(false);
  });

  it('通知先は役職のロール全部', () => {
    expect(recruitMentionRoleIds(cfg)).toEqual(cfg.ranks.map((r) => r.roleId));
  });

  it('管理画面の設定で変えられる（募集ボタンの置き場所はファイルのまま）', () => {
    const c = applyOverrides(cfg, overridesSchema.parse({ recruit: { cooldownMinutes: 30 } }));
    expect(c.recruit).toMatchObject({ cooldownMinutes: 30, channelCooldownMinutes: 5 });
    expect(c.recruit.panels).toHaveLength(2);
  });

  it('カード: 役職のロールにだけ通知。通話にいれば「通話に入る」ボタン', () => {
    const panel = cfg.recruit.panels[0]!;
    const mention = recruitMentionRoleIds(cfg);
    const inVoice = recruitCard({ guildId: GUILD, panel, mention, userId: 'U1', name: 'さくら', message: '23 時から\n寝落ちしよ', voiceChannelId: '950000000000000041' });
    expect(inVoice.content).toBe(mention.map((id) => `<@&${id}>`).join(' '));
    expect(inVoice.allowedMentions).toEqual({ roles: mention, users: [] });
    expect(inVoice.embeds[0]!.title).toBe('🌙 寝落ちの募集');
    expect(inVoice.embeds[0]!.description).toContain('> 23 時から 寝落ちしよ');
    expect(inVoice.embeds[0]!.description).toContain('<#950000000000000041> にいます');
    expect(inVoice.components[0]!.components[0]!.url).toBe(`https://discord.com/channels/${GUILD}/950000000000000041`);

    const noVoice = recruitCard({ guildId: GUILD, panel, mention, userId: 'U1', name: 'さくら', message: '', voiceChannelId: null });
    expect(noVoice.embeds[0]!.description).toContain(`<#${HUB}> に入ると部屋ができます`);
    expect(noVoice.embeds[0]!.description).not.toContain('>  ');
    expect(noVoice.components).toEqual([]);
    expect(noVoice.embeds[0]).not.toHaveProperty('thumbnail');
  });

  it('カード: 募集した人のアイコンを右上と名前の横に出す', () => {
    const icon = 'https://cdn.discordapp.com/avatars/U1/abc.png?size=256';
    const card = recruitCard({ guildId: GUILD, panel: cfg.recruit.panels[0]!, mention: [], userId: 'U1', name: 'さくら', message: '', avatarUrl: icon });
    expect(card.embeds[0]).toMatchObject({ author: { name: 'さくら さん', icon_url: icon }, thumbnail: { url: icon } });
  });

  it('ボタンのパネル', () => {
    const p = recruitPanelMessage(cfg.recruit.panels[0]!);
    expect(p.components[0]!.components[0]).toMatchObject({ label: '寝落ちを募集する', custom_id: 'recruit:open' });
  });
});

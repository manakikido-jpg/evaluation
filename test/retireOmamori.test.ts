import { describe, expect, it } from 'vitest';
import type { GuildConfig } from '../src/config.js';
import { isOmamoriPanel, omamoriRolesToDelete } from '../src/discord/retireOmamori.js';
import { cfg as base, ROLE } from './helpers.js';

const OLD = '100000000000000301';
const NAMED = '100000000000000302';
const OTHER = '100000000000000303';

describe('🧧 お守りの片付け', () => {
  it('消すのは設定に残っているお守りと、前の版の名前のロール。役職・連携・@everyone は消さない', () => {
    const cfg: GuildConfig = { ...base, roles: { ...base.roles, omamori: [{ roleId: OLD, label: '寝落ち', emoji: '🌙', description: '', adultOnly: false }] } };
    const roles = [
      { id: OLD, name: '🌙 寝落ちのお守り', managed: false },
      { id: NAMED, name: '🎮 ゲームのお守り', managed: false },
      { id: OTHER, name: '🐉 十二支のお守り', managed: false },
      { id: '100000000000000304', name: '🔞 宵宮のお守り', managed: true },
      { id: ROLE.sanpaisha, name: '🍵 雑談のお守り', managed: false },
      { id: cfg.guildId, name: '@everyone', managed: false },
    ];
    expect(omamoriRolesToDelete(cfg, roles)).toEqual([OLD, NAMED]);
  });

  it('お守りのボタンが付いた書き込みだけ', () => {
    expect(isOmamoriPanel([{ components: [{ custom_id: 'omamori:123' }] }])).toBe(true);
    expect(isOmamoriPanel([{ components: [{ custom_id: 'shop:open' }] }, {}])).toBe(false);
  });
});

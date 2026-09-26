import { describe, expect, it } from 'vitest';
import { parseGuildConfig, type GuildConfig } from '../src/config.js';
import { decideOmamori } from '../src/discord/omamori.js';
import { panelMessage } from '../src/discord/panels.js';
import { cfg as base } from './helpers.js';

const NEOCHI = '940000000000000001';
const YOIMIYA = '940000000000000002';
const YOIMAIRI = '940000000000000003';
const cfg: GuildConfig = parseGuildConfig({
  ...base,
  roles: {
    ...base.roles,
    yoimairi: YOIMAIRI,
    omamori: [
      { roleId: NEOCHI, label: '寝落ち', emoji: '🌙', description: '寝落ち通話の募集' },
      { roleId: YOIMIYA, label: '宵宮', emoji: '🔞', description: '宵宮の募集', adultOnly: true },
    ],
  },
});

describe('お守り', () => {
  it('持っていなければ授かり、持っていれば返す', () => {
    expect(decideOmamori(cfg, NEOCHI, [])).toEqual({ status: 'added', label: '🌙 寝落ちのお守り' });
    expect(decideOmamori(cfg, NEOCHI, [NEOCHI])).toEqual({ status: 'removed', label: '🌙 寝落ちのお守り' });
  });

  it('宵宮のお守りは宵参りの人だけ。返すのは誰でもできる', () => {
    expect(decideOmamori(cfg, YOIMIYA, [])).toEqual({ status: 'adult_only' });
    expect(decideOmamori(cfg, YOIMIYA, [YOIMAIRI]).status).toBe('added');
    expect(decideOmamori(cfg, YOIMIYA, [YOIMIYA]).status).toBe('removed');
  });

  it('設定にないロールのボタン（古いパネルなど）は何もしない', () => {
    expect(decideOmamori(cfg, '940000000000000999', [])).toEqual({ status: 'unknown' });
  });

  it('パネル: お守りごとのボタンと説明', () => {
    const p = panelMessage('omamori', { omamori: cfg.roles.omamori });
    expect(p.components[0]!.components.map((b) => [b.label, b.custom_id])).toEqual([
      ['寝落ちのお守り', `omamori:${NEOCHI}`],
      ['宵宮のお守り', `omamori:${YOIMIYA}`],
    ]);
    expect(p.embeds[0]!.description).toContain('🔞 **宵宮のお守り** … 宵宮の募集');
  });
});

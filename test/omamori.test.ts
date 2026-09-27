import { describe, expect, it } from 'vitest';
import { parseGuildConfig, type GuildConfig } from '../src/config.js';
import { decideOmamori, myOmamoriPanel, OmamoriApp } from '../src/discord/omamori.js';
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
    expect(p.components.at(-1)!.components[0]).toMatchObject({ label: '自分のお守りを見る', custom_id: 'omamori:mine' });
  });

  it('あなたのお守り: 授かっているものは ✅ と緑のボタン。宵参りでなければ宵宮は押せない', () => {
    const p = myOmamoriPanel(cfg, [NEOCHI], '🧧 授かりました');
    expect(p.embeds[0]!.description).toContain('🧧 授かりました');
    expect(p.embeds[0]!.description).toContain('✅ 🌙 **寝落ちのお守り**');
    expect(p.embeds[0]!.description).toContain('⬜ 🔞 **宵宮のお守り**');
    const [neochi, yoimiya] = p.components[0]!.components;
    expect(neochi).toMatchObject({ style: 3, label: '寝落ち（授かっている）', custom_id: `omamori:me:${NEOCHI}` });
    expect(yoimiya).toMatchObject({ style: 2, disabled: true });
    expect(myOmamoriPanel(cfg, [YOIMAIRI]).components[0]!.components[1]).not.toHaveProperty('disabled');
  });

  it('ボタンを押すと、付け外しして「あなたのお守り」を出す（中のボタンはその場で書き換える）', async () => {
    const app = new OmamoriApp(() => cfg);
    const roles = new Map<string, unknown>();
    const edits: { embeds: { description: string }[] }[] = [];
    const calls: string[] = [];
    const button = (customId: string) => ({
      customId,
      guildId: cfg.guildId,
      isButton: () => true,
      inCachedGuild: () => true,
      deferred: false,
      replied: false,
      member: {
        roles: {
          cache: roles,
          add: async (id: string) => void (roles.set(id, {}), calls.push(`add ${id}`)),
          remove: async (id: string) => void (roles.delete(id), calls.push(`remove ${id}`)),
        },
      },
      deferReply: async () => void calls.push('deferReply'),
      deferUpdate: async () => void calls.push('deferUpdate'),
      editReply: async (p: { embeds: { description: string }[] }) => void edits.push(p),
      reply: async (p: { embeds: { description: string }[] }) => void edits.push(p),
    });
    await app.onInteraction(button(`omamori:${NEOCHI}`) as never);
    expect(calls).toEqual(['deferReply', `add ${NEOCHI}`]);
    expect(edits.at(-1)!.embeds[0]!.description).toContain('✅ 🌙 **寝落ちのお守り**');
    await app.onInteraction(button(`omamori:me:${NEOCHI}`) as never);
    expect(calls.slice(2)).toEqual(['deferUpdate', `remove ${NEOCHI}`]);
    expect(edits.at(-1)!.embeds[0]!.description).toContain('↩️ **🌙 寝落ちのお守り**を返しました');
    expect(edits.at(-1)!.embeds[0]!.description).toContain('⬜ 🌙 **寝落ちのお守り**');
    await app.onInteraction(button('omamori:mine') as never);
    expect(edits.at(-1)!.embeds[0]!.description).toContain('授かっているお守り: 0 個');
  });
});

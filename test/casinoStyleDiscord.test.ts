import { Collection, ChannelType, MessageFlags, type Interaction, type Guild } from 'discord.js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Db } from '../src/db/client.js';
import { GachaApp } from '../src/discord/gacha.js';
import { panelMessage } from '../src/discord/panels.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { cfg, makeDb, ROLE } from './helpers.js';
let db: Db, close: () => Promise<void>;
const A = '760000000000000001';
beforeEach(async () => {
  ({ db, close } = await makeDb());
  await addCoins(db, A, 10000, 'adjust');
});
afterEach(async () => close());
const interaction = (customId: string, roles: string[] = [ROLE.sanpaisha]) => ({
  id: 'interaction-id',
  message: { id: 'menu-id' },
  customId,
  guildId: cfg.guildId,
  user: { id: A },
  member: { roles: { cache: new Map(roles.map((id) => [id, {}])) } },
  inCachedGuild: () => true,
  isButton: () => true,
  isChatInputCommand: () => false,
  deferReply: vi.fn(),
  reply: vi.fn(),
  editReply: vi.fn(),
});
it('祈願所の入口から、本人だけの中身と排出率を表示する', async () => {
  expect(JSON.stringify(panelMessage('gacha'))).toContain('casino-gacha:open');
  const app = new GachaApp(db, () => ({ ...cfg, casinoGacha: { ...cfg.casinoGacha, enabled: true } }));
  const i = interaction('casino-gacha:rates');
  await app.onInteraction(i as unknown as Interaction);
  expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
  const view = i.editReply.mock.calls[0]![0];
  expect(view.embeds[0].description).toContain('4.375％');
  expect(view.embeds[0].description).toContain('大勝負の札');
  expect(view.allowedMentions).toEqual({ parse: [] });
  expect(await walletOf(db, A)).toMatchObject({ balance: 10000 });
});
it('カジノの権限と休止を守り、Discordから景品を渡す', async () => {
  let current = { ...cfg, casinoGacha: { ...cfg.casinoGacha, enabled: true } };
  const app = new GachaApp(db, () => current);
  const denied = interaction('casino-gacha:draw:1', []);
  await app.onInteraction(denied as unknown as Interaction);
  expect(denied.reply).toHaveBeenCalled();
  expect(denied.deferReply).not.toHaveBeenCalled();
  current = { ...current, casino: { ...current.casino, enabled: false } };
  const off = interaction('casino-gacha:draw:1');
  await app.onInteraction(off as unknown as Interaction);
  expect(off.editReply.mock.calls[0]![0].content).toContain('お休み');
  expect((await walletOf(db, A)).balance).toBe(10000);
  current = { ...current, casino: { ...current.casino, enabled: true } };
  const draw = interaction('casino-gacha:draw:1');
  await app.onInteraction(draw as unknown as Interaction);
  expect(draw.editReply.mock.calls[0]![0].content).toContain('今回の景品');
  expect((await walletOf(db, A)).balance).toBe(9500);
  const again = interaction('casino-gacha:draw:1');
  await app.onInteraction(again as unknown as Interaction);
  expect(again.editReply.mock.calls[0]![0].content).toContain('追加の支払いはありません');
  expect((await walletOf(db, A)).balance).toBe(9500);
  const next = { ...interaction('casino-gacha:draw:10'), id: 'another-interaction' };
  await app.onInteraction(next as unknown as Interaction);
  expect(next.editReply.mock.calls[0]![0].content).toContain('10連引きました');
  expect((await walletOf(db, A)).balance).toBe(4500);
});

it('同じ売り場から続けて1回ずつ引けて、景品の受け取り先も表示する', async () => {
  const app = new GachaApp(db, () => ({ ...cfg, casinoGacha: { ...cfg.casinoGacha, enabled: true } }));
  for (const id of ['first-press', 'next-press']) {
    const i = { ...interaction('casino-gacha:draw:1'), id };
    await app.onInteraction(i as unknown as Interaction);
    const content = i.editReply.mock.calls[0]![0].content;
    expect(content).toContain('1回引きました');
    expect(content).toContain('景品は持ち物に入りました');
    expect(content).not.toContain('追加の支払いはありません');
  }
  expect((await walletOf(db, A)).balance).toBe(9000);
});
it('既存の祈願所パネルにも2つ目の入口を足す', async () => {
  const edit = vi.fn(async () => {});
  const panel = panelMessage('gacha');
  const msg = {
    author: { id: 'bot' },
    components: [{ toJSON: () => ({ components: [{ custom_id: 'gacha:open', label: panel.components[1]!.components[0]!.label }] }) }],
    embeds: [],
    edit,
  };
  const channel = { id: 'prayer', type: ChannelType.GuildText, name: '祈願所', messages: { fetch: async () => new Collection([['message', msg]]) } };
  const guild = { client: { user: { id: 'bot' } }, channels: { cache: new Collection([['prayer', channel]]) } };
  expect(await new GachaApp(db, () => cfg).refreshPanels(guild as unknown as Guild)).toBe(1);
  expect(JSON.stringify(edit.mock.calls[0])).toContain('casino-gacha:open');
});

it('売り場と排出率を別のボタンで開き、見るだけでは銭を使わない', async () => {
  const app = new GachaApp(db, () => ({ ...cfg, casinoGacha: { ...cfg.casinoGacha, enabled: true } }));
  for (const id of ['casino-gacha:open', 'casino-gacha:rates']) {
    const i = interaction(id);
    await app.onInteraction(i as unknown as Interaction);
    const view = i.editReply.mock.calls[0]![0];
    if (id.endsWith(':open')) {
      expect(view.embeds[0].title).toContain('売り場');
      expect(JSON.stringify(view.components)).toContain('casino-gacha:draw:1');
      expect(JSON.stringify(view.components)).toContain('casino-gacha:rates');
    } else {
      expect(view.embeds[0].title).toContain('中身と排出率');
      expect(JSON.stringify(view.components)).not.toContain('casino-gacha:draw:');
      expect(JSON.stringify(view.components)).toContain('casino-gacha:open');
    }
  }
  expect((await walletOf(db, A)).balance).toBe(10000);
});

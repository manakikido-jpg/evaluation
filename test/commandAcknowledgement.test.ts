import { MessageFlags, type Interaction } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/db/client.js';
import { CasinoApp } from '../src/discord/casino.js';
import { PresentApp } from '../src/discord/presents.js';
import { logger } from '../src/lib/logger.js';
import { createLoginLink } from '../src/services/casino/loginLinks.js';
import { presentChoices } from '../src/services/presents.js';
import { cfg } from './helpers.js';

vi.mock('../src/services/presents.js', async (original) => ({
  ...await original<typeof import('../src/services/presents.js')>(),
  presentChoices: vi.fn(),
}));
vi.mock('../src/services/casino/loginLinks.js', async (original) => ({
  ...await original<typeof import('../src/services/casino/loginLinks.js')>(),
  createLoginLink: vi.fn(),
}));

const db = {} as Db;
const activeCfg = { ...cfg, casino: { ...cfg.casino, enabled: true } };
function interaction(commandName: string, button = false) {
  const i = {
    commandName, customId: button ? 'items:back' : '',
    guildId: cfg.guildId, user: { id: '870000000000000101' },
    member: { id: '870000000000000101', displayName: 'テスト', displayAvatarURL: () => 'https://example.test/avatar.png' },
    deferred: false, replied: false,
    inCachedGuild: () => true,
    isChatInputCommand: () => !button,
    isAutocomplete: () => false,
    isButton: () => button,
    isRepliable: () => true,
    reply: vi.fn(), update: vi.fn(),
    deferReply: vi.fn(async () => { i.deferred = true; }),
    deferUpdate: vi.fn(async () => { i.deferred = true; }),
    editReply: vi.fn(async (_body: unknown) => { i.replied = true; }),
  };
  return i;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  vi.spyOn(logger, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('DBの前にDiscordへ受付を返す', () => {
  it.each([false, true])('持ち物の遅い読み込み中も受付済みにする（戻るボタン=%s）', async (button) => {
    let finish!: (value: Awaited<ReturnType<typeof presentChoices>>) => void;
    vi.mocked(presentChoices).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const i = interaction('items', button);
    const result = new PresentApp(db, () => cfg).onInteraction(i as unknown as Interaction);
    await vi.waitFor(() => expect(presentChoices).toHaveBeenCalled());
    if (button) {
      expect(i.deferUpdate).toHaveBeenCalledOnce();
      expect(i.deferReply).not.toHaveBeenCalled();
    } else expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(i.editReply).not.toHaveBeenCalled();
    finish([]);
    await result;
    expect(i.editReply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
    expect(i.reply).not.toHaveBeenCalled();
    expect(i.update).not.toHaveBeenCalled();
  });

  it('持ち物の読み込みに失敗しても受付中のまま残さず、失敗を表示する', async () => {
    vi.mocked(presentChoices).mockRejectedValueOnce(new Error('test database failure'));
    const i = interaction('items');
    await new PresentApp(db, () => cfg).onInteraction(i as unknown as Interaction);
    expect(i.deferReply).toHaveBeenCalledOnce();
    expect(i.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('時間をおいて'), embeds: [], components: [],
    });
    expect(i.reply).not.toHaveBeenCalled();
  });

  it('送付の確定処理の失敗を、持ち物の読み込み失敗として上書きしない', async () => {
    const app = new PresentApp(db, () => cfg);
    const i = interaction('', true);
    i.customId = 'present:ok:test';
    vi.spyOn(app as unknown as { decide(i: unknown): Promise<void> }, 'decide').mockImplementationOnce(async () => {
      await i.deferUpdate();
      throw new Error('test failure after confirmation');
    });
    await app.onInteraction(i as unknown as Interaction);
    expect(i.editReply).not.toHaveBeenCalled();
    expect(i.reply).not.toHaveBeenCalled();
  });

  it('カジノのリンク生成が未完了でも本人だけに受付済みとなる', async () => {
    let finish!: (value: string) => void;
    vi.mocked(createLoginLink).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const i = interaction('casino');
    const result = new CasinoApp(() => activeCfg, 'https://example.test', db).onInteraction(i as unknown as Interaction);
    await vi.waitFor(() => expect(createLoginLink).toHaveBeenCalled());
    expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(i.editReply).not.toHaveBeenCalled();
    finish('test-link');
    await result;
    const body = i.editReply.mock.calls[0]![0];
    expect(JSON.stringify(body)).toContain('/casino/link/test-link');
    expect(body).not.toHaveProperty('flags');
    expect(i.reply).not.toHaveBeenCalled();
  });

  it('カジノのリンク生成が失敗しても通常のログイン入口を返す', async () => {
    vi.mocked(createLoginLink).mockRejectedValueOnce(new Error('test database failure'));
    const i = interaction('casino');
    await new CasinoApp(() => activeCfg, 'https://example.test', db).onInteraction(i as unknown as Interaction);
    const body = i.editReply.mock.calls[0]![0];
    expect(JSON.stringify(body)).toContain('https://example.test/casino');
    expect(JSON.stringify(body)).not.toContain('/casino/link/');
    expect(i.deferReply).toHaveBeenCalledOnce();
    expect(i.reply).not.toHaveBeenCalled();
  });

  it('カジノ休止中はリンクを作らず、受付した返事を休止案内に更新する', async () => {
    const i = interaction('casino');
    await new CasinoApp(() => ({ ...activeCfg, casino: { ...activeCfg.casino, enabled: false } }), 'https://example.test', db)
      .onInteraction(i as unknown as Interaction);
    expect(createLoginLink).not.toHaveBeenCalled();
    expect(i.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('お休み') }));
    expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
  });
});

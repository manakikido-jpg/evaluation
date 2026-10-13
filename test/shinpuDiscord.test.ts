import { expect, it, vi } from 'vitest';
import { MessageFlags, type Interaction } from 'discord.js';
import { CasinoApp, shinpuTestReply } from '../src/discord/casino.js';
import { commandDefinitions } from '../src/discord/commands.js';
import { cfg, ROLE } from './helpers.js';
function command(roles: string[]) {
  return {
    isChatInputCommand: () => true,
    commandName: 'shinpu',
    inCachedGuild: () => true,
    guildId: cfg.guildId,
    member: { roles: { cache: new Map(roles.map((r) => [r, {}])) } },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}
it('一般メンバーにはリンクを発行せず、本人だけに拒否を返す', async () => {
  const i = command([ROLE.sanpaisha]);
  await new CasinoApp(() => cfg, 'https://test.example').onInteraction(i as unknown as Interaction);
  expect(i.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }));
  expect(i.deferReply).not.toHaveBeenCalled();
});
it('運営には先に本人だけの返事を確保して認証ボタンを返す', async () => {
  const i = command([ROLE.shinshoku]);
  await new CasinoApp(() => cfg, 'https://test.example').onInteraction(i as unknown as Interaction);
  expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
  expect(i.editReply).toHaveBeenCalled();
  expect(i.reply).not.toHaveBeenCalled();
});
it('BOTのリンクはテスト専用の道で、通知メンションをしない', () => {
  const p = shinpuTestReply('https://test.example', 'test-token');
  expect(p.allowedMentions.parse).toEqual([]);
  expect(p.components![0]!.toJSON().components[0]).toMatchObject({
    label: 'テストプレイに入る',
    url: 'https://test.example/casino/shinpu/link/test-token',
  });
});
it('日本語のスラッシュコマンドにテスト入口を登録する', () => {
  const cmd = commandDefinitions(cfg).find((c) => c.name === 'shinpu');
  expect(cmd?.name_localizations?.ja).toBe('神符合戦');
  expect(cmd?.default_member_permissions).toBe('1099511627776');
});

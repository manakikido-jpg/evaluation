import { describe, expect, it, vi } from 'vitest';
import type { Interaction } from 'discord.js';
import { commandDefinitions } from '../src/discord/commands.js';
import { TALK_TOPICS, drawTalkTopic, onTalkTopicInteraction, talkTopicView } from '../src/discord/talkTopic.js';

const guild = '100000000000000001';
function interaction(button?: string, guildId = guild) {
  return { inCachedGuild: () => true, guildId, commandName: 'talktopic', customId: button,
    isChatInputCommand: () => !button, isButton: () => !!button, isRepliable: () => true,
    reply: vi.fn().mockResolvedValue(undefined), update: vi.fn().mockResolvedValue(undefined),
    replied: false, deferred: false };
}

describe('無料トークテーマ', () => {
  it('すべてのお題が抽選でき、引き直しでは直前のお題を除く', () => {
    expect(new Set(TALK_TOPICS).size).toBe(TALK_TOPICS.length);
    for (let previous = 0; previous < TALK_TOPICS.length; previous++) {
      const draws = Array.from({ length: TALK_TOPICS.length - 1 }, (_, n) =>
        drawTalkTopic(previous, () => (n + 0.5) / (TALK_TOPICS.length - 1)));
      expect(new Set(draws).size).toBe(TALK_TOPICS.length - 1);
      expect(draws).not.toContain(previous);
    }
    expect(drawTalkTopic(undefined, () => 0)).toBe(0);
    expect(drawTalkTopic(undefined, () => 0.999999)).toBe(TALK_TOPICS.length - 1);
  });
  it('無料・サーバー限定の全員用コマンドを登録する', () => {
    const command = commandDefinitions().find(c => c.name === 'talktopic')!;
    expect(command.name_localizations?.ja).toBe('トークテーマ');
    expect(command.default_member_permissions).toBeUndefined();
    expect(command.contexts).toEqual([0]);
  });
  it('公開で投稿し、通知せず、無料を案内する', async () => {
    const i = interaction();
    await onTalkTopicInteraction(i as unknown as Interaction, guild);
    const body = i.reply.mock.calls[0]![0];
    expect(body.flags).toBeUndefined();
    expect(body.allowedMentions).toEqual({ parse: [] });
    expect(body.embeds[0].footer.text).toContain('無料');
  });
  it('ほかの参加者もボタンで同じ投稿を更新できる', async () => {
    const i = interaction('talktopic:draw:0');
    await onTalkTopicInteraction(i as unknown as Interaction, guild);
    expect(i.reply).not.toHaveBeenCalled();
    expect(i.update.mock.calls[0]![0].embeds[0].description).not.toBe(TALK_TOPICS[0]);
    expect(talkTopicView(0).components[0]!.toJSON().components[0]).toMatchObject({ custom_id: 'talktopic:draw:0' });
  });
  it('別サーバー・無関係なボタンには応答しない', async () => {
    for (const i of [interaction(undefined, 'other'), interaction('other:draw:0'), interaction('talktopic:draw:abc')]) {
      await onTalkTopicInteraction(i as unknown as Interaction, guild);
      expect(i.reply).not.toHaveBeenCalled(); expect(i.update).not.toHaveBeenCalled();
    }
  });
});

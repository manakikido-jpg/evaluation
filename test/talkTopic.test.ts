import { describe, expect, it, vi } from 'vitest';
import type { Interaction } from 'discord.js';
import { commandDefinitions } from '../src/discord/commands.js';
import { TOPIC_CATEGORIES, type TopicCategory } from '../src/domain/talkTopics.js';
import { nextTopicDraw, startTopicDraw, topicDeck, topicIndex } from '../src/domain/talkTopicDraw.js';
import { availableTopicCategories, isEngawaName, onTalkTopicInteraction } from '../src/discord/talkTopic.js';

const guild = '100000000000000001';
function interaction(kind: 'command' | 'button' | 'select' = 'command', id = '', name = '宿坊') {
  const channel = { name, parentId: null };
  return { inCachedGuild: () => true, guildId: guild, channelId: 'channel',
    guild: { channels: { fetch: vi.fn().mockResolvedValue(channel) } },
    commandName: 'talktopic', customId: id, values: ['life'], message: { components: [] },
    isChatInputCommand: () => kind === 'command', isButton: () => kind === 'button', isStringSelectMenu: () => kind === 'select',
    deferReply: vi.fn().mockResolvedValue(undefined), deferUpdate: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined), editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined), deferred: false, replied: false };
}
const run = (i: ReturnType<typeof interaction>) => onTalkTopicInteraction(i as unknown as Interaction, guild);
const categories = Object.keys(TOPIC_CATEGORIES) as TopicCategory[];

describe('ジャンル別の無料トークテーマ', () => {
  it('各ジャンルに重複のない80題、全体で400題ある', () => {
    const all: string[] = [];
    for (const category of categories) {
      const topics = TOPIC_CATEGORIES[category].topics;
      expect(topics.length).toBe(80);
      expect(new Set(topics).size).toBe(80);
      expect(topics.every(s => s.length > 5 && s.length < 200)).toBe(true);
      all.push(...topics);
    }
    expect(all.length).toBe(400);
    expect(new Set(all).size).toBe(400);
  });
  it('一巡するまで重複せず、seedで順序を復元できる', () => {
    for (const category of categories) for (const seed of [0, 1, 12345, 0xffffffff]) {
      let draw = startTopicDraw(category, undefined, seed);
      const picks = [];
      for (let step = 0; step < 80; step++) {
        picks.push(topicIndex(draw));
        expect(topicIndex(draw)).toBe(topicDeck(category, seed)[step]);
        if (step < 79) draw = nextTopicDraw(draw);
      }
      expect(new Set(picks).size).toBe(80);
      const next = nextTopicDraw(draw);
      expect(next.step).toBe(0);
      expect(topicIndex(next)).not.toBe(topicIndex(draw));
      expect(topicIndex(startTopicDraw(category, topicDeck(category, seed)[0], seed))).not.toBe(picks[0]);
    }
  });
  it('無料・サーバー限定の全員用コマンド', () => {
    const command = commandDefinitions().find(c => c.name === 'talktopic')!;
    expect(command.name_localizations?.ja).toBe('トークテーマ');
    expect(command.default_member_permissions).toBeUndefined();
    expect(command.contexts).toEqual([0]);
  });
  it('公開メニューを表示し、縁側ではHなテーマだけ隠す', async () => {
    for (const name of ['宿坊', '🌸 大きな縁側 1']) {
      const i = interaction('command', '', name);
      await run(i);
      expect(i.deferReply).toHaveBeenCalledWith();
      const body = i.editReply.mock.calls[0]![0];
      expect(body.allowedMentions).toEqual({ parse: [] });
      const options = body.components[0].toJSON().components[0].options;
      expect(options.some((o: { value: string }) => o.value === 'adult')).toBe(!name.includes('縁側'));
      expect(options.some((o: { value: string }) => o.value === 'love')).toBe(true);
    }
    expect(availableTopicCategories(false)).toHaveLength(4);
    expect(isEngawaName('🌸 縁　側 ２')).toBe(true);
  });
  it('選んだジャンルを同じ投稿に表示する', async () => {
    const i = interaction('select', 'talktopic:category'); i.values = ['entertainment'];
    await run(i);
    const body = i.editReply.mock.calls[0]![0];
    expect(body.embeds[0].title).toContain('エンタメ');
    expect(TOPIC_CATEGORIES.entertainment.topics).toContain(body.embeds[0].description);
    expect(body.components[1].toJSON().components[0].custom_id).toMatch(/^talktopic:draw:entertainment:/);
  });
  it('だれでも同じジャンルの次のお題を引ける', async () => {
    const i = interaction('button', 'talktopic:draw:love:1:0'); await run(i);
    expect(i.deferUpdate).toHaveBeenCalled();
    const body = i.editReply.mock.calls[0]![0];
    expect(body.embeds[0].description).toBe(TOPIC_CATEGORIES.love.topics[topicDeck('love', 1)[1]!]!);
    expect(body.components[1].toJSON().components[0].custom_id).toBe('talktopic:draw:love:1:1');
  });
  it('同じジャンルの再選択でも一巡を継続する', async () => {
    const i = interaction('select', 'talktopic:category'); i.values = ['life'];
    // Discordの受信データのcustomIdを再現する。
    i.message.components = [{ components: [{ customId: 'talktopic:draw:life:1:0' }] }] as never[];
    await run(i);
    expect(i.editReply.mock.calls[0]![0].components[1].toJSON().components[0].custom_id).toBe('talktopic:draw:life:1:1');
  });
  it('縁側で古いHボタン・選択値を使っても公開しない', async () => {
    for (const kind of ['button', 'select'] as const) {
      const i = interaction(kind, kind === 'button' ? 'talktopic:draw:adult:1:0' : 'talktopic:category', '小さな縁側');
      i.values = ['adult']; await run(i);
      expect(i.editReply).not.toHaveBeenCalled();
      expect(i.followUp.mock.calls[0]![0]).toMatchObject({ flags: 64, content: expect.stringContaining('縁側') });
    }
  });
  it('親やカテゴリが縁側ならスレッド・子チャンネルも対象外', async () => {
    const i = interaction('command');
    i.guild.channels.fetch.mockResolvedValueOnce({ name: 'お話', parentId: 'parent' })
      .mockResolvedValueOnce({ name: '小さな縁側', parentId: 'category' });
    await run(i);
    expect(JSON.stringify(i.editReply.mock.calls[0]![0])).not.toContain('Hなテーマ');
    expect(i.guild.channels.fetch).toHaveBeenCalledWith('parent', { force: true });
  });
  it('縁側でも通常ジャンルは回せる、ほかの場所なら大人の恋バナも回せる', async () => {
    for (const [category, name] of [['funny', '縁側'], ['adult', '宿坊']]) {
      const i = interaction('select', 'talktopic:category', name); i.values = [category!]; await run(i);
      expect(i.editReply).toHaveBeenCalledOnce(); expect(i.followUp).not.toHaveBeenCalled();
    }
  });
  it('チャンネル取得失敗では公開せず、本人にエラーを返す', async () => {
    const i = interaction('button', 'talktopic:draw:adult:1:0'); i.deferred = true;
    i.guild.channels.fetch.mockRejectedValue(new Error('unavailable')); await run(i);
    expect(i.editReply).not.toHaveBeenCalled(); expect(i.followUp).toHaveBeenCalled();
  });
  it('別サーバー・対象外・壊れたボタンに応答しない', async () => {
    const other = interaction(); other.guildId = 'other';
    const dm = interaction(); dm.inCachedGuild = () => false;
    for (const i of [other, dm, ...['other:draw:0', 'talktopic:draw:no:1:0', 'talktopic:draw:life:1:80', 'talktopic:draw:life:zzzzzzz:0'].map(id => interaction('button', id))]) {
      await run(i); expect(i.deferReply).not.toHaveBeenCalled(); expect(i.deferUpdate).not.toHaveBeenCalled();
    }
  });
  it('旧版ボタンは生活ジャンルに移行する', async () => {
    const i = interaction('button', 'talktopic:draw:0'); await run(i);
    expect(i.editReply.mock.calls[0]![0].embeds[0].title).toContain('生活');
  });
});

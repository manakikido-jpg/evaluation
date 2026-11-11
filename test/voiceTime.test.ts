import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MessageFlags } from 'discord.js';
import type { Db } from '../src/db/client.js';
import { voiceChannels, voiceUsage } from '../src/db/schema.js';
import { VoiceTimeApp, voiceTimeView } from '../src/discord/voiceTime.js';
import { jstDate } from '../src/services/activity.js';
import { cfg, makeDb } from './helpers.js';

const A = '810000000000000071', ENG = '910000000000000071';
let db: Db, close: () => Promise<void>;
beforeEach(async () => { ({ db, close } = await makeDb()); });
afterEach(async () => close());
const interaction = (pub: boolean | null) => ({
  isChatInputCommand: () => true, commandName: 'fujo', inCachedGuild: () => true, guildId: cfg.guildId,
  user: { id: A }, member: { displayName: 'さくら' }, options: { getBoolean: () => pub },
  deferReply: vi.fn(async () => undefined), editReply: vi.fn(async () => undefined), reply: vi.fn(), deferred: true, replied: false,
});

it('⏱ /浮上 は省略すると自分だけに、公開: はい でチャンネルに、全体と縁側の浮上時間を出す', async () => {
  await db.insert(voiceChannels).values({ channelId: ENG, name: '🌸 大きな縁側 1' });
  await db.insert(voiceUsage).values({ memberId: A, date: jstDate(new Date()), channelId: ENG, minutes: 75 });
  const app = new VoiceTimeApp(db, () => cfg);
  const own = interaction(null);
  await app.onInteraction(own as never);
  expect(own.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
  const body = (own.editReply.mock.calls as unknown as [{ embeds: { title: string; description: string }[]; allowedMentions: unknown }][])[0]![0];
  expect(body.embeds[0]!.title).toContain('さくら');
  expect(body.embeds[0]!.description).toContain('**今日**　全体 **1時間15分**　🏮 縁側 **1時間15分**');
  expect(body.embeds[0]!.description).toContain('氏子の条件に数える縁側の時間');
  expect(body.embeds[0]!.description).toContain('1 人だけの時間・ミュートやスピーカーミュートの時間もふくみます');
  expect(body.allowedMentions).toEqual({ parse: [] });
  const pub = interaction(true);
  await app.onInteraction(pub as never);
  expect(pub.deferReply).toHaveBeenCalledWith({});
});

it('氏子の条件に届いたら「達成」、まだなら残りを出す', () => {
  const zero = { total: 0, engawa: 0 };
  expect(voiceTimeView('a', { today: zero, week: zero, month: zero, all: zero, evaluation: 1200 }).embeds[0]!.description).toContain('（達成）');
  expect(voiceTimeView('a', { today: zero, week: zero, month: zero, all: zero, evaluation: 1140 }).embeds[0]!.description).toContain('（あと 1時間0分）');
});

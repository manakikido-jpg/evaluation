import { ChannelType, PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';
import { expect, it, vi } from 'vitest';
import { EventRelayApp, eventRelayCommand } from '../src/readAloud/relayApp.js';
import { EventRelay, RelayError } from '../src/readAloud/relay.js';
function setup(action = '開始', count = 1) {
  const relay = { start: vi.fn(async () => {}), stop: vi.fn(async () => {}), status: vi.fn(), lastStop: null };
  const ids = ['stage', ...Array.from({ length: count }, (_, n) => `vc${n + 1}`)];
  const channels = ids.map((id, n) => ({ id, type: n ? ChannelType.GuildVoice : ChannelType.GuildStageVoice,
    allowed: true, permissionsFor() { return { has: () => this.allowed }; } }));
  const i = { commandName: 'イベント中継', guildId: 'guild', inCachedGuild: () => true, memberPermissions: { has: vi.fn(() => true) },
    options: { getSubcommand: () => action, getChannel: (name: string) => channels[name === 'ステージ' ? 0 : Number(name.slice(3))] ?? null },
    guild: { afkChannelId: 'afk', channels: { fetch: vi.fn(async (id: string) => channels.find(c => c.id === id)) } },
    member: {}, user: { id: 'operator' }, reply: vi.fn(async () => {}), deferReply: vi.fn(async () => {}), editReply: vi.fn(async () => {}) };
  const app = new EventRelayApp('guild', relay as unknown as EventRelay);
  return { relay, channels, i, run: () => app.interaction(i as unknown as ChatInputCommandInteraction) };
}
it('登録は運営専用・ステージ＋通常VC最大6部屋', () => {
  const data = eventRelayCommand.toJSON();
  expect(data.default_member_permissions).toBe(String(PermissionFlagsBits.ManageGuild));
  expect(data.dm_permission).toBe(false);
  expect(data.options!.map(o => o.name)).toEqual(['開始', '停止', '状態']);
  const start = data.options![0] as { options: { required?: boolean; channel_types?: number[] }[] };
  expect(start.options).toHaveLength(7);
  expect(start.options[0]).toMatchObject({ required: true, channel_types: [ChannelType.GuildStageVoice] });
  expect(start.options[1]).toMatchObject({ required: true, channel_types: [ChannelType.GuildVoice] });
  expect(start.options[6]!.required).toBe(false);
});
it.each(['開始', '停止', '状態'])('運営権限のない人は%sも操作できない', async action => {
  const s = setup(action); s.i.memberPermissions.has.mockReturnValue(false); await s.run();
  expect(s.i.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('サーバー管理権限'), allowedMentions: { parse: [] } }));
  expect(s.relay.start).not.toHaveBeenCalled(); expect(s.relay.stop).not.toHaveBeenCalled(); expect(s.relay.status).not.toHaveBeenCalled();
});
it('別サーバーからの操作は受け付けない', async () => {
  const s = setup(); s.i.guildId = 'other'; await s.run(); expect(s.relay.start).not.toHaveBeenCalled(); expect(s.i.reply).not.toHaveBeenCalled();
});
it.each([1, 6])('%s部屋へ開始するときは権限確認の前に応答を保留する', async count => {
  const s = setup('開始', count); await s.run();
  expect(s.i.deferReply.mock.invocationCallOrder[0]).toBeLessThan(s.i.guild.channels.fetch.mock.invocationCallOrder[0]!);
  expect(s.relay.start).toHaveBeenCalledWith({ source: 'stage', targets: s.channels.slice(1).map(c => c.id), actor: 'operator' });
  expect(s.i.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('声が聞こえるか試してください'), allowedMentions: { parse: [] } }));
});
it.each(['duplicate', 'afk', 'permission', 'stageTarget'])('配信先%sは拒否する', async kind => {
  const s = setup('開始', 2);
  if (kind === 'duplicate') s.channels[2]!.id = 'vc1';
  if (kind === 'afk') s.i.guild.afkChannelId = 'vc1';
  if (kind === 'permission') s.channels[1]!.allowed = false;
  if (kind === 'stageTarget') s.channels[1]!.type = ChannelType.GuildStageVoice;
  await s.run(); expect(s.relay.start).not.toHaveBeenCalled(); expect(s.i.editReply).toHaveBeenCalledOnce();
});
it('予期しないエラーの内部情報は返事へ出さない', async () => {
  const s = setup(); s.relay.start.mockRejectedValueOnce(Error('internal-private-detail')); await s.run();
  expect(s.i.editReply.mock.calls).not.toEqual(expect.arrayContaining([expect.objectContaining({ content: expect.stringContaining('internal-private-detail') })]));
  expect(JSON.stringify(s.i.editReply.mock.calls)).not.toContain('internal-private-detail');
  s.relay.start.mockRejectedValueOnce(new RelayError('空きBOTが足りません')); await s.run();
  expect(s.i.editReply).toHaveBeenLastCalledWith(expect.objectContaining({ content: '空きBOTが足りません' }));
});
it('停止と、受信できていても実際に聞こえるか確認が必要な状態表示', async () => {
  const stop = setup('停止'); await stop.run(); expect(stop.relay.stop).toHaveBeenCalledOnce();
  const s = setup('状態'); s.relay.status.mockReturnValue({ source: 'stage', targets: ['vc1'], phase: 'active', receiver: 'receiver-ten', senders: ['sender-one'], packets: 4, lastPacketAt: Date.now() }); await s.run();
  expect(s.i.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('受信：拾 <@receiver-ten>') }));
  expect(s.i.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('<#vc1>＝<@sender-one>') }));
  expect(s.i.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('受信数だけで各部屋に聞こえることまでは確認できません') }));
  s.relay.status.mockReturnValue({ source: 'stage', targets: ['vc1'], phase: 'active', receiver: 'receiver-ten', senders: ['sender-one'], packets: 0, lastPacketAt: null }); await s.run();
  expect(s.i.reply).toHaveBeenLastCalledWith(expect.objectContaining({ content: expect.stringContaining('まだ受信していません') }));
});

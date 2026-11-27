import { Collection, MessageFlags } from 'discord.js';
import { expect, it, vi } from 'vitest';
import { controlId } from '../src/discord/controlPanel.js';
import { VcHelpApp, vcHelpId } from '../src/discord/vcHelp.js';
import { cfg } from './helpers.js';
const CH = '950000000000000001', A = '810000000000000001', B = '810000000000000002', C = '810000000000000003';
function setup() {
  const send = vi.fn(async (_body: { content: string; allowedMentions: { roles: string[]; users: string[] } }) => undefined);
  const vc = { id: CH, name: '大きな縁側', isVoiceBased: () => true, members: new Map([[A, { id: A, displayName: '本人', user: { bot: false } }], [B, { id: B, displayName: '相手', user: { bot: false } }]]) };
  const dest = { id: C, name: '衛士の連絡', type: 0, isSendable: () => true, send };
  const guild = { channels: { cache: new Collection<string, object>([[CH, vc], [C, dest]]) }, roles: { cache: new Collection([[C, { id: C, name: '衛士' }]]) } };
  const interaction = (customId: string, kind = 'button') => ({
    customId, user: { id: A }, guildId: cfg.guildId, guild, member: { voice: { channel: vc } },
    inCachedGuild: () => true, isButton: () => kind === 'button', isStringSelectMenu: () => kind === 'select', isModalSubmit: () => kind === 'modal', isRepliable: () => true,
    reply: vi.fn(), update: vi.fn(), deferUpdate: vi.fn(), deferReply: vi.fn(), editReply: vi.fn(), showModal: vi.fn(),
    values: [B], fields: { getTextInputValue: () => '大声で @everyone と呼んでいる' },
  });
  return { send, vc, interaction, app: new VcHelpApp(() => cfg, () => 1234567) };
}
it('寝落ちは対象を選ぶまで通知せず、本人限定の選択から既存の衛士通知とクールダウンへ進む', async () => {
  const { send, interaction, app } = setup();
  const button = interaction(controlId('sleep', CH, A));
  await app.onInteraction(button as never);
  expect(send).not.toHaveBeenCalled();
  const body = button.reply.mock.calls[0]![0];
  expect(body.flags).toBe(MessageFlags.Ephemeral);
  expect(body.components[0].toJSON().components[0].custom_id).toBe(vcHelpId('pick', CH, A));
  const select = interaction(vcHelpId('pick', CH, A), 'select');
  await app.onInteraction(select as never);
  expect(select.deferUpdate).toHaveBeenCalled();
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]![0]).toMatchObject({ content: expect.stringContaining(`<@${B}>`), allowedMentions: { roles: [C], users: [] } });
  await app.onInteraction(interaction(vcHelpId('pick', CH, A), 'select') as never);
  expect(send).toHaveBeenCalledTimes(1);
});
it('運営呼び出しは状況入力モーダルの送信後に通知し、自由文で全員通知を飛ばさない', async () => {
  const { send, interaction, app } = setup();
  const button = interaction(controlId('call', CH, A));
  await app.onInteraction(button as never);
  expect(button.showModal.mock.calls[0]![0].data.custom_id).toBe(vcHelpId('modal', CH, A));
  expect(send).not.toHaveBeenCalled();
  const modal = interaction(vcHelpId('modal', CH, A), 'modal');
  await app.onInteraction(modal as never);
  expect(modal.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]![0].content).toContain('＠everyone');
  expect(modal.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('衛士に知らせました') }));
});
it('他人の操作・退出後の続きは通知しない。対象が退出したときも通知しない', async () => {
  const { send, vc, interaction, app } = setup();
  const wrong = interaction(controlId('sleep', CH, B));
  await app.onInteraction(wrong as never);
  expect(wrong.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('本人') }));
  const stolen = interaction(vcHelpId('modal', CH, B), 'modal');
  await app.onInteraction(stolen as never);
  expect(stolen.reply).toHaveBeenCalled();
  const left = interaction(vcHelpId('pick', CH, A), 'select');
  Object.assign(left.member.voice, { channel: undefined });
  await app.onInteraction(left as never);
  expect(left.reply).toHaveBeenCalled();
  vc.members.delete(B);
  const gone = interaction(vcHelpId('pick', CH, A), 'select');
  await app.onInteraction(gone as never);
  expect(gone.update).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('もう通話にいません') }));
  expect(send).not.toHaveBeenCalled();
});

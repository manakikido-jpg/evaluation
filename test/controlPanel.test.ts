import { afterEach, expect, it, vi } from 'vitest';
import { MessageFlags } from 'discord.js';
import { controlAccess, controlId, controlPanel, parseControlId } from '../src/discord/controlPanel.js';
import { setMusubiMode, setNewSystemVisible } from '../src/domain/terms.js';
import { HelpApp } from '../src/discord/help.js';
import { yakuBlocks } from '../src/services/yakuGate.js';
import { vcPanel, vcPanelIds } from '../src/discord/views.js';
import { cfg } from './helpers.js';
const CH = '950000000000000001', A = '810000000000000001', B = '810000000000000002';
afterEach(() => { setMusubiMode(false); setNewSystemVisible(false); });
const sections = () => controlPanel(CH, A).components[0]!.toJSON().components.filter(c => c.type === 9);
const buttons = () => sections().map(c => c.accessory);
it('公開後は5項目、本人・通話を識別するボタン。画像は使わない', () => {
  setMusubiMode(true); setNewSystemVisible(true);
  expect(buttons().map(b => 'label' in b ? b.label : '')).toEqual(['プロフィール', '送金', 'ご縁を結ぶ', '絵馬をおくる', '一覧']);
  for (const b of buttons()) expect(parseControlId('custom_id' in b ? b.custom_id : '')).toMatchObject({ channelId: CH, ownerId: A });
  expect(controlPanel(CH, A)).not.toHaveProperty('embeds');
  expect(controlPanel(CH, A).flags).toBe(MessageFlags.Ephemeral | MessageFlags.IsComponentsV2);
  expect(sections()).toHaveLength(5);
  expect(controlPanel(CH, A).components[0]!.toJSON().components.filter(c => c.type === 14)).toHaveLength(5);
  expect(JSON.stringify(controlPanel(CH, A))).not.toMatch(/https:|attachment:|image/);
  expect(new Set(buttons().map(b => 'custom_id' in b ? b.custom_id : '')) .size).toBe(5);
});
it('③④が未公開なら新制度の入口は出さない', () => {
  expect(buttons()).toHaveLength(3);
  setMusubiMode(true); expect(buttons()).toHaveLength(3);
  setMusubiMode(false); setNewSystemVisible(true);
  expect(buttons()).toHaveLength(4);
  expect(JSON.stringify(buttons())).not.toContain('ご縁を結ぶ');
});
it('共有の入口には操作内容・個人データを出さず、旧パネルも消せる識別IDを残す', () => {
  const r = vcPanel(CH, false, false, true, true);
  expect(JSON.stringify(r)).toContain('操作パネルを開く');
  expect(JSON.stringify(r)).not.toContain('control:send');
  expect(vcPanelIds(CH)).toContain(controlId('open', CH));
  expect(vcPanelIds(CH)).toContain(`shuin:vc:${CH}`);
});
it('他人のパネル・別通話・縁側以外から操作できない', () => {
  const p = parseControlId(controlId('profile', CH, A))!;
  const fake = (user = A, id = CH, name = '🌸 大きな縁側') => ({ user: { id: user }, member: { voice: { channel: { id, name } } } }) as never;
  expect(controlAccess(fake(), p)).toBeUndefined();
  expect(controlAccess(fake(B), p)).toContain('本人');
  expect(controlAccess(fake(A, B), p)).toContain('入ってから');
  expect(controlAccess(fake(A, CH, '宵縁側'), p)).toContain('入ってから');
  expect(controlAccess({ user: { id: A }, member: { voice: {} } } as never, p)).toContain('入ってから');
});
it('不正なIDは受け付けない', () => {
  for (const id of ['control:open:abc', `control:open:${CH}:${A}`, `control:send:${CH}`, `control:help:${CH}:${A}:extra`, `control:unknown:${CH}:${A}`]) expect(parseControlId(id)).toBeUndefined();
});
it('新しい送金・結び・絵馬の入口でも厄制限を迂回しない', () => {
  for (const action of ['send', 'musubi', 'ema'] as const) expect(yakuBlocks({ customId: controlId(action, CH, A) })).toBe(true);
});
it('コマンドボタンは本人だけに、役職に応じた既存一覧を返す', async () => {
  const i = { user: { id: A }, member: { voice: { channel: { id: CH, name: '縁側' } }, roles: { cache: new Map([[cfg.ranks[0]!.roleId, {}]]) } },
    guildId: cfg.guildId, inCachedGuild: () => true, isRepliable: () => true, isButton: () => true, isChatInputCommand: () => false,
    customId: controlId('help', CH, A), reply: vi.fn() };
  await new HelpApp(() => cfg).onInteraction(i as never);
  expect(i.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral, embeds: expect.any(Array), allowedMentions: { parse: [] } }));
  i.user.id = B; i.reply.mockClear();
  await new HelpApp(() => cfg).onInteraction(i as never);
  expect(i.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('本人'), flags: MessageFlags.Ephemeral }));
});
